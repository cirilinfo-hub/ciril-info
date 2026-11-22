import { createHmac, randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { vi } from 'vitest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { BillingLifecycleService } from '../src/modules/billing/billing-lifecycle.service.js';
import { cleanupUsers, createTestApp, customer, lastEmail, platformDb } from './utils.js';
import { FakeRazorpay, type FakeRzpPayment } from './support/fake-razorpay.js';

/** Razorpay with saved cards switched on, pointed at a pretend Razorpay on a fixed port. Set before any import reads it. */
const { KEY_ID, KEY_SECRET, WEBHOOK_SECRET, PORT } = vi.hoisted(() => {
  const c = { KEY_ID: 'rzp_test_cards', KEY_SECRET: 'cards-key-secret', WEBHOOK_SECRET: 'cards-webhook-secret', PORT: 43921 };
  Object.assign(process.env, {
    PAYMENT_PROVIDER: 'razorpay', RAZORPAY_KEY_ID: c.KEY_ID, RAZORPAY_KEY_SECRET: c.KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: c.WEBHOOK_SECRET,
    RAZORPAY_API_BASE: `http://127.0.0.1:${c.PORT}`, RAZORPAY_SAVED_CARDS: 'true', CARD_AUTOPAY_MAX_AMOUNT: '15000',
  });
  return c;
});
const hmac = (secret: string, data: string | Buffer) => createHmac('sha256', secret).update(data).digest('hex');
const DAY = 86_400_000;

type Who = Awaited<ReturnType<typeof customer>>;

describe('Saved cards and automatic renewal payments (e2e)', () => {
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  let lifecycle: BillingLifecycleService;
  const fake = new FakeRazorpay(KEY_ID, KEY_SECRET, PORT);
  const tag = randomUUID().slice(0, 8);
  const people: Who[] = [];
  let planId: string;

  const http = () => request(app.getHttpServer());
  const auth = (w: Who) => ({ Authorization: `Bearer ${w.token}` });
  const api = (p: string) => `/api/v1/${p}`;

  async function newCustomer(label: string, phone: string | null = '98765 43210') {
    const w = await customer(app, db, `${label}-${tag}`);
    people.push(w);
    await http().post(api('organisation/addresses')).set(auth(w)).send({ line1: '1 Card Street', city: 'Pune', stateCode: '27', postalCode: '411001' }).expect(201);
    if (phone) await db.customerAccount.update({ where: { tenantId: w.tenantId }, data: { phone } });
    return w;
  }
  async function order(w: Who) {
    const o = await http().post(api('orders')).set(auth(w)).send({ planId, billingCycle: 'YEARLY' }).expect(201);
    const inv = await db.invoice.findUniqueOrThrow({ where: { id: o.body.invoice.id } });
    return { invoiceId: inv.id, subscriptionId: o.body.subscriptionId as string, paise: Math.round(Number(inv.total.toString()) * 100) };
  }
  /** The customer pays in Razorpay's window; with a token, Razorpay saved the card as well. */
  async function payAtCheckout(w: Who, invoiceId: string, paise: number, opts: { saveCard?: boolean; token?: string } = {}) {
    const c = await http().post(api(`invoices/${invoiceId}/pay`)).set(auth(w)).send(opts.saveCard ? { saveCard: true } : {}).expect(200);
    const orderId = c.body.checkout.orderId as string;
    const id = `pay_${randomUUID().slice(0, 10)}`;
    fake.addPayment({ id, order_id: orderId, amount: paise, currency: 'INR', status: 'captured', method: 'card', ...(opts.token ? { token_id: opts.token } : {}) });
    const r = await http().post(api(`invoices/${invoiceId}/confirm-payment`)).set(auth(w)).send({ providerOrderId: orderId, providerPaymentId: id, signature: hmac(KEY_SECRET, `${orderId}|${id}`) }).expect(200);
    expect(r.body.status).toBe('SUCCEEDED');
    return c.body as { checkout: Record<string, unknown> };
  }
  /** The card Razorpay keeps once the customer's bank confirmed the standing instruction. */
  function bankConfirms(customerId: string, token: string, last4 = '1111', status = 'confirmed') {
    fake.addToken(customerId, { id: token, card: { last4, network: 'Visa', expiry_month: 8, expiry_year: 2031 }, recurring_details: { status } });
  }
  /** An organisation with an active service and a saved card, its renewal invoice issued at t0 and due three days later. */
  async function renewingWithCard(label: string, token: string) {
    const w = await newCustomer(label);
    const first = await order(w);
    // The checkout makes the Razorpay customer; the bank confirms the token the payment leaves behind.
    const c = await http().post(api(`invoices/${first.invoiceId}/pay`)).set(auth(w)).send({ saveCard: true }).expect(200);
    bankConfirms(c.body.checkout.customerId as string, token);
    const orderId = c.body.checkout.orderId as string;
    const id = `pay_${randomUUID().slice(0, 10)}`;
    fake.addPayment({ id, order_id: orderId, amount: first.paise, currency: 'INR', status: 'captured', method: 'card', token_id: token });
    await http().post(api(`invoices/${first.invoiceId}/confirm-payment`)).set(auth(w)).send({ providerOrderId: orderId, providerPaymentId: id, signature: hmac(KEY_SECRET, `${orderId}|${id}`) }).expect(200);
    const t0 = new Date();
    await db.subscription.update({ where: { id: first.subscriptionId }, data: { currentPeriodEnd: new Date(t0.getTime() + 3 * DAY) } });
    await lifecycle.run(t0);
    const renewal = await db.invoice.findFirstOrThrow({ where: { subscriptionId: first.subscriptionId, id: { not: first.invoiceId } } });
    return { w, t0, subscriptionId: first.subscriptionId, renewal, paise: Math.round(Number(renewal.total.toString()) * 100), customerId: c.body.checkout.customerId as string };
  }
  function webhook(event: string, payload: object) {
    const raw = JSON.stringify({ entity: 'event', event, payload, created_at: 1 });
    return http().post('/api/v1/webhooks/razorpay').set('content-type', 'application/json').set('x-razorpay-signature', hmac(WEBHOOK_SECRET, raw)).set('x-razorpay-event-id', `evt_card_${randomUUID().slice(0, 8)}`).send(raw);
  }
  const at = (t0: Date, days: number, minutes = 1) => new Date(t0.getTime() + days * DAY + minutes * 60_000);
  const chargesFor = (invoiceId: string) => db.payment.findMany({ where: { invoiceId, savedCardId: { not: null } }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    await fake.start();
    app = await createTestApp();
    db = platformDb();
    lifecycle = app.get(BillingLifecycleService);
    const category = await db.productCategory.upsert({ where: { slug: 'hosting' }, update: {}, create: { slug: 'hosting', name: 'Hosting' } });
    const product = await db.product.create({ data: { categoryId: category.id, slug: `t-card-prod-${tag}`, name: `Cards ${tag}`, type: 'WEB_HOSTING', status: 'PUBLISHED' } });
    const plan = await db.plan.create({ data: { productId: product.id, slug: `t-card-plan-${tag}`, name: `Card plan ${tag}`, status: 'PUBLISHED', isSample: true } });
    planId = plan.id;
    await db.pricingVersion.create({ data: { planId, billingCycle: 'YEARLY', price: '1000.00', renewalPrice: '1000.00' } });
  });

  afterAll(async () => {
    const tenantIds = people.map((p) => p.tenantId);
    await db.creditNote.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.refund.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.payment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.savedCard.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.invoice.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.subscription.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.paymentWebhook.deleteMany({ where: { eventId: { startsWith: 'evt_card_' } } });
    await db.outboxEvent.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.pricingVersion.deleteMany({ where: { planId } });
    await db.plan.deleteMany({ where: { id: planId } });
    await db.product.deleteMany({ where: { slug: `t-card-prod-${tag}` } });
    await cleanupUsers(db, people.map((p) => p.email));
    await app.close();
    fake.stop();
  });

  describe('saving a card', () => {
    it('a card-saving checkout is card only, tied to a Razorpay customer, with the automatic-payment limit; the card is kept once paid', async () => {
      const w = await newCustomer('save');
      const o = await order(w);
      expect((await http().get(api(`invoices/${o.invoiceId}`)).set(auth(w)).expect(200)).body.cards).toEqual({ available: true, saved: false, autoPay: null });

      const c = await http().post(api(`invoices/${o.invoiceId}/pay`)).set(auth(w)).send({ saveCard: true }).expect(200);
      const customerId = c.body.checkout.customerId as string;
      expect(c.body.checkout).toMatchObject({ customerId: expect.stringMatching(/^cust_/), recurring: '1' });
      const sent = fake.orders.find((x) => x.id === c.body.checkout.orderId)!;
      expect(sent).toMatchObject({ customer_id: customerId, method: 'card', amount: o.paise, token: { max_amount: 1_500_000, frequency: 'as_presented' } });
      expect(sent.token!.expire_at).toBeGreaterThan(Date.now() / 1000 + 5 * 365 * 86_400);
      expect(fake.customers.get(customerId)).toMatchObject({ email: w.email, contact: '+919876543210' });
      expect((await db.customerAccount.findUniqueOrThrow({ where: { tenantId: w.tenantId } })).paymentCustomerId).toBe(customerId);

      bankConfirms(customerId, `token_save_${tag}`, '1111');
      const orderId = c.body.checkout.orderId as string;
      const id = `pay_${randomUUID().slice(0, 10)}`;
      fake.addPayment({ id, order_id: orderId, amount: o.paise, currency: 'INR', status: 'captured', method: 'card', token_id: `token_save_${tag}` });
      await http().post(api(`invoices/${o.invoiceId}/confirm-payment`)).set(auth(w)).send({ providerOrderId: orderId, providerPaymentId: id, signature: hmac(KEY_SECRET, `${orderId}|${id}`) }).expect(200);

      const view = (await http().get(api('billing/saved-card')).set(auth(w)).expect(200)).body;
      expect(view).toMatchObject({ available: true, card: { status: 'ACTIVE', network: 'Visa', last4: '1111', expiryMonth: 8, expiryYear: 2031, autoPay: true, maxAmount: '15000' } });
      expect(JSON.stringify(view)).not.toContain('token_'); // the provider's token never reaches the browser
      expect(await db.notification.count({ where: { userId: w.userId, type: 'card.saved' } })).toBe(1);
    });

    it('saving another card replaces the first, which is deleted at Razorpay', async () => {
      const w = await newCustomer('replace');
      const a = await order(w);
      const ca = await http().post(api(`invoices/${a.invoiceId}/pay`)).set(auth(w)).send({ saveCard: true }).expect(200);
      bankConfirms(ca.body.checkout.customerId as string, `token_old_${tag}`, '1111');
      await payAtCheckoutWithExisting(w, a.invoiceId, a.paise, ca.body.checkout.orderId as string, `token_old_${tag}`);
      const b = await order(w);
      const cb = await http().post(api(`invoices/${b.invoiceId}/pay`)).set(auth(w)).send({ saveCard: true }).expect(200);
      expect(cb.body.checkout.customerId).toBe(ca.body.checkout.customerId); // one Razorpay customer per organisation
      bankConfirms(cb.body.checkout.customerId as string, `token_new_${tag}`, '2222');
      await payAtCheckoutWithExisting(w, b.invoiceId, b.paise, cb.body.checkout.orderId as string, `token_new_${tag}`);

      expect((await http().get(api('billing/saved-card')).set(auth(w)).expect(200)).body.card).toMatchObject({ last4: '2222' });
      expect(await db.savedCard.findFirstOrThrow({ where: { providerTokenId: `token_old_${tag}` } })).toMatchObject({ status: 'REMOVED' });
      expect(fake.deletedTokens).toContain(`token_old_${tag}`);
    });

    it('a card is not saved without a phone number, which banks need', async () => {
      const w = await newCustomer('nophone', null);
      const o = await order(w);
      const r = await http().post(api(`invoices/${o.invoiceId}/pay`)).set(auth(w)).send({ saveCard: true }).expect(409);
      expect(r.body.error.code).toBe('PHONE_NEEDED');
      // Paying without saving still works.
      await payAtCheckout(w, o.invoiceId, o.paise);
    });

    it('a card the bank has not confirmed yet waits, and becomes active once Razorpay says so', async () => {
      const w = await newCustomer('pending');
      const o = await order(w);
      const c = await http().post(api(`invoices/${o.invoiceId}/pay`)).set(auth(w)).send({ saveCard: true }).expect(200);
      bankConfirms(c.body.checkout.customerId as string, `token_wait_${tag}`, '3333', 'initiated');
      await payAtCheckoutWithExisting(w, o.invoiceId, o.paise, c.body.checkout.orderId as string, `token_wait_${tag}`);
      expect((await http().get(api('billing/saved-card')).set(auth(w)).expect(200)).body.card.status).toBe('PENDING');
      await webhook('token.confirmed', { token: { entity: { id: `token_wait_${tag}`, recurring_details: { status: 'confirmed' } } } }).expect(200);
      expect((await http().get(api('billing/saved-card')).set(auth(w)).expect(200)).body.card.status).toBe('ACTIVE');
    });

    it('another organisation sees no card and cannot change or remove it', async () => {
      const owner = await newCustomer('iso-a');
      const other = await newCustomer('iso-b');
      const o = await order(owner);
      const c = await http().post(api(`invoices/${o.invoiceId}/pay`)).set(auth(owner)).send({ saveCard: true }).expect(200);
      bankConfirms(c.body.checkout.customerId as string, `token_iso_${tag}`);
      await payAtCheckoutWithExisting(owner, o.invoiceId, o.paise, c.body.checkout.orderId as string, `token_iso_${tag}`);
      expect((await http().get(api('billing/saved-card')).set(auth(other)).expect(200)).body.card).toBeNull();
      await http().patch(api('billing/saved-card')).set(auth(other)).send({ autoPay: false }).expect(404);
      await http().delete(api('billing/saved-card')).set(auth(other)).expect(404);
      expect((await http().get(api('billing/saved-card')).set(auth(owner)).expect(200)).body.card).toMatchObject({ status: 'ACTIVE', autoPay: true });
    });
  });

  describe('automatic renewal payments', () => {
    it('the renewal email names the card and date; the card is charged a day before the due date, and the payment renews the service', async () => {
      const r = await renewingWithCard('auto', `token_auto_${tag}`);
      const mail = await lastEmail(db, r.w.email, 'renewal-invoice');
      expect(mail?.data['autoPay']).toEqual({ card: 'Visa ending 1111', date: at(r.t0, 2, 0).toISOString().slice(0, 10) });
      const page = (await http().get(api(`invoices/${r.renewal.id}`)).set(auth(r.w)).expect(200)).body;
      expect(page.cards.autoPay).toMatchObject({ card: 'Visa ending 1111' });

      await lifecycle.run(at(r.t0, 1)); // too early: a day before the due date is t0 + 2 days
      expect(await chargesFor(r.renewal.id)).toHaveLength(0);

      await lifecycle.run(at(r.t0, 2));
      const charges = await chargesFor(r.renewal.id);
      expect(charges).toHaveLength(1);
      expect(charges[0]).toMatchObject({ status: 'PENDING', method: 'card', provider: 'RAZORPAY' });
      const call = fake.recurring.find((x) => x.order_id === charges[0]!.providerOrderId)!;
      expect(call).toMatchObject({ customer_id: r.customerId, token: `token_auto_${tag}`, amount: r.paise, currency: 'INR', recurring: '1', contact: '+919876543210', email: r.w.email });
      expect(fake.orders.find((o) => o.id === charges[0]!.providerOrderId)).toMatchObject({ amount: r.paise, receipt: r.renewal.number });

      // Running again before Razorpay answers never charges twice.
      await lifecycle.run(at(r.t0, 2, 5));
      expect(await chargesFor(r.renewal.id)).toHaveLength(1);

      const pay = fake.payments.get(call.paymentId!)!;
      pay.status = 'captured';
      await webhook('payment.captured', { payment: { entity: pay } }).expect(200);
      expect((await db.invoice.findUniqueOrThrow({ where: { id: r.renewal.id } })).status).toBe('PAID');
      const sub = await db.subscription.findUniqueOrThrow({ where: { id: r.subscriptionId } });
      expect(sub.currentPeriodEnd!.getTime()).toBeGreaterThan(at(r.t0, 360).getTime());
      expect((await lastEmail(db, r.w.email, 'autopay-succeeded'))?.data).toMatchObject({ number: r.renewal.number, card: 'Visa ending 1111' });
    });

    it('a declined card is retried once a day, three times in all, and the customer is told each time', async () => {
      const r = await renewingWithCard('decline', `token_decline_${tag}`);
      fake.declineTokens.add(`token_decline_${tag}`);
      await lifecycle.run(at(r.t0, 2));
      let charges = await chargesFor(r.renewal.id);
      expect(charges).toHaveLength(1);
      expect(charges[0]).toMatchObject({ status: 'FAILED', failureReason: 'Your card was declined by the bank' });
      expect((await lastEmail(db, r.w.email, 'autopay-failed'))?.data).toMatchObject({ number: r.renewal.number, retry: true, reason: 'Your card was declined by the bank' });
      expect(await db.notification.count({ where: { userId: r.w.userId, type: 'autopay.failed' } })).toBe(1);

      await lifecycle.run(at(r.t0, 2, 30)); // not again the same day
      expect(await chargesFor(r.renewal.id)).toHaveLength(1);
      await lifecycle.run(at(r.t0, 3, 2));
      await lifecycle.run(at(r.t0, 4, 3));
      charges = await chargesFor(r.renewal.id);
      expect(charges.map((c) => c.status)).toEqual(['FAILED', 'FAILED', 'FAILED']);
      expect((await lastEmail(db, r.w.email, 'autopay-failed'))?.data['retry']).toBe(false);
      await lifecycle.run(at(r.t0, 5, 4));
      expect(await chargesFor(r.renewal.id)).toHaveLength(3); // three attempts, then it is left to the customer
      expect((await db.invoice.findUniqueOrThrow({ where: { id: r.renewal.id } })).status).not.toBe('PAID');
    });

    it('a Razorpay outage leaves the charge open, and it is settled later by looking the order up', async () => {
      const r = await renewingWithCard('outage', `token_outage_${tag}`);
      fake.failRecurring = 1;
      await lifecycle.run(at(r.t0, 2));
      const [charge] = await chargesFor(r.renewal.id);
      expect(charge).toMatchObject({ status: 'PENDING' });
      // The charge had in fact gone through at Razorpay.
      fake.addPayment({ id: `pay_late_${tag}`, order_id: charge!.providerOrderId!, amount: r.paise, currency: 'INR', status: 'captured', method: 'card' } satisfies FakeRzpPayment);
      await lifecycle.run(at(r.t0, 2, 20));
      expect((await db.invoice.findUniqueOrThrow({ where: { id: r.renewal.id } })).status).toBe('PAID');
      expect(await chargesFor(r.renewal.id)).toHaveLength(1);
    });

    it('an invoice above the card limit is not charged, and the customer is asked to pay it once', async () => {
      const r = await renewingWithCard('limit', `token_limit_${tag}`);
      await db.savedCard.updateMany({ where: { tenantId: r.w.tenantId }, data: { maxAmount: '100.00' } });
      const before = fake.recurring.length;
      await lifecycle.run(at(r.t0, 2));
      await lifecycle.run(at(r.t0, 3, 2));
      expect(fake.recurring.length).toBe(before);
      expect(await chargesFor(r.renewal.id)).toHaveLength(0);
      expect((await lastEmail(db, r.w.email, 'autopay-failed'))?.data).toMatchObject({ retry: false, reason: expect.stringContaining('100.00') });
      expect(await db.auditLog.count({ where: { action: 'autopay.over_limit', entityId: r.renewal.id } })).toBe(1);
    });

    it('with automatic payments switched off, or the card removed, nothing is charged', async () => {
      const off = await renewingWithCard('off', `token_off_${tag}`);
      const v = (await http().patch(api('billing/saved-card')).set(auth(off.w)).send({ autoPay: false }).expect(200)).body;
      expect(v.card.autoPay).toBe(false);
      expect((await http().get(api(`invoices/${off.renewal.id}`)).set(auth(off.w)).expect(200)).body.cards.autoPay).toBeNull();

      const gone = await renewingWithCard('removed', `token_removed_${tag}`);
      expect((await http().delete(api('billing/saved-card')).set(auth(gone.w)).expect(200)).body.card).toBeNull();
      expect(fake.deletedTokens).toContain(`token_removed_${tag}`);
      expect(await db.savedCard.findFirstOrThrow({ where: { providerTokenId: `token_removed_${tag}` } })).toMatchObject({ status: 'REMOVED', autoPay: false });

      await lifecycle.run(at(gone.t0, 2));
      expect(await chargesFor(off.renewal.id)).toHaveLength(0);
      expect(await chargesFor(gone.renewal.id)).toHaveLength(0);
    });

    it('a card cancelled at the bank stops automatic payments and the owner is told', async () => {
      const r = await renewingWithCard('cancelled', `token_cancel_${tag}`);
      await webhook('token.cancelled', { token: { entity: { id: `token_cancel_${tag}`, recurring_details: { status: 'cancelled' } } } }).expect(200);
      expect(await db.savedCard.findFirstOrThrow({ where: { providerTokenId: `token_cancel_${tag}` } })).toMatchObject({ status: 'REMOVED' });
      expect(await db.notification.count({ where: { userId: r.w.userId, type: 'card.cancelled' } })).toBe(1);
      await lifecycle.run(at(r.t0, 2));
      expect(await chargesFor(r.renewal.id)).toHaveLength(0);
    });

    it('a new order is never charged automatically, only renewals', async () => {
      const r = await renewingWithCard('neworder', `token_neworder_${tag}`);
      const fresh = await order(r.w);
      await db.invoice.update({ where: { id: fresh.invoiceId }, data: { dueAt: new Date(r.t0.getTime() + DAY), issuedAt: new Date(r.t0.getTime() - 2 * DAY) } });
      await lifecycle.run(at(r.t0, 2));
      expect(await chargesFor(fresh.invoiceId)).toHaveLength(0);
    });
  });

  /** Pays a checkout that is already open (its order id known), leaving the given token behind. */
  async function payAtCheckoutWithExisting(w: Who, invoiceId: string, paise: number, orderId: string, token: string) {
    const id = `pay_${randomUUID().slice(0, 10)}`;
    fake.addPayment({ id, order_id: orderId, amount: paise, currency: 'INR', status: 'captured', method: 'card', token_id: token });
    const r = await http().post(api(`invoices/${invoiceId}/confirm-payment`)).set(auth(w)).send({ providerOrderId: orderId, providerPaymentId: id, signature: hmac(KEY_SECRET, `${orderId}|${id}`) }).expect(200);
    expect(r.body.status).toBe('SUCCEEDED');
  }
});
