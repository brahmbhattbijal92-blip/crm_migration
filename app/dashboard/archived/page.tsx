'use client';

import Link from 'next/link';
import React, { useEffect, useState } from 'react';
import {
  ARCHIVE_RETENTION_DAYS,
  DashboardStorageProvider,
  useDashboardStorage,
  type ClientRecord,
} from '../StorageContext';

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

function ArchivedClientsContent() {
  const { dataService, preference } = useDashboardStorage();
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [reviewingPurgeId, setReviewingPurgeId] = useState<string | null>(null);
  const [pendingPurgeClient, setPendingPurgeClient] = useState<ClientRecord | null>(null);
  const [pendingAttachmentCount, setPendingAttachmentCount] = useState(0);
  const [isPurging, setIsPurging] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  async function refreshArchivedClients() {
    setIsLoading(true);
    setErrorMessage('');
    try {
      setClients(await dataService.listArchivedClients());
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Archived clients could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    dataService.listArchivedClients()
      .then((archivedClients) => {
        if (active) setClients(archivedClients);
      })
      .catch((error: unknown) => {
        if (active) setErrorMessage(error instanceof Error ? error.message : 'Archived clients could not be loaded.');
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => { active = false; };
  }, [dataService]);

  async function restoreClient(client: ClientRecord) {
    setRestoringId(client.id);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      await dataService.restoreClient(client.id);
      setClients((current) => current.filter((entry) => entry.id !== client.id));
      setSuccessMessage(`${client.firstName} ${client.lastName} restored to the active client list.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Client could not be restored.');
    } finally {
      setRestoringId(null);
    }
  }

  async function reviewPurge(client: ClientRecord) {
    setReviewingPurgeId(client.id);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const review = await dataService.reviewPurge([client.id]);
      if (review.blockedInvoices.length > 0) {
        const invoiceDetails = review.blockedInvoices
          .map((invoice) => `${invoice.invoiceNumber} (${invoice.status}, ${invoice.currency} ${invoice.amount.toFixed(2)})`)
          .join(', ');
        setErrorMessage(`COMPLIANCE WARNING — PURGE BLOCKED. Resolve or void every listed invoice before retrying: ${invoiceDetails}.`);
        return;
      }

      setPendingPurgeClient(client);
      setPendingAttachmentCount(review.attachmentCount);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Purge compliance check could not be completed.');
    } finally {
      setReviewingPurgeId(null);
    }
  }

  async function confirmPurge() {
    if (!pendingPurgeClient) return;
    setIsPurging(true);
    setErrorMessage('');
    try {
      await dataService.purgeClients([pendingPurgeClient.id]);
      setClients((current) => current.filter((client) => client.id !== pendingPurgeClient.id));
      setSuccessMessage(`${pendingPurgeClient.firstName} ${pendingPurgeClient.lastName} was permanently purged.`);
      setPendingPurgeClient(null);
      setPendingAttachmentCount(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Secure purge did not complete.';
      setErrorMessage(message.includes('COMPLIANCE_PURGE_BLOCKED')
        ? `COMPLIANCE WARNING — PURGE BLOCKED. ${message.replace('COMPLIANCE_PURGE_BLOCKED:', '').trim()}`
        : message);
      if (message.includes('COMPLIANCE_PURGE_BLOCKED')) setPendingPurgeClient(null);
    } finally {
      setIsPurging(false);
    }
  }

  function cancelPurge() {
    if (isPurging) return;
    setPendingPurgeClient(null);
    setPendingAttachmentCount(0);
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-[1200px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col justify-between gap-5 border-b border-zinc-800 pb-5 sm:flex-row sm:items-end">
          <div>
            <Link href="/dashboard" className="text-xs text-zinc-500 hover:text-zinc-200">Dashboard</Link>
            <p className="mt-3 text-xs font-semibold uppercase text-emerald-400">Client records</p>
            <h1 className="mt-1 text-2xl font-semibold">Archived clients</h1>
            <p className="mt-1 text-sm text-zinc-500">Archived records remain stored until securely purged.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="border border-zinc-700 px-2 py-1 text-xs uppercase text-zinc-400">{preference}</span>
            <button
              type="button"
              onClick={() => void refreshArchivedClients()}
              disabled={isLoading}
              className="border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
        </header>

        {errorMessage && <p role="alert" className="border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">{errorMessage}</p>}
        {successMessage && <p role="status" className="border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">{successMessage}</p>}

        <section className="border border-zinc-800 bg-zinc-900/40">
          <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold">Archived records</h2>
              <p className="mt-1 text-xs text-zinc-500">{clients.length} client records</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-zinc-950/70 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Archived</th>
                  <th className="px-4 py-3 font-medium">Purge eligibility</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {isLoading ? (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-zinc-500">Loading archived clients...</td></tr>
                ) : clients.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-zinc-500">No archived clients.</td></tr>
                ) : clients.map((client) => (
                  <tr key={client.id}>
                    {(() => {
                      const readyToPurge = Boolean(client.purgeEligibleAt && Date.parse(client.purgeEligibleAt) <= Date.now());
                      return <>
                    <td className="px-4 py-3">
                      <span className="block font-medium text-zinc-200">{client.firstName} {client.lastName}</span>
                      <span className="mt-0.5 block text-xs text-zinc-500">{client.email}</span>
                    </td>
                    <td className="px-4 py-3 text-zinc-400">{client.company || '—'}</td>
                    <td className="px-4 py-3 text-xs text-zinc-400">{formatDate(client.archivedAt ?? client.updatedAt)}</td>
                    <td className="px-4 py-3 text-xs">
                      {readyToPurge ? (
                        <span className="text-emerald-300">Ready to purge</span>
                      ) : (
                        <span className="text-zinc-500">Available {formatDate(client.purgeEligibleAt ?? client.updatedAt)} ({ARCHIVE_RETENTION_DAYS} days)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          aria-label={`Restore ${client.firstName} ${client.lastName}`}
                          disabled={Boolean(restoringId || reviewingPurgeId) || isPurging}
                          onClick={() => void restoreClient(client)}
                          className="border border-emerald-800 px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-950/50 disabled:opacity-50"
                        >
                          {restoringId === client.id ? 'Restoring...' : 'Restore'}
                        </button>
                        <button
                          type="button"
                          aria-label={`Permanently purge ${client.firstName} ${client.lastName}`}
                          disabled={!readyToPurge || Boolean(restoringId || reviewingPurgeId) || isPurging}
                          onClick={() => void reviewPurge(client)}
                          className="border border-rose-800 px-3 py-2 text-sm text-rose-200 hover:bg-rose-950/50 disabled:opacity-50"
                        >
                          {reviewingPurgeId === client.id ? 'Checking...' : 'Permanently purge'}
                        </button>
                      </div>
                    </td>
                      </>;
                    })()}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      {pendingPurgeClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="purge-confirmation-title"
            className="w-full max-w-xl space-y-5 border border-rose-900 bg-zinc-950 p-6 shadow-2xl"
          >
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase text-rose-300">Irreversible action</p>
              <h2 id="purge-confirmation-title" className="text-xl font-semibold text-zinc-100">Permanently purge {pendingPurgeClient.firstName} {pendingPurgeClient.lastName}?</h2>
              <p className="text-sm leading-6 text-zinc-400">
                This permanently deletes the archived client and dependent records from {preference === 'cloud' ? 'PostgreSQL' : 'local IndexedDB'}, removes local copies, and deletes associated attachments from {preference === 'cloud' ? 'Supabase Storage and any selected local folder' : 'the selected local folder'}.
              </p>
              <p className="text-sm text-rose-200">{pendingAttachmentCount} attachment record{pendingAttachmentCount === 1 ? '' : 's'} will be removed. This action cannot be undone.</p>
              <p className="text-xs text-zinc-500">Invoices are checked again before deletion. Active or unpaid invoices block the purge.</p>
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                disabled={isPurging}
                onClick={cancelPurge}
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
                {isPurging ? 'Purging record...' : 'Permanently purge'}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default function ArchivedClientsPage() {
  return (
    <DashboardStorageProvider>
      <ArchivedClientsContent />
    </DashboardStorageProvider>
  );
}
