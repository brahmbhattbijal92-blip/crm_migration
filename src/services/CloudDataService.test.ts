import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataServiceError } from '../errors/DataErrors';

const { getSupabaseClientMock } = vi.hoisted(() => ({
  getSupabaseClientMock: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  getSupabaseClient: getSupabaseClientMock,
}));

import { CloudDataService } from './CloudDataService';

interface SupabaseResult {
  data: unknown;
  error: { message: string; code?: string } | null;
  count?: number | null;
}

function createQuery(result: SupabaseResult) {
  const resultPromise = Promise.resolve(result);
  const query = {
    select: vi.fn(),
    insert: vi.fn(),
    is: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    or: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
    then: resultPromise.then.bind(resultPromise),
  };

  for (const method of [
    query.select,
    query.insert,
    query.is,
    query.order,
    query.range,
    query.or,
    query.eq,
    query.maybeSingle,
  ]) {
    method.mockReturnValue(query);
  }
  query.single.mockReturnValue(resultPromise);

  return query;
}

function mockSupabaseResult(result: SupabaseResult) {
  const query = createQuery(result);
  const from = vi.fn().mockReturnValue(query);
  getSupabaseClientMock.mockReturnValue({ from });
  return { from, query };
}

function mockSearchSupabaseResult(result: SupabaseResult) {
  const profileQuery = createQuery({
    data: { default_organization_id: 'organization-1' },
    error: null,
  });
  const membershipQuery = createQuery({ data: { role: 'owner' }, error: null });
  const clientQuery = createQuery(result);
  const from = vi.fn((table: string) => {
    if (table === 'profiles') return profileQuery;
    if (table === 'organization_memberships') return membershipQuery;
    return clientQuery;
  });
  getSupabaseClientMock.mockReturnValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
    },
    from,
  });
  return { from, clientQuery };
}

describe('CloudDataService fetch operations', () => {
  const service = new CloudDataService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps client search rows and preserves the exact result count', async () => {
    const { from, query } = mockSupabaseResult({
      data: [{
        id: 'client-1',
        first_name: 'Ada',
        last_name: 'Lovelace',
        email: 'ada@example.com',
        company: 'Analytical Engines',
        updated_at: '2026-01-02T03:04:05.000Z',
      }],
      error: null,
      count: 1,
    });

    await expect(service.searchRecords({ term: '', limit: 25 })).resolves.toEqual({
      items: [{
        id: 'client-1',
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        company: 'Analytical Engines',
        updatedAt: '2026-01-02T03:04:05.000Z',
      }],
      totalCount: 1,
    });
    expect(from).toHaveBeenCalledWith('clients');
    expect(query.select).toHaveBeenCalledWith(
      'id, first_name, last_name, email, company, created_at, updated_at',
      { count: 'exact' }
    );
    expect(query.is).toHaveBeenCalledWith('deleted_at', null);
    expect(query.range).toHaveBeenCalledWith(0, 24);
  });

  it('uploads documents under the tenant/client path and saves metadata to documents', async () => {
    const organizationId = 'c5a1970a-cf77-448a-8e15-88f0d7b6a355';
    const clientId = '9ba6bd8b-f238-4efb-9200-7405eebfd6c7';
    const profileQuery = createQuery({
      data: { default_organization_id: organizationId },
      error: null,
    });
    const documentQuery = createQuery({
      data: {
        id: 'document-1',
        client_id: clientId,
        file_name: 'passport.pdf',
        file_size: 10,
        mime_type: 'application/pdf',
        created_at: '2026-11-05T12:00:00.000Z',
      },
      error: null,
    });
    const upload = vi.fn().mockResolvedValue({ error: null });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: 'https://storage.example/signed' },
      error: null,
    });
    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
      },
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      from: vi.fn((table: string) => table === 'profiles' ? profileQuery : documentQuery),
      storage: { from: vi.fn(() => ({ upload, createSignedUrl, remove })) },
    };
    getSupabaseClientMock.mockReturnValue(supabase);

    const result = await service.uploadDocument(
      clientId,
      { name: 'passport.pdf', type: 'application/pdf', size: 10 } as File
    );

    const [objectPath] = upload.mock.calls[0] as [string];
    const insertedMetadata = documentQuery.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(objectPath).toBe(`${organizationId}/${clientId}/${insertedMetadata.id}`);
    expect(supabase.rpc).toHaveBeenCalledWith('assert_client_document_uploadable', {
      requested_client_id: clientId,
    });
    expect(supabase.rpc.mock.invocationCallOrder[0]).toBeLessThan(upload.mock.invocationCallOrder[0]);
    expect(supabase.from).toHaveBeenCalledWith('documents');
    expect(documentQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      id: insertedMetadata.id,
      organization_id: organizationId,
      client_id: clientId,
      storage_path: objectPath,
    }));
    expect(result).toMatchObject({
      id: 'document-1',
      clientId,
      uploadedAt: '2026-11-05T12:00:00.000Z',
    });
  });

  it('rejects a locked client before uploading any bytes', async () => {
    const organizationId = 'c5a1970a-cf77-448a-8e15-88f0d7b6a355';
    const profileQuery = createQuery({
      data: { default_organization_id: organizationId },
      error: null,
    });
    const upload = vi.fn();
    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
      },
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: '55000', message: 'Client is locked.' },
      }),
      from: vi.fn().mockReturnValue(profileQuery),
      storage: { from: vi.fn(() => ({ upload })) },
    };
    getSupabaseClientMock.mockReturnValue(supabase);

    await expect(service.uploadDocument(
      '9ba6bd8b-f238-4efb-9200-7405eebfd6c7',
      { name: 'passport.pdf', type: 'application/pdf', size: 10 } as File
    )).rejects.toMatchObject({
      code: 'DOCUMENT_CLIENT_LOCKED',
      message: 'This client is archived, deleted, or locked for purge and cannot accept documents.',
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it('retries object deletion when metadata creation fails', async () => {
    const organizationId = 'c5a1970a-cf77-448a-8e15-88f0d7b6a355';
    const clientId = '9ba6bd8b-f238-4efb-9200-7405eebfd6c7';
    const profileQuery = createQuery({
      data: { default_organization_id: organizationId },
      error: null,
    });
    const documentQuery = createQuery({
      data: null,
      error: { code: '42501', message: 'metadata insert failed' },
    });
    const upload = vi.fn().mockResolvedValue({ error: null });
    const remove = vi.fn()
      .mockResolvedValueOnce({ error: { message: 'temporary storage error' } })
      .mockResolvedValue({ error: null });
    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
      },
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      from: vi.fn((table: string) => table === 'profiles' ? profileQuery : documentQuery),
      storage: { from: vi.fn(() => ({
        upload,
        createSignedUrl: vi.fn().mockResolvedValue({
          data: { signedUrl: 'https://storage.example/signed' },
          error: null,
        }),
        remove,
      })) },
    };
    getSupabaseClientMock.mockReturnValue(supabase);

    await expect(service.uploadDocument(
      clientId,
      { name: 'passport.pdf', type: 'application/pdf', size: 10 } as File
    )).rejects.toMatchObject({
      code: '42501',
      message: 'Supabase document metadata save failed: metadata insert failed',
    });

    const [objectPath] = upload.mock.calls[0] as [string];
    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenNthCalledWith(1, [objectPath]);
    expect(remove).toHaveBeenNthCalledWith(2, [objectPath]);
  });

  it('returns an empty result when the search has no rows or count', async () => {
    mockSupabaseResult({ data: null, error: null, count: null });

    await expect(service.searchRecords({ term: '', limit: 25 })).resolves.toEqual({
      items: [],
      totalCount: 0,
    });
  });

  it('returns null when a client lookup finds no row', async () => {
    const { query } = mockSupabaseResult({ data: null, error: null });

    await expect(service.findClient('missing-client')).resolves.toBeNull();
    expect(query.eq).toHaveBeenCalledWith('id', 'missing-client');
    expect(query.maybeSingle).toHaveBeenCalledOnce();
  });

  it('converts search failures to DataServiceError with the Supabase error attached', async () => {
    const supabaseError = { message: 'permission denied', code: '42501' };
    mockSearchSupabaseResult({ data: null, error: supabaseError, count: null });

    const result = service.searchRecords({ term: 'Ada', limit: 25 });

    await expect(result).rejects.toBeInstanceOf(DataServiceError);
    await expect(result).rejects.toMatchObject({
      message: 'Supabase client search failed: permission denied',
      code: '42501',
      originalError: supabaseError,
    });
  });

  it('reports when the client assignment migration is missing', async () => {
    mockSupabaseResult({
      data: null,
      error: { code: '42703', message: 'column clients.assigned_agent_id does not exist' },
    });

    await expect(service.searchRecords({ term: '', limit: 25 })).rejects.toMatchObject({
      code: 'CLIENT_ASSIGNMENT_MIGRATION_REQUIRED',
      message: expect.stringContaining('20261110030000_client_agent_assignment.sql'),
    });
  });

  it('converts lookup failures to DataServiceError', async () => {
    mockSupabaseResult({
      data: null,
      error: { message: 'network unavailable' },
    });

    await expect(service.findClient('client-1')).rejects.toMatchObject({
      name: 'DataServiceError',
      message: 'Supabase client lookup failed: network unavailable',
      code: 'SUPABASE_OPERATION_FAILED',
    });
  });
});