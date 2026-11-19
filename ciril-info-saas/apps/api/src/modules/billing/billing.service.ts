import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { PlatformPrisma, type Tx, TenantPrisma } from '../../database/prisma-clients.js';
import type { BillingCycle, InvoiceStatus, Prisma, SubscriptionStatus } from '../../generated/prisma/client.js';
import { orderBy, page, skipTake } from '../../common/http/pagination.js';
import type { RequestMeta, TenantContext } from '../auth/auth.types.js';
import { addCycle, computeTotals, toPaise } from './billing.logic.js';
import type { BillingListQuery, PayInvoiceDto, QuoteDto } from './billing.dto.js';
import { PaymentGateway } from './payment-gateway.js';
import { nextInvoiceNumber } from './numbering.js';
import { readSeller } from './seller.js';

const DUE_DAYS = 7;
const UNPAID: InvoiceStatus[] = ['ISSUED', 'OVERDUE', 'PARTIALLY_PAID'];

const invoiceSelect = {
  id: true, number: true, status: true, currency: true, subtotal: true, discountTotal: true, taxTotal: true, total: true,
  amountPaid: true, issuedAt: true, dueAt: true, paidAt: true, subscriptionId: true,
} satisfies Prisma.InvoiceSelect;

/** Customer-portal commerce: quote, order, invoices, payment and cancellation. All queries are RLS-scoped. */
@Injectable()
export class BillingService {
  private readonly production: boolean;

  constructor(
    private readonly db: TenantPrisma,
    private readonly platform: PlatformPrisma,
    private readonly gateway: PaymentGateway,
    config: ConfigService<Env, true>,
  ) {
    this.production = config.get('NODE_ENV', { infer: true }) === 'production';
  }

  /** Plan + current price + configured tax, or a precise client error. */
  private async price(tx: Tx, dto: QuoteDto) {
    const [productSlug, planSlug] = dto.planRef?.split('/') ?? [];
    const plan = await tx.plan.findFirst({
      where: {
        status: 'PUBLISHED',
        ...(dto.planId ? { id: dto.planId } : { slug: planSlug }),
        product: { status: 'PUBLISHED', ...(dto.planId ? {} : { slug: productSlug }) },
      },
      select: { id: true, name: true, isSample: true, product: { select: { name: true } } },
    });
    if (!plan || (plan.isSample && this.production)) {
      throw new NotFoundException({ code: 'PLAN_NOT_FOUND', message: 'This plan is not available.' });
    }

    const now = new Date();
    const version = await tx.pricingVersion.findFirst({
      where: { planId: plan.id, billingCycle: dto.billingCycle, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!version) throw new ConflictException({ code: 'NO_PRICE', message: 'This plan is not sold for the selected billing period.' });

    // Tax comes only from rates configured in the admin portal. None configured means no tax is added.
    const tax = await tx.taxRate.findFirst({ where: { isActive: true, isDefault: true, country: 'IN' }, orderBy: { createdAt: 'desc' } });
    const taxPercent = tax ? Number(tax.rate.toString()) : 0;

    const lines = [{ description: `${plan.product.name} - ${plan.name} (${dto.billingCycle.toLowerCase().replace('_', ' ')})`, unitPaise: toPaise(version.price), quantity: 1 }];
    if (toPaise(version.setupFee) > 0) lines.push({ description: `${plan.name} setup fee`, unitPaise: toPaise(version.setupFee), quantity: 1 });
    return { plan, version, tax, totals: computeTotals(lines, taxPercent), currency: version.currency };
  }

  quote(ctx: TenantContext, dto: QuoteDto) {
    return this.db.run(ctx, async (tx) => {
      const p = await this.price(tx, dto);
      return { planId: p.plan.id, planName: p.plan.name, billingCycle: dto.billingCycle, currency: p.currency, taxName: p.tax?.name ?? null, ...p.totals };
    });
  }

  async order(ctx: TenantContext, dto: QuoteDto, meta: RequestMeta) {
    const seller = await readSeller(this.platform);
    return this.db.run(ctx, async (tx) => {
      const account = await tx.customerAccount.findUnique({ where: { tenantId: ctx.tenantId } });
      if (!account) throw new ConflictException({ code: 'NO_BILLING_PROFILE', message: 'Complete your billing details before ordering.' });

      const p = await this.price(tx, dto);
      const address = await tx.customerAddress.findFirst({ where: { tenantId: ctx.tenantId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
      // A tax invoice needs the buyer's address (place of supply), so ordering requires one.
      if (!address) throw new ConflictException({ code: 'NO_BILLING_ADDRESS', message: 'Add a billing address in Organisation settings before ordering.' });
      const now = new Date();
      const number = await nextInvoiceNumber(tx, now);

      const subscription = await tx.subscription.create({
        data: {
          tenantId: ctx.tenantId, status: 'PENDING', billingCycle: dto.billingCycle, currency: p.currency,
          items: { create: { tenantId: ctx.tenantId, planId: p.plan.id, pricingVersionId: p.version.id, description: p.totals.lines[0]!.description, unitPrice: p.version.price, renewalPrice: p.version.renewalPrice } },
          history: { create: { tenantId: ctx.tenantId, event: 'CREATED', toStatus: 'PENDING', actorUserId: ctx.userId } },
        },
        select: { id: true },
      });

      const invoice = await tx.invoice.create({
        data: {
          tenantId: ctx.tenantId, subscriptionId: subscription.id, number, status: 'ISSUED', currency: p.currency,
          subtotal: p.totals.subtotal, taxTotal: p.totals.taxTotal, total: p.totals.total, issuedAt: now,
          dueAt: new Date(now.getTime() + DUE_DAYS * 86_400_000),
          billingSnapshot: {
            seller,
            buyer: {
              accountNo: account.accountNo, name: account.companyName, email: account.billingEmail, gstin: account.gstin,
              address: { line1: address.line1, line2: address.line2, city: address.city, state: address.state, stateCode: address.stateCode, postalCode: address.postalCode, country: address.country },
            },
            tax: p.tax ? { name: p.tax.name, code: p.tax.code, rate: p.tax.rate.toString() } : null,
          },
          items: {
            create: p.totals.lines.map((l) => ({
              tenantId: ctx.tenantId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate,
              taxAmount: l.taxAmount, lineTotal: l.lineTotal,
            })),
          },
        },
        select: invoiceSelect,
      });

      await tx.auditLog.create({
        data: { action: 'order.create', actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'invoice', entityId: invoice.id, metadata: { planId: p.plan.id, billingCycle: dto.billingCycle, total: p.totals.total }, ipAddress: meta.ip ?? null, requestId: meta.requestId },
      });
      return { subscriptionId: subscription.id, invoice };
    });
  }

  // ─── Invoices ───

  listInvoices(ctx: TenantContext, q: BillingListQuery) {
    return this.db.run(ctx, async (tx) => {
      const where: Prisma.InvoiceWhereInput = {
        ...(q.status ? { status: q.status as InvoiceStatus } : {}),
        ...(q.search ? { number: { contains: q.search, mode: 'insensitive' } } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.invoice.findMany({
          where, select: invoiceSelect, ...skipTake(q),
          orderBy: orderBy<Prisma.InvoiceOrderByWithRelationInput>(q.sort, { createdAt: (d) => ({ createdAt: d }), total: (d) => ({ total: d }), dueAt: (d) => ({ dueAt: d }) }, { createdAt: 'desc' }),
        }),
        tx.invoice.count({ where }),
      ]);
      return page(rows, total, q);
    });
  }

  getInvoice(ctx: TenantContext, id: string) {
    return this.db.run(ctx, async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id },
        select: {
          ...invoiceSelect, billingSnapshot: true,
          items: { select: { id: true, description: true, quantity: true, unitPrice: true, taxRate: true, taxAmount: true, lineTotal: true } },
          payments: { select: { id: true, provider: true, status: true, amount: true, method: true, failureReason: true, createdAt: true }, orderBy: { createdAt: 'desc' } },
        },
      });
      if (!invoice) throw new NotFoundException({ code: 'INVOICE_NOT_FOUND', message: 'Invoice not found.' });
      return { ...invoice, testMode: this.gateway.isMock };
    });
  }

  /** Charge an unpaid invoice. A repeated idempotency key returns the first result and never charges twice. */
  pay(ctx: TenantContext, id: string, dto: PayInvoiceDto, meta: RequestMeta) {
    if (dto.simulate && this.production) throw new BadRequestException({ code: 'TEST_ONLY', message: 'Simulation is not available.' });
    const key = dto.idempotencyKey ?? `pay:${id}:${randomUUID()}`;
    return this.db.run(ctx, async (tx) => {
      const prior = await tx.payment.findUnique({ where: { idempotencyKey: key }, select: { id: true, invoiceId: true, status: true, failureReason: true } });
      if (prior) {
        if (prior.invoiceId !== id) throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'This key was used for a different invoice.' });
        return { paymentId: prior.id, status: prior.status, failureReason: prior.failureReason, invoice: await tx.invoice.findUniqueOrThrow({ where: { id }, select: invoiceSelect }) };
      }

      // Lock the invoice row so two simultaneous requests cannot both charge it.
      await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${id}::uuid FOR UPDATE`;
      const invoice = await tx.invoice.findUnique({ where: { id }, select: { ...invoiceSelect, subscription: { select: { id: true, status: true, billingCycle: true, currentPeriodEnd: true } } } });
      if (!invoice) throw new NotFoundException({ code: 'INVOICE_NOT_FOUND', message: 'Invoice not found.' });
      if (!UNPAID.includes(invoice.status)) {
        throw new ConflictException({ code: 'INVOICE_NOT_PAYABLE', message: invoice.status === 'PAID' ? 'This invoice is already paid.' : 'This invoice cannot be paid.' });
      }

      const outstanding = toPaise(invoice.total.toString()) - toPaise(invoice.amountPaid.toString());
      const result = await this.gateway.charge({ amountPaise: outstanding, currency: invoice.currency, invoiceNumber: invoice.number, idempotencyKey: key, simulate: dto.simulate });

      const payment = await tx.payment.create({
        data: {
          tenantId: ctx.tenantId, invoiceId: id, provider: result.provider, status: result.ok ? 'SUCCEEDED' : 'FAILED', amount: (outstanding / 100).toFixed(2),
          currency: invoice.currency, providerOrderId: result.providerOrderId, providerPaymentId: result.providerPaymentId, method: result.method,
          failureReason: result.failureReason, idempotencyKey: key, verifiedAt: result.ok ? new Date() : null,
        },
        select: { id: true, status: true, failureReason: true },
      });

      const audit = (action: string, metadata: Record<string, unknown>) =>
        tx.auditLog.create({ data: { action, actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'invoice', entityId: id, metadata: metadata as Prisma.InputJsonValue, ipAddress: meta.ip ?? null, requestId: meta.requestId } });

      if (!result.ok) {
        await audit('payment.failed', { reason: result.failureReason });
      } else {
        const paidAt = new Date();
        await tx.invoice.update({ where: { id }, data: { status: 'PAID', amountPaid: invoice.total, paidAt } });
        if (invoice.subscription) await this.activate(tx, ctx, invoice.subscription, paidAt);
        await audit('payment.succeeded', { paymentId: payment.id, provider: result.provider });
        await tx.notification.createMany({
          data: { userId: ctx.userId, tenantId: ctx.tenantId, type: 'payment.succeeded', title: `Payment received for ${invoice.number}`, body: 'Your service is being set up.', link: `/invoices/${id}` },
        });
      }
      return { paymentId: payment.id, status: payment.status, failureReason: payment.failureReason, invoice: await tx.invoice.findUniqueOrThrow({ where: { id }, select: invoiceSelect }) };
    });
  }

  /** First payment activates the subscription; a later one renews it from the end of the paid period. */
  private async activate(tx: Tx, ctx: TenantContext, sub: { id: string; status: SubscriptionStatus; billingCycle: BillingCycle; currentPeriodEnd: Date | null }, at: Date) {
    const renewing = (sub.status === 'ACTIVE' || sub.status === 'PAST_DUE') && sub.currentPeriodEnd !== null;
    const start = renewing ? sub.currentPeriodEnd! : at;
    await tx.subscription.update({
      where: { id: sub.id },
      data: { status: 'ACTIVE', currentPeriodStart: start, currentPeriodEnd: addCycle(start, sub.billingCycle) },
    });
    await tx.subscriptionHistory.create({
      data: { tenantId: ctx.tenantId, subscriptionId: sub.id, event: renewing ? 'RENEWED' : 'ACTIVATED', fromStatus: sub.status, toStatus: 'ACTIVE', actorUserId: ctx.userId },
    });
    // Provisioning is a Phase 6 worker concern; it will read this event.
    await tx.outboxEvent.createMany({ data: { tenantId: ctx.tenantId, type: 'subscription.activated', aggregateType: 'subscription', aggregateId: sub.id, payload: { subscriptionId: sub.id, renewal: renewing } } });
  }

  // ─── Subscriptions ───

  listSubscriptions(ctx: TenantContext, q: BillingListQuery) {
    return this.db.run(ctx, async (tx) => {
      const where: Prisma.SubscriptionWhereInput = q.status ? { status: q.status as SubscriptionStatus } : {};
      const [rows, total] = await Promise.all([
        tx.subscription.findMany({
          where, orderBy: { createdAt: 'desc' }, ...skipTake(q),
          select: { id: true, status: true, billingCycle: true, currency: true, currentPeriodStart: true, currentPeriodEnd: true, autoRenew: true, cancelAtPeriodEnd: true, createdAt: true, items: { select: { description: true, unitPrice: true, renewalPrice: true } } },
        }),
        tx.subscription.count({ where }),
      ]);
      return page(rows, total, q);
    });
  }

  /** An unpaid subscription is cancelled at once (and its invoice voided); an active one ends at period end. */
  cancel(ctx: TenantContext, id: string, reason: string | undefined, meta: RequestMeta) {
    return this.db.run(ctx, async (tx) => {
      const sub = await tx.subscription.findUnique({ where: { id }, select: { id: true, status: true } });
      if (!sub) throw new NotFoundException({ code: 'SUBSCRIPTION_NOT_FOUND', message: 'Subscription not found.' });
      const details = { reason: reason ?? null };
      if (sub.status === 'PENDING') {
        await tx.subscription.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), autoRenew: false } });
        await tx.invoice.updateMany({ where: { subscriptionId: id, status: { in: UNPAID } }, data: { status: 'VOID', voidedAt: new Date() } });
        await tx.subscriptionHistory.create({ data: { tenantId: ctx.tenantId, subscriptionId: id, event: 'CANCELLED', fromStatus: 'PENDING', toStatus: 'CANCELLED', actorUserId: ctx.userId, details } });
      } else if (sub.status === 'ACTIVE') {
        await tx.subscription.update({ where: { id }, data: { cancelAtPeriodEnd: true, autoRenew: false } });
        await tx.subscriptionHistory.create({ data: { tenantId: ctx.tenantId, subscriptionId: id, event: 'CANCEL_REQUESTED', fromStatus: 'ACTIVE', toStatus: 'ACTIVE', actorUserId: ctx.userId, details } });
      } else {
        throw new ConflictException({ code: 'SUBSCRIPTION_NOT_CANCELLABLE', message: 'This subscription cannot be cancelled.' });
      }
      await tx.auditLog.create({ data: { action: 'subscription.cancel', actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'subscription', entityId: id, ipAddress: meta.ip ?? null, requestId: meta.requestId } });
      return tx.subscription.findUniqueOrThrow({ where: { id }, select: { id: true, status: true, cancelAtPeriodEnd: true, currentPeriodEnd: true } });
    });
  }
}
