import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import nodemailer from 'nodemailer';

/** One rendered email, ready to hand to a provider. */
export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Our outbox event id: a provider that supports it uses it to drop a repeated send. */
  idempotencyKey: string;
}

export interface EmailSender {
  readonly name: string;
  send(e: OutgoingEmail): Promise<void>;
}

/** Local development: an SMTP catcher (Mailpit) that shows every email at http://localhost:8025. */
export function mailpitSender(host: string, port: number): EmailSender {
  const smtp = nodemailer.createTransport({ host, port, secure: false });
  return { name: 'mailpit', send: async (e) => void (await smtp.sendMail({ from: e.from, to: e.to, subject: e.subject, text: e.text, html: e.html })) };
}

export interface SmtpSettings {
  host: string;
  port: number;
  /** true: TLS from the start (465). false: STARTTLS on 587, required unless `allowPlain` (tests only). */
  secure: boolean;
  user: string;
  password: string;
  allowPlain?: boolean;
}

/**
 * Your own mailbox's SMTP server (for example noreply@cirilinfo.com at smtp.hostinger.com:465). The connection is always
 * encrypted and the mailbox signs in; mail then carries the domain's own SPF and DKIM. A failure is thrown so the worker
 * tries again later. Mailbox providers cap how much one mailbox may send per hour or day.
 */
export function smtpSender(s: SmtpSettings): EmailSender {
  const smtp = nodemailer.createTransport({
    host: s.host, port: s.port, secure: s.secure, requireTLS: !s.secure && !s.allowPlain, ignoreTLS: Boolean(s.allowPlain),
    auth: { user: s.user, pass: s.password },
    tls: { minVersion: 'TLSv1.2', servername: s.host },
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
  });
  return {
    name: 'smtp',
    async send(e) {
      await smtp.sendMail({ from: e.from, to: e.to, subject: e.subject, text: e.text, html: e.html, headers: { 'X-CirilInfo-Event': e.idempotencyKey } });
    },
  };
}

/** Resend's HTTPS API. Its idempotency key makes a retried send go out once. */
export function resendSender(apiKey: string, base = 'https://api.resend.com'): EmailSender {
  return {
    name: 'resend',
    async send(e) {
      const res = await fetch(`${base}/emails`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': e.idempotencyKey },
        body: JSON.stringify({ from: e.from, to: [e.to], subject: e.subject, text: e.text, html: e.html }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Resend responded ${res.status}`);
    },
  };
}

export interface SesSettings {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Optional SES configuration set, for bounce and complaint tracking set up in the AWS console. */
  configurationSet?: string;
  /** Tests only: a pretend SES. */
  endpoint?: string;
}

/**
 * Amazon SES (API v2). The sending address (or its domain) must be verified in SES, and a new SES account starts in the
 * "sandbox", where it can only send to verified addresses until AWS approves production access. A failure is thrown so
 * the worker tries again later.
 */
export function sesSender(s: SesSettings): EmailSender {
  const client = new SESv2Client({
    region: s.region,
    credentials: { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey },
    ...(s.endpoint ? { endpoint: s.endpoint } : {}),
  });
  return {
    name: 'ses',
    async send(e) {
      await client.send(
        new SendEmailCommand({
          FromEmailAddress: e.from,
          Destination: { ToAddresses: [e.to] },
          Content: { Simple: { Subject: { Data: e.subject, Charset: 'UTF-8' }, Body: { Text: { Data: e.text, Charset: 'UTF-8' }, Html: { Data: e.html, Charset: 'UTF-8' } } } },
          ...(s.configurationSet ? { ConfigurationSetName: s.configurationSet } : {}),
          EmailTags: [{ Name: 'event', Value: e.idempotencyKey.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 255) || 'none' }],
        }),
      );
    },
  };
}
