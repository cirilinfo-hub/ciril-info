import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { MockRegistrarProvider } from './providers/mock-registrar.provider.js';
import type { RegistrarProvider } from './providers/registrar-provider.js';

/** Picks the registrar from REGISTRAR_PROVIDER. Only "mock" exists; a real registrar adapter is added when one is chosen. */
@Injectable()
export class RegistrarGateway {
  readonly provider: RegistrarProvider;

  constructor(config: ConfigService<Env, true>) {
    const which = config.get('REGISTRAR_PROVIDER', { infer: true });
    if (which === 'mock') this.provider = new MockRegistrarProvider();
    else throw new Error(`Registrar "${which}" is not available yet. Use "mock" (test mode) until a registrar adapter is built.`);
  }
}
