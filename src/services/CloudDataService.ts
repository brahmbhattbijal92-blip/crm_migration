import { DataService } from './DataService';
import type { Client, DocumentMetadata, SearchQuery, SearchResult } from '../types/data';
import { DataServiceError } from '../errors/DataErrors';
import { getSupabaseClient } from '../lib/supabase';

const CLIENT_TABLE = 'clients';
const DOCUMENT_TABLE = 'documents';
const STORAGE_BUCKET = process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET || 'client-documents';
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const CLIENT_COLUMNS = 'id, first_name, last_name, email, company, created_at, updated_at';

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

async function assertClientCanReceiveDocuments(
  supabase: ReturnType<typeof getSupabaseClient>,
  clientId: string
): Promise<void> {
  const { error } = await supabase.rpc('assert_client_document_uploadable', {
    requested_client_id: clientId,
  });
  if (error?.code === '55000') {
    throw new DataServiceError(
      'This client is archived, deleted, or locked for purge and cannot accept documents.',
      'DOCUMENT_CLIENT_LOCKED',
      'WARNING',
      error
    );
  }
  if (error) throwSupabaseError(error, 'client upload eligibility check');
}

async function removeUploadedObject(
  bucket: ReturnType<ReturnType<typeof getSupabaseClient>['storage']['from']>,
  objectPath: string,
  documentId: string
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { error } = await bucket.remove([objectPath]);
      if (!error) return;
      lastError = error;
    } catch (error) {
      lastError = error;
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
  }

  throw new DataServiceError(
    `The document could not be saved and cleanup could not be confirmed. Contact support with reference ${documentId}.`,
    'DOCUMENT_CLEANUP_FAILED',
    'CRITICAL',
    lastError
  );
}

async function getActiveOrganizationId(supabase: ReturnType<typeof getSupabaseClient>): Promise<string> {
  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError || !userResult.user) {
    throw new DataServiceError('Sign in before using Cloud storage.', 'CLOUD_AUTH_REQUIRED', 'WARNING', userError);
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('default_organization_id')
    .eq('user_id', userResult.user.id)
    .single();
  if (profileError) throwSupabaseError(profileError, 'organization lookup');
  if (!profile?.default_organization_id) {
    throw new DataServiceError('Join an organization before using Cloud storage.', 'CLOUD_ORGANIZATION_REQUIRED', 'WARNING');
  }

  return String(profile.default_organization_id);
}

export class CloudDataService extends DataService {
  async saveClient(client: Omit<Client, 'updatedAt'>): Promise<Client> {
    const supabase = getSupabaseClient();
    const organizationId = await getActiveOrganizationId(supabase);
    const { data, error } = await supabase
      .from(CLIENT_TABLE)
      .insert({
        organization_id: organizationId,
        ...splitName(client.name),
        email: client.email,
        ...(client.company === undefined ? {} : { company: client.company }),
      })
      .select(CLIENT_COLUMNS)
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
      .select(CLIENT_COLUMNS)
      .single();

    if (error) throwSupabaseError(error, 'client update');
    return mapClient(data as ClientRow);
  }

  async findClient(id: string): Promise<Client | null> {
    const { data, error } = await getSupabaseClient()
      .from(CLIENT_TABLE)
      .select(CLIENT_COLUMNS)
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) throwSupabaseError(error, 'client lookup');
    return data ? mapClient(data as ClientRow) : null;
  }

  async deleteClient(id: string): Promise<void> {
    const { error } = await getSupabaseClient().rpc('archive_client', {
      requested_client_id: id,
    });

    if (error) throwSupabaseError(error, 'client soft-delete');
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
    const organizationId = await getActiveOrganizationId(supabase);
    await assertClientCanReceiveDocuments(supabase, clientId);

    const documentId = crypto.randomUUID();
    const objectPath = `${organizationId}/${clientId}/${documentId}`;
    const bucket = supabase.storage.from(STORAGE_BUCKET);
    let objectUploaded = false;

    try {
      const { error: uploadError } = await bucket.upload(objectPath, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });
      if (uploadError) throwSupabaseError(uploadError, 'document upload');
      objectUploaded = true;

      const { data: signedUrl, error: signedUrlError } = await bucket.createSignedUrl(
        objectPath,
        SIGNED_URL_TTL_SECONDS
      );
      if (signedUrlError) throwSupabaseError(signedUrlError, 'document URL creation');

      const { data, error } = await supabase
        .from(DOCUMENT_TABLE)
        .insert({
          id: documentId,
          organization_id: organizationId,
          client_id: clientId,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type || 'application/octet-stream',
          storage_path: objectPath,
        })
        .select('id, client_id, file_name, file_size, mime_type, created_at')
        .single();
      if (error) throwSupabaseError(error, 'document metadata save');

      return {
        id: String(data.id),
        clientId: String(data.client_id),
        fileName: String(data.file_name),
        fileSize: Number(data.file_size),
        mimeType: String(data.mime_type),
        storageUrl: signedUrl.signedUrl,
        uploadedAt: String(data.created_at ?? new Date().toISOString()),
      };
    } catch (error) {
      if (objectUploaded) {
        try {
          await removeUploadedObject(bucket, objectPath, documentId);
        } catch (cleanupError) {
          console.error('[CloudDataService] Failed to remove orphaned Storage object.', cleanupError);
          throw cleanupError;
        }
      }
      throw error;
    }
  }

  async searchRecords(query: SearchQuery): Promise<SearchResult<Client>> {
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));
    const offset = Math.max(0, query.offset ?? 0);
    const term = query.term.trim();
    let request = getSupabaseClient()
      .from(CLIENT_TABLE)
      .select(CLIENT_COLUMNS, { count: 'exact' })
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
