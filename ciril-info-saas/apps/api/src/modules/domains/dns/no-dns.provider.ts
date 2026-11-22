import { ProvisioningError } from '../../hosting/providers/hosting-provider.js';
import type { DnsProvider } from './dns-provider.js';

/**
 * DNS editing is switched off (DNS_PROVIDER=none), for a launch before a DNS server is connected. Every domain then looks like it
 * has no zone here, so the customer is told DNS is not set up yet and asked to contact you, which is true.
 */
export class NoDnsProvider implements DnsProvider {
  readonly id = 'NONE' as const;

  private none(): never {
    const e = new ProvisioningError('DNS editing is not switched on.', false);
    e.notFound = true;
    throw e;
  }

  async list(): Promise<never> {
    return this.none();
  }
  async add(): Promise<never> {
    return this.none();
  }
  async update(): Promise<never> {
    return this.none();
  }
  async remove(): Promise<never> {
    return this.none();
  }
}
