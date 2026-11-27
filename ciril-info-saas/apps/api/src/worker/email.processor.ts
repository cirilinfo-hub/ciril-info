import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import type { Env } from '../config/env.js';
import { type EmailSender, mailpitSender, resendSender, sesSender, smtpSender } from '../modules/mail/email-senders.js';
import { renderEmail } from '../modules/mail/templates.js';
import { EMAIL_SEND_EVENT, type EmailMessage } from '../modules/mail/mail.types.js';
import { DomainEventsHandler } from '../modules/domains/domain-events.handler.js';
import { HostingEventsHandler } from '../modules/hosting/hosting-events.handler.js';
import { EVENTS_QUEUE } from './outbox-relay.service.js';

interface EventJob {
  eventId: string;
  payload: unknown;
}

/**
 * Delivers queued emails. Providers: mailpit (local SMTP catcher), resend (HTTPS API) and Amazon SES (API v2).
 * BullMQ retries failed sends with exponential backoff (see outbox relay job options).
 */
@Processor(EVENTS_QUEUE)
export class EventsProcessor extends WorkerHost {
  private readonly log = new Logger('Email');
  private readonly from: string;
  private readonly sender: EmailSender | null;

  constructor(
    config: ConfigService<Env, true>,
    private readonly hosting: HostingEventsHandler,
    private readonly domains: DomainEventsHandler,
  ) {
    super();
    this.from = config.get('EMAIL_FROM', { infer: true });
    const provider = config.get('EMAIL_PROVIDER', { infer: true });
    const resendKey = config.get('RESEND_API_KEY', { infer: true });
    this.sender =
      provider === 'mailpit' ? mailpitSender(config.get('SMTP_HOST', { infer: true }), config.get('SMTP_PORT', { infer: true }))
      : provider === 'ses' ? sesSender({
          region: config.get('AWS_SES_REGION', { infer: true }), accessKeyId: config.get('AWS_SES_ACCESS_KEY_ID', { infer: true }), secretAccessKey: config.get('AWS_SES_SECRET_ACCESS_KEY', { infer: true }),
          configurationSet: config.get('AWS_SES_CONFIGURATION_SET', { infer: true }) || undefined, endpoint: config.get('AWS_SES_ENDPOINT', { infer: true }) || undefined,
        })
      : provider === 'smtp' ? smtpSender({
          host: config.get('SMTP_HOST', { infer: true }), port: config.get('SMTP_PORT', { infer: true }), secure: config.get('SMTP_SECURE', { infer: true }),
          user: config.get('SMTP_USER', { infer: true }), password: config.get('SMTP_PASSWORD', { infer: true }),
        })
      : resendKey ? resendSender(resendKey) : null;
  }

  async process(job: Job<EventJob>): Promise<void> {
    // Billing events that concern hosting become provisioning jobs. Anything else is not ours to act on.
    if (job.name.startsWith('subscription.')) {
      await this.hosting.handle(job.name, job.data.payload);
      return;
    }
    if (job.name.startsWith('domain.')) {
      // On the last try a temporary registrar failure goes to staff instead of failing silently.
      await this.domains.handle(job.name, job.data.payload, { final: job.attemptsMade + 1 >= (job.opts.attempts ?? 1) });
      return;
    }
    if (job.name !== EMAIL_SEND_EVENT) return;
    const msg = job.data.payload as EmailMessage;
    const rendered = renderEmail(msg);

    if (!this.sender) throw new Error('RESEND_API_KEY is not configured');
    await this.sender.send({ from: this.from, to: msg.to, subject: rendered.subject, text: rendered.text, html: rendered.html, idempotencyKey: job.data.eventId });
    this.log.log({ template: msg.template, eventId: job.data.eventId, provider: this.sender.name }, 'Email sent');
  }
}
