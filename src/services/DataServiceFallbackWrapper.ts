import { DataService } from './DataService';
import { Client, DocumentMetadata, SearchQuery, SearchResult } from '../types/data';
import { DataServiceError, NetworkTimeoutError, StorageEngineError } from '../errors/DataErrors';

export class DataServiceFallbackWrapper extends DataService {
  constructor(
    private cloudEngine: DataService,
    private localEngine: DataService,
    private getPreference: () => 'local' | 'cloud'
  ) {
    super();
  }

  /**
   * Universal runtime decorator execution block to swallow or reroute operational dropouts.
   */
  private async executeWithFallback<T>(
    operationName: string,
    cloudOp: () => Promise<T>,
    localOp: () => Promise<T>
  ): Promise<T> {
    const preference = this.getPreference();

    if (preference === 'local') {
      try {
        return await localOp();
      } catch (err) {
        throw new StorageEngineError(`Local IndexedDB operation failed [${operationName}]`, err);
      }
    }

    // Processing using Cloud Engine with immediate local failover fallback mechanics
    try {
      // Impose a baseline runtime execution gate context deadline
      return await Promise.race([
        cloudOp(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new NetworkTimeoutError()), 8000)
        ),
      ]);
    } catch (error) {
      console.warn(`[FallbackWrapper] Cloud engine hit an exception during ${operationName}. Dropping back down to local storage logs.`, error);
      
      // Persist metadata locally into the local mutation transaction tracker table 
      await this.queueOfflineMutation(operationName, error);
      
      try {
        return await localOp();
      } catch (localErr) {
        throw new StorageEngineError(`Total fallback pipeline failure. Both Local and Cloud strategies exhausted on [${operationName}].`, localErr);
      }
    }
  }

  private async queueOfflineMutation(operationName: string, error: unknown) {
    if (typeof window === 'undefined') return;
    try {
      const queue = JSON.parse(localStorage.getItem('crm_pending_sync_queue') || '[]');
      queue.push({
        id: crypto.randomUUID(),
        operation: operationName,
        timestamp: new Date().toISOString(),
        errorMessage: error instanceof Error ? error.message : 'Unknown network failure',
      });
      localStorage.setItem('crm_pending_sync_queue', JSON.stringify(queue));
      window.dispatchEvent(new Event('local-storage-update')); // Alert context streams
    } catch (e) {
      console.error('Failed caching offline mutation index ledger.', e);
    }
  }

  async saveClient(client: Omit<Client, 'updatedAt'>): Promise<Client> {
    return this.executeWithFallback(
      'saveClient',
      () => this.cloudEngine.saveClient(client),
      () => this.localEngine.saveClient(client)
    );
  }

  async findClient(id: string): Promise<Client | null> {
    return this.executeWithFallback(
      'findClient',
      () => this.cloudEngine.findClient(id),
      () => this.localEngine.findClient(id)
    );
  }

  async updateClient(
    id: string,
    updates: Partial<Pick<Client, 'name' | 'email' | 'company'>>
  ): Promise<Client> {
    return this.executeWithFallback(
      'updateClient',
      () => this.cloudEngine.updateClient(id, updates),
      () => this.localEngine.updateClient(id, updates)
    );
  }

  async deleteClient(id: string): Promise<void> {
    return this.executeWithFallback(
      'deleteClient',
      () => this.cloudEngine.deleteClient(id),
      () => this.localEngine.deleteClient(id)
    );
  }

  selectDocumentDirectory(): Promise<string | null> {
    if (this.getPreference() !== 'local') {
      throw new DataServiceError(
        'Switch storage preference to local before selecting a document folder.',
        'LOCAL_DOCUMENT_FOLDER_ONLY',
        'WARNING'
      );
    }
    return this.localEngine.selectDocumentDirectory();
  }

  async uploadDocument(clientId: string, file: File): Promise<DocumentMetadata> {
    return this.executeWithFallback(
      'uploadDocument',
      () => this.cloudEngine.uploadDocument(clientId, file),
      () => this.localEngine.uploadDocument(clientId, file)
    );
  }

  async searchRecords(query: SearchQuery): Promise<SearchResult<Client>> {
    return this.executeWithFallback(
      'searchRecords',
      () => this.cloudEngine.searchRecords(query),
      () => this.localEngine.searchRecords(query)
    );
  }
}
