'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  cancelVaultOtp,
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

interface PendingChallenge {
  vaultId: string;
  field: VisibleField;
  portalName: string;
  destination?: string;
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
  const [challenge, setChallenge] = useState<PendingChallenge | null>(null);
  const [pin, setPin] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const revealTimers = useRef(new Map<string, number>());

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
    revealTimers.current.forEach((timer) => window.clearTimeout(timer));
    revealTimers.current.clear();
  }, []);

  function clearRevealedValue(key: string) {
    const timer = revealTimers.current.get(key);
    if (timer !== undefined) window.clearTimeout(timer);
    revealTimers.current.delete(key);
    setRevealedValues((current) => {
      const next = { ...current };
      delete next[key];
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

    try {
      setIsProcessing(true);
      setErrorMessage('');
      setPin('');
      setChallenge({ vaultId: record.id, field, portalName: record.portalName });
      const issuedChallenge = await requestVaultOtp(record.id, field);
      setChallenge({
        vaultId: record.id,
        field,
        portalName: record.portalName,
        destination: issuedChallenge.destination,
      });
    } catch (error) {
      setChallenge(null);
      setErrorMessage(error instanceof Error ? error.message : 'Credential verification failed.');
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleConfirmChallenge(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge?.destination || !/^\d{6}$/.test(pin)) return;

    try {
      setIsProcessing(true);
      setErrorMessage('');
      const result = await verifyAndRevealCredential(
        challenge.vaultId,
        challenge.field,
        pin
      );
      const key = `${challenge.vaultId}:${challenge.field}`;
      setRevealedValues((current) => ({ ...current, [key]: result.value }));
      const timer = window.setTimeout(() => clearRevealedValue(key), 30_000);
      revealTimers.current.set(key, timer);
      setChallenge(null);
      setPin('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Verification failed.');
      setPin('');
    } finally {
      setIsProcessing(false);
    }
  }

  function closeChallenge() {
    if (challenge) void cancelVaultOtp(challenge.vaultId).catch(() => undefined);
    setChallenge(null);
    setPin('');
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
          <label className="block text-[11px] text-zinc-500 mb-1">Portal Application</label>
          <input
            type="text"
            value={portalName}
            onChange={(e) => setPortalName(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500"
            placeholder="ImmiAccount / VEVO"
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
              <span className="text-xs text-zinc-500">
                {record.lastVerified ? new Date(record.lastVerified).toLocaleDateString() : ''}
              </span>
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
                    disabled={isProcessing}
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
                Enter the six-digit code sent to {challenge.destination ?? 'the agent phone'} for {challenge.portalName}.
              </p>
            </div>

            {!challenge.destination ? (
              <p role="status" className="text-sm text-zinc-400">Requesting verification code...</p>
            ) : null}

            {errorMessage && <p role="alert" className="text-sm text-rose-300">{errorMessage}</p>}

            <form onSubmit={handleConfirmChallenge} className="space-y-4">
              <label className="block space-y-2">
                <span className="text-xs font-medium text-zinc-400">6-digit verification code</span>
                <input
                  autoFocus
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={pin}
                  onChange={(event) => {
                    setPin(event.target.value.replace(/\D/g, '').slice(0, 6));
                    setErrorMessage('');
                  }}
                  disabled={!challenge.destination || isProcessing}
                  className="w-full border border-zinc-700 bg-zinc-900 px-3 py-3 text-center font-mono text-xl tracking-[0.3em] text-zinc-100 outline-none focus:border-emerald-500"
                  aria-label="Six-digit verification code"
                />
              </label>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeChallenge}
                  disabled={isProcessing}
                  className="border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!challenge.destination || pin.length !== 6 || isProcessing}
                  className="bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isProcessing ? 'Verifying...' : 'Verify and reveal'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
