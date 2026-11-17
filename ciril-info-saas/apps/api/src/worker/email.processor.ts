import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Env } from '../config/env.js';
import { renderEmail } from '../modules/mail/templates.js';
import { EMAIL_SEND_EVENT, type EmailMessage } from '../modules/mail/mail.types.js';
import { EVENTS_QUEUE } from './outbox-relay.service.js';

interface EventJob {
  eventId: string;
  payload: unknown;
}

/**
 * Delivers queued emails. Providers: mailpit (local SMTP catcher), resend (HTTPS API).
 * BullMQ retries failed sends with exponential backoff (see outbox relay job options).
 */
@Processor(EVENTS_QUEUE)
export class EventsProcessor extends WorkerHost {
  private readonly log = new Logger('Email');
  private readonly provider: Env['EMAIL_PROVIDER'];
  private readonly from: string;
  private readonly smtp?: Transporter;
  private readonly resendKey?: string;

  constructor(config: ConfigService<Env, true>) {
    super();
    this.provider = config.get('EMAIL_PROVIDER', { infer: true });
    this.from = config.get('EMAIL_FROM', { infer: true });
    if (this.provider === 'mailpit') {
      this.smtp = nodemailer.createTransport({
        host: config.get('SMTP_HOST', { infer: true }),
        port: config.get('SMTP_PORT', { infer: true }),
        secure: false,
      });
    }
    this.resendKey = process.env['RESEND_API_KEY'] || undefined;
  }

  async process(job: Job<EventJob>): Promise<void> {
    if (job.name !== EMAIL_SEND_EVENT) return; // other event types get processors in later phases
    const msg = job.data.payload as EmailMessage;
    const rendered = renderEmail(msg);

    if (this.provider === 'mailpit') {
      await this.smtp!.sendMail({ from: this.from, to: msg.to, subject: rendered.subject, text: rendered.text, html: rendered.html });
    } else if (this.provider === 'resend') {
      if (!this.resendKey) throw new Error('RESEND_API_KEY is not configured');
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.resendKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': job.data.eventId },
        body: JSON.stringify({ from: this.from, to: [msg.to], subject: rendered.subject, text: rendered.text, html: rendered.html }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Resend responded ${res.status}`);
    } else {
      // AWS SES adapter arrives with the Phase 6 integrations; fail loudly instead of pretending to send.
      throw new Error(`Email provider "${this.provider}" is not implemented yet`);
    }
    this.log.log({ template: msg.template, eventId: job.data.eventId }, 'Email sent');
  }
}
