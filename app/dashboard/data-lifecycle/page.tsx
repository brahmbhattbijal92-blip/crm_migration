'use client';

import Link from 'next/link';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DashboardStorageProvider,
  useDashboardStorage,
  type ClientRecord,
} from '../StorageContext';

const INACTIVITY_OPTIONS = [30, 60, 90, 180, 365] as const;
const CLIENT_PAGE_SIZE = 50;

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

function getInactiveAccounts(accounts: ClientRecord[], inactivityDays: number, now: number): ClientRecord[] {
  const cutoff = now - inactivityDays * 24 * 60 * 60 * 1000;
  return accounts
    .filter((account) => {
      if (account.status === 'archived') return false;
      const lastInteraction = Date.parse(account.lastInteractionAt);
      return Number.isFinite(lastInteraction) && lastInteraction <= cutoff;
    })
    .sort((a, b) => Date.parse(a.lastInteractionAt) - Date.parse(b.lastInteractionAt));
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

interface InactiveAccountRowProps {
  account: ClientRecord;
  inactiveDays: number;
  selected: boolean;
  onToggle(id: string): void;
}

const InactiveAccountRow = React.memo(function InactiveAccountRow({
  account,
  inactiveDays,
  selected,
  onToggle,
}: InactiveAccountRowProps) {
  return (
    <tr className={selected ? 'bg-emerald-950/20' : 'hover:bg-zinc-800/30'}>
      <td className="px-4 py-3">
        <input
          type="checkbox"
          aria-label={`Select ${account.firstName} ${account.lastName}`}
          checked={selected}
          onChange={() => onToggle(account.id)}
          className="h-4 w-4 accent-emerald-500"
        />
      </td>
      <td className="px-4 py-3">
        <span className="block font-medium text-zinc-200">{account.firstName} {account.lastName}</span>
        <span className="mt-0.5 block text-xs text-zinc-500">{account.email}</span>
      </td>
      <td className="px-4 py-3 text-zinc-400">{account.company || '—'}</td>
      <td className="px-4 py-3 text-xs text-zinc-400">{dateLabel(account.createdAt)}</td>
      <td className="px-4 py-3 text-xs text-zinc-400">{dateLabel(account.lastInteractionAt)}</td>
      <td className="px-4 py-3 text-xs text-amber-300">{inactiveDays}+ days</td>
    </tr>
  );
});

function DataLifecycleContent() {
  const { dataService, preference } = useDashboardStorage();
  const [accounts, setAccounts] = useState<ClientRecord[]>([]);
  const [inactiveDays, setInactiveDays] = useState<number>(90);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [loadedDataService, setLoadedDataService] = useState<typeof dataService | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasMoreAccounts, setHasMoreAccounts] = useState(false);
  const [isLoadingMoreAccounts, setIsLoadingMoreAccounts] = useState(false);
  const [isReviewingPurge, setIsReviewingPurge] = useState(false);
  const [isPurging, setIsPurging] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [lastRefreshed, setLastRefreshed] = useState('');
  const [referenceTime, setReferenceTime] = useState(0);
  const [pendingPurgeIds, setPendingPurgeIds] = useState<string[]>([]);
  const [pendingAttachmentCount, setPendingAttachmentCount] = useState(0);
  const [showPurgeConfirmation, setShowPurgeConfirmation] = useState(false);
  const isLoading = loadedDataService !== dataService || isRefreshing;

  const inactiveAccounts = useMemo(
    () => getInactiveAccounts(accounts, inactiveDays, referenceTime),
    [accounts, inactiveDays, referenceTime]
  );
  const allVisibleSelected = inactiveAccounts.length > 0 && inactiveAccounts.every((account) => selectedIds.has(account.id));
  const selectedCount = inactiveAccounts.reduce((count, account) => count + Number(selectedIds.has(account.id)), 0);

  async function loadAccounts() {
    setIsRefreshing(true);
    setErrorMessage('');
    try {
      const page = await dataService.listClientPage(false, 0, CLIENT_PAGE_SIZE);
      setAccounts(page.items);
      setHasMoreAccounts(page.hasMore);
      setSelectedIds(new Set());
      const refreshedAt = new Date();
      setReferenceTime(refreshedAt.getTime());
      setLastRefreshed(refreshedAt.toISOString());
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Inactive accounts could not be loaded.');
    } finally {
      setIsRefreshing(false);
    }
  }

  async function loadMoreAccounts() {
    if (!hasMoreAccounts || isLoading || isLoadingMoreAccounts || isPurging || isReviewingPurge) return;
    setIsLoadingMoreAccounts(true);
    setErrorMessage('');
    try {
      const page = await dataService.listClientPage(false, accounts.length, CLIENT_PAGE_SIZE);
      setAccounts((current) => {
        const existingIds = new Set(current.map((account) => account.id));
        return [...current, ...page.items.filter((account) => !existingIds.has(account.id))];
      });
      setHasMoreAccounts(page.hasMore);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'More accounts could not be loaded.');
    } finally {
      setIsLoadingMoreAccounts(false);
    }
  }

  useEffect(() => {
    let active = true;
    dataService.listClientPage(false, 0, CLIENT_PAGE_SIZE)
      .then((page) => {
        if (!active) return;
        setAccounts(page.items);
        setHasMoreAccounts(page.hasMore);
        setSelectedIds(new Set());
        const refreshedAt = new Date();
        setReferenceTime(refreshedAt.getTime());
        setLastRefreshed(refreshedAt.toISOString());
        setErrorMessage('');
        setLoadedDataService(dataService);
      })
      .catch((error: unknown) => {
        if (active) {
          setErrorMessage(error instanceof Error ? error.message : 'Inactive accounts could not be loaded.');
          setLoadedDataService(dataService);
        }
      });
    return () => { active = false; };
  }, [dataService]);

  const toggleAccount = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  function toggleAllVisible() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) inactiveAccounts.forEach((account) => next.delete(account.id));
      else inactiveAccounts.forEach((account) => next.add(account.id));
      return next;
    });
  }

  function exportSelection() {
    const selected = inactiveAccounts.filter((account) => selectedIds.has(account.id));
    const rows = [
      ['Account ID', 'Name', 'Email', 'Company', 'Created At', 'Last Interaction At'],
      ...selected.map((account) => [
        account.id,
        `${account.firstName} ${account.lastName}`.trim(),
        account.email,
        account.company,
        account.createdAt,
        account.lastInteractionAt,
      ]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `inactive-accounts-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function reviewSelectedPurge() {
    const clientIds = inactiveAccounts.filter((account) => selectedIds.has(account.id)).map((account) => account.id);
    if (clientIds.length === 0) return;

    setErrorMessage('');
    setSuccessMessage('');
    setIsReviewingPurge(true);
    try {
      const review = await dataService.reviewPurge(clientIds);
      if (review.blockedInvoices.length > 0) {
        const invoiceDetails = review.blockedInvoices
          .map((invoice) => `${invoice.invoiceNumber} (${invoice.status}, ${invoice.currency} ${invoice.amount.toFixed(2)})`)
          .join(', ');
        setErrorMessage(`COMPLIANCE WARNING — PURGE BLOCKED. Selected accounts have active or unpaid invoices: ${invoiceDetails}. Resolve or void every listed invoice before retrying.`);
        setShowPurgeConfirmation(false);
        setPendingPurgeIds([]);
        return;
      }

      setPendingPurgeIds(clientIds);
      setPendingAttachmentCount(review.attachmentCount);
      setShowPurgeConfirmation(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Purge compliance check could not be completed.');
    } finally {
      setIsReviewingPurge(false);
    }
  }

  async function confirmPurge() {
    if (pendingPurgeIds.length === 0) return;
    setIsPurging(true);
    setErrorMessage('');
    try {
      await dataService.purgeClients(pendingPurgeIds);
      const purgeCount = pendingPurgeIds.length;
      setAccounts((current) => current.filter((account) => !pendingPurgeIds.includes(account.id)));
      setSelectedIds((current) => {
        const next = new Set(current);
        pendingPurgeIds.forEach((id) => next.delete(id));
        return next;
      });
      setPendingPurgeIds([]);
      setPendingAttachmentCount(0);
      setShowPurgeConfirmation(false);
      setSuccessMessage(`Secure purge completed for ${purgeCount} selected account${purgeCount === 1 ? '' : 's'}.`);
      const refreshedAt = new Date();
      setReferenceTime(refreshedAt.getTime());
      setLastRefreshed(refreshedAt.toISOString());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Secure purge did not complete.';
      setErrorMessage(message.includes('COMPLIANCE_PURGE_BLOCKED')
        ? `COMPLIANCE WARNING — PURGE BLOCKED. ${message.replace('COMPLIANCE_PURGE_BLOCKED:', '').trim()}`
        : message);
      if (message.includes('COMPLIANCE_PURGE_BLOCKED')) {
        setPendingPurgeIds([]);
        setShowPurgeConfirmation(false);
      }
    } finally {
      setIsPurging(false);
    }
  }

  function cancelPurgeConfirmation() {
    if (isPurging) return;
    setPendingPurgeIds([]);
    setPendingAttachmentCount(0);
    setShowPurgeConfirmation(false);
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-[1500px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col justify-between gap-5 border-b border-zinc-800 pb-5 sm:flex-row sm:items-end">
          <div>
            <Link href="/dashboard" className="text-xs text-zinc-500 hover:text-zinc-200">Dashboard</Link>
            <p className="mt-3 text-xs font-semibold uppercase text-emerald-400">Data governance</p>
            <h1 className="mt-1 text-2xl font-semibold">Inactive accounts</h1>
            <p className="mt-1 text-sm text-zinc-500">Review baseline activity before taking lifecycle action.</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label htmlFor="inactivity-days" className="space-y-1.5">
              <span className="block text-xs text-zinc-400">Inactive for at least</span>
              <select
                id="inactivity-days"
                value={inactiveDays}
                onChange={(event) => {
                  setInactiveDays(Number(event.target.value));
                  setSelectedIds(new Set());
                }}
                className="border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
              >
                {INACTIVITY_OPTIONS.map((days) => <option key={days} value={days}>{days} days</option>)}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void loadAccounts()}
              disabled={isLoading || isLoadingMoreAccounts}
              className="border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
            >
              Refresh
            </button>
          </div>
        </header>

        {errorMessage && <p role="alert" className="border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">{errorMessage}</p>}
        {successMessage && <p role="status" className="border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">{successMessage}</p>}

        <section className="grid grid-cols-2 divide-x divide-zinc-800 border border-zinc-800 bg-zinc-900/40 sm:grid-cols-4">
          <div className="p-4">
            <p className="text-xs text-zinc-500">Loaded matching accounts</p>
            <p className="mt-1 text-2xl font-semibold">{inactiveAccounts.length}</p>
          </div>
          <div className="p-4">
            <p className="text-xs text-zinc-500">Selected</p>
            <p className="mt-1 text-2xl font-semibold">{selectedCount}</p>
          </div>
          <div className="p-4">
            <p className="text-xs text-zinc-500">Storage source</p>
            <p className="mt-1 text-sm font-medium uppercase text-zinc-300">{preference}</p>
          </div>
          <div className="p-4">
            <p className="text-xs text-zinc-500">Last refreshed</p>
            <p className="mt-1 text-sm text-zinc-300">{lastRefreshed ? dateLabel(lastRefreshed) : '—'}</p>
          </div>
        </section>

        <section className="border border-zinc-800 bg-zinc-900/40">
          <div className="flex flex-col justify-between gap-3 border-b border-zinc-800 px-5 py-4 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-base font-semibold">Account activity baseline</h2>
              <p className="mt-1 text-xs text-zinc-500">Creation and latest interaction timestamps determine inactivity.</p>
            </div>
            <button
              type="button"
              disabled={selectedCount === 0}
              onClick={exportSelection}
              className="self-start bg-zinc-100 px-3 py-2 text-sm font-semibold text-zinc-950 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 sm:self-auto"
            >
              Export selected ({selectedCount})
            </button>
            <button
              type="button"
              disabled={selectedCount === 0 || isReviewingPurge || isPurging}
              onClick={() => void reviewSelectedPurge()}
              className="self-start border border-rose-800 bg-rose-950/40 px-3 py-2 text-sm font-semibold text-rose-200 hover:bg-rose-950 disabled:cursor-not-allowed disabled:opacity-40 sm:self-auto"
            >
              {isReviewingPurge ? 'Checking invoices...' : 'Secure Purge Selected Records'}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-zinc-950/70 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="w-12 px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label="Select all visible inactive accounts"
                      checked={allVisibleSelected}
                      disabled={inactiveAccounts.length === 0}
                      onChange={toggleAllVisible}
                      className="h-4 w-4 accent-emerald-500"
                    />
                  </th>
                  <th className="px-4 py-3 font-medium">Account</th>
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium">Baseline interaction</th>
                  <th className="px-4 py-3 font-medium">Inactive duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {isLoading ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-zinc-500">Loading account activity...</td></tr>
                ) : inactiveAccounts.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-zinc-500">No accounts meet this inactivity threshold.</td></tr>
                ) : inactiveAccounts.map((account) => (
                  <InactiveAccountRow
                    key={account.id}
                    account={account}
                    inactiveDays={inactiveDays}
                    selected={selectedIds.has(account.id)}
                    onToggle={toggleAccount}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {hasMoreAccounts && !isLoading && (
            <div className="border-t border-zinc-800 px-5 py-4 text-center">
              <button
                type="button"
                onClick={() => void loadMoreAccounts()}
                disabled={isLoadingMoreAccounts || isReviewingPurge || isPurging}
                className="border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
              >
                {isLoadingMoreAccounts ? 'Loading...' : 'Load more accounts'}
              </button>
            </div>
          )}
          <footer className="border-t border-zinc-800 px-5 py-3 text-xs text-zinc-500">
            Purge requires a clean invoice review and explicit irreversible-action confirmation.
          </footer>
        </section>
      </div>

      {showPurgeConfirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="purge-confirmation-title"
            className="w-full max-w-xl space-y-5 border border-rose-900 bg-zinc-950 p-6 shadow-2xl"
          >
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase text-rose-300">Irreversible action</p>
              <h2 id="purge-confirmation-title" className="text-xl font-semibold text-zinc-100">Confirm secure purge</h2>
              <p className="text-sm leading-6 text-zinc-400">
                This permanently hard-deletes {pendingPurgeIds.length} selected client account{pendingPurgeIds.length === 1 ? '' : 's'} and dependent records from {preference === 'cloud' ? 'PostgreSQL' : 'local IndexedDB'}, removes their local IndexedDB copies, and deletes all associated attachments from {preference === 'cloud' ? 'Supabase Storage and any selected local folder' : 'the selected local folder'}.
              </p>
              <p className="text-sm text-rose-200">{pendingAttachmentCount} attachment record{pendingAttachmentCount === 1 ? '' : 's'} will be removed. This action cannot be undone.</p>
              <p className="text-xs text-zinc-500">The system will recheck invoices at execution time. Any active or unpaid invoice blocks the purge.</p>
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                disabled={isPurging}
                onClick={cancelPurgeConfirmation}
                className="border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isPurging}
                onClick={() => void confirmPurge()}
                className="bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-600 disabled:opacity-50"
              >
                {isPurging ? 'Purging records...' : 'Permanently purge selected'}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default function DataLifecyclePage() {
  return (
    <DashboardStorageProvider>
      <DataLifecycleContent />
    </DashboardStorageProvider>
  );
}
