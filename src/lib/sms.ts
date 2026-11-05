import 'server-only';

import twilio from 'twilio';

export async function sendVaultVerificationCode(phoneNumber: string, code: string): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();
  const fromNumber = process.env.TWILIO_FROM_NUMBER?.trim();

  if (!accountSid || !authToken || (!messagingServiceSid && !fromNumber)) {
    throw new Error('SMS delivery is not configured.');
  }
  if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber) || !/^\d{6}$/.test(code)) {
    throw new Error('SMS recipient or verification code is invalid.');
  }

  try {
    const client = twilio(accountSid, authToken);
    await client.messages.create({
      to: phoneNumber,
      ...(messagingServiceSid ? { messagingServiceSid } : { from: fromNumber }),
      body: `Your CRM Vault verification code is ${code}. It expires in 5 minutes. Do not share this code.`,
    });
  } catch {
    throw new Error('Unable to deliver the verification SMS. Try again later.');
  }
}