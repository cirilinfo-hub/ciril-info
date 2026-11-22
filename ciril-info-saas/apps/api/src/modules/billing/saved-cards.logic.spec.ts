import { createHmac } from 'node:crypto';
import { RazorpayProvider } from './providers/razorpay.provider.js';
import { autoChargeDate, cardContact, cardLabel, nextAttemptDue } from './saved-cards.logic.js';

const DAY = 86_400_000;
const at = (iso: string) => new Date(iso);

describe('when a renewal invoice is charged to the saved card', () => {
  it('is a day before it is due', () => {
    expect(autoChargeDate(at('2026-12-01T00:00:00Z'), at('2026-12-15T00:00:00Z'))).toEqual(at('2026-12-14T00:00:00Z'));
  });

  it('is never sooner than a day after the customer was emailed the invoice', () => {
    expect(autoChargeDate(at('2026-12-14T12:00:00Z'), at('2026-12-15T00:00:00Z'))).toEqual(at('2026-12-15T12:00:00Z'));
  });

  it('retries wait a full day after the previous attempt', () => {
    const now = at('2026-12-10T10:00:00Z');
    expect(nextAttemptDue(null, now)).toBe(true);
    expect(nextAttemptDue(new Date(now.getTime() - DAY + 60_000), now)).toBe(false);
    expect(nextAttemptDue(new Date(now.getTime() - DAY), now)).toBe(true);
  });
});

describe('the phone number banks need for automatic payments', () => {
  it('adds +91 to an Indian number written without a country code', () => {
    expect(cardContact('98765 43210')).toBe('+919876543210');
    expect(cardContact('098765-43210')).toBe('+919876543210');
  });

  it('keeps a number that already has a country code', () => {
    expect(cardContact('+91 98765 43210')).toBe('+919876543210');
    expect(cardContact('+44 20 7946 0958')).toBe('+442079460958');
  });

  it('refuses something that cannot be a phone number', () => {
    expect(cardContact('')).toBeNull();
    expect(cardContact(null)).toBeNull();
    expect(cardContact('12345')).toBeNull();
  });

  it('names a card the way customers recognise it', () => {
    expect(cardLabel({ network: 'Visa', last4: '4242' })).toBe('Visa ending 4242');
    expect(cardLabel({ network: null, last4: null })).toBe('Card');
  });
});

describe('Razorpay saved-card webhooks', () => {
  const secret = 'webhook-secret-456';
  const rzp = new RazorpayProvider({ keyId: 'rzp_test_abc', keySecret: 'k', webhookSecret: secret, apiBase: 'http://127.0.0.1:1' });
  const event = (name: string, token: object) => {
    const raw = Buffer.from(JSON.stringify({ entity: 'event', event: name, payload: { token: { entity: token } } }));
    return rzp.parseWebhook(raw, { 'x-razorpay-signature': createHmac('sha256', secret).update(raw).digest('hex'), 'x-razorpay-event-id': `evt_${name}` });
  };

  it('reports what happened to the card', () => {
    expect(event('token.confirmed', { id: 'token_1', recurring_details: { status: 'confirmed' } })).toMatchObject({ type: 'token.updated', tokenId: 'token_1', tokenState: 'ACTIVE' });
    expect(event('token.rejected', { id: 'token_1', recurring_details: { status: 'rejected', failure_reason: 'Issuer declined' } })).toMatchObject({ tokenState: 'REJECTED', failureReason: 'Issuer declined' });
    expect(event('token.cancelled', { id: 'token_1' })).toMatchObject({ tokenState: 'GONE' });
    expect(event('token.paused', { id: 'token_1' })).toMatchObject({ tokenState: 'GONE' });
  });

  it('still checks the signature', () => {
    const raw = Buffer.from(JSON.stringify({ event: 'token.confirmed', payload: { token: { entity: { id: 'token_1' } } } }));
    expect(rzp.parseWebhook(raw, { 'x-razorpay-signature': 'f'.repeat(64), 'x-razorpay-event-id': 'evt_x' })).toBeNull();
  });
});
