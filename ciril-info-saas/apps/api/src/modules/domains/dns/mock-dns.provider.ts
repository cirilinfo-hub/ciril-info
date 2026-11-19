import { ProvisioningError } from '../../hosting/providers/hosting-provider.js';
import type { DnsProvider } from './dns-provider.js';
import { type DnsRecordInput, recordId } from './dns-rules.js';

/**
 * Test mode. Keeps zones in memory, so they are lost when the API restarts. Refused in production by env validation.
 * A domain whose name contains "nozone" has no zone, to show that case.
 */
export class MockDnsProvider implements DnsProvider {
  readonly id = 'MOCK' as const;
  private readonly zones = new Map<string, DnsRecordInput[]>();

  private zone(domain: string): DnsRecordInput[] {
    const d = domain.toLowerCase();
    if (d.includes('nozone')) {
      const e = new ProvisioningError('There is no DNS zone for this domain on the panel.', false);
      e.notFound = true;
      throw e;
    }
    let z = this.zones.get(d);
    if (!z) {
      z = [
        { type: 'NS', name: '@', content: 'ns1.mock-dns.test', ttl: 86_400 },
        { type: 'NS', name: '@', content: 'ns2.mock-dns.test', ttl: 86_400 },
      ];
      this.zones.set(d, z);
    }
    return z;
  }

  async list(domain: string) {
    return this.zone(domain).map((r) => ({ ...r }));
  }

  async add(domain: string, record: DnsRecordInput) {
    this.zone(domain).push({ ...record });
  }

  async update(domain: string, current: DnsRecordInput, next: DnsRecordInput) {
    const z = this.zone(domain);
    const i = z.findIndex((r) => recordId(r) === recordId(current));
    if (i === -1) throw this.changed();
    z[i] = { ...next };
  }

  async remove(domain: string, record: DnsRecordInput) {
    const z = this.zone(domain);
    const i = z.findIndex((r) => recordId(r) === recordId(record));
    if (i === -1) throw this.changed();
    z.splice(i, 1);
  }

  private changed() {
    const e = new ProvisioningError('That record is no longer in the zone. It was changed by someone else.', false);
    e.notFound = true;
    return e;
  }
}
