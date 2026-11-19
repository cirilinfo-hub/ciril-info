import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import type { InvoiceStatus, Prisma, SubscriptionStatus } from '../../generated/prisma/client.js';
import { orderBy, page, skipTake } from '../../common/http/pagination.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser, RequestMeta } from '../auth/auth.types.js';
import type { AdminInvoiceListQuery, AdminSubscriptionListQuery } from './admin-billing.dto.js';

const UNPAID: InvoiceStatus[] = ['ISSUED', 'OVERDUE', 'PARTIALLY_PAID'];
const DAY = 86_400_000;
const money = (d: { toString(): string } | null | undefined) => (d == null ? '0.00' : Number(d.toString()).toFixed(2));

/** Admin-portal billing: invoices, subscriptions and headline figures. Reads are permission-gated; voiding is audited. */
@Injectable()
export class AdminBillingService {
  constructor(
    private readonly db: PlatformPrisma,
    private readonly audit: AuditService,
  ) {}

  async listInvoices(q: AdminInvoiceListQuery) {
    const where: Prisma.InvoiceWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.search ? { OR: [{ number: { contains: q.search, mode: 'insensitive' } }, { tenant: { name: { contains: q.search, mode: 'insensitive' } } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.invoice.findMany({
        where, ...skipTake(q),
        orderBy: orderBy<Prisma.InvoiceOrderByWithRelationInput>(q.sort, { createdAt: (d) => ({ createdAt: d }), total: (d) => ({ total: d }), dueAt: (d) => ({ dueAt: d }) }, { createdAt: 'desc' }),
        select: { id: true, number: true, status: true, currency: true, total: true, amountPaid: true, issuedAt: true, dueAt: true, paidAt: true, tenant: { select: { id: true, name: true } } },
      }),
      this.db.invoice.count({ where }),
    ]);
    return page(rows, total, q);
  }

  async getInvoice(id: string) {
    const inv = await this.db.invoice.findUnique({
      where: { id },
      select: {
        id: true, number: true, status: true, currency: true, subtotal: true, discountTotal: true, taxTotal: true, total: true, amountPaid: true,
        issuedAt: true, dueAt: true, paidAt: true, voidedAt: true, billingSnapshot: true, subscriptionId: true,
        tenant: { select: { id: true, name: true } },
        items: { select: { id: true, description: true, quantity: true, unitPrice: true, taxRate: true, taxAmount: true, lineTotal: true } },
        payments: { orderBy: { createdAt: 'desc' }, select: { id: true, provider: true, status: true, amount: true, method: true, failureReason: true, providerPaymentId: true, createdAt: true } },
      },
    });
    if (!inv) throw new NotFoundException({ code: 'INVOICE_NOT_FOUND', message: 'Invoice not found.' });
    return { ...inv, testMode: inv.payments.some((p) => p.provider === 'MOCK') };
  }

  /** Void an unpaid invoice. A paid invoice needs a refund instead, never a void. An unpaid first order is cancelled with it. */
  async voidInvoice(user: AuthUser, id: string, reason: string, meta: RequestMeta) {
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${id}::uuid FOR UPDATE`;
      const inv = await tx.invoice.findUnique({ where: { id }, select: { id: true, tenantId: true, status: true, number: true, subscription: { select: { id: true, status: true } } } });
      if (!inv) throw new NotFoundException({ code: 'INVOICE_NOT_FOUND', message: 'Invoice not found.' });
      if (!UNPAID.includes(inv.status)) {
        throw new ConflictException({ code: 'INVOICE_NOT_VOIDABLE', message: inv.status === 'VOID' ? 'This invoice is already void.' : 'Only an unpaid invoice can be voided. Use a refund for a paid one.' });
      }
      if (await tx.payment.count({ where: { invoiceId: id, status: 'SUCCEEDED' } })) {
        throw new ConflictException({ code: 'INVOICE_HAS_PAYMENT', message: 'This invoice has a payment on it, so it cannot be voided.' });
      }
      await tx.invoice.update({ where: { id }, data: { status: 'VOID', voidedAt: new Date() } });
      if (inv.subscription?.status === 'PENDING') {
        await tx.subscription.update({ where: { id: inv.subscription.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), autoRenew: false } });
        await tx.subscriptionHistory.create({
          data: { tenantId: inv.tenantId, subscriptionId: inv.subscription.id, event: 'CANCELLED', fromStatus: 'PENDING', toStatus: 'CANCELLED', actorUserId: user.id, details: { reason, invoice: inv.number } },
        });
      }
      await this.audit.record({ action: 'invoice.void', actorId: user.id, tenantId: inv.tenantId, entityType: 'invoice', entityId: id, metadata: { reason, number: inv.number }, meta }, tx);
    });
    return this.getInvoice(id);
  }

  async listSubscriptions(q: AdminSubscriptionListQuery) {
    const where: Prisma.SubscriptionWhereInput = {
      ...(q.status ? { status: q.status as SubscriptionStatus } : {}),
      ...(q.search ? { OR: [{ tenant: { name: { contains: q.search, mode: 'insensitive' } } }, { items: { some: { description: { contains: q.search, mode: 'insensitive' } } } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.subscription.findMany({
        where, ...skipTake(q), orderBy: { createdAt: 'desc' },
        select: {
          id: true, status: true, billingCycle: true, currency: true, currentPeriodStart: true, currentPeriodEnd: true, cancelAtPeriodEnd: true, createdAt: true,
          tenant: { select: { id: true, name: true } }, items: { select: { description: true, unitPrice: true, renewalPrice: true } },
        },
      }),
      this.db.subscription.count({ where }),
    ]);
    return page(rows, total, q);
  }

  /** Headline billing figures for the dashboard. Money is summed from real invoices; test-mode payments are flagged, not hidden. */
  async summary() {
    const since = new Date(Date.now() - 30 * DAY);
    const [paid, outstanding, unpaidCount, activeSubs, pendingSubs, mock] = await Promise.all([
      this.db.invoice.aggregate({ where: { status: 'PAID', paidAt: { gte: since } }, _sum: { total: true }, _count: true }),
      this.db.invoice.aggregate({ where: { status: { in: UNPAID } }, _sum: { total: true } }),
      this.db.invoice.count({ where: { status: { in: UNPAID } } }),
      this.db.subscription.count({ where: { status: 'ACTIVE' } }),
      this.db.subscription.count({ where: { status: 'PENDING' } }),
      this.db.payment.count({ where: { provider: 'MOCK', status: 'SUCCEEDED' } }),
    ]);
    return {
      paidLast30Days: { count: paid._count, total: money(paid._sum.total) },
      outstanding: { count: unpaidCount, total: money(outstanding._sum.total) },
      activeSubscriptions: activeSubs,
      pendingSubscriptions: pendingSubs,
      /** True when any recorded payment came from the test-mode mock, so the totals may not be real money. */
      includesTestPayments: mock > 0,
    };
  }
}
