import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.js';
import { TenantPrisma } from '../../../database/prisma-clients.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { RequestMeta, TenantContext } from '../../auth/auth.types.js';
import { ProvisioningError } from '../../hosting/providers/hosting-provider.js';
import { CpanelDnsProvider } from './cpanel-dns.provider.js';
import type { DnsProvider } from './dns-provider.js';
import { type DnsRecord, type DnsRecordInput, checkRecord, isReadonly, recordId } from './dns-rules.js';
import { MockDnsProvider } from './mock-dns.provider.js';
import { NoDnsProvider } from './no-dns.provider.js';

const ORDER = ['NS', 'A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'CAA'];

/** Picks where zones live from DNS_PROVIDER: "mock" (in memory, test mode), "cpanel" (WHM), or "none" (customer DNS editing is off). */
@Injectable()
export class DnsGateway {
  readonly provider: DnsProvider;

  constructor(config: ConfigService<Env, true>) {
    const which = config.get('DNS_PROVIDER', { infer: true });
    if (which === 'cpanel') {
      this.provider = new CpanelDnsProvider({
        host: config.get('CPANEL_HOST', { infer: true }), port: config.get('CPANEL_PORT', { infer: true }), user: config.get('CPANEL_USER', { infer: true }),
        token: config.get('CPANEL_API_TOKEN', { infer: true }), tls: config.get('CPANEL_TLS', { infer: true }),
      });
    } else if (which === 'none') {
      this.provider = new NoDnsProvider();
    } else {
      this.provider = new MockDnsProvider();
    }
  }
}

/**
 * Customer-portal DNS: read and change the records of a domain the organisation has registered. The zone on the panel is
 * the source of truth; every change is checked against the rules and against the zone as it is right now, then sent to the panel.
 */
@Injectable()
export class DnsService {
  private readonly log = new Logger(DnsService.name);

  constructor(
    private readonly db: TenantPrisma,
    private readonly gateway: DnsGateway,
  ) {}

  /** The domain, if it is the organisation's and registered. Short transaction: the panel is called after it ends. */
  private async domainOf(ctx: TenantContext, id: string) {
    const d = await this.db.run(ctx, (tx) => tx.domain.findUnique({ where: { id }, select: { id: true, name: true, status: true } }));
    if (!d) throw new NotFoundException({ code: 'DOMAIN_NOT_FOUND', message: 'Domain not found.' });
    if (d.status !== 'ACTIVE') throw new ConflictException({ code: 'DOMAIN_NOT_ACTIVE', message: 'DNS can be managed once the domain is registered.' });
    return d;
  }

  /** What the panel said, in words for the customer. The panel's own text goes to the log, not to the browser. */
  private fromPanel(e: unknown, op: 'read' | 'change'): never {
    if (!(e instanceof ProvisioningError)) throw e;
    this.log.warn(`DNS panel problem (${op}): ${e.message}`);
    if (e.notFound) {
      if (op === 'read') throw new ConflictException({ code: 'DNS_NOT_AVAILABLE', message: 'DNS for this domain is not set up on our servers yet. Please contact us.' });
      throw new ConflictException({ code: 'DNS_RECORD_CHANGED', message: 'That record has changed since you opened this page. Reload and try again.' });
    }
    if (e.retryable) throw new BadGatewayException({ code: 'DNS_PANEL_UNAVAILABLE', message: 'The DNS server is not answering right now. Please try again in a moment.' });
    throw new BadGatewayException({ code: 'DNS_PANEL_REFUSED', message: 'The DNS server did not accept this. Please check the record, or contact us.' });
  }

  private async zone(domain: string): Promise<DnsRecord[]> {
    let raw: DnsRecordInput[];
    try {
      raw = await this.gateway.provider.list(domain);
    } catch (e) {
      return this.fromPanel(e, 'read');
    }
    return raw
      .map((r) => ({ ...r, id: recordId(r), readonly: isReadonly(r) }))
      .sort((a, b) => (a.name === '@' ? 0 : 1) - (b.name === '@' ? 0 : 1) || a.name.localeCompare(b.name) || ORDER.indexOf(a.type) - ORDER.indexOf(b.type) || a.content.localeCompare(b.content));
  }

  async list(ctx: TenantContext, id: string) {
    const d = await this.domainOf(ctx, id);
    return { domain: d.name, records: await this.zone(d.name) };
  }

  async create(ctx: TenantContext, id: string, input: DnsRecordInput, meta: RequestMeta) {
    const d = await this.domainOf(ctx, id);
    const checked = checkRecord(input, d.name, await this.zone(d.name));
    if (!checked.ok) throw new BadRequestException({ code: 'INVALID_DNS_RECORD', message: checked.message });
    try {
      await this.gateway.provider.add(d.name, checked.record);
    } catch (e) {
      return this.fromPanel(e, 'change');
    }
    await this.audit(ctx, meta, 'dns.record_added', d, checked.record);
    return { ...checked.record, id: recordId(checked.record), readonly: false };
  }

  async update(ctx: TenantContext, id: string, recordIdParam: string, input: DnsRecordInput, meta: RequestMeta) {
    const d = await this.domainOf(ctx, id);
    const zone = await this.zone(d.name);
    const current = zone.find((r) => r.id === recordIdParam);
    if (!current) throw new ConflictException({ code: 'DNS_RECORD_CHANGED', message: 'That record has changed since you opened this page. Reload and try again.' });
    if (current.readonly) throw new ForbiddenException({ code: 'DNS_RECORD_READONLY', message: 'This record is needed for the domain to work and cannot be changed here.' });
    const checked = checkRecord(input, d.name, zone.filter((r) => r.id !== current.id));
    if (!checked.ok) throw new BadRequestException({ code: 'INVALID_DNS_RECORD', message: checked.message });
    if (recordId(checked.record) === current.id && checked.record.ttl === current.ttl) return current; // nothing changed
    try {
      await this.gateway.provider.update(d.name, this.plain(current), checked.record);
    } catch (e) {
      return this.fromPanel(e, 'change');
    }
    await this.audit(ctx, meta, 'dns.record_updated', d, checked.record, this.plain(current));
    return { ...checked.record, id: recordId(checked.record), readonly: false };
  }

  async remove(ctx: TenantContext, id: string, recordIdParam: string, meta: RequestMeta) {
    const d = await this.domainOf(ctx, id);
    const current = (await this.zone(d.name)).find((r) => r.id === recordIdParam);
    if (!current) throw new ConflictException({ code: 'DNS_RECORD_CHANGED', message: 'That record has changed since you opened this page. Reload and try again.' });
    if (current.readonly) throw new ForbiddenException({ code: 'DNS_RECORD_READONLY', message: 'This record is needed for the domain to work and cannot be changed here.' });
    try {
      await this.gateway.provider.remove(d.name, this.plain(current));
    } catch (e) {
      return this.fromPanel(e, 'change');
    }
    await this.audit(ctx, meta, 'dns.record_removed', d, this.plain(current));
    return { id: recordIdParam, removed: true as const };
  }

  private plain(r: DnsRecord): DnsRecordInput {
    return { type: r.type, name: r.name, content: r.content, ttl: r.ttl, ...(r.priority != null ? { priority: r.priority } : {}) };
  }

  private audit(ctx: TenantContext, meta: RequestMeta, action: string, d: { id: string; name: string }, record: DnsRecordInput, before?: DnsRecordInput) {
    return this.db.run(ctx, (tx) =>
      tx.auditLog.create({
        data: {
          action, actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'domain', entityId: d.id,
          metadata: { domain: d.name, record: { type: record.type, name: record.name, content: record.content, ttl: record.ttl, priority: record.priority ?? null }, ...(before ? { before: { content: before.content, ttl: before.ttl } } : {}) } as Prisma.InputJsonValue,
          ipAddress: meta.ip ?? null, requestId: meta.requestId,
        },
      }),
    );
  }
}
