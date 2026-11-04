import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { getSupabasePublicConfig } from './config';

export function createSupabaseAdminClient() {
  const config = getSupabasePublicConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!config || !serviceRoleKey || serviceRoleKey.includes('YOUR_SUPABASE_SERVICE_ROLE_KEY')) {
    throw new Error('Server-side Supabase admin access is not configured.');
  }

  return createClient(config.url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
