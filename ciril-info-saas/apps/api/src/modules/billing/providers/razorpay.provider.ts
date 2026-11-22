import { createHmac, timingSafeEqual } from 'node:crypto';
import { BadGatewayException, HttpException } from '@nestjs/common';
import type {
  CardChargeRequest, CardChargeResult, CardHolder, CheckoutConfirmation, OrderRequest, OrderResult, PaymentProvider, ProviderDispute, ProviderPayment, RefundRequest, RefundResult,
  SaveCardTerms, SavedCardInfo, WebhookEvent,
} from './payment-provider.js';

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  /** https://api.razorpay.com/v1 unless a test points it at a local fake. */
  apiBase: string;
}

/** Constant-time comparison of two hex signatures. */
function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

interface RzpPayment {
  id: string;
  order_id?: string | null;
  token_id?: string | null;
  status?: string;
  amount?: number;
  currency?: string;
  method?: string | null;
  error_description?: string | null;
}

const toPayment = (p: RzpPayment): ProviderPayment => ({
  providerPaymentId: p.id,
  providerOrderId: p.order_id ?? null,
  status: p.status === 'captured' || p.status === 'authorized' || p.status === 'failed' || p.status === 'created' || p.status === 'refunded' ? p.status : 'other',
  amountPaise: p.amount ?? 0,
  currency: p.currency ?? 'INR',
  method: p.method ?? null,
  failureReason: p.error_description ?? null,
});

interface RzpToken {
  id: string;
  card?: { last4?: string | null; network?: string | null; expiry_month?: number | string | null; expiry_year?: number | string | null } | null;
  recurring_details?: { status?: string | null; failure_reason?: string | null } | null;
  expired_at?: number | null;
}

interface RzpDispute {
  id: string;
  payment_id?: string;
  amount?: number;
  amount_deducted?: number;
  currency?: string;
  status?: string;
  phase?: string | null;
  reason_code?: string | null;
  reason_description?: string | null;
  respond_by?: number | null;
}

const DISPUTE_STATUS: Record<string, ProviderDispute['status']> = { open: 'OPEN', under_review: 'UNDER_REVIEW', won: 'WON', lost: 'LOST', closed: 'CLOSED' };

const num = (v: number | string | null | undefined) => (v === null || v === undefined || v === '' ? null : Number(v));

/** Razorpay's "recurring_details.status": confirmed by the bank, still initiated, rejected, or cancelled/paused/expired. */
const toCard = (t: RzpToken): SavedCardInfo => {
  const s = t.recurring_details?.status ?? 'initiated';
  const expired = t.expired_at ? t.expired_at * 1000 < Date.now() : false;
  return {
    tokenId: t.id,
    state: expired ? 'GONE' : s === 'confirmed' ? 'ACTIVE' : s === 'initiated' ? 'PENDING' : s === 'rejected' ? 'REJECTED' : 'GONE',
    network: t.card?.network ?? null,
    last4: t.card?.last4 ? String(t.card.last4).slice(-4) : null,
    expiryMonth: num(t.card?.expiry_month),
    expiryYear: num(t.card?.expiry_year),
    failureReason: t.recurring_details?.failure_reason ?? null,
  };
};

/** How long a standing instruction lasts at most. The card's own expiry usually ends it sooner. */
const MANDATE_YEARS = 10;

/**
 * Razorpay (hosted checkout). The customer pays in Razorpay's modal; we trust a result only after checking Razorpay's
 * HMAC signature, either on the browser's confirmation (key secret) or on the webhook (webhook secret). API calls use
 * HTTP Basic auth with the key pair. No card data ever reaches this server.
 */
export class RazorpayProvider implements PaymentProvider {
  readonly id = 'RAZORPAY' as const;
  readonly mode = 'hosted' as const;

  constructor(private readonly cfg: RazorpayConfig) {}

  private async call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.cfg.apiBase}${path}`, {
        method,
        headers: {
          authorization: `Basic ${Buffer.from(`${this.cfg.keyId}:${this.cfg.keySecret}`).toString('base64')}`,
          'content-type': 'application/json',
          ...extraHeaders,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new BadGatewayException({ code: 'PAYMENT_PROVIDER_UNREACHABLE', message: 'The payment service could not be reached. Please try again in a moment.' });
    }
    const json = (await res.json().catch(() => ({}))) as { error?: { description?: string } } & T;
    if (!res.ok) {
      // The provider's wording is kept for our logs through the thrown message; the customer gets a plain sentence.
      throw new BadGatewayException({ code: 'PAYMENT_PROVIDER_ERROR', message: 'The payment service could not process this request.', details: { status: res.status, reason: json.error?.description } });
    }
    return json;
  }

  async createOrder(req: OrderRequest): Promise<OrderResult> {
    // Saving the card makes this the "authorisation" payment of a card standing instruction (Razorpay recurring payments):
    // card only, tied to the customer record, with the most a later charge may take.
    const save = req.saveCard
      ? { customer_id: req.saveCard.customerId, method: 'card', token: { max_amount: req.saveCard.maxAmountPaise, expire_at: Math.floor(Date.now() / 1000) + MANDATE_YEARS * 365 * 86_400, frequency: 'as_presented' } }
      : {};
    const order = await this.call<{ id: string }>('POST', '/orders', { amount: req.amountPaise, currency: req.currency, receipt: req.receipt.slice(0, 40), notes: req.notes, ...save });
    return { providerOrderId: order.id, checkout: this.checkoutParams(order.id, req.saveCard) };
  }

  checkoutParams(providerOrderId: string, saveCard?: SaveCardTerms) {
    return { keyId: this.cfg.keyId, orderId: providerOrderId, ...(saveCard ? { customerId: saveCard.customerId, recurring: '1' } : {}) };
  }

  /** fail_existing=0 returns the customer Razorpay already has for this email and phone instead of refusing. */
  async ensureCustomer(h: CardHolder): Promise<string> {
    const c = await this.call<{ id: string }>('POST', '/customers', { name: h.name.slice(0, 50), email: h.email, contact: h.contact, fail_existing: '0' });
    return c.id;
  }

  async card(customerId: string, tokenId: string): Promise<SavedCardInfo | null> {
    const r = await this.call<{ items?: RzpToken[] }>('GET', `/customers/${encodeURIComponent(customerId)}/tokens`);
    const t = (r.items ?? []).find((x) => x.id === tokenId);
    return t ? toCard(t) : null;
  }

  async cardForPayment(customerId: string, providerPaymentId: string): Promise<SavedCardInfo | null> {
    const p = await this.call<RzpPayment>('GET', `/payments/${encodeURIComponent(providerPaymentId)}`);
    if (!p.token_id) return null;
    return (await this.card(customerId, p.token_id)) ?? { tokenId: p.token_id, state: 'PENDING', network: null, last4: null, expiryMonth: null, expiryYear: null, failureReason: null };
  }

  async removeCard(customerId: string, tokenId: string): Promise<void> {
    await this.call('DELETE', `/customers/${encodeURIComponent(customerId)}/tokens/${encodeURIComponent(tokenId)}`);
  }

  /**
   * A later charge on a saved card: Razorpay takes it without the customer, against an order we made. Its outcome
   * arrives by webhook (or our lookup), so a started charge is "pending". A refusal (4xx) is a failed charge with
   * Razorpay's reason; an outage throws, and the order is looked up later so nothing is charged twice.
   */
  async chargeCard(req: CardChargeRequest): Promise<CardChargeResult> {
    try {
      const r = await this.call<{ razorpay_payment_id?: string }>('POST', '/payments/create/recurring', {
        email: req.email, contact: req.contact, amount: req.amountPaise, currency: req.currency, order_id: req.providerOrderId,
        customer_id: req.customerId, token: req.tokenId, recurring: '1', description: req.description.slice(0, 255), notes: req.notes,
      });
      return { status: 'pending', providerPaymentId: r.razorpay_payment_id ?? null, failureReason: null };
    } catch (e) {
      const body = e instanceof HttpException ? (e.getResponse() as { details?: { status?: number; reason?: string } }) : undefined;
      const status = body?.details?.status;
      if (status && status >= 400 && status < 500 && status !== 401 && status !== 429) {
        return { status: 'failed', providerPaymentId: null, failureReason: body?.details?.reason ?? 'The card could not be charged.' };
      }
      throw e;
    }
  }

  /** Razorpay signs "<order_id>|<payment_id>" with the key secret. */
  verifyCheckout(c: CheckoutConfirmation): boolean {
    const expected = createHmac('sha256', this.cfg.keySecret).update(`${c.providerOrderId}|${c.providerPaymentId}`).digest('hex');
    return safeEqualHex(expected, c.signature);
  }

  async fetchPayment(providerPaymentId: string): Promise<ProviderPayment> {
    return toPayment(await this.call<RzpPayment>('GET', `/payments/${encodeURIComponent(providerPaymentId)}`));
  }

  async capture(providerPaymentId: string, amountPaise: number, currency: string): Promise<ProviderPayment> {
    return toPayment(await this.call<RzpPayment>('POST', `/payments/${encodeURIComponent(providerPaymentId)}/capture`, { amount: amountPaise, currency }));
  }

  async listOrderPayments(providerOrderId: string): Promise<ProviderPayment[]> {
    const r = await this.call<{ items?: RzpPayment[] }>('GET', `/orders/${encodeURIComponent(providerOrderId)}/payments`);
    return (r.items ?? []).map(toPayment);
  }

  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): WebhookEvent | null {
    const sig = headers['x-razorpay-signature'];
    const eventId = headers['x-razorpay-event-id'];
    if (typeof sig !== 'string' || typeof eventId !== 'string' || !eventId) return null;
    const expected = createHmac('sha256', this.cfg.webhookSecret).update(rawBody).digest('hex');
    if (!safeEqualHex(expected, sig)) return null;

    let body: { event?: string; payload?: { payment?: { entity?: RzpPayment }; token?: { entity?: RzpToken }; dispute?: { entity?: RzpDispute } } };
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return null;
    }
    const rawType = body.event ?? 'unknown';
    const p = body.payload?.payment?.entity;
    const base = { eventId, rawType, providerOrderId: p?.order_id ?? null, providerPaymentId: p?.id ?? null, amountPaise: p?.amount ?? null, currency: p?.currency ?? null, method: p?.method ?? null, failureReason: p?.error_description ?? null };
    // payment.captured is the money arriving. order.paid also carries the payment, so either settles it.
    if ((rawType === 'payment.captured' || rawType === 'order.paid') && p?.id) return { ...base, type: 'payment.succeeded' };
    if (rawType === 'payment.failed' && p?.id) return { ...base, type: 'payment.failed' };
    // A chargeback was raised, moved on, or decided (payment.dispute.created / under_review / action_required / won / lost / closed).
    const d = body.payload?.dispute?.entity;
    if (rawType.startsWith('payment.dispute.') && d?.id) {
      const paymentId = d.payment_id ?? p?.id;
      if (!paymentId) return { ...base, type: 'ignored' };
      const status = DISPUTE_STATUS[d.status ?? ''] ?? (rawType.endsWith('.won') ? 'WON' : rawType.endsWith('.lost') ? 'LOST' : rawType.endsWith('.closed') ? 'CLOSED' : rawType.endsWith('.under_review') ? 'UNDER_REVIEW' : 'OPEN');
      return {
        ...base, type: 'dispute.updated', providerPaymentId: paymentId,
        dispute: {
          id: d.id, providerPaymentId: paymentId, amountPaise: d.amount ?? p?.amount ?? 0, amountDeductedPaise: d.amount_deducted ?? 0, currency: d.currency ?? p?.currency ?? 'INR', status,
          phase: d.phase ?? null, reasonCode: d.reason_code ?? null, reason: d.reason_description ?? null, respondBy: d.respond_by ? new Date(d.respond_by * 1000) : null,
        },
      };
    }
    // A saved card's standing instruction was confirmed, rejected, paused or cancelled.
    const t = body.payload?.token?.entity;
    if (rawType.startsWith('token.') && t?.id) {
      const state: SavedCardInfo['state'] = rawType === 'token.confirmed' ? 'ACTIVE' : rawType === 'token.rejected' ? 'REJECTED' : rawType === 'token.paused' || rawType === 'token.cancelled' ? 'GONE' : toCard(t).state;
      return { ...base, type: 'token.updated', tokenId: t.id, tokenState: state, failureReason: t.recurring_details?.failure_reason ?? null };
    }
    return { ...base, type: 'ignored' };
  }

  async refund(req: RefundRequest): Promise<RefundResult> {
    if (!req.providerPaymentId) return { ok: false, providerRefundId: null, failureReason: 'The original payment has no provider reference.' };
    try {
      // The idempotency header makes a retried refund return the first one instead of refunding twice.
      const r = await this.call<{ id: string }>('POST', `/payments/${encodeURIComponent(req.providerPaymentId)}/refund`, { amount: req.amountPaise, notes: { refundId: req.idempotencyKey } }, { 'x-refund-idempotency': req.idempotencyKey });
      return { ok: true, providerRefundId: r.id, failureReason: null };
    } catch (e) {
      const body = e instanceof HttpException ? (e.getResponse() as { details?: { reason?: string } }) : undefined;
      return { ok: false, providerRefundId: null, failureReason: body?.details?.reason ?? 'The payment provider did not accept the refund.' };
    }
  }
}
