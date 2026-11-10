'use server';

import { createSupabaseAdminClient } from '../../src/lib/supabase/admin';
import { requireOrganizationContext } from '../../src/lib/supabase/server';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listClientAssignmentAgents() {
  const { organizationId, role } = await requireOrganizationContext();
  if (!['owner', 'admin'].includes(role)) return { canAssign: false, agents: [] };

  const admin = createSupabaseAdminClient();
  const { data: memberships, error: membershipError } = await admin
    .from('organization_memberships')
    .select('user_id')
    .eq('organization_id', organizationId)
    .eq('role', 'agent')
    .is('removed_at', null)
    .order('created_at', { ascending: true });
  if (membershipError) throw new Error(`Client assignment agents failed to load: ${membershipError.message}`);

  const userIds = (memberships ?? []).map((membership) => String(membership.user_id));
  if (userIds.length === 0) return { canAssign: true, agents: [] };

  const { data: profiles, error: profileError } = await admin
    .from('profiles')
    .select('user_id, display_name, email')
    .in('user_id', userIds);
  if (profileError) throw new Error(`Client assignment profiles failed to load: ${profileError.message}`);

  const profilesByUser = new Map((profiles ?? []).map((profile) => [String(profile.user_id), profile]));
  return {
    canAssign: true,
    agents: userIds.map((userId) => {
      const profile = profilesByUser.get(userId);
      return {
        userId,
        displayName: String(profile?.display_name ?? ''),
        email: String(profile?.email ?? ''),
      };
    }),
  };
}

export async function assignClientToAgent(clientId: string, agentId: string | null): Promise<void> {
  if (!UUID_PATTERN.test(clientId) || (agentId !== null && !UUID_PATTERN.test(agentId))) {
    throw new Error('Choose a valid client and agent.');
  }

  const { supabase } = await requireOrganizationContext({ adminOnly: true });
  const { error } = await supabase.rpc('assign_client_to_agent', {
    requested_client_id: clientId,
    requested_agent_id: agentId,
  });
  if (error) throw new Error(`Client assignment failed: ${error.message}`);
}
