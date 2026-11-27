import { type IncomingMessage, type Server, createServer } from 'node:http';
import { createServer as createTcpServer, type Socket } from 'node:net';
import { resendSender, sesSender, smtpSender } from './email-senders.js';

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

/** A minimal SMTP server (plain text, AUTH PLAIN/LOGIN) that records the sign-in and the message. */
async function pretendSmtp(port: number, acceptPassword: string) {
  const seen: { auth?: string; from?: string; to?: string[]; data?: string } = { to: [] };
  const server = createTcpServer((sock: Socket) => {
    let buf = '';
    let inData = false;
    let loginStep = 0;
    let loginUser = '';
    const say = (l: string) => sock.write(`${l}\r\n`);
    say('220 pretend ESMTP');
    sock.on('data', (chunk) => {
      buf += chunk.toString();
      let i: number;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') { inData = false; say('250 queued'); } else seen.data = `${seen.data ?? ''}${line}\n`;
          continue;
        }
        if (loginStep === 1) { loginUser = Buffer.from(line, 'base64').toString(); loginStep = 2; say('334 UGFzc3dvcmQ6'); continue; }
        if (loginStep === 2) {
          loginStep = 0;
          const pass = Buffer.from(line, 'base64').toString();
          seen.auth = `${loginUser}:${pass}`;
          say(pass === acceptPassword ? '235 ok' : '535 bad credentials');
          continue;
        }
        const cmd = line.toUpperCase();
        if (cmd.startsWith('EHLO')) { sock.write('250-pretend\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n'); }
        else if (cmd.startsWith('AUTH PLAIN')) {
          const [, user, pass] = Buffer.from(line.split(' ')[2] ?? '', 'base64').toString().split('\0');
          seen.auth = `${user}:${pass}`;
          say(pass === acceptPassword ? '235 ok' : '535 bad credentials');
        } else if (cmd.startsWith('AUTH LOGIN')) { loginStep = 1; say('334 VXNlcm5hbWU6'); }
        else if (cmd.startsWith('MAIL FROM')) { seen.from = line.slice(10); say('250 ok'); }
        else if (cmd.startsWith('RCPT TO')) { seen.to!.push(line.slice(8)); say('250 ok'); }
        else if (cmd === 'DATA') { inData = true; say('354 go'); }
        else if (cmd === 'STARTTLS') say('502 STARTTLS not supported');
        else if (cmd === 'QUIT') { say('221 bye'); sock.end(); }
        else say('250 ok');
      }
    });
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  return { seen, close: () => new Promise<void>((r) => server.close(() => r())) };
}

describe('sending through your own mailbox (SMTP)', () => {
  const settings = { host: '127.0.0.1', port: 43941, secure: false, user: 'noreply@cirilinfo.com', password: 'mailbox-pass', allowPlain: true };

  it('signs in as the mailbox and delivers the message with subject, text and HTML', async () => {
    const smtp = await pretendSmtp(43941, 'mailbox-pass');
    try {
      await smtpSender(settings).send({ ...email, replyTo: 'support@cirilinfo.com' });
      expect(smtp.seen.auth).toBe('noreply@cirilinfo.com:mailbox-pass');
      expect(smtp.seen.from).toContain('no-reply@cirilinfo.com');
      expect(smtp.seen.to).toEqual(['<asha@example.test>']);
      expect(smtp.seen.data).toContain('Subject: Your invoice');
      expect(smtp.seen.data).toMatch(/^Reply-To: support@cirilinfo.com$/im);
      expect(smtp.seen.data).toMatch(/^X-CirilInfo-Event: evt-123$/im); // header names are case-insensitive
      expect(smtp.seen.data).toMatch(/text\/plain[\s\S]*Hello[\s\S]*text\/html/);
    } finally {
      await smtp.close();
    }
  });

  it('throws on a wrong password, so the worker tries again and staff can see why', async () => {
    const smtp = await pretendSmtp(43942, 'right');
    try {
      await expect(smtpSender({ ...settings, port: 43942, password: 'wrong' }).send(email)).rejects.toThrow(/535|auth/i);
    } finally {
      await smtp.close();
    }
  });

  it('refuses to send unencrypted to a real server: STARTTLS is required unless TLS is used from the start', async () => {
    const smtp = await pretendSmtp(43943, 'mailbox-pass'); // offers no STARTTLS
    try {
      await expect(smtpSender({ ...settings, port: 43943, allowPlain: false }).send(email)).rejects.toThrow(/STARTTLS|TLS/i);
      expect(smtp.seen.auth).toBeUndefined(); // the password was never sent
    } finally {
      await smtp.close();
    }
  });
});
