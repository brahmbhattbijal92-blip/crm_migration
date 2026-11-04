import { DataService } from './DataService';
import type { Client, DocumentMetadata, SearchQuery, SearchResult } from '../types/data';
import { DataServiceError } from '../errors/DataErrors';
import { getSupabaseClient } from '../lib/supabase';

const CLIENT_TABLE = 'clients';
const DOCUMENT_TABLE = 'client_documents';
const STORAGE_BUCKET = process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET || 'client-documents';
const SIGNED_URL_TTL_SECONDS = 60 * 60;

type ClientRow = Record<string, unknown>;

function throwSupabaseError(error: { message: string; code?: string }, operation: string): never {
  throw new DataServiceError(
    `Supabase ${operation} failed: ${error.message}`,
    error.code ?? 'SUPABASE_OPERATION_FAILED',
    'CRITICAL',
    error
  );
}

function mapClient(row: ClientRow): Client {
  const firstName = typeof row.first_name === 'string' ? row.first_name : '';
  const lastName = typeof row.last_name === 'string' ? row.last_name : '';
  const name = [firstName, lastName].filter(Boolean).join(' ') || String(row.name ?? '');

  return {
    id: String(row.id),
    name,
    email: String(row.email ?? ''),
    ...(typeof row.company === 'string' ? { company: row.company } : {}),
    updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
  };
}

function splitName(name: string): { first_name: string; last_name: string } {
  const [firstName = '', ...lastName] = name.trim().split(/\s+/);
  return { first_name: firstName, last_name: lastName.join(' ') };
}

function escapePostgrestValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function safeFileName(fileName: string): string {
  return fileName.replace(/[\\/\0]/g, '_').replace(/[^a-zA-Z0-9._-]/g, '_');
}

export class CloudDataService extends DataService {
  async saveClient(client: Omit<Client, 'updatedAt'>): Promise<Client> {
    const { data, error } = await getSupabaseClient()
      .from(CLIENT_TABLE)
      .upsert({
        id: client.id,
        ...splitName(client.name),
        email: client.email,
        ...(client.company === undefined ? {} : { company: client.company }),
      }, { onConflict: 'id' })
      .select('*')
      .single();

    if (error) throwSupabaseError(error, 'client save');
    return mapClient(data as ClientRow);
  }

  async updateClient(
    id: string,
    updates: Partial<Pick<Client, 'name' | 'email' | 'company'>>
  ): Promise<Client> {
    const changes: Record<string, unknown> = {};
    if (updates.name !== undefined) Object.assign(changes, splitName(updates.name));
    if (updates.email !== undefined) changes.email = updates.email;
    if (updates.company !== undefined) changes.company = updates.company;
    if (Object.keys(changes).length === 0) {
      throw new DataServiceError('At least one client field must be provided.', 'EMPTY_CLIENT_UPDATE', 'WARNING');
    }

    const { data, error } = await getSupabaseClient()
      .from(CLIENT_TABLE)
      .update(changes)
      .eq('id', id)
      .is('deleted_at', null)
      .select('*')
      .single();

    if (error) throwSupabaseError(error, 'client update');
    return mapClient(data as ClientRow);
  }

  async findClient(id: string): Promise<Client | null> {
    const { data, error } = await getSupabaseClient()
      .from(CLIENT_TABLE)
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) throwSupabaseError(error, 'client lookup');
    return data ? mapClient(data as ClientRow) : null;
  }

  async deleteClient(id: string): Promise<void> {
    const { data, error } = await getSupabaseClient()
      .from(CLIENT_TABLE)
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null)
      .select('id')
      .single();

    if (error) throwSupabaseError(error, 'client soft-delete');
    if (!data) {
      throw new DataServiceError(`Client ${id} was not found.`, 'CLIENT_NOT_FOUND', 'WARNING');
    }
  }

  async selectDocumentDirectory(): Promise<string | null> {
    throw new DataServiceError(
      'A local document folder can only be selected while local storage is active.',
      'LOCAL_DOCUMENT_FOLDER_ONLY',
      'WARNING'
    );
  }

  async uploadDocument(clientId: string, file: File): Promise<DocumentMetadata> {
    const supabase = getSupabaseClient();
    const objectPath = `${safeFileName(clientId)}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
    const bucket = supabase.storage.from(STORAGE_BUCKET);
    const { error: uploadError } = await bucket.upload(objectPath, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });

    if (uploadError) throwSupabaseError(uploadError, 'document upload');

    try {
      const { data: signedUrl, error: signedUrlError } = await bucket.createSignedUrl(
        objectPath,
        SIGNED_URL_TTL_SECONDS
      );
      if (signedUrlError) throwSupabaseError(signedUrlError, 'document URL creation');

      const { data, error } = await supabase
        .from(DOCUMENT_TABLE)
        .insert({
          client_id: clientId,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type || 'application/octet-stream',
          storage_path: objectPath,
        })
        .select('*')
        .single();
      if (error) throwSupabaseError(error, 'document metadata save');

      return {
        id: String(data.id),
        clientId: String(data.client_id),
        fileName: String(data.file_name),
        fileSize: Number(data.file_size),
        mimeType: String(data.mime_type),
        storageUrl: signedUrl.signedUrl,
        uploadedAt: String(data.uploaded_at ?? new Date().toISOString()),
      };
    } catch (error) {
      const { error: cleanupError } = await bucket.remove([objectPath]);
      if (cleanupError) console.error('[CloudDataService] Failed to remove orphaned Storage object.', cleanupError);
      throw error;
    }
  }

  async searchRecords(query: SearchQuery): Promise<SearchResult<Client>> {
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));
    const offset = Math.max(0, query.offset ?? 0);
    const term = query.term.trim();
    let request = getSupabaseClient()
      .from(CLIENT_TABLE)
      .select('*', { count: 'exact' })
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (term) {
      const pattern = escapePostgrestValue(`%${term}%`);
      request = request.or(
        `first_name.ilike.${pattern},last_name.ilike.${pattern},email.ilike.${pattern}`
      );
    }

    const { data, error, count } = await request;
    if (error) throwSupabaseError(error, 'client search');

    return {
      items: (data ?? []).map((row) => mapClient(row as ClientRow)),
      totalCount: count ?? 0,
    };
  }
}
