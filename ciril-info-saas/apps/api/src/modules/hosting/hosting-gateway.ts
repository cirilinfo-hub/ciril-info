import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import type { HostingProvider } from './providers/hosting-provider.js';
import { ManualHostingProvider } from './providers/manual-hosting.provider.js';
import { MockHostingProvider } from './providers/mock-hosting.provider.js';

/**
 * Picks how hosting gets made from HOSTING_PROVIDER: "mock" (test mode), "manual" (staff do it by hand), or a real panel
 * adapter. cPanel and Plesk are not built yet and are refused at startup with a clear message.
 */
@Injectable()
export class HostingGateway {
  readonly provider: HostingProvider;

  constructor(config: ConfigService<Env, true>) {
    const which = config.get('HOSTING_PROVIDER', { infer: true });
    if (which === 'mock') this.provider = new MockHostingProvider();
    else if (which === 'manual') this.provider = new ManualHostingProvider();
    else throw new Error(`Hosting provider "${which}" is not available yet. Use "manual" (staff do it by hand) or "mock" (test mode).`);
  }

  get isMock() {
    return this.provider.id === 'MOCK';
  }
  /** "manual": each task waits for staff. "automatic": the worker calls the panel. */
  get mode() {
    return this.provider.mode;
  }
}
