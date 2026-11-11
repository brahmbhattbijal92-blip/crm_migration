import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendContactEmailMock } = vi.hoisted(() => ({ sendContactEmailMock: vi.fn() }));

vi.mock('../../../src/lib/contactEmail', () => ({
  sendContactEmail: sendContactEmailMock,
}));

import { POST } from './route';

function makeRequest(body: Record<string, unknown>, ip = '192.0.2.10', origin = 'https://crm.example.test') {
  return new Request('https://crm.example.test/api/contact', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      'x-real-ip': ip,
    },
    body: JSON.stringify(body),
  });
}

const validPayload = {
  name: 'Taylor Example',
  email: 'taylor@example.test',
  subject: 'A question',
  message: 'Please help me.',
};

describe('contact route', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends a valid message', async () => {
    const response = await POST(makeRequest(validPayload));

    expect(response.status).toBe(200);
    expect(sendContactEmailMock).toHaveBeenCalledWith(validPayload);
  });

  it('rejects a request from a different origin', async () => {
    const response = await POST(makeRequest(validPayload, '192.0.2.11', 'https://other.example.test'));

    expect(response.status).toBe(403);
    expect(sendContactEmailMock).not.toHaveBeenCalled();
  });

  it('silently ignores the honeypot field', async () => {
    const response = await POST(makeRequest({ ...validPayload, website: 'spam.example' }, '192.0.2.12'));

    expect(response.status).toBe(200);
    expect(sendContactEmailMock).not.toHaveBeenCalled();
  });

  it('limits repeated messages from the same address', async () => {
    const firstResponse = await POST(makeRequest(validPayload, '192.0.2.13'));
    const secondResponse = await POST(makeRequest(validPayload, '192.0.2.13'));

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(429);
    expect(sendContactEmailMock).toHaveBeenCalledOnce();
  });
});