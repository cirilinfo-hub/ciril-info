import { createHmac, timingSafeEqual } from 'node:crypto';
import { BadGatewayException, HttpException } from '@nestjs/common';
import type {
  CheckoutConfirmation, OrderRequest, OrderResult, PaymentProvider, ProviderPayment, RefundRequest, RefundResult, WebhookEvent,
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

/**
 * Razorpay (hosted checkout). The customer pays in Razorpay's modal; we trust a result only after checking Razorpay's
 * HMAC signature, either on the browser's confirmation (key secret) or on the webhook (webhook secret). API calls use
 * HTTP Basic auth with the key pair. No card data ever reaches this server.
 */
export class RazorpayProvider implements PaymentProvider {
  readonly id = 'RAZORPAY' as const;
  readonly mode = 'hosted' as const;

  constructor(private readonly cfg: RazorpayConfig) {}

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
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
    const order = await this.call<{ id: string }>('POST', '/orders', { amount: req.amountPaise, currency: req.currency, receipt: req.receipt.slice(0, 40), notes: req.notes });
    return { providerOrderId: order.id, checkout: { keyId: this.cfg.keyId, orderId: order.id } };
  }

  checkoutParams(providerOrderId: string) {
    return { keyId: this.cfg.keyId, orderId: providerOrderId };
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

    let body: { event?: string; payload?: { payment?: { entity?: RzpPayment } } };
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
