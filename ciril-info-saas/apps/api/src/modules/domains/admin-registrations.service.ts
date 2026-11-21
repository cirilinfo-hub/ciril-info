import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { Inject } from '@nestjs/common';
import type { SecretBox } from '../../common/security/crypto.js';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { orderBy, page, skipTake } from '../../common/http/pagination.js';
import { AuditService } from '../audit/audit.service.js';
import type { RequestMeta } from '../auth/auth.types.js';
import { MailService } from '../mail/mail.service.js';
import type { AdminRegistrationListQuery, CompleteRegistrationDto } from './admin-registrations.dto.js';
import { addYears } from './domain-rules.js';
import { LIVE_TRANSFER } from './domain-orders.service.js';
import { DOMAIN_SECRET_BOX } from './secret-box.js';

const select = {
  id: true, name: true, tld: true, status: true, years: true, registeredAt: true, expiresAt: true, registrarRef: true, failureReason: true, createdAt: true,
  tenant: { select: { id: true, name: true } },
  orderInvoice: { select: { id: true, number: true, status: true, total: true } },
  reminderStage: true,
  transfers: { where: { status: { in: LIVE_TRANSFER } }, take: 1, select: { id: true, status: true, failureReason: true, invoice: { select: { id: true, number: true, status: true, total: true } } } },
  renewals: { where: { status: 'PENDING' as const }, take: 1, select: { id: true, years: true, requestedAt: true, failureReason: true, invoice: { select: { id: true, number: true, status: true, total: true } } } },
} as const;

/**
 * Admin-portal domain registrations. A customer orders and pays; the name is registered at the registrar (by staff by hand,
 * or automatically by RegistrarAutomationService) and recorded here. A null actor is the system. Nothing here talks to a registrar.
 */
@Injectable()
export class AdminRegistrationsService {
  private readonly portalUrl: string;

  constructor(
    private readonly db: PlatformPrisma,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    @Inject(DOMAIN_SECRET_BOX) private readonly box: SecretBox,
    config: ConfigService<Env, true>,
  ) {
    this.portalUrl = config.get('CUSTOMER_PORTAL_URL', { infer: true }).replace(/\/$/, '');
  }

  async list(q: AdminRegistrationListQuery) {
    const where: Prisma.DomainWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.needsAction ? { OR: [{ status: 'PENDING_REGISTRATION' as const, orderInvoice: { status: 'PAID' as const } }, { renewals: { some: { status: 'PENDING' as const, invoice: { status: 'PAID' as const } } } }, { status: 'PENDING_TRANSFER' as const, transfers: { some: { status: { in: ['REQUESTED' as const, 'IN_PROGRESS' as const] }, invoice: { status: 'PAID' as const } } } }] } : {}),
      ...(q.search ? { AND: [{ OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { tenant: { name: { contains: q.search, mode: 'insensitive' } } }] }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.domain.findMany({
        where, select, ...skipTake(q),
        orderBy: orderBy<Prisma.DomainOrderByWithRelationInput>(q.sort, { createdAt: (d) => ({ createdAt: d }), name: (d) => ({ name: d }), expiresAt: (d) => ({ expiresAt: d }) }, { createdAt: 'desc' }),
      }),
      this.db.domain.count({ where }),
    ]);
    return page(rows, total, q);
  }

  /** One domain, as the list shows it. */
  async one(id: string) {
    const d = await this.db.domain.findUnique({ where: { id }, select });
    if (!d) throw new NotFoundException({ code: 'DOMAIN_NOT_FOUND', message: 'Domain not found.' });
    return d;
  }

  /** Loads a paid order that is waiting to be registered, or says precisely why it is not. */
  private async waiting(id: string) {
    const d = await this.db.domain.findUnique({ where: { id }, select });
    if (!d) throw new NotFoundException({ code: 'DOMAIN_NOT_FOUND', message: 'Domain not found.' });
    if (d.status !== 'PENDING_REGISTRATION') throw new ConflictException({ code: 'DOMAIN_NOT_WAITING', message: 'This domain is not waiting to be registered.' });
    if (d.orderInvoice?.status !== 'PAID') throw new ConflictException({ code: 'DOMAIN_NOT_PAID', message: 'This order has not been paid yet.' });
    return d;
  }

  /** Staff report the name registered at the registrar. The customer is told. */
  async complete(actor: { id: string } | null, id: string, dto: CompleteRegistrationDto, meta?: RequestMeta) {
    const d = await this.waiting(id);
    const now = new Date();
    const expiresAt = dto.expiresAt ?? addYears(now, d.years);
    if (expiresAt <= now) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The expiry date must be in the future.' });
    // The status check is repeated in the write, so two staff pressing the button together cannot both succeed.
    const r = await this.db.domain.updateMany({
      where: { id, status: 'PENDING_REGISTRATION' },
      data: { status: 'ACTIVE', registeredAt: now, expiresAt, registrarRef: dto.registrarRef || null, failureReason: null },
    });
    if (r.count === 0) throw new ConflictException({ code: 'DOMAIN_NOT_WAITING', message: 'This domain is not waiting to be registered.' });
    await this.audit.record({ action: 'domain.registered', actorId: actor?.id ?? null, tenantId: d.tenant.id, entityType: 'domain', entityId: id, metadata: { name: d.name, expiresAt: expiresAt.toISOString(), registrarRef: dto.registrarRef ?? null }, meta });
    await this.tell(d.tenant.id, { type: 'domain.registered', title: `${d.name} is registered`, body: 'It is now yours to use. We will remind you before it expires.', link: '/domains' }, d.name, true);
    return this.db.domain.findUniqueOrThrow({ where: { id }, select });
  }

  /** Staff cannot register it. The customer is told why; staff then refund the invoice from the invoices page. */
  async decline(actor: { id: string } | null, id: string, reason: string, meta?: RequestMeta) {
    const d = await this.waiting(id);
    const r = await this.db.domain.updateMany({ where: { id, status: 'PENDING_REGISTRATION' }, data: { status: 'FAILED', failureReason: reason } });
    if (r.count === 0) throw new ConflictException({ code: 'DOMAIN_NOT_WAITING', message: 'This domain is not waiting to be registered.' });
    await this.audit.record({ action: 'domain.registration_failed', actorId: actor?.id ?? null, tenantId: d.tenant.id, entityType: 'domain', entityId: id, metadata: { name: d.name, reason }, meta });
    await this.tell(d.tenant.id, { type: 'domain.failed', title: `We could not register ${d.name}`, body: `${reason} We will refund your payment.`, link: '/domains' }, d.name, false);
    return this.db.domain.findUniqueOrThrow({ where: { id }, select });
  }

  /** A paid transfer that is still going, or the precise reason there is none. */
  private async transferWaiting(id: string) {
    const d = await this.db.domain.findUnique({ where: { id }, select });
    if (!d) throw new NotFoundException({ code: 'DOMAIN_NOT_FOUND', message: 'Domain not found.' });
    const t = d.transfers[0];
    if (d.status !== 'PENDING_TRANSFER' || !t) throw new ConflictException({ code: 'TRANSFER_NOT_WAITING', message: 'This domain has no transfer waiting.' });
    if (t.invoice?.status !== 'PAID') throw new ConflictException({ code: 'TRANSFER_NOT_PAID', message: 'The transfer has not been paid yet.' });
    return { d, t };
  }

  /** The code the customer got from their current registrar, for staff to start the transfer with. Each viewing is recorded. */
  async transferAuthCode(actor: { id: string } | null, id: string, meta?: RequestMeta) {
    const { d, t } = await this.transferWaiting(id);
    const row = await this.db.domainTransfer.findUniqueOrThrow({ where: { id: t.id }, select: { authCodeEnc: true } });
    if (!row.authCodeEnc) throw new ConflictException({ code: 'NO_AUTH_CODE', message: 'There is no authorisation code on file for this transfer.' });
    await this.audit.record({ action: 'domain.transfer_code_viewed', actorId: actor?.id ?? null, tenantId: d.tenant.id, entityType: 'domain', entityId: id, metadata: { name: d.name }, meta });
    return { authCode: this.box.decrypt(row.authCodeEnc, `transfer:${t.id}`) };
  }

  /** Staff report the transfer started at the registrar. The customer is asked to approve it with their current registrar. */
  async startTransfer(actor: { id: string } | null, id: string, meta?: RequestMeta) {
    const { d, t } = await this.transferWaiting(id);
    const r = await this.db.domainTransfer.updateMany({ where: { id: t.id, status: 'REQUESTED' }, data: { status: 'IN_PROGRESS' } });
    if (r.count === 0) throw new ConflictException({ code: 'TRANSFER_NOT_WAITING', message: 'This transfer has already been started.' });
    await this.audit.record({ action: 'domain.transfer_started', actorId: actor?.id ?? null, tenantId: d.tenant.id, entityType: 'domain', entityId: id, metadata: { name: d.name }, meta });
    await this.tellRenewal(d.tenant.id, { type: 'domain.transfer_started', title: `The transfer of ${d.name} has started`, body: 'Your current registrar may email you to approve it. Approving it quickly speeds things up. It usually takes up to 7 days.', link: '/domains' });
    return this.db.domain.findUniqueOrThrow({ where: { id }, select });
  }

  /** Staff report the domain now with us. It becomes Active, a year longer than it was, and the stored code is deleted. */
  async completeTransfer(actor: { id: string } | null, id: string, dto: CompleteRegistrationDto, meta?: RequestMeta) {
    const { d, t } = await this.transferWaiting(id);
    const now = new Date();
    const expiresAt = dto.expiresAt ?? addYears(now, 1);
    if (expiresAt <= now) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The expiry date must be in the future.' });
    await this.db.$transaction(async (tx) => {
      const done = await tx.domainTransfer.updateMany({ where: { id: t.id, status: { in: ['REQUESTED', 'IN_PROGRESS'] } }, data: { status: 'COMPLETED', completedAt: now, authCodeEnc: null } });
      if (done.count === 0) throw new ConflictException({ code: 'TRANSFER_NOT_WAITING', message: 'This domain has no transfer waiting.' });
      await tx.domain.update({ where: { id }, data: { status: 'ACTIVE', registeredAt: now, expiresAt, reminderStage: 0, ...(dto.registrarRef ? { registrarRef: dto.registrarRef } : {}) } });
    });
    await this.audit.record({ action: 'domain.transferred_in', actorId: actor?.id ?? null, tenantId: d.tenant.id, entityType: 'domain', entityId: id, metadata: { name: d.name, expiresAt: expiresAt.toISOString() }, meta });
    const owners = await this.db.tenantMembership.findMany({ where: { tenantId: d.tenant.id, status: 'ACTIVE', role: { key: 'TENANT_OWNER' } }, select: { user: { select: { id: true, email: true } } } });
    if (owners.length) {
      await this.db.notification.createMany({ data: owners.map((o) => ({ userId: o.user.id, tenantId: d.tenant.id, type: 'domain.transferred', title: `${d.name} has been transferred to us`, body: `It is registered until ${expiresAt.toISOString().slice(0, 10)}.`, link: '/domains' })) });
      for (const o of owners) await this.mail.enqueue({ template: 'domain-transferred', to: o.user.email, data: { domain: d.name, expiresOn: expiresAt.toISOString().slice(0, 10), link: `${this.portalUrl}/domains` } }, undefined, d.tenant.id);
    }
    return this.db.domain.findUniqueOrThrow({ where: { id }, select });
  }

  /** The transfer did not happen (refused, wrong code, domain locked). The customer is told why and the stored code is deleted. */
  async failTransfer(actor: { id: string } | null, id: string, reason: string, meta?: RequestMeta) {
    const { d, t } = await this.transferWaiting(id);
    await this.db.$transaction(async (tx) => {
      const done = await tx.domainTransfer.updateMany({ where: { id: t.id, status: { in: ['REQUESTED', 'IN_PROGRESS'] } }, data: { status: 'REJECTED', failureReason: reason, authCodeEnc: null } });
      if (done.count === 0) throw new ConflictException({ code: 'TRANSFER_NOT_WAITING', message: 'This domain has no transfer waiting.' });
      await tx.domain.update({ where: { id }, data: { status: 'FAILED', failureReason: reason } });
    });
    await this.audit.record({ action: 'domain.transfer_failed', actorId: actor?.id ?? null, tenantId: d.tenant.id, entityType: 'domain', entityId: id, metadata: { name: d.name, reason }, meta });
    await this.tellRenewal(d.tenant.id, { type: 'domain.transfer_failed', title: `We could not transfer ${d.name}`, body: `${reason} We will refund your payment.`, link: '/domains' });
    return this.db.domain.findUniqueOrThrow({ where: { id }, select });
  }

  /** A paid renewal waiting for staff, or the precise reason there is none. */
  private async renewalWaiting(id: string) {
    const d = await this.db.domain.findUnique({ where: { id }, select });
    if (!d) throw new NotFoundException({ code: 'DOMAIN_NOT_FOUND', message: 'Domain not found.' });
    const r = d.renewals[0];
    if (!r) throw new ConflictException({ code: 'RENEWAL_NOT_WAITING', message: 'This domain has no renewal waiting.' });
    if (r.invoice.status !== 'PAID') throw new ConflictException({ code: 'RENEWAL_NOT_PAID', message: 'The renewal has not been paid yet.' });
    return { d, r };
  }

  /** Staff report the name renewed at the registrar. The new end date is the paid years added to the current end (or to today, if it had lapsed). */
  async completeRenewal(actor: { id: string } | null, id: string, dto: CompleteRegistrationDto, meta?: RequestMeta) {
    const { d, r } = await this.renewalWaiting(id);
    const now = new Date();
    const from = d.expiresAt && d.expiresAt > now ? d.expiresAt : now;
    const expiresAt = dto.expiresAt ?? addYears(from, r.years);
    if (d.expiresAt && expiresAt <= d.expiresAt) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The new expiry date must be later than the current one.' });
    if (expiresAt <= now) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The expiry date must be in the future.' });
    await this.db.$transaction(async (tx) => {
      // Repeated in the write so two staff pressing the button together renew it once.
      const done = await tx.domainRenewal.updateMany({ where: { id: r.id, status: 'PENDING' }, data: { status: 'DONE', completedAt: now } });
      if (done.count === 0) throw new ConflictException({ code: 'RENEWAL_NOT_WAITING', message: 'This domain has no renewal waiting.' });
      await tx.domain.update({ where: { id }, data: { status: 'ACTIVE', expiresAt, reminderStage: 0, ...(dto.registrarRef ? { registrarRef: dto.registrarRef } : {}) } });
    });
    await this.audit.record({ action: 'domain.renewed', actorId: actor?.id ?? null, tenantId: d.tenant.id, entityType: 'domain', entityId: id, metadata: { name: d.name, years: r.years, expiresAt: expiresAt.toISOString() }, meta });
    await this.tellRenewal(d.tenant.id, { type: 'domain.renewed', title: `${d.name} is renewed`, body: `It is now registered until ${expiresAt.toISOString().slice(0, 10)}.`, link: '/domains' }, { template: 'domain-renewed', domain: d.name, expiresOn: expiresAt.toISOString().slice(0, 10) });
    return this.db.domain.findUniqueOrThrow({ where: { id }, select });
  }

  /** Staff cannot renew it. The renewal is closed, the domain is left as it was, and the customer is told why. Staff then refund the invoice. */
  async declineRenewal(actor: { id: string } | null, id: string, reason: string, meta?: RequestMeta) {
    const { d, r } = await this.renewalWaiting(id);
    const done = await this.db.domainRenewal.updateMany({ where: { id: r.id, status: 'PENDING' }, data: { status: 'CANCELLED', failureReason: reason } });
    if (done.count === 0) throw new ConflictException({ code: 'RENEWAL_NOT_WAITING', message: 'This domain has no renewal waiting.' });
    await this.audit.record({ action: 'domain.renewal_failed', actorId: actor?.id ?? null, tenantId: d.tenant.id, entityType: 'domain', entityId: id, metadata: { name: d.name, reason }, meta });
    await this.tellRenewal(d.tenant.id, { type: 'domain.renewal_failed', title: `We could not renew ${d.name}`, body: `${reason} We will refund your payment.`, link: '/domains' });
    return this.db.domain.findUniqueOrThrow({ where: { id }, select });
  }

  private async tellRenewal(tenantId: string, n: { type: string; title: string; body: string; link: string }, email?: { template: 'domain-renewed'; domain: string; expiresOn: string }) {
    const owners = await this.db.tenantMembership.findMany({ where: { tenantId, status: 'ACTIVE', role: { key: 'TENANT_OWNER' } }, select: { user: { select: { id: true, email: true } } } });
    if (!owners.length) return;
    await this.db.notification.createMany({ data: owners.map((o) => ({ userId: o.user.id, tenantId, type: n.type, title: n.title, body: n.body, link: n.link })) });
    if (email) for (const o of owners) await this.mail.enqueue({ template: email.template, to: o.user.email, data: { domain: email.domain, expiresOn: email.expiresOn, link: `${this.portalUrl}/domains` } }, undefined, tenantId);
  }

  private async tell(tenantId: string, n: { type: string; title: string; body: string; link: string }, name: string, email: boolean) {
    const owners = await this.db.tenantMembership.findMany({ where: { tenantId, status: 'ACTIVE', role: { key: 'TENANT_OWNER' } }, select: { user: { select: { id: true, email: true } } } });
    if (!owners.length) return;
    await this.db.notification.createMany({ data: owners.map((o) => ({ userId: o.user.id, tenantId, type: n.type, title: n.title, body: n.body, link: n.link })) });
    if (email) for (const o of owners) await this.mail.enqueue({ template: 'domain-registered', to: o.user.email, data: { domain: name, link: `${this.portalUrl}/domains` } }, undefined, tenantId);
  }
}
