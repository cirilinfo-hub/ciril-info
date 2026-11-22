import { type IncomingMessage, type Server, createServer } from 'node:http';
import { resendSender, sesSender } from './email-senders.js';

const email = { from: 'CirilInfo <no-reply@cirilinfo.com>', to: 'asha@example.test', subject: 'Your invoice', text: 'Hello', html: '<p>Hello</p>', idempotencyKey: 'evt-123' };

/** A local HTTP server that records requests and answers with the given status. */
async function pretend(port: number, status = 200, reply: object = {}) {
  const seen: { method: string; path: string; headers: IncomingMessage['headers']; body: any }[] = [];
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString();
    seen.push({ method: req.method!, path: req.url!, headers: req.headers, body: raw ? JSON.parse(raw) : null });
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(reply));
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  return { seen, close: () => new Promise<void>((r) => server.close(() => r())) };
}

describe('sending through Amazon SES', () => {
  it('signs the request with the key and sends subject, text and HTML to the one recipient', async () => {
    const ses = await pretend(43931, 200, { MessageId: 'm-1' });
    try {
      await sesSender({ region: 'ap-south-1', accessKeyId: 'AKIASESTEST', secretAccessKey: 'secret', configurationSet: 'cirilinfo', endpoint: 'http://127.0.0.1:43931' }).send(email);
      const r = ses.seen[0]!;
      expect(r).toMatchObject({ method: 'POST', path: '/v2/email/outbound-emails' });
      expect(String(r.headers.authorization)).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIASESTEST\/\d{8}\/ap-south-1\/ses\/aws4_request/);
      expect(r.body).toMatchObject({
        FromEmailAddress: email.from, Destination: { ToAddresses: ['asha@example.test'] }, ConfigurationSetName: 'cirilinfo',
        Content: { Simple: { Subject: { Data: 'Your invoice' }, Body: { Text: { Data: 'Hello' }, Html: { Data: '<p>Hello</p>' } } } },
      });
    } finally {
      await ses.close();
    }
  });

  it('throws when SES refuses, so the worker tries again later', async () => {
    const ses = await pretend(43932, 400, { message: 'Email address is not verified.' });
    try {
      await expect(sesSender({ region: 'ap-south-1', accessKeyId: 'AKIASESTEST', secretAccessKey: 'secret', endpoint: 'http://127.0.0.1:43932' }).send(email)).rejects.toThrow();
    } finally {
      await ses.close();
    }
  });
});

describe('sending through Resend', () => {
  it('sends the key, an idempotency key and the message, and throws on a refusal', async () => {
    const ok = await pretend(43933, 200, { id: 'r-1' });
    try {
      await resendSender('re_test', 'http://127.0.0.1:43933').send(email);
      expect(ok.seen[0]).toMatchObject({ method: 'POST', path: '/emails', body: { to: ['asha@example.test'], subject: 'Your invoice' } });
      expect(ok.seen[0]!.headers).toMatchObject({ authorization: 'Bearer re_test', 'idempotency-key': 'evt-123' });
    } finally {
      await ok.close();
    }
    const bad = await pretend(43934, 422);
    try {
      await expect(resendSender('re_test', 'http://127.0.0.1:43934').send(email)).rejects.toThrow(/422/);
    } finally {
      await bad.close();
    }
  });
});
