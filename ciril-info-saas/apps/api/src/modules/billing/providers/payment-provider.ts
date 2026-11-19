/**
 * The boundary between our billing code and a payment company. Everything provider-specific (URLs, signatures,
 * field names) lives behind this, so adding Stripe means writing one class, not touching billing.
 *
 * Two shapes exist:
 *  - "instant" (the test-mode mock): charge() answers at once.
 *  - "hosted" (Razorpay, Stripe): we create an order, the customer pays on the provider's page or modal, and success
 *    reaches us twice: the browser reports it (verified by signature) and the provider's signed webhook confirms it.
 *    Money is only ever recorded after a signature has been verified.
 */
export type ProviderId = 'MOCK' | 'RAZORPAY' | 'STRIPE';

export interface ChargeRequest {
  amountPaise: number;
  currency: string;
  invoiceNumber: string;
  idempotencyKey: string;
  /** Test hook honoured by the mock adapter only. */
  simulate?: 'fail';
}

export interface ChargeResult {
  provider: ProviderId;
  ok: boolean;
  providerOrderId: string;
  providerPaymentId: string | null;
  method: string | null;
  failureReason: string | null;
}

export interface OrderRequest {
  amountPaise: number;
  currency: string;
  /** Shown on the provider's records. At most 40 characters (an invoice number). */
  receipt: string;
  /** Sent to the provider so a retry returns the same order instead of making a second. */
  idempotencyKey: string;
  notes: Record<string, string>;
}

export interface OrderResult {
  providerOrderId: string;
  /** What the browser needs to open the provider's checkout. Never contains a secret. */
  checkout: Record<string, string | number>;
}

export interface CheckoutConfirmation {
  providerOrderId: string;
  providerPaymentId: string;
  signature: string;
}

export interface ProviderPayment {
  providerPaymentId: string;
  providerOrderId: string | null;
  status: 'captured' | 'authorized' | 'failed' | 'created' | 'refunded' | 'other';
  amountPaise: number;
  currency: string;
  method: string | null;
  failureReason: string | null;
}

/** A webhook, reduced to what billing acts on. */
export interface WebhookEvent {
  /** The provider's unique id for this delivery. Used to drop duplicates. */
  eventId: string;
  /** The provider's own name for it, kept for the audit trail. */
  rawType: string;
  type: 'payment.succeeded' | 'payment.failed' | 'ignored';
  providerOrderId: string | null;
  providerPaymentId: string | null;
  amountPaise: number | null;
  currency: string | null;
  method: string | null;
  failureReason: string | null;
}

export interface RefundRequest {
  providerPaymentId: string | null;
  amountPaise: number;
  currency: string;
  idempotencyKey: string;
}

export interface RefundResult {
  ok: boolean;
  providerRefundId: string | null;
  failureReason: string | null;
}

export interface PaymentProvider {
  readonly id: ProviderId;
  readonly mode: 'instant' | 'hosted';

  /** Instant providers only. */
  charge?(req: ChargeRequest): Promise<ChargeResult>;

  /** Hosted providers only. */
  createOrder?(req: OrderRequest): Promise<OrderResult>;
  /** What the browser needs to (re)open checkout for an order that already exists. */
  checkoutParams?(providerOrderId: string): Record<string, string | number>;
  /** True only when the signature proves the provider (and nobody else) produced this payment. */
  verifyCheckout?(c: CheckoutConfirmation): boolean;
  fetchPayment?(providerPaymentId: string): Promise<ProviderPayment>;
  /** Takes the money for a payment the customer authorised but the provider has not captured yet. */
  capture?(providerPaymentId: string, amountPaise: number, currency: string): Promise<ProviderPayment>;
  /** Payments the provider holds against an order. Used to catch webhooks that never arrived. */
  listOrderPayments?(providerOrderId: string): Promise<ProviderPayment[]>;
  /** Returns the event if the signature is valid, otherwise null. Never trust the body before this. */
  parseWebhook?(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): WebhookEvent | null;

  refund(req: RefundRequest): Promise<RefundResult>;
}
