import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PlatformPrisma } from '../database/prisma-clients.js';

export const EVENTS_QUEUE = 'events';

interface ClaimedEvent {
  id: string;
  type: string;
  tenant_id: string | null;
  aggregate_type: string;
  aggregate_id: string;
  payload: unknown;
  attempts: number;
}

/**
 * Transactional outbox relay. Business code inserts into outbox_events inside
 * the same transaction as its state change; this loop claims pending rows with
 * FOR UPDATE SKIP LOCKED (safe with several workers) and publishes them to
 * BullMQ using the event id as jobId, so a re-publish is de-duplicated.
 */
@Injectable()
export class OutboxRelayService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(OutboxRelayService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopping = false;

  constructor(
    private readonly db: PlatformPrisma,
    @InjectQueue(EVENTS_QUEUE) private readonly queue: Queue,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.tick(), 1_000);
  }

  async onApplicationShutdown() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
  }

  async tick(batchSize = 50): Promise<number> {
    if (this.running || this.stopping) return 0;
    this.running = true;
    try {
      const events = await this.db.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<ClaimedEvent[]>`
          SELECT id, type, tenant_id, aggregate_type, aggregate_id, payload, attempts
          FROM outbox_events
          WHERE status = 'PENDING' AND available_at <= now()
          ORDER BY created_at
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED`;
        if (rows.length) {
          await tx.outboxEvent.updateMany({
            where: { id: { in: rows.map((r) => r.id) } },
            data: { status: 'PROCESSING', attempts: { increment: 1 } },
          });
        }
        return rows;
      });

      for (const e of events) {
        try {
          await this.queue.add(
            e.type,
            { eventId: e.id, tenantId: e.tenant_id, aggregateType: e.aggregate_type, aggregateId: e.aggregate_id, payload: e.payload },
            { jobId: e.id, attempts: 8, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: 1_000, removeOnFail: 5_000 },
          );
          await this.db.outboxEvent.update({ where: { id: e.id }, data: { status: 'PUBLISHED', publishedAt: new Date(), lastError: null } });
        } catch (err) {
          const attempts = e.attempts + 1;
          const delayMs = Math.min(60_000 * 2 ** Math.min(attempts, 6), 3_600_000);
          await this.db.outboxEvent.update({
            where: { id: e.id },
            data: {
              status: attempts >= 10 ? 'FAILED' : 'PENDING',
              lastError: (err as Error).message.slice(0, 1000),
              availableAt: new Date(Date.now() + delayMs),
            },
          });
          this.log.warn(`Outbox publish failed for ${e.id} (${e.type}), attempt ${attempts}`);
        }
      }
      return events.length;
    } catch (err) {
      this.log.error(`Outbox relay error: ${(err as Error).message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
