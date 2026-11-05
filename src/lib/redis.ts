import 'server-only';

import { createHmac, randomUUID } from 'node:crypto';

const CHALLENGE_TTL_SECONDS = 5 * 60;
const REQUEST_COOLDOWN_SECONDS = 30;
const MAX_FAILED_ATTEMPTS = 3;
const FAILURE_WINDOW_SECONDS = 15 * 60;

const verifyAndConsumeScript = `
local failureKey = KEYS[2]
local windowMs = tonumber(ARGV[2])
local maxFailures = tonumber(ARGV[3])
local serverTime = redis.call('TIME')
local now = tonumber(serverTime[1]) * 1000 + math.floor(tonumber(serverTime[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', failureKey, '-inf', now - windowMs)
local failures = redis.call('ZCARD', failureKey)
if failures >= maxFailures then
  return {'blocked', failures}
end

local storedDigest = redis.call('GET', KEYS[1])
if not storedDigest or storedDigest ~= ARGV[1] then
  redis.call('ZADD', failureKey, now, ARGV[4])
  redis.call('PEXPIRE', failureKey, windowMs)
  failures = redis.call('ZCARD', failureKey)
  return {'invalid', failures}
end

redis.call('DEL', KEYS[1])
return {'verified', failures}
`;

interface UpstashResponse {
  result?: unknown;
  error?: string;
}

export type VaultChallengeResult = 'verified' | 'invalid' | 'blocked';

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

  if (!response.ok || payload.error || !('result' in payload)) {
    throw new Error('Vault verification service is unavailable. Try again later.');
  }
  return payload.result as T;
}

function getChallengeSecret(): Buffer {
  const secret = process.env.VAULT_CHALLENGE_SECRET?.trim();
  if (!secret || !/^[\da-fA-F]{64}$/.test(secret)) {
    throw new Error('Vault verification service is not configured.');
  }
  return Buffer.from(secret, 'hex');
}

function getChallengeKey(userId: string, credentialId: string): string {
  return `vault:challenge:${userId}:${credentialId}`;
}

function getFailureKey(userId: string): string {
  return `vault:verification-failures:${userId}`;
}

function getRequestKey(userId: string): string {
  return `vault:request-cooldown:${userId}`;
}

function createCodeDigest(userId: string, credentialId: string, field: 'username' | 'password', code: string): string {
  return createHmac('sha256', getChallengeSecret())
    .update(`${userId}:${credentialId}:${field}:${code}`)
    .digest('hex');
}

export async function reserveVaultCodeRequest(userId: string): Promise<boolean> {
  const result = await redisCommand<string | null>([
    'SET', getRequestKey(userId), '1', 'EX', REQUEST_COOLDOWN_SECONDS, 'NX',
  ]);
  return result === 'OK';
}

export async function saveVaultChallenge(
  userId: string,
  credentialId: string,
  field: 'username' | 'password',
  code: string
): Promise<void> {
  const result = await redisCommand<string>([
    'SET',
    getChallengeKey(userId, credentialId),
    createCodeDigest(userId, credentialId, field, code),
    'EX',
    CHALLENGE_TTL_SECONDS,
  ]);
  if (result !== 'OK') throw new Error('Unable to create a verification challenge.');
}

export async function deleteVaultChallenge(userId: string, credentialId: string): Promise<void> {
  await redisCommand<number>(['DEL', getChallengeKey(userId, credentialId)]);
}

export async function verifyAndConsumeVaultChallenge(
  userId: string,
  credentialId: string,
  field: 'username' | 'password',
  submittedCode: string
): Promise<VaultChallengeResult> {
  const result = await redisCommand<unknown>([
    'EVAL',
    verifyAndConsumeScript,
    2,
    getChallengeKey(userId, credentialId),
    getFailureKey(userId),
    createCodeDigest(userId, credentialId, field, submittedCode),
    FAILURE_WINDOW_SECONDS * 1000,
    MAX_FAILED_ATTEMPTS,
    randomUUID(),
  ]);

  if (!Array.isArray(result) || !['verified', 'invalid', 'blocked'].includes(String(result[0]))) {
    throw new Error('Vault verification service is unavailable. Try again later.');
  }
  return result[0] as VaultChallengeResult;
}