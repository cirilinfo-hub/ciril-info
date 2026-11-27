import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { TldCostSyncService } from '../modules/domains/tld-cost-sync.service.js';

const FIRST_RUN_MS = 2 * 60_000;
const EVERY_MS = 60 * 60_000;

/**
 * Checks every hour whether the daily domain price sync is due (the service decides, from its last audited run, so a restart
 * does not cause an extra run). Overlapping ticks are skipped.
 */
@Injectable()
export class TldCostSyncRunner implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('TldCostSync');
  private timer?: NodeJS.Timeout;
  private first?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly sync: TldCostSyncService) {}

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
      const r = await this.sync.runIfDue();
      if (r.status === 'done') this.log.log(`checked ${r.checked} ending(s) at ${r.registrar}, ${r.changed.length} changed`);
      else if (r.status === 'failed') this.log.warn(`could not update prices from ${r.registrar}: ${r.reason}`);
    } catch (e) {
      this.log.error(`price sync failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
