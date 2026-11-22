import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { MockProvider } from './providers/mock.provider.js';
import type {
  CardChargeRequest, CardChargeResult, CardHolder, ChargeRequest, ChargeResult, CheckoutConfirmation, OrderRequest, OrderResult, PaymentProvider, ProviderId, ProviderPayment,
  RefundRequest, RefundResult, SaveCardTerms, SavedCardInfo, WebhookEvent,
} from './providers/payment-provider.js';
import { RazorpayProvider } from './providers/razorpay.provider.js';
import { StripeProvider } from './providers/stripe.provider.js';

export type { ChargeRequest, ChargeResult, RefundRequest, RefundResult } from './providers/payment-provider.js';

const notAvailable = () => new ServiceUnavailableException({ code: 'PAYMENTS_NOT_CONFIGURED', message: 'Online payments are not available right now.' });

/**
 * The one place billing talks to a payment company. It picks the provider from PAYMENT_PROVIDER (env validation has
 * already checked the keys it needs) and exposes the same few operations whichever one is behind it.
 */
@Injectable()
export class PaymentGateway {
  readonly provider: PaymentProvider;
  /** Saved cards are offered: always in test mode, and with Razorpay once its recurring payments are switched on. */
  readonly savesCards: boolean;
  /** The most one automatic charge may take, in paise. */
  readonly autopayMaxPaise: number;
  /** Stripe, connected alongside the main provider for international cards (when STRIPE_SECRET_KEY is set). */
  readonly stripe: StripeProvider | null;

  constructor(config: ConfigService<Env, true>) {
    const which = config.get('PAYMENT_PROVIDER', { infer: true });
    this.savesCards = which === 'mock' || (which === 'razorpay' && config.get('RAZORPAY_SAVED_CARDS', { infer: true }));
    this.autopayMaxPaise = config.get('CARD_AUTOPAY_MAX_AMOUNT', { infer: true }) * 100;
    const stripeKey = config.get('STRIPE_SECRET_KEY', { infer: true });
    this.stripe = stripeKey
      ? new StripeProvider({ secretKey: stripeKey, webhookSecret: config.get('STRIPE_WEBHOOK_SECRET', { infer: true }), apiBase: config.get('STRIPE_API_BASE', { infer: true }).replace(/\/$/, '') })
      : null;
    if (which === 'razorpay') {
      this.provider = new RazorpayProvider({
        keyId: config.get('RAZORPAY_KEY_ID', { infer: true }),
        keySecret: config.get('RAZORPAY_KEY_SECRET', { infer: true }),
        webhookSecret: config.get('RAZORPAY_WEBHOOK_SECRET', { infer: true }),
        apiBase: config.get('RAZORPAY_API_BASE', { infer: true }),
      });
    } else if (which === 'mock') {
      this.provider = new MockProvider();
    } else {
      // Stripe is planned behind the same interface; env validation already refuses it with a clear message.
      throw new Error(`Payment provider "${which}" is not available yet. Use "razorpay" or "mock".`);
    }
  }

  get id(): ProviderId {
    return this.provider.id;
  }
  get isMock() {
    return this.provider.id === 'MOCK';
  }
  /** "instant" settles inside the request (test mode); "hosted" needs the customer's checkout and a signed confirmation. */
  get mode() {
    return this.provider.mode;
  }

  /** The connected provider with this id (the main one, or Stripe), or null. */
  providerById(id: string): PaymentProvider | null {
    const want = id.toUpperCase();
    if (want === this.provider.id) return this.provider;
    if (this.stripe && want === 'STRIPE') return this.stripe;
    return null;
  }

  /** Providers whose payments complete away from us and may need looking up (Razorpay, Stripe). */
  hostedProviders(): PaymentProvider[] {
    return [...(this.provider.mode === 'hosted' ? [this.provider] : []), ...(this.stripe ? [this.stripe] : [])];
  }

  async listOrderPaymentsFor(providerId: string, orderId: string): Promise<ProviderPayment[]> {
    const p = this.providerById(providerId);
    return p?.listOrderPayments ? p.listOrderPayments(orderId) : [];
  }

  async fetchPaymentFor(providerId: string, id: string): Promise<ProviderPayment> {
    const p = this.providerById(providerId);
    if (!p?.fetchPayment) throw notAvailable();
    return p.fetchPayment(id);
  }

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    if (!this.provider.charge) throw notAvailable();
    return this.provider.charge(req);
  }

  /** An order for an automatic card charge (test mode has one too, unlike its instant checkout). */
  async createChargeOrder(req: OrderRequest): Promise<OrderResult> {
    return this.cards().createOrder(req);
  }

  async createOrder(req: OrderRequest): Promise<OrderResult> {
    if (!this.provider.createOrder) throw notAvailable();
    return this.provider.createOrder(req);
  }

  checkoutParams(orderId: string, saveCard?: SaveCardTerms): Record<string, string | number> {
    return this.provider.checkoutParams?.(orderId, saveCard) ?? {};
  }

  private cards() {
    const p = this.provider;
    if (!this.savesCards || !p.ensureCustomer || !p.cardForPayment || !p.card || !p.removeCard || !p.chargeCard || !p.createOrder) throw notAvailable();
    return p as Required<Pick<PaymentProvider, 'ensureCustomer' | 'cardForPayment' | 'card' | 'removeCard' | 'chargeCard' | 'createOrder'>>;
  }
  ensureCustomer(h: CardHolder): Promise<string> {
    return this.cards().ensureCustomer(h);
  }
  cardForPayment(customerId: string, paymentId: string): Promise<SavedCardInfo | null> {
    return this.cards().cardForPayment(customerId, paymentId);
  }
  card(customerId: string, tokenId: string): Promise<SavedCardInfo | null> {
    return this.cards().card(customerId, tokenId);
  }
  removeCard(customerId: string, tokenId: string): Promise<void> {
    return this.cards().removeCard(customerId, tokenId);
  }
  chargeCard(req: CardChargeRequest): Promise<CardChargeResult> {
    return this.cards().chargeCard(req);
  }

  verifyCheckout(c: CheckoutConfirmation): boolean {
    return this.provider.verifyCheckout?.(c) ?? false;
  }

  async fetchPayment(id: string): Promise<ProviderPayment> {
    if (!this.provider.fetchPayment) throw notAvailable();
    return this.provider.fetchPayment(id);
  }

  async capture(id: string, amountPaise: number, currency: string): Promise<ProviderPayment> {
    if (!this.provider.capture) throw notAvailable();
    return this.provider.capture(id, amountPaise, currency);
  }

  async listOrderPayments(orderId: string): Promise<ProviderPayment[]> {
    return this.provider.listOrderPayments ? this.provider.listOrderPayments(orderId) : [];
  }

  parseWebhook(raw: Buffer, headers: Record<string, string | string[] | undefined>): WebhookEvent | null {
    return this.provider.parseWebhook?.(raw, headers) ?? null;
  }

  /** Refunds through whichever provider took the payment. */
  async refund(req: RefundRequest): Promise<RefundResult> {
    const p = req.provider ? this.providerById(req.provider) : this.provider;
    if (!p) return { ok: false, providerRefundId: null, failureReason: `${req.provider} is no longer connected, so refund this payment in its own dashboard.` };
    return p.refund(req);
  }
}
