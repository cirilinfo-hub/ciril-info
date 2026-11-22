import { createHmac, timingSafeEqual } from 'node:crypto';
import { BadGatewayException, HttpException } from '@nestjs/common';
import type { OrderRequest, OrderResult, PaymentProvider, ProviderDispute, ProviderPayment, RefundRequest, RefundResult, WebhookEvent } from './payment-provider.js';

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  /** https://api.stripe.com unless a test points it at a local fake. */
  apiBase: string;
  /** How old a signed webhook may be, in seconds (Stripe's own libraries use 300). */
  toleranceSeconds?: number;
}

interface StripeSession {
  id: string;
  url?: string | null;
  status?: 'open' | 'complete' | 'expired';
  payment_status?: 'paid' | 'unpaid' | 'no_payment_required';
  amount_total?: number | null;
  currency?: string | null;
  payment_intent?: string | null;
}

interface StripeDispute {
  id: string;
  payment_intent?: string | null;
  amount?: number;
  currency?: string;
  reason?: string | null;
  status?: string;
  evidence_details?: { due_by?: number | null } | null;
  balance_transactions?: { amount?: number }[];
}

/** Stripe's form encoding of nested values: a[b][c]=v. */
function form(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) return [];
    if (typeof v === 'object') return form(v as Record<string, unknown>, key);
    return [`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`];
  });
}

const toPayment = (s: StripeSession): ProviderPayment => ({
  providerPaymentId: s.payment_intent ?? s.id,
  providerOrderId: s.id,
  status: s.payment_status === 'paid' ? 'captured' : s.status === 'expired' ? 'failed' : 'created',
  amountPaise: s.amount_total ?? 0,
  currency: (s.currency ?? 'inr').toUpperCase(),
  method: 'card',
  failureReason: s.status === 'expired' ? 'The Stripe checkout expired before it was paid.' : null,
});

/** Stripe's dispute statuses, in our words. "warning_*" are early fraud warnings that may turn into a chargeback. */
const DISPUTE_STATUS: Record<string, ProviderDispute['status']> = {
  warning_needs_response: 'OPEN', needs_response: 'OPEN', warning_under_review: 'UNDER_REVIEW', under_review: 'UNDER_REVIEW',
  won: 'WON', lost: 'LOST', warning_closed: 'CLOSED', charge_refunded: 'CLOSED',
};

/**
 * Stripe (hosted Checkout), used alongside Razorpay for international cards. The customer pays on Stripe's own page and
 * comes back; a payment counts only once Stripe's API (asked by us) or its signed webhook says the session is paid, and
 * the amount and currency match what we asked for. No card data ever reaches this server.
 */
export class StripeProvider implements PaymentProvider {
  readonly id = 'STRIPE' as const;
  readonly mode = 'hosted' as const;

  constructor(private readonly cfg: StripeConfig) {}

  private async call<T>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.cfg.apiBase}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.cfg.secretKey}`,
          'content-type': 'application/x-www-form-urlencoded',
          'stripe-version': '2024-06-20',
          ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
        },
        body: body ? form(body).join('&') : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new BadGatewayException({ code: 'PAYMENT_PROVIDER_UNREACHABLE', message: 'The payment service could not be reached. Please try again in a moment.' });
    }
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T;
    if (!res.ok) throw new BadGatewayException({ code: 'PAYMENT_PROVIDER_ERROR', message: 'The payment service could not process this request.', details: { status: res.status, reason: json.error?.message } });
    return json;
  }

  /** A Checkout Session for the exact amount. The browser is sent to its URL; Stripe sends the customer back to returnUrl. */
  async createOrder(req: OrderRequest): Promise<OrderResult> {
    const back = req.returnUrl ?? '';
    const session = await this.call<StripeSession>('POST', '/v1/checkout/sessions', {
      mode: 'payment',
      line_items: { 0: { quantity: 1, price_data: { currency: req.currency.toLowerCase(), unit_amount: req.amountPaise, product_data: { name: req.description ?? `Invoice ${req.receipt}` } } } },
      success_url: `${back}${back.includes('?') ? '&' : '?'}stripe=success&session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${back}${back.includes('?') ? '&' : '?'}stripe=cancelled`,
      client_reference_id: req.receipt.slice(0, 200),
      ...(req.customerEmail ? { customer_email: req.customerEmail } : {}),
      metadata: req.notes,
      payment_intent_data: { metadata: req.notes, description: req.description ?? `Invoice ${req.receipt}` },
    }, req.idempotencyKey);
    return { providerOrderId: session.id, checkout: { redirectUrl: session.url ?? '' } };
  }

  async fetchPayment(sessionId: string): Promise<ProviderPayment> {
    return toPayment(await this.call<StripeSession>('GET', `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`));
  }

  /** A session is one payment attempt, so "the payments for this order" is just the session's own state. */
  async listOrderPayments(sessionId: string): Promise<ProviderPayment[]> {
    const p = await this.fetchPayment(sessionId);
    return p.status === 'created' ? [] : [p];
  }

  /** Stripe-Signature: t=<seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with the webhook secret>. */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): WebhookEvent | null {
    const header = headers['stripe-signature'];
    if (typeof header !== 'string') return null;
    const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]).filter((p) => p.length === 2));
    const t = Number(parts['t']);
    const signatures = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
    if (!Number.isFinite(t) || !signatures.length) return null;
    if (Math.abs(Date.now() / 1000 - t) > (this.cfg.toleranceSeconds ?? 300)) return null;
    const expected = createHmac('sha256', this.cfg.webhookSecret).update(`${t}.`).update(rawBody).digest('hex');
    const ok = signatures.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
    if (!ok) return null;

    let body: { id?: string; type?: string; data?: { object?: StripeSession } };
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return null;
    }
    const rawType = body.type ?? 'unknown';
    const o = body.data?.object;
    const base = { eventId: body.id ?? `stripe-${t}`, rawType, providerOrderId: null, providerPaymentId: null, amountPaise: null, currency: null, method: null, failureReason: null };
    if (!o) return { ...base, type: 'ignored' };

    if (rawType === 'checkout.session.completed' || rawType === 'checkout.session.async_payment_succeeded') {
      if (o.payment_status !== 'paid') return { ...base, type: 'ignored' }; // a delayed method: wait for async_payment_succeeded
      const p = toPayment(o);
      return { ...base, type: 'payment.succeeded', providerOrderId: p.providerOrderId, providerPaymentId: p.providerPaymentId, amountPaise: p.amountPaise, currency: p.currency, method: 'card' };
    }
    if (rawType === 'checkout.session.async_payment_failed' || rawType === 'checkout.session.expired') {
      return { ...base, type: 'payment.failed', providerOrderId: o.id, failureReason: rawType === 'checkout.session.expired' ? 'The Stripe checkout expired before it was paid.' : 'The payment did not go through.' };
    }
    const d = o as unknown as StripeDispute;
    if (rawType.startsWith('charge.dispute.') && d.payment_intent) {
      const deducted = rawType === 'charge.dispute.funds_withdrawn' || d.status === 'lost' ? (d.amount ?? 0) : 0;
      return {
        ...base, type: 'dispute.updated', providerPaymentId: d.payment_intent,
        dispute: {
          id: d.id, providerPaymentId: d.payment_intent, amountPaise: d.amount ?? 0, amountDeductedPaise: deducted, currency: (d.currency ?? 'inr').toUpperCase(),
          status: DISPUTE_STATUS[d.status ?? ''] ?? 'OPEN', phase: d.status?.startsWith('warning_') ? 'early_warning' : 'chargeback', reasonCode: d.reason ?? null,
          reason: d.reason ? d.reason.replace(/_/g, ' ') : null, respondBy: d.evidence_details?.due_by ? new Date(d.evidence_details.due_by * 1000) : null,
        },
      };
    }
    return { ...base, type: 'ignored' };
  }

  async refund(req: RefundRequest): Promise<RefundResult> {
    if (!req.providerPaymentId) return { ok: false, providerRefundId: null, failureReason: 'The original payment has no provider reference.' };
    try {
      const r = await this.call<{ id: string; status?: string }>('POST', '/v1/refunds', { payment_intent: req.providerPaymentId, amount: req.amountPaise, metadata: { refundId: req.idempotencyKey } }, req.idempotencyKey);
      if (r.status === 'failed' || r.status === 'canceled') return { ok: false, providerRefundId: r.id, failureReason: 'Stripe could not refund this payment.' };
      return { ok: true, providerRefundId: r.id, failureReason: null };
    } catch (e) {
      const body = e instanceof HttpException ? (e.getResponse() as { details?: { reason?: string } }) : undefined;
      return { ok: false, providerRefundId: null, failureReason: body?.details?.reason ?? 'Stripe did not accept the refund.' };
    }
  }
}
