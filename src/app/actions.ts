'use server';

import { randomInt } from 'node:crypto';
import { executeTenantQuery } from '@/src/lib/db';
import { requireOrganizationContext } from '@/src/lib/supabase/server';
import {
  deleteVaultChallenge,
  reserveVaultCodeRequest,
  saveVaultChallenge,
  verifyAndConsumeVaultChallenge,
} from '@/src/lib/redis';
import { sendVaultVerificationCode } from '@/src/lib/sms';
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

const VAULT_OTP_TTL_MS = 5 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function maskPhoneNumber(phoneNumber: string | undefined): string {
  const digits = phoneNumber?.replace(/\D/g, '') ?? '';
  return digits.length >= 4 ? `••••••${digits.slice(-4)}` : 'configured agent phone';
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
  const organizationId = await getActiveOrganizationId(true);
  return await executeTenantQuery(organizationId, async (client) => {
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
  const organizationId = await getActiveOrganizationId(true);
  return await executeTenantQuery(organizationId, async (client) => {
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

  const { supabase, organizationId, user } = await requireOrganizationContext({ agentOrAdminOnly: true });
  const encryptedUser = encryptVaultData(
    clearTextUser,
    vaultCredentialContext(clientId, normalizedPortalName, 'username')
  );
  const encryptedPass = encryptVaultData(
    clearTextPass,
    vaultCredentialContext(clientId, normalizedPortalName, 'password')
  );

  const { data, error } = await supabase
    .from('credentials_vault')
    .upsert({
      organization_id: organizationId,
      client_id: clientId,
      portal_name: normalizedPortalName,
      encrypted_username: encryptedUser,
      encrypted_password: encryptedPass,
      last_verified: new Date().toISOString(),
      created_by: user.id,
    }, { onConflict: 'organization_id,client_id,portal_name' })
    .select('id, portal_name, last_verified')
    .single();
  if (error) throw new Error(`Vault credential could not be saved: ${error.message}`);
  if (!data) throw new Error('Vault credential could not be saved.');
  return {
    id: String(data.id),
    portalName: String(data.portal_name),
    lastVerified: String(data.last_verified ?? ''),
  };
}

export async function getVaultCredentials(clientId: string) {
  if (!clientId.trim()) throw new Error('Client ID is required.');

  const { supabase, organizationId } = await requireOrganizationContext({ agentOrAdminOnly: true });
  const { data, error } = await supabase
    .from('credentials_vault')
    .select('id, portal_name, last_verified')
    .eq('client_id', clientId)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('last_verified', { ascending: false, nullsFirst: false });
  if (error) throw new Error(`Vault credentials could not be loaded: ${error.message}`);
  return (data ?? []).map((row): VaultCredentialMetadata => ({
    id: String(row.id),
    portalName: String(row.portal_name),
    lastVerified: String(row.last_verified ?? ''),
  }));
}

export async function requestVaultOtp(vaultId: string, field: VaultField) {
  if (typeof vaultId !== 'string' || !UUID_PATTERN.test(vaultId)) throw new Error('Vault record is required.');
  if (field !== 'username' && field !== 'password') throw new Error('Invalid credential field.');
  const { supabase, organizationId, user } = await requireOrganizationContext({ agentOrAdminOnly: true });
  if (!user.phone || !user.phone_confirmed_at) {
    throw new Error('Add and verify a phone number on your account before revealing credentials.');
  }

  const { data: vaultRecord, error: vaultRecordError } = await supabase
    .from('credentials_vault')
    .select('id')
    .eq('id', vaultId)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle();
  if (vaultRecordError) throw new Error(`Vault record access check failed: ${vaultRecordError.message}`);
  if (!vaultRecord) throw new Error('Vault record was not found or is not accessible.');
  if (!(await reserveVaultCodeRequest(user.id))) {
    throw new Error('A verification code was just requested. Wait 30 seconds before trying again.');
  }

  const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const expiresAt = Date.now() + VAULT_OTP_TTL_MS;
  try {
    await saveVaultChallenge(user.id, vaultId, field, pin);
    await sendVaultVerificationCode(user.phone, pin);
  } catch {
    try {
      await deleteVaultChallenge(user.id, vaultId);
    } catch {
      // The challenge key remains short-lived if Redis is unavailable during cleanup.
    }
    throw new Error('Could not send a verification code. Check your verified phone number or try again later.');
  }

  return {
    destination: maskPhoneNumber(user.phone),
    expiresAt,
  };
}

export async function verifyAndRevealCredential(vaultId: string, field: VaultField, pin: string) {
  const { supabase, organizationId, user } = await requireOrganizationContext({ agentOrAdminOnly: true });
  if (typeof vaultId !== 'string' || !UUID_PATTERN.test(vaultId)) {
    throw new Error('A valid credential is required.');
  }
  if (field !== 'username' && field !== 'password') throw new Error('Invalid credential field.');

  const submittedCode = typeof pin === 'string' && /^\d{6}$/.test(pin) ? pin : 'invalid';
  const result = await verifyAndConsumeVaultChallenge(user.id, vaultId, field, submittedCode);
  if (result === 'blocked') {
    throw new Error('Too many incorrect codes. Please wait 15 minutes before trying again.');
  }
  if (result !== 'verified') {
    throw new Error('The verification code is incorrect or expired. Request a new code.');
  }

  const { data: row, error: rowError } = await supabase
    .from('credentials_vault')
    .select('client_id, portal_name, encrypted_username, encrypted_password')
    .eq('id', vaultId)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle();
  if (rowError) throw new Error(`Credential lookup failed: ${rowError.message}`);
  if (!row) throw new Error('Record not found or access denied by tenant boundary protection.');

  const encryptedValue = field === 'username' ? row.encrypted_username : row.encrypted_password;
  return {
    value: decryptVaultData(
      encryptedValue,
      vaultCredentialContext(row.client_id, row.portal_name, field)
    ),
  };
}

export async function cancelVaultOtp(vaultId: string): Promise<void> {
  const { user } = await requireOrganizationContext({ agentOrAdminOnly: true });
  if (typeof vaultId !== 'string' || !UUID_PATTERN.test(vaultId)) return;
  await deleteVaultChallenge(user.id, vaultId);
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
