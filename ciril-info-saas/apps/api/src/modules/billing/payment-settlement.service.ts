import { Injectable, Logger } from '@nestjs/common';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import { StaffNotifier } from '../notifications/staff-notifier.service.js';
import { toPaise } from './billing.logic.js';
import { settleInvoicePayment } from './settlement.js';

/** What a provider tells us about one payment, whichever channel (browser, webhook, lookup) it came through. */
export interface ProviderPaymentFact {
  status: 'captured' | 'failed' | 'authorized' | 'created' | 'other';
  providerPaymentId: string | null;
  providerOrderId: string | null;
  amountPaise: number | null;
  currency: string | null;
  method: string | null;
  failureReason: string | null;
}

export type ApplyOutcome = 'SETTLED' | 'ALREADY_SETTLED' | 'FAILED' | 'PENDING' | 'MISMATCH' | 'ORPHANED' | 'UNKNOWN_PAYMENT';

/**
 * The single place a hosted-provider result becomes money in our books. It runs without a signed-in customer (a webhook
 * has none), so it uses the platform database role, and it never trusts a fact it has not checked against our own
 * record of what was asked for: same order, same amount, same currency.
 */
@Injectable()
export class PaymentSettlementService {
  private readonly log = new Logger(PaymentSettlementService.name);

  constructor(
    private readonly db: PlatformPrisma,
    private readonly staff: StaffNotifier,
  ) {}

  async apply(paymentId: string, fact: ProviderPaymentFact, via: string, actorUserId: string | null = null): Promise<ApplyOutcome> {
    const payment = await this.db.payment.findUnique({
      where: { id: paymentId },
      select: { id: true, tenantId: true, invoiceId: true, status: true, amount: true, currency: true, providerOrderId: true, invoice: { select: { number: true } } },
    });
    if (!payment) return 'UNKNOWN_PAYMENT';
    if (payment.status === 'SUCCEEDED' || payment.status === 'REFUNDED' || payment.status === 'PARTIALLY_REFUNDED') return 'ALREADY_SETTLED';

    // The provider's figures must match what we asked for. A mismatch is never settled; staff look at it.
    const wrongOrder = fact.providerOrderId && payment.providerOrderId && fact.providerOrderId !== payment.providerOrderId;
    const wrongAmount = fact.status === 'captured' && (fact.amountPaise !== toPaise(payment.amount) || (fact.currency ?? payment.currency) !== payment.currency);
    if (wrongOrder || wrongAmount) {
      await this.alert(payment.tenantId, payment.invoiceId, payment.invoice.number, 'payment.mismatch', 'A payment did not match its invoice', `${payment.invoice.number}: the provider reported ${fact.amountPaise ?? '?'} ${fact.currency ?? ''}, we asked for ${payment.amount.toString()} ${payment.currency}. Nothing was recorded.`);
      return 'MISMATCH';
    }

    if (fact.status === 'captured') {
      return this.db.$transaction(async (tx): Promise<'SETTLED' | 'ALREADY_SETTLED' | 'ORPHANED'> => {
        const outcome = await settleInvoicePayment(tx, {
          tenantId: payment.tenantId, invoiceId: payment.invoiceId, paymentId: payment.id, actorUserId, now: new Date(),
          providerPaymentId: fact.providerPaymentId, method: fact.method, via,
        });
        if (outcome === 'SETTLED') return 'SETTLED' as const;
        if (outcome === 'ALREADY_PAID') {
          // Two signals for the same payment (the browser and the webhook) can arrive together. The loser finds the invoice
          // already paid, and that is fine when it was this very payment that paid it.
          const current = await tx.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
          if (current?.status === 'SUCCEEDED') return 'ALREADY_SETTLED' as const;
          // The invoice was paid some other way while this payment was in flight: the customer has paid twice.
          await tx.payment.update({ where: { id: payment.id }, data: { status: 'SUCCEEDED', verifiedAt: new Date(), providerPaymentId: fact.providerPaymentId ?? undefined, method: fact.method ?? undefined } });
          await tx.auditLog.create({ data: { action: 'payment.duplicate', tenantId: payment.tenantId, entityType: 'invoice', entityId: payment.invoiceId, metadata: { paymentId: payment.id, via } } });
          return 'ORPHANED' as const;
        }
        // The invoice was voided (or is otherwise closed) but the customer's money arrived. Record it and flag it.
        await tx.payment.update({ where: { id: payment.id }, data: { status: 'SUCCEEDED', verifiedAt: new Date(), providerPaymentId: fact.providerPaymentId ?? undefined, method: fact.method ?? undefined } });
        // The audit entry and the staff alert for this case are written once, by alert() below.
        return 'ORPHANED' as const;
      }).then(async (outcome) => {
        if (outcome === 'ORPHANED') {
          await this.alert(payment.tenantId, payment.invoiceId, payment.invoice.number, 'payment.orphaned', 'Money arrived for a closed invoice', `${payment.invoice.number} could not take this payment (it was voided or already paid). Refund it from the invoice.`);
        }
        return outcome;
      });
    }

    if (fact.status === 'failed') {
      await this.db.payment.updateMany({ where: { id: payment.id, status: { in: ['CREATED', 'PENDING'] } }, data: { status: 'FAILED', failureReason: (fact.failureReason ?? 'The payment did not go through.').slice(0, 255) } });
      await this.db.auditLog.create({ data: { action: 'payment.failed', actorId: actorUserId, tenantId: payment.tenantId, entityType: 'invoice', entityId: payment.invoiceId, metadata: { paymentId: payment.id, via, reason: fact.failureReason } } });
      return 'FAILED';
    }

    // Authorised but not captured yet, or still in progress: wait for the next signal.
    await this.db.payment.updateMany({ where: { id: payment.id, status: 'CREATED' }, data: { status: 'PENDING', ...(fact.providerPaymentId ? { providerPaymentId: fact.providerPaymentId } : {}) } });
    return 'PENDING';
  }

  /** Staff who handle billing hear about anything that needs a human. Only the invoice number and what happened. */
  private async alert(tenantId: string, invoiceId: string, number: string, action: string, title: string, detail: string) {
    this.log.warn(`${action}: ${detail}`);
    await this.db.auditLog.create({ data: { action, tenantId, entityType: 'invoice', entityId: invoiceId, metadata: { detail } } }).catch(() => undefined);
    await this.staff.notify('billing:write', { type: action, title, body: number, link: '/invoices' });
  }
}
