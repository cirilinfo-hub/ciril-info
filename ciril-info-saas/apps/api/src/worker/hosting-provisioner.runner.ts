import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { HostingJobsService } from '../modules/hosting/hosting-jobs.service.js';

const EVERY_MS = 5_000;

/** Works through due provisioning jobs every few seconds. Overlapping runs are skipped; several workers are safe. */
@Injectable()
export class HostingProvisionerRunner implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('HostingProvisioner');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly jobs: HostingJobsService) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.tick(), EVERY_MS);
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.jobs.runDue();
    } catch (e) {
      this.log.error(`run failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
