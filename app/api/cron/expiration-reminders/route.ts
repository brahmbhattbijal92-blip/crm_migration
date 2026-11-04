import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';

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
}

interface ReminderCandidate {
  client: ExpiringClient;
  documentType: DocumentType;
  expiresOn: string;
  noticeDays: ReminderDays;
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
    .select('id, organization_id, first_name, last_name, visa_subclass, passport_expires_at, visa_expires_at')
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

async function getAgentRecipients(
  supabase: ReturnType<typeof getServiceClient>,
  organizationId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from('organization_memberships')
    .select('user_id')
    .eq('organization_id', organizationId)
    .in('role', ['owner', 'admin', 'agent']);

  if (error) throw new Error(`Agent recipient lookup failed: ${error.message}`);
  return [...new Set((data ?? []).map((membership) => String(membership.user_id)))];
}

async function dispatchSimulatedNotifications(
  supabase: ReturnType<typeof getServiceClient>,
  candidates: ReminderCandidate[],
  deliveredAt: string
): Promise<{ inserted: number; skippedWithoutRecipients: number }> {
  const recipientsByOrganization = new Map<string, string[]>();
  const notificationRows: Array<Record<string, string | number>> = [];
  let skippedWithoutRecipients = 0;

  for (const candidate of candidates) {
    const organizationId = candidate.client.organization_id;
    let recipients = recipientsByOrganization.get(organizationId);
    if (!recipients) {
      recipients = await getAgentRecipients(supabase, organizationId);
      recipientsByOrganization.set(organizationId, recipients);
    }

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

    for (const recipientUserId of recipients) {
      notificationRows.push({
        organization_id: organizationId,
        client_id: candidate.client.id,
        recipient_user_id: recipientUserId,
        document_type: candidate.documentType,
        expires_on: candidate.expiresOn,
        notice_days: candidate.noticeDays,
        title,
        message,
        delivery_status: 'simulated',
        delivered_at: deliveredAt,
      });
    }
  }

  if (notificationRows.length === 0) return { inserted: 0, skippedWithoutRecipients };

  const { data, error } = await supabase
    .from('governance_notifications')
    .upsert(notificationRows, {
      onConflict: 'organization_id,client_id,recipient_user_id,document_type,expires_on,notice_days',
      ignoreDuplicates: true,
    })
    .select('id');

  if (error) throw new Error(`Notification dispatch simulation failed: ${error.message}`);
  return { inserted: data?.length ?? 0, skippedWithoutRecipients };
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
    const deliveredAt = now.toISOString();
    const candidates: ReminderCandidate[] = [];

    for (const noticeDays of REMINDER_DAYS) {
      const expiresOn = utcDateOffset(noticeDays, now);
      const [passportCandidates, visaCandidates] = await Promise.all([
        loadCandidates(supabase, noticeDays, expiresOn, 'passport'),
        loadCandidates(supabase, noticeDays, expiresOn, 'visa'),
      ]);
      candidates.push(...passportCandidates, ...visaCandidates);
    }

    const dispatch = await dispatchSimulatedNotifications(supabase, candidates, deliveredAt);
    return Response.json({
      runDate: today,
      reminderDays: REMINDER_DAYS,
      matchingExpirations: candidates.length,
      simulatedNotificationsInserted: dispatch.inserted,
      candidatesSkippedWithoutAgentRecipients: dispatch.skippedWithoutRecipients,
    });
  } catch (error) {
    console.error('[expiration-reminders] Worker run failed.', error);
    return Response.json({ error: 'Expiration reminder worker failed.' }, { status: 500 });
  }
}
