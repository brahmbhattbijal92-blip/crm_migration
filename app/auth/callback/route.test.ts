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
});