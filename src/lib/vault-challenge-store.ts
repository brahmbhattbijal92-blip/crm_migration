import 'server-only';

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export type VaultOtpField = 'username' | 'password';

export interface VaultOtpChallenge {
  challengeId: string;
  vaultId: string;
  field: VaultOtpField;
  userId: string;
  organizationId: string;
  otpDigest: string;
  expiresAt: number;
}

export interface VaultOtpVerifiedGrant {
  challengeId: string;
  vaultId: string;
  field: VaultOtpField;
  userId: string;
  organizationId: string;
  verifiedUntil: number;
}

const CHALLENGE_TTL_SECONDS = 5 * 60;
const VERIFIED_GRANT_TTL_SECONDS = 30;
const RESEND_COOLDOWN_SECONDS = 30;
const VERIFICATION_WINDOW_MS = 15 * 60 * 1000;
const MAX_VERIFICATION_ATTEMPTS = 3;
const KEY_PREFIX = 'crm:vault:v1';

const slidingWindowScript = `
local key = KEYS[1]
local windowMs = tonumber(ARGV[1])
local maxAttempts = tonumber(ARGV[2])
local member = ARGV[3]
local serverTime = redis.call('TIME')
local now = tonumber(serverTime[1]) * 1000 + math.floor(tonumber(serverTime[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - windowMs)
local count = redis.call('ZCARD', key)
if count >= maxAttempts then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  return {0, tonumber(oldest[2]) + windowMs}
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, windowMs)
return {1, now + windowMs}
`;

interface UpstashResponse {
  result?: unknown;
  error?: string;
}

function getRedisConfig(): { url: string; token: string } {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) throw new Error('Vault verification service is not configured.');

  try {
    if (new URL(url).protocol !== 'https:') throw new Error();
  } catch {
    throw new Error('Vault verification service is not configured.');
  }

  return { url, token };
}

async function redisCommand<T>(command: Array<string | number>): Promise<T> {
  const { url, token } = getRedisConfig();
  let response: Response;
  let payload: UpstashResponse;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    payload = await response.json() as UpstashResponse;
  } catch {
    throw new Error('Vault verification service is unavailable. Try again later.');
  }

  if (!response.ok || payload.error) {
    throw new Error('Vault verification service is unavailable. Try again later.');
  }
  if (payload.result === undefined) {
    throw new Error('Vault verification service is unavailable. Try again later.');
  }
  return payload.result as T;
}

function getSigningKey(): Buffer {
  const configuredKey = process.env.VAULT_CHALLENGE_SECRET?.trim();
  if (!configuredKey || !/^[\da-fA-F]{64}$/.test(configuredKey)) {
    throw new Error('Vault verification service is not configured.');
  }
  return Buffer.from(configuredKey, 'hex');
}

function challengeKey(challengeId: string): string {
  return `${KEY_PREFIX}:challenge:${challengeId}`;
}

function grantKey(challengeId: string): string {
  return `${KEY_PREFIX}:grant:${challengeId}`;
}

function parseRecord<T>(value: unknown): T | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as T : null;
  } catch {
    return null;
  }
}

export function createVaultOtpDigest(challengeId: string, pin: string): string {
  return createHmac('sha256', getSigningKey()).update(`${challengeId}:${pin}`).digest('hex');
}

export function verifyVaultOtpDigest(challengeId: string, pin: string, expectedDigest: string): boolean {
  if (!/^\d{6}$/.test(pin) || !/^[\da-fA-F]{64}$/.test(expectedDigest)) return false;
  const submittedDigest = Buffer.from(createVaultOtpDigest(challengeId, pin), 'hex');
  const storedDigest = Buffer.from(expectedDigest, 'hex');
  return timingSafeEqual(submittedDigest, storedDigest);
}

export async function reserveVaultOtpRequest(userId: string): Promise<boolean> {
  const result = await redisCommand<string | null>([
    'SET', `${KEY_PREFIX}:request:${userId}`, '1', 'EX', RESEND_COOLDOWN_SECONDS, 'NX',
  ]);
  return result === 'OK';
}

export async function issueVaultOtpChallenge(
  challengeId: string,
  challenge: VaultOtpChallenge
): Promise<void> {
  const result = await redisCommand<string | null>([
    'SET', challengeKey(challengeId), JSON.stringify(challenge), 'EX', CHALLENGE_TTL_SECONDS, 'NX',
  ]);
  if (result !== 'OK') throw new Error('Unable to create a verification challenge. Try again.');
}

export async function readVaultOtpChallenge(challengeId: string): Promise<VaultOtpChallenge | null> {
  const value = await redisCommand<unknown>(['GET', challengeKey(challengeId)]);
  return parseRecord<VaultOtpChallenge>(value);
}

export async function consumeVaultOtpChallenge(challengeId: string): Promise<VaultOtpChallenge | null> {
  const value = await redisCommand<unknown>(['GETDEL', challengeKey(challengeId)]);
  return parseRecord<VaultOtpChallenge>(value);
}

export async function consumeVaultOtpVerificationAttempt(userId: string): Promise<{
  allowed: boolean;
  resetAt: number;
}> {
  const result = await redisCommand<unknown>([
    'EVAL',
    slidingWindowScript,
    1,
    `${KEY_PREFIX}:verify:${userId}`,
    VERIFICATION_WINDOW_MS,
    MAX_VERIFICATION_ATTEMPTS,
    randomUUID(),
  ]);

  if (!Array.isArray(result) || result.length !== 2) {
    throw new Error('Vault verification service is unavailable. Try again later.');
  }
  return { allowed: Number(result[0]) === 1, resetAt: Number(result[1]) };
}

export async function saveVaultOtpVerifiedGrant(
  challengeId: string,
  grant: VaultOtpVerifiedGrant
): Promise<void> {
  const result = await redisCommand<string | null>([
    'SET', grantKey(challengeId), JSON.stringify(grant), 'EX', VERIFIED_GRANT_TTL_SECONDS, 'NX',
  ]);
  if (result !== 'OK') throw new Error('Unable to complete verification. Request a new code.');
}

export async function readVaultOtpVerifiedGrant(challengeId: string): Promise<VaultOtpVerifiedGrant | null> {
  const value = await redisCommand<unknown>(['GET', grantKey(challengeId)]);
  return parseRecord<VaultOtpVerifiedGrant>(value);
}

export async function consumeVaultOtpVerifiedGrant(challengeId: string): Promise<VaultOtpVerifiedGrant | null> {
  const value = await redisCommand<unknown>(['GETDEL', grantKey(challengeId)]);
  return parseRecord<VaultOtpVerifiedGrant>(value);
}

export async function deleteVaultOtpState(challengeId: string): Promise<void> {
  await redisCommand<number>(['DEL', challengeKey(challengeId), grantKey(challengeId)]);
}