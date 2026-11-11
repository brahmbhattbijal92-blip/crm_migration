import { beforeEach, describe, expect, it, vi } from 'vitest';

const { closeMock, createTransportMock, sendMailMock } = vi.hoisted(() => ({
  closeMock: vi.fn(),
  createTransportMock: vi.fn(),
  sendMailMock: vi.fn(),
}));

vi.mock('nodemailer', () => ({
  createTransport: createTransportMock,
}));

import { sendContactEmail } from './contactEmail';

describe('contact email sender', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTransportMock.mockReturnValue({ close: closeMock, sendMail: sendMailMock });
    process.env.REMINDER_SMTP_HOST = 'smtp.example.test';
    process.env.REMINDER_SMTP_PORT = '465';
    process.env.REMINDER_SMTP_USER = 'sender@example.test';
    process.env.REMINDER_SMTP_PASSWORD = 'test-password';
    process.env.REMINDER_EMAIL_FROM = 'CRM Migration <sender@example.test>';
  });

  it('sends the message to the configured contact address with reply-to set to the sender', async () => {
    await sendContactEmail({
      name: 'Taylor Example',
      email: 'taylor@example.test',
      subject: 'A question',
      message: 'Please help me.',
    });

    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({
      to: 'hybride.crm.migration@gmail.com',
      replyTo: { name: 'Taylor Example', address: 'taylor@example.test' },
      subject: '[CRM Migration contact] A question',
      text: expect.stringContaining('Please help me.'),
    }));
    expect(closeMock).toHaveBeenCalledOnce();
  });

  it('rejects incomplete SMTP configuration', async () => {
    delete process.env.REMINDER_SMTP_PASSWORD;
    await expect(sendContactEmail({
      name: 'Taylor Example',
      email: 'taylor@example.test',
      subject: 'A question',
      message: 'Please help me.',
    })).rejects.toThrow('Contact email service is not configured.');
  });
});