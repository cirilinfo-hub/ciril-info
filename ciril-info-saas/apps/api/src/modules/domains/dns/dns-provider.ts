import type { DnsRecordInput } from './dns-rules.js';

export type DnsProviderId = 'MOCK' | 'CPANEL' | 'NONE';

/**
 * Where a domain's DNS zone lives. The zone itself is the source of truth: we read it, and change it one record at a time.
 * Names are relative to the domain ("@", "www"), host names carry no trailing dot, and the zone's start-of-authority record
 * is never returned. Errors are ProvisioningErrors; `notFound` means this domain has no zone here.
 */
export interface DnsProvider {
  readonly id: DnsProviderId;
  list(domain: string): Promise<DnsRecordInput[]>;
  add(domain: string, record: DnsRecordInput): Promise<void>;
  /** Replaces `current` with `next`. Fails if `current` is no longer in the zone (someone else changed it). */
  update(domain: string, current: DnsRecordInput, next: DnsRecordInput): Promise<void>;
  remove(domain: string, record: DnsRecordInput): Promise<void>;
}
