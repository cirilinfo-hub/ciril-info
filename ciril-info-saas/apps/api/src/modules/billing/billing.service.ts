import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { PlatformPrisma, type Tx, TenantPrisma } from '../../database/prisma-clients.js';
import type { BillingCycle, InvoiceStatus, Prisma, SubscriptionStatus } from '../../generated/prisma/client.js';
import { orderBy, page, skipTake } from '../../common/http/pagination.js';
import type { RequestMeta, TenantContext } from '../auth/auth.types.js';
import { type PricedLine, addCycle, computeTotals, couponDiscountPaise, toPaise } from './billing.logic.js';
import { couponDuration, couponProblem, renewalsCovered } from './coupons.js';
import type { BillingListQuery, PayInvoiceDto, QuoteDto } from './billing.dto.js';
import { PaymentGateway } from './payment-gateway.js';
import { PaymentSettlementService } from './payment-settlement.service.js';
import { AutoPayService } from './autopay.service.js';
import { SavedCardsService } from './saved-cards.service.js';
import { settleInvoicePayment } from './settlement.js';
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
    private readonly settlement: PaymentSettlementService,
    private readonly cards: SavedCardsService,
    private readonly autopay: AutoPayService,
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

    // The coupon (if any) discounts the plan's first-term price, never the setup fee.
    const pricePaise = toPaise(version.price);
    let coupon: { id: string; code: string; discountPaise: number; renewals: number | null } | null = null;
    if (dto.couponCode) {
      const row = await this.platform.coupon.findUnique({ where: { code: dto.couponCode } });
      const problem = row ? couponProblem({ ...row, discountType: row.discountType }, { planId: plan.id, currency: version.currency, now }) : 'This code is not valid.';
      if (problem || !row) throw new ConflictException({ code: 'COUPON_INVALID', message: problem ?? 'This code is not valid.' });
      // renewals: how many renewals after the first term it also discounts (0: none, null: every one).
      coupon = { id: row.id, code: row.code, discountPaise: couponDiscountPaise(row.discountType, row.discountValue, pricePaise), renewals: renewalsCovered(couponDuration(row)) };
    }
    const lines: PricedLine[] = [{ description: `${plan.product.name} - ${plan.name} (${dto.billingCycle.toLowerCase().replace('_', ' ')})`, unitPaise: pricePaise, quantity: 1, discountPaise: coupon?.discountPaise ?? 0 }];
    if (toPaise(version.setupFee) > 0) lines.push({ description: `${plan.name} setup fee`, unitPaise: toPaise(version.setupFee), quantity: 1 });
    return { plan, version, tax, coupon, totals: computeTotals(lines, taxPercent), currency: version.currency };
  }

  quote(ctx: TenantContext, dto: QuoteDto) {
    return this.db.run(ctx, async (tx) => {
      const p = await this.price(tx, dto);
      return {
        planId: p.plan.id, planName: p.plan.name, billingCycle: dto.billingCycle, currency: p.currency, taxName: p.tax?.name ?? null, couponCode: p.coupon?.code ?? null,
        /** How many renewals the coupon also discounts: 0 for the first term only, a number, or null for every renewal. */
        couponRenewals: p.coupon ? p.coupon.renewals : 0,
        ...p.totals,
      };
    });
  }

  async order(ctx: TenantContext, dto: QuoteDto, meta: RequestMeta) {
    const seller = await readSeller(this.platform);
    let reservedCoupon: string | null = null;
    try {
      return await this.placeOrder(ctx, dto, meta, seller, (id) => (reservedCoupon = id));
    } catch (e) {
      // The order did not commit, so give the coupon use back.
      if (reservedCoupon) await this.platform.coupon.updateMany({ where: { id: reservedCoupon, redemptions: { gt: 0 } }, data: { redemptions: { decrement: 1 } } });
      throw e;
    }
  }

  private placeOrder(ctx: TenantContext, dto: QuoteDto, meta: RequestMeta, seller: Prisma.InputJsonObject, onReserve: (couponId: string) => void) {
    return this.db.run(ctx, async (tx) => {
      const account = await tx.customerAccount.findUnique({ where: { tenantId: ctx.tenantId } });
      if (!account) throw new ConflictException({ code: 'NO_BILLING_PROFILE', message: 'Complete your billing details before ordering.' });

      const p = await this.price(tx, dto);
      const address = await tx.customerAddress.findFirst({ where: { tenantId: ctx.tenantId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
      // A tax invoice needs the buyer's address (place of supply), so ordering requires one.
      if (!address) throw new ConflictException({ code: 'NO_BILLING_ADDRESS', message: 'Add a billing address in Organisation settings before ordering.' });
      const now = new Date();

      // Reserve the coupon use atomically: two customers racing for the last redemption cannot both win.
      if (p.coupon) {
        const r = await this.platform.coupon.updateMany({
          where: { id: p.coupon.id, isActive: true, OR: [{ maxRedemptions: null }, { redemptions: { lt: this.platform.coupon.fields.maxRedemptions } }] },
          data: { redemptions: { increment: 1 } },
        });
        if (r.count === 0) throw new ConflictException({ code: 'COUPON_INVALID', message: 'This code has already been used the maximum number of times.' });
        onReserve(p.coupon.id);
      }
      const number = await nextInvoiceNumber(tx, now);

      const subscription = await tx.subscription.create({
        data: {
          tenantId: ctx.tenantId, status: 'PENDING', billingCycle: dto.billingCycle, currency: p.currency,
          // A recurring coupon is remembered so each renewal it covers is discounted too.
          ...(p.coupon && p.coupon.renewals !== 0 ? { couponId: p.coupon.id, couponPeriodsLeft: p.coupon.renewals } : {}),
          items: { create: { tenantId: ctx.tenantId, planId: p.plan.id, pricingVersionId: p.version.id, description: p.totals.lines[0]!.description, unitPrice: p.version.price, renewalPrice: p.version.renewalPrice } },
          history: { create: { tenantId: ctx.tenantId, event: 'CREATED', toStatus: 'PENDING', actorUserId: ctx.userId } },
        },
        select: { id: true },
      });

      const invoice = await tx.invoice.create({
        data: {
          tenantId: ctx.tenantId, subscriptionId: subscription.id, number, status: 'ISSUED', currency: p.currency,
          subtotal: p.totals.subtotal, discountTotal: p.totals.discountTotal, taxTotal: p.totals.taxTotal, total: p.totals.total, issuedAt: now,
          dueAt: new Date(now.getTime() + DUE_DAYS * 86_400_000),
          billingSnapshot: {
            seller,
            buyer: {
              accountNo: account.accountNo, name: account.companyName, email: account.billingEmail, gstin: account.gstin,
              address: { line1: address.line1, line2: address.line2, city: address.city, state: address.state, stateCode: address.stateCode, postalCode: address.postalCode, country: address.country },
            },
            tax: p.tax ? { name: p.tax.name, code: p.tax.code, rate: p.tax.rate.toString() } : null,
            coupon: p.coupon ? { code: p.coupon.code, discount: p.totals.discountTotal, renewals: p.coupon.renewals } : null,
          },
          items: {
            create: p.totals.lines.map((l) => ({
              tenantId: ctx.tenantId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, taxRate: l.taxRate,
              taxAmount: l.taxAmount, lineTotal: l.lineTotal,
            })),
          },
        },
        select: invoiceSelect,
      });

      await tx.auditLog.create({
        data: { action: 'order.create', actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'invoice', entityId: invoice.id, metadata: { planId: p.plan.id, billingCycle: dto.billingCycle, total: p.totals.total, coupon: p.coupon?.code ?? null }, ipAddress: meta.ip ?? null, requestId: meta.requestId },
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
          ...invoiceSelect, billingSnapshot: true, autoChargeAttempts: true,
          items: { select: { id: true, description: true, quantity: true, unitPrice: true, taxRate: true, taxAmount: true, lineTotal: true } },
          payments: { select: { id: true, provider: true, status: true, amount: true, method: true, failureReason: true, createdAt: true }, orderBy: { createdAt: 'desc' } },
          refunds: { where: { status: 'SUCCEEDED' }, select: { id: true, amount: true, reason: true, createdAt: true, creditNote: { select: { id: true, number: true } } }, orderBy: { createdAt: 'desc' } },
          tdsDeduction: { select: { amount: true, section: true, certificateAt: true } },
        },
      });
      if (!invoice) throw new NotFoundException({ code: 'INVOICE_NOT_FOUND', message: 'Invoice not found.' });
      const { autoChargeAttempts, ...rest } = invoice;
      const planned = await this.autopay.plannedCharge(ctx.tenantId, invoice);
      const live = this.cards.available ? await tx.savedCard.findFirst({ where: { status: { in: ['PENDING', 'ACTIVE'] } }, select: { id: true } }) : null;
      return {
        ...rest, testMode: this.gateway.isMock,
        /** Whether a card can be saved when paying, whether one is already saved, and when this invoice will be charged to it. */
        cards: { available: this.cards.available, saved: Boolean(live), autoPay: planned ? { card: planned.card, on: planned.on.toISOString() } : null },
      };
    });
  }

  /** One of this organisation's credit notes, with everything needed to print it. */
  getCreditNote(ctx: TenantContext, id: string) {
    return this.db.run(ctx, async (tx) => {
      const c = await tx.creditNote.findUnique({
        where: { id },
        select: { id: true, number: true, currency: true, subtotal: true, taxTotal: true, total: true, reason: true, snapshot: true, issuedAt: true, invoice: { select: { id: true, number: true } } },
      });
      if (!c) throw new NotFoundException({ code: 'CREDIT_NOTE_NOT_FOUND', message: 'Credit note not found.' });
      return c;
    });
  }

  /** Charge an unpaid invoice. A repeated idempotency key returns the first result and never charges twice. */
  async pay(ctx: TenantContext, id: string, dto: PayInvoiceDto, meta: RequestMeta) {
    if (dto.simulate && this.production) throw new BadRequestException({ code: 'TEST_ONLY', message: 'Simulation is not available.' });
    const saveCard = dto.saveCard === true;
    if (saveCard && !this.cards.available) throw new ConflictException({ code: 'CARDS_NOT_AVAILABLE', message: 'Cards cannot be saved at the moment. Pay without saving it.' });
    // The provider's customer record is made before the invoice is locked, so no provider call happens under that lock.
    const customerId = saveCard ? await this.cards.customerId(ctx.tenantId) : null;
    const r = await this.charge(ctx, id, dto, meta, customerId);
    // Test mode settles at once: keep the card now. A real provider's checkout keeps it when its payment is settled.
    if (saveCard && r.status === 'SUCCEEDED' && this.gateway.mode === 'instant') await this.cards.adopt(r.paymentId, ctx.userId);
    return r;
  }

  private charge(ctx: TenantContext, id: string, dto: PayInvoiceDto, meta: RequestMeta, customerId: string | null) {
    const key = dto.idempotencyKey ?? `pay:${id}:${randomUUID()}`;
    return this.db.run(ctx, async (tx) => {
      const prior = await tx.payment.findUnique({ where: { idempotencyKey: key }, select: { id: true, invoiceId: true, status: true, failureReason: true } });
      if (prior) {
        if (prior.invoiceId !== id) throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'This key was used for a different invoice.' });
        return { paymentId: prior.id, status: prior.status, failureReason: prior.failureReason, invoice: await tx.invoice.findUniqueOrThrow({ where: { id }, select: invoiceSelect }) };
      }

      // Lock the invoice row so two simultaneous requests cannot both charge it.
      await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${id}::uuid FOR UPDATE`;
      const invoice = await tx.invoice.findUnique({ where: { id }, select: { ...invoiceSelect, billingSnapshot: true, subscription: { select: { id: true, status: true, billingCycle: true, currentPeriodEnd: true } } } });
      if (!invoice) throw new NotFoundException({ code: 'INVOICE_NOT_FOUND', message: 'Invoice not found.' });
      if (!UNPAID.includes(invoice.status)) {
        throw new ConflictException({ code: 'INVOICE_NOT_PAYABLE', message: invoice.status === 'PAID' ? 'This invoice is already paid.' : 'This invoice cannot be paid.' });
      }

      const outstanding = toPaise(invoice.total.toString()) - toPaise(invoice.amountPaid.toString());
      if (this.gateway.mode === 'hosted') return this.startCheckout(tx, ctx, invoice, outstanding, customerId);
      const result = await this.gateway.charge({ amountPaise: outstanding, currency: invoice.currency, invoiceNumber: invoice.number, idempotencyKey: key, simulate: dto.simulate });

      const payment = await tx.payment.create({
        data: {
          tenantId: ctx.tenantId, invoiceId: id, provider: result.provider, status: result.ok ? 'PENDING' : 'FAILED', amount: (outstanding / 100).toFixed(2),
          currency: invoice.currency, providerOrderId: result.providerOrderId, providerPaymentId: result.providerPaymentId, method: result.method,
          failureReason: result.failureReason, idempotencyKey: key, savesCard: customerId !== null,
        },
        select: { id: true },
      });

      if (!result.ok) {
        await tx.auditLog.create({ data: { action: 'payment.failed', actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'invoice', entityId: id, metadata: { reason: result.failureReason } as Prisma.InputJsonValue, ipAddress: meta.ip ?? null, requestId: meta.requestId } });
      } else {
        await settleInvoicePayment(tx, { tenantId: ctx.tenantId, invoiceId: id, paymentId: payment.id, actorUserId: ctx.userId, now: new Date(), providerPaymentId: result.providerPaymentId, method: result.method, via: 'test-mode' });
      }
      return { paymentId: payment.id, status: result.ok ? 'SUCCEEDED' : 'FAILED', failureReason: result.failureReason, invoice: await tx.invoice.findUniqueOrThrow({ where: { id }, select: invoiceSelect }) };
    });
  }

  /**
   * Hosted providers (Razorpay): create the provider's order and hand the browser what it needs to open checkout.
   * An order opened in the last 30 minutes for the same amount is reused, so a double click or a closed modal does not
   * pile up orders. Nothing is recorded as paid here: that only happens after a signed confirmation.
   */
  private async startCheckout(tx: Tx, ctx: TenantContext, invoice: { id: string; number: string; currency: string }, outstanding: number, customerId: string | null) {
    const amount = (outstanding / 100).toFixed(2);
    // Saving the card makes it a card-only checkout tied to the provider's customer record.
    const saveCard = customerId ? { customerId, maxAmountPaise: this.gateway.autopayMaxPaise } : undefined;
    const open = await tx.payment.findFirst({
      where: { invoiceId: invoice.id, provider: this.gateway.id, status: { in: ['CREATED', 'PENDING'] }, amount, savesCard: Boolean(saveCard), savedCardId: null, createdAt: { gt: new Date(Date.now() - 30 * 60_000) }, providerOrderId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, providerOrderId: true },
    });
    const account = await tx.customerAccount.findUnique({ where: { tenantId: ctx.tenantId }, select: { billingEmail: true } });

    let paymentId: string;
    let base: Record<string, string | number>;
    if (open?.providerOrderId) {
      paymentId = open.id;
      base = this.gateway.checkoutParams(open.providerOrderId, saveCard);
    } else {
      const key = `ord:${invoice.id}:${randomUUID()}`;
      const order = await this.gateway.createOrder({ amountPaise: outstanding, currency: invoice.currency, receipt: invoice.number, idempotencyKey: key, notes: { invoiceId: invoice.id, invoiceNumber: invoice.number, tenantId: ctx.tenantId }, saveCard });
      const created = await tx.payment.create({
        data: { tenantId: ctx.tenantId, invoiceId: invoice.id, provider: this.gateway.id, status: 'CREATED', amount, currency: invoice.currency, providerOrderId: order.providerOrderId, idempotencyKey: key, savesCard: Boolean(saveCard) },
        select: { id: true },
      });
      paymentId = created.id;
      base = order.checkout;
    }
    return {
      action: 'CHECKOUT' as const, paymentId, provider: this.gateway.id, status: 'CREATED', failureReason: null,
      checkout: { ...base, amountPaise: outstanding, currency: invoice.currency, description: `Invoice ${invoice.number}`, name: 'Ciril Info', ...(account?.billingEmail ? { prefillEmail: account.billingEmail } : {}) },
      invoice: await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id }, select: invoiceSelect }),
    };
  }

  /**
   * The browser says the customer paid. The signature proves Razorpay produced it; we then ask Razorpay for the payment
   * itself (never trusting the browser for amount or status), capture it if it was only authorised, and settle. If
   * Razorpay still shows it in progress the answer is "pending" and the webhook finishes the job.
   */
  async confirmPayment(ctx: TenantContext, id: string, dto: { providerOrderId: string; providerPaymentId: string; signature: string }, meta: RequestMeta) {
    const payment = await this.db.run(ctx, (tx) =>
      tx.payment.findFirst({ where: { invoiceId: id, provider: this.gateway.id, providerOrderId: dto.providerOrderId }, select: { id: true, status: true, amount: true, currency: true } }),
    );
    if (!payment) throw new NotFoundException({ code: 'PAYMENT_NOT_FOUND', message: 'We could not find this payment.' });

    if (!this.gateway.verifyCheckout(dto)) {
      await this.db.run(ctx, (tx) => tx.auditLog.create({ data: { action: 'payment.signature_invalid', actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'invoice', entityId: id, ipAddress: meta.ip ?? null, requestId: meta.requestId } }));
      throw new BadRequestException({ code: 'INVALID_SIGNATURE', message: 'This payment could not be verified.' });
    }

    let fact = await this.gateway.fetchPayment(dto.providerPaymentId);
    if (fact.providerOrderId !== dto.providerOrderId) throw new BadRequestException({ code: 'INVALID_SIGNATURE', message: 'This payment could not be verified.' });
    if (fact.status === 'authorized') fact = await this.gateway.capture(dto.providerPaymentId, fact.amountPaise, fact.currency);

    const outcome = await this.settlement.apply(
      payment.id,
      { status: fact.status === 'captured' ? 'captured' : fact.status === 'failed' ? 'failed' : 'created', providerPaymentId: fact.providerPaymentId, providerOrderId: fact.providerOrderId, amountPaise: fact.amountPaise, currency: fact.currency, method: fact.method, failureReason: fact.failureReason },
      'checkout',
      ctx.userId,
    );
    if (outcome === 'MISMATCH' || outcome === 'ORPHANED') {
      throw new ConflictException({ code: 'PAYMENT_NEEDS_REVIEW', message: 'We received your payment but could not match it to this invoice automatically. Our team has been told and will sort it out.' });
    }
    const status = outcome === 'SETTLED' || outcome === 'ALREADY_SETTLED' ? 'SUCCEEDED' : outcome === 'FAILED' ? 'FAILED' : 'PENDING';
    return this.db.run(ctx, async (tx) => ({
      paymentId: payment.id, status, failureReason: status === 'FAILED' ? fact.failureReason : null,
      invoice: await tx.invoice.findUniqueOrThrow({ where: { id }, select: invoiceSelect }),
    }));
  }

  // ─── Subscriptions ───

  listSubscriptions(ctx: TenantContext, q: BillingListQuery) {
    return this.db.run(ctx, async (tx) => {
      const where: Prisma.SubscriptionWhereInput = q.status ? { status: q.status as SubscriptionStatus } : {};
      const [rows, total] = await Promise.all([
        tx.subscription.findMany({
          where, orderBy: { createdAt: 'desc' }, ...skipTake(q),
          select: {
            id: true, status: true, billingCycle: true, currency: true, currentPeriodStart: true, currentPeriodEnd: true, autoRenew: true, cancelAtPeriodEnd: true, createdAt: true, scheduledAt: true,
            scheduledPlan: { select: { id: true, name: true } }, items: { select: { description: true, unitPrice: true, renewalPrice: true } },
            couponPeriodsLeft: true, coupon: { select: { code: true, discountType: true, discountValue: true } },
          },
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
