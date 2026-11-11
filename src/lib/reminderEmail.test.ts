import { beforeEach, describe, expect, it, vi } from 'vitest';

const { closeMock, createTransportMock, sendMailMock } = vi.hoisted(() => ({
  closeMock: vi.fn(),
  createTransportMock: vi.fn(),
  sendMailMock: vi.fn(),
}));

vi.mock('nodemailer', () => ({
  createTransport: createTransportMock,
}));

import { createReminderEmailSender } from './reminderEmail';

describe('reminder email sender', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTransportMock.mockReturnValue({ close: closeMock, sendMail: sendMailMock });
    process.env.REMINDER_SMTP_HOST = 'smtp.example.test';
    process.env.REMINDER_SMTP_PORT = '465';
    process.env.REMINDER_SMTP_USER = 'sender@example.test';
    process.env.REMINDER_SMTP_PASSWORD = 'test-password';
    process.env.REMINDER_EMAIL_FROM = 'CRM Migration <sender@example.test>';
    process.env.NEXT_PUBLIC_APP_URL = 'https://crm.example.test';
  });

  it('sends an individual email with a dashboard audit link', async () => {
    const sender = createReminderEmailSender();
    await sender.send({
      to: 'agent@example.test',
      subject: 'Passport expires in 30 days',
      message: "Alex Example's passport expires on 2026-12-11.",
    });
    sender.close();

    expect(createTransportMock).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.example.test',
      port: 465,
      secure: true,
      auth: { user: 'sender@example.test', pass: 'test-password' },
    }));
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({
      from: 'CRM Migration <sender@example.test>',
      to: 'agent@example.test',
      subject: 'Passport expires in 30 days - CRM Migration',
      text: expect.stringContaining('https://crm.example.test/dashboard#data-governance'),
    }));
    expect(closeMock).toHaveBeenCalledOnce();
  });

  it('rejects incomplete SMTP configuration', () => {
    delete process.env.REMINDER_SMTP_PASSWORD;
    expect(() => createReminderEmailSender()).toThrow('Reminder email SMTP settings are incomplete.');
  });
});