import { createTransport } from 'nodemailer';

export interface ReminderEmailInput {
  to: string;
  subject: string;
  message: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

export function createReminderEmailSender() {
  const host = process.env.REMINDER_SMTP_HOST?.trim();
  const port = Number(process.env.REMINDER_SMTP_PORT ?? '465');
  const username = process.env.REMINDER_SMTP_USER?.trim();
  const password = process.env.REMINDER_SMTP_PASSWORD;
  const from = process.env.REMINDER_EMAIL_FROM?.trim() || username;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !username || !password || !from || !appUrl) {
    throw new Error('Reminder email SMTP settings are incomplete.');
  }

  let dashboardUrl: string;
  try {
    const appOrigin = new URL(appUrl);
    if (process.env.NODE_ENV === 'production' && appOrigin.protocol !== 'https:') {
      throw new Error('Reminder email app URL must use HTTPS in production.');
    }
    dashboardUrl = new URL('/dashboard#data-governance', appOrigin).toString();
  } catch {
    throw new Error('Reminder email app URL is invalid.');
  }

  const transporter = createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user: username, pass: password },
    pool: true,
    maxConnections: 2,
  });

  return {
    async send(input: ReminderEmailInput): Promise<void> {
      const subject = `${input.subject} - CRM Migration`;
      const message = escapeHtml(input.message);
      const link = escapeHtml(dashboardUrl);
      await transporter.sendMail({
        from,
        to: input.to,
        subject,
        text: `${input.message}\n\nView reminder audit: ${dashboardUrl}`,
        html: `<p>${message}</p><p><a href="${link}">View reminder audit</a></p>`,
      });
    },
    close() {
      transporter.close();
    },
  };
}