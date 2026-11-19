import { type Tx } from '../../database/prisma-clients.js';
import type { BillingCycle, InvoiceStatus, Prisma, SubscriptionStatus } from '../../generated/prisma/client.js';
import { addCycle } from './billing.logic.js';

const UNPAID: InvoiceStatus[] = ['ISSUED', 'OVERDUE', 'PARTIALLY_PAID'];

export interface SettleArgs {
  tenantId: string;
  invoiceId: string;
  paymentId: string;
  /** The customer who paid, when we know them. A webhook has no signed-in person; then the organisation's owners are told. */
  actorUserId: string | null;
  now: Date;
  providerPaymentId?: string | null;
  method?: string | null;
  /** Source for the audit trail: "checkout", "webhook", "reconciliation" or "test-mode". */
  via: string;
}

export type SettleOutcome = 'SETTLED' | 'ALREADY_PAID' | 'NOT_PAYABLE';

/**
 * Records a payment that has been proven genuine: the payment row, the invoice, the subscription and the notices,
 * all in the caller's transaction. Safe to call twice for the same payment (a webhook racing the browser's
 * confirmation): the invoice row is locked, and the second caller finds it already paid and changes nothing.
 */
export async function settleInvoicePayment(tx: Tx, a: SettleArgs): Promise<SettleOutcome> {
  await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${a.invoiceId}::uuid FOR UPDATE`;
  const invoice = await tx.invoice.findUnique({
    where: { id: a.invoiceId },
    select: { id: true, number: true, status: true, total: true, billingSnapshot: true, subscription: { select: { id: true, status: true, billingCycle: true, currentPeriodEnd: true } } },
  });
  if (!invoice) return 'NOT_PAYABLE';
  if (invoice.status === 'PAID') return 'ALREADY_PAID';
  if (!UNPAID.includes(invoice.status)) return 'NOT_PAYABLE';

  await tx.payment.update({
    where: { id: a.paymentId },
    data: { status: 'SUCCEEDED', verifiedAt: a.now, failureReason: null, ...(a.providerPaymentId ? { providerPaymentId: a.providerPaymentId } : {}), ...(a.method ? { method: a.method } : {}) },
  });
  await tx.invoice.update({ where: { id: a.invoiceId }, data: { status: 'PAID', amountPaid: invoice.total, paidAt: a.now } });
  if (invoice.subscription) await activate(tx, a.tenantId, a.actorUserId, invoice.subscription, a.now, invoice.billingSnapshot);
  await requestDomainRegistration(tx, a.tenantId, a.invoiceId);

  const recipients = a.actorUserId
    ? [a.actorUserId]
    : (await tx.tenantMembership.findMany({ where: { tenantId: a.tenantId, status: 'ACTIVE', role: { key: 'TENANT_OWNER' } }, select: { userId: true } })).map((m) => m.userId);
  if (recipients.length) {
    await tx.notification.createMany({
      data: recipients.map((userId) => ({ userId, tenantId: a.tenantId, type: 'payment.succeeded', title: `Payment received for ${invoice.number}`, body: 'Your service is being set up.', link: `/invoices/${a.invoiceId}` })),
    });
  }
  await tx.auditLog.create({
    data: { action: 'payment.succeeded', actorId: a.actorUserId, tenantId: a.tenantId, entityType: 'invoice', entityId: a.invoiceId, metadata: { paymentId: a.paymentId, via: a.via } as Prisma.InputJsonValue },
  });
  return 'SETTLED';
}

/** A paid domain order becomes a task for staff, who register the name. The event is handled by the worker. */
async function requestDomainRegistration(tx: Tx, tenantId: string, invoiceId: string) {
  const domain = await tx.domain.findUnique({ where: { orderInvoiceId: invoiceId }, select: { id: true, name: true, status: true } });
  if (domain && domain.status === 'PENDING_REGISTRATION') {
    await tx.outboxEvent.createMany({ data: { tenantId, type: 'domain.registration_requested', aggregateType: 'domain', aggregateId: domain.id, payload: { domainId: domain.id, name: domain.name } } });
    return;
  }
  // A paid renewal is a task for staff as well: they renew the name at the registrar.
  const renewal = await tx.domainRenewal.findUnique({ where: { invoiceId }, select: { id: true, years: true, status: true, domain: { select: { id: true, name: true } } } });
  if (renewal && renewal.status === 'PENDING') {
    await tx.outboxEvent.createMany({ data: { tenantId, type: 'domain.renewal_requested', aggregateType: 'domain', aggregateId: renewal.domain.id, payload: { renewalId: renewal.id, domainId: renewal.domain.id, name: renewal.domain.name, years: renewal.years } } });
  }
}

/** First payment activates the subscription; a later one renews it from the end of the paid period. */
async function activate(tx: Tx, tenantId: string, actorUserId: string | null, sub: { id: string; status: SubscriptionStatus; billingCycle: BillingCycle; currentPeriodEnd: Date | null }, at: Date, snapshot: unknown) {
  const renewing = (sub.status === 'ACTIVE' || sub.status === 'PAST_DUE') && sub.currentPeriodEnd !== null;
  const start = renewing ? sub.currentPeriodEnd! : at;
  await tx.subscription.update({ where: { id: sub.id }, data: { status: 'ACTIVE', currentPeriodStart: start, currentPeriodEnd: addCycle(start, sub.billingCycle) } });
  await tx.subscriptionHistory.create({
    data: { tenantId, subscriptionId: sub.id, event: renewing ? 'RENEWED' : 'ACTIVATED', fromStatus: sub.status, toStatus: 'ACTIVE', actorUserId },
  });
  if (renewing) await applyPlanChange(tx, tenantId, actorUserId, sub.id, snapshot);
  // Provisioning is a Phase 6 worker concern; it will read this event.
  await tx.outboxEvent.createMany({ data: { tenantId, type: 'subscription.activated', aggregateType: 'subscription', aggregateId: sub.id, payload: { subscriptionId: sub.id, renewal: renewing } } });
}

/** A renewal invoice issued for a scheduled plan change switches the subscription to that plan once it is paid. */
async function applyPlanChange(tx: Tx, tenantId: string, actorUserId: string | null, subscriptionId: string, snapshot: unknown) {
  const change = (snapshot as { planChange?: { planId: string; pricingVersionId: string; description: string; unitPrice: string; renewalPrice: string } } | null)?.planChange;
  if (!change) return;
  const item = await tx.subscriptionItem.findFirst({ where: { subscriptionId }, orderBy: { createdAt: 'asc' } });
  if (!item || item.planId === change.planId) return;
  const upgrade = Number(change.renewalPrice) > Number(item.renewalPrice.toString());
  await tx.subscriptionItem.update({
    where: { id: item.id },
    data: { planId: change.planId, pricingVersionId: change.pricingVersionId, description: change.description, unitPrice: change.unitPrice, renewalPrice: change.renewalPrice },
  });
  await tx.subscription.update({ where: { id: subscriptionId }, data: { scheduledPlanId: null, scheduledAt: null } });
  await tx.subscriptionHistory.create({
    data: { tenantId, subscriptionId, event: upgrade ? 'UPGRADED' : 'DOWNGRADED', fromStatus: 'ACTIVE', toStatus: 'ACTIVE', actorUserId, details: { fromPlanId: item.planId, toPlanId: change.planId } },
  });
  await tx.outboxEvent.createMany({ data: { tenantId, type: 'subscription.plan_changed', aggregateType: 'subscription', aggregateId: subscriptionId, payload: { subscriptionId, fromPlanId: item.planId, toPlanId: change.planId } } });
}
