export interface Client {
  id: string;
  name: string;
  email: string;
  company?: string;
  updatedAt: string;
}

export interface DocumentMetadata {
  id: string;
  clientId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  storageUrl: string;
  uploadedAt: string;
}

export interface SearchQuery {
  term: string;
  limit?: number;
  offset?: number;
}

export interface SearchResult<T> {
  items: T[];
  totalCount: number;
}
