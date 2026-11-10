'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import CredentialVault from '../../src/components/CredentialVault';
import AuthStatus from '../../src/components/AuthStatus';
import GlobalPageSearch from '../../src/components/GlobalPageSearch';
import { assignClientToAgent, listClientAssignmentAgents } from './client-assignment-actions';
import {
  ClientActionHub,
  ClientFinancialSummary,
  ClientSidebar,
  FinancialWorkspaceLayout,
  GlobalControlHeader,
} from '../../src/components/FinancialWorkspaceLayout';
import { useStorage, type StoragePreference } from '../../src/context/StorageContext';
import { getSupabasePublicConfig } from '../../src/lib/supabase/config';
import {
  DashboardStorageProvider,
  useDashboardStorage,
  type ClientInput,
  type ClientFinancialSummary as ClientFinancialSummaryData,
  type ClientRecord,
  type ClientSearchField,
  type DocumentRecord,
  type GovernanceNotification,
  type GrantBalance,
  type GrantRecord,
  type InvoiceRecord,
} from './StorageContext';

const DASHBOARD_PAGE_SIZE = 50;

interface AssignmentAgent {
  userId: string;
  displayName: string;
  email: string;
}

const EMPTY_FORM: ClientInput = {
  firstName: '',
  lastName: '',
  email: '',
  company: '',
  passportExpiresAt: '',
  visaSubclass: '',
  visaExpiresAt: '',
};

interface InvoiceFormState {
  invoiceNumber: string;
  amount: string;
  currency: string;
  dueAt: string;
}

const EMPTY_INVOICE_FORM: InvoiceFormState = {
  invoiceNumber: '',
  amount: '',
  currency: 'USD',
  dueAt: '',
};

interface GrantFormState {
  amount: string;
  currency: string;
  reference: string;
  description: string;
  source: string;
  allocationDate: string;
}

const EMPTY_GRANT_FORM: GrantFormState = {
  amount: '',
  currency: 'USD',
  reference: '',
  description: '',
  source: '',
  allocationDate: new Date().toISOString().slice(0, 10),
};

interface ExtensionMessageResponse {
  ok?: boolean;
  error?: string;
  target?: string;
}

interface WindowWithExtension extends Window {
  chrome?: {
    runtime?: {
      sendMessage(extensionId: string, message: unknown): Promise<ExtensionMessageResponse>;
    };
  };
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function DashboardContent() {
  const { preference, dataService, isReady } = useDashboardStorage();
  const { updateStoragePreference } = useStorage();
  const isCloudStorageConfigured = getSupabasePublicConfig() !== null;
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [archivedClients, setArchivedClients] = useState<ClientRecord[]>([]);
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const [appliedClientSearchTerm, setAppliedClientSearchTerm] = useState('');
  const [clientSearchField, setClientSearchField] = useState<ClientSearchField>('all');
  const [assignmentAgents, setAssignmentAgents] = useState<AssignmentAgent[]>([]);
  const [canAssignClients, setCanAssignClients] = useState(false);
  const [isAssigningClient, setIsAssigningClient] = useState(false);
  const [showArchivedClients, setShowArchivedClients] = useState(false);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [grants, setGrants] = useState<GrantRecord[]>([]);
  const [grantBalances, setGrantBalances] = useState<GrantBalance[]>([]);
  const [notifications, setNotifications] = useState<GovernanceNotification[]>([]);
  const [financialSummary, setFinancialSummary] = useState<ClientFinancialSummaryData | null>(null);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [form, setForm] = useState<ClientInput>(EMPTY_FORM);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [invoiceForm, setInvoiceForm] = useState<InvoiceFormState>(EMPTY_INVOICE_FORM);
  const [grantForm, setGrantForm] = useState<GrantFormState>(EMPTY_GRANT_FORM);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFolder, setSelectedFolder] = useState('');
  const [isSavingClient, setIsSavingClient] = useState(false);
  const [isSavingInvoice, setIsSavingInvoice] = useState(false);
  const [isSavingGrant, setIsSavingGrant] = useState(false);
  const [isPurgingClient, setIsPurgingClient] = useState(false);
  const [recordingPaymentId, setRecordingPaymentId] = useState<string | null>(null);
  const [paymentAmounts, setPaymentAmounts] = useState<Record<string, string>>({});
  const [isStagingDocument, setIsStagingDocument] = useState(false);
  const [clientHasMore, setClientHasMore] = useState(false);
  const [archivedClientHasMore, setArchivedClientHasMore] = useState(false);
  const [documentHasMore, setDocumentHasMore] = useState(false);
  const [invoiceHasMore, setInvoiceHasMore] = useState(false);
  const [grantHasMore, setGrantHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState<'clients' | 'documents' | 'invoices' | 'grants' | null>(null);
  const [selectedClientDataVersion, setSelectedClientDataVersion] = useState(0);
  const [loadedClientDataKey, setLoadedClientDataKey] = useState('');
  const [purgeReferenceTime, setPurgeReferenceTime] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [documentSuccessMessage, setDocumentSuccessMessage] = useState('');
  const [errorFocusVersion, setErrorFocusVersion] = useState(0);
  const [isDashboardLoading, setIsDashboardLoading] = useState(true);
  const errorAlertRef = useRef<HTMLDivElement>(null);

  const visibleClients = showArchivedClients ? archivedClients : clients;
  const selectedClient = [...clients, ...archivedClients].find((client) => client.id === selectedClientId) ?? null;
  const selectedClientDataKey = selectedClientId ? `${preference}:${selectedClientId}` : '';
  const selectedClientDataReady = Boolean(selectedClientDataKey) && loadedClientDataKey === selectedClientDataKey;
  const isSelectedClientLoading = Boolean(selectedClientDataKey) && !selectedClientDataReady;

  useEffect(() => {
    const timer = window.setTimeout(() => setPurgeReferenceTime(Date.now()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedClientSearchTerm(clientSearchTerm.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [clientSearchTerm]);

  useEffect(() => {
    if (!errorMessage || !errorAlertRef.current) return;
    const frameId = window.requestAnimationFrame(() => {
      errorAlertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      errorAlertRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [errorMessage, errorFocusVersion]);

  function handleStoragePreferenceChange(nextPreference: StoragePreference) {
    if (nextPreference === preference) return;
    const destination = nextPreference === 'cloud' ? 'Cloud' : 'Local';
    const current = preference === 'cloud' ? 'Cloud' : 'Local';
    const confirmed = window.confirm(
      `Switch from ${current} to ${destination}? These storage locations are separate. Existing records will remain where they are and will not be copied.`
    );
    if (confirmed) {
      if (nextPreference === 'local') {
        setAssignmentAgents([]);
        setCanAssignClients(false);
      }
      void updateStoragePreference(nextPreference);
    }
  }

  useEffect(() => {
    if (!isReady) return;
    let active = true;
    async function loadDashboard() {
      setIsDashboardLoading(true);
      setErrorMessage('');
      try {
        const [clientPage, archivedPage, notificationRows] = await Promise.all([
          dataService.listClientPage(false, 0, DASHBOARD_PAGE_SIZE, appliedClientSearchTerm, clientSearchField),
          dataService.listClientPage(true, 0, DASHBOARD_PAGE_SIZE, appliedClientSearchTerm, clientSearchField),
          dataService.listGovernanceNotifications(),
        ]);
        if (!active) return;
        setClients(clientPage.items);
        setArchivedClients(archivedPage.items);
        setClientHasMore(clientPage.hasMore);
        setArchivedClientHasMore(archivedPage.hasMore);
        setNotifications(notificationRows);
        const loadedRows = [...clientPage.items, ...archivedPage.items];
        setSelectedClientId((current) => current && loadedRows.some((client) => client.id === current)
          ? current
          : (clientPage.items[0]?.id ?? archivedPage.items[0]?.id ?? ''));
      } catch (error) {
        if (active) setErrorMessage(error instanceof Error ? error.message : 'Dashboard data could not be loaded.');
      } finally {
        if (active) setIsDashboardLoading(false);
      }
    }
    void loadDashboard();
    return () => { active = false; };
  }, [appliedClientSearchTerm, clientSearchField, dataService, isReady]);

  useEffect(() => {
    if (!isReady || preference !== 'cloud') return;

    let active = true;
    void listClientAssignmentAgents()
      .then((result) => {
        if (!active) return;
        setAssignmentAgents(result.agents);
        setCanAssignClients(result.canAssign);
      })
      .catch((error: unknown) => {
        if (active) setErrorMessage(error instanceof Error ? error.message : 'Agent list could not be loaded.');
      });
    return () => { active = false; };
  }, [isReady, preference]);

  useEffect(() => {
    if (!isReady) return;
    let active = true;
    if (!selectedClientId) {
      return () => { active = false; };
    }

    async function loadSelectedClientData() {
      try {
        const [documentPage, invoicePage, grantPage, balances, summary] = await Promise.all([
          dataService.listDocumentsPage(selectedClientId, 0, DASHBOARD_PAGE_SIZE),
          dataService.listInvoicesPage(selectedClientId, 0, DASHBOARD_PAGE_SIZE),
          dataService.listGrantsPage(selectedClientId, 0, DASHBOARD_PAGE_SIZE),
          dataService.listGrantBalances(selectedClientId),
          dataService.getClientFinancialSummary(selectedClientId),
        ]);
        if (!active) return;
        setDocuments(documentPage.items);
        setInvoices(invoicePage.items);
        setGrants(grantPage.items);
        setGrantBalances(balances);
        setFinancialSummary(summary);
        setLoadedClientDataKey(`${preference}:${selectedClientId}`);
        setDocumentHasMore(documentPage.hasMore);
        setInvoiceHasMore(invoicePage.hasMore);
        setGrantHasMore(grantPage.hasMore);
      } catch (error) {
        if (active) setErrorMessage(error instanceof Error ? error.message : 'Selected client data could not be loaded.');
      } finally {
        if (active) setLoadedClientDataKey(`${preference}:${selectedClientId}`);
      }
    }
    void loadSelectedClientData();
    return () => { active = false; };
  }, [dataService, isReady, preference, selectedClientId, selectedClientDataVersion]);

  async function refreshDashboard() {
    setIsDashboardLoading(true);
    setErrorMessage('');
    try {
      const [clientPage, archivedPage, notificationRows] = await Promise.all([
        dataService.listClientPage(false, 0, DASHBOARD_PAGE_SIZE, appliedClientSearchTerm, clientSearchField),
        dataService.listClientPage(true, 0, DASHBOARD_PAGE_SIZE, appliedClientSearchTerm, clientSearchField),
        dataService.listGovernanceNotifications(),
      ]);
      setClients(clientPage.items);
      setArchivedClients(archivedPage.items);
      setClientHasMore(clientPage.hasMore);
      setArchivedClientHasMore(archivedPage.hasMore);
      setNotifications(notificationRows);
      const loadedRows = [...clientPage.items, ...archivedPage.items];
      setSelectedClientId((current) => current && loadedRows.some((client) => client.id === current)
        ? current
        : (clientPage.items[0]?.id ?? archivedPage.items[0]?.id ?? ''));
      setSelectedClientDataVersion((version) => version + 1);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Dashboard data could not be refreshed.');
    } finally {
      setIsDashboardLoading(false);
    }
  }

  async function handleAssignClient(event: React.ChangeEvent<HTMLSelectElement>) {
    if (!selectedClient) return;
    const client = selectedClient;
    const agentId = event.target.value || null;
    setIsAssigningClient(true);
    setErrorMessage('');
    try {
      await assignClientToAgent(client.id, agentId);
      const updateAssignment = (entry: ClientRecord) => entry.id === client.id
        ? { ...entry, assignedAgentId: agentId }
        : entry;
      setClients((current) => current.map(updateAssignment));
      setArchivedClients((current) => current.map(updateAssignment));
      setSuccessMessage(agentId ? 'Client assigned to agent.' : 'Client assignment cleared.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Client assignment could not be changed.');
    } finally {
      setIsAssigningClient(false);
    }
  }

  async function loadMoreClients() {
    if (loadingMore === 'clients') return;
    setLoadingMore('clients');
    try {
      const archived = showArchivedClients;
      const currentRows = archived ? archivedClients : clients;
      const page = await dataService.listClientPage(archived, currentRows.length, DASHBOARD_PAGE_SIZE, appliedClientSearchTerm, clientSearchField);
      if (archived) {
        setArchivedClients((current) => [...current, ...page.items]);
        setArchivedClientHasMore(page.hasMore);
      } else {
        setClients((current) => [...current, ...page.items]);
        setClientHasMore(page.hasMore);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'More clients could not be loaded.');
    } finally {
      setLoadingMore(null);
    }
  }

  async function loadMoreDocuments() {
    if (!selectedClientId || !selectedClientDataReady || loadingMore === 'documents') return;
    setLoadingMore('documents');
    try {
      const page = await dataService.listDocumentsPage(selectedClientId, documents.length, DASHBOARD_PAGE_SIZE);
      setDocuments((current) => [...current, ...page.items]);
      setDocumentHasMore(page.hasMore);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'More documents could not be loaded.');
    } finally {
      setLoadingMore(null);
    }
  }

  async function loadMoreInvoices() {
    if (!selectedClientId || !selectedClientDataReady || loadingMore === 'invoices') return;
    setLoadingMore('invoices');
    try {
      const page = await dataService.listInvoicesPage(selectedClientId, invoices.length, DASHBOARD_PAGE_SIZE);
      setInvoices((current) => [...current, ...page.items]);
      setInvoiceHasMore(page.hasMore);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'More invoices could not be loaded.');
    } finally {
      setLoadingMore(null);
    }
  }

  async function loadMoreGrants() {
    if (!selectedClientId || !selectedClientDataReady || loadingMore === 'grants') return;
    setLoadingMore('grants');
    try {
      const page = await dataService.listGrantsPage(selectedClientId, grants.length, DASHBOARD_PAGE_SIZE);
      setGrants((current) => [...current, ...page.items]);
      setGrantHasMore(page.hasMore);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'More grant entries could not be loaded.');
    } finally {
      setLoadingMore(null);
    }
  }

  function beginEdit(client: ClientRecord) {
    setEditingClientId(client.id);
    setSelectedClientId(client.id);
    setForm({
      firstName: client.firstName,
      lastName: client.lastName,
      email: client.email,
      company: client.company,
      passportExpiresAt: client.passportExpiresAt ?? '',
      visaSubclass: client.visaSubclass,
      visaExpiresAt: client.visaExpiresAt ?? '',
    });
    setSuccessMessage('');
  }

  function resetForm() {
    setEditingClientId(null);
    setForm(EMPTY_FORM);
  }

  async function handleClientSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedClient?.status === 'archived') return;
    setIsSavingClient(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const saved = editingClientId
        ? await dataService.updateClient(editingClientId, form)
        : await dataService.saveClient(form);
      setClients((current) => [saved, ...current.filter((client) => client.id !== saved.id)].slice(0, DASHBOARD_PAGE_SIZE));
      if (!editingClientId && clients.length >= DASHBOARD_PAGE_SIZE) setClientHasMore(true);
      setSelectedClientId(saved.id);
      setSuccessMessage(editingClientId ? 'Client profile updated.' : 'Client profile created.');
      resetForm();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Client profile could not be saved.');
    } finally {
      setIsSavingClient(false);
    }
  }

  async function handleArchive(client: ClientRecord) {
    if (client.status === 'archived') return;
    if (!window.confirm(`Archive ${client.firstName} ${client.lastName}?`)) return;
    setErrorMessage('');
    try {
      await dataService.archiveClient(client.id);
      setClients((current) => current.filter((entry) => entry.id !== client.id));
      const archivedPage = await dataService.listClientPage(true, 0, DASHBOARD_PAGE_SIZE, appliedClientSearchTerm, clientSearchField);
      setArchivedClients(archivedPage.items);
      setArchivedClientHasMore(archivedPage.hasMore);
      setSelectedClientId((current) => current === client.id ? '' : current);
      if (editingClientId === client.id) resetForm();
      setSuccessMessage('Client archived.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Client could not be archived.');
    }
  }

  async function handleRestore(client: ClientRecord) {
    setErrorMessage('');
    try {
      await dataService.restoreClient(client.id);
      setArchivedClients((current) => current.filter((entry) => entry.id !== client.id));
      const activePage = await dataService.listClientPage(false, 0, DASHBOARD_PAGE_SIZE, appliedClientSearchTerm, clientSearchField);
      setClients(activePage.items);
      setClientHasMore(activePage.hasMore);
      setShowArchivedClients(false);
      setSelectedClientId(client.id);
      setSuccessMessage(`${client.firstName} ${client.lastName} restored to active clients.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Client could not be restored.');
    }
  }

  async function handlePurgeSelected() {
    if (!selectedClient || selectedClient.status !== 'archived') return;
    setErrorMessage('');
    try {
      const review = await dataService.reviewPurge([selectedClient.id]);
      if (review.blockedInvoices.length > 0) {
        setErrorMessage('Purge blocked. Resolve or void all outstanding invoices before purging this client.');
        return;
      }
      if (!window.confirm(`Permanently purge ${selectedClient.firstName} ${selectedClient.lastName}? This cannot be undone.`)) return;
      setIsPurgingClient(true);
      await dataService.purgeClients([selectedClient.id]);
      setArchivedClients((current) => current.filter((client) => client.id !== selectedClient.id));
      setSelectedClientId('');
      setSuccessMessage('Client and associated records were permanently purged.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Client could not be purged.');
    } finally {
      setIsPurgingClient(false);
    }
  }

  function focusWorkspaceForm(formId: string) {
    document.getElementById(formId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function handleNewClient() {
    setShowArchivedClients(false);
    setSelectedClientId('');
    resetForm();
    window.setTimeout(() => focusWorkspaceForm('client-form'), 0);
  }

  async function handleChooseFolder() {
    try {
      const folder = await dataService.selectDocumentFolder();
      if (!folder) return;
      setErrorMessage('');
      setSelectedFolder(folder);
      setSuccessMessage('Local document folder is ready.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Folder access could not be granted.');
    }
  }

  async function handleStageDocument(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!selectedClientId || selectedClient?.status === 'archived' || !selectedFile) return;
    setIsStagingDocument(true);
    setErrorMessage('');
    setSuccessMessage('');
    setDocumentSuccessMessage('');
    try {
      const staged = await dataService.stageDocument(selectedClientId, selectedFile);
      setDocuments((current) => [staged, ...current].slice(0, DASHBOARD_PAGE_SIZE));
      if (documents.length >= DASHBOARD_PAGE_SIZE) setDocumentHasMore(true);
      setSelectedFile(null);
      formElement.reset();
      setDocumentSuccessMessage(`${staged.fileName} staged successfully.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Document could not be staged.');
      setErrorFocusVersion((version) => version + 1);
    } finally {
      setIsStagingDocument(false);
    }
  }

  async function handleInvoiceSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedClient || selectedClient.status === 'archived') return;
    setIsSavingInvoice(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const invoice = await dataService.createInvoice({
        clientId: selectedClient.id,
        invoiceNumber: invoiceForm.invoiceNumber,
        amount: Number(invoiceForm.amount),
        currency: invoiceForm.currency,
        dueAt: invoiceForm.dueAt ? `${invoiceForm.dueAt}T00:00:00.000Z` : null,
      });
      setInvoices((current) => [invoice, ...current.filter((entry) => entry.id !== invoice.id)].slice(0, DASHBOARD_PAGE_SIZE));
      setSelectedClientDataVersion((version) => version + 1);
      setInvoiceForm(EMPTY_INVOICE_FORM);
      setSuccessMessage(
        `Invoice ${invoice.invoiceNumber} created. ${formatMoney(invoice.grantAppliedAmount, invoice.currency)} applied from grants; ${formatMoney(invoice.amountDue, invoice.currency)} remains outstanding.`
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Invoice could not be created.');
    } finally {
      setIsSavingInvoice(false);
    }
  }

  async function handleInvoicePayment(event: React.FormEvent<HTMLFormElement>, invoice: InvoiceRecord) {
    event.preventDefault();
    const amount = Number(paymentAmounts[invoice.id]);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setRecordingPaymentId(invoice.id);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const updatedInvoice = await dataService.recordInvoicePayment(invoice.id, amount);
      setInvoices((current) => current.map((entry) => entry.id === invoice.id ? updatedInvoice : entry));
      setSelectedClientDataVersion((version) => version + 1);
      setPaymentAmounts((current) => ({ ...current, [invoice.id]: '' }));
      setSuccessMessage(`Payment recorded. ${formatMoney(updatedInvoice.amountDue, updatedInvoice.currency)} remains due.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Payment could not be recorded.');
    } finally {
      setRecordingPaymentId(null);
    }
  }

  async function handleGrantSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedClient || selectedClient.status === 'archived') return;
    setIsSavingGrant(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const grant = await dataService.createGrant({
        clientId: selectedClient.id,
        amount: Number(grantForm.amount),
        currency: grantForm.currency,
        reference: grantForm.reference,
        description: grantForm.description,
        source: grantForm.source,
        allocationDate: grantForm.allocationDate,
      });
      setGrants((current) => [grant, ...current.filter((entry) => entry.id !== grant.id)].slice(0, DASHBOARD_PAGE_SIZE));
      setSelectedClientDataVersion((version) => version + 1);
      setGrantForm(EMPTY_GRANT_FORM);
      setSuccessMessage(`Grant from ${grant.source} allocated for ${selectedClient.firstName} ${selectedClient.lastName}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Grant ledger entry could not be saved.');
    } finally {
      setIsSavingGrant(false);
    }
  }

  async function shareSelectedClientWithPortal() {
    if (!selectedClient) return;
    const extensionId = process.env.NEXT_PUBLIC_MIGRATION_EXTENSION_ID?.trim();
    if (!extensionId) {
      setErrorMessage('The companion extension ID is not configured for this deployment. Set NEXT_PUBLIC_MIGRATION_EXTENSION_ID and redeploy.');
      return;
    }

    const extensionRuntime = (window as WindowWithExtension).chrome?.runtime;
    if (typeof extensionRuntime?.sendMessage !== 'function') {
      setErrorMessage('Chrome extension messaging is unavailable in this browser. Open the dashboard in Chrome with the companion extension installed.');
      return;
    }

    setErrorMessage('');
    setSuccessMessage('');
    try {
      const response = await extensionRuntime.sendMessage(extensionId, {
        type: 'migration-assistant:share-profile',
        profile: {
          firstName: selectedClient.firstName,
          lastName: selectedClient.lastName,
          email: selectedClient.email,
          company: selectedClient.company,
          passportExpiresAt: selectedClient.passportExpiresAt,
          visaSubclass: selectedClient.visaSubclass,
          visaExpiresAt: selectedClient.visaExpiresAt,
        },
      });
      if (!response?.ok) throw new Error(response?.error ?? 'The companion extension rejected this profile share.');
      setSuccessMessage(`Profile shared to the active ${response.target} tab for one-time form fill. No vault credentials were shared.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Profile could not be shared with the companion extension.');
    }
  }

  const selectedClientDocuments = selectedClient
    && selectedClientDataReady
    ? documents.filter((document) => document.clientId === selectedClient.id)
    : [];
  const selectedClientInvoices = selectedClient
    && selectedClientDataReady
    ? invoices.filter((invoice) => invoice.clientId === selectedClient.id)
    : [];
  const selectedClientGrants = selectedClient
    && selectedClientDataReady
    ? grants.filter((grant) => grant.clientId === selectedClient.id)
    : [];
  const selectedClientBalances = selectedClient
    && selectedClientDataReady
    ? grantBalances.filter((balance) => balance.clientId === selectedClient.id)
    : [];
  const expirationReviews = clients.flatMap((client) => [
    ...(client.passportExpiresAt ? [{ id: `${client.id}:passport`, clientName: `${client.firstName} ${client.lastName}`, documentType: 'Passport', expiresOn: client.passportExpiresAt }] : []),
    ...(client.visaExpiresAt ? [{ id: `${client.id}:visa`, clientName: `${client.firstName} ${client.lastName}`, documentType: `Visa${client.visaSubclass ? ` subclass ${client.visaSubclass}` : ''}`, expiresOn: client.visaExpiresAt }] : []),
  ]);

  return (
    <FinancialWorkspaceLayout
      globalHeader={(
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <GlobalControlHeader
            mode={preference}
            onModeChange={handleStoragePreferenceChange}
            cloudDisabled={!isCloudStorageConfigured}
          />
          <div className="w-full max-w-[420px] lg:flex-1">
            <GlobalPageSearch />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/dashboard/data-lifecycle" className="border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900">Data lifecycle</Link>
            <AuthStatus />
            {selectedClient && (
              <button type="button" onClick={() => void shareSelectedClientWithPortal()} className="border border-emerald-800 px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-950/50">
                Share selected client
              </button>
            )}
            <button type="button" onClick={() => void refreshDashboard()} className="border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900">
              Refresh data
            </button>
          </div>
        </div>
      )}
      clientSidebar={(
        <ClientSidebar
          clients={visibleClients}
          searchTerm={clientSearchTerm}
          searchField={clientSearchField}
          onSearchTermChange={setClientSearchTerm}
          onSearchFieldChange={setClientSearchField}
          selectedClientId={selectedClientId}
          onSelect={(clientId) => { setSelectedClientId(clientId); resetForm(); }}
          onNewClient={handleNewClient}
          showArchived={showArchivedClients}
          onToggleArchived={() => { setShowArchivedClients((current) => !current); resetForm(); }}
          hasMoreClients={showArchivedClients ? archivedClientHasMore : clientHasMore}
          isLoadingMore={loadingMore === 'clients'}
          onLoadMore={() => void loadMoreClients()}
        />
      )}
      clientProfile={(
        <section className="border border-zinc-800 bg-zinc-900/40 p-5">
          {selectedClient ? (
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase text-emerald-400">Selected client</p>
                <h1 className="mt-1 text-xl font-semibold">{selectedClient.firstName} {selectedClient.lastName}</h1>
                <p className="mt-1 text-sm text-zinc-400">{selectedClient.company || selectedClient.email}</p>
                <p className="mt-2 text-xs text-zinc-500">{selectedClient.email} · {selectedClient.status}</p>
                {preference === 'cloud' && canAssignClients && (
                  <label className="mt-4 flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                    <span>Assigned agent</span>
                    <select
                      value={selectedClient.assignedAgentId ?? ''}
                      disabled={isAssigningClient}
                      onChange={(event) => void handleAssignClient(event)}
                      className="min-w-48 border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-emerald-500 disabled:opacity-50"
                    >
                      <option value="">Unassigned</option>
                      {selectedClient.assignedAgentId && !assignmentAgents.some((agent) => agent.userId === selectedClient.assignedAgentId) && (
                        <option value={selectedClient.assignedAgentId}>Inactive agent (assigned)</option>
                      )}
                      {assignmentAgents.map((agent) => (
                        <option key={agent.userId} value={agent.userId}>
                          {agent.displayName || agent.email || 'Agent'}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <button type="button" disabled={selectedClient.status === 'archived'} onClick={() => beginEdit(selectedClient)} className="border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-40">
                Edit profile
              </button>
            </div>
          ) : (
            <div>
              <p className="text-xs font-semibold uppercase text-emerald-400">Client workspace</p>
              <h1 className="mt-1 text-xl font-semibold">Select a client or create one</h1>
              <p className="mt-1 text-sm text-zinc-500">Choose a name from the sidebar to review its profile and financial activity.</p>
            </div>
          )}
        </section>
      )}
      financialSummary={<ClientFinancialSummary balances={selectedClientBalances} outstandingByCurrency={financialSummary?.outstandingByCurrency ?? []} />}
      actionHub={(
        <ClientActionHub
          onAddGrant={() => focusWorkspaceForm('grant-form')}
          onAddInvoice={() => focusWorkspaceForm('invoice-form')}
          onArchive={() => selectedClient && (selectedClient.status === 'archived' ? void handleRestore(selectedClient) : void handleArchive(selectedClient))}
          onPurge={() => void handlePurgeSelected()}
          archiveLabel={selectedClient?.status === 'archived' ? 'Restore client' : 'Archive client'}
          archiveDisabled={!selectedClient || isPurgingClient}
          financialActionsDisabled={!selectedClient || selectedClient.status === 'archived' || isPurgingClient}
          purgeDisabled={
            !selectedClient ||
            selectedClient.status !== 'archived' ||
            !selectedClient.purgeEligibleAt ||
            purgeReferenceTime === null ||
            Date.parse(selectedClient.purgeEligibleAt) > purgeReferenceTime ||
            isPurgingClient
          }
        />
      )}
    >
      <div className="mx-auto max-w-[1500px] space-y-6">

        {errorMessage && (
          <div ref={errorAlertRef} role="alert" tabIndex={-1} className="border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
            {errorMessage}
          </div>
        )}
        {(isDashboardLoading || isSelectedClientLoading) && (
          <p role="status" aria-live="polite" aria-busy="true" className="flex items-center gap-2 border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-300">
            <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-400 border-r-transparent" />
            {isDashboardLoading ? 'Loading your workspace...' : 'Loading selected client details...'}
          </p>
        )}
        {successMessage && (
          <div role="status" className="border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
            {successMessage}
          </div>
        )}

        <div className="grid grid-cols-1 items-start gap-6">
          <div className="space-y-6">
            <section id="client-profile" className="border border-zinc-800 bg-zinc-900/40">
              <div className="border-b border-zinc-800 px-5 py-4">
                <h2 className="text-base font-semibold">Client profile</h2>
                <p className="mt-1 text-xs text-zinc-500">Create or update migration client metadata.</p>
                {selectedClient?.status === 'archived' && <p className="mt-2 text-xs text-amber-300">Archived clients are read-only. Restore this client before editing.</p>}
              </div>
              <form id="client-form" onSubmit={handleClientSubmit} className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
                <fieldset disabled={selectedClient?.status === 'archived'} className="contents">
                <label className="space-y-1.5">
                  <span className="text-xs text-zinc-400">First name</span>
                  <input
                    required
                    maxLength={120}
                    value={form.firstName}
                    onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))}
                    className="w-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs text-zinc-400">Last name</span>
                  <input
                    required
                    maxLength={120}
                    value={form.lastName}
                    onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))}
                    className="w-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs text-zinc-400">Email</span>
                  <input
                    required
                    type="email"
                    maxLength={320}
                    value={form.email}
                    onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                    className="w-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs text-zinc-400">Company</span>
                  <input
                    maxLength={200}
                    value={form.company ?? ''}
                    onChange={(event) => setForm((current) => ({ ...current, company: event.target.value }))}
                    className="w-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs text-zinc-400">Passport expiry</span>
                  <input
                    type="date"
                    value={form.passportExpiresAt ?? ''}
                    onChange={(event) => setForm((current) => ({ ...current, passportExpiresAt: event.target.value || null }))}
                    className="w-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs text-zinc-400">Visa subclass</span>
                  <input
                    maxLength={40}
                    value={form.visaSubclass ?? ''}
                    onChange={(event) => setForm((current) => ({ ...current, visaSubclass: event.target.value }))}
                    className="w-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs text-zinc-400">Visa expiry</span>
                  <input
                    type="date"
                    value={form.visaExpiresAt ?? ''}
                    onChange={(event) => setForm((current) => ({ ...current, visaExpiresAt: event.target.value || null }))}
                    className="w-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                  />
                </label>
                <div className="flex flex-wrap gap-2 sm:col-span-2">
                  <button
                    type="submit"
                    disabled={isSavingClient}
                    className="bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
                  >
                    {isSavingClient ? 'Saving...' : editingClientId ? 'Save changes' : 'Add client'}
                  </button>
                  {editingClientId && (
                    <button type="button" onClick={resetForm} className="border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900">
                      Cancel edit
                    </button>
                  )}
                </div>
                </fieldset>
              </form>
            </section>

            <section id="document-staging" className="border border-zinc-800 bg-zinc-900/40">
              <div className="border-b border-zinc-800 px-5 py-4">
                <h2 className="text-base font-semibold">Document staging</h2>
                <p className="mt-1 text-xs text-zinc-500">File contents go to the local folder or private cloud bucket.</p>
              </div>
              <div className="space-y-4 p-5">
                {preference === 'local' && (
                  <div className="flex flex-wrap items-center gap-3">
                    <button type="button" onClick={() => void handleChooseFolder()} className="border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900">
                      Choose local folder
                    </button>
                    {selectedFolder && <span className="text-xs text-zinc-500">Folder: {selectedFolder}</span>}
                  </div>
                )}
                <form onSubmit={handleStageDocument} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-xs text-zinc-400">Client</span>
                    <select
                      required
                      value={selectedClientId}
                      disabled={selectedClient?.status === 'archived'}
                      onChange={(event) => setSelectedClientId(event.target.value)}
                      className="w-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                    >
                      <option value="">Select client</option>
                      {clients.map((client) => <option key={client.id} value={client.id}>{client.firstName} {client.lastName}</option>)}
                    </select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-xs text-zinc-400">File</span>
                    <input
                      required
                      type="file"
                      disabled={selectedClient?.status === 'archived'}
                      onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                      className="block w-full text-sm text-zinc-400 file:mr-3 file:border-0 file:bg-zinc-800 file:px-3 file:py-2 file:text-xs file:text-zinc-200"
                    />
                  </label>
                  {documentSuccessMessage && (
                    <p role="status" className="text-sm text-emerald-300 sm:col-span-2">{documentSuccessMessage}</p>
                  )}
                  <button
                    type="submit"
                    disabled={!selectedClientId || selectedClient?.status === 'archived' || !selectedFile || isStagingDocument}
                    className="justify-self-start bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 sm:col-span-2"
                  >
                    {isStagingDocument ? 'Staging...' : 'Stage document'}
                  </button>
                </form>
              </div>
            </section>

            <section id="financial-monitoring" className="border border-zinc-800 bg-zinc-900/40">
              <div className="border-b border-zinc-800 px-5 py-4">
                <h2 className="text-base font-semibold">Financial monitoring</h2>
              </div>
              <div className="grid grid-cols-1 divide-y divide-zinc-800 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                <div className="p-5">
                  <p className="text-xs text-zinc-500">Invoices for selected client</p>
                  <p className="mt-1 text-2xl font-semibold">{financialSummary?.invoiceCount ?? 0}</p>
                  <p className="mt-1 text-xs text-zinc-500">{financialSummary?.overdueInvoiceCount ?? 0} overdue</p>
                </div>
                <div className="p-5">
                  <p className="text-xs text-zinc-500">Grant entries for selected client</p>
                  <p className="mt-1 text-2xl font-semibold">{financialSummary?.grantCount ?? 0}</p>
                  <p className="mt-1 text-xs text-zinc-500">Latest {grants[0] ? formatDate(grants[0].createdAt) : '—'}</p>
                </div>
                <div className="p-5">
                  <p className="text-xs text-zinc-500">Available grant balance</p>
                  {selectedClientBalances.length ? selectedClientBalances.map((balance) => (
                    <p key={balance.currency} className="mt-1 text-lg font-semibold">
                      {formatMoney(balance.availableBalance, balance.currency)}
                    </p>
                  )) : <p className="mt-1 text-sm text-zinc-500">No grant funds</p>}
                </div>
              </div>
              <form id="invoice-form" onSubmit={handleInvoiceSubmit} className="scroll-mt-24 grid grid-cols-1 gap-3 border-t border-zinc-800 p-5 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <h3 className="text-xs font-semibold uppercase text-zinc-400">Add invoice for {selectedClient ? `${selectedClient.firstName} ${selectedClient.lastName}` : 'selected client'}</h3>
                </div>
                <label className="space-y-1.5">
                  <span className="text-xs text-zinc-400">Invoice number</span>
                  <input
                    required
                    maxLength={80}
                    value={invoiceForm.invoiceNumber}
                    onChange={(event) => setInvoiceForm((current) => ({ ...current, invoiceNumber: event.target.value }))}
                    className="w-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs text-zinc-400">Amount</span>
                  <input
                    required
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={invoiceForm.amount}
                    onChange={(event) => setInvoiceForm((current) => ({ ...current, amount: event.target.value }))}
                    className="w-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs text-zinc-400">Currency</span>
                  <input
                    required
                    maxLength={3}
                    pattern="[A-Za-z]{3}"
                    value={invoiceForm.currency}
                    onChange={(event) => setInvoiceForm((current) => ({ ...current, currency: event.target.value }))}
                    className="w-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm uppercase outline-none focus:border-emerald-500"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs text-zinc-400">Due date</span>
                  <input
                    type="date"
                    value={invoiceForm.dueAt}
                    onChange={(event) => setInvoiceForm((current) => ({ ...current, dueAt: event.target.value }))}
                    className="w-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                  />
                </label>
                <button
                  type="submit"
                  disabled={!selectedClient || selectedClient.status === 'archived' || isSavingInvoice}
                  className="self-end bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isSavingInvoice ? 'Saving invoice...' : 'Add invoice'}
                </button>
              </form>
              {selectedClient && selectedClientInvoices.length > 0 && (
                <div className="border-t border-zinc-800 p-5">
                  <h3 className="mb-3 text-xs font-semibold uppercase text-zinc-400">Selected client invoices</h3>
                  <div className="space-y-2">
                    {selectedClientInvoices.map((invoice) => (
                      <div key={invoice.id} className="flex items-center justify-between gap-3 text-sm">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="truncate text-zinc-300">{invoice.invoiceNumber}</span>
                          <span className="border border-zinc-700 px-2 py-1 text-xs text-zinc-400">{invoice.status}</span>
                        </div>
                        <div className="text-right">
                          <span className="block font-mono text-zinc-200">{formatMoney(invoice.amount, invoice.currency)}</span>
                          <span className="block text-xs text-zinc-500">
                            {formatMoney(invoice.grantAppliedAmount, invoice.currency)} covered · {formatMoney(invoice.amountDue, invoice.currency)} due
                          </span>
                          {invoice.amountDue > 0 && (
                            <form onSubmit={(event) => void handleInvoicePayment(event, invoice)} className="mt-2 flex items-center justify-end gap-2">
                              <input
                                aria-label={`Payment amount for invoice ${invoice.invoiceNumber}`}
                                type="number"
                                min="0.01"
                                max={invoice.amountDue}
                                step="0.01"
                                required
                                value={paymentAmounts[invoice.id] ?? ''}
                                onChange={(event) => setPaymentAmounts((current) => ({ ...current, [invoice.id]: event.target.value }))}
                                className="w-28 border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100"
                              />
                              <button type="submit" disabled={recordingPaymentId === invoice.id} className="border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">
                                {recordingPaymentId === invoice.id ? 'Saving' : 'Record payment'}
                              </button>
                            </form>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {invoiceHasMore && (
                    <button type="button" onClick={() => void loadMoreInvoices()} disabled={loadingMore === 'invoices'} className="mt-4 border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">
                      {loadingMore === 'invoices' ? 'Loading invoices...' : 'Load more invoices'}
                    </button>
                  )}
                </div>
              )}
              <form id="grant-form" onSubmit={handleGrantSubmit} className="scroll-mt-24 grid grid-cols-1 gap-3 border-t border-zinc-800 p-5 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <h3 className="text-xs font-semibold uppercase text-zinc-400">Add grant ledger entry for {selectedClient ? `${selectedClient.firstName} ${selectedClient.lastName}` : 'selected client'}</h3>
                </div>
                <label className="space-y-1.5">
                  <span className="text-xs text-zinc-400">Grant source</span>
                  <input
                    required
                    maxLength={160}
                    value={grantForm.source}
                    onChange={(event) => setGrantForm((current) => ({ ...current, source: event.target.value }))}
                    className="w-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs text-zinc-400">Allocation date</span>
                  <input
                    required
                    type="date"
                    value={grantForm.allocationDate}
                    onChange={(event) => setGrantForm((current) => ({ ...current, allocationDate: event.target.value }))}
                    className="w-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs text-zinc-400">Amount</span>
                  <input
                    required
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={grantForm.amount}
                    onChange={(event) => setGrantForm((current) => ({ ...current, amount: event.target.value }))}
                    className="w-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs text-zinc-400">Currency</span>
                  <input
                    required
                    maxLength={3}
                    pattern="[A-Za-z]{3}"
                    value={grantForm.currency}
                    onChange={(event) => setGrantForm((current) => ({ ...current, currency: event.target.value }))}
                    className="w-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm uppercase outline-none focus:border-emerald-500"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs text-zinc-400">Reference</span>
                  <input
                    maxLength={120}
                    value={grantForm.reference}
                    onChange={(event) => setGrantForm((current) => ({ ...current, reference: event.target.value }))}
                    className="w-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                  />
                </label>
                <label className="space-y-1.5 sm:col-span-2">
                  <span className="text-xs text-zinc-400">Description</span>
                  <input
                    maxLength={500}
                    value={grantForm.description}
                    onChange={(event) => setGrantForm((current) => ({ ...current, description: event.target.value }))}
                    className="w-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                  />
                </label>
                <button
                  type="submit"
                  disabled={!selectedClient || selectedClient.status === 'archived' || isSavingGrant}
                  className="self-end bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isSavingGrant ? 'Saving entry...' : 'Add grant entry'}
                </button>
              </form>
              {selectedClient && selectedClientGrants.length > 0 && (
                <div className="border-t border-zinc-800 p-5">
                  <h3 className="mb-3 text-xs font-semibold uppercase text-zinc-400">Selected client grants</h3>
                  <div className="space-y-2">
                    {selectedClientGrants.map((grant) => (
                      <div key={grant.id} className="flex items-center justify-between gap-3 text-sm">
                        <div className="min-w-0">
                          <span className="block text-zinc-300">{grant.source} {grant.reference && <span className="text-zinc-500">· {grant.reference}</span>}</span>
                          <span className="block text-xs text-zinc-500">Allocated {formatDate(grant.allocationDate)}</span>
                          {grant.description && <span className="block truncate text-xs text-zinc-500">{grant.description}</span>}
                        </div>
                        <span className="font-mono text-zinc-200">{formatMoney(grant.amount, grant.currency)}</span>
                      </div>
                    ))}
                  </div>
                  {grantHasMore && (
                    <button type="button" onClick={() => void loadMoreGrants()} disabled={loadingMore === 'grants'} className="mt-4 border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">
                      {loadingMore === 'grants' ? 'Loading grant entries...' : 'Load more grant entries'}
                    </button>
                  )}
                </div>
              )}
            </section>
          </div>

          <div className="space-y-6">
            <section id="staged-documents" className="border border-zinc-800 bg-zinc-900/40">
              <div className="border-b border-zinc-800 px-5 py-4">
                <h2 className="text-base font-semibold">Staged documents</h2>
                <p className="mt-1 text-xs text-zinc-500">
                  {selectedClient ? `For ${selectedClient.firstName} ${selectedClient.lastName}` : 'Select a client to view documents'}
                </p>
              </div>
              {!selectedClient ? (
                <p className="px-5 py-8 text-sm text-zinc-500">No client selected.</p>
              ) : selectedClientDocuments.length === 0 ? (
                <p className="px-5 py-8 text-sm text-zinc-500">No documents staged for this client.</p>
              ) : (
                <div className="divide-y divide-zinc-800">
                  {selectedClientDocuments.map((document) => (
                    <div key={document.id} className="flex items-center justify-between gap-4 px-5 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-zinc-200">{document.fileName}</p>
                        <p className="mt-1 text-xs text-zinc-500">{document.mimeType} · {(document.fileSize / 1024).toFixed(1)} KB</p>
                      </div>
                      <time className="shrink-0 text-xs text-zinc-500">{formatDate(document.uploadedAt)}</time>
                    </div>
                  ))}
                  {documentHasMore && (
                    <div className="border-t border-zinc-800 p-4">
                      <button type="button" onClick={() => void loadMoreDocuments()} disabled={loadingMore === 'documents'} className="border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">
                        {loadingMore === 'documents' ? 'Loading documents...' : 'Load more documents'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>

            {selectedClient && (
              <section id="credentials-vault" className="border border-zinc-800 bg-zinc-900/40">
                <div className="border-b border-zinc-800 px-5 py-4">
                  <h2 className="text-base font-semibold">Credentials vault</h2>
                  <p className="mt-1 text-xs text-zinc-500">Vault passwords stay masked until security verification succeeds.</p>
                </div>
                {preference === 'cloud' ? (
                  <div className="p-4">
                    <CredentialVault
                      key={selectedClient.id}
                      clientId={selectedClient.id}
                      clientName={`${selectedClient.firstName} ${selectedClient.lastName}`}
                    />
                  </div>
                ) : (
                  <p className="px-5 py-6 text-sm text-zinc-500">Credential vault is available in authenticated cloud mode.</p>
                )}
              </section>
            )}

            <section id="data-governance" className="border border-zinc-800 bg-zinc-900/40">
              <div className="border-b border-zinc-800 px-5 py-4">
                <h2 className="text-base font-semibold">Purge and data governance</h2>
                <p className="mt-1 text-xs text-zinc-500">Expiry reminders run daily at 08:00 UTC for 90, 60, and 30 days.</p>
              </div>
              <div className="grid grid-cols-2 divide-x divide-zinc-800 border-b border-zinc-800">
                <div className="p-4">
                  <p className="text-xs text-zinc-500">Expiry records on loaded clients</p>
                  <p className="mt-1 text-xl font-semibold">{expirationReviews.length}</p>
                </div>
                <div className="p-4">
                  <p className="text-xs text-zinc-500">Reminder events</p>
                  <p className="mt-1 text-xl font-semibold">{notifications.length}</p>
                </div>
              </div>

              <div className="border-b border-zinc-800 p-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-xs font-semibold uppercase text-zinc-400">Expiry review queue</h3>
                  <span className="text-[10px] uppercase text-amber-300">Review only</span>
                </div>
                {expirationReviews.length === 0 ? (
                  <p className="text-sm text-zinc-500">No passport or visa expiry dates recorded.</p>
                ) : (
                  <div className="max-h-64 space-y-2 overflow-auto">
                    {expirationReviews.map((record) => (
                      <div key={record.id} className="flex items-center justify-between gap-3 border-b border-zinc-800/70 pb-2 text-sm last:border-0">
                        <span className="min-w-0 truncate text-zinc-300">{record.clientName} · {record.documentType}</span>
                        <time className="shrink-0 text-xs text-zinc-500">{formatDate(record.expiresOn)}</time>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-b border-zinc-800 p-5">
                <h3 className="mb-3 text-xs font-semibold uppercase text-zinc-400">Agent reminder audit</h3>
                {notifications.length === 0 ? (
                  <p className="text-sm text-zinc-500">No worker notifications have been recorded.</p>
                ) : (
                  <div className="max-h-64 space-y-3 overflow-auto">
                    {notifications.slice(0, 20).map((notification) => (
                      <article key={notification.id} className="border-b border-zinc-800/70 pb-3 last:border-0">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm text-zinc-200">{notification.title}</p>
                          <span className="shrink-0 text-[10px] uppercase text-emerald-300">{notification.deliveryStatus}</span>
                        </div>
                        <p className="mt-1 text-xs text-zinc-500">{notification.message}</p>
                        <p className="mt-1 text-[10px] text-zinc-600">
                          {notification.noticeDays}-day notice · expires {formatDate(notification.expiresOn)} · created {formatDate(notification.createdAt)}
                        </p>
                      </article>
                    ))}
                  </div>
                )}
              </div>

              <p className="px-5 py-4 text-xs leading-5 text-zinc-500">
                Expiry notifications do not purge data. Destructive purging is disabled until an organization retention policy and approval workflow are defined.
              </p>
            </section>
          </div>
        </div>
      </div>
    </FinancialWorkspaceLayout>
  );
}

export default function DashboardPage() {
  return (
    <DashboardStorageProvider>
      <DashboardContent />
    </DashboardStorageProvider>
  );
}
