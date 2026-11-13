
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSupabaseClientMock } = vi.hoisted(() => ({
  getSupabaseClientMock: vi.fn(),
}));

vi.mock('../../src/lib/supabase', () => ({
  getSupabaseClient: getSupabaseClientMock,
}));

import { SupabaseDataService } from './StorageContext';

function createQuery(result: { data: unknown; error: null }) {
  const chain = vi.fn(() => query);

  const query: Record<string, unknown> = {
    select: chain,
    in: chain,
    is: chain,
    eq: chain,
    then: (
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  };

  return query;
}

function setupSupabase() {
  const archivedClient = {
    id: 'cloud-client-1',
    status: 'archived',
    archived_at: '2020-01-01T00:00:00.000Z',
  };

  const from = vi.fn((table: string) => {
    if (table === 'clients') {
      return createQuery({ data: [archivedClient], error: null });
    }

    if (table === 'financial_invoices') {
      return createQuery({ data: [], error: null });
    }

    if (table === 'documents') {
      return createQuery({ data: [], error: null });
    }

    throw new Error(`Unexpected Supabase table: ${table}`);
  });

  const rpc = vi.fn().mockResolvedValue({
    data: [],
    error: null,
  });

  const remove = vi.fn().mockResolvedValue({ error: null });

  const storage = {
    from: vi.fn(() => ({ remove })),
  };

  getSupabaseClientMock.mockReturnValue({
    from,
    rpc,
    storage,
  });

  return { from, rpc, remove, storage };
}

describe('SupabaseDataService purge isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reviews Cloud records without accessing Local IndexedDB', async () => {
    const { from } = setupSupabase();

    const indexedDbOpen = vi.fn(() => {
      throw new Error('Cloud purge must not access Local IndexedDB');
    });

    vi.stubGlobal('indexedDB', { open: indexedDbOpen });

    try {
      const service = new SupabaseDataService();
      const review = await service.reviewPurge(['cloud-client-1']);

      expect(review).toEqual({
        blockedInvoices: [],
        attachmentCount: 0,
      });
      expect(from).toHaveBeenCalledTimes(3);
      expect(indexedDbOpen).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('purges Cloud records without invoking Local IndexedDB cleanup', async () => {
    const { rpc, remove } = setupSupabase();

    const indexedDbOpen = vi.fn(() => {
      throw new Error('Cloud purge must not access Local IndexedDB');
    });

    vi.stubGlobal('indexedDB', { open: indexedDbOpen });

    try {
      const service = new SupabaseDataService();

      await expect(
        service.purgeClients(['cloud-client-1']),
      ).resolves.toBeUndefined();

      expect(rpc).toHaveBeenCalledTimes(2);
      expect(rpc).toHaveBeenNthCalledWith(1, 'begin_client_purge', {
        requested_client_ids: ['cloud-client-1'],
      });
      expect(rpc).toHaveBeenNthCalledWith(2, 'finalize_client_purge', {
        requested_client_ids: ['cloud-client-1'],
      });
      expect(remove).not.toHaveBeenCalled();
      expect(indexedDbOpen).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
