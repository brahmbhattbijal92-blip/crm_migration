import { createTransport } from 'nodemailer';

export interface ContactEmailInput {
  name: string;
  email: string;
  subject: string;
  message: string;
}

export async function sendContactEmail(input: ContactEmailInput): Promise<void> {
  const host = process.env.REMINDER_SMTP_HOST?.trim();
  const port = Number(process.env.REMINDER_SMTP_PORT ?? '465');
  const username = process.env.REMINDER_SMTP_USER?.trim();
  const password = process.env.REMINDER_SMTP_PASSWORD;
  const from = process.env.REMINDER_EMAIL_FROM?.trim() || username;

  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !username || !password || !from) {
    throw new Error('Contact email service is not configured.');
  }

  const transporter = createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user: username, pass: password },
    pool: true,
    maxConnections: 1,
  });

  try {
    await transporter.sendMail({
      from,
      to: 'hybride.crm.migration@gmail.com',
      replyTo: { name: input.name, address: input.email },
      subject: `[CRM Migration contact] ${input.subject}`,
      text: `Name: ${input.name}\nReply email: ${input.email}\n\n${input.message}`,
    });
  } finally {
    transporter.close();
  }
}