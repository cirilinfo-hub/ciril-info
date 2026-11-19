import { createHmac } from 'node:crypto';
import { RazorpayProvider } from './razorpay.provider.js';

const cfg = { keyId: 'rzp_test_abc', keySecret: 'key-secret-123', webhookSecret: 'webhook-secret-456', apiBase: 'http://127.0.0.1:1' };
const rzp = new RazorpayProvider(cfg);
const hmac = (secret: string, data: string | Buffer) => createHmac('sha256', secret).update(data).digest('hex');

describe('Razorpay checkout signature', () => {
  const c = { providerOrderId: 'order_ABC', providerPaymentId: 'pay_XYZ' };

  it('accepts the signature Razorpay produces over "order|payment" with the key secret', () => {
    expect(rzp.verifyCheckout({ ...c, signature: hmac(cfg.keySecret, 'order_ABC|pay_XYZ') })).toBe(true);
  });

  it('rejects anything else', () => {
    expect(rzp.verifyCheckout({ ...c, signature: hmac('another-secret', 'order_ABC|pay_XYZ') })).toBe(false); // wrong key
    expect(rzp.verifyCheckout({ ...c, signature: hmac(cfg.keySecret, 'order_ABC|pay_OTHER') })).toBe(false); // another payment
    expect(rzp.verifyCheckout({ ...c, providerOrderId: 'order_OTHER', signature: hmac(cfg.keySecret, 'order_ABC|pay_XYZ') })).toBe(false); // another order
    expect(rzp.verifyCheckout({ ...c, signature: hmac(cfg.webhookSecret, 'order_ABC|pay_XYZ') })).toBe(false); // the webhook secret is not the key secret
    expect(rzp.verifyCheckout({ ...c, signature: '' })).toBe(false);
    expect(rzp.verifyCheckout({ ...c, signature: 'not-hex' })).toBe(false);
    expect(rzp.verifyCheckout({ ...c, signature: hmac(cfg.keySecret, 'order_ABC|pay_XYZ').toUpperCase() })).toBe(false); // exact match only
  });
});

describe('Razorpay webhook parsing', () => {
  const body = (event: string, payment: object) => Buffer.from(JSON.stringify({ entity: 'event', event, payload: { payment: { entity: payment } } }));
  const signed = (raw: Buffer, eventId = 'evt_1', secret = cfg.webhookSecret) => ({ 'x-razorpay-signature': hmac(secret, raw), 'x-razorpay-event-id': eventId });
  const pay = { id: 'pay_1', order_id: 'order_1', amount: 226560, currency: 'INR', method: 'upi', status: 'captured' };

  it('turns a signed payment.captured into a succeeded event with the facts we check', () => {
    const raw = body('payment.captured', pay);
    expect(rzp.parseWebhook(raw, signed(raw))).toEqual({
      eventId: 'evt_1', rawType: 'payment.captured', type: 'payment.succeeded', providerOrderId: 'order_1', providerPaymentId: 'pay_1',
      amountPaise: 226560, currency: 'INR', method: 'upi', failureReason: null,
    });
  });

  it('also settles on order.paid, and reports failures with the reason', () => {
    const paid = body('order.paid', pay);
    expect(rzp.parseWebhook(paid, signed(paid))?.type).toBe('payment.succeeded');
    const failed = body('payment.failed', { ...pay, status: 'failed', error_description: 'Card declined' });
    expect(rzp.parseWebhook(failed, signed(failed))).toMatchObject({ type: 'payment.failed', failureReason: 'Card declined' });
  });

  it('ignores events it does not act on, but still verifies them', () => {
    const raw = body('refund.processed', pay);
    expect(rzp.parseWebhook(raw, signed(raw))?.type).toBe('ignored');
  });

  it('rejects a wrong secret, a tampered body, a missing signature or a missing event id', () => {
    const raw = body('payment.captured', pay);
    expect(rzp.parseWebhook(raw, signed(raw, 'evt_1', 'attacker-secret'))).toBeNull();
    const tampered = Buffer.from(raw.toString().replace('226560', '1'));
    expect(rzp.parseWebhook(tampered, signed(raw))).toBeNull(); // signature was for the original amount
    expect(rzp.parseWebhook(raw, { 'x-razorpay-event-id': 'evt_1' })).toBeNull();
    expect(rzp.parseWebhook(raw, { 'x-razorpay-signature': hmac(cfg.webhookSecret, raw) })).toBeNull();
    expect(rzp.parseWebhook(raw, { 'x-razorpay-signature': [hmac(cfg.webhookSecret, raw)], 'x-razorpay-event-id': 'evt_1' })).toBeNull(); // repeated header
  });

  it('rejects a body that is signed but not JSON', () => {
    const raw = Buffer.from('not json at all');
    expect(rzp.parseWebhook(raw, signed(raw))).toBeNull();
  });

  it('builds checkout parameters that contain the public key id and never a secret', () => {
    const params = rzp.checkoutParams('order_9');
    expect(params).toEqual({ keyId: 'rzp_test_abc', orderId: 'order_9' });
    expect(JSON.stringify(params)).not.toContain(cfg.keySecret);
    expect(JSON.stringify(params)).not.toContain(cfg.webhookSecret);
  });
});
