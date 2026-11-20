import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { MockRegistrarProvider } from './providers/mock-registrar.provider.js';
import { RdapRegistrarProvider } from './providers/rdap-registrar.provider.js';
import type { RegistrarProvider } from './providers/registrar-provider.js';

/**
 * Picks how names are looked up from REGISTRAR_PROVIDER: "mock" (test mode) or "rdap" (ask the registry itself whether a name is
 * taken; registration, renewal and transfer stay manual). A real registrar adapter is added when a registrar is chosen.
 */
@Injectable()
export class RegistrarGateway {
  readonly provider: RegistrarProvider;

  constructor(config: ConfigService<Env, true>) {
    const which = config.get('REGISTRAR_PROVIDER', { infer: true });
    if (which === 'mock') this.provider = new MockRegistrarProvider();
    else if (which === 'rdap') this.provider = new RdapRegistrarProvider();
    else throw new Error(`Registrar "${which}" is not available yet. Use "rdap" (check names against the registry) or "mock" (test mode).`);
  }
}
