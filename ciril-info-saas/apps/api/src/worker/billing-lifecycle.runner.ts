import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { BillingLifecycleService } from '../modules/billing/billing-lifecycle.service.js';

const FIRST_RUN_MS = 15_000;
const EVERY_MS = 10 * 60_000;

/** Runs the billing lifecycle on a schedule. Overlapping runs are skipped; the service itself is safe across workers. */
@Injectable()
export class BillingLifecycleRunner implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('BillingLifecycle');
  private timer?: NodeJS.Timeout;
  private first?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly lifecycle: BillingLifecycleService) {}

  onApplicationBootstrap() {
    this.first = setTimeout(() => void this.tick(), FIRST_RUN_MS);
    this.timer = setInterval(() => void this.tick(), EVERY_MS);
  }

  onApplicationShutdown() {
    clearTimeout(this.first);
    clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.lifecycle.run();
    } catch (e) {
      this.log.error(`run failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
