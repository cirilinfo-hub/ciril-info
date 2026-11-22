import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { vi } from 'vitest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { BillingLifecycleService } from '../src/modules/billing/billing-lifecycle.service.js';
import { cleanupUsers, createStaff, createTestApp, customer, platformDb, staffToken } from './utils.js';
import { FakeStripe, stripeSignature } from './support/fake-stripe.js';

/** Stripe connected alongside the main provider (test mode here), pointed at a pretend Stripe. Set before any import reads it. */
const { SECRET_KEY, WEBHOOK_SECRET, PORT } = vi.hoisted(() => {
  const c = { SECRET_KEY: 'sk_test_integration', WEBHOOK_SECRET: 'whsec_integration', PORT: 43929 };
  Object.assign(process.env, { PAYMENT_PROVIDER: 'mock', STRIPE_SECRET_KEY: c.SECRET_KEY, STRIPE_WEBHOOK_SECRET: c.WEBHOOK_SECRET, STRIPE_API_BASE: `http://127.0.0.1:${c.PORT}` });
  return c;
});

describe('Stripe alongside the main provider (e2e)', () => {
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  let lifecycle: BillingLifecycleService;
  const fake = new FakeStripe(PORT, SECRET_KEY);
  const tag = randomUUID().slice(0, 8);
  const emails: string[] = [];
  let alice: Awaited<ReturnType<typeof customer>>;
  let bob: Awaited<ReturnType<typeof customer>>;
  let finance: string;
  let financeId: string;
  let planId: string;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = (p: string) => `/api/v1/${p}`;
  async function order(who = alice) {
    const o = await http().post(api('orders')).set(auth(who.token)).send({ planId, billingCycle: 'YEARLY' }).expect(201);
    const inv = await db.invoice.findUniqueOrThrow({ where: { id: o.body.invoice.id } });
    return { invoiceId: inv.id, subscriptionId: o.body.subscriptionId as string, paise: Math.round(Number(inv.total.toString()) * 100), number: inv.number };
  }
  const checkout = async (invoiceId: string, who = alice) => (await http().post(api(`invoices/${invoiceId}/pay`)).set(auth(who.token)).send({ gateway: 'STRIPE' }).expect(200)).body as { action: string; redirectUrl: string; paymentId: string };
  const sessionOf = async (paymentId: string) => (await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).providerOrderId!;
  const confirm = (invoiceId: string, sessionId: string, who = alice) => http().post(api(`invoices/${invoiceId}/confirm-stripe`)).set(auth(who.token)).send({ sessionId });
  function webhook(type: string, object: object, opts: { secret?: string; eventId?: string } = {}) {
    const raw = JSON.stringify({ id: opts.eventId ?? `evt_${randomUUID().slice(0, 10)}`, type, data: { object } });
    return http().post('/api/v1/webhooks/stripe').set('content-type', 'application/json').set('stripe-signature', stripeSignature(opts.secret ?? WEBHOOK_SECRET, raw)).send(raw);
  }
  const invoiceStatus = async (id: string) => (await db.invoice.findUniqueOrThrow({ where: { id } })).status;

  beforeAll(async () => {
    await fake.start();
    app = await createTestApp();
    db = platformDb();
    lifecycle = app.get(BillingLifecycleService);
    alice = await customer(app, db, `st-a-${tag}`);
    bob = await customer(app, db, `st-b-${tag}`);
    const f = await createStaff(db, 'FINANCE_ADMIN', 'stfin');
    financeId = f.id;
    emails.push(alice.email, bob.email, f.email);
    finance = await staffToken(app, db, f);
    for (const c of [alice, bob]) await http().post(api('organisation/addresses')).set(auth(c.token)).send({ line1: '1 Test Street', city: 'Pune', stateCode: '27', postalCode: '411001' }).expect(201);
    const category = await db.productCategory.upsert({ where: { slug: 'hosting' }, update: {}, create: { slug: 'hosting', name: 'Hosting' } });
    const product = await db.product.create({ data: { categoryId: category.id, slug: `t-st-${tag}`, name: `Stripe ${tag}`, type: 'WEB_HOSTING', status: 'PUBLISHED' } });
    const plan = await db.plan.create({ data: { productId: product.id, slug: `t-st-plan-${tag}`, name: `Plan ${tag}`, status: 'PUBLISHED', isSample: true } });
    planId = plan.id;
    await db.pricingVersion.create({ data: { planId, billingCycle: 'YEARLY', price: '1000.00', renewalPrice: '1000.00' } });
  });

  afterAll(async () => {
    const tenantIds = [alice?.tenantId, bob?.tenantId].filter(Boolean) as string[];
    await db.paymentDispute.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.creditNote.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.refund.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.payment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.invoice.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.subscription.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.paymentWebhook.deleteMany({ where: { provider: 'STRIPE' } });
    await db.notification.deleteMany({ where: { type: { in: ['payment.dispute'] }, body: { contains: tag } } });
    await db.outboxEvent.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.pricingVersion.deleteMany({ where: { planId } });
    await db.plan.deleteMany({ where: { id: planId } });
    await db.product.deleteMany({ where: { slug: `t-st-${tag}` } });
    await cleanupUsers(db, emails);
    await app.close();
    fake.stop();
  });

  it('the invoice offers Stripe, and paying with it makes a Checkout Session for the exact amount and sends the customer there', async () => {
    const o = await order();
    expect((await http().get(api(`invoices/${o.invoiceId}`)).set(auth(alice.token)).expect(200)).body.stripe).toBe(true);
    const c = await checkout(o.invoiceId);
    expect(c.action).toBe('REDIRECT');
    const sessionId = await sessionOf(c.paymentId);
    const s = fake.sessions.get(sessionId)!;
    expect(c.redirectUrl).toBe(s.url);
    expect({ amount: s.amount_total, currency: s.currency }).toEqual({ amount: o.paise, currency: 'inr' });
    expect(s.form.get('success_url')).toMatch(new RegExp(`/invoices/${o.invoiceId}\\?stripe=success&session=\\{CHECKOUT_SESSION_ID\\}$`));
    expect(s.form.get('metadata[invoiceId]')).toBe(o.invoiceId);
    expect(s.form.get('customer_email')).toBe(alice.email);
    expect(await db.payment.findUniqueOrThrow({ where: { id: c.paymentId } })).toMatchObject({ provider: 'STRIPE', status: 'CREATED' });
    expect(fake.idempotencyKeys.at(-1)).toMatch(/^stripe:/);
    expect(JSON.stringify(c)).not.toContain(SECRET_KEY);
  });

  it('coming back before Stripe has the money is pending; once paid, it settles the invoice once', async () => {
    const o = await order();
    const c = await checkout(o.invoiceId);
    const sessionId = await sessionOf(c.paymentId);
    expect((await confirm(o.invoiceId, sessionId).expect(200)).body.status).toBe('PENDING');
    fake.pay(sessionId);
    const r = await confirm(o.invoiceId, sessionId).expect(200);
    expect(r.body.status).toBe('SUCCEEDED');
    expect(await invoiceStatus(o.invoiceId)).toBe('PAID');
    expect((await confirm(o.invoiceId, sessionId).expect(200)).body.status).toBe('SUCCEEDED'); // repeating changes nothing
    expect(await db.payment.count({ where: { invoiceId: o.invoiceId, status: 'SUCCEEDED' } })).toBe(1);
    // Someone else's session, or a session for another invoice, is not accepted.
    await confirm(o.invoiceId, sessionId, bob).expect(404);
  });

  it("Stripe's signed webhook settles a payment if the customer never comes back; bad or repeated deliveries change nothing", async () => {
    const o = await order();
    const c = await checkout(o.invoiceId);
    const s = fake.pay(await sessionOf(c.paymentId));
    const object = { id: s.id, status: 'complete', payment_status: 'paid', amount_total: s.amount_total, currency: 'inr', payment_intent: s.payment_intent };
    await webhook('checkout.session.completed', object, { secret: 'whsec_attacker' }).expect(400);
    expect(await invoiceStatus(o.invoiceId)).toBe('ISSUED');
    await webhook('checkout.session.completed', object, { eventId: `evt_dup_${tag}` }).expect(200);
    expect(await invoiceStatus(o.invoiceId)).toBe('PAID');
    expect((await webhook('checkout.session.completed', object, { eventId: `evt_dup_${tag}` }).expect(200)).body).toEqual({ received: true, duplicate: true });
    expect(await db.payment.findUniqueOrThrow({ where: { id: c.paymentId } })).toMatchObject({ status: 'SUCCEEDED', providerPaymentId: s.payment_intent });

    // A changed amount is never recorded.
    const o2 = await order();
    const s2 = fake.pay(await sessionOf((await checkout(o2.invoiceId)).paymentId));
    await webhook('checkout.session.completed', { id: s2.id, status: 'complete', payment_status: 'paid', amount_total: 100, currency: 'inr', payment_intent: s2.payment_intent }).expect(200);
    expect(await invoiceStatus(o2.invoiceId)).toBe('ISSUED');
  });

  it('a lost webhook is caught by the lookup job, and an expired checkout is closed', async () => {
    const paid = await order();
    const sPaid = fake.pay(await sessionOf((await checkout(paid.invoiceId)).paymentId));
    const gone = await order();
    const goneSession = await sessionOf((await checkout(gone.invoiceId)).paymentId);
    fake.sessions.get(goneSession)!.status = 'expired';
    await lifecycle.run(new Date(Date.now() + 12 * 60_000));
    expect(await invoiceStatus(paid.invoiceId)).toBe('PAID');
    expect(sPaid.payment_intent).toBeTruthy();
    expect(await db.payment.findFirstOrThrow({ where: { providerOrderId: goneSession } })).toMatchObject({ status: 'FAILED', failureReason: expect.stringContaining('expired') });
    expect(await invoiceStatus(gone.invoiceId)).toBe('ISSUED'); // still payable
  });

  it('a refund goes back through Stripe, and a Stripe chargeback is recorded and staff told', async () => {
    const o = await order();
    const c = await checkout(o.invoiceId);
    const s = fake.pay(await sessionOf(c.paymentId));
    await confirm(o.invoiceId, s.id).expect(200);
    const r = await http().post(api(`admin/invoices/${o.invoiceId}/refunds`)).set(auth(finance)).send({ amount: 100, reason: 'Goodwill' }).expect(200);
    expect(r.body.refunds[0].status).toBe('SUCCEEDED');
    const call = fake.refunds.at(-1)!;
    expect({ pi: call.form.get('payment_intent'), amount: call.form.get('amount') }).toEqual({ pi: s.payment_intent, amount: '10000' });
    expect(call.idempotency).toBe((await db.refund.findFirstOrThrow({ where: { invoiceId: o.invoiceId } })).id);

    await webhook('charge.dispute.created', { id: `dp_${tag}`, payment_intent: s.payment_intent, amount: o.paise, currency: 'inr', reason: 'fraudulent', status: 'needs_response', evidence_details: { due_by: Math.floor(Date.now() / 1000) + 7 * 86_400 } }).expect(200);
    expect(await db.paymentDispute.findFirstOrThrow({ where: { providerDisputeId: `dp_${tag}` } })).toMatchObject({ provider: 'STRIPE', status: 'OPEN', invoiceId: o.invoiceId });
    expect(await db.notification.count({ where: { userId: financeId, type: 'payment.dispute', body: { contains: o.number } } })).toBe(1);
  });

  it('a card paid with Stripe cannot be saved for automatic payments', async () => {
    const o = await order();
    const r = await http().post(api(`invoices/${o.invoiceId}/pay`)).set(auth(alice.token)).send({ gateway: 'STRIPE', saveCard: true }).expect(409);
    expect(r.body.error.code).toBe('CARDS_NOT_AVAILABLE');
  });
});
