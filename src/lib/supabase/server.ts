import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getSupabasePublicConfig } from './config';

export async function createSupabaseServerClient() {
  const config = getSupabasePublicConfig();
  if (!config) throw new Error('Supabase is not configured.');

  const cookieStore = await cookies();
  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot write cookies; proxy.ts persists refreshed sessions.
        }
      },
    },
  });
}

export async function requireOrganizationContext(options: { adminOnly?: boolean; ownerOnly?: boolean; agentOrAdminOnly?: boolean } = {}) {
  const supabase = await createSupabaseServerClient();
  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError || !userResult.user) throw new Error('Sign in before using this feature.');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('default_organization_id')
    .eq('user_id', userResult.user.id)
    .single();
  if (profileError) throw new Error(`Organization lookup failed: ${profileError.message}`);
  if (!profile.default_organization_id) throw new Error('Set up or join an organization before continuing.');

  const organizationId = String(profile.default_organization_id);
  const { data: membership, error: membershipError } = await supabase
    .from('organization_memberships')
    .select('role, removed_at')
    .eq('organization_id', organizationId)
    .eq('user_id', userResult.user.id)
    .single();
  if (membershipError || !membership) throw new Error('You are not a member of this organization.');
  const role = String(membership.role);
  if (role === 'inactive' || membership.removed_at) throw new Error('Your organization membership is inactive.');
  if (options.ownerOnly && role !== 'owner') {
    throw new Error('Organization owner access is required.');
  }
  if (options.adminOnly && !['owner', 'admin'].includes(role)) {
    throw new Error('Organization owner or admin access is required.');
  }
  if (options.agentOrAdminOnly && !['owner', 'admin', 'agent'].includes(role)) {
    throw new Error('Agent or administrator access is required.');
  }

  return { supabase, user: userResult.user, organizationId, role };
}
