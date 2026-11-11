'use client';

import Link from 'next/link';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import GlobalPageSearch from '../../../src/components/GlobalPageSearch';
import {
  DashboardStorageProvider,
  useDashboardStorage,
  type ClientRecord,
  type ClientSearchField,
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
  const [searchTerm, setSearchTerm] = useState('');
  const [appliedSearchTerm, setAppliedSearchTerm] = useState('');
  const [searchField, setSearchField] = useState<ClientSearchField>('all');
  const [inactiveDays, setInactiveDays] = useState<number>(90);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [loadedDataService, setLoadedDataService] = useState<typeof dataService | null>(null);
  const [loadedQueryKey, setLoadedQueryKey] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasMoreAccounts, setHasMoreAccounts] = useState(false);
  const [isLoadingMoreAccounts, setIsLoadingMoreAccounts] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [lastRefreshed, setLastRefreshed] = useState('');
  const [referenceTime, setReferenceTime] = useState(0);
  const queryKey = JSON.stringify([appliedSearchTerm, searchField]);
  const isLoading = loadedDataService !== dataService || loadedQueryKey !== queryKey || isRefreshing;

  const inactiveAccounts = useMemo(
    () => getInactiveAccounts(accounts, inactiveDays, referenceTime),
    [accounts, inactiveDays, referenceTime]
  );
  const allVisibleSelected = inactiveAccounts.length > 0 && inactiveAccounts.every((account) => selectedIds.has(account.id));
  const selectedCount = inactiveAccounts.reduce((count, account) => count + Number(selectedIds.has(account.id)), 0);

  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedSearchTerm(searchTerm.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  async function loadAccounts() {
    setIsRefreshing(true);
    setErrorMessage('');
    try {
      const page = await dataService.listClientPage(false, 0, CLIENT_PAGE_SIZE, appliedSearchTerm, searchField);
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
    if (!hasMoreAccounts || isLoading || isLoadingMoreAccounts) return;
    setIsLoadingMoreAccounts(true);
    setErrorMessage('');
    try {
      const page = await dataService.listClientPage(false, accounts.length, CLIENT_PAGE_SIZE, appliedSearchTerm, searchField);
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
    dataService.listClientPage(false, 0, CLIENT_PAGE_SIZE, appliedSearchTerm, searchField)
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
        setLoadedQueryKey(queryKey);
      })
      .catch((error: unknown) => {
        if (active) {
          setErrorMessage(error instanceof Error ? error.message : 'Inactive accounts could not be loaded.');
          setLoadedDataService(dataService);
          setLoadedQueryKey(queryKey);
        }
      })
      .finally(() => undefined);
    return () => { active = false; };
  }, [appliedSearchTerm, dataService, queryKey, searchField]);

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
            <div className="w-full max-w-md">
              <GlobalPageSearch />
            </div>
            <label className="space-y-1.5">
              <span className="block text-xs text-zinc-400">Search accounts</span>
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => {
                  setSearchTerm(event.target.value);
                  setSelectedIds(new Set());
                }}
                placeholder="Name, email, company"
                className="w-48 border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-emerald-500"
              />
            </label>
            <label className="space-y-1.5">
              <span className="block text-xs text-zinc-400">Search by</span>
              <select
                value={searchField}
                onChange={(event) => {
                  setSearchField(event.target.value as ClientSearchField);
                  setSelectedIds(new Set());
                }}
                className="border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
              >
                <option value="all">All fields</option>
                <option value="name">Name</option>
                <option value="email">Email</option>
                <option value="company">Company</option>
              </select>
            </label>
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
              <p className="mt-1 text-xs text-zinc-500">Uses the client record's last update; opening a profile or adding an invoice, grant, or document does not necessarily reset it.</p>
            </div>
            <button
              type="button"
              disabled={selectedCount === 0}
              onClick={exportSelection}
              className="self-start bg-zinc-100 px-3 py-2 text-sm font-semibold text-zinc-950 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 sm:self-auto"
            >
              Export selected ({selectedCount})
            </button>
            <Link
              href="/dashboard/archived"
              className="self-start border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900 sm:self-auto"
            >
              Open archived clients
            </Link>
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
                disabled={isLoadingMoreAccounts || isLoading}
                className="border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
              >
                {isLoadingMoreAccounts ? 'Loading...' : 'Load more accounts'}
              </button>
            </div>
          )}
          <footer className="border-t border-zinc-800 px-5 py-3 text-xs text-zinc-500">
            This report is for inactivity review and CSV export. To permanently purge a client, archive it first, wait 90 days, then use Archived clients. Active or unpaid invoices block purge.
          </footer>
        </section>
      </div>
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
