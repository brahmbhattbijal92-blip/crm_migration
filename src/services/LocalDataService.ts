import { DataService } from './DataService';
import type { Client, DocumentMetadata, SearchQuery, SearchResult } from '../types/data';
import { DataServiceError, StorageEngineError } from '../errors/DataErrors';

const DATABASE_NAME = 'crm-migration-local';
const DATABASE_VERSION = 4;
const CLIENTS_STORE = 'clients';
const DOCUMENTS_STORE = 'documents';
const CREDENTIALS_STORE = 'credentials';
const INVOICES_STORE = 'financial_invoices';
const GRANTS_STORE = 'grants_ledger';
const GOVERNANCE_NOTIFICATIONS_STORE = 'governance_notifications';
const SETTINGS_STORE = 'settings';
const DIRECTORY_SETTING_KEY = 'document-directory';

type StoreName =
  | typeof CLIENTS_STORE
  | typeof DOCUMENTS_STORE
  | typeof CREDENTIALS_STORE
  | typeof INVOICES_STORE
  | typeof GRANTS_STORE
  | typeof GOVERNANCE_NOTIFICATIONS_STORE
  | typeof SETTINGS_STORE;
type FilePermission = 'granted' | 'denied' | 'prompt';

interface WritableFile {
  write(data: ArrayBuffer): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}

interface LocalFileHandle {
  createWritable(): Promise<WritableFile>;
}

interface LocalDirectoryHandle {
  readonly name: string;
  queryPermission(options: { mode: 'readwrite' }): Promise<FilePermission>;
  requestPermission(options: { mode: 'readwrite' }): Promise<FilePermission>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<LocalDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<LocalFileHandle>;
  removeEntry(name: string): Promise<void>;
}

interface DirectorySetting {
  key: typeof DIRECTORY_SETTING_KEY;
  handle: LocalDirectoryHandle;
}

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options: { mode: 'readwrite' }) => Promise<LocalDirectoryHandle>;
}

let databasePromise: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.reject(new StorageEngineError('IndexedDB is unavailable in this browser context.'));
  }

  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CLIENTS_STORE)) {
        database.createObjectStore(CLIENTS_STORE, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(DOCUMENTS_STORE)) {
        database.createObjectStore(DOCUMENTS_STORE, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(CREDENTIALS_STORE)) {
        database.createObjectStore(CREDENTIALS_STORE, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(INVOICES_STORE)) {
        database.createObjectStore(INVOICES_STORE, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(GRANTS_STORE)) {
        database.createObjectStore(GRANTS_STORE, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(GOVERNANCE_NOTIFICATIONS_STORE)) {
        database.createObjectStore(GOVERNANCE_NOTIFICATIONS_STORE, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
        database.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        databasePromise = undefined;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      databasePromise = undefined;
      reject(new StorageEngineError('Unable to open the local IndexedDB database.', request.error));
    };
    request.onblocked = () => {
      databasePromise = undefined;
      reject(new StorageEngineError('The local IndexedDB upgrade is blocked by another tab.'));
    };
  });

  return databasePromise;
}

async function runRequest<T>(
  storeName: StoreName,
  mode: IDBTransactionMode,
  createRequest: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    let result: T;
    const transaction = database.transaction(storeName, mode);
    const request = createRequest(transaction.objectStore(storeName));

    request.onsuccess = () => {
      result = request.result;
    };
    request.onerror = () => {
      reject(new StorageEngineError(`IndexedDB request failed in ${storeName}.`, request.error));
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => {
      reject(new StorageEngineError(`IndexedDB transaction failed in ${storeName}.`, transaction.error));
    };
    transaction.onabort = () => {
      reject(new StorageEngineError(`IndexedDB transaction was aborted in ${storeName}.`, transaction.error));
    };
  });
}

function sanitizePathSegment(value: string): string {
  const sanitized = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 120);
  return sanitized || 'document';
}

async function getSelectedDirectory(): Promise<LocalDirectoryHandle> {
  const setting = await runRequest<DirectorySetting | undefined>(
    SETTINGS_STORE,
    'readonly',
    (store) => store.get(DIRECTORY_SETTING_KEY)
  );

  if (!setting) {
    throw new DataServiceError(
      'Select a local document folder before uploading files.',
      'DOCUMENT_DIRECTORY_NOT_SELECTED',
      'WARNING'
    );
  }

  const permission = await setting.handle.queryPermission({ mode: 'readwrite' });
  if (permission !== 'granted') {
    throw new DataServiceError(
      'Folder access is not currently granted. Select the folder again to restore access.',
      'DOCUMENT_DIRECTORY_PERMISSION_REQUIRED',
      'WARNING'
    );
  }

  return setting.handle;
}

export class LocalDataService extends DataService {
  async saveClient(client: Omit<Client, 'updatedAt'>): Promise<Client> {
    const savedClient = { ...client, updatedAt: new Date().toISOString() };
    await runRequest(CLIENTS_STORE, 'readwrite', (store) => store.put(savedClient));
    return savedClient;
  }

  async updateClient(
    id: string,
    updates: Partial<Pick<Client, 'name' | 'email' | 'company'>>
  ): Promise<Client> {
    const existing = await this.findClient(id);
    if (!existing) {
      throw new DataServiceError(`Client ${id} was not found.`, 'CLIENT_NOT_FOUND', 'WARNING');
    }

    const updatedClient = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    await runRequest(CLIENTS_STORE, 'readwrite', (store) => store.put(updatedClient));
    return updatedClient;
  }

  async findClient(id: string): Promise<Client | null> {
    return (await runRequest<Client | undefined>(CLIENTS_STORE, 'readonly', (store) => store.get(id))) ?? null;
  }

  async deleteClient(id: string): Promise<void> {
    const existing = await this.findClient(id);
    if (!existing) {
      throw new DataServiceError(`Client ${id} was not found.`, 'CLIENT_NOT_FOUND', 'WARNING');
    }
    await runRequest(CLIENTS_STORE, 'readwrite', (store) => store.delete(id));
  }

  async selectDocumentDirectory(): Promise<string | null> {
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker) {
      throw new DataServiceError(
        'This browser does not support the File System Access API. Use a supported browser over HTTPS or localhost.',
        'FILE_SYSTEM_ACCESS_UNSUPPORTED',
        'WARNING'
      );
    }

    let handle: LocalDirectoryHandle;
    try {
      handle = await picker({ mode: 'readwrite' });
      const permission = await handle.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        throw new DataServiceError(
          'Write permission was not granted for the selected folder.',
          'DOCUMENT_DIRECTORY_PERMISSION_DENIED',
          'WARNING'
        );
      }
      await runRequest(SETTINGS_STORE, 'readwrite', (store) =>
        store.put({ key: DIRECTORY_SETTING_KEY, handle } satisfies DirectorySetting)
      );
      return handle.name;
    } catch (error) {
      if (error instanceof DataServiceError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') return null;
      throw new StorageEngineError('Unable to select or remember the local document folder.', error);
    }
  }

  async uploadDocument(clientId: string, file: File): Promise<DocumentMetadata> {
    const directory = await getSelectedDirectory();
    const clientFolder = sanitizePathSegment(clientId);
    const directoryHandle = await directory.getDirectoryHandle(clientFolder, { create: true });
    const fileName = `${crypto.randomUUID()}-${sanitizePathSegment(file.name)}`;
    const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();

    try {
      await writable.write(await file.arrayBuffer());
      await writable.close();
    } catch (error) {
      await writable.abort(error).catch(() => undefined);
      await directoryHandle.removeEntry(fileName).catch(() => undefined);
      throw new StorageEngineError('Unable to write the document bytes to the selected folder.', error);
    }

    const document: DocumentMetadata = {
      id: crypto.randomUUID(),
      clientId,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || 'application/octet-stream',
      storageUrl: `${clientFolder}/${fileName}`,
      uploadedAt: new Date().toISOString(),
    };

    try {
      await runRequest(DOCUMENTS_STORE, 'readwrite', (store) => store.put(document));
      return document;
    } catch (error) {
      await directoryHandle.removeEntry(fileName).catch(() => undefined);
      throw error;
    }
  }

  async searchRecords(query: SearchQuery): Promise<SearchResult<Client>> {
    const records = await runRequest<Client[]>(CLIENTS_STORE, 'readonly', (store) => store.getAll());
    const term = query.term.trim().toLocaleLowerCase();
    const matches = records.filter((client) =>
      `${client.name} ${client.email} ${client.company ?? ''}`.toLocaleLowerCase().includes(term)
    );
    const offset = Math.max(0, query.offset ?? 0);
    const limit = Math.max(0, query.limit ?? 25);

    return {
      items: matches.slice(offset, offset + limit),
      totalCount: matches.length,
    };
  }
}
