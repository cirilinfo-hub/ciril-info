import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PlatformPrisma, TenantPrisma } from '../../database/prisma-clients.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { RequestMeta, TenantContext } from '../auth/auth.types.js';
import { registrarPhone } from './providers/godaddy-registrar.provider.js';
import type { RegistrantContact } from './providers/registrar-provider.js';

/** The fields of a domain contact a customer can change. */
const FIELDS = ['firstName', 'lastName', 'organisation', 'email', 'phone', 'address1', 'address2', 'city', 'state', 'postalCode', 'country'] as const;

/** A contact as stored: only known fields, trimmed, empty optional fields left out. */
export function cleanContact(c: Partial<Record<(typeof FIELDS)[number], string | null | undefined>>): RegistrantContact {
  const out: Record<string, string> = {};
  for (const f of FIELDS) {
    const v = (c[f] ?? '').toString().trim();
    if (v) out[f] = f === 'country' ? v.toUpperCase() : f === 'email' ? v.toLowerCase() : v;
  }
  return out as unknown as RegistrantContact;
}

/** A phone number registries will take, and that looks real: at least seven digits after the country code, ten for India. */
export function plausiblePhone(phone: string, country: string): boolean {
  const formatted = registrarPhone(phone, country);
  if (!formatted) return false;
  const [code, national = ''] = formatted.slice(1).split('.');
  return code === '91' ? /^[6-9]\d{9}$/.test(national) : national.length >= 7;
}

/** Changing name, organisation or email is a "change of registrant" under ICANN rules: confirmation emails and, often, a 60-day transfer lock. */
export function isRegistrantChange(from: RegistrantContact | null, to: RegistrantContact) {
  if (!from) return true;
  const n = (s?: string) => (s ?? '').trim().toLowerCase();
  return n(from.firstName) !== n(to.firstName) || n(from.lastName) !== n(to.lastName) || n(from.organisation) !== n(to.organisation) || n(from.email) !== n(to.email);
}

/**
 * Customer portal: a domain's contact details (the registrant, also used as the admin, technical and billing contact).
 * The customer sees what is on record (or the organisation's details if nothing has been changed yet), asks for a change
 * after a warning about the registry's rules, and is told when it is done.
 */
@Injectable()
export class DomainContactsService {
  constructor(
    private readonly db: TenantPrisma,
    private readonly platform: PlatformPrisma,
  ) {}

  /** What is on record, or what the domain was registered with: the organisation's owner, details and default address. */
  async current(ctx: TenantContext, domainId: string) {
    const d = await this.db.run(ctx, (tx) => tx.domain.findUnique({ where: { id: domainId }, select: { id: true, contact: true, contactChanges: { where: { status: 'REQUESTED' }, take: 1, select: { id: true, contact: true, requestedAt: true } } } }));
    if (!d) throw new NotFoundException({ code: 'DOMAIN_NOT_FOUND', message: 'Domain not found.' });
    const recorded = d.contact as RegistrantContact | null;
    return { contact: recorded ?? (await this.fromOrganisation(ctx.tenantId)), recorded: recorded !== null, pending: d.contactChanges[0] ?? null };
  }

  private async fromOrganisation(tenantId: string): Promise<RegistrantContact> {
    const [acct, owner, addr] = await Promise.all([
      this.platform.customerAccount.findUnique({ where: { tenantId }, select: { companyName: true, billingEmail: true, phone: true } }),
      this.platform.tenantMembership.findFirst({ where: { tenantId, status: 'ACTIVE', role: { key: 'TENANT_OWNER' } }, orderBy: { createdAt: 'asc' }, select: { user: { select: { firstName: true, lastName: true, email: true, phone: true } } } }),
      this.platform.customerAddress.findFirst({ where: { tenantId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] }),
    ]);
    return cleanContact({
      firstName: owner?.user.firstName, lastName: owner?.user.lastName, organisation: acct?.companyName, email: acct?.billingEmail ?? owner?.user.email, phone: acct?.phone || owner?.user.phone,
      address1: addr?.line1, address2: addr?.line2, city: addr?.city, state: addr?.state, postalCode: addr?.postalCode, country: addr?.country ?? 'IN',
    });
  }

  request(ctx: TenantContext, domainId: string, raw: Partial<RegistrantContact>, meta: RequestMeta) {
    const contact = cleanContact(raw);
    if (!plausiblePhone(contact.phone, contact.country)) {
      throw new BadRequestException({ code: 'CONTACT_INVALID', message: `"${contact.phone}" is not a phone number registries accept. Include the country code, for example +91 98765 43210.` });
    }
    return this.db.run(ctx, async (tx) => {
      await tx.$queryRaw`SELECT id FROM domains WHERE id = ${domainId}::uuid FOR UPDATE`;
      const d = await tx.domain.findUnique({ where: { id: domainId }, select: { id: true, name: true, status: true, contact: true } });
      if (!d) throw new NotFoundException({ code: 'DOMAIN_NOT_FOUND', message: 'Domain not found.' });
      if (d.status !== 'ACTIVE') throw new ConflictException({ code: 'DOMAIN_NOT_ACTIVE', message: 'Contact details can only be changed on an active domain.' });
      if (await tx.domainContactChange.count({ where: { domainId, status: 'REQUESTED' } })) {
        throw new ConflictException({ code: 'CONTACT_CHANGE_PENDING', message: 'A contact change is already waiting for this domain. Withdraw it first to ask for a different one.' });
      }
      const from = d.contact as RegistrantContact | null;
      if (from && JSON.stringify(cleanContact(from)) === JSON.stringify(contact)) throw new ConflictException({ code: 'CONTACT_UNCHANGED', message: 'These are already the contact details on record.' });
      const row = await tx.domainContactChange.create({ data: { tenantId: ctx.tenantId, domainId, contact: contact as unknown as Prisma.InputJsonValue }, select: { id: true, status: true, contact: true, requestedAt: true } });
      await tx.outboxEvent.createMany({ data: { tenantId: ctx.tenantId, type: 'domain.contacts_requested', aggregateType: 'domain', aggregateId: domainId, payload: { changeId: row.id, name: d.name } } });
      await tx.auditLog.create({ data: { action: 'domain.contacts_requested', actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'domain', entityId: domainId, metadata: { name: d.name, registrantChange: isRegistrantChange(from, contact) } as Prisma.InputJsonValue, ipAddress: meta.ip ?? null, requestId: meta.requestId } });
      return row;
    });
  }

  cancel(ctx: TenantContext, domainId: string, meta: RequestMeta) {
    return this.db.run(ctx, async (tx) => {
      const c = await tx.domainContactChange.findFirst({ where: { domainId, status: 'REQUESTED' }, select: { id: true, domain: { select: { name: true } } } });
      if (!c) throw new NotFoundException({ code: 'CONTACT_CHANGE_NOT_FOUND', message: 'No contact change is waiting for this domain. It may have just been made.' });
      const r = await tx.domainContactChange.updateMany({ where: { id: c.id, status: 'REQUESTED' }, data: { status: 'CANCELLED' } });
      if (r.count === 0) throw new ConflictException({ code: 'CONTACT_CHANGE_DONE', message: 'The change has just been made. Reload the page.' });
      await tx.auditLog.create({ data: { action: 'domain.contacts_withdrawn', actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'domain', entityId: domainId, metadata: { name: c.domain.name } as Prisma.InputJsonValue, ipAddress: meta.ip ?? null, requestId: meta.requestId } });
      return { id: c.id, status: 'CANCELLED' as const };
    });
  }
}
