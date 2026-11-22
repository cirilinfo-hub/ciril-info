import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { CpanelHostingProvider } from './providers/cpanel-hosting.provider.js';
import type { HostingProvider } from './providers/hosting-provider.js';
import { ManualHostingProvider } from './providers/manual-hosting.provider.js';
import { MockHostingProvider } from './providers/mock-hosting.provider.js';
import { PleskHostingProvider } from './providers/plesk-hosting.provider.js';

/** Picks how hosting gets made from HOSTING_PROVIDER: "mock" (test mode), "manual" (staff do it by hand), "cpanel" (WHM) or "plesk". */
@Injectable()
export class HostingGateway {
  readonly provider: HostingProvider;

  constructor(config: ConfigService<Env, true>) {
    const which = config.get('HOSTING_PROVIDER', { infer: true });
    if (which === 'mock') this.provider = new MockHostingProvider();
    else if (which === 'manual') this.provider = new ManualHostingProvider();
    else if (which === 'cpanel') {
      this.provider = new CpanelHostingProvider({
        host: config.get('CPANEL_HOST', { infer: true }), port: config.get('CPANEL_PORT', { infer: true }), user: config.get('CPANEL_USER', { infer: true }),
        token: config.get('CPANEL_API_TOKEN', { infer: true }), tls: config.get('CPANEL_TLS', { infer: true }),
      });
    } else if (which === 'plesk') {
      this.provider = new PleskHostingProvider({
        host: config.get('PLESK_HOST', { infer: true }), port: config.get('PLESK_PORT', { infer: true }), apiKey: config.get('PLESK_API_KEY', { infer: true }),
        tls: config.get('PLESK_TLS', { infer: true }), ip: config.get('PLESK_IP', { infer: true }),
      });
    } else throw new Error(`Hosting provider "${which}" is not available yet. Use "cpanel", "plesk", "manual" (staff do it by hand) or "mock" (test mode).`);
  }

  get isMock() {
    return this.provider.id === 'MOCK';
  }
  /** "manual": each task waits for staff. "automatic": the worker calls the panel. */
  get mode() {
    return this.provider.mode;
  }
}
