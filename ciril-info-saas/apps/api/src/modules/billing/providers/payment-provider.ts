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
  /** The customer also saves the card for automatic payments. The checkout is then card-only. */
  saveCard?: SaveCardTerms;
  /** Redirect checkouts (Stripe): where the customer comes back to, what the line says, and the email to prefill. */
  returnUrl?: string;
  description?: string;
  customerEmail?: string;
}

/** Saving a card: the provider's customer record, and the most one automatic charge may take. */
export interface SaveCardTerms {
  customerId: string;
  maxAmountPaise: number;
}

/** Who the provider's customer record is for. Card standing instructions need a phone number. */
export interface CardHolder {
  name: string;
  email: string;
  contact: string;
}

/** A card the provider keeps for us. Only what lets the customer recognise it: never the card number. */
export interface SavedCardInfo {
  tokenId: string;
  /** ACTIVE: the bank confirmed it and it can be charged. PENDING: not confirmed yet. GONE: cancelled, paused or expired. */
  state: 'ACTIVE' | 'PENDING' | 'REJECTED' | 'GONE';
  network: string | null;
  last4: string | null;
  expiryMonth: number | null;
  expiryYear: number | null;
  failureReason: string | null;
}

export interface CardChargeRequest {
  customerId: string;
  tokenId: string;
  providerOrderId: string;
  amountPaise: number;
  currency: string;
  email: string;
  contact: string;
  description: string;
  notes: Record<string, string>;
}

/** captured: the money is taken. pending: the provider is still working on it (its webhook or a later lookup decides). */
export interface CardChargeResult {
  status: 'captured' | 'pending' | 'failed';
  providerPaymentId: string | null;
  failureReason: string | null;
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
  type: 'payment.succeeded' | 'payment.failed' | 'token.updated' | 'dispute.updated' | 'ignored';
  providerOrderId: string | null;
  providerPaymentId: string | null;
  amountPaise: number | null;
  currency: string | null;
  method: string | null;
  failureReason: string | null;
  /** token.updated only: the saved card and what happened to it. */
  tokenId?: string | null;
  tokenState?: SavedCardInfo['state'];
  /** dispute.updated only: the chargeback as the provider describes it now. */
  dispute?: ProviderDispute;
}

/** A chargeback, reduced to what we keep. Amounts in paise. */
export interface ProviderDispute {
  id: string;
  providerPaymentId: string;
  amountPaise: number;
  amountDeductedPaise: number;
  currency: string;
  status: 'OPEN' | 'UNDER_REVIEW' | 'WON' | 'LOST' | 'CLOSED';
  phase: string | null;
  reasonCode: string | null;
  reason: string | null;
  respondBy: Date | null;
}

export interface RefundRequest {
  /** Which provider took the payment, when more than one is connected. */
  provider?: ProviderId | 'MANUAL';
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
  checkoutParams?(providerOrderId: string, saveCard?: SaveCardTerms): Record<string, string | number>;
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

  // Saved cards (optional). The card is typed into the provider's own window; we only ever hold the provider's token id.
  /** The provider's customer record for this organisation, made if it does not exist yet. */
  ensureCustomer?(holder: CardHolder): Promise<string>;
  /** The card a (card-saving) payment left behind, or null if it saved none. */
  cardForPayment?(customerId: string, providerPaymentId: string): Promise<SavedCardInfo | null>;
  /** The card as the provider sees it now, or null if it no longer exists. */
  card?(customerId: string, tokenId: string): Promise<SavedCardInfo | null>;
  removeCard?(customerId: string, tokenId: string): Promise<void>;
  /** Charges a saved card against an order we created. Never throws for a refusal: that is a failed result. */
  chargeCard?(req: CardChargeRequest): Promise<CardChargeResult>;
}
