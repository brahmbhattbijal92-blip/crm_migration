import React, { Component, ErrorInfo, ReactNode } from 'react';
import { DataServiceError } from '../errors/DataErrors';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: unknown | null;
}

export class DataErrorBoundary extends Component<Props, State> {
  public override state: State = { hasError: false, error: null };

  public static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[DataErrorBoundary] Trapped diagnostic fault crash:', error, errorInfo);
  }

  private getErrorMessage(): string {
    const { error } = this.state;
    if (error === null || error === undefined) return 'An unexpected runtime data pipeline mutation failed.';
    if (error instanceof Error) return error.message;
    if (typeof error === 'object' && 'message' in error) return String(error.message);
    return String(error);
  }

  public override render() {
    if (this.state.hasError) {
      const { error } = this.state;
      const isFatal = error instanceof DataServiceError && error.severity === 'FATAL';

      return (
        <div style={{ padding: '20px', border: '1px solid red', borderRadius: '6px', background: '#fff5f5', color: '#1a1a1a' }}>
          <h3 style={{ margin: '0 0 10px 0', color: '#c53030' }}>Structural Storage Transaction Error Discovered</h3>
          <p style={{ margin: '0 0 15px 0' }}>{this.getErrorMessage()}</p>
          {isFatal ? (
            <button
              onClick={() => window.location.reload()}
              style={{ padding: '8px 12px', background: '#c53030', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
            >
              Reinitialize Environment Storage
            </button>
          ) : (
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              style={{ padding: '8px 12px', background: '#4a5568', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
            >
              Clear and Dismiss
            </button>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}