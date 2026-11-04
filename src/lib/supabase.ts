import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DataServiceError } from '../errors/DataErrors';
import { getSupabasePublicConfig } from './supabase/config';

let supabaseClient: SupabaseClient | undefined;

export function getSupabaseClient(): SupabaseClient {
  if (supabaseClient) return supabaseClient;

  const config = getSupabasePublicConfig();
  if (!config) {
    throw new DataServiceError(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
      'SUPABASE_CONFIGURATION_MISSING',
      'FATAL'
    );
  }

  supabaseClient = createBrowserClient(config.url, config.anonKey);
  return supabaseClient;
}