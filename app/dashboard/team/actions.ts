'use server';

import { createSupabaseAdminClient } from '../../../src/lib/supabase/admin';
import { createSupabaseServerClient, requireOrganizationContext } from '../../../src/lib/supabase/server';

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

async function sendAgentReactivationEmail(email: string, organizationId: string) {
  const completionUrl = new URL('/auth/complete', getAppOrigin());
  completionUrl.searchParams.set('flow', 'reactivation');
  completionUrl.searchParams.set('organization_id', organizationId);
  completionUrl.searchParams.set('next', '/dashboard');

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: completionUrl.toString() },
  });
  if (error) throw new Error(`Reactivation email failed: ${error.message}`);
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
    if (existingMembership?.role === 'inactive') {
      await sendAgentReactivationEmail(normalizedEmail, organizationId);
      return { email: normalizedEmail, status: 'reactivation-email-sent' as const };
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

    return { email: normalizedEmail, status: 'added' as const };
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

export async function requestOrganizationAgentReactivation(userId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error('Select a valid organization member.');
  }

  const { organizationId, user } = await requireOrganizationContext({ adminOnly: true });
  if (user.id === userId) throw new Error('You cannot remove your own account.');

  const admin = createSupabaseAdminClient();
  const { data: membership, error: membershipError } = await admin
    .from('organization_memberships')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle();
  if (membershipError) throw new Error(`Agent lookup failed: ${membershipError.message}`);
  if (membership?.role !== 'inactive') throw new Error('Only inactive agents can be reactivated.');

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('email')
    .eq('user_id', userId)
    .single();
  if (profileError) throw new Error(`Agent email lookup failed: ${profileError.message}`);
  const email = String(profile.email ?? '').trim().toLowerCase();
  if (!email) throw new Error('This agent has no email address on file.');

  await sendAgentReactivationEmail(email, organizationId);

  return { email };
}

export async function deactivateOrganizationAgent(userId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error('Select a valid organization member.');
  }

  const { organizationId, user } = await requireOrganizationContext({ adminOnly: true });
  if (user.id === userId) throw new Error('You cannot remove your own account.');

  const admin = createSupabaseAdminClient();
  const { data: updatedMemberships, error: updateError } = await admin
    .from('organization_memberships')
    .update({ role: 'inactive' })
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .eq('role', 'agent')
    .select('user_id');
  if (updateError) throw new Error(`Agent status update failed: ${updateError.message}`);
  if (!updatedMemberships?.length) throw new Error('Only active agents can be deactivated.');
}

export async function completeOrganizationAgentReactivation(organizationId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(organizationId)) {
    throw new Error('The reactivation organization is invalid.');
  }

  const supabase = await createSupabaseServerClient();
  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError || !userResult.user) throw new Error('Verify your reactivation email before continuing.');

  const admin = createSupabaseAdminClient();
  const { data: membership, error: membershipError } = await admin
    .from('organization_memberships')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', userResult.user.id)
    .maybeSingle();
  if (membershipError) throw new Error(`Membership lookup failed: ${membershipError.message}`);
  if (membership?.role !== 'inactive') throw new Error('This account is not inactive in the organization.');

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .update({ default_organization_id: organizationId })
    .eq('user_id', userResult.user.id)
    .select('user_id')
    .maybeSingle();
  if (profileError) throw new Error(`Organization access could not be updated: ${profileError.message}`);
  if (!profile) throw new Error('The account profile could not be found.');

  const { data: updatedMemberships, error: updateError } = await admin
    .from('organization_memberships')
    .update({ role: 'agent' })
    .eq('organization_id', organizationId)
    .eq('user_id', userResult.user.id)
    .eq('role', 'inactive')
    .select('user_id');
  if (updateError) throw new Error(`Agent reactivation failed: ${updateError.message}`);
  if (!updatedMemberships?.length) throw new Error('This account is not inactive in the organization.');
}
