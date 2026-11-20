import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import type { InvoiceStatus, Prisma, SubscriptionStatus } from '../../generated/prisma/client.js';
import { orderBy, page, skipTake } from '../../common/http/pagination.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser, RequestMeta } from '../auth/auth.types.js';
import type { AdminInvoiceListQuery, AdminSubscriptionListQuery, RecordPaymentDto, RefundDto, TdsListQuery } from './admin-billing.dto.js';
import { fromPaise, gstSplit, refundTaxPaise, toPaise } from './billing.logic.js';
import { nextCreditNoteNumber } from './numbering.js';
import { PaymentGateway } from './payment-gateway.js';
import { settleInvoicePayment } from './settlement.js';

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
        refunds: { orderBy: { createdAt: 'desc' }, select: { id: true, amount: true, status: true, reason: true, createdAt: true, creditNote: { select: { id: true, number: true } } } },
        tdsDeduction: { select: { id: true, amount: true, section: true, certificateNumber: true, certificateAt: true, createdAt: true } },
      },
    });
    if (!inv) throw new NotFoundException({ code: 'INVOICE_NOT_FOUND', message: 'Invoice not found.' });
    return { ...inv, testMode: inv.payments.some((p) => p.provider === 'MOCK') };
  }

  /**
   * Records money that arrived outside the checkout (a bank transfer, UPI, a cheque, cash) against an unpaid invoice. It pays the
   * whole outstanding amount through the same settlement every other payment uses, so the service is activated and the customer
   * is told in the usual way. The same bank reference cannot be recorded twice, and one form submission records one payment.
   */
  async recordManualPayment(user: AuthUser, invoiceId: string, dto: RecordPaymentDto, meta: RequestMeta) {
    const needsReference = dto.method === 'BANK_TRANSFER' || dto.method === 'UPI' || dto.method === 'CHEQUE';
    const reference = dto.reference?.trim() || null;
    if (needsReference && (!reference || reference.length < 3)) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Enter the bank reference, UPI transaction id or cheque number.' });
    const receivedOn = new Date(`${dto.receivedOn}T12:00:00.000Z`);
    if (Number.isNaN(receivedOn.getTime()) || receivedOn.toISOString().slice(0, 10) !== dto.receivedOn) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Enter a real date.' });
    if (receivedOn.getTime() > Date.now() + DAY) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The date the money arrived cannot be in the future.' });

    const key = dto.idempotencyKey ? `manual:${invoiceId}:${dto.idempotencyKey}` : `manual:${invoiceId}:${randomUUID()}`;
    const providerPaymentId = reference ? `${dto.method}:${reference.toUpperCase()}` : null;
    try {
      await this.db.$transaction(async (tx) => {
        const prior = await tx.payment.findUnique({ where: { idempotencyKey: key }, select: { invoiceId: true } });
        if (prior) return; // the same form submitted twice: already recorded
        await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId}::uuid FOR UPDATE`;
        const inv = await tx.invoice.findUnique({ where: { id: invoiceId }, select: { id: true, tenantId: true, number: true, status: true, total: true, amountPaid: true, currency: true, issuedAt: true } });
        if (!inv) throw new NotFoundException({ code: 'INVOICE_NOT_FOUND', message: 'Invoice not found.' });
        if (!UNPAID.includes(inv.status)) throw new ConflictException({ code: 'INVOICE_NOT_PAYABLE', message: inv.status === 'PAID' ? 'This invoice is already paid.' : 'This invoice cannot take a payment.' });
        if (inv.issuedAt && receivedOn.getTime() < new Date(inv.issuedAt.toISOString().slice(0, 10) + 'T00:00:00.000Z').getTime()) {
          throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The money cannot have arrived before the invoice was issued.' });
        }
        const outstanding = toPaise(inv.total.toString()) - toPaise(inv.amountPaid.toString());
        if (outstanding <= 0) throw new ConflictException({ code: 'INVOICE_NOT_PAYABLE', message: 'Nothing is outstanding on this invoice.' });
        // TDS the customer kept back and paid to the government instead. What reached us is the rest.
        const tdsPaise = dto.tdsAmount ? Math.round(dto.tdsAmount * 100) : 0;
        if (tdsPaise >= outstanding) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The TDS must be less than the amount due.' });
        const received = dto.amount === undefined ? outstanding - tdsPaise : Math.round(dto.amount * 100);
        if (received + tdsPaise > outstanding) {
          throw new BadRequestException({ code: 'VALIDATION_FAILED', message: `That is more than is due. ${(outstanding / 100).toFixed(2)} is outstanding on this invoice.` });
        }
        const completes = received + tdsPaise === outstanding;
        // TDS is certified against the whole invoice, so it goes with the payment that completes it.
        if (tdsPaise > 0 && !completes) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Record TDS with the payment that completes the invoice: the amount received plus the TDS must equal what is due.' });

        const payment = await tx.payment.create({
          data: {
            tenantId: inv.tenantId, invoiceId, provider: 'MANUAL', status: 'PENDING', amount: (received / 100).toFixed(2), currency: inv.currency,
            providerPaymentId, method: dto.method.toLowerCase(), idempotencyKey: key,
          },
          select: { id: true },
        });
        if (completes) {
          // No signed-in customer: the organisation's owners are the ones told.
          await settleInvoicePayment(tx, { tenantId: inv.tenantId, invoiceId, paymentId: payment.id, actorUserId: null, now: new Date(), providerPaymentId, method: dto.method.toLowerCase(), via: 'manual' });
        } else {
          // A part payment: counted, but the service waits until the invoice is paid in full.
          const paidSoFar = toPaise(inv.amountPaid.toString()) + received;
          await tx.payment.update({ where: { id: payment.id }, data: { status: 'SUCCEEDED' } });
          await tx.invoice.update({ where: { id: invoiceId }, data: { amountPaid: (paidSoFar / 100).toFixed(2), status: 'PARTIALLY_PAID' } });
          const owners = await tx.tenantMembership.findMany({ where: { tenantId: inv.tenantId, status: 'ACTIVE', role: { key: 'TENANT_OWNER' } }, select: { userId: true } });
          if (owners.length) {
            await tx.notification.createMany({
              data: owners.map((o) => ({
                userId: o.userId, tenantId: inv.tenantId, type: 'payment.partial', title: `Part payment received for ${inv.number}`,
                body: `${inv.currency} ${(received / 100).toFixed(2)} received. ${inv.currency} ${((outstanding - received) / 100).toFixed(2)} is still due.`, link: `/invoices/${invoiceId}`,
              })),
            });
          }
        }
        // For a manual payment the verified time is when the money arrived, which is what reconciliation needs.
        await tx.payment.update({ where: { id: payment.id }, data: { verifiedAt: receivedOn } });
        if (tdsPaise > 0) {
          await tx.tdsDeduction.create({ data: { tenantId: inv.tenantId, invoiceId, amount: (tdsPaise / 100).toFixed(2), section: dto.tdsSection ?? null } });
        }
        await this.audit.record({
          action: 'payment.manual_recorded', actorId: user.id, tenantId: inv.tenantId, entityType: 'invoice', entityId: invoiceId,
          metadata: { number: inv.number, method: dto.method, reference, receivedOn: dto.receivedOn, note: dto.note ?? null, amount: (received / 100).toFixed(2), partial: !completes, tds: tdsPaise ? (tdsPaise / 100).toFixed(2) : null, tdsSection: dto.tdsSection ?? null }, meta,
        }, tx);
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        // Either the same form again (fine) or a bank reference that was already recorded (not fine).
        if (await this.db.payment.findUnique({ where: { idempotencyKey: key }, select: { id: true } })) return this.getInvoice(invoiceId);
        throw new ConflictException({ code: 'REFERENCE_ALREADY_RECORDED', message: 'This reference has already been recorded against a payment.' });
      }
      throw e;
    }
    return this.getInvoice(invoiceId);
  }

  /** TDS deductions, newest first; `pending` shows only those whose certificate has not arrived, the list to chase. */
  async listTds(q: TdsListQuery) {
    const where: Prisma.TdsDeductionWhereInput = {
      ...(q.pending ? { certificateAt: null } : {}),
      ...(q.search ? { OR: [{ invoice: { number: { contains: q.search, mode: 'insensitive' } } }, { tenant: { name: { contains: q.search, mode: 'insensitive' } } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.tdsDeduction.findMany({
        where, ...skipTake(q), orderBy: { createdAt: 'desc' },
        select: { id: true, amount: true, section: true, certificateNumber: true, certificateAt: true, createdAt: true, tenant: { select: { id: true, name: true } }, invoice: { select: { id: true, number: true, total: true } } },
      }),
      this.db.tdsDeduction.count({ where }),
    ]);
    return page(rows, total, q);
  }

  /** The customer sent the TDS certificate. Recorded once; a correction is a new note in the audit log. */
  async recordTdsCertificate(user: AuthUser, invoiceId: string, certificateNumber: string, meta: RequestMeta) {
    const tds = await this.db.tdsDeduction.findUnique({ where: { invoiceId }, select: { id: true, tenantId: true, certificateAt: true, invoice: { select: { number: true } } } });
    if (!tds) throw new NotFoundException({ code: 'TDS_NOT_FOUND', message: 'This invoice has no TDS recorded.' });
    const r = await this.db.tdsDeduction.updateMany({ where: { id: tds.id, certificateAt: null }, data: { certificateNumber, certificateAt: new Date() } });
    if (r.count === 0) throw new ConflictException({ code: 'TDS_CERTIFICATE_RECORDED', message: 'The certificate for this TDS has already been recorded.' });
    await this.audit.record({ action: 'tds.certificate_received', actorId: user.id, tenantId: tds.tenantId, entityType: 'invoice', entityId: invoiceId, metadata: { number: tds.invoice.number, certificateNumber }, meta });
    return this.getInvoice(invoiceId);
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
      // An invoice can have several payments (paid in parts). Each refund comes out of one payment, newest first, because a
      // gateway refund is always against one payment; what is left on older payments is refunded next time.
      const payments = await tx.payment.findMany({ where: { invoiceId, status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } }, orderBy: { createdAt: 'desc' } });
      if (!payments.length) throw new ConflictException({ code: 'NOTHING_TO_REFUND', message: 'This invoice has no payment to refund.' });
      const withRemaining = await Promise.all(payments.map(async (p) => {
        const used = await tx.refund.aggregate({ where: { paymentId: p.id, status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING', 'SUCCEEDED'] } }, _sum: { amount: true } });
        return { p, remaining: toPaise(p.amount) - toPaise(used._sum.amount ?? 0) };
      }));
      const next = withRemaining.find((x) => x.remaining > 0);
      if (!next) throw new ConflictException({ code: 'ALREADY_REFUNDED', message: 'Every payment on this invoice has already been refunded in full.' });
      const payment = next.p;
      const remaining = next.remaining;
      const refundableInAll = withRemaining.reduce((t, x) => t + Math.max(0, x.remaining), 0);
      const wanted = dto.amount === undefined ? remaining : toPaise(dto.amount);
      if (wanted > remaining) {
        throw new ConflictException({
          code: 'REFUND_TOO_LARGE',
          message: refundableInAll > remaining
            ? `This invoice was paid in parts. At most ${(remaining / 100).toFixed(2)} can be refunded in one go, from the latest payment; refund again for the rest (${((refundableInAll - remaining) / 100).toFixed(2)} more).`
            : `At most ${(remaining / 100).toFixed(2)} can still be refunded on this invoice.`,
        });
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
      // A payment that was recorded by hand reached you outside the gateway, so there is nothing for the gateway to reverse: the
      // refund is recorded here and you return the money yourself (bank transfer, UPI, cheque).
      result = started.payment.provider === 'MANUAL'
        ? { ok: true, providerRefundId: null, failureReason: null }
        : await this.gateway.refund({ providerPaymentId: started.payment.providerPaymentId, amountPaise: started.wanted, currency: started.inv.currency, idempotencyKey: started.refundId });
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
      const paymentDone = toPaise(refunded._sum.amount ?? 0) >= toPaise(started.payment.amount);
      await tx.payment.update({ where: { id: started.payment.id }, data: { status: paymentDone ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
      // The invoice is refunded when everything that reached us, across all its payments, has gone back.
      const received = await tx.payment.aggregate({ where: { invoiceId, status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } }, _sum: { amount: true } });
      const refundedAll = await tx.refund.aggregate({ where: { invoiceId, status: 'SUCCEEDED' }, _sum: { amount: true } });
      const fully = toPaise(refundedAll._sum.amount ?? 0) >= toPaise(received._sum.amount ?? 0);
      if (fully) await tx.invoice.update({ where: { id: invoiceId }, data: { status: 'REFUNDED' } });

      // A GST credit note for this refund: the taxable value and the tax inside it, split the way the invoice was.
      const full = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { number: true, issuedAt: true, total: true, taxTotal: true, billingSnapshot: true } });
      const snap = (full.billingSnapshot ?? {}) as { seller?: { address?: { stateCode?: string } }; buyer?: { address?: { stateCode?: string | null } | null }; tax?: unknown };
      const priorTax = await tx.creditNote.aggregate({ where: { invoiceId }, _sum: { taxTotal: true } });
      const taxPaise = refundTaxPaise(started.wanted, toPaise(full.total), toPaise(full.taxTotal), toPaise(priorTax._sum.taxTotal ?? 0), fully);
      const issuedAt = new Date();
      const creditNote = await tx.creditNote.create({
        data: {
          tenantId: started.inv.tenantId, invoiceId, refundId: started.refundId, number: await nextCreditNoteNumber(tx, issuedAt), currency: started.inv.currency,
          subtotal: fromPaise(started.wanted - taxPaise), taxTotal: fromPaise(taxPaise), total: fromPaise(started.wanted), reason: dto.reason, issuedAt,
          snapshot: {
            seller: (snap as { seller?: object }).seller ?? {}, buyer: snap.buyer ?? {}, tax: snap.tax ?? null,
            original: { number: full.number, issuedAt: full.issuedAt?.toISOString() ?? null },
            gst: { ...gstSplit(taxPaise, snap.seller?.address?.stateCode, snap.buyer?.address?.stateCode) },
          },
        },
        select: { number: true },
      });

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
        { action: 'refund.issue', actorId: user.id, tenantId: started.inv.tenantId, entityType: 'invoice', entityId: invoiceId, metadata: { amount: (started.wanted / 100).toFixed(2), reason: dto.reason, full: fully, serviceCancelled: cancelled, creditNote: creditNote.number }, meta },
        tx,
      );
    });

    if (!result.ok) throw new ConflictException({ code: 'REFUND_FAILED', message: result.failureReason ?? 'The payment provider did not accept the refund.' });
    return this.getInvoice(invoiceId);
  }

  async getCreditNote(id: string) {
    const c = await this.db.creditNote.findUnique({
      where: { id },
      select: { id: true, number: true, currency: true, subtotal: true, taxTotal: true, total: true, reason: true, snapshot: true, issuedAt: true, invoice: { select: { id: true, number: true } }, tenant: { select: { id: true, name: true } } },
    });
    if (!c) throw new NotFoundException({ code: 'CREDIT_NOTE_NOT_FOUND', message: 'Credit note not found.' });
    return c;
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
          id: true, status: true, billingCycle: true, currency: true, currentPeriodStart: true, currentPeriodEnd: true, cancelAtPeriodEnd: true, createdAt: true, scheduledPlan: { select: { id: true, name: true } },
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
