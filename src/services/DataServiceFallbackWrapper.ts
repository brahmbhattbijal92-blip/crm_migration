import { DataService } from './DataService';
import { Client, DocumentMetadata, SearchQuery, SearchResult } from '../types/data';
import { DataServiceError, StorageEngineError } from '../errors/DataErrors';

export class DataServiceFallbackWrapper extends DataService {
  constructor(
    private cloudEngine: DataService,
    private localEngine: DataService,
    private getPreference: () => 'local' | 'cloud'
  ) {
    super();
  }

  /** Routes each operation only to the explicitly selected storage domain. */
  private async executeInSelectedStorage<T>(
    cloudOp: () => Promise<T>,
    localOp: () => Promise<T>
  ): Promise<T> {
    const preference = this.getPreference();

    if (preference === 'local') {
      try {
        return await localOp();
      } catch (err) {
        throw new StorageEngineError('Local IndexedDB operation failed.', err);
      }
    }

    return cloudOp();
  }

  async saveClient(client: Omit<Client, 'updatedAt'>): Promise<Client> {
    return this.executeInSelectedStorage(
      () => this.cloudEngine.saveClient(client),
      () => this.localEngine.saveClient(client)
    );
  }

  async findClient(id: string): Promise<Client | null> {
    return this.executeInSelectedStorage(
      () => this.cloudEngine.findClient(id),
      () => this.localEngine.findClient(id)
    );
  }

  async updateClient(
    id: string,
    updates: Partial<Pick<Client, 'name' | 'email' | 'company'>>
  ): Promise<Client> {
    return this.executeInSelectedStorage(
      () => this.cloudEngine.updateClient(id, updates),
      () => this.localEngine.updateClient(id, updates)
    );
  }

  async deleteClient(id: string): Promise<void> {
    return this.executeInSelectedStorage(
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
    return this.executeInSelectedStorage(
      () => this.cloudEngine.uploadDocument(clientId, file),
      () => this.localEngine.uploadDocument(clientId, file)
    );
  }

  async searchRecords(query: SearchQuery): Promise<SearchResult<Client>> {
    return this.executeInSelectedStorage(
      () => this.cloudEngine.searchRecords(query),
      () => this.localEngine.searchRecords(query)
    );
  }
}
