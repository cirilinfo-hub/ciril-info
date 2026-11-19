import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PlatformPrisma, TenantPrisma } from '../../database/prisma-clients.js';
import { HostingGateway } from './hosting-gateway.js';
import type { RequestMeta, TenantContext } from '../auth/auth.types.js';
import { HOSTING_PRODUCT_TYPES, normaliseDomain } from './hosting-rules.js';
import type { SetUpHostingDto } from './hosting.dto.js';

const accountSelect = {
  id: true, primaryDomain: true, status: true, provisionedAt: true, suspendedAt: true, suspendReason: true, createdAt: true, subscriptionId: true,
  plan: { select: { id: true, name: true } },
} as const;

/** Customer-portal hosting: see your accounts and set up the ones you have paid for. Panel details never reach the browser. */
@Injectable()
export class HostingService {
  constructor(
    private readonly db: TenantPrisma,
    private readonly platform: PlatformPrisma,
    private readonly gateway: HostingGateway,
  ) {}

  /** The organisation's hosting accounts, and the paid hosting services still waiting for a domain. */
  list(ctx: TenantContext) {
    return this.db.run(ctx, async (tx) => {
      const accounts = await tx.hostingAccount.findMany({ select: accountSelect, orderBy: { createdAt: 'desc' } });
      const waiting = await tx.subscription.findMany({
        where: {
          status: 'ACTIVE',
          items: { some: { plan: { product: { type: { in: [...HOSTING_PRODUCT_TYPES] } } } } },
          hostingAccounts: { none: { status: { notIn: ['CANCELLED', 'TERMINATED'] } } },
        },
        select: { id: true, createdAt: true, items: { select: { description: true }, take: 1 } },
        orderBy: { createdAt: 'desc' },
      });
      return { manualSetup: this.gateway.mode === 'manual', accounts, awaitingSetup: waiting.map((s) => ({ subscriptionId: s.id, description: s.items[0]?.description ?? 'Hosting plan', paidOn: s.createdAt })) };
    });
  }

  get(ctx: TenantContext, id: string) {
    return this.db.run(ctx, async (tx) => {
      const a = await tx.hostingAccount.findUnique({ where: { id }, select: accountSelect });
      if (!a) throw new NotFoundException({ code: 'HOSTING_NOT_FOUND', message: 'Hosting account not found.' });
      return a;
    });
  }

  /** Creates the account record and queues its set-up. The worker does the rest, so this answers straight away. */
  async setUp(ctx: TenantContext, dto: SetUpHostingDto, meta: RequestMeta) {
    const domain = normaliseDomain(dto.domain);
    if (!domain) throw new BadRequestException({ code: 'INVALID_DOMAIN', message: 'Enter a domain name such as example.com.' });

    // Another organisation's accounts are invisible to this session, so the "already hosted" check uses the platform role.
    const taken = await this.platform.hostingAccount.findFirst({ where: { primaryDomain: domain, status: { notIn: ['CANCELLED', 'TERMINATED', 'FAILED'] } }, select: { id: true } });
    if (taken) throw new ConflictException({ code: 'DOMAIN_IN_USE', message: 'This domain is already hosted with us. If it is yours, contact support.' });

    try {
      return await this.db.run(ctx, async (tx) => {
        const sub = await tx.subscription.findUnique({
          where: { id: dto.subscriptionId },
          select: { id: true, status: true, items: { select: { planId: true, plan: { select: { product: { select: { type: true } } } } }, take: 1 }, hostingAccounts: { where: { status: { notIn: ['CANCELLED', 'TERMINATED'] } }, select: { id: true } } },
        });
        if (!sub) throw new NotFoundException({ code: 'SUBSCRIPTION_NOT_FOUND', message: 'Service not found.' });
        const item = sub.items[0];
        if (!item || !HOSTING_PRODUCT_TYPES.includes(item.plan.product.type)) throw new ConflictException({ code: 'NOT_HOSTING', message: 'This service does not include hosting.' });
        if (sub.status !== 'ACTIVE') throw new ConflictException({ code: 'NOT_ACTIVE', message: 'This service has to be paid and active before hosting can be set up.' });
        if (sub.hostingAccounts.length) throw new ConflictException({ code: 'ALREADY_SET_UP', message: 'Hosting is already set up for this service.' });

        const account = await tx.hostingAccount.create({
          data: { tenantId: ctx.tenantId, subscriptionId: sub.id, planId: item.planId, primaryDomain: domain, status: 'PENDING' },
          select: accountSelect,
        });
        // One create-job per account, ever: a double click or a retry cannot make a second.
        await tx.provisioningJob.create({ data: { tenantId: ctx.tenantId, hostingAccountId: account.id, action: 'CREATE', idempotencyKey: `create:${account.id}` } });
        await tx.auditLog.create({
          data: { action: 'hosting.setup', actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'hosting_account', entityId: account.id, metadata: { domain }, ipAddress: meta.ip ?? null, requestId: meta.requestId },
        });
        return account;
      });
    } catch (e) {
      // The database also refuses two live accounts for one domain, which settles a race between two customers.
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException({ code: 'DOMAIN_IN_USE', message: 'This domain is already hosted with us. If it is yours, contact support.' });
      throw e;
    }
  }
}
