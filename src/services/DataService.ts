import type { Client, DocumentMetadata, SearchQuery, SearchResult } from '../types/data';

export abstract class DataService {
  /**
   * Persists or updates a client record within the selected storage domain.
   */
  abstract saveClient(client: Omit<Client, 'updatedAt'>): Promise<Client>;

  abstract updateClient(
    id: string,
    updates: Partial<Pick<Client, 'name' | 'email' | 'company'>>
  ): Promise<Client>;

  /**
   * Retrieves a specific client by their unique identifier.
   * Returns null if no record is discovered.
   */
  abstract findClient(id: string): Promise<Client | null>;

  /** Soft-deletes a client record while retaining its audit history. */
  abstract deleteClient(id: string): Promise<void>;

  /** Opens the browser folder picker and remembers the selected local document directory. */
  abstract selectDocumentDirectory(): Promise<string | null>;

  /**
   * Handles multi-part file payloads or binary data buffers to destination targets.
   */
  abstract uploadDocument(clientId: string, file: File): Promise<DocumentMetadata>;

  /**
   * Executes arbitrary queries against indexed storage engines.
   */
  abstract searchRecords(query: SearchQuery): Promise<SearchResult<Client>>;
}
