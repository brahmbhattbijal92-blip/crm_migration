import { createHash } from 'node:crypto';
import { sendContactEmail } from '../../../src/lib/contactEmail';

export const maxDuration = 15;

const MAX_BODY_LENGTH = 10_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_TRACKED_ADDRESSES = 2_000;
const recentRequests = new Map<string, number>();

interface ContactRequestBody {
  name?: unknown;
  email?: unknown;
  subject?: unknown;
  message?: unknown;
  website?: unknown;
}

function isRecord(value: unknown): value is ContactRequestBody {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= maxLength ? text : null;
}

function isValidEmail(value: string): boolean {
  return value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function reserveAddress(request: Request): boolean {
  const now = Date.now();
  for (const [key, sentAt] of recentRequests) {
    if (now - sentAt >= RATE_LIMIT_WINDOW_MS) recentRequests.delete(key);
  }

  const address = request.headers.get('x-real-ip')?.trim()
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
  const key = createHash('sha256').update(address).digest('hex');
  const lastRequestAt = recentRequests.get(key);
  if (lastRequestAt && now - lastRequestAt < RATE_LIMIT_WINDOW_MS) return false;

  if (recentRequests.size >= MAX_TRACKED_ADDRESSES) {
    const oldestKey = recentRequests.keys().next().value;
    if (oldestKey) recentRequests.delete(oldestKey);
  }
  recentRequests.set(key, now);
  return true;
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      if (new URL(origin).origin !== new URL(request.url).origin) {
        return Response.json({ error: 'This request could not be accepted.' }, { status: 403 });
      }
    } catch {
      return Response.json({ error: 'This request could not be accepted.' }, { status: 403 });
    }
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_LENGTH) {
    return Response.json({ error: 'Your message is too long.' }, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: 'Please check the form and try again.' }, { status: 400 });
  }
  if (!isRecord(payload)) {
    return Response.json({ error: 'Please check the form and try again.' }, { status: 400 });
  }

  if (typeof payload.website === 'string' && payload.website.trim()) {
    return Response.json({ ok: true });
  }

  const name = getText(payload.name, 120);
  const email = getText(payload.email, 320);
  const subject = getText(payload.subject, 160)?.replace(/[\r\n]+/g, ' ');
  const message = getText(payload.message, 4000);
  if (!name || !email || !subject || !message || !isValidEmail(email)) {
    return Response.json({ error: 'Please check your name, email, subject, and message.' }, { status: 400 });
  }
  if (!reserveAddress(request)) {
    return Response.json({ error: 'Please wait a minute before sending another message.' }, { status: 429 });
  }

  try {
    await sendContactEmail({ name, email, subject, message });
    return Response.json({ ok: true });
  } catch {
    console.error('[contact] Message delivery failed.');
    return Response.json({ error: 'We could not send your message right now. Please try again later.' }, { status: 503 });
  }
}