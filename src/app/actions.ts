'use server';

import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { executeTenantQuery } from '@/src/lib/db';
import { requireOrganizationContext } from '@/src/lib/supabase/server';
import {
  decryptVaultData,
  encryptVaultData,
  vaultCredentialContext,
} from '@/src/lib/crypto';
type VaultField = 'username' | 'password';

interface VaultOtpChallenge {
  vaultId: string;
  field: VaultField;
  userId: string;
  organizationId: string;
  otpHash: Buffer;
  expiresAt: number;
  attempts: number;
  verifiedUntil?: number;
}

interface VaultCredentialMetadata {
  id: string;
  portalName: string;
  lastVerified: string;
}

const vaultOtpSigningKey = randomBytes(32);
const vaultOtpChallenges = new Map<string, VaultOtpChallenge>();
const vaultOtpLastRequested = new Map<string, number>();
const VAULT_OTP_TTL_MS = 5 * 60 * 1000;
const VAULT_OTP_REVEAL_GRANT_MS = 30 * 1000;
const VAULT_OTP_MAX_ATTEMPTS = 5;
const VAULT_OTP_RESEND_DELAY_MS = 30 * 1000;

function hashVaultOtp(challengeId: string, pin: string): Buffer {
  return createHmac('sha256', vaultOtpSigningKey).update(`${challengeId}:${pin}`).digest();
}

function maskPhoneNumber(phoneNumber: string | undefined): string {
  const digits = phoneNumber?.replace(/\D/g, '') ?? '';
  return digits.length >= 4 ? `••••••${digits.slice(-4)}` : 'configured agent phone';
}

function removeExpiredVaultChallenges(): void {
  const now = Date.now();
  for (const [challengeId, challenge] of vaultOtpChallenges) {
    if (challenge.expiresAt <= now || (challenge.verifiedUntil && challenge.verifiedUntil <= now)) {
      vaultOtpChallenges.delete(challengeId);
    }
  }
  for (const [rateLimitKey, requestedAt] of vaultOtpLastRequested) {
    if (now - requestedAt >= VAULT_OTP_RESEND_DELAY_MS) vaultOtpLastRequested.delete(rateLimitKey);
  }
}

async function getActiveOrganizationId(agentOrAdminOnly = false): Promise<string> {
  const { organizationId } = await requireOrganizationContext({ agentOrAdminOnly });
  return organizationId;
}

/**
 * 1. SELECT - Fetch all active clients for the active tenant organization
 */
export async function getClients() {
  const organizationId = await getActiveOrganizationId();
  return await executeTenantQuery(organizationId, async (client) => {
    // RLS isolates the tenant. The soft-delete condition ensures we don't display deleted files.
    const query = `
      SELECT * FROM clients 
      WHERE organization_id = $1 AND deleted_at IS NULL 
      ORDER BY created_at DESC;
    `;
    const res = await client.query(query, [organizationId]);
    return res.rows;
  });
}

/**
 * 2. INSERT - Onboard a new migration client
 */
export async function createClient(formData: { firstName: string; lastName: string; email: string }) {
  const organizationId = await getActiveOrganizationId(true);
  return await executeTenantQuery(organizationId, async (client) => {
    const query = `
      INSERT INTO clients (organization_id, first_name, last_name, email)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
    `;
    const res = await client.query(query, [
      organizationId,
      formData.firstName,
      formData.lastName,
      formData.email
    ]);
    return res.rows[0];
  });
}

/**
 * 3. UPDATE - Modify details for a specific client record
 */
export async function updateClientStatus(clientId: string, newStatus: string) {
  if (!['active', 'pending', 'completed'].includes(newStatus)) throw new Error('Choose a valid active client status.');
  const organizationId = await getActiveOrganizationId(true);
  return await executeTenantQuery(organizationId, async (client) => {
    const query = `
      UPDATE clients 
      SET status = $1 
      WHERE id = $2 AND organization_id = $3
      RETURNING *;
    `;
    const res = await client.query(query, [newStatus, clientId, organizationId]);
    return res.rows[0];
  });
}

/**
 * 4. DELETE - Soft-delete a client to retain financial or ledger audit trails
 */
export async function softDeleteClient(clientId: string) {
  const organizationId = await getActiveOrganizationId(true);
  return await executeTenantQuery(organizationId, async (client) => {
    // Sets deleted_at to timestamp instead of running an outright hard destructive execution line.
    const query = `
      UPDATE clients 
      SET deleted_at = NOW() 
      WHERE id = $1 AND organization_id = $2
      RETURNING id;
    `;
    const res = await client.query(query, [clientId, organizationId]);
    return res.rows[0];
  });
}



// Append to the bottom of src/app/actions.ts
/**
 * 5. SECURE VAULT INSERT - Encrypt and stash external portal credentials
 */
export async function storeVaultCredential(
  clientId: string,
  portalName: string,
  clearTextUser: string,
  clearTextPass: string
) {
  const normalizedPortalName = portalName.trim();
  if (!clientId.trim() || !normalizedPortalName || !clearTextUser.trim() || !clearTextPass) {
    throw new Error('Client, portal, username, and password are required.');
  }
  if (normalizedPortalName.length > 120 || clearTextUser.length > 320 || clearTextPass.length > 4096) {
    throw new Error('Vault input exceeds the allowed length.');
  }

  const encryptedUser = encryptVaultData(
    clearTextUser,
    vaultCredentialContext(clientId, normalizedPortalName, 'username')
  );
  const encryptedPass = encryptVaultData(
    clearTextPass,
    vaultCredentialContext(clientId, normalizedPortalName, 'password')
  );

  const organizationId = await getActiveOrganizationId(true);
  return await executeTenantQuery(organizationId, async (client) => {
    const query = `
      INSERT INTO credentials_vault (organization_id, client_id, portal_name, encrypted_username, encrypted_password, last_verified)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (organization_id, client_id, portal_name)
      DO UPDATE SET 
        encrypted_username = EXCLUDED.encrypted_username,
        encrypted_password = EXCLUDED.encrypted_password,
        last_verified = NOW()
      RETURNING id, portal_name, last_verified;
    `;
    const res = await client.query(query, [organizationId, clientId, normalizedPortalName, encryptedUser, encryptedPass]);
    const row = res.rows[0];
    if (!row) throw new Error('Vault credential could not be saved.');
    return {
      id: String(row.id),
      portalName: String(row.portal_name),
      lastVerified: row.last_verified instanceof Date
        ? row.last_verified.toISOString()
        : String(row.last_verified ?? ''),
    };
  });
}

export async function getVaultCredentials(clientId: string) {
  if (!clientId.trim()) throw new Error('Client ID is required.');

  const organizationId = await getActiveOrganizationId(true);
  return executeTenantQuery(organizationId, async (client) => {
    const res = await client.query(
      `SELECT id, portal_name, last_verified
       FROM credentials_vault
      WHERE client_id = $1 AND organization_id = $2 AND deleted_at IS NULL
       ORDER BY last_verified DESC NULLS LAST;`,
          [clientId, organizationId]
    );
    return res.rows.map((row): VaultCredentialMetadata => ({
      id: String(row.id),
      portalName: String(row.portal_name),
      lastVerified: row.last_verified instanceof Date
        ? row.last_verified.toISOString()
        : String(row.last_verified ?? ''),
    }));
  });
}

export async function requestVaultOtp(vaultId: string, field: VaultField) {
  if (typeof vaultId !== 'string' || !vaultId.trim()) throw new Error('Vault record is required.');
  if (field !== 'username' && field !== 'password') throw new Error('Invalid credential field.');
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('Vault SMS delivery is not configured. Credential reveal is disabled outside development.');
  }

  removeExpiredVaultChallenges();
  const { organizationId, user } = await requireOrganizationContext({ agentOrAdminOnly: true });
  const rateLimitKey = `${user.id}:${vaultId}:${field}`;
  const now = Date.now();
  const lastRequested = vaultOtpLastRequested.get(rateLimitKey);
  if (lastRequested && now - lastRequested < VAULT_OTP_RESEND_DELAY_MS) {
    throw new Error('A verification code was just requested. Wait 30 seconds before trying again.');
  }

  const recordExists = await executeTenantQuery(organizationId, async (client) => {
    const result = await client.query(
      'SELECT id FROM credentials_vault WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL',
      [vaultId, organizationId]
    );
    return result.rows.length > 0;
  });
  if (!recordExists) throw new Error('Vault record was not found or is not accessible.');

  const challengeId = randomUUID();
  const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const expiresAt = now + VAULT_OTP_TTL_MS;
  vaultOtpChallenges.set(challengeId, {
    vaultId,
    field,
    userId: user.id,
    organizationId,
    otpHash: hashVaultOtp(challengeId, pin),
    expiresAt,
    attempts: 0,
  });
  vaultOtpLastRequested.set(rateLimitKey, now);

  return {
    challengeId,
    destination: maskPhoneNumber(process.env.VAULT_AGENT_PHONE),
    expiresAt,
    simulationMessage: `Development SMS simulation: your six-digit code is ${pin}.`,
  };
}

export async function verifyVaultOtp(challengeId: string, pin: string) {
  const challenge = vaultOtpChallenges.get(challengeId);
  const { organizationId, user } = await requireOrganizationContext({ agentOrAdminOnly: true });
  if (
    !challenge ||
    challenge.userId !== user.id ||
    challenge.organizationId !== organizationId ||
    challenge.expiresAt <= Date.now() ||
    challenge.attempts >= VAULT_OTP_MAX_ATTEMPTS ||
    challenge.verifiedUntil
  ) {
    vaultOtpChallenges.delete(challengeId);
    throw new Error('Verification code is invalid or expired. Request a new code.');
  }

  if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
    challenge.attempts += 1;
    if (challenge.attempts >= VAULT_OTP_MAX_ATTEMPTS) vaultOtpChallenges.delete(challengeId);
    throw new Error('Enter the six-digit verification code.');
  }

  const submittedHash = hashVaultOtp(challengeId, pin);
  if (!timingSafeEqual(challenge.otpHash, submittedHash)) {
    challenge.attempts += 1;
    if (challenge.attempts >= VAULT_OTP_MAX_ATTEMPTS) vaultOtpChallenges.delete(challengeId);
    throw new Error('Verification code is invalid or expired.');
  }

  challenge.verifiedUntil = Date.now() + VAULT_OTP_REVEAL_GRANT_MS;
  return { verified: true, expiresAt: challenge.verifiedUntil };
}

export async function cancelVaultOtp(challengeId: string): Promise<void> {
  const challenge = vaultOtpChallenges.get(challengeId);
  if (!challenge) return;
  const { organizationId, user } = await requireOrganizationContext({ agentOrAdminOnly: true });
  if (challenge.userId !== user.id || challenge.organizationId !== organizationId) {
    throw new Error('Verification challenge is not available to this account.');
  }
  vaultOtpChallenges.delete(challengeId);
}

export async function getDecryptedCredential(
  vaultId: string,
  challengeId: string,
  field: VaultField
): Promise<{ value: string }> {
  const challenge = vaultOtpChallenges.get(challengeId);
  const { organizationId, user } = await requireOrganizationContext({ agentOrAdminOnly: true });
  if (
    !challenge ||
    challenge.vaultId !== vaultId ||
    challenge.field !== field ||
    challenge.userId !== user.id ||
    challenge.organizationId !== organizationId ||
    !challenge.verifiedUntil ||
    challenge.verifiedUntil <= Date.now()
  ) {
    throw new Error('A valid security challenge is required before revealing this credential.');
  }
  vaultOtpChallenges.delete(challengeId);

  const row = await executeTenantQuery(organizationId, async (client) => {
    const res = await client.query(
      `SELECT client_id, portal_name, encrypted_username, encrypted_password
       FROM credentials_vault
      WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL;`,
          [vaultId, organizationId]
    );
    return res.rows[0];
  });

  if (!row) throw new Error("Record not found or access denied by tenant boundary protection.");

  const encryptedValue = field === 'username' ? row.encrypted_username : row.encrypted_password;
  return {
    value: decryptVaultData(
      encryptedValue,
      vaultCredentialContext(row.client_id, row.portal_name, field)
    ),
  };
}
