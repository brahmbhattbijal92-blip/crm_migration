'use server';

import { createSupabaseAdminClient } from '../../../src/lib/supabase/admin';
import { requireOrganizationContext } from '../../../src/lib/supabase/server';

function getAppOrigin(): string {
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configuredOrigin) {
    if (process.env.NODE_ENV === 'production') throw new Error('Set NEXT_PUBLIC_APP_URL before sending agent invitations.');
    return 'http://localhost:3000';
  }
  const url = new URL(configuredOrigin);
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('NEXT_PUBLIC_APP_URL must use HTTPS in production.');
  }
  return url.origin;
}

export async function listOrganizationMembers() {
  const { organizationId } = await requireOrganizationContext({ adminOnly: true });
  const admin = createSupabaseAdminClient();
  const { data: memberships, error: membershipError } = await admin
    .from('organization_memberships')
    .select('user_id, role, created_at')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: true });
  if (membershipError) throw new Error(`Team list failed: ${membershipError.message}`);

  const userIds = (memberships ?? []).map((membership) => String(membership.user_id));
  if (userIds.length === 0) return [];
  const { data: profiles, error: profileError } = await admin
    .from('profiles')
    .select('user_id, display_name, email')
    .in('user_id', userIds);
  if (profileError) throw new Error(`Team profiles failed: ${profileError.message}`);

  const profilesByUser = new Map((profiles ?? []).map((profile) => [String(profile.user_id), profile]));
  return (memberships ?? []).map((membership) => {
    const profile = profilesByUser.get(String(membership.user_id));
    return {
      userId: String(membership.user_id),
      role: String(membership.role),
      displayName: String(profile?.display_name ?? ''),
      email: String(profile?.email ?? ''),
      createdAt: String(membership.created_at),
    };
  });
}

export async function inviteOrganizationAgent(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error('Enter a valid work email address.');
  }

  const { organizationId, user } = await requireOrganizationContext({ adminOnly: true });
  if (user.email?.trim().toLowerCase() === normalizedEmail) {
    return { email: normalizedEmail, status: 'self' as const };
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(normalizedEmail, {
    redirectTo: `${getAppOrigin()}/auth/callback?next=/dashboard`,
    data: { invited_organization_id: organizationId },
  });
  if (error) {
    const alreadyRegistered = error.code === 'email_exists' || /already\s+(been\s+)?registered/i.test(error.message);
    if (!alreadyRegistered) throw new Error(`Agent invitation failed: ${error.message}`);

    const { data: existingProfile, error: profileLookupError } = await admin
      .from('profiles')
      .select('user_id')
      .eq('email', normalizedEmail)
      .maybeSingle();
    if (profileLookupError) throw new Error(`Existing agent lookup failed: ${profileLookupError.message}`);
    if (!existingProfile) {
      throw new Error('This account already exists, but its profile could not be found. Contact an administrator.');
    }

    const existingUserId = String(existingProfile.user_id);
    if (existingUserId === user.id) {
      return { email: normalizedEmail, status: 'self' as const };
    }

    const { data: existingMembership, error: membershipLookupError } = await admin
      .from('organization_memberships')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', existingUserId)
      .maybeSingle();
    if (membershipLookupError) throw new Error(`Existing membership lookup failed: ${membershipLookupError.message}`);

    if (existingMembership && ['owner', 'admin'].includes(String(existingMembership.role))) {
      return { email: normalizedEmail, status: 'privileged-member' as const };
    }
    if (existingMembership?.role === 'agent') {
      return { email: normalizedEmail, status: 'already-active' as const };
    }

    const { error: membershipError } = await admin
      .from('organization_memberships')
      .upsert({ organization_id: organizationId, user_id: existingUserId, role: 'agent' });
    if (membershipError) throw new Error(`Existing account access could not be assigned: ${membershipError.message}`);

    const { error: profileError } = await admin
      .from('profiles')
      .update({ default_organization_id: organizationId })
      .eq('user_id', existingUserId);
    if (profileError) throw new Error(`The default organization could not be set: ${profileError.message}`);

    return {
      email: normalizedEmail,
      status: existingMembership?.role === 'inactive' ? 'reactivated' as const : 'added' as const,
    };
  }

  if (!data.user) throw new Error('Supabase did not return the invited agent account.');
  if (data.user.id === user.id) return { email: normalizedEmail, status: 'self' as const };

  const { error: membershipError } = await admin
    .from('organization_memberships')
    .upsert({ organization_id: organizationId, user_id: data.user.id, role: 'agent' });
  if (membershipError) throw new Error(`Invite was sent, but organization access could not be assigned: ${membershipError.message}`);

  const { error: profileError } = await admin
    .from('profiles')
    .update({ default_organization_id: organizationId })
    .eq('user_id', data.user.id)
    .is('default_organization_id', null);
  if (profileError) throw new Error(`Invite was sent, but the default organization could not be set: ${profileError.message}`);

  return { email: normalizedEmail, status: 'invited' as const };
}

export async function setOrganizationAgentActive(userId: string, isActive: boolean) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error('Select a valid organization member.');
  }
  if (typeof isActive !== 'boolean') throw new Error('Choose a valid agent status.');

  const { organizationId, user } = await requireOrganizationContext({ adminOnly: true });
  if (user.id === userId) throw new Error('You cannot remove your own account.');

  const admin = createSupabaseAdminClient();
  const { data: updatedMemberships, error: updateError } = await admin
    .from('organization_memberships')
    .update({ role: isActive ? 'agent' : 'inactive' })
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .eq('role', isActive ? 'inactive' : 'agent')
    .select('user_id');
  if (updateError) throw new Error(`Agent status update failed: ${updateError.message}`);
  if (!updatedMemberships?.length) {
    throw new Error(isActive
      ? 'This member is not inactive in the organization.'
      : 'Only active agents can be deactivated.');
  }
}
