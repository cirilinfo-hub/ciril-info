import { randomUUID } from 'node:crypto';
import type { ChargeRequest, ChargeResult, PaymentProvider, RefundRequest, RefundResult } from './payment-provider.js';

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
}
