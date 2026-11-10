'use client';

import React, { createContext, useContext, useMemo } from 'react';
import { getSupabaseClient } from '../../src/lib/supabase';
import { useStorage, type StoragePreference } from '../../src/context/StorageContext';

const DATABASE_NAME = 'crm-migration-local';
const DATABASE_VERSION = 5;
export const ARCHIVE_RETENTION_DAYS = 90;
const CLIENTS_STORE = 'clients';
const DOCUMENTS_STORE = 'documents';
const CREDENTIALS_STORE = 'credentials';
const INVOICES_STORE = 'financial_invoices';
const PAYMENTS_STORE = 'financial_invoice_payments';
const GRANTS_STORE = 'grants_ledger';
const GOVERNANCE_NOTIFICATIONS_STORE = 'governance_notifications';
const SETTINGS_STORE = 'settings';
const DIRECTORY_SETTING_KEY = 'document-directory';
const STORAGE_BUCKET = process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET || 'client-documents';

type StoreName =
  | typeof CLIENTS_STORE
  | typeof DOCUMENTS_STORE
  | typeof CREDENTIALS_STORE
  | typeof INVOICES_STORE
  | typeof PAYMENTS_STORE
  | typeof GRANTS_STORE
  | typeof GOVERNANCE_NOTIFICATIONS_STORE
  | typeof SETTINGS_STORE;
type FilePermission = 'granted' | 'denied' | 'prompt';

export interface ClientRecord {
  id: string;
  assignedAgentId: string | null;
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  status: string;
  archivedAt: string | null;
  purgeEligibleAt: string | null;
  createdAt: string;
  lastInteractionAt: string;
  updatedAt: string;
  passportExpiresAt: string | null;
  visaSubclass: string;
  visaExpiresAt: string | null;
}

export interface ClientInput {
  firstName: string;
  lastName: string;
  email: string;
  company?: string;
  passportExpiresAt?: string | null;
  visaSubclass?: string;
  visaExpiresAt?: string | null;
}

export interface DocumentRecord {
  id: string;
  clientId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  storagePath: string;
  uploadedAt: string;
}

export interface CredentialRecord {
  id: string;
  clientId: string;
  portalName: string;
  lastVerified: string;
}

export interface InvoiceRecord {
  id: string;
  clientId: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  grantAppliedAmount: number;
  amountDue: number;
  dueAt: string | null;
}

export const INVOICE_STATUSES = ['draft', 'issued', 'outstanding', 'paid', 'void', 'overdue'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export interface InvoiceInput {
  clientId: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  dueAt: string | null;
}

export interface PurgeInvoiceBlocker {
  clientId: string;
  invoiceNumber: string;
  status: string;
  amount: number;
  currency: string;
}

export interface PurgeReview {
  blockedInvoices: PurgeInvoiceBlocker[];
  attachmentCount: number;
}

export const GRANT_ENTRY_TYPES = ['credit', 'debit', 'adjustment'] as const;
export type GrantEntryType = (typeof GRANT_ENTRY_TYPES)[number];

export interface GrantRecord {
  id: string;
  clientId: string;
  entryType: GrantEntryType;
  amount: number;
  currency: string;
  reference: string | null;
  description: string;
  source: string;
  allocationDate: string;
  createdAt: string;
}

export interface GrantInput {
  clientId: string;
  amount: number;
  currency: string;
  reference: string | null;
  description: string;
  source: string;
  allocationDate: string;
}

export interface GrantBalance {
  clientId: string;
  currency: string;
  availableBalance: number;
}

export interface GovernanceNotification {
  id: string;
  clientId: string;
  documentType: 'passport' | 'visa';
  expiresOn: string;
  noticeDays: 90 | 60 | 30;
  title: string;
  message: string;
  deliveryStatus: 'queued' | 'simulated' | 'sent' | 'failed';
  createdAt: string;
  deliveredAt: string | null;
}

export interface PageResult<T> {
  items: T[];
  hasMore: boolean;
}

export interface ClientFinancialSummary {
  invoiceCount: number;
  overdueInvoiceCount: number;
  grantCount: number;
  outstandingByCurrency: Array<{ currency: string; amount: number }>;
}

export interface IDataService {
  readonly preference: StoragePreference;
  listClientPage(archived: boolean, offset: number, limit: number): Promise<PageResult<ClientRecord>>;
  listClients(): Promise<ClientRecord[]>;
  saveClient(input: ClientInput): Promise<ClientRecord>;
  updateClient(id: string, input: ClientInput): Promise<ClientRecord>;
  archiveClient(id: string): Promise<void>;
  listArchivedClients(): Promise<ClientRecord[]>;
  listDocumentsPage(clientId: string, offset: number, limit: number): Promise<PageResult<DocumentRecord>>;
  restoreClient(id: string): Promise<void>;
  listDocuments(clientId?: string): Promise<DocumentRecord[]>;
  selectDocumentFolder(): Promise<string | null>;
  stageDocument(clientId: string, file: File): Promise<DocumentRecord>;
  listCredentials(clientId: string): Promise<CredentialRecord[]>;
  listInvoicesPage(clientId: string, offset: number, limit: number): Promise<PageResult<InvoiceRecord>>;
  getClientFinancialSummary(clientId: string): Promise<ClientFinancialSummary>;
  listInvoices(): Promise<InvoiceRecord[]>;
  createInvoice(input: InvoiceInput): Promise<InvoiceRecord>;
  recordInvoicePayment(id: string, amount: number): Promise<InvoiceRecord>;
  listGrantsPage(clientId: string, offset: number, limit: number): Promise<PageResult<GrantRecord>>;
  listGrants(): Promise<GrantRecord[]>;
  listGrantBalances(clientId?: string): Promise<GrantBalance[]>;
  createGrant(input: GrantInput): Promise<GrantRecord>;
  listGovernanceNotifications(): Promise<GovernanceNotification[]>;
  reviewPurge(clientIds: string[]): Promise<PurgeReview>;
  purgeClients(clientIds: string[]): Promise<void>;
}

const MAX_PAGE_SIZE = 100;

function normalizePageBounds(offset: number, limit: number): { offset: number; limit: number } {
  return {
    offset: Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0,
    limit: Number.isFinite(limit) ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(limit))) : 50,
  };
}

function paginateRows<T>(rows: T[], offset: number, limit: number): PageResult<T> {
  const { offset: pageOffset, limit: pageLimit } = normalizePageBounds(offset, limit);
  const page = rows.slice(pageOffset, pageOffset + pageLimit + 1);
  return { items: page.slice(0, pageLimit), hasMore: page.length > pageLimit };
}

interface DirectoryHandleLike {
  readonly name: string;
  queryPermission(options: { mode: 'readwrite' }): Promise<FilePermission>;
  requestPermission(options: { mode: 'readwrite' }): Promise<FilePermission>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
  removeEntry(name: string): Promise<void>;
}

interface WritableHandleLike {
  write(data: ArrayBuffer): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}

interface FileHandleLike {
  createWritable(): Promise<WritableHandleLike>;
}

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options: { mode: 'readwrite' }) => Promise<DirectoryHandleLike>;
}

interface DirectorySetting {
  key: typeof DIRECTORY_SETTING_KEY;
  handle: DirectoryHandleLike;
}

interface StoredClient extends ClientRecord {
  name: string;
}

const databasePromises = new Map<string, Promise<IDBDatabase>>();

async function getAuthorizedLocalScope(): Promise<string> {
  const supabase = getSupabaseClient();
  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError || !userResult.user) throw new Error('Sign in before using Local storage.');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('default_organization_id')
    .eq('user_id', userResult.user.id)
    .single();
  if (profileError || !profile?.default_organization_id) throw new Error('Join an organization before using Local storage.');

  const { data: membership, error: membershipError } = await supabase
    .from('organization_memberships')
    .select('user_id')
    .eq('organization_id', profile.default_organization_id)
    .eq('user_id', userResult.user.id)
    .maybeSingle();
  if (membershipError || !membership) throw new Error('Organization access is required for Local storage.');
  return String(userResult.user.id);
}

function openLocalDatabase(): Promise<IDBDatabase> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.reject(new Error('IndexedDB is unavailable in this browser.'));
  }
  return getAuthorizedLocalScope().then((userScope) => {
    const existing = databasePromises.get(userScope);
    if (existing) return existing;

    const databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(`${DATABASE_NAME}-${userScope}`, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CLIENTS_STORE)) database.createObjectStore(CLIENTS_STORE, { keyPath: 'id' });
      if (!database.objectStoreNames.contains(DOCUMENTS_STORE)) database.createObjectStore(DOCUMENTS_STORE, { keyPath: 'id' });
      if (!database.objectStoreNames.contains(CREDENTIALS_STORE)) database.createObjectStore(CREDENTIALS_STORE, { keyPath: 'id' });
      if (!database.objectStoreNames.contains(INVOICES_STORE)) database.createObjectStore(INVOICES_STORE, { keyPath: 'id' });
      if (!database.objectStoreNames.contains(PAYMENTS_STORE)) database.createObjectStore(PAYMENTS_STORE, { keyPath: 'id' });
      if (!database.objectStoreNames.contains(GRANTS_STORE)) database.createObjectStore(GRANTS_STORE, { keyPath: 'id' });
      if (!database.objectStoreNames.contains(GOVERNANCE_NOTIFICATIONS_STORE)) database.createObjectStore(GOVERNANCE_NOTIFICATIONS_STORE, { keyPath: 'id' });
      if (!database.objectStoreNames.contains(SETTINGS_STORE)) database.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        databasePromises.delete(userScope);
      };
      resolve(request.result);
    };
    request.onerror = () => {
      databasePromises.delete(userScope);
      reject(request.error ?? new Error('Unable to open local IndexedDB.'));
    };
    request.onblocked = () => {
      databasePromises.delete(userScope);
      reject(new Error('Close other app tabs to finish the local database upgrade.'));
    };
    });

    databasePromises.set(userScope, databasePromise);
    return databasePromise;
  });
}

function localRequest<T>(
  storeName: StoreName,
  mode: IDBTransactionMode,
  createRequest: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openLocalDatabase().then((database) => new Promise((resolve, reject) => {
    let result: T;
    const transaction = database.transaction(storeName, mode);
    const request = createRequest(transaction.objectStore(storeName));
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error ?? new Error(`IndexedDB request failed: ${storeName}`));
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error ?? new Error(`IndexedDB transaction failed: ${storeName}`));
    transaction.onabort = () => reject(transaction.error ?? new Error(`IndexedDB transaction aborted: ${storeName}`));
  }));
}

async function removeLocalAttachments(clientIds: string[]): Promise<void> {
  const selectedIds = new Set(clientIds);
  const documents = await localRequest<Record<string, unknown>[]>(DOCUMENTS_STORE, 'readonly', (store) => store.getAll());
  const selectedDocuments = documents.filter((document) => selectedIds.has(String(document.clientId ?? document.client_id ?? '')));
  if (selectedDocuments.length === 0) return;

  const setting = await localRequest<DirectorySetting | undefined>(SETTINGS_STORE, 'readonly', (store) => store.get(DIRECTORY_SETTING_KEY));
  if (!setting || await setting.handle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
    throw new Error('Local attachment purge blocked: restore access to the selected document folder and retry.');
  }

  for (const document of selectedDocuments) {
    const clientId = String(document.clientId ?? document.client_id ?? '');
    const storagePath = String(document.storagePath ?? document.storage_path ?? '');
    if (storagePath.startsWith('blob:')) continue;
    if (!storagePath) {
      throw new Error('Local attachment purge blocked: a document record has no stored file path.');
    }

    const [folderName, fileName, ...extraSegments] = storagePath.split('/');
    if (
      !folderName ||
      !fileName ||
      extraSegments.length > 0 ||
      folderName !== sanitizePathSegment(clientId)
    ) {
      throw new Error('Local attachment purge blocked: a stored file path failed validation.');
    }

    try {
      const clientFolder = await setting.handle.getDirectoryHandle(folderName);
      await clientFolder.removeEntry(fileName);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') continue;
      throw new Error('Local attachment cleanup failed; client records were retained.');
    }
  }
}

async function deleteLocalClientRecords(clientIds: string[]): Promise<void> {
  const selectedIds = new Set(clientIds);
  const stores: StoreName[] = [
    DOCUMENTS_STORE,
    CREDENTIALS_STORE,
    INVOICES_STORE,
    PAYMENTS_STORE,
    GRANTS_STORE,
    GOVERNANCE_NOTIFICATIONS_STORE,
    CLIENTS_STORE,
  ];

  for (const storeName of stores) {
    const rows = await localRequest<Record<string, unknown>[]>(storeName, 'readonly', (store) => store.getAll());
    for (const row of rows) {
      const recordClientId = storeName === CLIENTS_STORE
        ? String(row.id)
        : String(row.clientId ?? row.client_id ?? '');
      if (selectedIds.has(recordClientId)) {
        await localRequest(storeName, 'readwrite', (store) => store.delete(String(row.id)));
      }
    }
  }
}

function sanitizePathSegment(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 120) || 'document';
}

function normalizeLocalClient(value: StoredClient | Record<string, unknown>): ClientRecord {
  const row = value as Record<string, unknown>;
  const name = String(row.name ?? `${row.firstName ?? ''} ${row.lastName ?? ''}`).trim();
  const parts = name.split(/\s+/);
  const archivedAt = row.archivedAt ? String(row.archivedAt) : row.status === 'archived' ? String(row.updatedAt ?? row.updated_at ?? '') : null;
  return {
    id: String(row.id),
    assignedAgentId: row.assignedAgentId ? String(row.assignedAgentId) : null,
    firstName: String(row.firstName ?? parts.shift() ?? ''),
    lastName: String(row.lastName ?? parts.join(' ')),
    email: String(row.email ?? ''),
    company: String(row.company ?? ''),
    status: String(row.status ?? 'active'),
    archivedAt: archivedAt || null,
    purgeEligibleAt: archivedAt ? new Date(Date.parse(archivedAt) + ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString() : null,
    createdAt: String(row.createdAt ?? row.created_at ?? row.updatedAt ?? row.updated_at ?? new Date().toISOString()),
    lastInteractionAt: String(row.lastInteractionAt ?? row.updatedAt ?? row.updated_at ?? row.createdAt ?? row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updatedAt ?? row.updated_at ?? row.created_at ?? new Date().toISOString()),
    passportExpiresAt: row.passportExpiresAt ? String(row.passportExpiresAt) : null,
    visaSubclass: String(row.visaSubclass ?? ''),
    visaExpiresAt: row.visaExpiresAt ? String(row.visaExpiresAt) : null,
  };
}

function mapCloudClient(row: Record<string, unknown>): ClientRecord {
  return {
    id: String(row.id),
    assignedAgentId: row.assigned_agent_id ? String(row.assigned_agent_id) : null,
    firstName: String(row.first_name ?? ''),
    lastName: String(row.last_name ?? ''),
    email: String(row.email ?? ''),
    company: String(row.company ?? ''),
    status: String(row.status ?? 'active'),
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    purgeEligibleAt: row.archived_at ? new Date(Date.parse(String(row.archived_at)) + ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString() : null,
    createdAt: String(row.created_at ?? ''),
    lastInteractionAt: String(row.last_interaction_at ?? row.updated_at ?? row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? row.created_at ?? ''),
    passportExpiresAt: row.passport_expires_at ? String(row.passport_expires_at) : null,
    visaSubclass: String(row.visa_subclass ?? ''),
    visaExpiresAt: row.visa_expires_at ? String(row.visa_expires_at) : null,
  };
}

function mapDocument(row: Record<string, unknown>): DocumentRecord {
  return {
    id: String(row.id),
    clientId: String(row.client_id ?? row.clientId ?? ''),
    fileName: String(row.file_name ?? row.fileName ?? ''),
    fileSize: Number(row.file_size ?? row.fileSize ?? 0),
    mimeType: String(row.mime_type ?? row.mimeType ?? 'application/octet-stream'),
    storagePath: String(row.storage_path ?? row.storagePath ?? ''),
    uploadedAt: String(row.created_at ?? row.uploadedAt ?? ''),
  };
}

function mapCloudInvoice(row: Record<string, unknown>): InvoiceRecord {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    invoiceNumber: String(row.invoice_number),
    amount: Number(row.amount),
    currency: String(row.currency),
    status: String(row.status) as InvoiceStatus,
    grantAppliedAmount: Number(row.grant_applied_amount ?? 0),
    amountDue: Number(row.amount_due ?? row.amount),
    dueAt: row.due_at ? String(row.due_at) : null,
  };
}

function mapCloudGrant(row: Record<string, unknown>): GrantRecord {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    entryType: String(row.entry_type) as GrantEntryType,
    amount: Number(row.amount),
    currency: String(row.currency),
    reference: row.reference ? String(row.reference) : null,
    description: String(row.description ?? ''),
    source: String(row.grant_source ?? row.reference ?? ''),
    allocationDate: String(row.allocation_date ?? row.created_at ?? '').slice(0, 10),
    createdAt: String(row.created_at),
  };
}

function normalizeCurrencyCode(currency: unknown): string {
  return String(currency ?? '').trim().toUpperCase();
}

function normalizeInvoiceInput(input: InvoiceInput): InvoiceInput {
  const invoiceNumber = input.invoiceNumber.trim();
  const currency = normalizeCurrencyCode(input.currency);
  if (!input.clientId.trim()) throw new Error('Select a client for this invoice.');
  if (!invoiceNumber || invoiceNumber.length > 80) throw new Error('Invoice number must be 1 to 80 characters.');
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('Invoice amount must be greater than zero.');
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Currency must be a three-letter code, such as USD.');
  return { ...input, invoiceNumber, currency };
}

function normalizeGrantInput(input: GrantInput): GrantInput {
  const currency = normalizeCurrencyCode(input.currency);
  if (!input.clientId.trim()) throw new Error('Select a client for this grant entry.');
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('Grant amount must be greater than zero.');
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Currency must be a three-letter code, such as USD.');
  const source = input.source.trim();
  if (!source || source.length > 160) throw new Error('Grant source must be 1 to 160 characters.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.allocationDate)) throw new Error('Choose a valid allocation date.');
  return {
    ...input,
    currency,
    source,
    allocationDate: input.allocationDate,
    reference: input.reference?.trim() || null,
    description: input.description.trim(),
  };
}

function throwSupabaseError(error: { message: string; code?: string }, operation: string): never {
  if (error.code === '42703' && error.message.includes('assigned_agent_id')) {
    throw new Error(
      'The client assignment migration is not applied. Apply supabase/migrations/20261110030000_client_agent_assignment.sql, then retry.'
    );
  }
  throw new Error(`Supabase ${operation} failed${error.code ? ` (${error.code})` : ''}: ${error.message}`);
}

async function getActiveOrganizationId(): Promise<string> {
  const supabase = getSupabaseClient();
  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError || !userResult.user) throw new Error('Sign in before using cloud storage.');

  const { data, error } = await supabase
    .from('profiles')
    .select('default_organization_id')
    .eq('user_id', userResult.user.id)
    .single();
  if (error) throwSupabaseError(error, 'organization lookup');
  if (!data.default_organization_id) throw new Error('Your profile has no default organization.');
  return String(data.default_organization_id);
}

class IndexedDbDataService implements IDataService {
  readonly preference = 'local' as const;

  async listClientPage(archived: boolean, offset: number, limit: number): Promise<PageResult<ClientRecord>> {
    const rows = archived ? await this.listArchivedClients() : await this.listClients();
    return paginateRows(rows, offset, limit);
  }

  async listClients(): Promise<ClientRecord[]> {
    const rows = await localRequest<(StoredClient | Record<string, unknown>)[]>(CLIENTS_STORE, 'readonly', (store) => store.getAll());
    return rows
      .map(normalizeLocalClient)
      .filter((client) => client.status !== 'archived')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listArchivedClients(): Promise<ClientRecord[]> {
    const rows = await localRequest<(StoredClient | Record<string, unknown>)[]>(CLIENTS_STORE, 'readonly', (store) => store.getAll());
    return rows
      .map(normalizeLocalClient)
      .filter((client) => client.status === 'archived')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async saveClient(input: ClientInput): Promise<ClientRecord> {
    const now = new Date().toISOString();
    const client: StoredClient = {
      id: crypto.randomUUID(),
      assignedAgentId: null,
      ...input,
      company: input.company ?? '',
      name: `${input.firstName.trim()} ${input.lastName.trim()}`.trim(),
      status: 'active',
      archivedAt: null,
      purgeEligibleAt: null,
      createdAt: now,
      lastInteractionAt: now,
      updatedAt: now,
      passportExpiresAt: input.passportExpiresAt || null,
      visaSubclass: input.visaSubclass?.trim() ?? '',
      visaExpiresAt: input.visaExpiresAt || null,
    };
    await localRequest(CLIENTS_STORE, 'readwrite', (store) => store.put(client));
    return normalizeLocalClient(client);
  }

  async updateClient(id: string, input: ClientInput): Promise<ClientRecord> {
    const existing = await localRequest<StoredClient | undefined>(CLIENTS_STORE, 'readonly', (store) => store.get(id));
    if (!existing) throw new Error('Client record not found.');
    const client: StoredClient = {
      ...existing,
      ...input,
      company: input.company ?? '',
      name: `${input.firstName.trim()} ${input.lastName.trim()}`.trim(),
      createdAt: existing.createdAt ?? existing.updatedAt,
      lastInteractionAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      passportExpiresAt: input.passportExpiresAt || null,
      visaSubclass: input.visaSubclass?.trim() ?? '',
      visaExpiresAt: input.visaExpiresAt || null,
    };
    await localRequest(CLIENTS_STORE, 'readwrite', (store) => store.put(client));
    return normalizeLocalClient(client);
  }

  async archiveClient(id: string): Promise<void> {
    const client = await localRequest<StoredClient | undefined>(CLIENTS_STORE, 'readonly', (store) => store.get(id));
    if (!client) throw new Error('Client record not found.');
    const archivedAt = new Date().toISOString();
    await localRequest(CLIENTS_STORE, 'readwrite', (store) => store.put({
      ...client,
      status: 'archived',
      archivedAt,
      updatedAt: archivedAt,
    }));
  }

  async restoreClient(id: string): Promise<void> {
    const client = await localRequest<StoredClient | undefined>(CLIENTS_STORE, 'readonly', (store) => store.get(id));
    if (!client || client.status !== 'archived') throw new Error('Archived client record not found.');
    await localRequest(CLIENTS_STORE, 'readwrite', (store) => store.put({
      ...client,
      status: 'active',
      archivedAt: null,
      updatedAt: new Date().toISOString(),
    }));
  }

  async listDocuments(clientId?: string): Promise<DocumentRecord[]> {
    const rows = await localRequest<Record<string, unknown>[]>(DOCUMENTS_STORE, 'readonly', (store) => store.getAll());
    return rows
      .map(mapDocument)
      .filter((document) => !clientId || document.clientId === clientId)
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }

  async listDocumentsPage(clientId: string, offset: number, limit: number): Promise<PageResult<DocumentRecord>> {
    const rows = await this.listDocuments(clientId);
    return paginateRows(rows, offset, limit);
  }

  async selectDocumentFolder(): Promise<string | null> {
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker) throw new Error('Folder selection requires a supported browser on HTTPS or localhost.');
    try {
      const handle = await picker({ mode: 'readwrite' });
      const permission = await handle.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') throw new Error('Write access to the selected folder was not granted.');
      await localRequest(SETTINGS_STORE, 'readwrite', (store) => store.put({ key: DIRECTORY_SETTING_KEY, handle } satisfies DirectorySetting));
      return handle.name;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return null;
      throw error;
    }
  }

  async stageDocument(clientId: string, file: File): Promise<DocumentRecord> {
    const setting = await localRequest<DirectorySetting | undefined>(SETTINGS_STORE, 'readonly', (store) => store.get(DIRECTORY_SETTING_KEY));
    if (!setting) throw new Error('Select a local document folder before staging a file.');
    if (await setting.handle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
      throw new Error('Folder access expired. Select the local document folder again.');
    }

    const clientFolder = await setting.handle.getDirectoryHandle(sanitizePathSegment(clientId), { create: true });
    const fileName = `${crypto.randomUUID()}-${sanitizePathSegment(file.name)}`;
    const fileHandle = await clientFolder.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(await file.arrayBuffer());
      await writable.close();
    } catch (error) {
      await writable.abort(error).catch(() => undefined);
      await clientFolder.removeEntry(fileName).catch(() => undefined);
      throw error;
    }

    const document: DocumentRecord = {
      id: crypto.randomUUID(),
      clientId,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || 'application/octet-stream',
      storagePath: `${sanitizePathSegment(clientId)}/${fileName}`,
      uploadedAt: new Date().toISOString(),
    };
    try {
      await localRequest(DOCUMENTS_STORE, 'readwrite', (store) => store.put(document));
    } catch (error) {
      await clientFolder.removeEntry(fileName).catch(() => undefined);
      throw error;
    }
    return document;
  }

  async listCredentials(clientId: string): Promise<CredentialRecord[]> {
    const rows = await localRequest<Record<string, unknown>[]>(CREDENTIALS_STORE, 'readonly', (store) => store.getAll());
    return rows
      .filter((row) => row.clientId === clientId)
      .map((row) => ({
        id: String(row.id),
        clientId: String(row.clientId),
        portalName: String(row.portalName ?? ''),
        lastVerified: String(row.lastVerified ?? ''),
      }));
  }

  async listInvoices(): Promise<InvoiceRecord[]> {
    const invoices = await localRequest<Array<InvoiceRecord & Record<string, unknown>>>(INVOICES_STORE, 'readonly', (store) => store.getAll());
    return invoices.map((invoice) => ({
      ...invoice,
      grantAppliedAmount: Number(invoice.grantAppliedAmount ?? 0),
      amountDue: Number(invoice.amountDue ?? invoice.amount),
    }));
  }

  async listInvoicesPage(clientId: string, offset: number, limit: number): Promise<PageResult<InvoiceRecord>> {
    const rows = (await this.listInvoices())
      .filter((invoice) => invoice.clientId === clientId)
      .sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? '') || a.id.localeCompare(b.id));
    return paginateRows(rows, offset, limit);
  }

  async getClientFinancialSummary(clientId: string): Promise<ClientFinancialSummary> {
    const [invoices, grants] = await Promise.all([this.listInvoices(), this.listGrants()]);
    const clientInvoices = invoices.filter((invoice) => invoice.clientId === clientId);
    const outstanding = new Map<string, number>();
    for (const invoice of clientInvoices) {
      if (invoice.amountDue > 0) {
        outstanding.set(invoice.currency, (outstanding.get(invoice.currency) ?? 0) + invoice.amountDue);
      }
    }
    return {
      invoiceCount: clientInvoices.length,
      overdueInvoiceCount: clientInvoices.filter((invoice) => invoice.status === 'overdue').length,
      grantCount: grants.filter((grant) => grant.clientId === clientId).length,
      outstandingByCurrency: [...outstanding].map(([currency, amount]) => ({ currency, amount })),
    };
  }

  async createInvoice(input: InvoiceInput): Promise<InvoiceRecord> {
    const invoiceInput = normalizeInvoiceInput(input);
    const database = await openLocalDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([CLIENTS_STORE, GRANTS_STORE, INVOICES_STORE], 'readwrite');
      const clientRequest = transaction.objectStore(CLIENTS_STORE).get(invoiceInput.clientId);
      const grantsRequest = transaction.objectStore(GRANTS_STORE).getAll();
      let client: Record<string, unknown> | undefined;
      let grantEntries: Array<Record<string, unknown>> = [];
      let readyRequests = 0;
      let invoice: InvoiceRecord | undefined;
      let failure: Error | undefined;

      const prepareInvoice = () => {
        readyRequests += 1;
        if (readyRequests < 2) return;
        if (!client || client.status === 'archived') {
          failure = new Error('The selected active client could not be found.');
          transaction.abort();
          return;
        }

        const balance = grantEntries.reduce((total, entry) => {
          if (
            String(entry.clientId ?? entry.client_id) !== invoiceInput.clientId ||
            normalizeCurrencyCode(entry.currency) !== normalizeCurrencyCode(invoiceInput.currency)
          ) return total;
          const amount = Number(entry.amount ?? 0);
          if (entry.entryType === 'debit' || entry.entry_type === 'debit') return total - amount;
          return total + amount;
        }, 0);
        const grantAppliedAmount = Math.min(Math.max(0, balance), invoiceInput.amount);
        const amountDue = invoiceInput.amount - grantAppliedAmount;
        const invoiceStatus: InvoiceStatus = amountDue === 0 ? 'paid' : 'outstanding';
        invoice = {
          id: crypto.randomUUID(),
          ...invoiceInput,
          status: invoiceStatus,
          grantAppliedAmount,
          amountDue,
        };

        transaction.objectStore(INVOICES_STORE).add(invoice);
        if (grantAppliedAmount > 0) {
          const debit: GrantRecord = {
            id: crypto.randomUUID(),
            clientId: invoiceInput.clientId,
            entryType: 'debit',
            amount: grantAppliedAmount,
            currency: invoiceInput.currency,
            reference: invoiceInput.invoiceNumber,
            description: 'Grant funds applied to invoice',
            source: 'Invoice settlement',
            allocationDate: new Date().toISOString().slice(0, 10),
            createdAt: new Date().toISOString(),
          };
          transaction.objectStore(GRANTS_STORE).add(debit);
        }
      };

      clientRequest.onsuccess = () => {
        client = clientRequest.result as Record<string, unknown> | undefined;
        prepareInvoice();
      };
      grantsRequest.onsuccess = () => {
        grantEntries = grantsRequest.result as Array<Record<string, unknown>>;
        prepareInvoice();
      };
      clientRequest.onerror = () => { failure = new Error('Unable to verify the selected client.'); transaction.abort(); };
      grantsRequest.onerror = () => { failure = new Error('Unable to read grant balances.'); transaction.abort(); };
      transaction.oncomplete = () => invoice ? resolve(invoice) : reject(new Error('Invoice transaction did not complete.'));
      transaction.onerror = () => reject(failure ?? transaction.error ?? new Error('Invoice transaction failed.'));
      transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Invoice transaction was cancelled.'));
    });
  }

  async recordInvoicePayment(id: string, amount: number): Promise<InvoiceRecord> {
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Payment amount must be greater than zero.');
    const database = await openLocalDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([INVOICES_STORE, PAYMENTS_STORE], 'readwrite');
      const invoiceRequest = transaction.objectStore(INVOICES_STORE).get(id);
      let updatedInvoice: InvoiceRecord | undefined;
      let failure: Error | undefined;

      invoiceRequest.onsuccess = () => {
        const existing = invoiceRequest.result as InvoiceRecord | undefined;
        if (!existing) {
          failure = new Error('Invoice record not found.');
          transaction.abort();
          return;
        }
        const currentDue = Number(existing.amountDue ?? existing.amount);
        const paymentAmount = Number(amount.toFixed(2));
        if (paymentAmount > currentDue || currentDue <= 0) {
          failure = new Error('Payment cannot exceed the outstanding invoice balance.');
          transaction.abort();
          return;
        }

        const amountDue = Number((currentDue - paymentAmount).toFixed(2));
        updatedInvoice = {
          ...existing,
          amountDue,
          status: amountDue === 0 ? 'paid' : 'outstanding',
        };
        transaction.objectStore(INVOICES_STORE).put(updatedInvoice);
        transaction.objectStore(PAYMENTS_STORE).add({
          id: crypto.randomUUID(),
          invoiceId: id,
          clientId: existing.clientId,
          amount: paymentAmount,
          paidAt: new Date().toISOString(),
        });
      };
      invoiceRequest.onerror = () => { failure = new Error('Unable to read invoice balance.'); transaction.abort(); };
      transaction.oncomplete = () => updatedInvoice ? resolve(updatedInvoice) : reject(new Error('Payment transaction did not complete.'));
      transaction.onerror = () => reject(failure ?? transaction.error ?? new Error('Payment transaction failed.'));
      transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Payment transaction was cancelled.'));
    });
  }

  async listGrants(): Promise<GrantRecord[]> {
    const rows = await localRequest<Array<GrantRecord & Record<string, unknown>>>(GRANTS_STORE, 'readonly', (store) => store.getAll());
    return rows.map((row) => ({
      ...row,
      source: String(row.source ?? row.reference ?? ''),
      allocationDate: String(row.allocationDate ?? row.createdAt ?? '').slice(0, 10),
    })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listGrantsPage(clientId: string, offset: number, limit: number): Promise<PageResult<GrantRecord>> {
    const rows = (await this.listGrants()).filter((grant) => grant.clientId === clientId);
    return paginateRows(rows, offset, limit);
  }

  async listGrantBalances(clientId?: string): Promise<GrantBalance[]> {
    const grants = await this.listGrants();
    const balances = new Map<string, GrantBalance>();
    for (const grant of grants) {
      if (clientId && grant.clientId !== clientId) continue;
      const currency = normalizeCurrencyCode(grant.currency);
      const key = `${grant.clientId}:${currency}`;
      const balance = balances.get(key) ?? { clientId: grant.clientId, currency, availableBalance: 0 };
      balance.availableBalance += grant.entryType === 'debit' ? -grant.amount : grant.amount;
      balances.set(key, balance);
    }
    return [...balances.values()].map((balance) => ({ ...balance, availableBalance: Math.max(0, balance.availableBalance) }));
  }

  async createGrant(input: GrantInput): Promise<GrantRecord> {
    const grantInput = normalizeGrantInput(input);
    const clients = await this.listClients();
    if (!clients.some((client) => client.id === grantInput.clientId)) {
      throw new Error('The selected client could not be found.');
    }
    const grant: GrantRecord = {
      id: crypto.randomUUID(),
      entryType: 'credit',
      ...grantInput,
      createdAt: new Date().toISOString(),
    };
    await localRequest(GRANTS_STORE, 'readwrite', (store) => store.add(grant));
    return grant;
  }

  async listGovernanceNotifications(): Promise<GovernanceNotification[]> {
    const rows = await localRequest<GovernanceNotification[]>(GOVERNANCE_NOTIFICATIONS_STORE, 'readonly', (store) => store.getAll());
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async reviewPurge(clientIds: string[]): Promise<PurgeReview> {
    const selectedIds = new Set(clientIds);
    const clients = await localRequest<Array<Record<string, unknown>>>(CLIENTS_STORE, 'readonly', (store) => store.getAll());
    const selectedClients = clients.filter((client) => selectedIds.has(String(client.id)));
    const cutoff = Date.now() - ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const retentionBlocked = selectedClients.length !== selectedIds.size || selectedClients.some((client) => (
      client.status !== 'archived'
      || !(client.archivedAt ?? client.updatedAt)
      || Date.parse(String(client.archivedAt ?? client.updatedAt)) > cutoff
    ));
    if (retentionBlocked) throw new Error('Retention period has not elapsed. Keep clients archived for 90 days before purging.');

    const invoices = await this.listInvoices();
    const blockedInvoices = invoices
      .filter((invoice) => selectedIds.has(invoice.clientId) && !['paid', 'void'].includes(invoice.status))
      .map((invoice) => ({
        clientId: invoice.clientId,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        amount: invoice.amount,
        currency: invoice.currency,
      }));
    const documents = await this.listDocuments();
    const attachmentCount = documents.filter((document) => selectedIds.has(document.clientId)).length;

    if (attachmentCount > 0) {
      const setting = await localRequest<DirectorySetting | undefined>(SETTINGS_STORE, 'readonly', (store) => store.get(DIRECTORY_SETTING_KEY));
      if (!setting || await setting.handle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
        throw new Error('Secure purge blocked: restore access to the selected local document folder before continuing.');
      }
    }

    return { blockedInvoices, attachmentCount };
  }

  async purgeClients(clientIds: string[]): Promise<void> {
    const review = await this.reviewPurge(clientIds);
    if (review.blockedInvoices.length > 0) {
      throw new Error('COMPLIANCE_PURGE_BLOCKED: Resolve or void every active or unpaid invoice before purging selected accounts.');
    }
    await removeLocalAttachments(clientIds);
    await deleteLocalClientRecords(clientIds);
  }
}

class SupabaseDataService implements IDataService {
  readonly preference = 'cloud' as const;

  async listClientPage(archived: boolean, offset: number, limit: number): Promise<PageResult<ClientRecord>> {
    const { offset: pageOffset, limit: pageLimit } = normalizePageBounds(offset, limit);
    let query = getSupabaseClient()
      .from('clients')
      .select('id, first_name, last_name, email, company, status, archived_at, created_at, last_interaction_at, updated_at, passport_expires_at, visa_subclass, visa_expires_at, deleted_at, assigned_agent_id');
    query = archived
      ? query.or('status.eq.archived,deleted_at.not.is.null')
      : query.is('deleted_at', null);
    const { data, error } = await query
      .order('updated_at', { ascending: false })
      .order('id', { ascending: false })
      .range(pageOffset, pageOffset + pageLimit);
    if (error) throwSupabaseError(error, archived ? 'archived client page' : 'client page');
    const rows = data ?? [];
    return {
      items: rows.slice(0, pageLimit).map((row) => mapCloudClient(row as Record<string, unknown>)),
      hasMore: rows.length > pageLimit,
    };
  }

  async listClients(): Promise<ClientRecord[]> {
    const { data, error } = await getSupabaseClient()
      .from('clients')
      .select('id, first_name, last_name, email, company, status, archived_at, created_at, last_interaction_at, updated_at, passport_expires_at, visa_subclass, visa_expires_at, assigned_agent_id')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false });
    if (error) throwSupabaseError(error, 'client list');
    return (data ?? []).map((row) => mapCloudClient(row as Record<string, unknown>));
  }

  async listArchivedClients(): Promise<ClientRecord[]> {
    const { data, error } = await getSupabaseClient()
      .from('clients')
      .select('id, first_name, last_name, email, company, status, archived_at, created_at, last_interaction_at, updated_at, passport_expires_at, visa_subclass, visa_expires_at, assigned_agent_id')
      .or('status.eq.archived,deleted_at.not.is.null')
      .order('updated_at', { ascending: false });
    if (error) throwSupabaseError(error, 'archived client list');
    return (data ?? []).map((row) => mapCloudClient(row as Record<string, unknown>));
  }

  async saveClient(input: ClientInput): Promise<ClientRecord> {
    const organizationId = await getActiveOrganizationId();
    const { data, error } = await getSupabaseClient()
      .from('clients')
      .insert({
        organization_id: organizationId,
        first_name: input.firstName.trim(),
        last_name: input.lastName.trim(),
        email: input.email.trim(),
        company: input.company?.trim() || null,
        passport_expires_at: input.passportExpiresAt || null,
        visa_subclass: input.visaSubclass?.trim() || null,
        visa_expires_at: input.visaExpiresAt || null,
      })
      .select('id, first_name, last_name, email, company, status, archived_at, created_at, last_interaction_at, updated_at, passport_expires_at, visa_subclass, visa_expires_at, assigned_agent_id')
      .single();
    if (error) throwSupabaseError(error, 'client save');
    return mapCloudClient(data as Record<string, unknown>);
  }

  async updateClient(id: string, input: ClientInput): Promise<ClientRecord> {
    const { data, error } = await getSupabaseClient()
      .from('clients')
      .update({
        first_name: input.firstName.trim(),
        last_name: input.lastName.trim(),
        email: input.email.trim(),
        company: input.company?.trim() || null,
        passport_expires_at: input.passportExpiresAt || null,
        visa_subclass: input.visaSubclass?.trim() || null,
        visa_expires_at: input.visaExpiresAt || null,
      })
      .eq('id', id)
      .is('deleted_at', null)
      .select('id, first_name, last_name, email, company, status, created_at, last_interaction_at, updated_at, passport_expires_at, visa_subclass, visa_expires_at, assigned_agent_id')
      .single();
    if (error) throwSupabaseError(error, 'client update');
    return mapCloudClient(data as Record<string, unknown>);
  }

  async archiveClient(id: string): Promise<void> {
    const { error } = await getSupabaseClient().rpc('archive_client', { requested_client_id: id });
    if (error) throwSupabaseError(error, 'client archive');
  }

  async restoreClient(id: string): Promise<void> {
    const { error } = await getSupabaseClient().rpc('restore_archived_client', { requested_client_id: id });
    if (error) throwSupabaseError(error, 'client restore');
  }

  async listDocuments(clientId?: string): Promise<DocumentRecord[]> {
    let query = getSupabaseClient()
      .from('documents')
      .select('id, client_id, file_name, file_size, mime_type, storage_path, created_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (clientId) query = query.eq('client_id', clientId);
    const { data, error } = await query;
    if (error) throwSupabaseError(error, 'document list');
    return (data ?? []).map((row) => mapDocument(row as Record<string, unknown>));
  }

  async listDocumentsPage(clientId: string, offset: number, limit: number): Promise<PageResult<DocumentRecord>> {
    const { offset: pageOffset, limit: pageLimit } = normalizePageBounds(offset, limit);
    const { data, error } = await getSupabaseClient()
      .from('documents')
      .select('id, client_id, file_name, file_size, mime_type, storage_path, created_at')
      .eq('client_id', clientId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(pageOffset, pageOffset + pageLimit);
    if (error) throwSupabaseError(error, 'document page');
    const rows = data ?? [];
    return {
      items: rows.slice(0, pageLimit).map((row) => mapDocument(row as Record<string, unknown>)),
      hasMore: rows.length > pageLimit,
    };
  }

  async selectDocumentFolder(): Promise<string | null> {
    throw new Error('A host folder can only be selected in local storage mode.');
  }

  async stageDocument(clientId: string, file: File): Promise<DocumentRecord> {
    const organizationId = await getActiveOrganizationId();
    const supabase = getSupabaseClient();
    const bucket = supabase.storage.from(STORAGE_BUCKET);
    const storagePath = `${organizationId}/${clientId}/${crypto.randomUUID()}-${sanitizePathSegment(file.name)}`;
    const { error: uploadError } = await bucket.upload(storagePath, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
    if (uploadError) throwSupabaseError(uploadError, 'document upload');

    try {
      const { data, error } = await supabase
        .from('documents')
        .insert({
          organization_id: organizationId,
          client_id: clientId,
          bucket_id: STORAGE_BUCKET,
          storage_path: storagePath,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type || 'application/octet-stream',
        })
        .select('id, client_id, file_name, file_size, mime_type, storage_path, created_at')
        .single();
      if (error) throwSupabaseError(error, 'document metadata save');
      return mapDocument(data as Record<string, unknown>);
    } catch (error) {
      await bucket.remove([storagePath]);
      throw error;
    }
  }

  async listCredentials(clientId: string): Promise<CredentialRecord[]> {
    const { data, error } = await getSupabaseClient()
      .from('credentials_vault')
      .select('id, client_id, portal_name, last_verified')
      .eq('client_id', clientId)
      .is('deleted_at', null)
      .order('last_verified', { ascending: false });
    if (error) throwSupabaseError(error, 'credential list');
    return (data ?? []).map((row) => ({
      id: String(row.id),
      clientId: String(row.client_id),
      portalName: String(row.portal_name),
      lastVerified: String(row.last_verified ?? ''),
    }));
  }

  async listInvoices(): Promise<InvoiceRecord[]> {
    const { data, error } = await getSupabaseClient()
      .from('financial_invoices')
      .select('id, client_id, invoice_number, amount, currency, status, grant_applied_amount, amount_due, due_at')
      .is('deleted_at', null)
      .order('due_at', { ascending: true });
    if (error) throwSupabaseError(error, 'invoice list');
    return (data ?? []).map((row) => mapCloudInvoice(row as Record<string, unknown>));
  }

  async listInvoicesPage(clientId: string, offset: number, limit: number): Promise<PageResult<InvoiceRecord>> {
    const { offset: pageOffset, limit: pageLimit } = normalizePageBounds(offset, limit);
    const { data, error } = await getSupabaseClient()
      .from('financial_invoices')
      .select('id, client_id, invoice_number, amount, currency, status, grant_applied_amount, amount_due, due_at')
      .eq('client_id', clientId)
      .is('deleted_at', null)
      .order('due_at', { ascending: true })
      .order('id', { ascending: true })
      .range(pageOffset, pageOffset + pageLimit);
    if (error) throwSupabaseError(error, 'invoice page');
    const rows = data ?? [];
    return {
      items: rows.slice(0, pageLimit).map((row) => mapCloudInvoice(row as Record<string, unknown>)),
      hasMore: rows.length > pageLimit,
    };
  }

  async getClientFinancialSummary(clientId: string): Promise<ClientFinancialSummary> {
    const { data, error } = await getSupabaseClient()
      .rpc('get_client_financial_summary', { requested_client_id: clientId })
      .single();
    if (error) throwSupabaseError(error, 'client financial summary');
    const summary = data as Record<string, unknown>;
    const amounts = Array.isArray(summary.outstanding_by_currency)
      ? summary.outstanding_by_currency as Array<Record<string, unknown>>
      : [];
    return {
      invoiceCount: Number(summary.invoice_count ?? 0),
      overdueInvoiceCount: Number(summary.overdue_invoice_count ?? 0),
      grantCount: Number(summary.grant_count ?? 0),
      outstandingByCurrency: amounts.map((amount) => ({
        currency: String(amount.currency),
        amount: Number(amount.amount),
      })),
    };
  }

  async createInvoice(input: InvoiceInput): Promise<InvoiceRecord> {
    const invoiceInput = normalizeInvoiceInput(input);
    const { data, error } = await getSupabaseClient()
      .rpc('create_client_invoice', {
        requested_client_id: invoiceInput.clientId,
        requested_invoice_number: invoiceInput.invoiceNumber,
        requested_amount: invoiceInput.amount,
        requested_currency: invoiceInput.currency,
        requested_due_at: invoiceInput.dueAt,
      })
      .single();
    if (error) throwSupabaseError(error, 'invoice create');
    return mapCloudInvoice(data as Record<string, unknown>);
  }

  async recordInvoicePayment(id: string, amount: number): Promise<InvoiceRecord> {
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Payment amount must be greater than zero.');
    const { data, error } = await getSupabaseClient()
      .rpc('record_client_invoice_payment', {
        requested_invoice_id: id,
        requested_amount: Number(amount.toFixed(2)),
        requested_paid_at: new Date().toISOString(),
      })
      .single();
    if (error) throwSupabaseError(error, 'invoice payment');
    return mapCloudInvoice(data as Record<string, unknown>);
  }

  async listGrants(): Promise<GrantRecord[]> {
    const { data, error } = await getSupabaseClient()
      .from('grants_ledger')
      .select('id, client_id, entry_type, amount, currency, reference, description, grant_source, allocation_date, created_at')
      .order('created_at', { ascending: false });
    if (error) throwSupabaseError(error, 'grants ledger list');
    return (data ?? []).map((row) => mapCloudGrant(row as Record<string, unknown>));
  }

  async listGrantsPage(clientId: string, offset: number, limit: number): Promise<PageResult<GrantRecord>> {
    const { offset: pageOffset, limit: pageLimit } = normalizePageBounds(offset, limit);
    const { data, error } = await getSupabaseClient()
      .from('grants_ledger')
      .select('id, client_id, entry_type, amount, currency, reference, description, grant_source, allocation_date, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(pageOffset, pageOffset + pageLimit);
    if (error) throwSupabaseError(error, 'grant page');
    const rows = data ?? [];
    return {
      items: rows.slice(0, pageLimit).map((row) => mapCloudGrant(row as Record<string, unknown>)),
      hasMore: rows.length > pageLimit,
    };
  }

  async createGrant(input: GrantInput): Promise<GrantRecord> {
    const grantInput = normalizeGrantInput(input);
    const { data, error } = await getSupabaseClient()
      .rpc('allocate_client_grant', {
        requested_client_id: grantInput.clientId,
        requested_amount: grantInput.amount,
        requested_currency: grantInput.currency,
        requested_source: grantInput.source,
        requested_allocation_date: grantInput.allocationDate,
      })
      .single();
    if (error) throwSupabaseError(error, 'grant entry create');
    return mapCloudGrant(data as Record<string, unknown>);
  }

  async listGrantBalances(clientId?: string): Promise<GrantBalance[]> {
    let query = getSupabaseClient()
      .from('client_grant_balances')
      .select('client_id, currency, available_balance');
    if (clientId) query = query.eq('client_id', clientId);
    const { data, error } = await query;
    if (error) throwSupabaseError(error, 'grant balance list');
    return (data ?? []).map((row) => ({
      clientId: String(row.client_id),
      currency: String(row.currency),
      availableBalance: Number(row.available_balance),
    }));
  }

  async listGovernanceNotifications(): Promise<GovernanceNotification[]> {
    const { data, error } = await getSupabaseClient()
      .from('governance_notifications')
      .select('id, client_id, document_type, expires_on, notice_days, title, message, delivery_status, created_at, delivered_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throwSupabaseError(error, 'governance notification list');
    return (data ?? []).map((row) => ({
      id: String(row.id),
      clientId: String(row.client_id),
      documentType: row.document_type as GovernanceNotification['documentType'],
      expiresOn: String(row.expires_on),
      noticeDays: Number(row.notice_days) as GovernanceNotification['noticeDays'],
      title: String(row.title),
      message: String(row.message),
      deliveryStatus: row.delivery_status as GovernanceNotification['deliveryStatus'],
      createdAt: String(row.created_at),
      deliveredAt: row.delivered_at ? String(row.delivered_at) : null,
    }));
  }

  async reviewPurge(clientIds: string[]): Promise<PurgeReview> {
    if (clientIds.length === 0) return { blockedInvoices: [], attachmentCount: 0 };
    const supabase = getSupabaseClient();
    const [clientResult, invoiceResult, documentResult] = await Promise.all([
      supabase
        .from('clients')
        .select('id, status, archived_at')
        .in('id', clientIds),
      supabase
        .from('financial_invoices')
        .select('client_id, invoice_number, status, amount, currency')
        .in('client_id', clientIds)
        .is('deleted_at', null)
        .in('status', ['draft', 'issued', 'outstanding', 'overdue']),
      supabase
        .from('documents')
        .select('id, client_id, file_name, file_size, mime_type, storage_path, created_at')
        .in('client_id', clientIds)
        .is('deleted_at', null),
    ]);
    if (clientResult.error) throwSupabaseError(clientResult.error, 'purge retention review');
    if (invoiceResult.error) throwSupabaseError(invoiceResult.error, 'purge compliance review');
    if (documentResult.error) throwSupabaseError(documentResult.error, 'purge attachment review');

    const cutoff = Date.now() - ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const retentionBlocked = (clientResult.data ?? []).some((client) =>
      client.status !== 'archived' || !client.archived_at || Date.parse(String(client.archived_at)) > cutoff
    );
    if (retentionBlocked || (clientResult.data ?? []).length !== clientIds.length) {
      throw new Error('Retention period has not elapsed. Keep clients archived for 90 days before purging.');
    }

    const localReview = await new IndexedDbDataService().reviewPurge(clientIds);
    const blockedInvoices = [
      ...(invoiceResult.data ?? []).map((invoice) => ({
        clientId: String(invoice.client_id),
        invoiceNumber: String(invoice.invoice_number),
        status: String(invoice.status),
        amount: Number(invoice.amount),
        currency: String(invoice.currency),
      })),
      ...localReview.blockedInvoices,
    ];
    return {
      blockedInvoices,
      attachmentCount: (documentResult.data?.length ?? 0) + localReview.attachmentCount,
    };
  }

  async purgeClients(clientIds: string[]): Promise<void> {
    if (clientIds.length === 0) throw new Error('Select at least one client before purging.');
    const review = await this.reviewPurge(clientIds);
    if (review.blockedInvoices.length > 0) {
      throw new Error('COMPLIANCE_PURGE_BLOCKED: Resolve or void every active or unpaid invoice before purging selected accounts.');
    }

    const supabase = getSupabaseClient();
    const { data: attachments, error: claimError } = await supabase.rpc('begin_client_purge', {
      requested_client_ids: clientIds,
    });
    if (claimError) {
      throw new Error(claimError.message.includes('COMPLIANCE_PURGE_BLOCKED')
        ? claimError.message
        : `Secure purge could not be claimed: ${claimError.message}`);
    }

    const storagePathsByBucket = new Map<string, string[]>();
    for (const attachment of attachments ?? []) {
      const bucketId = String(attachment.bucket_id);
      const paths = storagePathsByBucket.get(bucketId) ?? [];
      paths.push(String(attachment.storage_path));
      storagePathsByBucket.set(bucketId, paths);
    }

    for (const [bucketId, paths] of storagePathsByBucket) {
      const { error } = await supabase.storage.from(bucketId).remove(paths);
      if (error && !/not found|does not exist/i.test(error.message)) {
        throw new Error(`Attachment cleanup failed; client rows remain purge-locked for retry: ${error.message}`);
      }
    }

    await removeLocalAttachments(clientIds);
    await deleteLocalClientRecords(clientIds);

    const { error: finalizeError } = await supabase.rpc('finalize_client_purge', {
      requested_client_ids: clientIds,
    });
    if (finalizeError) {
      throw new Error(finalizeError.message.includes('COMPLIANCE_PURGE_BLOCKED')
        ? finalizeError.message
        : `Database purge did not finalize; selected client rows remain locked for retry: ${finalizeError.message}`);
    }
  }
}

interface DashboardStorageValue {
  preference: StoragePreference;
  dataService: IDataService;
  isReady: boolean;
}

const DashboardStorageContext = createContext<DashboardStorageValue | null>(null);

export function DashboardStorageProvider({ children }: { children: React.ReactNode }) {
  const { storagePreference, isHydrated } = useStorage();
  const value = useMemo<DashboardStorageValue>(() => ({
    preference: storagePreference,
    dataService: storagePreference === 'cloud' ? new SupabaseDataService() : new IndexedDbDataService(),
    isReady: isHydrated,
  }), [storagePreference, isHydrated]);

  return (
    <DashboardStorageContext.Provider value={value}>
      {children}
    </DashboardStorageContext.Provider>
  );
}

export function useDashboardStorage(): DashboardStorageValue {
  const context = useContext(DashboardStorageContext);
  if (!context) throw new Error('useDashboardStorage must be used within DashboardStorageProvider.');
  return context;
}
