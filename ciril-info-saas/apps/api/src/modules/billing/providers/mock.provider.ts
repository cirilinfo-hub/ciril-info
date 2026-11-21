import { randomUUID } from 'node:crypto';
import type {
  CardChargeRequest, CardChargeResult, CardHolder, ChargeRequest, ChargeResult, OrderRequest, OrderResult, PaymentProvider, RefundRequest, RefundResult, SavedCardInfo,
} from './payment-provider.js';

/** Test mode. Answers at once and moves no money. Refused in production by env validation. */
export class MockProvider implements PaymentProvider {
  readonly id = 'MOCK' as const;
  readonly mode = 'instant' as const;

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    const orderId = `mock_order_${randomUUID().slice(0, 12)}`;
    if (req.simulate === 'fail') {
      return { provider: 'MOCK', ok: false, providerOrderId: orderId, providerPaymentId: null, method: 'mock', failureReason: 'Simulated payment failure (test mode).' };
    }
    return { provider: 'MOCK', ok: true, providerOrderId: orderId, providerPaymentId: `mock_pay_${randomUUID().slice(0, 12)}`, method: 'mock', failureReason: null };
  }

  async refund(_req: RefundRequest): Promise<RefundResult> {
    return { ok: true, providerRefundId: `mock_refund_${randomUUID().slice(0, 12)}`, failureReason: null };
  }

  // Saved cards in test mode: a pretend Visa ending 4242. A token whose id contains "decline" refuses every charge.
  async ensureCustomer(_h: CardHolder): Promise<string> {
    return `mock_cust_${randomUUID().slice(0, 12)}`;
  }

  async createOrder(_req: OrderRequest): Promise<OrderResult> {
    return { providerOrderId: `mock_order_${randomUUID().slice(0, 12)}`, checkout: {} };
  }

  async cardForPayment(_customerId: string, providerPaymentId: string): Promise<SavedCardInfo | null> {
    return this.mockCard(`mock_tok_${providerPaymentId.replace(/^mock_pay_/, '')}`);
  }

  async card(_customerId: string, tokenId: string): Promise<SavedCardInfo | null> {
    return this.mockCard(tokenId);
  }

  async removeCard(): Promise<void> {}

  async chargeCard(req: CardChargeRequest): Promise<CardChargeResult> {
    if (req.tokenId.includes('decline')) return { status: 'failed', providerPaymentId: null, failureReason: 'The card was declined (test mode).' };
    return { status: 'captured', providerPaymentId: `mock_pay_${randomUUID().slice(0, 12)}`, failureReason: null };
  }

  private mockCard(tokenId: string): SavedCardInfo {
    return { tokenId, state: 'ACTIVE', network: 'Visa', last4: '4242', expiryMonth: 12, expiryYear: new Date().getUTCFullYear() + 3, failureReason: null };
  }
}
