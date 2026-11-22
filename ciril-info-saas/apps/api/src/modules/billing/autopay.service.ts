import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import type { InvoiceStatus } from '../../generated/prisma/client.js';
import { MailService } from '../mail/mail.service.js';
import { toPaise } from './billing.logic.js';
import { PaymentGateway } from './payment-gateway.js';
import { PaymentSettlementService } from './payment-settlement.service.js';
import { AUTO_CHARGE_ATTEMPTS, autoChargeDate, cardLabel, nextAttemptDue } from './saved-cards.logic.js';
import { SavedCardsService } from './saved-cards.service.js';

const DAY = 86_400_000;
const UNPAID: InvoiceStatus[] = ['ISSUED', 'OVERDUE', 'PARTIALLY_PAID'];

const isRenewal = (snapshot: unknown) => typeof (snapshot as { renewalFor?: unknown } | null)?.renewalFor === 'string';

export interface AutoPayResult {
  attempted: number;
  /** Charged at once (test mode). With Razorpay the result arrives by webhook, so this stays 0 there. */
  charged: number;
}

/**
 * Charges renewal invoices to the organisation's saved card. Only renewal invoices (never a new order), only while the
 * card is active and automatic payments are on, only up to the card's limit, and at most AUTO_CHARGE_ATTEMPTS times a
 * day apart. Each attempt is claimed under a row lock before anything is sent, and the provider's order carries our
 * payment row, so the same invoice is never charged twice at once. The result is settled by the same code as every
 * other payment (the provider's webhook, or our lookup if that never arrives).
 */
@Injectable()
export class AutoPayService {
  private readonly log = new Logger(AutoPayService.name);
  private readonly portalUrl: string;

  constructor(
    private readonly db: PlatformPrisma,
    private readonly gateway: PaymentGateway,
    private readonly settlement: PaymentSettlementService,
    private readonly cards: SavedCardsService,
    private readonly mail: MailService,
    config: ConfigService<Env, true>,
  ) {
    this.portalUrl = config.get('CUSTOMER_PORTAL_URL', { infer: true }).replace(/\/$/, '');
  }

  /** The date a renewal invoice will be charged to the saved card, or null when it will not be charged automatically. */
  async plannedCharge(tenantId: string, invoice: { status: InvoiceStatus; subscriptionId: string | null; billingSnapshot: unknown; issuedAt: Date | null; dueAt: Date | null; total: { toString(): string }; amountPaid: { toString(): string }; autoChargeAttempts: number }) {
    if (!this.gateway.savesCards || !UNPAID.includes(invoice.status) || !invoice.subscriptionId || !isRenewal(invoice.billingSnapshot) || !invoice.issuedAt || !invoice.dueAt) return null;
    if (invoice.autoChargeAttempts >= AUTO_CHARGE_ATTEMPTS) return null;
    const card = await this.db.savedCard.findFirst({ where: { tenantId, provider: this.gateway.id, status: 'ACTIVE', autoPay: true }, select: { network: true, last4: true, maxAmount: true } });
    if (!card) return null;
    const outstanding = toPaise(invoice.total.toString()) - toPaise(invoice.amountPaid.toString());
    if (outstanding <= 0 || outstanding > toPaise(card.maxAmount.toString())) return null;
    return { card: cardLabel(card), on: autoChargeDate(invoice.issuedAt, invoice.dueAt) };
  }

  async run(now = new Date()): Promise<AutoPayResult> {
    if (!this.gateway.savesCards) return { attempted: 0, charged: 0 };
    const tenants = await this.db.savedCard.findMany({ where: { provider: this.gateway.id, status: 'ACTIVE', autoPay: true }, select: { tenantId: true } });
    if (!tenants.length) return { attempted: 0, charged: 0 };
    const candidates = await this.db.invoice.findMany({
      where: {
        tenantId: { in: tenants.map((t) => t.tenantId) }, status: { in: UNPAID }, subscriptionId: { not: null }, issuedAt: { not: null },
        dueAt: { not: null, lte: new Date(now.getTime() + DAY) }, autoChargeAttempts: { lt: AUTO_CHARGE_ATTEMPTS },
        OR: [{ autoChargeLastAt: null }, { autoChargeLastAt: { lte: new Date(now.getTime() - DAY) } }],
      },
      select: { id: true, billingSnapshot: true, issuedAt: true, dueAt: true },
      take: 200,
    });
    let attempted = 0;
    let charged = 0;
    for (const c of candidates) {
      if (!isRenewal(c.billingSnapshot) || autoChargeDate(c.issuedAt!, c.dueAt!) > now) continue;
      try {
        const outcome = await this.chargeOne(c.id, now);
        if (outcome !== 'SKIPPED') attempted++;
        if (outcome === 'SETTLED') charged++;
      } catch (e) {
        this.log.error(`automatic payment failed for invoice ${c.id}: ${(e as Error).message}`);
      }
    }
    if (attempted) this.log.log(`automatic payments: ${JSON.stringify({ attempted, charged })}`);
    return { attempted, charged };
  }

  private async chargeOne(invoiceId: string, now: Date): Promise<'SKIPPED' | 'SETTLED' | 'FAILED' | 'PENDING'> {
    // Claim the attempt first, under a lock: a second worker skips it, and a crash afterwards cannot cause a double charge.
    const claim = await this.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM invoices WHERE id = ${invoiceId}::uuid FOR UPDATE SKIP LOCKED`;
      if (!locked.length) return null;
      const inv = await tx.invoice.findUnique({
        where: { id: invoiceId },
        select: { id: true, tenantId: true, number: true, status: true, currency: true, total: true, amountPaid: true, subscriptionId: true, billingSnapshot: true, issuedAt: true, dueAt: true, autoChargeAttempts: true, autoChargeLastAt: true },
      });
      if (!inv || !UNPAID.includes(inv.status) || !inv.subscriptionId || !isRenewal(inv.billingSnapshot) || !inv.issuedAt || !inv.dueAt) return null;
      if (inv.autoChargeAttempts >= AUTO_CHARGE_ATTEMPTS || !nextAttemptDue(inv.autoChargeLastAt, now) || autoChargeDate(inv.issuedAt, inv.dueAt) > now) return null;
      const card = await tx.savedCard.findFirst({ where: { tenantId: inv.tenantId, provider: this.gateway.id, status: 'ACTIVE', autoPay: true }, select: { id: true, providerCustomerId: true, providerTokenId: true, network: true, last4: true, maxAmount: true } });
      if (!card) return null;
      // A payment already on its way (an earlier charge, or the customer paying right now) is left to finish.
      const inFlight = await tx.payment.count({ where: { invoiceId, OR: [{ status: 'PENDING' }, { status: 'CREATED', createdAt: { gt: new Date(now.getTime() - 30 * 60_000) } }] } });
      if (inFlight) return null;
      const outstanding = toPaise(inv.total.toString()) - toPaise(inv.amountPaid.toString());
      if (outstanding <= 0) return null;
      const account = await tx.customerAccount.findUnique({ where: { tenantId: inv.tenantId }, select: { billingEmail: true } });
      if (outstanding > toPaise(card.maxAmount.toString())) {
        // More than the card may be charged without the customer: stop trying and ask them to pay it themselves, once.
        await tx.invoice.update({ where: { id: invoiceId }, data: { autoChargeAttempts: AUTO_CHARGE_ATTEMPTS, autoChargeLastAt: now } });
        if (account) await this.mail.enqueue({ template: 'autopay-failed', to: account.billingEmail, data: { number: inv.number, total: `${inv.currency} ${(outstanding / 100).toFixed(2)}`, card: cardLabel(card), reason: `It is more than ${inv.currency} ${(toPaise(card.maxAmount.toString()) / 100).toFixed(2)}, the most your card can be charged automatically.`, retry: false, link: `${this.portalUrl}/invoices/${invoiceId}` } }, tx, inv.tenantId);
        await tx.auditLog.create({ data: { action: 'autopay.over_limit', tenantId: inv.tenantId, entityType: 'invoice', entityId: invoiceId, metadata: { outstanding: (outstanding / 100).toFixed(2), limit: card.maxAmount.toString() } } });
        return 'OVER_LIMIT' as const;
      }
      const attempt = inv.autoChargeAttempts + 1;
      await tx.invoice.update({ where: { id: invoiceId }, data: { autoChargeAttempts: attempt, autoChargeLastAt: now } });
      return { inv, card, attempt, outstanding, email: account?.billingEmail ?? null };
    });
    if (!claim) return 'SKIPPED';
    if (claim === 'OVER_LIMIT') return 'FAILED';

    const { inv, card, attempt, outstanding } = claim;
    const key = `auto:${inv.id}:${attempt}`;
    const holder = await this.cards.holder(inv.tenantId);
    const amount = (outstanding / 100).toFixed(2);
    const order = await this.gateway.createChargeOrder({ amountPaise: outstanding, currency: inv.currency, receipt: inv.number, idempotencyKey: key, notes: { invoiceId: inv.id, invoiceNumber: inv.number, tenantId: inv.tenantId, automatic: String(attempt) } });
    const payment = await this.db.payment.create({
      data: { tenantId: inv.tenantId, invoiceId: inv.id, provider: this.gateway.id, status: 'PENDING', amount, currency: inv.currency, providerOrderId: order.providerOrderId, idempotencyKey: key, method: 'card', savedCardId: card.id },
      select: { id: true },
    });
    await this.db.auditLog.create({ data: { action: 'autopay.attempt', tenantId: inv.tenantId, entityType: 'invoice', entityId: inv.id, metadata: { paymentId: payment.id, attempt, amount } } });

    let result: Awaited<ReturnType<PaymentGateway['chargeCard']>>;
    if (!holder.contact) {
      result = { status: 'failed', providerPaymentId: null, failureReason: 'The organisation has no phone number, which the bank needs for automatic payments.' };
    } else {
      try {
        result = await this.gateway.chargeCard({
          customerId: card.providerCustomerId, tokenId: card.providerTokenId, providerOrderId: order.providerOrderId, amountPaise: outstanding, currency: inv.currency,
          email: claim.email ?? holder.email, contact: holder.contact, description: `Renewal invoice ${inv.number}`, notes: { invoiceId: inv.id, invoiceNumber: inv.number },
        });
      } catch (e) {
        // The provider could not be reached or answered oddly. The charge may or may not have started: the order is
        // looked up later (reconciliation), and nothing is charged again while this payment is open.
        this.log.warn(`automatic payment for ${inv.number} is waiting on the provider: ${(e as Error).message}`);
        return 'PENDING';
      }
    }
    if (result.providerPaymentId && result.status !== 'captured') {
      await this.db.payment.updateMany({ where: { id: payment.id, providerPaymentId: null }, data: { providerPaymentId: result.providerPaymentId } }).catch(() => undefined);
    }
    const outcome = await this.settlement.apply(
      payment.id,
      { status: result.status === 'captured' ? 'captured' : result.status === 'failed' ? 'failed' : 'created', providerPaymentId: result.providerPaymentId, providerOrderId: order.providerOrderId, amountPaise: outstanding, currency: inv.currency, method: 'card', failureReason: result.failureReason },
      'autopay',
    );
    return outcome === 'SETTLED' ? 'SETTLED' : outcome === 'FAILED' ? 'FAILED' : 'PENDING';
  }
}
