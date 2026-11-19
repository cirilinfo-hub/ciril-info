import { createHmac, randomUUID } from 'node:crypto';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { vi } from 'vitest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { BillingLifecycleService } from '../src/modules/billing/billing-lifecycle.service.js';
import { cleanupUsers, createStaff, createTestApp, customer, platformDb, staffToken } from './utils.js';

/**
 * The app reads its settings when its module is first imported, so Razorpay is switched on here, before any import
 * runs. The "provider" is a small local server on a fixed port that plays the part of api.razorpay.com.
 */
const { KEY_ID, KEY_SECRET, WEBHOOK_SECRET, PORT } = vi.hoisted(() => {
  const c = { KEY_ID: 'rzp_test_integration', KEY_SECRET: 'integration-key-secret', WEBHOOK_SECRET: 'integration-webhook-secret', PORT: 43917 };
  Object.assign(process.env, {
    PAYMENT_PROVIDER: 'razorpay', RAZORPAY_KEY_ID: c.KEY_ID, RAZORPAY_KEY_SECRET: c.KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: c.WEBHOOK_SECRET, RAZORPAY_API_BASE: `http://127.0.0.1:${c.PORT}`,
  });
  return c;
});
const hmac = (secret: string, data: string | Buffer) => createHmac('sha256', secret).update(data).digest('hex');

interface FakePayment { id: string; order_id: string; amount: number; currency: string; status: string; method?: string; error_description?: string }

/** A stand-in for api.razorpay.com that checks the credentials and records what it was asked. */
class FakeRazorpay {
  server!: Server;
  base = '';
  orders: { id: string; amount: number; currency: string; receipt: string; notes: Record<string, string> }[] = [];
  payments = new Map<string, FakePayment>();
  captures: string[] = [];
  refunds: { paymentId: string; amount: number; idempotency: string | undefined }[] = [];
  failRefunds = false;
  badAuthSeen = false;

  async start() {
    this.server = createServer((req, res) => void this.route(req, res));
    await new Promise<void>((r) => this.server.listen(PORT, '127.0.0.1', r));
    this.base = `http://127.0.0.1:${PORT}`;
  }
  stop() {
    this.server.close();
  }
  addPayment(p: FakePayment) {
    this.payments.set(p.id, p);
  }

  private async route(req: IncomingMessage, res: ServerResponse) {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64')}`) {
      this.badAuthSeen = true;
      return send(401, { error: { description: 'Authentication failed' } });
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? (JSON.parse(Buffer.concat(chunks).toString()) as Record<string, any>) : {};
    const url = new URL(req.url ?? '/', this.base);
    const path = url.pathname;

    if (req.method === 'POST' && path === '/orders') {
      const o = { id: `order_${this.orders.length + 1}${randomUUID().slice(0, 6)}`, amount: body['amount'], currency: body['currency'], receipt: body['receipt'], notes: body['notes'] };
      this.orders.push(o);
      return send(200, { ...o, status: 'created' });
    }
    let m = path.match(/^\/payments\/([^/]+)$/);
    if (req.method === 'GET' && m) {
      const p = this.payments.get(m[1]!);
      return p ? send(200, p) : send(404, { error: { description: 'not found' } });
    }
    m = path.match(/^\/payments\/([^/]+)\/capture$/);
    if (req.method === 'POST' && m) {
      const p = this.payments.get(m[1]!);
      if (!p) return send(404, { error: { description: 'not found' } });
      this.captures.push(p.id);
      p.status = 'captured';
      return send(200, p);
    }
    m = path.match(/^\/orders\/([^/]+)\/payments$/);
    if (req.method === 'GET' && m) return send(200, { items: [...this.payments.values()].filter((p) => p.order_id === m![1]) });
    m = path.match(/^\/payments\/([^/]+)\/refund$/);
    if (req.method === 'POST' && m) {
      this.refunds.push({ paymentId: m[1]!, amount: body['amount'], idempotency: req.headers['x-refund-idempotency'] as string | undefined });
      return this.failRefunds ? send(400, { error: { description: 'Insufficient balance for refund' } }) : send(200, { id: `rfnd_${this.refunds.length}`, status: 'processed' });
    }
    return send(404, { error: { description: 'unknown route' } });
  }
}

/** Real hosted-payment behaviour against a fake provider: orders, signed confirmation, capture, webhooks, refunds, reconciliation. */
describe('Razorpay payments (e2e)', () => {
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  let lifecycle: BillingLifecycleService;
  const fake = new FakeRazorpay();
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

  /** A new unpaid order. */
  async function order(who = alice) {
    const o = await http().post(api('orders')).set(auth(who.token)).send({ planId, billingCycle: 'YEARLY' }).expect(201);
    const inv = await db.invoice.findUniqueOrThrow({ where: { id: o.body.invoice.id } });
    return { invoiceId: inv.id, subscriptionId: o.body.subscriptionId as string, paise: Math.round(Number(inv.total.toString()) * 100), number: inv.number };
  }
  /** The customer opens checkout: returns the provider order id. */
  async function startCheckout(invoiceId: string, who = alice) {
    const r = await http().post(api(`invoices/${invoiceId}/pay`)).set(auth(who.token)).send({}).expect(200);
    return r.body as { action: string; paymentId: string; checkout: { keyId: string; orderId: string; amountPaise: number; currency: string; description: string; prefillEmail?: string }; status: string };
  }
  /** What the browser sends after the customer paid: a payment at the provider and its signature. */
  function paidAtProvider(orderId: string, paise: number, status = 'captured', extra: Partial<FakePayment> = {}) {
    const id = `pay_${randomUUID().slice(0, 10)}`;
    fake.addPayment({ id, order_id: orderId, amount: paise, currency: 'INR', status, method: 'upi', ...extra });
    return { providerOrderId: orderId, providerPaymentId: id, signature: hmac(KEY_SECRET, `${orderId}|${id}`) };
  }
  const confirm = (invoiceId: string, body: object, who = alice) => http().post(api(`invoices/${invoiceId}/confirm-payment`)).set(auth(who.token)).send(body);

  /** A webhook exactly as Razorpay would deliver it. */
  function webhook(event: string, payment: FakePayment, eventId = `evt_${randomUUID().slice(0, 8)}`, opts: { secret?: string; path?: string } = {}) {
    const raw = JSON.stringify({ entity: 'event', event, payload: { payment: { entity: payment } }, created_at: 1 });
    return http().post(`/api/v1/webhooks/${opts.path ?? 'razorpay'}`).set('content-type', 'application/json').set('x-razorpay-signature', hmac(opts.secret ?? WEBHOOK_SECRET, raw)).set('x-razorpay-event-id', eventId).send(raw);
  }
  const state = async (invoiceId: string, subscriptionId: string) => ({
    invoice: (await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status,
    subscription: (await db.subscription.findUniqueOrThrow({ where: { id: subscriptionId } })).status,
    activations: await db.outboxEvent.count({ where: { type: 'subscription.activated', aggregateId: subscriptionId } }),
  });

  beforeAll(async () => {
    await fake.start();
    app = await createTestApp();
    db = platformDb();
    lifecycle = app.get(BillingLifecycleService);
    alice = await customer(app, db, 'rzp-a');
    bob = await customer(app, db, 'rzp-b');
    const f = await createStaff(db, 'FINANCE_ADMIN', 'rzpfin');
    financeId = f.id;
    emails.push(alice.email, bob.email, f.email);
    finance = await staffToken(app, db, f);
    for (const c of [alice, bob]) await http().post(api('organisation/addresses')).set(auth(c.token)).send({ line1: '1 Test Street', city: 'Pune', stateCode: '27', postalCode: '411001' }).expect(201);

    const category = await db.productCategory.upsert({ where: { slug: 'hosting' }, update: {}, create: { slug: 'hosting', name: 'Hosting' } });
    const product = await db.product.create({ data: { categoryId: category.id, slug: `t-prod-${tag}`, name: `Razorpay ${tag}`, type: 'WEB_HOSTING', status: 'PUBLISHED' } });
    const plan = await db.plan.create({ data: { productId: product.id, slug: `t-plan-${tag}`, name: `Plan ${tag}`, status: 'PUBLISHED', isSample: true } });
    planId = plan.id;
    await db.pricingVersion.create({ data: { planId, billingCycle: 'YEARLY', price: '1000.00', renewalPrice: '1000.00' } });
  });

  afterAll(async () => {
    const tenantIds = [alice?.tenantId, bob?.tenantId].filter(Boolean) as string[];
    await db.creditNote.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.refund.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.payment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.invoice.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.subscription.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.paymentWebhook.deleteMany({ where: { eventId: { startsWith: 'evt_' }, provider: 'RAZORPAY' } });
    await db.notification.deleteMany({ where: { type: { in: ['payment.orphaned', 'payment.mismatch'] } } });
    await db.outboxEvent.deleteMany({ where: { tenantId: { in: tenantIds }, type: { in: ['subscription.activated', 'subscription.cancelled', 'email.send'] } } });
    await db.pricingVersion.deleteMany({ where: { planId } });
    await db.plan.deleteMany({ where: { id: planId } });
    await db.product.deleteMany({ where: { slug: `t-prod-${tag}` } });
    await cleanupUsers(db, emails);
    await app.close();
    fake.stop();
  });

  describe('starting checkout', () => {
    it('creates a provider order for the exact amount and returns only public checkout details', async () => {
      const o = await order();
      const c = await startCheckout(o.invoiceId);
      expect(c.action).toBe('CHECKOUT');
      expect(c.checkout).toMatchObject({ keyId: KEY_ID, amountPaise: o.paise, currency: 'INR', description: `Invoice ${o.number}`, prefillEmail: alice.email });
      expect(JSON.stringify(c)).not.toContain(KEY_SECRET);
      expect(JSON.stringify(c)).not.toContain(WEBHOOK_SECRET);
      const sent = fake.orders.find((x) => x.id === c.checkout.orderId)!;
      expect(sent).toMatchObject({ amount: o.paise, currency: 'INR', receipt: o.number });
      expect(sent.notes).toMatchObject({ invoiceId: o.invoiceId, tenantId: alice.tenantId });
      const p = await db.payment.findUniqueOrThrow({ where: { id: c.paymentId } });
      expect(p).toMatchObject({ provider: 'RAZORPAY', status: 'CREATED', providerOrderId: c.checkout.orderId });
      expect((await state(o.invoiceId, o.subscriptionId)).invoice).toBe('ISSUED'); // nothing is paid yet
      expect(fake.badAuthSeen).toBe(false); // the API call carried the right credentials
    });

    it('a second click re-opens the same order instead of creating another', async () => {
      const o = await order();
      const a = await startCheckout(o.invoiceId);
      const before = fake.orders.length;
      const b = await startCheckout(o.invoiceId);
      expect(b.checkout.orderId).toBe(a.checkout.orderId);
      expect(b.paymentId).toBe(a.paymentId);
      expect(fake.orders.length).toBe(before);
    });

    it('is not reachable for someone else’s invoice, and the invoice page says it is not test mode', async () => {
      const o = await order();
      await http().post(api(`invoices/${o.invoiceId}/pay`)).set(auth(bob.token)).send({}).expect(404);
      const inv = await http().get(api(`invoices/${o.invoiceId}`)).set(auth(alice.token)).expect(200);
      expect(inv.body.testMode).toBe(false);
    });
  });

  describe('browser confirmation', () => {
    it('a valid signature plus a captured payment at the provider settles the invoice and activates the service, once', async () => {
      const o = await order();
      const c = await startCheckout(o.invoiceId);
      const conf = paidAtProvider(c.checkout.orderId, o.paise);
      const r = await confirm(o.invoiceId, conf).expect(200);
      expect(r.body.status).toBe('SUCCEEDED');
      expect(r.body.invoice.status).toBe('PAID');
      expect(await state(o.invoiceId, o.subscriptionId)).toEqual({ invoice: 'PAID', subscription: 'ACTIVE', activations: 1 });
      const p = await db.payment.findUniqueOrThrow({ where: { id: c.paymentId } });
      expect(p).toMatchObject({ status: 'SUCCEEDED', providerPaymentId: conf.providerPaymentId, method: 'upi' });
      expect(p.verifiedAt).not.toBeNull();
      // Repeating it changes nothing.
      expect((await confirm(o.invoiceId, conf).expect(200)).body.status).toBe('SUCCEEDED');
      expect((await state(o.invoiceId, o.subscriptionId)).activations).toBe(1);
    });

    it('a forged or wrong signature records nothing', async () => {
      const o = await order();
      const c = await startCheckout(o.invoiceId);
      const conf = paidAtProvider(c.checkout.orderId, o.paise);
      for (const bad of [{ ...conf, signature: hmac('attacker', `${conf.providerOrderId}|${conf.providerPaymentId}`) }, { ...conf, signature: hmac(KEY_SECRET, 'something|else') }, { ...conf, signature: 'f'.repeat(64) }]) {
        const r = await confirm(o.invoiceId, bad).expect(400);
        expect(r.body.error.code).toBe('INVALID_SIGNATURE');
      }
      expect(await state(o.invoiceId, o.subscriptionId)).toEqual({ invoice: 'ISSUED', subscription: 'PENDING', activations: 0 });
      expect((await db.auditLog.count({ where: { action: 'payment.signature_invalid', entityId: o.invoiceId } }))).toBe(3);
    });

    it('a real signature for a different order cannot be used to pay this invoice', async () => {
      const mine = await order();
      const other = await order();
      const c1 = await startCheckout(mine.invoiceId);
      const c2 = await startCheckout(other.invoiceId);
      const paidOther = paidAtProvider(c2.checkout.orderId, other.paise);
      // Present the other order's genuine payment against this invoice: this invoice has no such order.
      await confirm(mine.invoiceId, paidOther).expect(404);
      // And a genuine signature for this order but a payment that belongs to the other order is refused.
      const stolen = paidAtProvider(c2.checkout.orderId, other.paise);
      await confirm(mine.invoiceId, { providerOrderId: c1.checkout.orderId, providerPaymentId: stolen.providerPaymentId, signature: hmac(KEY_SECRET, `${c1.checkout.orderId}|${stolen.providerPaymentId}`) }).expect(400);
      expect((await state(mine.invoiceId, mine.subscriptionId)).invoice).toBe('ISSUED');
    });

    it('another organisation cannot confirm payments on this invoice', async () => {
      const o = await order();
      const c = await startCheckout(o.invoiceId);
      await confirm(o.invoiceId, paidAtProvider(c.checkout.orderId, o.paise), bob).expect(404);
    });

    it('an authorised-only payment is captured before it is recorded', async () => {
      const o = await order();
      const c = await startCheckout(o.invoiceId);
      const conf = paidAtProvider(c.checkout.orderId, o.paise, 'authorized');
      const r = await confirm(o.invoiceId, conf).expect(200);
      expect(r.body.status).toBe('SUCCEEDED');
      expect(fake.captures).toContain(conf.providerPaymentId);
    });

    it('a payment still in progress is pending, and a failed one is recorded as failed and can be retried', async () => {
      const o = await order();
      const c = await startCheckout(o.invoiceId);
      const created = paidAtProvider(c.checkout.orderId, o.paise, 'created');
      expect((await confirm(o.invoiceId, created).expect(200)).body.status).toBe('PENDING');
      expect((await state(o.invoiceId, o.subscriptionId)).invoice).toBe('ISSUED');

      const failed = paidAtProvider(c.checkout.orderId, o.paise, 'failed', { error_description: 'Card declined by the bank' });
      const r = await confirm(o.invoiceId, failed).expect(200);
      expect(r.body.status).toBe('FAILED');
      expect(r.body.failureReason).toBe('Card declined by the bank');
      // The customer can try again: a fresh order is opened.
      const again = await startCheckout(o.invoiceId);
      expect(again.checkout.orderId).not.toBe(c.checkout.orderId);
    });

    it('a payment for the wrong amount is never recorded and staff are told', async () => {
      const o = await order();
      const c = await startCheckout(o.invoiceId);
      const conf = paidAtProvider(c.checkout.orderId, o.paise - 100); // 1 rupee short
      const r = await confirm(o.invoiceId, conf).expect(409);
      expect(r.body.error.code).toBe('PAYMENT_NEEDS_REVIEW');
      expect(await state(o.invoiceId, o.subscriptionId)).toEqual({ invoice: 'ISSUED', subscription: 'PENDING', activations: 0 });
      expect(await db.auditLog.count({ where: { action: 'payment.mismatch', entityId: o.invoiceId } })).toBe(1);
      expect(await db.notification.count({ where: { userId: financeId, type: 'payment.mismatch', body: o.number } })).toBe(1);
    });
  });

  describe('webhooks', () => {
    it('a signed payment.captured settles the invoice even if the browser never reports back', async () => {
      const o = await order();
      const c = await startCheckout(o.invoiceId);
      const conf = paidAtProvider(c.checkout.orderId, o.paise);
      const r = await webhook('payment.captured', fake.payments.get(conf.providerPaymentId)!).expect(200);
      expect(r.body).toEqual({ received: true });
      expect(await state(o.invoiceId, o.subscriptionId)).toEqual({ invoice: 'PAID', subscription: 'ACTIVE', activations: 1 });
      // The owner (no signed-in session here) is told.
      expect(await db.notification.count({ where: { userId: alice.userId, type: 'payment.succeeded', link: `/invoices/${o.invoiceId}` } })).toBe(1);
    });

    it('a duplicate delivery is recognised and changes nothing', async () => {
      const o = await order();
      const c = await startCheckout(o.invoiceId);
      const pay = fake.payments.get(paidAtProvider(c.checkout.orderId, o.paise).providerPaymentId)!;
      const id = `evt_dup_${tag}`;
      await webhook('payment.captured', pay, id).expect(200);
      const second = await webhook('payment.captured', pay, id).expect(200);
      expect(second.body).toEqual({ received: true, duplicate: true });
      expect((await state(o.invoiceId, o.subscriptionId)).activations).toBe(1);
      expect(await db.paymentWebhook.count({ where: { provider: 'RAZORPAY', eventId: id } })).toBe(1);
    });

    it('the webhook and the browser racing give one payment, one activation', async () => {
      const o = await order();
      const c = await startCheckout(o.invoiceId);
      const conf = paidAtProvider(c.checkout.orderId, o.paise);
      const results = await Promise.all([webhook('payment.captured', fake.payments.get(conf.providerPaymentId)!), confirm(o.invoiceId, conf)]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      expect(await state(o.invoiceId, o.subscriptionId)).toEqual({ invoice: 'PAID', subscription: 'ACTIVE', activations: 1 });
      expect(await db.payment.count({ where: { invoiceId: o.invoiceId, status: 'SUCCEEDED' } })).toBe(1);
    });

    it('rejects a wrong or missing signature, the wrong provider path, and an empty body', async () => {
      const o = await order();
      const c = await startCheckout(o.invoiceId);
      const pay = fake.payments.get(paidAtProvider(c.checkout.orderId, o.paise).providerPaymentId)!;
      const bad = await webhook('payment.captured', pay, undefined, { secret: 'attacker' }).expect(400);
      expect(bad.body.error.code).toBe('INVALID_SIGNATURE');
      await http().post('/api/v1/webhooks/razorpay').set('content-type', 'application/json').send(JSON.stringify({ event: 'payment.captured' })).expect(400); // unsigned
      await webhook('payment.captured', pay, undefined, { path: 'stripe' }).expect(404);
      await http().post('/api/v1/webhooks/razorpay').set('x-razorpay-signature', 'x').set('x-razorpay-event-id', 'evt_x').expect(400);
      expect((await state(o.invoiceId, o.subscriptionId)).invoice).toBe('ISSUED');
    });

    it('a signed event with a changed amount is not recorded, and is flagged', async () => {
      const o = await order();
      const c = await startCheckout(o.invoiceId);
      const pay = { ...fake.payments.get(paidAtProvider(c.checkout.orderId, o.paise).providerPaymentId)!, amount: 100 };
      const r = await webhook('payment.captured', pay).expect(200);
      expect(r.body.received).toBe(true);
      expect((await state(o.invoiceId, o.subscriptionId)).invoice).toBe('ISSUED');
      const row = await db.paymentWebhook.findFirstOrThrow({ where: { provider: 'RAZORPAY' }, orderBy: { receivedAt: 'desc' } });
      expect(row.error).toContain('mismatch');
    });

    it('payment.failed marks the attempt failed without touching a payment that already succeeded', async () => {
      const o = await order();
      const c = await startCheckout(o.invoiceId);
      const bad = paidAtProvider(c.checkout.orderId, o.paise, 'failed', { error_description: 'Insufficient funds' });
      await webhook('payment.failed', fake.payments.get(bad.providerPaymentId)!).expect(200);
      expect(await db.payment.findUniqueOrThrow({ where: { id: c.paymentId } })).toMatchObject({ status: 'FAILED', failureReason: 'Insufficient funds' });

      const o2 = await order();
      const c2 = await startCheckout(o2.invoiceId);
      const good = paidAtProvider(c2.checkout.orderId, o2.paise);
      await confirm(o2.invoiceId, good).expect(200);
      await webhook('payment.failed', { ...fake.payments.get(good.providerPaymentId)!, status: 'failed' }).expect(200); // a late, contradictory event
      expect((await db.payment.findUniqueOrThrow({ where: { id: c2.paymentId } })).status).toBe('SUCCEEDED');
      expect((await state(o2.invoiceId, o2.subscriptionId)).invoice).toBe('PAID');
    });

    it('an order we never created, and events we do not act on, are stored and acknowledged', async () => {
      const stray = { id: 'pay_stray', order_id: 'order_not_ours', amount: 100, currency: 'INR', status: 'captured' };
      await webhook('payment.captured', stray).expect(200);
      await webhook('refund.processed', stray).expect(200);
      const rows = await db.paymentWebhook.findMany({ where: { provider: 'RAZORPAY', eventType: { in: ['payment.captured', 'refund.processed'] } }, orderBy: { receivedAt: 'desc' }, take: 2 });
      expect(rows.every((r) => r.processedAt)).toBe(true);
    });

    it('money arriving for a voided invoice is recorded, left unapplied and flagged for a refund', async () => {
      const o = await order();
      const c = await startCheckout(o.invoiceId);
      await db.invoice.update({ where: { id: o.invoiceId }, data: { status: 'VOID', voidedAt: new Date() } });
      const pay = fake.payments.get(paidAtProvider(c.checkout.orderId, o.paise).providerPaymentId)!;
      await webhook('payment.captured', pay).expect(200);
      expect(await db.payment.findUniqueOrThrow({ where: { id: c.paymentId } })).toMatchObject({ status: 'SUCCEEDED' });
      expect((await db.invoice.findUniqueOrThrow({ where: { id: o.invoiceId } })).status).toBe('VOID'); // the invoice is not resurrected
      expect(await db.auditLog.count({ where: { action: 'payment.orphaned', entityId: o.invoiceId } })).toBe(1);
      expect(await db.notification.count({ where: { userId: financeId, type: 'payment.orphaned', body: o.number } })).toBe(1);
    });
  });

  describe('refunds through the provider', () => {
    it('refund calls the provider with the payment id, the amount in paise and an idempotency key, and issues the credit note', async () => {
      const o = await order();
      const c = await startCheckout(o.invoiceId);
      const conf = paidAtProvider(c.checkout.orderId, o.paise);
      await confirm(o.invoiceId, conf).expect(200);
      const r = await http().post(api(`admin/invoices/${o.invoiceId}/refunds`)).set(auth(finance)).send({ amount: 100, reason: 'Goodwill' }).expect(200);
      expect(r.body.refunds[0].status).toBe('SUCCEEDED');
      const call = fake.refunds.at(-1)!;
      expect(call).toMatchObject({ paymentId: conf.providerPaymentId, amount: 10000 });
      expect(call.idempotency).toBe((await db.refund.findFirstOrThrow({ where: { invoiceId: o.invoiceId } })).id);
      expect((await db.refund.findFirstOrThrow({ where: { invoiceId: o.invoiceId } })).providerRefundId).toMatch(/^rfnd_/);
      expect(await db.creditNote.count({ where: { invoiceId: o.invoiceId } })).toBe(1);
    });

    it('a provider that refuses the refund leaves the money and the invoice untouched, with the reason shown', async () => {
      const o = await order();
      const c = await startCheckout(o.invoiceId);
      await confirm(o.invoiceId, paidAtProvider(c.checkout.orderId, o.paise)).expect(200);
      fake.failRefunds = true;
      try {
        const r = await http().post(api(`admin/invoices/${o.invoiceId}/refunds`)).set(auth(finance)).send({ reason: 'Customer left' }).expect(409);
        expect(r.body.error.code).toBe('REFUND_FAILED');
        expect(r.body.error.message).toContain('Insufficient balance');
      } finally {
        fake.failRefunds = false;
      }
      expect((await db.invoice.findUniqueOrThrow({ where: { id: o.invoiceId } })).status).toBe('PAID');
      expect((await db.refund.findFirstOrThrow({ where: { invoiceId: o.invoiceId } })).status).toBe('FAILED');
      expect(await db.creditNote.count({ where: { invoiceId: o.invoiceId } })).toBe(0);
      // Nothing is stuck: a later refund (the provider is fine now) works.
      await http().post(api(`admin/invoices/${o.invoiceId}/refunds`)).set(auth(finance)).send({ reason: 'Customer left' }).expect(200);
    });
  });

  describe('reconciliation', () => {
    const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);

    it('settles a captured payment whose webhook never arrived, and only after ten minutes', async () => {
      const o = await order();
      const c = await startCheckout(o.invoiceId);
      paidAtProvider(c.checkout.orderId, o.paise); // paid at the provider; nobody told us
      await lifecycle.run(later(2)); // too soon
      expect((await state(o.invoiceId, o.subscriptionId)).invoice).toBe('ISSUED');
      const r = await lifecycle.run(later(12));
      expect(r.reconciled).toBeGreaterThanOrEqual(1);
      expect(await state(o.invoiceId, o.subscriptionId)).toEqual({ invoice: 'PAID', subscription: 'ACTIVE', activations: 1 });
      expect(await db.auditLog.count({ where: { action: 'payment.succeeded', entityId: o.invoiceId } })).toBe(1);
      await lifecycle.run(later(20));
      expect((await state(o.invoiceId, o.subscriptionId)).activations).toBe(1); // nothing happens twice
    });

    it('settles an authorised payment by capturing it, and marks a failed one failed', async () => {
      const a = await order();
      const ca = await startCheckout(a.invoiceId);
      const auth1 = paidAtProvider(ca.checkout.orderId, a.paise, 'authorized');
      const f = await order();
      const cf = await startCheckout(f.invoiceId);
      paidAtProvider(cf.checkout.orderId, f.paise, 'failed', { error_description: 'Bank declined' });
      await lifecycle.run(later(12));
      expect((await state(a.invoiceId, a.subscriptionId)).invoice).toBe('PAID');
      expect(fake.captures).toContain(auth1.providerPaymentId);
      expect(await db.payment.findUniqueOrThrow({ where: { id: cf.paymentId } })).toMatchObject({ status: 'FAILED', failureReason: 'Bank declined' });
    });

    it('a checkout nobody completed is closed after three days, leaving the invoice payable', async () => {
      const o = await order();
      const c = await startCheckout(o.invoiceId);
      const r = await lifecycle.run(later(4 * 24 * 60));
      expect(r.checkoutsClosed).toBeGreaterThanOrEqual(1);
      expect(await db.payment.findUniqueOrThrow({ where: { id: c.paymentId } })).toMatchObject({ status: 'FAILED', failureReason: 'Checkout was not completed.' });
      expect((await db.invoice.findUniqueOrThrow({ where: { id: o.invoiceId } })).status).toBe('ISSUED'); // closing a checkout never touches the invoice
      await startCheckout(o.invoiceId); // still payable: a new order opens
    });
  });
});
