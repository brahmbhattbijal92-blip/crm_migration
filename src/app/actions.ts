'use server';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { executeTenantQuery } from '@/src/lib/db';
import { getSupabasePublicConfig } from '@/src/lib/supabase/config';
import { requireOrganizationContext } from '@/src/lib/supabase/server';
import {
  decryptVaultData,
  encryptVaultData,
  vaultCredentialContext,
} from '@/src/lib/crypto';
type VaultField = 'username' | 'password';

interface VaultCredentialMetadata {
  id: string;
  portalName: string;
  lastVerified: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createVaultEmailAuthClient() {
  const config = getSupabasePublicConfig();
  if (!config) throw new Error('Supabase authentication is not configured.');

  return createSupabaseClient(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

function maskEmail(email: string): string {
  const separator = email.lastIndexOf('@');
  if (separator <= 0 || separator === email.length - 1) return 'your account email';
  return `${email.slice(0, 1)}***${email.slice(separator)}`;
}

async function getActiveOrganizationContext(agentOrAdminOnly = false): Promise<{ organizationId: string; userId: string }> {
  const { organizationId, user } = await requireOrganizationContext({ agentOrAdminOnly });
  return { organizationId, userId: user.id };
}

/**
 * 1. SELECT - Fetch all active clients for the active tenant organization
 */
export async function getClients() {
  const { organizationId, userId } = await getActiveOrganizationContext();
  return await executeTenantQuery(organizationId, userId, async (client) => {
    // RLS isolates the tenant. The soft-delete condition ensures we don't display deleted files.
    const query = `
      SELECT id, first_name, last_name, email, company, status, created_at,
             last_interaction_at, updated_at, passport_expires_at, visa_subclass, visa_expires_at
      FROM clients
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
  const { organizationId, userId } = await getActiveOrganizationContext(true);
  return await executeTenantQuery(organizationId, userId, async (client) => {
    const query = `
      INSERT INTO clients (organization_id, first_name, last_name, email)
      VALUES ($1, $2, $3, $4)
      RETURNING id, first_name, last_name, email, company, status, created_at,
            last_interaction_at, updated_at, passport_expires_at, visa_subclass, visa_expires_at;
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
  const { organizationId, userId } = await getActiveOrganizationContext(true);
  return await executeTenantQuery(organizationId, userId, async (client) => {
    const query = `
      UPDATE clients 
      SET status = $1 
      WHERE id = $2 AND organization_id = $3
      RETURNING id, status, updated_at;
    `;
    const res = await client.query(query, [newStatus, clientId, organizationId]);
    return res.rows[0];
  });
}

/**
 * 4. DELETE - Soft-delete a client to retain financial or ledger audit trails
 */
export async function softDeleteClient(clientId: string) {
  const { organizationId, userId } = await getActiveOrganizationContext(true);
  return await executeTenantQuery(organizationId, userId, async (client) => {
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

  const { organizationId, userId } = await getActiveOrganizationContext(true);
  const encryptedUser = encryptVaultData(
    clearTextUser,
    vaultCredentialContext(clientId, normalizedPortalName, 'username')
  );
  const encryptedPass = encryptVaultData(
    clearTextPass,
    vaultCredentialContext(clientId, normalizedPortalName, 'password')
  );

  return executeTenantQuery(organizationId, userId, async (client) => {
    const result = await client.query(
      `INSERT INTO credentials_vault (
         organization_id, client_id, portal_name, encrypted_username, encrypted_password, last_verified
       )
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (organization_id, client_id, portal_name)
       DO UPDATE SET
         encrypted_username = EXCLUDED.encrypted_username,
         encrypted_password = EXCLUDED.encrypted_password,
         last_verified = NOW()
       RETURNING id, portal_name, last_verified`,
      [organizationId, clientId, normalizedPortalName, encryptedUser, encryptedPass]
    );
    const row = result.rows[0];
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

  const { organizationId, userId } = await getActiveOrganizationContext(true);
  return executeTenantQuery(organizationId, userId, async (client) => {
    const result = await client.query(
      `SELECT id, portal_name, last_verified
       FROM credentials_vault
       WHERE client_id = $1 AND organization_id = $2 AND deleted_at IS NULL
       ORDER BY last_verified DESC NULLS LAST`,
      [clientId, organizationId]
    );
    return result.rows.map((row): VaultCredentialMetadata => ({
      id: String(row.id),
      portalName: String(row.portal_name),
      lastVerified: row.last_verified instanceof Date
        ? row.last_verified.toISOString()
        : String(row.last_verified ?? ''),
    }));
  });
}

export async function requestVaultOtp(vaultId: string, field: VaultField) {
  if (typeof vaultId !== 'string' || !UUID_PATTERN.test(vaultId)) throw new Error('Vault record is required.');
  if (field !== 'username' && field !== 'password') throw new Error('Invalid credential field.');
  const { organizationId, user } = await requireOrganizationContext({ agentOrAdminOnly: true });
  if (!user.email) throw new Error('This account has no email address for verification.');

  const recordExists = await executeTenantQuery(organizationId, user.id, async (client) => {
    const result = await client.query(
      'SELECT id FROM credentials_vault WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL',
      [vaultId, organizationId]
    );
    return result.rows.length > 0;
  });
  if (!recordExists) throw new Error('Vault record was not found or is not accessible.');

  const { error } = await createVaultEmailAuthClient().auth.signInWithOtp({
    email: user.email,
    options: { shouldCreateUser: false },
  });
  if (error) {
    throw new Error('Could not email a verification code. Check Supabase Auth email settings or wait before requesting another code.');
  }

  return { destination: maskEmail(user.email) };
}

export async function verifyAndRevealCredential(vaultId: string, field: VaultField, pin: string) {
  const { organizationId, user } = await requireOrganizationContext({ agentOrAdminOnly: true });
  if (typeof vaultId !== 'string' || !UUID_PATTERN.test(vaultId)) {
    throw new Error('A valid credential is required.');
  }
  if (field !== 'username' && field !== 'password') throw new Error('Invalid credential field.');
  if (!user.email) throw new Error('This account has no email address for verification.');

  const submittedCode = typeof pin === 'string' && /^\d{6}$/.test(pin) ? pin : '';
  if (!submittedCode) throw new Error('Enter the six-digit email verification code.');

  const { data: verification, error: verificationError } = await createVaultEmailAuthClient().auth.verifyOtp({
    email: user.email,
    token: submittedCode,
    type: 'email',
  });
  if (verificationError || verification.user?.id !== user.id) {
    throw new Error('The email code is incorrect or expired. Request a new code.');
  }

  const row = await executeTenantQuery(organizationId, user.id, async (client) => {
    const result = await client.query(
      `SELECT client_id, portal_name, encrypted_username, encrypted_password
       FROM credentials_vault
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [vaultId, organizationId]
    );
    return result.rows[0];
  });
  if (!row) throw new Error('Record not found or access denied by tenant boundary protection.');

  const encryptedValue = field === 'username' ? row.encrypted_username : row.encrypted_password;
  return {
    value: decryptVaultData(
      encryptedValue,
      vaultCredentialContext(row.client_id, row.portal_name, field)
    ),
  };
}

export async function voidInvoice(invoiceId: string, reason: string) {
  if (typeof invoiceId !== 'string' || !UUID_PATTERN.test(invoiceId)) {
    throw new Error('A valid invoice is required.');
  }
  if (typeof reason !== 'string') throw new Error('Enter a void reason of 1 to 500 characters.');
  const normalizedReason = reason.trim();
  if (!normalizedReason || normalizedReason.length > 500) {
    throw new Error('Enter a void reason of 1 to 500 characters.');
  }

  const { supabase } = await requireOrganizationContext({ adminOnly: true });
  const { data, error } = await supabase.rpc('void_invoice', {
    requested_invoice_id: invoiceId,
    requested_reason: normalizedReason,
  });
  if (error) throw new Error(error.message || 'Invoice void failed.');
  return data;
}

export async function reverseInvoicePayment(paymentId: string, reason: string) {
  if (typeof paymentId !== 'string' || !UUID_PATTERN.test(paymentId)) {
    throw new Error('A valid payment is required.');
  }
  if (typeof reason !== 'string') throw new Error('Enter a reversal reason of 1 to 500 characters.');
  const normalizedReason = reason.trim();
  if (!normalizedReason || normalizedReason.length > 500) {
    throw new Error('Enter a reversal reason of 1 to 500 characters.');
  }

  const { supabase } = await requireOrganizationContext({ adminOnly: true });
  const { data, error } = await supabase.rpc('reverse_invoice_payment', {
    requested_payment_id: paymentId,
    requested_reason: normalizedReason,
  });
  if (error) throw new Error(error.message || 'Payment reversal failed.');
  return data;
}
