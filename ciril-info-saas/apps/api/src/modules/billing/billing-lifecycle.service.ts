import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { PlatformPrisma, type Tx } from '../../database/prisma-clients.js';
import type { BillingCycle, InvoiceStatus } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { MailService } from '../mail/mail.service.js';
import { PaymentGateway } from './payment-gateway.js';
import { PaymentSettlementService } from './payment-settlement.service.js';
import { computeTotals, toPaise } from './billing.logic.js';
import { nextInvoiceNumber } from './numbering.js';
import { readSeller } from './seller.js';

const DAY = 86_400_000;
const UNPAID: InvoiceStatus[] = ['ISSUED', 'OVERDUE', 'PARTIALLY_PAID'];

export interface LifecycleResult {
  renewalInvoices: number;
  overdue: number;
  pastDue: number;
  expired: number;
  abandoned: number;
  /** Payments settled by asking the provider, because their webhook never arrived. */
  reconciled: number;
  /** Checkouts nobody completed, closed after three days. */
  checkoutsClosed: number;
}

/**
 * The scheduled side of subscriptions. Safe to run as often as you like and from several workers at once:
 * every step is idempotent and each subscription is handled in its own transaction under a row lock.
 *
 *  1. Renewal invoices, issued RENEWAL_LEAD_DAYS before a period ends (once per period).
 *  2. Unpaid invoices past their due date become OVERDUE.
 *  3. A first order still unpaid ABANDONED_ORDER_DAYS after it was placed is cancelled and its invoice voided.
 *  4. A period that ended unpaid becomes PAST_DUE; after PAST_DUE_GRACE_DAYS it EXPIRES and its open invoices are voided.
 *     A subscription the customer cancelled (or that does not auto-renew) simply expires when its period ends.
 * Provisioning (suspending hosting on expiry) listens for the `subscription.expired` event in Phase 6.
 */
@Injectable()
export class BillingLifecycleService {
  private readonly log = new Logger(BillingLifecycleService.name);
  private readonly leadDays: number;
  private readonly graceDays: number;
  private readonly abandonedDays: number;
  private readonly portalUrl: string;

  constructor(
    private readonly db: PlatformPrisma,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly gateway: PaymentGateway,
    private readonly settlement: PaymentSettlementService,
    config: ConfigService<Env, true>,
  ) {
    this.leadDays = config.get('RENEWAL_LEAD_DAYS', { infer: true });
    this.graceDays = config.get('PAST_DUE_GRACE_DAYS', { infer: true });
    this.abandonedDays = config.get('ABANDONED_ORDER_DAYS', { infer: true });
    this.portalUrl = config.get('CUSTOMER_PORTAL_URL', { infer: true }).replace(/\/$/, '');
  }

  async run(now = new Date()): Promise<LifecycleResult> {
    const renewalInvoices = await this.issueRenewals(now);
    const overdue = await this.markOverdue(now);
    const { reconciled, checkoutsClosed } = await this.reconcilePayments(now);
    const abandoned = (await this.cancelAbandonedOrders(now)) + (await this.cancelAbandonedDomainOrders(now));
    const { pastDue, expired } = await this.processPeriodEnds(now);
    const domains = await this.processDomainExpiry(now);
    if (domains.reminded || domains.expired) this.log.log(`domain expiry: ${JSON.stringify(domains)}`);
    if (renewalInvoices || overdue || abandoned || pastDue || expired || reconciled || checkoutsClosed) this.log.log(`billing lifecycle: ${JSON.stringify({ renewalInvoices, overdue, abandoned, pastDue, expired, reconciled, checkoutsClosed })}`);
    return { renewalInvoices, overdue, pastDue, expired, abandoned, reconciled, checkoutsClosed };
  }

  // ───────────────────────────── renewals ─────────────────────────────

  private async issueRenewals(now: Date) {
    const horizon = new Date(now.getTime() + this.leadDays * DAY);
    const candidates = await this.db.subscription.findMany({
      where: {
        status: 'ACTIVE', autoRenew: true, cancelAtPeriodEnd: false, billingCycle: { not: 'ONE_TIME' },
        currentPeriodEnd: { not: null, lte: horizon }, tenant: { status: 'ACTIVE' },
      },
      select: { id: true },
    });
    const seller = candidates.length ? await readSeller(this.db) : {};
    let issued = 0;
    for (const { id } of candidates) {
      try {
        if (await this.renewOne(id, now, seller)) issued++;
      } catch (e) {
        this.log.error(`renewal invoice failed for subscription ${id}: ${(e as Error).message}`);
      }
    }
    return issued;
  }

  private async renewOne(subscriptionId: string, now: Date, seller: object): Promise<boolean> {
    const result = await this.db.$transaction(async (tx) => {
      // Another worker may be on the same subscription: skip it rather than wait.
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM subscriptions WHERE id = ${subscriptionId}::uuid FOR UPDATE SKIP LOCKED`;
      if (!locked.length) return null;
      const sub = await tx.subscription.findUnique({
        where: { id: subscriptionId },
        select: { id: true, tenantId: true, status: true, currency: true, billingCycle: true, scheduledPlanId: true, currentPeriodEnd: true, autoRenew: true, cancelAtPeriodEnd: true, items: { select: { description: true, renewalPrice: true, quantity: true } } },
      });
      if (!sub || sub.status !== 'ACTIVE' || !sub.autoRenew || sub.cancelAtPeriodEnd || !sub.currentPeriodEnd || !sub.items.length) return null;

      // One renewal invoice per period, even if an admin voided it. The period end is the idempotency marker.
      const marker = sub.currentPeriodEnd.toISOString();
      const existing = await tx.invoice.count({ where: { subscriptionId, billingSnapshot: { path: ['renewalFor'], equals: marker } } });
      if (existing) return null;

      const account = await tx.customerAccount.findUnique({ where: { tenantId: sub.tenantId } });
      if (!account) return null;
      const address = await tx.customerAddress.findFirst({ where: { tenantId: sub.tenantId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
      const tax = await tx.taxRate.findFirst({ where: { isActive: true, isDefault: true, country: 'IN' }, orderBy: { createdAt: 'desc' } });
      // A plan change the customer scheduled is priced here. If that plan is no longer sold, the renewal stays on the current plan.
      const change = sub.scheduledPlanId ? await this.scheduledChange(tx, sub.id, sub.scheduledPlanId, sub.billingCycle, now) : null;
      const totals = computeTotals(
        change
          ? [{ description: `${change.description} (renewal)`, unitPaise: toPaise(change.renewalPrice), quantity: 1 }]
          : sub.items.map((i) => ({ description: `${i.description} (renewal)`, unitPaise: toPaise(i.renewalPrice), quantity: i.quantity })),
        tax ? Number(tax.rate.toString()) : 0,
      );
      const number = await nextInvoiceNumber(tx, now);
      const invoice = await tx.invoice.create({
        data: {
          tenantId: sub.tenantId, subscriptionId, number, status: 'ISSUED', currency: sub.currency,
          subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total, issuedAt: now, dueAt: sub.currentPeriodEnd,
          billingSnapshot: {
            renewalFor: marker, seller, ...(change ? { planChange: change } : {}),
            buyer: {
              accountNo: account.accountNo, name: account.companyName, email: account.billingEmail, gstin: account.gstin,
              address: address ? { line1: address.line1, line2: address.line2, city: address.city, state: address.state, stateCode: address.stateCode, postalCode: address.postalCode, country: address.country } : null,
            },
            tax: tax ? { name: tax.name, code: tax.code, rate: tax.rate.toString() } : null,
          },
          items: {
            create: totals.lines.map((l) => ({ tenantId: sub.tenantId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate, taxAmount: l.taxAmount, lineTotal: l.lineTotal })),
          },
        },
        select: { id: true, number: true, total: true, dueAt: true },
      });

      await this.notifyOwners(tx, sub.tenantId, { type: 'invoice.renewal', title: `Renewal invoice ${invoice.number}`, body: `Due ${invoice.dueAt!.toISOString().slice(0, 10)}`, link: `/invoices/${invoice.id}` });
      await this.mail.enqueue(
        { template: 'renewal-invoice', to: account.billingEmail, data: { number: invoice.number, total: `${sub.currency} ${invoice.total.toString()}`, dueDate: invoice.dueAt!.toISOString().slice(0, 10), link: `${this.portalUrl}/invoices/${invoice.id}` } },
        tx, sub.tenantId,
      );
      await this.audit.record({ action: 'invoice.renewal_issued', tenantId: sub.tenantId, entityType: 'invoice', entityId: invoice.id, metadata: { subscriptionId, number: invoice.number } }, tx);
      return true;
    });
    return result === true;
  }

  private async scheduledChange(tx: Tx, subscriptionId: string, planId: string, cycle: BillingCycle, now: Date) {
    const plan = await tx.plan.findFirst({ where: { id: planId, status: 'PUBLISHED', product: { status: 'PUBLISHED' } }, select: { id: true, name: true, product: { select: { name: true } } } });
    const version = plan
      ? await tx.pricingVersion.findFirst({
          where: { planId, billingCycle: cycle, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
          orderBy: { effectiveFrom: 'desc' },
        })
      : null;
    if (!plan || !version) {
      await tx.subscription.update({ where: { id: subscriptionId }, data: { scheduledPlanId: null, scheduledAt: null } });
      await this.audit.record({ action: 'subscription.plan_change_dropped', entityType: 'subscription', entityId: subscriptionId, metadata: { planId } }, tx);
      return null;
    }
    return {
      planId: plan.id, pricingVersionId: version.id, description: `${plan.product.name} - ${plan.name} (${cycle.toLowerCase().replace('_', ' ')})`,
      unitPrice: version.price.toString(), renewalPrice: version.renewalPrice.toString(),
    };
  }

  // ───────────────────────────── overdue ─────────────────────────────

  private async markOverdue(now: Date) {
    const r = await this.db.invoice.updateMany({ where: { status: 'ISSUED', dueAt: { lt: now } }, data: { status: 'OVERDUE' } });
    return r.count;
  }

  // ───────────────────────────── payment reconciliation ─────────────────────────────

  /**
   * Webhooks can be lost (an outage on our side, a provider hiccup). Any payment still waiting ten minutes after checkout
   * opened is looked up at the provider, and a captured one is settled exactly as the webhook would have done. A checkout
   * that nobody ever completed is closed after three days so it does not wait forever.
   */
  private async reconcilePayments(now: Date) {
    if (this.gateway.mode !== 'hosted') return { reconciled: 0, checkoutsClosed: 0 };
    const waiting = await this.db.payment.findMany({
      where: { provider: this.gateway.id, status: { in: ['CREATED', 'PENDING'] }, providerOrderId: { not: null }, createdAt: { lt: new Date(now.getTime() - 10 * 60_000), gt: new Date(now.getTime() - 3 * DAY) } },
      select: { id: true, providerOrderId: true },
      take: 100,
      orderBy: { createdAt: 'asc' },
    });
    let reconciled = 0;
    for (const p of waiting) {
      try {
        const found = await this.gateway.listOrderPayments(p.providerOrderId!);
        const captured = found.find((x) => x.status === 'captured');
        const authorized = found.find((x) => x.status === 'authorized');
        const target = captured ?? authorized ?? (found.length && found.every((x) => x.status === 'failed') ? found[0] : undefined);
        if (!target) continue;
        let fact = target;
        if (target.status === 'authorized') fact = await this.gateway.capture(target.providerPaymentId, target.amountPaise, target.currency);
        const outcome = await this.settlement.apply(
          p.id,
          { status: fact.status === 'captured' ? 'captured' : fact.status === 'failed' ? 'failed' : 'created', providerPaymentId: fact.providerPaymentId, providerOrderId: fact.providerOrderId, amountPaise: fact.amountPaise, currency: fact.currency, method: fact.method, failureReason: fact.failureReason },
          'reconciliation',
        );
        if (outcome === 'SETTLED') reconciled++;
      } catch (e) {
        this.log.error(`payment reconciliation failed for payment ${p.id}: ${(e as Error).message}`);
      }
    }
    const closed = await this.db.payment.updateMany({
      where: { provider: this.gateway.id, status: { in: ['CREATED', 'PENDING'] }, createdAt: { lt: new Date(now.getTime() - 3 * DAY) } },
      data: { status: 'FAILED', failureReason: 'Checkout was not completed.' },
    });
    return { reconciled, checkoutsClosed: closed.count };
  }

  // ───────────────────────────── abandoned first orders ─────────────────────────────

  private async cancelAbandonedOrders(now: Date) {
    const cutoff = new Date(now.getTime() - this.abandonedDays * DAY);
    const candidates = await this.db.subscription.findMany({ where: { status: 'PENDING', createdAt: { lt: cutoff } }, select: { id: true } });
    let cancelled = 0;
    for (const { id } of candidates) {
      try {
        const done = await this.db.$transaction(async (tx) => {
          const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM subscriptions WHERE id = ${id}::uuid FOR UPDATE SKIP LOCKED`;
          if (!locked.length) return false;
          const sub = await tx.subscription.findUnique({ where: { id }, select: { id: true, tenantId: true, status: true, createdAt: true } });
          if (!sub || sub.status !== 'PENDING' || sub.createdAt >= cutoff) return false;
          // Never cancel an order that has money on it.
          if (await tx.payment.count({ where: { invoice: { subscriptionId: id }, status: 'SUCCEEDED' } })) return false;
          await tx.subscription.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: now, autoRenew: false } });
          await tx.invoice.updateMany({ where: { subscriptionId: id, status: { in: UNPAID } }, data: { status: 'VOID', voidedAt: now } });
          await tx.subscriptionHistory.create({
            data: { tenantId: sub.tenantId, subscriptionId: id, event: 'CANCELLED', fromStatus: 'PENDING', toStatus: 'CANCELLED', details: { reason: `unpaid for ${this.abandonedDays} days` } },
          });
          await this.notifyOwners(tx, sub.tenantId, { type: 'order.expired', title: 'An unpaid order was cancelled', body: `It was not paid within ${this.abandonedDays} days.`, link: '/services' });
          await this.audit.record({ action: 'subscription.abandoned', tenantId: sub.tenantId, entityType: 'subscription', entityId: id }, tx);
          return true;
        });
        if (done) cancelled++;
      } catch (e) {
        this.log.error(`abandoned order cleanup failed for subscription ${id}: ${(e as Error).message}`);
      }
    }
    return cancelled;
  }

  /** A domain order or transfer that is still unpaid after the same wait is withdrawn, which also releases the name for others. */
  private async cancelAbandonedDomainOrders(now: Date) {
    const cutoff = new Date(now.getTime() - this.abandonedDays * DAY);
    const candidates = await this.db.domain.findMany({
      where: {
        createdAt: { lt: cutoff },
        OR: [
          { status: 'PENDING_REGISTRATION', orderInvoice: { status: { in: UNPAID } } },
          { status: 'PENDING_TRANSFER', transfers: { some: { status: { in: ['REQUESTED', 'PENDING_AUTH'] }, invoice: { status: { in: UNPAID } } } } },
        ],
      },
      select: { id: true, orderInvoiceId: true, transfers: { where: { status: { in: ['REQUESTED', 'PENDING_AUTH'] } }, select: { id: true, invoiceId: true }, take: 1 } },
    });
    let cancelled = 0;
    for (const c of candidates) {
      const transfer = c.transfers[0] ?? null;
      const invoiceId = c.orderInvoiceId ?? transfer?.invoiceId;
      if (!invoiceId) continue;
      try {
        const done = await this.db.$transaction(async (tx) => {
          const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM invoices WHERE id = ${invoiceId}::uuid FOR UPDATE SKIP LOCKED`;
          if (!locked.length) return false;
          const d = await tx.domain.findUnique({ where: { id: c.id }, select: { id: true, tenantId: true, name: true, status: true, createdAt: true } });
          const inv = await tx.invoice.findUnique({ where: { id: invoiceId }, select: { status: true } });
          if (!d || (d.status !== 'PENDING_REGISTRATION' && d.status !== 'PENDING_TRANSFER') || d.createdAt >= cutoff || !inv || !UNPAID.includes(inv.status)) return false;
          // Never withdraw an order that has money on it.
          if (await tx.payment.count({ where: { invoiceId, status: 'SUCCEEDED' } })) return false;
          await tx.invoice.update({ where: { id: invoiceId }, data: { status: 'VOID', voidedAt: now } });
          if (transfer) await tx.domainTransfer.update({ where: { id: transfer.id }, data: { status: 'CANCELLED', authCodeEnc: null } });
          await tx.domain.update({ where: { id: c.id }, data: { status: 'CANCELLED' } });
          await this.notifyOwners(tx, d.tenantId, { type: 'order.expired', title: `The ${transfer ? 'transfer' : 'order'} for ${d.name} was cancelled`, body: `It was not paid within ${this.abandonedDays} days.`, link: '/domains' });
          await this.audit.record({ action: 'domain.order_abandoned', tenantId: d.tenantId, entityType: 'domain', entityId: c.id }, tx);
          return true;
        });
        if (done) cancelled++;
      } catch (e) {
        this.log.error(`abandoned domain order cleanup failed for domain ${c.id}: ${(e as Error).message}`);
      }
    }
    return cancelled;
  }

  // ───────────────────────────── domain expiry ─────────────────────────────

  /**
   * Domains are reminded 30 and 7 days before they expire, and marked expired when the date passes. Each reminder is
   * sent once (the stage is stored on the domain). A domain whose renewal has been paid, and is only waiting for staff,
   * is not marked expired: the customer has done their part.
   */
  private async processDomainExpiry(now: Date) {
    const horizon = new Date(now.getTime() + 30 * DAY);
    const candidates = await this.db.domain.findMany({ where: { status: 'ACTIVE', expiresAt: { not: null, lte: horizon }, reminderStage: { lt: 3 } }, select: { id: true } });
    let reminded = 0;
    let expired = 0;
    for (const { id } of candidates) {
      try {
        const outcome = await this.db.$transaction(async (tx) => {
          const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM domains WHERE id = ${id}::uuid FOR UPDATE SKIP LOCKED`;
          if (!locked.length) return null;
          const d = await tx.domain.findUnique({
            where: { id },
            select: { id: true, tenantId: true, name: true, status: true, expiresAt: true, reminderStage: true, renewals: { where: { status: 'PENDING', invoice: { status: 'PAID' } }, select: { id: true }, take: 1 } },
          });
          if (!d || d.status !== 'ACTIVE' || !d.expiresAt) return null;
          const msLeft = d.expiresAt.getTime() - now.getTime();
          const days = Math.ceil(msLeft / DAY);
          const target = msLeft <= 0 ? 3 : days <= 7 ? 2 : days <= 30 ? 1 : 0;
          if (target <= d.reminderStage) return null;
          if (target === 3 && d.renewals.length) return null; // paid and waiting for staff: not the customer's fault
          const link = `${this.portalUrl}/domains`;
          const owners = await tx.tenantMembership.findMany({ where: { tenantId: d.tenantId, status: 'ACTIVE', role: { key: 'TENANT_OWNER' } }, select: { user: { select: { email: true } } } });
          const when = target === 3 ? 'has expired' : `expires in ${days} ${days === 1 ? 'day' : 'days'}`;
          await tx.domain.update({ where: { id }, data: { reminderStage: target, ...(target === 3 ? { status: 'EXPIRED' as const } : {}) } });
          await this.notifyOwners(tx, d.tenantId, {
            type: target === 3 ? 'domain.expired' : 'domain.expiring', title: `${d.name} ${when}`,
            body: target === 3 ? 'Renew it as soon as possible to avoid losing the name.' : 'Renew it to keep your website and email working.', link: '/domains',
          });
          for (const o of owners) await this.mail.enqueue({ template: 'domain-expiring', to: o.user.email, data: { domain: d.name, when, link } }, tx, d.tenantId);
          await this.audit.record({ action: target === 3 ? 'domain.expired' : 'domain.expiry_reminder', tenantId: d.tenantId, entityType: 'domain', entityId: id, metadata: { stage: target } }, tx);
          return target === 3 ? 'EXPIRED' : 'REMINDED';
        });
        if (outcome === 'EXPIRED') expired++;
        else if (outcome === 'REMINDED') reminded++;
      } catch (e) {
        this.log.error(`domain expiry failed for domain ${id}: ${(e as Error).message}`);
      }
    }
    return { reminded, expired };
  }

  // ───────────────────────────── period ends ─────────────────────────────

  private async processPeriodEnds(now: Date) {
    const candidates = await this.db.subscription.findMany({
      where: { status: { in: ['ACTIVE', 'PAST_DUE'] }, currentPeriodEnd: { not: null, lt: now } },
      select: { id: true },
    });
    let pastDue = 0;
    let expired = 0;
    for (const { id } of candidates) {
      try {
        const outcome = await this.endOne(id, now);
        if (outcome === 'PAST_DUE') pastDue++;
        else if (outcome === 'EXPIRED') expired++;
      } catch (e) {
        this.log.error(`period end failed for subscription ${id}: ${(e as Error).message}`);
      }
    }
    return { pastDue, expired };
  }

  private async endOne(subscriptionId: string, now: Date): Promise<'PAST_DUE' | 'EXPIRED' | null> {
    return this.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM subscriptions WHERE id = ${subscriptionId}::uuid FOR UPDATE SKIP LOCKED`;
      if (!locked.length) return null;
      const sub = await tx.subscription.findUnique({
        where: { id: subscriptionId },
        select: { id: true, tenantId: true, status: true, autoRenew: true, cancelAtPeriodEnd: true, currentPeriodEnd: true },
      });
      if (!sub?.currentPeriodEnd || sub.currentPeriodEnd >= now || (sub.status !== 'ACTIVE' && sub.status !== 'PAST_DUE')) return null;

      const noRenewal = sub.cancelAtPeriodEnd || !sub.autoRenew;
      const graceEnds = new Date(sub.currentPeriodEnd.getTime() + this.graceDays * DAY);

      if (noRenewal || (sub.status === 'PAST_DUE' && now >= graceEnds)) {
        await tx.subscription.update({ where: { id: sub.id }, data: { status: 'EXPIRED' } });
        await tx.invoice.updateMany({ where: { subscriptionId: sub.id, status: { in: UNPAID } }, data: { status: 'VOID', voidedAt: now } });
        await tx.subscriptionHistory.create({
          data: { tenantId: sub.tenantId, subscriptionId: sub.id, event: 'EXPIRED', fromStatus: sub.status, toStatus: 'EXPIRED', details: { reason: noRenewal ? 'not renewed' : 'unpaid after grace period' } },
        });
        await tx.outboxEvent.createMany({ data: { tenantId: sub.tenantId, type: 'subscription.expired', aggregateType: 'subscription', aggregateId: sub.id, payload: { subscriptionId: sub.id } } });
        await this.notifyOwners(tx, sub.tenantId, { type: 'subscription.expired', title: 'A service has expired', body: noRenewal ? 'It was not renewed.' : 'The renewal invoice was not paid in time.', link: '/services' });
        await this.audit.record({ action: 'subscription.expire', tenantId: sub.tenantId, entityType: 'subscription', entityId: sub.id }, tx);
        return 'EXPIRED';
      }
      if (sub.status === 'ACTIVE') {
        await tx.subscription.update({ where: { id: sub.id }, data: { status: 'PAST_DUE' } });
        await this.notifyOwners(tx, sub.tenantId, { type: 'subscription.past_due', title: 'A renewal payment is overdue', body: 'Pay the renewal invoice to keep your service.', link: '/invoices' });
        await this.audit.record({ action: 'subscription.past_due', tenantId: sub.tenantId, entityType: 'subscription', entityId: sub.id }, tx);
        return 'PAST_DUE';
      }
      return null;
    });
  }

  /** Tells the organisation's owners. Staff-only or member-only tenants simply get no in-app notice. */
  private async notifyOwners(tx: Tx, tenantId: string, n: { type: string; title: string; body: string; link: string }) {
    const owners = await tx.tenantMembership.findMany({ where: { tenantId, status: 'ACTIVE', role: { key: 'TENANT_OWNER' } }, select: { userId: true } });
    if (!owners.length) return;
    await tx.notification.createMany({ data: owners.map((o) => ({ userId: o.userId, tenantId, type: n.type, title: n.title, body: n.body, link: n.link })) });
  }
}
