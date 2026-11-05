import { describe, expect, it, vi } from 'vitest';
import { DataServiceError } from '../errors/DataErrors';
import { DataService } from './DataService';
import { DataServiceFallbackWrapper } from './DataServiceFallbackWrapper';

describe('DataServiceFallbackWrapper storage isolation', () => {
  const client = { id: 'client-1', name: 'Ada Lovelace', email: 'ada@example.com' };

  it('does not redirect a failed Cloud operation into Local storage', async () => {
    const cloud = { saveClient: vi.fn().mockRejectedValue(
      new DataServiceError('permission denied', '42501')
    ) } as unknown as DataService;
    const local = { saveClient: vi.fn() } as unknown as DataService;
    const service = new DataServiceFallbackWrapper(cloud, local, () => 'cloud');

    await expect(service.saveClient(client)).rejects.toMatchObject({ code: '42501' });
    expect(local.saveClient).not.toHaveBeenCalled();
  });

  it('uses Local storage only when Local is the selected domain', async () => {
    const cloud = { saveClient: vi.fn() } as unknown as DataService;
    const local = { saveClient: vi.fn().mockResolvedValue({ ...client, updatedAt: 'now' }) } as unknown as DataService;
    const service = new DataServiceFallbackWrapper(cloud, local, () => 'local');

    await expect(service.saveClient(client)).resolves.toMatchObject({ id: 'client-1' });
    expect(cloud.saveClient).not.toHaveBeenCalled();
    expect(local.saveClient).toHaveBeenCalledOnce();
  });
});