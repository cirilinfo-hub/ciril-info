import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PlatformPrisma, type Tx } from '../../database/prisma-clients.js';
import { EMAIL_SEND_EVENT, type EmailMessage } from './mail.types.js';

/**
 * Queues emails through the transactional outbox. The worker renders and sends
 * them (src/worker/email.processor.ts), retrying on provider failures.
 * Pass `tx` so the email exists if and only if the business change commits.
 */
@Injectable()
export class MailService {
  constructor(private readonly db: PlatformPrisma) {}

  async enqueue(message: EmailMessage, tx?: Tx, tenantId?: string | null): Promise<void> {
    const client = tx ?? this.db;
    // createMany issues no RETURNING clause: the customer-facing DB role may only
    // INSERT into outbox_events (it cannot read the queue), so create() would fail.
    await client.outboxEvent.createMany({
      data: {
        tenantId: tenantId ?? null,
        type: EMAIL_SEND_EVENT,
        aggregateType: 'email',
        aggregateId: randomUUID(),
        payload: message as unknown as Prisma.InputJsonValue,
      },
    });
  }
}
