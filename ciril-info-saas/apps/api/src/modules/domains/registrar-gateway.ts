import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { GODADDY_OTE, GODADDY_PRODUCTION, GoDaddyRegistrarProvider } from './providers/godaddy-registrar.provider.js';
import { MockRegistrarProvider } from './providers/mock-registrar.provider.js';
import { RdapRegistrarProvider } from './providers/rdap-registrar.provider.js';
import type { RegistrarProvider } from './providers/registrar-provider.js';

/**
 * Picks the registrar from REGISTRAR_PROVIDER: "mock" (test mode), "rdap" (ask the registry itself whether a name is taken;
 * registration, renewal and transfer stay manual) or "godaddy" (searches and paid orders go through GoDaddy; searches GoDaddy
 * will not answer are asked of the registry instead).
 */
@Injectable()
export class RegistrarGateway {
  readonly provider: RegistrarProvider;

  constructor(config: ConfigService<Env, true>) {
    const which = config.get('REGISTRAR_PROVIDER', { infer: true });
    if (which === 'mock') this.provider = new MockRegistrarProvider();
    else if (which === 'rdap') this.provider = new RdapRegistrarProvider();
    else if (which === 'godaddy') {
      const custom = config.get('GODADDY_API_BASE', { infer: true });
      this.provider = new GoDaddyRegistrarProvider({
        apiKey: config.get('GODADDY_API_KEY', { infer: true }),
        apiSecret: config.get('GODADDY_API_SECRET', { infer: true }),
        baseUrl: custom || (config.get('GODADDY_ENV', { infer: true }) === 'production' ? GODADDY_PRODUCTION : GODADDY_OTE),
        nameservers: config.get('GODADDY_NAMESERVERS', { infer: true }).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
        maxYearlyCost: config.get('GODADDY_MAX_YEARLY_COST', { infer: true }),
        // A pretend server in tests has no registry behind it, so there is nothing to fall back to.
        fallback: custom ? undefined : new RdapRegistrarProvider(),
      });
    } else throw new Error(`Registrar "${which}" is not available. Use "godaddy", "rdap" (check names against the registry) or "mock" (test mode).`);
  }
}
