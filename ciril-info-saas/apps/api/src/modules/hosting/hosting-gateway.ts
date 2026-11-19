import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import type { HostingProvider } from './providers/hosting-provider.js';
import { MockHostingProvider } from './providers/mock-hosting.provider.js';

/** Picks the hosting control-panel adapter from HOSTING_PROVIDER. Env validation has already refused any that is not built. */
@Injectable()
export class HostingGateway {
  readonly provider: HostingProvider;

  constructor(config: ConfigService<Env, true>) {
    const which = config.get('HOSTING_PROVIDER', { infer: true });
    if (which !== 'mock') throw new Error(`Hosting provider "${which}" is not available yet. Use "mock" until a panel adapter is built.`);
    this.provider = new MockHostingProvider();
  }

  get isMock() {
    return this.provider.id === 'MOCK';
  }
}
