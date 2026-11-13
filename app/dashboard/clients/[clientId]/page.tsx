'use client';

import React, { Suspense, use, useEffect, useState } from 'react';
import Link from 'next/link';
import CredentialVault from '../../../../src/components/CredentialVault';
import GlobalPageSearch from '../../../../src/components/GlobalPageSearch';
import {
  DashboardStorageProvider,
  useDashboardStorage,
  type ClientInput,
  type ClientRecord,
  type DocumentRecord,
  type GrantRecord,
  type InvoiceRecord,
} from '../../StorageContext';
import { useStorage } from '../../../../src/context/StorageContext';

const EMPTY_FORM: ClientInput = {
  firstName: '',
  lastName: '',
  email: '',
  company: '',
  passportExpiresAt: '',
  visaSubclass: '',
  visaExpiresAt: '',
  agentReminderDate: '',
  agentReminderNote: '',
};

const fieldClass = 'w-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500 disabled:opacity-50';

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function ClientProfileContent({ clientId }: { clientId: string }) {
  const { dataService, preference, isReady } = useDashboardStorage();
  const { storagePreference, updateStoragePreference } = useStorage();
  const [client, setClient] = useState<ClientRecord | null>(null);
  const [form, setForm] = useState<ClientInput>(EMPTY_FORM);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [grants, setGrants] = useState<GrantRecord[]>([]);
  const [invoiceHasMore, setInvoiceHasMore] = useState(false);
  const [grantHasMore, setGrantHasMore] = useState(false);
  const [editing, setEditing] = useState(false);
  const [documentDrafts, setDocumentDrafts] = useState<Record<string, string>>({});
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [question, setQuestion] = useState('Summarize this client and identify important follow-up actions.');
  const [answer, setAnswer] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [busyDocumentId, setBusyDocumentId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  async function loadProfile() {
    if (!isReady) return;
    setIsLoading(true);
    setErrorMessage('');
    try {
      const [clientRecord, documentRows, invoicePage, grantPage] = await Promise.all([
        dataService.findClient(clientId),
        dataService.listDocuments(clientId),
        dataService.listInvoicesPage(clientId, 0, 100),
        dataService.listGrantsPage(clientId, 0, 100),
      ]);
      if (!clientRecord) {
        setClient(null);
        return;
      }
      setClient(clientRecord);
      setForm({
        firstName: clientRecord.firstName,
        lastName: clientRecord.lastName,
        email: clientRecord.email,
        company: clientRecord.company,
        passportExpiresAt: clientRecord.passportExpiresAt ?? '',
        visaSubclass: clientRecord.visaSubclass,
        visaExpiresAt: clientRecord.visaExpiresAt ?? '',
        agentReminderDate: clientRecord.agentReminderDate ?? '',
        agentReminderNote: clientRecord.agentReminderNote,
      });
      setDocuments(documentRows);
      setInvoices(invoicePage.items);
      setGrants(grantPage.items);
      setInvoiceHasMore(invoicePage.hasMore);
      setGrantHasMore(grantPage.hasMore);
      setSelectedDocumentIds([]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Client profile could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
  let active = true;

  async function load() {
    if (!isReady) return;

    setIsLoading(true);
    setErrorMessage('');

    try {
      const [clientRecord, documentRows, invoicePage, grantPage] = await Promise.all([
        dataService.findClient(clientId),
        dataService.listDocuments(clientId),
        dataService.listInvoicesPage(clientId, 0, 100),
        dataService.listGrantsPage(clientId, 0, 100),
      ]);

      if (!active) return;

      if (!clientRecord) {
        setClient(null);
        return;
      }

      setClient(clientRecord);
      setForm({
        firstName: clientRecord.firstName,
        lastName: clientRecord.lastName,
        email: clientRecord.email,
        company: clientRecord.company,
        passportExpiresAt: clientRecord.passportExpiresAt ?? '',
        visaSubclass: clientRecord.visaSubclass,
        visaExpiresAt: clientRecord.visaExpiresAt ?? '',
        agentReminderDate: clientRecord.agentReminderDate ?? '',
        agentReminderNote: clientRecord.agentReminderNote,
      });
      setDocuments(documentRows);
      setInvoices(invoicePage.items);
      setGrants(grantPage.items);
      setInvoiceHasMore(invoicePage.hasMore);
      setGrantHasMore(grantPage.hasMore);
      setSelectedDocumentIds([]);
    } catch (error) {
      if (active) {
        setErrorMessage(error instanceof Error ? error.message : 'Client profile could not be loaded.');
      }
    } finally {
      if (active) setIsLoading(false);
    }
  }

  void load();

  return () => {
    active = false;
  };
  }, [clientId, dataService, isReady]);


  async function loadMoreInvoices() {
    try {
      const page = await dataService.listInvoicesPage(clientId, invoices.length, 100);
      setInvoices((current) => [...current, ...page.items]);
      setInvoiceHasMore(page.hasMore);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'More invoices could not be loaded.');
    }
  }

  async function loadMoreGrants() {
    try {
      const page = await dataService.listGrantsPage(clientId, grants.length, 100);
      setGrants((current) => [...current, ...page.items]);
      setGrantHasMore(page.hasMore);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'More grant entries could not be loaded.');
    }
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || client.status === 'archived') return;
    setIsSaving(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const updated = await dataService.updateClient(client.id, form);
      setClient(updated);
      setEditing(false);
      setSuccessMessage('Client profile updated.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Client profile could not be saved.');
    } finally {
      setIsSaving(false);
    }
  }

  async function uploadDocument(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || client.status === 'archived') return;
    const formElement = event.currentTarget;
    const input = formElement.elements.namedItem('client-document') as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return;
    setIsUploading(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const added = await dataService.stageDocument(client.id, file);
      setDocuments((current) => [added, ...current]);
      setSuccessMessage(`${added.fileName} uploaded.`);
      formElement.reset();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Document could not be uploaded.');
    } finally {
      setIsUploading(false);
    }
  }

  async function openDocument(documentRecord: DocumentRecord, download: boolean) {
    const previewWindow = download ? null : window.open('about:blank', '_blank');
    setBusyDocumentId(documentRecord.id);
    setErrorMessage('');
    try {
      const file = await dataService.readDocumentFile(clientId, documentRecord.id);
      const url = URL.createObjectURL(file);
      if (download) {
        const anchor = window.document.createElement('a');
        anchor.href = url;
        anchor.download = file.name;
        anchor.click();
      } else if (previewWindow) {
        previewWindow.location.href = url;
      } else {
        throw new Error('Allow pop-ups to preview this document.');
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      previewWindow?.close();
      setErrorMessage(error instanceof Error ? error.message : 'Document could not be opened.');
    } finally {
      setBusyDocumentId(null);
    }
  }

  async function renameDocument(documentRecord: DocumentRecord) {
    const draft = documentDrafts[documentRecord.id];
    if (!draft?.trim()) return;
    setBusyDocumentId(documentRecord.id);
    setErrorMessage('');
    try {
      const updated = await dataService.updateDocumentName(documentRecord.id, draft);
      setDocuments((current) => current.map((item) => item.id === updated.id ? updated : item));
      setDocumentDrafts((current) => { const next = { ...current }; delete next[documentRecord.id]; return next; });
      setSuccessMessage('Document name updated.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Document name could not be updated.');
    } finally {
      setBusyDocumentId(null);
    }
  }

  async function deleteDocument(documentRecord: DocumentRecord) {
    if (!window.confirm(`Delete ${documentRecord.fileName}? This removes the file and its metadata.`)) return;
    setBusyDocumentId(documentRecord.id);
    setErrorMessage('');
    try {
      await dataService.deleteDocument(documentRecord.id);
      setDocuments((current) => current.filter((item) => item.id !== documentRecord.id));
      setSelectedDocumentIds((current) => current.filter((id) => id !== documentRecord.id));
      setSuccessMessage(`${documentRecord.fileName} deleted.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Document could not be deleted.');
    } finally {
      setBusyDocumentId(null);
    }
  }

  async function askAssistant(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || !question.trim()) return;
    setIsAsking(true);
    setErrorMessage('');
    setAnswer('');
    try {
      let localDocuments: Array<{ fileName: string; mimeType: string; base64: string }> = [];
      if (preference === 'local') {
        const chosen = documents.filter((item) => selectedDocumentIds.includes(item.id));
        const files = await Promise.all(chosen.map((item) => dataService.readDocumentFile(client.id, item.id)));
        const totalBytes = files.reduce((total, file) => total + file.size, 0);
        if (totalBytes > 15 * 1024 * 1024) throw new Error('Selected files exceed the 15 MB assistant limit.');
        localDocuments = await Promise.all(files.map(async (file) => ({
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          base64: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
        })));
      }
      const response = await fetch('/api/client-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: preference,
          clientId: client.id,
          question: question.trim(),
          documentIds: preference === 'cloud' ? selectedDocumentIds : [],
          clientProfile: preference === 'local' ? client : undefined,
          documents: localDocuments,
        }),
      });
      const result = await response.json() as { answer?: string; error?: string };
      if (!response.ok) throw new Error(result.error || 'Assistant could not answer this question.');
      setAnswer(result.answer || 'No answer was returned.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Assistant could not answer this question.');
    } finally {
      setIsAsking(false);
    }
  }

  if (isLoading) {
    return <main className="mx-auto max-w-6xl px-5 py-10 text-sm text-zinc-400">Loading client profile...</main>;
  }

  if (!client) {
    return (
      <main className="mx-auto max-w-6xl px-5 py-10">
        <Link href="/dashboard" className="text-sm text-emerald-300 hover:text-emerald-200">Back to dashboard</Link>
        <h1 className="mt-6 text-xl font-semibold">Client not found</h1>
        {errorMessage && <p role="alert" className="mt-3 text-sm text-rose-300">{errorMessage}</p>}
      </main>
    );
  }

  const archived = client.status === 'archived';

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-950/95">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="w-full max-w-[420px]"><GlobalPageSearch /></div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="profile-storage-mode" className="text-xs text-zinc-400">Workspace</label>
            <select
              id="profile-storage-mode"
              value={storagePreference}
              onChange={(event) => void updateStoragePreference(event.target.value as 'local' | 'cloud')}
              className="border border-zinc-700 bg-zinc-900 px-2 py-2 text-xs text-zinc-200"
            >
              <option value="local">Local</option>
              <option value="cloud">Cloud</option>
            </select>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-5 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-800 pb-5">
          <div>
            <p className="text-xs font-semibold uppercase text-emerald-400">Client profile</p>
            <h1 className="mt-1 text-2xl font-semibold">{client.firstName} {client.lastName}</h1>
            <p className="mt-1 text-sm text-zinc-400">{client.company || client.email}</p>
            <p className="mt-2 text-xs text-zinc-500">{client.email} · {client.status}</p>
          </div>
          <div className="flex gap-2">
            {!editing && <button type="button" disabled={archived} onClick={() => setEditing(true)} className="border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-40">Edit profile</button>}
            <Link href="/dashboard" className="border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900">Full workspace</Link>
          </div>
        </div>

        {errorMessage && <div role="alert" className="border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">{errorMessage}</div>}
        {successMessage && <div role="status" className="border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">{successMessage}</div>}
        {archived && <p className="border border-amber-900/70 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">Archived clients are read-only. Restore this client from the dashboard to make changes.</p>}

        <section className="border border-zinc-800 bg-zinc-900/30">
          <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold">Client information</h2>
              <p className="mt-1 text-xs text-zinc-500">Record ID: <span className="font-mono">{client.id}</span></p>
            </div>
            <span className="text-xs text-zinc-500">Updated {formatDate(client.updatedAt)}</span>
          </div>
          <form onSubmit={(event) => void saveProfile(event)} className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
            <fieldset disabled={!editing || archived || isSaving} className="contents">
              <label className="space-y-1.5"><span className="text-xs text-zinc-400">First name</span><input required maxLength={120} value={form.firstName} onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))} className={fieldClass} /></label>
              <label className="space-y-1.5"><span className="text-xs text-zinc-400">Last name</span><input required maxLength={120} value={form.lastName} onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))} className={fieldClass} /></label>
              <label className="space-y-1.5"><span className="text-xs text-zinc-400">Email</span><input required type="email" maxLength={320} value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} className={fieldClass} /></label>
              <label className="space-y-1.5"><span className="text-xs text-zinc-400">Company</span><input maxLength={200} value={form.company ?? ''} onChange={(event) => setForm((current) => ({ ...current, company: event.target.value }))} className={fieldClass} /></label>
              <label className="space-y-1.5"><span className="text-xs text-zinc-400">Passport expiry</span><input type="date" value={form.passportExpiresAt ?? ''} onChange={(event) => setForm((current) => ({ ...current, passportExpiresAt: event.target.value || null }))} className={fieldClass} /></label>
              <label className="space-y-1.5"><span className="text-xs text-zinc-400">Visa subclass</span><input maxLength={40} value={form.visaSubclass ?? ''} onChange={(event) => setForm((current) => ({ ...current, visaSubclass: event.target.value }))} className={fieldClass} /></label>
              <label className="space-y-1.5"><span className="text-xs text-zinc-400">Visa expiry</span><input type="date" value={form.visaExpiresAt ?? ''} onChange={(event) => setForm((current) => ({ ...current, visaExpiresAt: event.target.value || null }))} className={fieldClass} /></label>
              <label className="space-y-1.5"><span className="text-xs text-zinc-400">Agent reminder date</span><input type="date" value={form.agentReminderDate ?? ''} onChange={(event) => setForm((current) => ({ ...current, agentReminderDate: event.target.value || null }))} className={fieldClass} /></label>
              <label className="space-y-1.5 sm:col-span-2 lg:col-span-1"><span className="text-xs text-zinc-400">Agent reminder note</span><input maxLength={500} value={form.agentReminderNote ?? ''} onChange={(event) => setForm((current) => ({ ...current, agentReminderNote: event.target.value }))} className={fieldClass} /></label>
            </fieldset>
            {editing && <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
              <button type="submit" disabled={isSaving} className="bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50">{isSaving ? 'Saving...' : 'Save changes'}</button>
              <button type="button" disabled={isSaving} onClick={() => { setEditing(false); void loadProfile(); }} className="border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800">Cancel</button>
            </div>}
          </form>
          <div className="border-t border-zinc-800 px-5 py-4"><CredentialVault clientId={client.id} clientName={`${client.firstName} ${client.lastName}`} /></div>
        </section>

        <section className="border border-zinc-800 bg-zinc-900/30">
          <div className="border-b border-zinc-800 px-5 py-4">
            <h2 className="text-base font-semibold">Client documents</h2>
            <p className="mt-1 text-xs text-zinc-500">{documents.length} document{documents.length === 1 ? '' : 's'} linked to this client</p>
          </div>
          {!archived && <form onSubmit={(event) => void uploadDocument(event)} className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-5 py-4">
            <input required name="client-document" type="file" className="min-w-0 flex-1 text-sm text-zinc-300 file:mr-3 file:border-0 file:bg-zinc-800 file:px-3 file:py-2 file:text-xs file:text-zinc-200" />
            <button type="submit" disabled={isUploading} className="bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50">{isUploading ? 'Uploading...' : 'Upload document'}</button>
          </form>}
          {documents.length === 0 ? <p className="px-5 py-8 text-sm text-zinc-500">No documents are linked to this client.</p> : <div className="divide-y divide-zinc-800">
            {documents.map((documentRecord) => <article key={documentRecord.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <input aria-label={`Include ${documentRecord.fileName} in assistant context`} type="checkbox" checked={selectedDocumentIds.includes(documentRecord.id)} onChange={(event) => setSelectedDocumentIds((current) => event.target.checked ? [...current, documentRecord.id] : current.filter((id) => id !== documentRecord.id))} className="mt-1 accent-emerald-500" />
                <div className="min-w-0 flex-1">
                  {documentDrafts[documentRecord.id] !== undefined ? <form onSubmit={(event) => { event.preventDefault(); void renameDocument(documentRecord); }} className="flex flex-wrap gap-2">
                    <input autoFocus required maxLength={255} aria-label={`Rename ${documentRecord.fileName}`} value={documentDrafts[documentRecord.id]} onChange={(event) => setDocumentDrafts((current) => ({ ...current, [documentRecord.id]: event.target.value }))} className="min-w-0 flex-1 border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
                    <button type="submit" disabled={busyDocumentId === documentRecord.id} className="border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800">Save name</button>
                    <button type="button" onClick={() => setDocumentDrafts((current) => { const next = { ...current }; delete next[documentRecord.id]; return next; })} className="border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800">Cancel</button>
                  </form> : <p className="truncate text-sm text-zinc-200">{documentRecord.fileName}</p>}
                  <p className="mt-1 text-xs text-zinc-500">{documentRecord.mimeType} · {(documentRecord.fileSize / 1024).toFixed(1)} KB · {formatDate(documentRecord.uploadedAt)}</p>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2 pl-6 lg:pl-0">
                <button type="button" disabled={busyDocumentId === documentRecord.id} onClick={() => void openDocument(documentRecord, false)} className="border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">View</button>
                <button type="button" disabled={busyDocumentId === documentRecord.id} onClick={() => void openDocument(documentRecord, true)} className="border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">Download</button>
                {!archived && <>
                  <button type="button" disabled={busyDocumentId !== null} onClick={() => setDocumentDrafts((current) => ({ ...current, [documentRecord.id]: documentRecord.fileName }))} className="border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">Rename</button>
                  <button type="button" disabled={busyDocumentId !== null} onClick={() => void deleteDocument(documentRecord)} className="border border-rose-900 px-3 py-2 text-xs text-rose-200 hover:bg-rose-950/50 disabled:opacity-50">Delete</button>
                </>}
              </div>
            </article>)}
          </div>}
        </section>

        <section className="border border-zinc-800 bg-zinc-900/30">
          <div className="border-b border-zinc-800 px-5 py-4">
            <h2 className="text-base font-semibold">Client assistant</h2>
            <p className="mt-1 text-xs text-zinc-500">Ask about this client. Only checked documents are included.</p>
          </div>
          <form onSubmit={(event) => void askAssistant(event)} className="space-y-4 p-5">
            <label className="block space-y-1.5"><span className="text-xs text-zinc-400">Question</span><textarea required maxLength={4000} rows={3} value={question} onChange={(event) => setQuestion(event.target.value)} className={`${fieldClass} resize-y`} /></label>
            <p className="text-xs leading-5 text-zinc-500">The client profile and checked documents are sent to the configured AI provider to answer. Review its output before acting on it.</p>
            <button type="submit" disabled={isAsking} className="bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50">{isAsking ? 'Thinking...' : 'Ask about this client'}</button>
            {answer && <div className="whitespace-pre-wrap border-t border-zinc-800 pt-4 text-sm leading-6 text-zinc-200">{answer}</div>}
          </form>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="border border-zinc-800 bg-zinc-900/30">
            <div className="border-b border-zinc-800 px-5 py-4"><h2 className="text-base font-semibold">Invoices</h2></div>
            {invoices.length === 0 ? <p className="px-5 py-5 text-sm text-zinc-500">No invoices for this client.</p> : <div className="divide-y divide-zinc-800">
              {invoices.map((invoice) => <div key={invoice.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <div><p className="text-zinc-200">{invoice.invoiceNumber}</p><p className="mt-1 text-xs text-zinc-500">{invoice.status} · due {formatDate(invoice.dueAt)}</p></div>
                <span className="font-mono text-zinc-200">{formatMoney(invoice.amountDue, invoice.currency)}</span>
              </div>)}
              {invoiceHasMore && <div className="p-4"><button type="button" onClick={() => void loadMoreInvoices()} className="border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800">Load more invoices</button></div>}
            </div>}
          </div>
          <div className="border border-zinc-800 bg-zinc-900/30">
            <div className="border-b border-zinc-800 px-5 py-4"><h2 className="text-base font-semibold">Grant activity</h2></div>
            {grants.length === 0 ? <p className="px-5 py-5 text-sm text-zinc-500">No grant entries for this client.</p> : <div className="divide-y divide-zinc-800">
              {grants.map((grant) => <div key={grant.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <div><p className="text-zinc-200">{grant.source}{grant.reference ? ` · ${grant.reference}` : ''}</p><p className="mt-1 text-xs text-zinc-500">{formatDate(grant.allocationDate)} · {grant.entryType}</p></div>
                <span className="font-mono text-zinc-200">{formatMoney(grant.amount, grant.currency)}</span>
              </div>)}
              {grantHasMore && <div className="p-4"><button type="button" onClick={() => void loadMoreGrants()} className="border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800">Load more grant entries</button></div>}
            </div>}
          </div>
        </section>
      </div>
    </main>
  );
}

function ClientProfileRoute({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = use(params);
  return (
    <DashboardStorageProvider>
      <ClientProfileContent clientId={clientId} />
    </DashboardStorageProvider>
  );
}

export default function ClientProfilePage({ params }: { params: Promise<{ clientId: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto max-w-6xl px-5 py-10 text-sm text-zinc-400">Loading client profile...</main>}>
      <ClientProfileRoute params={params} />
    </Suspense>
  );
}