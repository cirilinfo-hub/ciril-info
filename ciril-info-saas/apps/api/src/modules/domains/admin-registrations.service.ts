import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { orderBy, page, skipTake } from '../../common/http/pagination.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser, RequestMeta } from '../auth/auth.types.js';
import { MailService } from '../mail/mail.service.js';
import type { AdminRegistrationListQuery, CompleteRegistrationDto } from './admin-registrations.dto.js';
import { addYears } from './domain-rules.js';

const select = {
  id: true, name: true, tld: true, status: true, years: true, registeredAt: true, expiresAt: true, registrarRef: true, failureReason: true, createdAt: true,
  tenant: { select: { id: true, name: true } },
  orderInvoice: { select: { id: true, number: true, status: true, total: true } },
} as const;

/**
 * Admin-portal domain registrations. A customer orders and pays; staff register the name at the registrar by hand
 * and record it here. Nothing in this service talks to a registrar.
 */
@Injectable()
export class AdminRegistrationsService {
  private readonly portalUrl: string;

  constructor(
    private readonly db: PlatformPrisma,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    config: ConfigService<Env, true>,
  ) {
    this.portalUrl = config.get('CUSTOMER_PORTAL_URL', { infer: true }).replace(/\/$/, '');
  }

  async list(q: AdminRegistrationListQuery) {
    const where: Prisma.DomainWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.needsAction ? { status: 'PENDING_REGISTRATION', orderInvoice: { status: 'PAID' } } : {}),
      ...(q.search ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { tenant: { name: { contains: q.search, mode: 'insensitive' } } }] } : {}),
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

  /** Loads a paid order that is waiting to be registered, or says precisely why it is not. */
  private async waiting(id: string) {
    const d = await this.db.domain.findUnique({ where: { id }, select });
    if (!d) throw new NotFoundException({ code: 'DOMAIN_NOT_FOUND', message: 'Domain not found.' });
    if (d.status !== 'PENDING_REGISTRATION') throw new ConflictException({ code: 'DOMAIN_NOT_WAITING', message: 'This domain is not waiting to be registered.' });
    if (d.orderInvoice?.status !== 'PAID') throw new ConflictException({ code: 'DOMAIN_NOT_PAID', message: 'This order has not been paid yet.' });
    return d;
  }

  /** Staff report the name registered at the registrar. The customer is told. */
  async complete(user: AuthUser, id: string, dto: CompleteRegistrationDto, meta: RequestMeta) {
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
    await this.audit.record({ action: 'domain.registered', actorId: user.id, tenantId: d.tenant.id, entityType: 'domain', entityId: id, metadata: { name: d.name, expiresAt: expiresAt.toISOString(), registrarRef: dto.registrarRef ?? null }, meta });
    await this.tell(d.tenant.id, { type: 'domain.registered', title: `${d.name} is registered`, body: 'It is now yours to use. We will remind you before it expires.', link: '/domains' }, d.name, true);
    return this.db.domain.findUniqueOrThrow({ where: { id }, select });
  }

  /** Staff cannot register it. The customer is told why; staff then refund the invoice from the invoices page. */
  async decline(user: AuthUser, id: string, reason: string, meta: RequestMeta) {
    const d = await this.waiting(id);
    const r = await this.db.domain.updateMany({ where: { id, status: 'PENDING_REGISTRATION' }, data: { status: 'FAILED', failureReason: reason } });
    if (r.count === 0) throw new ConflictException({ code: 'DOMAIN_NOT_WAITING', message: 'This domain is not waiting to be registered.' });
    await this.audit.record({ action: 'domain.registration_failed', actorId: user.id, tenantId: d.tenant.id, entityType: 'domain', entityId: id, metadata: { name: d.name, reason }, meta });
    await this.tell(d.tenant.id, { type: 'domain.failed', title: `We could not register ${d.name}`, body: `${reason} We will refund your payment.`, link: '/domains' }, d.name, false);
    return this.db.domain.findUniqueOrThrow({ where: { id }, select });
  }

  private async tell(tenantId: string, n: { type: string; title: string; body: string; link: string }, name: string, email: boolean) {
    const owners = await this.db.tenantMembership.findMany({ where: { tenantId, status: 'ACTIVE', role: { key: 'TENANT_OWNER' } }, select: { user: { select: { id: true, email: true } } } });
    if (!owners.length) return;
    await this.db.notification.createMany({ data: owners.map((o) => ({ userId: o.user.id, tenantId, type: n.type, title: n.title, body: n.body, link: n.link })) });
    if (email) for (const o of owners) await this.mail.enqueue({ template: 'domain-registered', to: o.user.email, data: { domain: name, link: `${this.portalUrl}/domains` } }, undefined, tenantId);
  }
}
