import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PlatformPrisma, TenantPrisma } from '../../database/prisma-clients.js';
import type { SavedCardStatus } from '../../generated/prisma/client.js';
import type { RequestMeta, TenantContext } from '../auth/auth.types.js';
import { StaffNotifier } from '../notifications/staff-notifier.service.js';
import { PaymentGateway } from './payment-gateway.js';
import type { SavedCardInfo } from './providers/payment-provider.js';
import { cardContact, cardLabel } from './saved-cards.logic.js';

const LIVE: SavedCardStatus[] = ['PENDING', 'ACTIVE'];

const cardSelect = {
  id: true, status: true, network: true, last4: true, expiryMonth: true, expiryYear: true, maxAmount: true, autoPay: true, failureReason: true, createdAt: true, confirmedAt: true,
} as const;

/**
 * Cards saved for automatic renewal payments. The card is typed into the provider's own window and stays with the
 * provider; we keep its token id and what lets the customer recognise it. A card is saved only when a payment the
 * customer made with "save this card" ticked has succeeded, and an organisation has one card in use at a time.
 */
@Injectable()
export class SavedCardsService {
  private readonly log = new Logger(SavedCardsService.name);

  constructor(
    private readonly db: PlatformPrisma,
    private readonly tenantDb: TenantPrisma,
    private readonly gateway: PaymentGateway,
    private readonly staff: StaffNotifier,
  ) {}

  get available() {
    return this.gateway.savesCards;
  }

  // ───────────────────────────── customer portal ─────────────────────────────

  view(ctx: TenantContext) {
    return this.tenantDb.run(ctx, async (tx) => ({
      available: this.available,
      card: await tx.savedCard.findFirst({ where: { status: { in: LIVE } }, select: cardSelect }),
    }));
  }

  setAutoPay(ctx: TenantContext, autoPay: boolean, meta: RequestMeta) {
    return this.tenantDb.run(ctx, async (tx) => {
      const card = await tx.savedCard.findFirst({ where: { status: { in: LIVE } }, select: { id: true } });
      if (!card) throw new NotFoundException({ code: 'NO_SAVED_CARD', message: 'There is no saved card.' });
      await tx.savedCard.update({ where: { id: card.id }, data: { autoPay } });
      await tx.auditLog.create({ data: { action: autoPay ? 'card.autopay_on' : 'card.autopay_off', actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'saved_card', entityId: card.id, ipAddress: meta.ip ?? null, requestId: meta.requestId } });
      return { available: this.available, card: await tx.savedCard.findUniqueOrThrow({ where: { id: card.id }, select: cardSelect }) };
    });
  }

  /** The card is taken out of use here first, so it can never be charged again, then deleted at the provider. */
  async remove(ctx: TenantContext, meta: RequestMeta) {
    const card = await this.tenantDb.run(ctx, async (tx) => {
      const c = await tx.savedCard.findFirst({ where: { status: { in: LIVE } }, select: { id: true, providerCustomerId: true, providerTokenId: true, network: true, last4: true } });
      if (!c) throw new NotFoundException({ code: 'NO_SAVED_CARD', message: 'There is no saved card.' });
      await tx.savedCard.update({ where: { id: c.id }, data: { status: 'REMOVED', removedAt: new Date(), autoPay: false } });
      await tx.auditLog.create({ data: { action: 'card.removed', actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'saved_card', entityId: c.id, ipAddress: meta.ip ?? null, requestId: meta.requestId } });
      return c;
    });
    await this.deleteAtProvider(ctx.tenantId, card);
    return { available: this.available, card: null };
  }

  // ───────────────────────────── saving a card ─────────────────────────────

  /** Who the provider's customer record is for. Card standing instructions need a phone number. */
  async holder(tenantId: string) {
    const [acct, owner] = await Promise.all([
      this.db.customerAccount.findUnique({ where: { tenantId }, select: { companyName: true, billingEmail: true, phone: true } }),
      this.db.tenantMembership.findFirst({ where: { tenantId, status: 'ACTIVE', role: { key: 'TENANT_OWNER' } }, orderBy: { createdAt: 'asc' }, select: { user: { select: { firstName: true, lastName: true, email: true, phone: true } } } }),
    ]);
    const contact = cardContact(acct?.phone) ?? cardContact(owner?.user.phone);
    const name = acct?.companyName || (owner ? `${owner.user.firstName} ${owner.user.lastName}` : 'Customer');
    return { name, email: acct?.billingEmail ?? owner?.user.email ?? '', contact };
  }

  /** The provider's customer record for this organisation: made, and remembered, the first time a card is saved. */
  async customerId(tenantId: string): Promise<string> {
    const acct = await this.db.customerAccount.findUnique({ where: { tenantId }, select: { paymentCustomerId: true } });
    if (acct?.paymentCustomerId) return acct.paymentCustomerId;
    const h = await this.holder(tenantId);
    if (!h.contact) throw new ConflictException({ code: 'PHONE_NEEDED', message: 'Add a phone number under Organisation before saving a card. Banks need it for automatic payments.' });
    const id = await this.gateway.ensureCustomer({ name: h.name, email: h.email, contact: h.contact });
    await this.db.customerAccount.updateMany({ where: { tenantId, paymentCustomerId: null }, data: { paymentCustomerId: id } });
    return id;
  }

  /**
   * A payment made with "save this card" has succeeded: ask the provider which card it left behind and keep it. It
   * replaces the card the organisation had. Never throws: the payment is already settled whatever happens here.
   */
  async adopt(paymentId: string, actorUserId: string | null = null): Promise<void> {
    const p = await this.db.payment.findUnique({ where: { id: paymentId }, select: { tenantId: true, savesCard: true, status: true, providerPaymentId: true, invoice: { select: { number: true } } } });
    if (!p?.savesCard || p.status !== 'SUCCEEDED' || !p.providerPaymentId || !this.available) return;
    try {
      const customerId = await this.customerId(p.tenantId);
      const info = await this.gateway.cardForPayment(customerId, p.providerPaymentId);
      if (!info) {
        await this.db.auditLog.create({ data: { action: 'card.not_saved', tenantId: p.tenantId, entityType: 'payment', entityId: paymentId } });
        await this.notifyOwners(p.tenantId, { type: 'card.not_saved', title: 'Your card was not saved', body: `The payment for ${p.invoice.number} went through, but the card was not saved for automatic payments. Tick “save this card” when you next pay by card.`, link: '/invoices' });
        return;
      }
      await this.record(p.tenantId, customerId, info, actorUserId);
    } catch (e) {
      this.log.error(`saving the card from payment ${paymentId} failed: ${(e as Error).message}`);
      await this.db.auditLog.create({ data: { action: 'card.save_failed', tenantId: p.tenantId, entityType: 'payment', entityId: paymentId, metadata: { reason: (e as Error).message.slice(0, 200) } } }).catch(() => undefined);
    }
  }

  private async record(tenantId: string, customerId: string, info: SavedCardInfo, actorUserId: string | null) {
    const known = await this.db.savedCard.findUnique({ where: { provider_providerTokenId: { provider: this.gateway.id, providerTokenId: info.tokenId } }, select: { id: true } });
    if (known) return;
    const status: SavedCardStatus = info.state === 'ACTIVE' ? 'ACTIVE' : info.state === 'PENDING' ? 'PENDING' : 'REJECTED';
    const now = new Date();
    let replaced: { id: string; providerCustomerId: string; providerTokenId: string }[] = [];
    try {
      replaced = await this.db.$transaction(async (tx) => {
        const old = status === 'REJECTED' ? [] : await tx.savedCard.findMany({ where: { tenantId, status: { in: LIVE } }, select: { id: true, providerCustomerId: true, providerTokenId: true } });
        if (old.length) await tx.savedCard.updateMany({ where: { id: { in: old.map((o) => o.id) } }, data: { status: 'REMOVED', removedAt: now, autoPay: false, failureReason: 'Replaced by a newer card.' } });
        const card = await tx.savedCard.create({
          data: {
            tenantId, provider: this.gateway.id, providerCustomerId: customerId, providerTokenId: info.tokenId, status, network: info.network, last4: info.last4,
            expiryMonth: info.expiryMonth, expiryYear: info.expiryYear, maxAmount: (this.gateway.autopayMaxPaise / 100).toFixed(2), createdBy: actorUserId,
            confirmedAt: status === 'ACTIVE' ? now : null, failureReason: status === 'REJECTED' ? (info.failureReason ?? 'Your bank did not allow automatic payments on this card.').slice(0, 255) : null,
          },
          select: { id: true },
        });
        await tx.auditLog.create({ data: { action: status === 'REJECTED' ? 'card.rejected' : 'card.saved', actorId: actorUserId, tenantId, entityType: 'saved_card', entityId: card.id, metadata: { network: info.network, last4: info.last4, replaced: old.length } } });
        return old;
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return; // saved by a parallel signal for the same payment
      throw e;
    }
    const label = cardLabel(info);
    await this.notifyOwners(tenantId, status === 'REJECTED'
      ? { type: 'card.rejected', title: 'Your card cannot be used for automatic payments', body: `Your bank did not allow automatic payments on your ${label}. Your renewals will need to be paid by hand.`, link: '/invoices' }
      : { type: 'card.saved', title: 'Card saved for automatic payments', body: `Renewal invoices will be charged to your ${label}. You can switch this off or remove the card under Invoices.`, link: '/invoices' });
    for (const o of replaced) await this.deleteAtProvider(tenantId, o);
  }

  // ───────────────────────────── the provider's side ─────────────────────────────

  /** The provider says the card's standing instruction was confirmed, rejected, paused or cancelled. */
  async applyState(tokenId: string, state: SavedCardInfo['state'], reason: string | null): Promise<string | null> {
    const card = await this.db.savedCard.findUnique({ where: { provider_providerTokenId: { provider: this.gateway.id, providerTokenId: tokenId } }, select: { id: true, tenantId: true, status: true, network: true, last4: true } });
    if (!card) return 'no saved card for this token';
    if (card.status === 'REMOVED' || card.status === 'REJECTED') return null;
    const label = cardLabel(card);
    if (state === 'ACTIVE') {
      if (card.status === 'PENDING') await this.db.savedCard.update({ where: { id: card.id }, data: { status: 'ACTIVE', confirmedAt: new Date() } });
      return null;
    }
    if (state === 'PENDING') return null;
    const rejected = state === 'REJECTED';
    await this.db.savedCard.update({
      where: { id: card.id },
      data: rejected
        ? { status: 'REJECTED', autoPay: false, failureReason: (reason ?? 'Your bank did not allow automatic payments on this card.').slice(0, 255) }
        : { status: 'REMOVED', autoPay: false, removedAt: new Date(), failureReason: (reason ?? 'Cancelled at the bank or the card provider.').slice(0, 255) },
    });
    await this.db.auditLog.create({ data: { action: rejected ? 'card.rejected' : 'card.cancelled', tenantId: card.tenantId, entityType: 'saved_card', entityId: card.id, metadata: { reason } } });
    await this.notifyOwners(card.tenantId, {
      type: rejected ? 'card.rejected' : 'card.cancelled',
      title: rejected ? 'Your card cannot be used for automatic payments' : 'Automatic payments have stopped',
      body: rejected ? `Your bank did not allow automatic payments on your ${label}.` : `Automatic payments on your ${label} were cancelled at the bank. Renewals will need to be paid by hand, or save a card again when you next pay.`,
      link: '/invoices',
    });
    return null;
  }

  /** Cards still waiting for the bank ten minutes on are looked up, in case the provider's webhook never came. */
  async refreshPending(now = new Date()): Promise<number> {
    if (!this.available) return 0;
    const waiting = await this.db.savedCard.findMany({ where: { provider: this.gateway.id, status: 'PENDING', createdAt: { lt: new Date(now.getTime() - 10 * 60_000) } }, select: { providerCustomerId: true, providerTokenId: true }, take: 50 });
    let changed = 0;
    for (const c of waiting) {
      try {
        const info = await this.gateway.card(c.providerCustomerId, c.providerTokenId);
        const state = info?.state ?? 'GONE';
        if (state !== 'PENDING') {
          await this.applyState(c.providerTokenId, state, info?.failureReason ?? null);
          changed++;
        }
      } catch (e) {
        this.log.error(`saved card check failed for ${c.providerTokenId}: ${(e as Error).message}`);
      }
    }
    return changed;
  }

  private async deleteAtProvider(tenantId: string, c: { providerCustomerId: string; providerTokenId: string }) {
    try {
      await this.gateway.removeCard(c.providerCustomerId, c.providerTokenId);
    } catch (e) {
      // It can no longer be charged by us (it is not in use here), but staff should delete it at the provider too.
      this.log.warn(`deleting card ${c.providerTokenId} at the provider failed: ${(e as Error).message}`);
      await this.staff.notify('billing:write', { type: 'card.remove_failed', title: 'A removed card is still saved at the payment provider', body: `Delete token ${c.providerTokenId} (customer ${c.providerCustomerId}) in the provider's dashboard.`, link: '/invoices' }).catch(() => undefined);
      await this.db.auditLog.create({ data: { action: 'card.remove_failed', tenantId, entityType: 'saved_card', metadata: { token: c.providerTokenId } } }).catch(() => undefined);
    }
  }

  async notifyOwners(tenantId: string, n: { type: string; title: string; body: string; link: string }) {
    const owners = await this.db.tenantMembership.findMany({ where: { tenantId, status: 'ACTIVE', role: { key: 'TENANT_OWNER' } }, select: { userId: true } });
    if (owners.length) await this.db.notification.createMany({ data: owners.map((o) => ({ userId: o.userId, tenantId, type: n.type, title: n.title, body: n.body, link: n.link })) });
  }
}
