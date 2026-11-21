import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PaymentGateway } from './payment-gateway.js';
import { PaymentSettlementService } from './payment-settlement.service.js';
import { SavedCardsService } from './saved-cards.service.js';
import { DisputesService } from './disputes.service.js';

/**
 * Inbound payment webhooks. The signature is checked on the exact bytes received before anything is read from the body.
 * Every verified delivery is stored first (unique per provider and event id), so a duplicate is recognised and a crash
 * midway leaves a row that a retry picks up. The reply is 200 once the event is safely handled or recorded as
 * something we do not act on; a failure while processing answers 500 so the provider sends it again.
 */
@Injectable()
export class PaymentWebhookService {
  private readonly log = new Logger(PaymentWebhookService.name);

  constructor(
    private readonly db: PlatformPrisma,
    private readonly gateway: PaymentGateway,
    private readonly settlement: PaymentSettlementService,
    private readonly cards: SavedCardsService,
    private readonly disputes: DisputesService,
  ) {}

  async handle(providerParam: string, raw: Buffer | undefined, headers: Record<string, string | string[] | undefined>) {
    // Only the configured provider has a webhook; the others answer as if the address did not exist.
    if (providerParam.toUpperCase() !== this.gateway.id) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found.' });
    if (!raw?.length) throw new BadRequestException({ code: 'INVALID_WEBHOOK', message: 'Empty body.' });

    const event = this.gateway.parseWebhook(raw, headers);
    if (!event) {
      this.log.warn(`webhook with an invalid signature rejected (${this.gateway.id})`);
      throw new BadRequestException({ code: 'INVALID_SIGNATURE', message: 'Invalid signature.' });
    }

    let payload: Prisma.InputJsonValue = {};
    try {
      payload = JSON.parse(raw.toString('utf8')) as Prisma.InputJsonValue;
    } catch {
      // parseWebhook already parsed it; this cannot happen for a verified body.
    }

    // Store first. A unique violation means we have seen this delivery before.
    let rowId: string;
    try {
      rowId = (await this.db.paymentWebhook.create({ data: { provider: this.gateway.id, eventId: event.eventId, eventType: event.rawType, signatureOk: true, payload }, select: { id: true } })).id;
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e;
      const prior = await this.db.paymentWebhook.findUniqueOrThrow({ where: { provider_eventId: { provider: this.gateway.id, eventId: event.eventId } }, select: { id: true, processedAt: true } });
      if (prior.processedAt) return { received: true, duplicate: true };
      rowId = prior.id; // an earlier attempt did not finish: process it now
    }

    try {
      const error = await this.process(event);
      await this.db.paymentWebhook.update({ where: { id: rowId }, data: { processedAt: new Date(), error } });
      return { received: true };
    } catch (e) {
      await this.db.paymentWebhook.update({ where: { id: rowId }, data: { error: (e as Error).message.slice(0, 500) } }).catch(() => undefined);
      throw e; // 500: the provider will retry
    }
  }

  /** Returns a note to store when the event needed attention but is not worth retrying, otherwise null. */
  private async process(event: NonNullable<ReturnType<PaymentGateway['parseWebhook']>>): Promise<string | null> {
    if (event.type === 'ignored') return null;
    if (event.type === 'dispute.updated') return event.dispute ? this.disputes.apply(event.dispute) : 'no dispute';
    if (event.type === 'token.updated') return event.tokenId && event.tokenState ? this.cards.applyState(event.tokenId, event.tokenState, event.failureReason) : 'no token';
    if (!event.providerOrderId) return 'no order reference';
    const payment = await this.db.payment.findFirst({ where: { provider: this.gateway.id, providerOrderId: event.providerOrderId }, select: { id: true } });
    // An order we never created (the provider account may serve other things): nothing to do, and nothing to retry.
    if (!payment) return 'no payment for this order';

    const outcome = await this.settlement.apply(
      payment.id,
      {
        status: event.type === 'payment.succeeded' ? 'captured' : 'failed',
        providerPaymentId: event.providerPaymentId, providerOrderId: event.providerOrderId, amountPaise: event.amountPaise, currency: event.currency, method: event.method, failureReason: event.failureReason,
      },
      'webhook',
    );
    return outcome === 'MISMATCH' ? 'amount or order mismatch: not recorded' : outcome === 'ORPHANED' ? 'payment for a closed invoice: needs a refund' : null;
  }
}
