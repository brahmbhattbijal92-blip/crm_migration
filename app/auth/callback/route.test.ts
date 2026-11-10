import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMethods = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock('../../../src/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ auth: authMethods }),
}));

import { GET } from './route';

function makeRequest(query: string): NextRequest {
  const url = new URL(`https://crm-migration-three.vercel.app/auth/callback${query}`);
  return { nextUrl: url, url: url.toString() } as unknown as NextRequest;
}

describe('Supabase auth callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMethods.exchangeCodeForSession.mockResolvedValue({ error: null });
    authMethods.verifyOtp.mockResolvedValue({ error: null });
  });

  it('verifies invite token hashes and redirects to the requested internal page', async () => {
    const response = await GET(makeRequest('?token_hash=test-token-hash&type=invite&next=%2Fdashboard'));

    expect(authMethods.verifyOtp).toHaveBeenCalledWith({ token_hash: 'test-token-hash', type: 'invite' });
    expect(response.headers.get('location')).toBe('https://crm-migration-three.vercel.app/dashboard');
  });

  it('continues to exchange PKCE codes', async () => {
    const response = await GET(makeRequest('?code=test-code&next=%2Fdashboard'));

    expect(authMethods.exchangeCodeForSession).toHaveBeenCalledWith('test-code');
    expect(response.headers.get('location')).toBe('https://crm-migration-three.vercel.app/dashboard');
  });

  it('hands fragment-based email sessions to the browser completion page', async () => {
    const response = await GET(makeRequest('?next=%2Fdashboard'));

    expect(authMethods.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(authMethods.verifyOtp).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe('https://crm-migration-three.vercel.app/auth/complete?next=%2Fdashboard');
  });

  it('marks a server-verified reactivation callback for the completion page', async () => {
    const next = encodeURIComponent('/auth/complete?flow=reactivation&organization_id=123e4567-e89b-12d3-a456-426614174000');
    const response = await GET(makeRequest(`?code=test-code&next=${next}`));
    const destination = new URL(response.headers.get('location')!);

    expect(destination.pathname).toBe('/auth/complete');
    expect(destination.searchParams.get('flow')).toBe('reactivation');
    expect(destination.searchParams.get('verified')).toBe('1');
  });
});