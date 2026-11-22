import { stripeSignature } from '../../../../test/support/fake-stripe.js';
import { StripeProvider } from './stripe.provider.js';

const SECRET = 'whsec_unit';
const stripe = new StripeProvider({ secretKey: 'sk_test_unit', webhookSecret: SECRET, apiBase: 'http://127.0.0.1:1' });
const event = (type: string, object: object, opts: { secret?: string; at?: number } = {}) => {
  const raw = JSON.stringify({ id: `evt_${type}`, type, data: { object } });
  return stripe.parseWebhook(Buffer.from(raw), { 'stripe-signature': stripeSignature(opts.secret ?? SECRET, raw, opts.at) });
};
const session = { id: 'cs_test_1', status: 'complete', payment_status: 'paid', amount_total: 118000, currency: 'inr', payment_intent: 'pi_1' };

describe('Stripe webhooks', () => {
  it('a paid checkout session is a succeeded payment with the facts we check', () => {
    expect(event('checkout.session.completed', session)).toMatchObject({
      type: 'payment.succeeded', eventId: 'evt_checkout.session.completed', providerOrderId: 'cs_test_1', providerPaymentId: 'pi_1', amountPaise: 118000, currency: 'INR',
    });
  });

  it('waits for a delayed payment method, and reports expiry and failure', () => {
    expect(event('checkout.session.completed', { ...session, payment_status: 'unpaid' })?.type).toBe('ignored');
    expect(event('checkout.session.async_payment_succeeded', session)?.type).toBe('payment.succeeded');
    expect(event('checkout.session.expired', { ...session, status: 'expired', payment_status: 'unpaid' })).toMatchObject({ type: 'payment.failed', providerOrderId: 'cs_test_1' });
    expect(event('checkout.session.async_payment_failed', session)?.type).toBe('payment.failed');
  });

  it('turns a dispute into a chargeback with its deadline', () => {
    expect(event('charge.dispute.created', { id: 'dp_1', payment_intent: 'pi_1', amount: 118000, currency: 'inr', reason: 'fraudulent', status: 'needs_response', evidence_details: { due_by: 1_800_000_000 } })).toMatchObject({
      type: 'dispute.updated', dispute: { id: 'dp_1', providerPaymentId: 'pi_1', status: 'OPEN', reason: 'fraudulent', respondBy: new Date(1_800_000_000_000) },
    });
    expect(event('charge.dispute.closed', { id: 'dp_1', payment_intent: 'pi_1', amount: 118000, currency: 'inr', status: 'lost' })?.dispute).toMatchObject({ status: 'LOST', amountDeductedPaise: 118000 });
  });

  it('refuses a wrong secret, an old timestamp, a tampered body, or no signature', () => {
    expect(event('checkout.session.completed', session, { secret: 'whsec_attacker' })).toBeNull();
    expect(event('checkout.session.completed', session, { at: Math.floor(Date.now() / 1000) - 600 })).toBeNull();
    const raw = JSON.stringify({ id: 'evt_x', type: 'checkout.session.completed', data: { object: session } });
    const header = stripeSignature(SECRET, raw);
    expect(stripe.parseWebhook(Buffer.from(raw.replace('118000', '1')), { 'stripe-signature': header })).toBeNull();
    expect(stripe.parseWebhook(Buffer.from(raw), {})).toBeNull();
    // A header carrying several v1 signatures (Stripe does this while rolling a secret) is accepted if one matches.
    expect(stripe.parseWebhook(Buffer.from(raw), { 'stripe-signature': `${header},v1=${'0'.repeat(64)}` })?.type).toBe('payment.succeeded');
  });
});
