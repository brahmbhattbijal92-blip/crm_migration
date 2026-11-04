import 'server-only';

import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard 96-bit IV recommended for GCM to maximize performance
const ENVELOPE_VERSION = 'v2';

const getMasterKey = (): Buffer => {
  const secret = process.env.VAULT_MASTER_KEY;
  if (!secret || !/^[\da-f]{64}$/i.test(secret)) {
    throw new Error('CRITICAL CRYPTO FAILURE: VAULT_MASTER_KEY must be a cryptographically secure 32-byte hex string (64 characters).');
  }
  return Buffer.from(secret, 'hex');
};

export function encryptVaultData(cleartext: string, associatedData: string): string {
  if (!associatedData) throw new Error('Vault encryption requires authenticated record context.');

  const masterKey = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, masterKey, iv);
  cipher.setAAD(Buffer.from(associatedData, 'utf8'));

  let ciphertext = cipher.update(cleartext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');

  const authTag = cipher.getAuthTag();
  return [ENVELOPE_VERSION, iv.toString('hex'), authTag.toString('hex'), ciphertext].join(':');
}

export function decryptVaultData(envelope: string, associatedData?: string): string {
  const masterKey = getMasterKey();
  const parts = envelope.split(':');
  const isContextBoundEnvelope = parts.length === 4 && parts[0] === ENVELOPE_VERSION;
  const [ivHex, tagHex, ciphertextHex] = isContextBoundEnvelope ? parts.slice(1) : parts;

  if (
    (!isContextBoundEnvelope && parts.length !== 3) ||
    !/^[\da-f]{24}$/i.test(ivHex ?? '') ||
    !/^[\da-f]{32}$/i.test(tagHex ?? '') ||
    !/^(?:[\da-f]{2})*$/i.test(ciphertextHex ?? '')
  ) {
    throw new Error('Malformed vault ciphertext envelope.');
  }

  if (isContextBoundEnvelope && !associatedData) {
    throw new Error('Vault ciphertext requires its authenticated record context.');
  }

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, masterKey, Buffer.from(ivHex, 'hex'));
    if (isContextBoundEnvelope) decipher.setAAD(Buffer.from(associatedData!, 'utf8'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));

    let cleartext = decipher.update(ciphertextHex, 'hex', 'utf8');
    cleartext += decipher.final('utf8');
    return cleartext;
  } catch {
    throw new Error('Vault credential authentication failed. The key may be wrong or the stored data may have been modified.');
  }
}

export function vaultCredentialContext(
  clientId: string,
  portalName: string,
  field: 'username' | 'password'
): string {
  return JSON.stringify(['credentials_vault', clientId, portalName, field]);
}
