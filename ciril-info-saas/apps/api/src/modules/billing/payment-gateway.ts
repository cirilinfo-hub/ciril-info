import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { Env } from '../../config/env.js';

export interface ChargeRequest {
  amountPaise: number;
  currency: string;
  invoiceNumber: string;
  idempotencyKey: string;
  /** Test hook honoured by the mock adapter only. */
  simulate?: 'fail';
}

export interface ChargeResult {
  provider: 'MOCK' | 'RAZORPAY' | 'STRIPE';
  ok: boolean;
  providerOrderId: string;
  providerPaymentId: string | null;
  method: string | null;
  failureReason: string | null;
}

/**
 * Payment provider boundary. Real Razorpay/Stripe adapters arrive in Phase 6, where card/UPI
 * capture happens on the provider's hosted page and success is confirmed by a signed webhook.
 * Until then only the clearly-labelled mock exists, and env validation refuses it in production.
 */
@Injectable()
export class PaymentGateway {
  readonly provider: Env['PAYMENT_PROVIDER'];

  constructor(config: ConfigService<Env, true>) {
    this.provider = config.get('PAYMENT_PROVIDER', { infer: true });
  }

  get isMock() {
    return this.provider === 'mock';
  }

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    if (this.provider !== 'mock') {
      throw new ServiceUnavailableException({ code: 'PAYMENTS_NOT_CONFIGURED', message: 'Online payments are not available yet.' });
    }
    const orderId = `mock_order_${randomUUID().slice(0, 12)}`;
    if (req.simulate === 'fail') {
      return { provider: 'MOCK', ok: false, providerOrderId: orderId, providerPaymentId: null, method: 'mock', failureReason: 'Simulated payment failure (test mode).' };
    }
    return { provider: 'MOCK', ok: true, providerOrderId: orderId, providerPaymentId: `mock_pay_${randomUUID().slice(0, 12)}`, method: 'mock', failureReason: null };
  }
}
