'use server';

import { createSupabaseAdminClient } from '../../../src/lib/supabase/admin';
import { createSupabaseServerClient, requireOrganizationContext } from '../../../src/lib/supabase/server';

export async function getCurrentOrganizationRole() {
  const { role } = await requireOrganizationContext();
  return role;
}

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
  const { organizationId } = await requireOrganizationContext({ ownerOnly: true });
  const admin = createSupabaseAdminClient();
  const { data: memberships, error: membershipError } = await admin
    .from('organization_memberships')
    .select('user_id, role, created_at, removed_at, removed_role')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: true });
  if (membershipError) throw new Error(`Team list failed: ${membershipError.message}`);

  const userIds = (memberships ?? []).map((membership) => String(membership.user_id));
  let profiles: Array<{ user_id: string; display_name: string; email: string }> = [];
  if (userIds.length > 0) {
    const { data, error: profileError } = await admin
      .from('profiles')
      .select('user_id, display_name, email')
      .in('user_id', userIds);
    if (profileError) throw new Error(`Team profiles failed: ${profileError.message}`);
    profiles = (data ?? []) as typeof profiles;
  }

  const { data: removals, error: removalsError } = await admin
    .from('organization_agent_removals')
    .select('id, original_user_id, email, display_name, original_role, membership_created_at, removed_at')
    .eq('organization_id', organizationId)
    .is('restored_at', null)
    .is('reinvited_at', null)
    .order('removed_at', { ascending: false });
  if (removalsError) throw new Error(`Removed agents failed to load: ${removalsError.message}`);

  const profilesByUser = new Map((profiles ?? []).map((profile) => [String(profile.user_id), profile]));
  const removalsByUser = new Map((removals ?? []).map((removal) => [String(removal.original_user_id), removal]));
  const membershipUserIds = new Set(userIds);
  const currentMembers = (memberships ?? []).map((membership) => {
    const profile = profilesByUser.get(String(membership.user_id));
    const removedAt = membership.removed_at ? String(membership.removed_at) : null;
    const recovery = removalsByUser.get(String(membership.user_id));
    return {
      userId: String(membership.user_id),
      role: removedAt ? 'removed' : String(membership.role),
      displayName: String(profile?.display_name ?? ''),
      email: String(profile?.email ?? ''),
      createdAt: String(membership.created_at),
      removedAt,
      recoveryId: recovery ? String(recovery.id) : null,
    };
  });
  const missingAccountRemovals = (removals ?? [])
    .filter((removal) => !membershipUserIds.has(String(removal.original_user_id)))
    .map((removal) => ({
      userId: String(removal.original_user_id),
      role: 'removed',
      displayName: String(removal.display_name ?? ''),
      email: String(removal.email),
      createdAt: String(removal.membership_created_at),
      removedAt: String(removal.removed_at),
      recoveryId: String(removal.id),
    }));

  return [...currentMembers, ...missingAccountRemovals];
}

export async function inviteOrganizationAgent(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error('Enter a valid work email address.');
  }

  const { organizationId, user } = await requireOrganizationContext({ ownerOnly: true });
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
      .select('role, removed_at')
      .eq('organization_id', organizationId)
      .eq('user_id', existingUserId)
      .maybeSingle();
    if (membershipLookupError) throw new Error(`Existing membership lookup failed: ${membershipLookupError.message}`);
    if (existingMembership?.removed_at) {
      const { data: removal, error: removalError } = await admin
        .from('organization_agent_removals')
        .select('id, removed_at')
        .eq('organization_id', organizationId)
        .eq('original_user_id', existingUserId)
        .is('restored_at', null)
        .is('reinvited_at', null)
        .order('removed_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (removalError) throw new Error(`Agent recovery lookup failed: ${removalError.message}`);
      if (!removal || Date.now() <= Date.parse(String(removal.removed_at)) + 30 * 24 * 60 * 60 * 1000) {
        return { email: normalizedEmail, status: 'removed-member' as const };
      }

      const { error: expiryError } = await admin
        .from('organization_memberships')
        .update({ role: 'inactive', removed_at: null, removed_by: null, removed_role: null })
        .eq('organization_id', organizationId)
        .eq('user_id', existingUserId)
        .eq('removed_at', existingMembership.removed_at);
      if (expiryError) throw new Error(`Expired removal could not be converted to a new invitation: ${expiryError.message}`);

      await sendAgentReactivationEmail(normalizedEmail, organizationId);
      const { error: reinvitedError } = await admin
        .from('organization_agent_removals')
        .update({ reinvited_at: new Date().toISOString(), replacement_user_id: existingUserId })
        .eq('id', removal.id);
      if (reinvitedError) throw new Error(`Reactivation email was sent, but recovery status could not be saved: ${reinvitedError.message}`);
      return { email: normalizedEmail, status: 'reactivation-email-sent' as const };
    }

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

  const { organizationId, user } = await requireOrganizationContext({ ownerOnly: true });
  if (user.id === userId) throw new Error('You cannot remove your own account.');

  const admin = createSupabaseAdminClient();
  const { data: membership, error: membershipError } = await admin
    .from('organization_memberships')
    .select('role, removed_at')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle();
  if (membershipError) throw new Error(`Agent lookup failed: ${membershipError.message}`);
  if (membership?.role !== 'inactive' || membership.removed_at) {
    throw new Error('Only active-organization inactive agents can be reactivated. Restore this removed agent first.');
  }

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

  const { organizationId, user } = await requireOrganizationContext({ ownerOnly: true });
  if (user.id === userId) throw new Error('You cannot remove your own account.');

  const admin = createSupabaseAdminClient();
  const { data: updatedMemberships, error: updateError } = await admin
    .from('organization_memberships')
    .update({ role: 'inactive' })
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .eq('role', 'agent')
    .is('removed_at', null)
    .select('user_id');
  if (updateError) throw new Error(`Agent status update failed: ${updateError.message}`);
  if (!updatedMemberships?.length) throw new Error('Only active agents can be deactivated.');
}

export async function removeOrganizationAgent(userId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error('Select a valid organization member.');
  }

  const { organizationId, user } = await requireOrganizationContext({ ownerOnly: true });
  if (user.id === userId) throw new Error('You cannot remove your own account.');

  const admin = createSupabaseAdminClient();
  const { data: membership, error: membershipError } = await admin
    .from('organization_memberships')
    .select('role, created_at, removed_at')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle();
  if (membershipError) throw new Error(`Agent lookup failed: ${membershipError.message}`);
  if (!membership || !['agent', 'inactive'].includes(String(membership.role)) || membership.removed_at) {
    throw new Error('Only active or inactive agents can be removed.');
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('email, display_name')
    .eq('user_id', userId)
    .single();
  if (profileError) throw new Error(`Agent profile lookup failed: ${profileError.message}`);
  const email = String(profile.email ?? '').trim().toLowerCase();
  if (!email) throw new Error('This agent has no email address to recover their account.');

  const removedAt = new Date().toISOString();
  const { data: recovery, error: recoveryError } = await admin
    .from('organization_agent_removals')
    .insert({
      organization_id: organizationId,
      original_user_id: userId,
      email,
      display_name: String(profile.display_name ?? ''),
      original_role: membership.role,
      membership_created_at: membership.created_at,
      removed_at: removedAt,
      removed_by: user.id,
    })
    .select('id')
    .single();
  if (recoveryError) throw new Error(`Agent recovery record could not be created: ${recoveryError.message}`);

  const { data: updatedMemberships, error: updateError } = await admin
    .from('organization_memberships')
    .update({ role: 'inactive', removed_at: removedAt, removed_by: user.id, removed_role: membership.role })
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .eq('role', membership.role)
    .is('removed_at', null)
    .select('user_id');
  if (updateError || !updatedMemberships?.length) {
    await admin.from('organization_agent_removals').delete().eq('id', recovery.id);
    if (updateError) throw new Error(`Agent could not be removed: ${updateError.message}`);
    throw new Error('Agent membership changed before it could be removed. Refresh and try again.');
  }
}

export async function restoreOrganizationAgent(recoveryId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recoveryId)) {
    throw new Error('Select a valid removed agent.');
  }

  const { organizationId } = await requireOrganizationContext({ ownerOnly: true });
  const admin = createSupabaseAdminClient();
  const { data: recovery, error: recoveryError } = await admin
    .from('organization_agent_removals')
    .select('id, original_user_id, email, display_name, original_role, membership_created_at, removed_at')
    .eq('id', recoveryId)
    .eq('organization_id', organizationId)
    .is('restored_at', null)
    .is('reinvited_at', null)
    .maybeSingle();
  if (recoveryError) throw new Error(`Agent recovery lookup failed: ${recoveryError.message}`);
  if (!recovery) throw new Error('This removed-agent recovery record is no longer available.');

  const recoveryDeadline = Date.parse(String(recovery.removed_at)) + 30 * 24 * 60 * 60 * 1000;
  if (Date.now() > recoveryDeadline) {
    throw new Error('The 30-day restore period has expired. Use Invite agent to send a new invitation.');
  }

  const { data: authResult, error: authError } = await admin.auth.admin.getUserById(String(recovery.original_user_id));
  const accountMissing = !authResult.user && (
    authError?.status === 404
    || authError?.code === 'user_not_found'
    || /user.*not found/i.test(authError?.message ?? '')
  );
  if (authError && !accountMissing) throw new Error(`Agent account lookup failed: ${authError.message}`);

  if (!authResult.user) {
    const invitation = await inviteOrganizationAgent(String(recovery.email));
    if (['self', 'privileged-member', 'already-active', 'removed-member'].includes(invitation.status)) {
      throw new Error('This email already has organization access. Review the team list before re-inviting.');
    }

    const { data: replacementProfile, error: replacementError } = await admin
      .from('profiles')
      .select('user_id')
      .eq('email', String(recovery.email))
      .maybeSingle();
    if (replacementError) throw new Error(`Replacement account lookup failed: ${replacementError.message}`);

    const { error: reinvitedError } = await admin
      .from('organization_agent_removals')
      .update({ reinvited_at: new Date().toISOString(), replacement_user_id: replacementProfile?.user_id ?? null })
      .eq('id', recovery.id);
    if (reinvitedError) throw new Error(`Replacement invitation was sent, but recovery status could not be saved: ${reinvitedError.message}`);
    return { email: String(recovery.email), status: 'reinvited' as const };
  }

  const originalRole = String(recovery.original_role);
  const { data: existingMembership, error: existingMembershipError } = await admin
    .from('organization_memberships')
    .select('role, removed_at')
    .eq('organization_id', organizationId)
    .eq('user_id', String(recovery.original_user_id))
    .maybeSingle();
  if (existingMembershipError) throw new Error(`Membership lookup failed: ${existingMembershipError.message}`);
  if (existingMembership && !existingMembership.removed_at) {
    throw new Error('This account already has an active organization membership. Refresh the team list.');
  }

  const { data: profile, error: profileLookupError } = await admin
    .from('profiles')
    .select('user_id')
    .eq('user_id', String(recovery.original_user_id))
    .maybeSingle();
  if (profileLookupError) throw new Error(`Profile lookup failed: ${profileLookupError.message}`);
  if (profile) {
    const { error } = await admin
      .from('profiles')
      .update({ default_organization_id: organizationId })
      .eq('user_id', String(recovery.original_user_id));
    if (error) throw new Error(`Profile could not be restored: ${error.message}`);
  } else {
    const { error } = await admin.from('profiles').insert({
      user_id: String(recovery.original_user_id),
      default_organization_id: organizationId,
      display_name: String(recovery.display_name),
      email: String(recovery.email),
    });
    if (error) throw new Error(`Profile could not be restored: ${error.message}`);
  }

  const { error: membershipRestoreError } = await admin
    .from('organization_memberships')
    .upsert({
      organization_id: organizationId,
      user_id: String(recovery.original_user_id),
      role: originalRole,
      created_at: recovery.membership_created_at,
      removed_at: null,
      removed_by: null,
      removed_role: null,
    });
  if (membershipRestoreError) throw new Error(`Original membership could not be restored: ${membershipRestoreError.message}`);

  const { error: markRestoredError } = await admin
    .from('organization_agent_removals')
    .update({ restored_at: new Date().toISOString() })
    .eq('id', recovery.id);
  if (markRestoredError) throw new Error(`Agent was restored, but recovery status could not be saved: ${markRestoredError.message}`);
  return { email: String(recovery.email), status: 'restored' as const };
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
    .select('role, removed_at')
    .eq('organization_id', organizationId)
    .eq('user_id', userResult.user.id)
    .maybeSingle();
  if (membershipError) throw new Error(`Membership lookup failed: ${membershipError.message}`);
  if (membership?.role !== 'inactive' || membership.removed_at) {
    throw new Error('This account is not an active-organization inactive member. Restore removed agents separately.');
  }

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
    .is('removed_at', null)
    .select('user_id');
  if (updateError) throw new Error(`Agent reactivation failed: ${updateError.message}`);
  if (!updatedMemberships?.length) throw new Error('This account is not inactive in the organization.');
}
