'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  getVaultCredentials,
  requestVaultOtp,
  storeVaultCredential,
  verifyAndRevealCredential,
} from '../app/actions';

interface CredentialVaultProps {
  clientId: string;
  clientName: string;
}

interface VaultRecord {
  id: string;
  portalName: string;
  lastVerified: string;
}

type VisibleField = 'username' | 'password';

const VAULT_EMAIL_OTP_LENGTH = 8;
const VAULT_EMAIL_OTP_RESEND_COOLDOWN_MS = 60_000;

interface PendingChallenge {
  vaultId: string;
  field: VisibleField;
  portalName: string;
  destination?: string;
}

interface VerifiedCredentialPair {
  username: string;
  password: string;
  expiresAt: number;
}

function EyeIcon({ visible }: { visible: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {visible && <path d="m3 3 18 18" />}
    </svg>
  );
}

export default function CredentialVault({ clientId, clientName }: CredentialVaultProps) {
  const [portalName, setPortalName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [records, setRecords] = useState<VaultRecord[]>([]);
  const [revealedValues, setRevealedValues] = useState<Record<string, string>>({});
  const [verifiedCredentialPairs, setVerifiedCredentialPairs] = useState<Record<string, VerifiedCredentialPair>>({});
  const [challenge, setChallenge] = useState<PendingChallenge | null>(null);
  const [pin, setPin] = useState('');
  const [otpRequestAvailableAt, setOtpRequestAvailableAt] = useState(0);
  const [resendInSeconds, setResendInSeconds] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const verifiedCredentialTimers = useRef(new Map<string, number>());
  const challengeOperation = useRef(0);

  useEffect(() => {
    let isCurrent = true;
    getVaultCredentials(clientId)
      .then((vaultRecords) => {
        if (isCurrent) setRecords(vaultRecords);
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setErrorMessage(error instanceof Error ? error.message : 'Unable to load saved credentials.');
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [clientId]);

  useEffect(() => () => {
    verifiedCredentialTimers.current.forEach((timer) => window.clearTimeout(timer));
    verifiedCredentialTimers.current.clear();
  }, []);

  useEffect(() => {
    if (!otpRequestAvailableAt) {
      setResendInSeconds(0);
      return;
    }

    let timer: number | undefined;
    const updateCountdown = () => {
      const remaining = Math.max(0, Math.ceil((otpRequestAvailableAt - Date.now()) / 1000));
      setResendInSeconds(remaining);
      if (remaining === 0 && timer !== undefined) window.clearInterval(timer);
    };
    updateCountdown();
    if (otpRequestAvailableAt <= Date.now()) return;
    timer = window.setInterval(updateCountdown, 1000);
    return () => {
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [otpRequestAvailableAt]);

  function showOtpRequestError(error: unknown, fallback: string) {
    const message = error instanceof Error ? error.message : fallback;
    if (message.includes('wait 60 seconds')) {
      setOtpRequestAvailableAt(Date.now() + VAULT_EMAIL_OTP_RESEND_COOLDOWN_MS);
    }
    setErrorMessage(message);
  }

  function clearRevealedValue(key: string) {
    setRevealedValues((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function clearVerifiedCredentialPair(vaultId: string) {
    const timer = verifiedCredentialTimers.current.get(vaultId);
    if (timer !== undefined) window.clearTimeout(timer);
    verifiedCredentialTimers.current.delete(vaultId);
    setVerifiedCredentialPairs((current) => {
      const next = { ...current };
      delete next[vaultId];
      return next;
    });
    setRevealedValues((current) => {
      const next = { ...current };
      delete next[`${vaultId}:username`];
      delete next[`${vaultId}:password`];
      return next;
    });
  }

  async function handleVaultSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!portalName || !username || !password) return;

    try {
      setIsProcessing(true);
      setErrorMessage('');
      const savedRecord = await storeVaultCredential(clientId, portalName, username, password);
      setRecords((current) => [savedRecord, ...current.filter((record) => record.id !== savedRecord.id)]);
      clearVerifiedCredentialPair(savedRecord.id);
      clearRevealedValue(`${savedRecord.id}:username`);
      clearRevealedValue(`${savedRecord.id}:password`);
      setPortalName('');
      setUsername('');
      setPassword('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to save this credential.');
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleToggleVisibility(record: VaultRecord, field: VisibleField) {
    const key = `${record.id}:${field}`;
    if (revealedValues[key]) {
      clearRevealedValue(key);
      return;
    }
    const verifiedPair = verifiedCredentialPairs[record.id];
    if (verifiedPair && verifiedPair.expiresAt > Date.now()) {
      setRevealedValues((current) => ({ ...current, [key]: verifiedPair[field] }));
      return;
    }
    if (verifiedPair) clearVerifiedCredentialPair(record.id);
    if (resendInSeconds > 0) {
      setErrorMessage(`Please wait ${resendInSeconds} seconds before requesting another code.`);
      return;
    }

    const operationId = ++challengeOperation.current;
    try {
      setIsProcessing(true);
      setErrorMessage('');
      setPin('');
      setChallenge({ vaultId: record.id, field, portalName: record.portalName });
      const issuedChallenge = await requestVaultOtp(record.id, field);
      setOtpRequestAvailableAt(issuedChallenge.resendAvailableAt);
      if (challengeOperation.current !== operationId) return;
      setChallenge({
        vaultId: record.id,
        field,
        portalName: record.portalName,
        destination: issuedChallenge.destination,
      });
    } catch (error) {
      if (challengeOperation.current !== operationId) return;
      setChallenge(null);
      showOtpRequestError(error, 'Credential verification failed.');
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleResendChallenge() {
    if (!challenge || isProcessing || resendInSeconds > 0) return;

    const operationId = ++challengeOperation.current;
    try {
      setIsProcessing(true);
      setErrorMessage('');
      setPin('');
      const issuedChallenge = await requestVaultOtp(challenge.vaultId, challenge.field);
      setOtpRequestAvailableAt(issuedChallenge.resendAvailableAt);
      if (challengeOperation.current !== operationId) return;
      setChallenge((current) => current && current.vaultId === challenge.vaultId && current.field === challenge.field
        ? { ...current, destination: issuedChallenge.destination }
        : current);
    } catch (error) {
      if (challengeOperation.current !== operationId) return;
      showOtpRequestError(error, 'Could not resend the verification code.');
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleConfirmChallenge(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge?.destination || pin.length !== VAULT_EMAIL_OTP_LENGTH) return;

    const operationId = ++challengeOperation.current;
    try {
      setIsProcessing(true);
      setErrorMessage('');
      const result = await verifyAndRevealCredential(
        challenge.vaultId,
        challenge.field,
        pin
      );
      if (challengeOperation.current !== operationId) return;
      const key = `${challenge.vaultId}:${challenge.field}`;
      clearVerifiedCredentialPair(challenge.vaultId);
      setVerifiedCredentialPairs((current) => ({
        ...current,
        [challenge.vaultId]: {
          username: result.username,
          password: result.password,
          expiresAt: Date.now() + 30_000,
        },
      }));
      setRevealedValues((current) => ({ ...current, [key]: result[challenge.field] }));
      const timer = window.setTimeout(() => clearVerifiedCredentialPair(challenge.vaultId), 30_000);
      verifiedCredentialTimers.current.set(challenge.vaultId, timer);
      setChallenge(null);
      setPin('');
    } catch (error) {
      if (challengeOperation.current !== operationId) return;
      setErrorMessage(error instanceof Error ? error.message : 'Verification failed.');
      setPin('');
    } finally {
      setIsProcessing(false);
    }
  }

  function getPortalUrl(portalName: string): string | null {
    try {
      const url = new URL(portalName);
      const credentialParameter = /^(?:user(?:name)?|email|pass(?:word)?|token|access_token|secret|otp|code)$/i;
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        [...url.searchParams.keys()].some((parameter) => credentialParameter.test(parameter))
      ) return null;
      return url.href;
    } catch {
      return null;
    }
  }

  return (
    <div className="mt-4 p-5 bg-zinc-900/60 border border-zinc-800 rounded-xl space-y-4">
      <div className="flex justify-between items-center">
        <h4 className="text-sm font-semibold text-zinc-300">
          Security Vault Access Layer for: <span className="text-emerald-400">{clientName}</span>
        </h4>
        <span className="text-[10px] bg-zinc-800 text-zinc-400 border border-zinc-700 px-2 py-0.5 rounded font-mono uppercase">
          AES-256-GCM Layer
        </span>
      </div>

      <form onSubmit={handleVaultSubmit} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
        <div>
          <label className="block text-[11px] text-zinc-500 mb-1">Portal URL / Application</label>
          <input
            type="text"
            value={portalName}
            onChange={(e) => setPortalName(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500"
            placeholder="https://portal.example.com"
          />
        </div>
        <div>
          <label className="block text-[11px] text-zinc-500 mb-1">Username / ID</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500"
            placeholder="agent_john"
          />
        </div>
        <div>
          <label className="block text-[11px] text-zinc-500 mb-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500"
            placeholder="••••••••"
          />
        </div>
        <button
          type="submit"
          disabled={isProcessing}
          className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-medium text-xs py-1.5 px-3 rounded-lg border border-zinc-700 transition-colors cursor-pointer disabled:opacity-50"
        >
          {isProcessing ? 'Processing...' : 'Save encrypted credential'}
        </button>
      </form>

      {errorMessage && !challenge && <p role="alert" className="text-sm text-rose-300">{errorMessage}</p>}

      <div className="space-y-3 border-t border-zinc-800 pt-4">
        <h5 className="text-xs font-semibold uppercase text-zinc-400">Saved credentials</h5>
        {records.length === 0 ? (
          <p className="text-xs text-zinc-500">No credentials saved for this client.</p>
        ) : records.map((record) => (
          <div key={record.id} className="space-y-3 border border-zinc-800 bg-zinc-950/50 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-zinc-200">{record.portalName}</span>
              <div className="flex items-center gap-3">
                {getPortalUrl(record.portalName) && (
                  <a
                    href={getPortalUrl(record.portalName)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-emerald-300 underline underline-offset-4 hover:text-emerald-200"
                    aria-label={`Open ${record.portalName} in a new tab`}
                  >
                    Open portal
                  </a>
                )}
                <span className="text-xs text-zinc-500">
                  {record.lastVerified ? new Date(record.lastVerified).toLocaleDateString() : ''}
                </span>
              </div>
            </div>
            {(['username', 'password'] as const).map((field) => {
              const key = `${record.id}:${field}`;
              const revealed = revealedValues[key];
              const isVisible = revealed !== undefined;
              const label = field === 'username' ? 'Username' : 'Password';

              return (
                <div key={field} className="grid grid-cols-[5rem_1fr_auto] items-center gap-3 text-sm">
                  <span className="text-xs text-zinc-500">{label}</span>
                  <span className="min-w-0 break-all font-mono text-zinc-200">
                    {isVisible ? revealed : '••••••••'}
                  </span>
                  <button
                    type="button"
                    aria-label={`${isVisible ? 'Hide' : 'Reveal'} ${label.toLowerCase()} for ${record.portalName}`}
                    aria-pressed={isVisible}
                    title={`${isVisible ? 'Hide' : 'Reveal'} ${label.toLowerCase()}`}
                    disabled={isProcessing || (!isVisible && resendInSeconds > 0 && !verifiedCredentialPairs[record.id])}
                    onClick={() => void handleToggleVisibility(record, field)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded border border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-50"
                  >
                    <EyeIcon visible={isVisible} />
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {challenge && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="vault-otp-title"
            className="w-full max-w-md space-y-5 border border-zinc-700 bg-zinc-950 p-6 shadow-2xl"
          >
            <div className="space-y-1">
              <h3 id="vault-otp-title" className="text-lg font-semibold text-zinc-100">
                Verify before reveal
              </h3>
              <p className="text-sm text-zinc-400">
                Enter the {VAULT_EMAIL_OTP_LENGTH}-digit email code sent to {challenge.destination ?? 'your account email'} to access both fields for {challenge.portalName} for 30 seconds.
              </p>
            </div>

            {!challenge.destination ? (
              <p role="status" className="text-sm text-zinc-400">Requesting verification code...</p>
            ) : null}

            {errorMessage && <p role="alert" className="text-sm text-rose-300">{errorMessage}</p>}

            <form onSubmit={handleConfirmChallenge} className="space-y-4">
              <label className="block space-y-2">
                <span className="text-xs font-medium text-zinc-400">{VAULT_EMAIL_OTP_LENGTH}-digit verification code</span>
                <input
                  autoFocus
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern={`[0-9]{${VAULT_EMAIL_OTP_LENGTH}}`}
                  maxLength={VAULT_EMAIL_OTP_LENGTH}
                  required
                  value={pin}
                  onChange={(event) => {
                    setPin(event.target.value.replace(/\D/g, '').slice(0, VAULT_EMAIL_OTP_LENGTH));
                    setErrorMessage('');
                  }}
                  disabled={!challenge.destination || isProcessing}
                  className="w-full border border-zinc-700 bg-zinc-900 px-3 py-3 text-center font-mono text-xl tracking-[0.3em] text-zinc-100 outline-none focus:border-emerald-500"
                  aria-label={`${VAULT_EMAIL_OTP_LENGTH}-digit verification code`}
                />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => void handleResendChallenge()}
                  disabled={!challenge.destination || isProcessing || resendInSeconds > 0}
                  className="text-sm text-emerald-300 underline underline-offset-4 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {resendInSeconds > 0 ? `Resend code in ${resendInSeconds}s` : 'Resend code'}
                </button>
                <div className="flex justify-end gap-3">
                  <button
                    type="submit"
                    disabled={!challenge.destination || pin.length !== VAULT_EMAIL_OTP_LENGTH || isProcessing}
                    className="bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isProcessing ? 'Verifying...' : 'Verify and reveal'}
                  </button>
                </div>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
