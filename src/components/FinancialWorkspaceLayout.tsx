'use client';

import type { ReactNode } from 'react';
import type { ClientRecord, GrantBalance } from '../../app/dashboard/StorageContext';
import type { StoragePreference } from '../context/StorageContext';

export interface GlobalControlHeaderProps {
  mode: StoragePreference;
  onModeChange(mode: StoragePreference): void;
  cloudDisabled?: boolean;
  backupAction?: ReactNode;
}

export function GlobalControlHeader({ mode, onModeChange, cloudDisabled = false, backupAction }: GlobalControlHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase text-emerald-400">CRM Migration</p>
        <p className="mt-1 text-sm font-medium">{mode === 'cloud' ? 'Cloud Sync Mode' : 'Local Storage Mode'}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="workspace-mode" className="text-xs text-zinc-400">Workspace</label>
        <select
          id="workspace-mode"
          value={mode}
          onChange={(event) => onModeChange(event.target.value as StoragePreference)}
          className="border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
        >
          <option value="local">Local Storage Mode</option>
          <option value="cloud" disabled={cloudDisabled}>Cloud Sync Mode</option>
        </select>
        {mode === 'local' && backupAction}
      </div>
    </div>
  );
}

export interface FinancialWorkspaceLayoutProps {
  globalHeader: ReactNode;
  clientSidebar: ReactNode;
  clientProfile: ReactNode;
  financialSummary: ReactNode;
  actionHub: ReactNode;
  children: ReactNode;
}

export function FinancialWorkspaceLayout({
  globalHeader,
  clientSidebar,
  clientProfile,
  financialSummary,
  actionHub,
  children,
}: FinancialWorkspaceLayoutProps) {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-4 py-4 sm:px-6">{globalHeader}</header>
      <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-5 px-4 py-5 sm:px-6 xl:grid-cols-[250px_minmax(0,1fr)_280px]">
        <aside aria-label="Active and archived clients" className="min-w-0 border border-zinc-800 bg-zinc-900/30">
          {clientSidebar}
        </aside>
        <section aria-label="Selected client workspace" className="min-w-0 space-y-5">
          {clientProfile}
          {financialSummary}
          {children}
        </section>
        <aside aria-label="Client actions" className="min-w-0 border border-zinc-800 bg-zinc-900/30">
          {actionHub}
        </aside>
      </div>
    </main>
  );
}

export interface ClientSidebarProps {
  clients: ClientRecord[];
  selectedClientId: string;
  onSelect(clientId: string): void;
  onNewClient(): void;
  showArchived: boolean;
  onToggleArchived(): void;
  hasMoreClients: boolean;
  isLoadingMore: boolean;
  onLoadMore(): void;
}

export function ClientSidebar({
  clients,
  selectedClientId,
  onSelect,
  onNewClient,
  showArchived,
  onToggleArchived,
  hasMoreClients,
  isLoadingMore,
  onLoadMore,
}: ClientSidebarProps) {
  return (
    <div>
      <div className="space-y-3 border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Clients</h2>
          <button type="button" onClick={onToggleArchived} className="text-xs text-zinc-400 hover:text-zinc-100">
            {showArchived ? 'Show active' : 'Show archived'}
          </button>
        </div>
        <button type="button" onClick={onNewClient} className="w-full bg-emerald-500 px-3 py-2 text-left text-sm font-semibold text-zinc-950 hover:bg-emerald-400">
          + New client
        </button>
      </div>
      <ul className="max-h-[70vh] divide-y divide-zinc-800 overflow-y-auto">
        {clients.map((client) => (
          <li key={client.id}>
            <button
              type="button"
              aria-current={client.id === selectedClientId ? 'true' : undefined}
              onClick={() => onSelect(client.id)}
              className={`w-full px-4 py-3 text-left hover:bg-zinc-800/60 ${client.id === selectedClientId ? 'border-l-2 border-emerald-400 bg-zinc-800/50' : ''}`}
            >
              <span className="block truncate text-sm font-medium">{client.firstName} {client.lastName}</span>
              <span className="mt-1 block truncate text-xs text-zinc-500">{client.company || client.email}</span>
            </button>
          </li>
        ))}
        {clients.length === 0 && <li className="px-4 py-6 text-sm text-zinc-500">No clients in this view.</li>}
      </ul>
      {hasMoreClients && (
        <div className="border-t border-zinc-800 p-3">
          <button type="button" onClick={onLoadMore} disabled={isLoadingMore} className="w-full border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">
            {isLoadingMore ? 'Loading clients...' : 'Load more clients'}
          </button>
        </div>
      )}
    </div>
  );
}

export interface ClientFinancialSummaryProps {
  balances: GrantBalance[];
  outstandingByCurrency: Array<{ currency: string; amount: number }>;
}

export function ClientFinancialSummary({ balances, outstandingByCurrency }: ClientFinancialSummaryProps) {
  return (
    <section className="grid grid-cols-1 divide-y divide-zinc-800 border border-zinc-800 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
      <div className="p-4">
        <h2 className="text-xs font-semibold uppercase text-zinc-500">Available grant balance</h2>
        {balances.map((balance) => (
          <p key={balance.currency} className="mt-2 text-xl font-semibold text-emerald-300">
            {new Intl.NumberFormat(undefined, { style: 'currency', currency: balance.currency }).format(balance.availableBalance)}
          </p>
        ))}
        {balances.length === 0 && <p className="mt-2 text-sm text-zinc-500">No grant funds allocated.</p>}
      </div>
      <div className="p-4">
        <h2 className="text-xs font-semibold uppercase text-zinc-500">Outstanding invoices</h2>
        {outstandingByCurrency.map(({ currency, amount }) => (
          <p key={currency} className="mt-2 text-xl font-semibold text-amber-300">
            {new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)}
          </p>
        ))}
        {outstandingByCurrency.length === 0 && <p className="mt-2 text-sm text-zinc-500">Nothing outstanding.</p>}
      </div>
    </section>
  );
}

export interface ClientActionHubProps {
  onAddGrant(): void;
  onAddInvoice(): void;
  onArchive(): void;
  onPurge(): void;
  archiveLabel?: string;
  financialActionsDisabled?: boolean;
  archiveDisabled?: boolean;
  purgeDisabled?: boolean;
}

export function ClientActionHub({
  onAddGrant,
  onAddInvoice,
  onArchive,
  onPurge,
  archiveLabel = 'Archive client',
  financialActionsDisabled = false,
  archiveDisabled = false,
  purgeDisabled = false,
}: ClientActionHubProps) {
  return (
    <div>
      <h2 className="border-b border-zinc-800 px-4 py-3 text-sm font-semibold">Actions</h2>
      <div className="grid gap-2 p-4">
        <button type="button" onClick={onAddGrant} disabled={financialActionsDisabled} className="border border-zinc-700 px-3 py-2 text-left text-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40">Add grant entry</button>
        <button type="button" onClick={onAddInvoice} disabled={financialActionsDisabled} className="border border-zinc-700 px-3 py-2 text-left text-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40">Add invoice</button>
        <button type="button" onClick={onArchive} disabled={archiveDisabled} className="border border-zinc-700 px-3 py-2 text-left text-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40">{archiveLabel}</button>
        <button type="button" onClick={onPurge} disabled={purgeDisabled} className="border border-rose-900 px-3 py-2 text-left text-sm text-rose-200 hover:bg-rose-950/40 disabled:cursor-not-allowed disabled:opacity-40">Purge client</button>
      </div>
    </div>
  );
}
