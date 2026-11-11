import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';
import { createReminderEmailSender } from '../../../../src/lib/reminderEmail';

export const maxDuration = 60;

const REMINDER_DAYS = [90, 60, 30] as const;
type ReminderDays = (typeof REMINDER_DAYS)[number];
type DocumentType = 'passport' | 'visa';

interface ExpiringClient {
  id: string;
  organization_id: string;
  first_name: string;
  last_name: string;
  visa_subclass: string | null;
  passport_expires_at: string | null;
  visa_expires_at: string | null;
  assigned_agent_id: string | null;
  created_by: string | null;
}

interface ReminderCandidate {
  client: ExpiringClient;
  documentType: DocumentType;
  expiresOn: string;
  noticeDays: ReminderDays;
}

interface OrganizationMember {
  userId: string;
  role: 'owner' | 'admin' | 'agent';
  email: string;
}

interface ReminderNotificationRow {
  id: string;
  organization_id: string;
  client_id: string;
  recipient_user_id: string;
  document_type: DocumentType;
  expires_on: string;
  notice_days: ReminderDays;
  title: string;
  message: string;
}

function utcDateOffset(days: number, from = new Date()): string {
  const date = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isAuthorized(request: Request): boolean {
  const expectedSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get('authorization') ?? '';
  const suppliedSecret = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!expectedSecret || !suppliedSecret) return false;

  const expected = Buffer.from(expectedSecret);
  const supplied = Buffer.from(suppliedSecret);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error('Worker Supabase configuration is missing.');

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function loadCandidates(
  supabase: ReturnType<typeof getServiceClient>,
  noticeDays: ReminderDays,
  expiresOn: string,
  documentType: DocumentType
): Promise<ReminderCandidate[]> {
  const expirationColumn = documentType === 'passport' ? 'passport_expires_at' : 'visa_expires_at';
  const { data, error } = await supabase
    .from('clients')
    .select('id, organization_id, first_name, last_name, visa_subclass, passport_expires_at, visa_expires_at, assigned_agent_id, created_by')
    .eq(expirationColumn, expiresOn)
    .is('deleted_at', null)
    .neq('status', 'archived');

  if (error) throw new Error(`Client expiration scan failed: ${error.message}`);
  return ((data ?? []) as ExpiringClient[]).map((client) => ({
    client,
    documentType,
    expiresOn,
    noticeDays,
  }));
}

async function getOrganizationMembers(
  supabase: ReturnType<typeof getServiceClient>,
  organizationId: string
): Promise<OrganizationMember[]> {
  const { data: memberships, error: membershipError } = await supabase
    .from('organization_memberships')
    .select('user_id, role')
    .eq('organization_id', organizationId)
    .in('role', ['owner', 'admin', 'agent'])
    .is('removed_at', null);

  if (membershipError) throw new Error(`Agent recipient lookup failed: ${membershipError.message}`);
  const userIds = [...new Set((memberships ?? []).map((membership) => String(membership.user_id)))];
  if (userIds.length === 0) return [];

  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('user_id, email')
    .in('user_id', userIds);
  if (profileError) throw new Error(`Agent email lookup failed: ${profileError.message}`);

  const emailByUserId = new Map((profiles ?? []).map((profile) => [String(profile.user_id), String(profile.email ?? '').trim()]));
  return (memberships ?? []).flatMap((membership) => {
    const userId = String(membership.user_id);
    const email = emailByUserId.get(userId) ?? '';
    const role = String(membership.role);
    if (!email || !['owner', 'admin', 'agent'].includes(role)) return [];
    return [{ userId, email, role: role as OrganizationMember['role'] }];
  });
}

function memberCanAccessClient(member: OrganizationMember, client: ExpiringClient): boolean {
  if (member.role === 'owner' || member.role === 'admin') return true;
  if (member.role !== 'agent') return false;
  if (client.assigned_agent_id) return client.assigned_agent_id === member.userId;
  return client.created_by === member.userId;
}

function notificationStillMatchesClient(notification: ReminderNotificationRow, client: ExpiringClient): boolean {
  if (notification.document_type === 'passport') return client.passport_expires_at === notification.expires_on;
  return client.visa_expires_at === notification.expires_on;
}

async function dispatchReminderNotifications(
  supabase: ReturnType<typeof getServiceClient>,
  candidates: ReminderCandidate[],
  now: Date
): Promise<{ inserted: number; emailsSent: number; emailsFailed: number; skippedWithoutRecipients: number }> {
  const membersByOrganization = new Map<string, OrganizationMember[]>();
  const notificationRows: Array<Record<string, string | number | null>> = [];
  let skippedWithoutRecipients = 0;

  for (const candidate of candidates) {
    const organizationId = candidate.client.organization_id;
    let members = membersByOrganization.get(organizationId);
    if (!members) {
      members = await getOrganizationMembers(supabase, organizationId);
      membersByOrganization.set(organizationId, members);
    }
    const recipients = members.filter((member) => memberCanAccessClient(member, candidate.client));

    if (recipients.length === 0) {
      skippedWithoutRecipients += 1;
      continue;
    }

    const documentLabel = candidate.documentType === 'passport'
      ? 'passport'
      : `visa${candidate.client.visa_subclass ? ` subclass ${candidate.client.visa_subclass}` : ''}`;
    const clientName = `${candidate.client.first_name} ${candidate.client.last_name}`.trim();
    const title = `${documentLabel} expires in ${candidate.noticeDays} days`;
    const message = `${clientName}'s ${documentLabel} expires on ${candidate.expiresOn}.`;

    for (const recipient of recipients) {
      notificationRows.push({
        organization_id: organizationId,
        client_id: candidate.client.id,
        recipient_user_id: recipient.userId,
        document_type: candidate.documentType,
        expires_on: candidate.expiresOn,
        notice_days: candidate.noticeDays,
        title,
        message,
        delivery_status: 'queued',
        delivered_at: null,
      });
    }
  }

  let inserted = 0;
  if (notificationRows.length > 0) {
    const { data, error } = await supabase
      .from('governance_notifications')
      .upsert(notificationRows, {
        onConflict: 'organization_id,client_id,recipient_user_id,document_type,expires_on,notice_days',
        ignoreDuplicates: true,
      })
      .select('id');

    if (error) throw new Error(`Notification queue failed: ${error.message}`);
    inserted = data?.length ?? 0;
  }

  const staleSendingBefore = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
  const { error: staleSendingError } = await supabase
    .from('governance_notifications')
    .update({ delivery_status: 'failed' })
    .eq('delivery_status', 'sending')
    .lt('created_at', staleSendingBefore);
  if (staleSendingError) throw new Error(`Stale reminder send cleanup failed: ${staleSendingError.message}`);

  const visibleSince = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { data: pendingRows, error: pendingError } = await supabase
    .from('governance_notifications')
    .select('id, organization_id, client_id, recipient_user_id, document_type, expires_on, notice_days, title, message')
    .eq('delivery_status', 'queued')
    .gte('created_at', visibleSince)
    .order('created_at', { ascending: true });

  if (pendingError) throw new Error(`Pending reminder lookup failed: ${pendingError.message}`);
  const pendingNotifications = (pendingRows ?? []) as ReminderNotificationRow[];
  if (pendingNotifications.length === 0) return { inserted, emailsSent: 0, emailsFailed: 0, skippedWithoutRecipients };

  const clientIds = [...new Set(pendingNotifications.map((row) => row.client_id))];
  const { data: pendingClients, error: clientsError } = await supabase
    .from('clients')
    .select('id, organization_id, first_name, last_name, visa_subclass, passport_expires_at, visa_expires_at, assigned_agent_id, created_by, status, deleted_at')
    .in('id', clientIds);
  if (clientsError) throw new Error(`Pending reminder client lookup failed: ${clientsError.message}`);
  const clientById = new Map((pendingClients ?? []).map((client) => [String(client.id), client as ExpiringClient & { status: string; deleted_at: string | null }]));

  const recipientsByOrganization = new Map<string, OrganizationMember[]>();
  for (const row of pendingNotifications) {
    if (!recipientsByOrganization.has(row.organization_id)) {
      recipientsByOrganization.set(row.organization_id, await getOrganizationMembers(supabase, row.organization_id));
    }
  }

  let sender: ReturnType<typeof createReminderEmailSender> | undefined;
  let emailsSent = 0;
  let emailsFailed = 0;
  try {
    sender = createReminderEmailSender();
  } catch {
    await supabase
      .from('governance_notifications')
      .update({ delivery_status: 'failed' })
      .in('id', pendingNotifications.map((row) => row.id));
    return { inserted, emailsSent, emailsFailed: pendingNotifications.length, skippedWithoutRecipients };
  }

  try {
    for (const notification of pendingNotifications) {
      const { data: claimedNotification, error: claimError } = await supabase
        .from('governance_notifications')
        .update({ delivery_status: 'sending' })
        .eq('id', notification.id)
        .eq('delivery_status', 'queued')
        .select('id')
        .maybeSingle();
      if (claimError) throw new Error(`Reminder send claim failed: ${claimError.message}`);
      if (!claimedNotification) continue;

      const client = clientById.get(notification.client_id);
      const members = recipientsByOrganization.get(notification.organization_id) ?? [];
      const recipient = members.find((member) => member.userId === notification.recipient_user_id);
      const clientIsActive = client && client.status !== 'archived' && !client.deleted_at;
      if (!clientIsActive || !recipient || !memberCanAccessClient(recipient, client) || !notificationStillMatchesClient(notification, client)) {
        const { error } = await supabase
          .from('governance_notifications')
          .update({ delivery_status: 'failed' })
          .eq('id', notification.id);
        if (error) throw new Error(`Reminder status update failed: ${error.message}`);
        emailsFailed += 1;
        continue;
      }

      try {
        await sender.send({ to: recipient.email, subject: notification.title, message: notification.message });
        const { error } = await supabase
          .from('governance_notifications')
          .update({ delivery_status: 'sent', delivered_at: new Date().toISOString() })
          .eq('id', notification.id);
        if (error) throw new Error(`Reminder sent but delivery status could not be saved: ${error.message}`);
        emailsSent += 1;
      } catch (error) {
        const { error: statusError } = await supabase
          .from('governance_notifications')
          .update({ delivery_status: 'failed' })
          .eq('id', notification.id);
        if (statusError) throw new Error(`Reminder email failed and its status could not be saved: ${statusError.message}`);
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown';
        console.error('[expiration-reminders] Email delivery failed.', { notificationId: notification.id, code });
        emailsFailed += 1;
      }
    }
  } finally {
    sender.close();
  }

  return { inserted, emailsSent, emailsFailed, skippedWithoutRecipients };
}

export async function GET(request: Request): Promise<Response> {
  if (!process.env.CRON_SECRET) {
    return Response.json({ error: 'Expiration worker is not configured.' }, { status: 503 });
  }
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const supabase = getServiceClient();
    const now = new Date();
    const today = utcDateOffset(0, now);
    const candidates: ReminderCandidate[] = [];

    for (const noticeDays of REMINDER_DAYS) {
      const expiresOn = utcDateOffset(noticeDays, now);
      const [passportCandidates, visaCandidates] = await Promise.all([
        loadCandidates(supabase, noticeDays, expiresOn, 'passport'),
        loadCandidates(supabase, noticeDays, expiresOn, 'visa'),
      ]);
      candidates.push(...passportCandidates, ...visaCandidates);
    }

    const dispatch = await dispatchReminderNotifications(supabase, candidates, now);
    return Response.json({
      runDate: today,
      reminderDays: REMINDER_DAYS,
      matchingExpirations: candidates.length,
      notificationsInserted: dispatch.inserted,
      emailsSent: dispatch.emailsSent,
      emailsFailed: dispatch.emailsFailed,
      candidatesSkippedWithoutAgentRecipients: dispatch.skippedWithoutRecipients,
    });
  } catch (error) {
    console.error('[expiration-reminders] Worker run failed.', error);
    return Response.json({ error: 'Expiration reminder worker failed.' }, { status: 500 });
  }
}
