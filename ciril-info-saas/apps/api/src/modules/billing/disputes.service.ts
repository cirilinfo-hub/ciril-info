import { Injectable, Logger } from '@nestjs/common';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import type { DisputeStatus, Prisma } from '../../generated/prisma/client.js';
import { orderBy, page, skipTake } from '../../common/http/pagination.js';
import { StaffNotifier } from '../notifications/staff-notifier.service.js';
import type { DisputeListQuery } from './admin-billing.dto.js';
import { PaymentGateway } from './payment-gateway.js';
import type { ProviderDispute } from './providers/payment-provider.js';

const DECIDED: DisputeStatus[] = ['WON', 'LOST', 'CLOSED'];
const OPEN: DisputeStatus[] = ['OPEN', 'UNDER_REVIEW'];
const rupees = (paise: number) => (paise / 100).toFixed(2);
const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Chargebacks. The provider tells us (by webhook) when a customer's bank disputes a payment, and again as it moves on
 * and is decided. We keep one record per dispute and tell billing staff, with the deadline to respond. Staff answer it
 * in the provider's dashboard. A lost dispute changes no invoice or service by itself: whether to stop the service,
 * or issue a credit note, is a decision for the business and its accountant, so staff are told and decide.
 */
@Injectable()
export class DisputesService {
  private readonly log = new Logger(DisputesService.name);

  constructor(
    private readonly db: PlatformPrisma,
    private readonly gateway: PaymentGateway,
    private readonly staff: StaffNotifier,
  ) {}

  /** Returns a note to store on the webhook when nothing could be recorded, otherwise null. */
  async apply(d: ProviderDispute, providerId: 'MOCK' | 'RAZORPAY' | 'STRIPE' = this.gateway.id): Promise<string | null> {
    const payment = await this.db.payment.findUnique({
      where: { provider_providerPaymentId: { provider: providerId, providerPaymentId: d.providerPaymentId } },
      select: { id: true, tenantId: true, invoiceId: true, invoice: { select: { number: true } }, tenant: { select: { name: true } } },
    });
    if (!payment) return 'no payment for this dispute';

    const existing = await this.db.paymentDispute.findUnique({ where: { provider_providerDisputeId: { provider: providerId, providerDisputeId: d.id } } });
    // Deliveries can arrive out of order: a decided dispute only reopens when the provider moves it to a new phase
    // (for example pre-arbitration), never because an older "open" event turned up late.
    if (existing && DECIDED.includes(existing.status) && !DECIDED.includes(d.status) && (d.phase ?? null) === existing.phase) return null;
    if (existing && existing.status === d.status && (d.phase ?? null) === existing.phase && rupees(d.amountDeductedPaise) === existing.amountDeducted.toFixed(2)) return null;

    const data = {
      amount: rupees(d.amountPaise), currency: d.currency, amountDeducted: rupees(d.amountDeductedPaise), status: d.status, phase: d.phase,
      reasonCode: d.reasonCode?.slice(0, 60) ?? null, reason: d.reason?.slice(0, 255) ?? null, respondBy: d.respondBy,
      resolvedAt: DECIDED.includes(d.status) ? new Date() : null,
    };
    let row: { id: string };
    try {
      row = existing
        ? await this.db.paymentDispute.update({ where: { id: existing.id }, data, select: { id: true } })
        : await this.db.paymentDispute.create({ data: { ...data, tenantId: payment.tenantId, paymentId: payment.id, invoiceId: payment.invoiceId, provider: providerId, providerDisputeId: d.id }, select: { id: true } });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return null; // the same event, delivered twice at once
      throw e;
    }

    await this.db.auditLog.create({
      data: { action: `dispute.${d.status.toLowerCase()}`, tenantId: payment.tenantId, entityType: 'invoice', entityId: payment.invoiceId, metadata: { disputeId: row.id, providerDisputeId: d.id, amount: data.amount, phase: d.phase, reason: d.reasonCode } as Prisma.InputJsonValue },
    });
    const who = `${payment.invoice.number} (${payment.tenant.name})`;
    const amount = `${d.currency} ${data.amount}`;
    const notice =
      d.status === 'WON' ? { title: 'Chargeback won', body: `${who}: the bank decided in your favour. ${amount}.` }
      : d.status === 'LOST' ? { title: 'Chargeback lost', body: `${who}: ${d.currency} ${data.amountDeducted} taken back. Decide whether to stop the service; issue a credit note only if your accountant agrees.` }
      : d.status === 'CLOSED' ? { title: 'Chargeback closed', body: `${who}: ${amount}.` }
      : { title: existing ? 'Chargeback needs attention' : 'New chargeback', body: `${who}: ${amount}${d.reason ? `, ${d.reason}` : ''}.${d.respondBy ? ` Respond in the payment provider's dashboard by ${day(d.respondBy)}.` : ''}` };
    await this.staff.notify('billing:write', { type: 'payment.dispute', ...notice, link: '/chargebacks' }).catch((e: Error) => this.log.warn(`dispute notice failed: ${e.message}`));
    return null;
  }

  async list(q: DisputeListQuery) {
    const where: Prisma.PaymentDisputeWhereInput = {
      ...(q.open ? { status: { in: OPEN } } : {}),
      ...(q.search ? { OR: [{ invoice: { number: { contains: q.search, mode: 'insensitive' } } }, { tenant: { name: { contains: q.search, mode: 'insensitive' } } }, { providerDisputeId: { contains: q.search } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.paymentDispute.findMany({
        where, ...skipTake(q),
        orderBy: orderBy<Prisma.PaymentDisputeOrderByWithRelationInput>(q.sort, { openedAt: (dir) => ({ openedAt: dir }), respondBy: (dir) => ({ respondBy: dir }) }, { openedAt: 'desc' }),
        select: {
          id: true, providerDisputeId: true, amount: true, amountDeducted: true, currency: true, status: true, phase: true, reasonCode: true, reason: true, respondBy: true, openedAt: true, resolvedAt: true,
          tenant: { select: { id: true, name: true } }, invoice: { select: { id: true, number: true } },
        },
      }),
      this.db.paymentDispute.count({ where }),
    ]);
    return page(rows, total, q);
  }

  openCount() {
    return this.db.paymentDispute.count({ where: { status: { in: OPEN } } });
  }
}
