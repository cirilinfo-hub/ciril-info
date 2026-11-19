import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { PlatformPrisma, type Tx } from '../../database/prisma-clients.js';
import type { InvoiceStatus } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { MailService } from '../mail/mail.service.js';
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
    const abandoned = await this.cancelAbandonedOrders(now);
    const { pastDue, expired } = await this.processPeriodEnds(now);
    if (renewalInvoices || overdue || abandoned || pastDue || expired) this.log.log(`billing lifecycle: ${JSON.stringify({ renewalInvoices, overdue, abandoned, pastDue, expired })}`);
    return { renewalInvoices, overdue, pastDue, expired, abandoned };
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
        select: { id: true, tenantId: true, status: true, currency: true, currentPeriodEnd: true, autoRenew: true, cancelAtPeriodEnd: true, items: { select: { description: true, renewalPrice: true, quantity: true } } },
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
      const totals = computeTotals(
        sub.items.map((i) => ({ description: `${i.description} (renewal)`, unitPaise: toPaise(i.renewalPrice), quantity: i.quantity })),
        tax ? Number(tax.rate.toString()) : 0,
      );
      const number = await nextInvoiceNumber(tx, now);
      const invoice = await tx.invoice.create({
        data: {
          tenantId: sub.tenantId, subscriptionId, number, status: 'ISSUED', currency: sub.currency,
          subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total, issuedAt: now, dueAt: sub.currentPeriodEnd,
          billingSnapshot: {
            renewalFor: marker, seller,
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

  // ───────────────────────────── overdue ─────────────────────────────

  private async markOverdue(now: Date) {
    const r = await this.db.invoice.updateMany({ where: { status: 'ISSUED', dueAt: { lt: now } }, data: { status: 'OVERDUE' } });
    return r.count;
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
