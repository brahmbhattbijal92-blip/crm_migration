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
    is: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    or: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
    then: resultPromise.then.bind(resultPromise),
  };

  for (const method of [
    query.select,
    query.is,
    query.order,
    query.range,
    query.or,
    query.eq,
    query.maybeSingle,
  ]) {
    method.mockReturnValue(query);
  }

  return query;
}

function mockSupabaseResult(result: SupabaseResult) {
  const query = createQuery(result);
  const from = vi.fn().mockReturnValue(query);
  getSupabaseClientMock.mockReturnValue({ from });
  return { from, query };
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
    expect(query.is).toHaveBeenCalledWith('deleted_at', null);
    expect(query.range).toHaveBeenCalledWith(0, 24);
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
    mockSupabaseResult({ data: null, error: supabaseError, count: null });

    const result = service.searchRecords({ term: 'Ada', limit: 25 });

    await expect(result).rejects.toBeInstanceOf(DataServiceError);
    await expect(result).rejects.toMatchObject({
      message: 'Supabase client search failed: permission denied',
      code: '42501',
      originalError: supabaseError,
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