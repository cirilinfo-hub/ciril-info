import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { MockRegistrarProvider } from './providers/mock-registrar.provider.js';
import { RdapRegistrarProvider } from './providers/rdap-registrar.provider.js';
import type { RegistrarProvider } from './providers/registrar-provider.js';
import { RESELLERCLUB_LIVE, RESELLERCLUB_TEST, ResellerClubRegistrarProvider } from './providers/resellerclub-registrar.provider.js';

/** REGISTRAR_NAMESERVERS as a clean list. */
export const registrarNameservers = (config: ConfigService<Env, true>) =>
  config.get('REGISTRAR_NAMESERVERS', { infer: true }).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/**
 * Picks the registrar from REGISTRAR_PROVIDER: "mock" (test mode), "rdap" (ask the registry itself whether a name is taken;
 * registration, renewal and transfer stay manual) or "resellerclub" (searches and paid orders go through ResellerClub;
 * searches it cannot answer are asked of the registry instead).
 */
@Injectable()
export class RegistrarGateway {
  readonly provider: RegistrarProvider;

  constructor(config: ConfigService<Env, true>) {
    const which = config.get('REGISTRAR_PROVIDER', { infer: true });
    if (which === 'mock') this.provider = new MockRegistrarProvider();
    else if (which === 'rdap') this.provider = new RdapRegistrarProvider();
    else if (which === 'resellerclub') {
      const custom = config.get('RESELLERCLUB_API_BASE', { infer: true });
      this.provider = new ResellerClubRegistrarProvider({
        resellerId: config.get('RESELLERCLUB_RESELLER_ID', { infer: true }),
        apiKey: config.get('RESELLERCLUB_API_KEY', { infer: true }),
        customerId: config.get('RESELLERCLUB_CUSTOMER_ID', { infer: true }),
        baseUrl: custom || (config.get('RESELLERCLUB_ENV', { infer: true }) === 'live' ? RESELLERCLUB_LIVE : RESELLERCLUB_TEST),
        nameservers: registrarNameservers(config),
        maxYearlyCost: config.get('REGISTRAR_MAX_YEARLY_COST', { infer: true }),
        // A pretend server in tests has no registry behind it, so there is nothing to fall back to.
        fallback: custom ? undefined : new RdapRegistrarProvider(),
      });
    } else throw new Error(`Registrar "${which}" is not available. Use "resellerclub", "rdap" (check names against the registry) or "mock" (test mode).`);
  }
}
