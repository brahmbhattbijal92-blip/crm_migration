import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  reserveVaultCodeRequest,
  saveVaultChallenge,
  verifyAndConsumeVaultChallenge,
} from './redis';

describe('vault Redis challenge operations', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example.test');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');
    vi.stubEnv('VAULT_CHALLENGE_SECRET', 'a'.repeat(64));
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('stores only an HMAC digest at the required key with a five-minute TTL', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ result: 'OK' }) });

    await saveVaultChallenge('user-1', 'credential-1', 'password', '123456');

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const command = JSON.parse(String(request.body)) as Array<string | number>;
    expect(command[0]).toBe('SET');
    expect(command[1]).toBe('vault:challenge:user-1:credential-1');
    expect(command[2]).not.toBe('123456');
    expect(command.slice(3)).toEqual(['EX', 300]);
  });

  it('reserves an SMS resend cooldown in shared Redis', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ result: 'OK' }) });

    await expect(reserveVaultCodeRequest('user-1')).resolves.toBe(true);
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual([
      'SET', 'vault:request-cooldown:user-1', '1', 'EX', 30, 'NX',
    ]);
  });

  it('checks the global failure bucket first and atomically increments failed entries', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ result: ['invalid', 3] }) });

    await expect(verifyAndConsumeVaultChallenge('user-1', 'credential-1', 'password', '111111'))
      .resolves.toBe('invalid');

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const command = JSON.parse(String(request.body)) as Array<string | number>;
    expect(command.slice(0, 4)).toMatchObject([
      'EVAL', expect.any(String), 2, 'vault:challenge:user-1:credential-1',
    ]);
    expect(command[4]).toBe('vault:verification-failures:user-1');
    expect(command[6]).toBe(900_000);
    expect(command[7]).toBe(3);
    const script = String(command[1]);
    expect(script.indexOf("redis.call('ZCARD', failureKey)")).toBeLessThan(script.indexOf("redis.call('GET', KEYS[1])"));
    expect(script).toContain("redis.call('TIME')");
    expect(script).toContain("redis.call('ZADD', failureKey, now, ARGV[4])");
    expect(script).toContain("redis.call('PEXPIRE', failureKey, windowMs)");
    expect(script).toContain("redis.call('DEL', KEYS[1])");
  });

  it('blocks verification immediately when the global failure count is exhausted', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ result: ['blocked', 3] }) });

    await expect(verifyAndConsumeVaultChallenge('user-1', 'credential-1', 'password', '123456'))
      .resolves.toBe('blocked');
  });
});