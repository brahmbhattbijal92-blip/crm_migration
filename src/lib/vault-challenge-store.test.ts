import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  consumeVaultOtpVerificationAttempt,
  createVaultOtpDigest,
  issueVaultOtpChallenge,
  verifyVaultOtpDigest,
} from './vault-challenge-store';

describe('shared vault challenge store', () => {
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

  it('stores challenge state with a five-minute Redis TTL', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ result: 'OK' }),
    });
    const challenge = {
      challengeId: 'challenge-1',
      vaultId: 'vault-1',
      field: 'password' as const,
      userId: 'user-1',
      organizationId: 'org-1',
      otpDigest: createVaultOtpDigest('challenge-1', '123456'),
      expiresAt: Date.now() + 300_000,
    };

    await issueVaultOtpChallenge(challenge.challengeId, challenge);

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const command = JSON.parse(String(request.body)) as Array<string | number>;
    expect(command[0]).toBe('SET');
    expect(command[1]).toBe('crm:vault:v1:challenge:challenge-1');
    expect(command.slice(3)).toEqual(['EX', 300, 'NX']);
    expect(verifyVaultOtpDigest('challenge-1', '123456', challenge.otpDigest)).toBe(true);
    expect(verifyVaultOtpDigest('challenge-1', '654321', challenge.otpDigest)).toBe(false);
  });

  it('enforces the global three-per-15-minute limit atomically in Redis', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ result: [0, 1_800_000_000_000] }),
    });

    const result = await consumeVaultOtpVerificationAttempt('user-1');

    expect(result).toEqual({ allowed: false, resetAt: 1_800_000_000_000 });
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const command = JSON.parse(String(request.body)) as Array<string | number>;
    expect(command[0]).toBe('EVAL');
    expect(command[2]).toBe(1);
    expect(command[3]).toBe('crm:vault:v1:verify:user-1');
    expect(command[4]).toBe(900_000);
    expect(command[5]).toBe(3);
    expect(String(command[1])).toContain("redis.call('TIME')");
    expect(String(command[1])).toContain("redis.call('PEXPIRE', key, windowMs)");
  });
});