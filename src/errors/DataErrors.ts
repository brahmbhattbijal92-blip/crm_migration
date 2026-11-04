export type ErrorSeverity = 'WARNING' | 'CRITICAL' | 'FATAL';

export class DataServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly severity: ErrorSeverity = 'CRITICAL',
    public readonly originalError?: unknown
  ) {
    super(message);
    this.name = 'DataServiceError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NetworkTimeoutError extends DataServiceError {
  constructor(message = 'Upstream remote endpoint requests timed out.', originalError?: unknown) {
    super(message, 'NETWORK_TIMEOUT', 'CRITICAL', originalError);
    this.name = 'NetworkTimeoutError';
  }
}

export class StorageEngineError extends DataServiceError {
  constructor(message: string, originalError?: unknown) {
    super(message, 'STORAGE_ENGINE_FAILURE', 'FATAL', originalError);
    this.name = 'StorageEngineError';
  }
}

export interface SyncMutationTask {
  id: string;
  action: 'SAVE_CLIENT' | 'UPLOAD_DOC';
  payload: unknown;
  createdAt: string;
  attempts: number;
  lastError?: string;
}
