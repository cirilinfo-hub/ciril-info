import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import type { InvoiceStatus, Prisma, SubscriptionStatus } from '../../generated/prisma/client.js';
import { orderBy, page, skipTake } from '../../common/http/pagination.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser, RequestMeta } from '../auth/auth.types.js';
import type { AdminInvoiceListQuery, AdminSubscriptionListQuery, RefundDto } from './admin-billing.dto.js';
import { toPaise } from './billing.logic.js';
import { PaymentGateway } from './payment-gateway.js';

const UNPAID: InvoiceStatus[] = ['ISSUED', 'OVERDUE', 'PARTIALLY_PAID'];
const DAY = 86_400_000;
const money = (d: { toString(): string } | null | undefined) => (d == null ? '0.00' : Number(d.toString()).toFixed(2));

/** Admin-portal billing: invoices, subscriptions and headline figures. Reads are permission-gated; voiding is audited. */
@Injectable()
export class AdminBillingService {
  constructor(
    private readonly db: PlatformPrisma,
    private readonly audit: AuditService,
    private readonly gateway: PaymentGateway,
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
        refunds: { orderBy: { createdAt: 'desc' }, select: { id: true, amount: true, status: true, reason: true, createdAt: true } },
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

  /**
   * Refund a paid invoice, in full or in part. Two phases so a real provider call never sits inside a database
   * transaction: first the refund is recorded as PROCESSING (which already counts against what can still be
   * refunded), then the gateway is asked, then the result is recorded.
   */
  async refundInvoice(user: AuthUser, invoiceId: string, dto: RefundDto, meta: RequestMeta) {
    const started = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId}::uuid FOR UPDATE`;
      const inv = await tx.invoice.findUnique({ where: { id: invoiceId }, select: { id: true, tenantId: true, number: true, status: true, currency: true } });
      if (!inv) throw new NotFoundException({ code: 'INVOICE_NOT_FOUND', message: 'Invoice not found.' });
      const payment = await tx.payment.findFirst({ where: { invoiceId, status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } }, orderBy: { createdAt: 'desc' } });
      if (!payment) throw new ConflictException({ code: 'NOTHING_TO_REFUND', message: 'This invoice has no payment to refund.' });
      const used = await tx.refund.aggregate({ where: { paymentId: payment.id, status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING', 'SUCCEEDED'] } }, _sum: { amount: true } });
      const remaining = toPaise(payment.amount) - toPaise(used._sum.amount ?? 0);
      if (remaining <= 0) throw new ConflictException({ code: 'ALREADY_REFUNDED', message: 'This payment has already been refunded in full.' });
      const wanted = dto.amount === undefined ? remaining : toPaise(dto.amount);
      if (wanted > remaining) {
        throw new ConflictException({ code: 'REFUND_TOO_LARGE', message: `At most ${(remaining / 100).toFixed(2)} can still be refunded on this payment.` });
      }
      const refund = await tx.refund.create({
        data: { tenantId: inv.tenantId, paymentId: payment.id, invoiceId, amount: (wanted / 100).toFixed(2), currency: inv.currency, reason: dto.reason, status: 'PROCESSING', requestedById: user.id, approvedById: user.id },
        select: { id: true },
      });
      return { inv, payment, refundId: refund.id, wanted };
    });

    // The provider call happens outside any transaction.
    let result: { ok: boolean; providerRefundId: string | null; failureReason: string | null };
    try {
      result = await this.gateway.refund({ providerPaymentId: started.payment.providerPaymentId, amountPaise: started.wanted, currency: started.inv.currency, idempotencyKey: started.refundId });
    } catch (e) {
      await this.db.refund.update({ where: { id: started.refundId }, data: { status: 'FAILED' } });
      throw e;
    }

    await this.db.$transaction(async (tx) => {
      if (!result.ok) {
        await tx.refund.update({ where: { id: started.refundId }, data: { status: 'FAILED' } });
        await this.audit.record({ action: 'refund.failed', actorId: user.id, tenantId: started.inv.tenantId, entityType: 'invoice', entityId: invoiceId, metadata: { reason: result.failureReason }, meta }, tx);
        return;
      }
      await tx.refund.update({ where: { id: started.refundId }, data: { status: 'SUCCEEDED', providerRefundId: result.providerRefundId } });
      const refunded = await tx.refund.aggregate({ where: { paymentId: started.payment.id, status: 'SUCCEEDED' }, _sum: { amount: true } });
      const fully = toPaise(refunded._sum.amount ?? 0) >= toPaise(started.payment.amount);
      await tx.payment.update({ where: { id: started.payment.id }, data: { status: fully ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
      if (fully) await tx.invoice.update({ where: { id: invoiceId }, data: { status: 'REFUNDED' } });

      let cancelled = false;
      if (fully && dto.cancelService) {
        const sub = await tx.subscription.findFirst({ where: { invoices: { some: { id: invoiceId } }, status: { in: ['ACTIVE', 'PAST_DUE', 'PENDING'] } }, select: { id: true, status: true } });
        if (sub) {
          await tx.subscription.update({ where: { id: sub.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), autoRenew: false } });
          await tx.subscriptionHistory.create({ data: { tenantId: started.inv.tenantId, subscriptionId: sub.id, event: 'CANCELLED', fromStatus: sub.status, toStatus: 'CANCELLED', actorUserId: user.id, details: { reason: 'refunded', invoice: started.inv.number } } });
          // Phase 6 listens for this to suspend the hosting.
          await tx.outboxEvent.createMany({ data: { tenantId: started.inv.tenantId, type: 'subscription.cancelled', aggregateType: 'subscription', aggregateId: sub.id, payload: { subscriptionId: sub.id, reason: 'refunded' } } });
          cancelled = true;
        }
      }

      const owners = await tx.tenantMembership.findMany({ where: { tenantId: started.inv.tenantId, status: 'ACTIVE', role: { key: 'TENANT_OWNER' } }, select: { userId: true } });
      if (owners.length) {
        await tx.notification.createMany({
          data: owners.map((o) => ({ userId: o.userId, tenantId: started.inv.tenantId, type: 'refund.issued', title: `Refund issued for ${started.inv.number}`, body: `${started.inv.currency} ${(started.wanted / 100).toFixed(2)} was refunded.`, link: `/invoices/${invoiceId}` })),
        });
      }
      await this.audit.record(
        { action: 'refund.issue', actorId: user.id, tenantId: started.inv.tenantId, entityType: 'invoice', entityId: invoiceId, metadata: { amount: (started.wanted / 100).toFixed(2), reason: dto.reason, full: fully, serviceCancelled: cancelled }, meta },
        tx,
      );
    });

    if (!result.ok) throw new ConflictException({ code: 'REFUND_FAILED', message: result.failureReason ?? 'The payment provider did not accept the refund.' });
    return this.getInvoice(invoiceId);
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
