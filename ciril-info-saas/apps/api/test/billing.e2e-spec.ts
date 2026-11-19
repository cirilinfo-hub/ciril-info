import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { cleanupUsers, createTestApp, customer, platformDb } from './utils.js';

/**
 * Ordering, invoicing and (mock) payment. Uses its own tagged catalogue rows and two organisations,
 * and removes everything it created.
 */
describe('Billing (e2e)', () => {
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  const tag = randomUUID().slice(0, 8);
  const emails: string[] = [];
  let alice: Awaited<ReturnType<typeof customer>>;
  let bob: Awaited<ReturnType<typeof customer>>;
  let planId: string;
  let draftPlanId: string;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = (p: string) => `/api/v1/${p}`;

  beforeAll(async () => {
    app = await createTestApp();
    db = platformDb();
    alice = await customer(app, db, 'bill-a');
    bob = await customer(app, db, 'bill-b');
    emails.push(alice.email, bob.email);

    const category = await db.productCategory.upsert({ where: { slug: 'hosting' }, update: {}, create: { slug: 'hosting', name: 'Hosting' } });
    const product = await db.product.create({ data: { categoryId: category.id, slug: `t-prod-${tag}`, name: `Test Product ${tag}`, type: 'WEB_HOSTING', status: 'PUBLISHED' } });
    const plan = await db.plan.create({ data: { productId: product.id, slug: `t-plan-${tag}`, name: `Test Plan ${tag}`, status: 'PUBLISHED', isSample: true } });
    const draft = await db.plan.create({ data: { productId: product.id, slug: `t-draft-${tag}`, name: `Draft ${tag}`, status: 'DRAFT' } });
    planId = plan.id;
    draftPlanId = draft.id;
    await db.pricingVersion.create({ data: { planId, billingCycle: 'YEARLY', price: '1999.00', renewalPrice: '2499.00', setupFee: '100.00' } });
  });

  afterAll(async () => {
    const tenantIds = [alice?.tenantId, bob?.tenantId].filter(Boolean) as string[];
    await db.payment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.invoice.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.subscription.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.outboxEvent.deleteMany({ where: { tenantId: { in: tenantIds }, type: 'subscription.activated' } });
    const products = await db.product.findMany({ where: { slug: `t-prod-${tag}` }, select: { id: true } });
    const planIds = (await db.plan.findMany({ where: { productId: { in: products.map((p) => p.id) } }, select: { id: true } })).map((p) => p.id);
    await db.pricingVersion.deleteMany({ where: { planId: { in: planIds } } });
    await db.plan.deleteMany({ where: { id: { in: planIds } } });
    await db.product.deleteMany({ where: { id: { in: products.map((p) => p.id) } } });
    await cleanupUsers(db, emails);
    await app.close();
  });

  it('requires sign-in', async () => {
    await http().get(api('invoices')).expect(401);
    await http().post(api('orders')).send({ planId, billingCycle: 'YEARLY' }).expect(401);
  });

  it('quotes the price with a setup fee and a consistent total', async () => {
    const r = await http().post(api('orders/quote')).set(auth(alice.token)).send({ planId, billingCycle: 'YEARLY' }).expect(200);
    expect(r.body.lines).toHaveLength(2);
    expect(r.body.subtotal).toBe('2099.00');
    expect(Number(r.body.total)).toBeCloseTo(Number(r.body.subtotal) + Number(r.body.taxTotal), 2);
  });

  it('accepts the product/plan reference used by website links', async () => {
    const r = await http().post(api('orders/quote')).set(auth(alice.token)).send({ planRef: `t-prod-${tag}/t-plan-${tag}`, billingCycle: 'YEARLY' }).expect(200);
    expect(r.body.planId).toBe(planId);
    await http().post(api('orders/quote')).set(auth(alice.token)).send({ planRef: `t-prod-${tag}/nope`, billingCycle: 'YEARLY' }).expect(404);
    await http().post(api('orders/quote')).set(auth(alice.token)).send({ planRef: 'bad ref', billingCycle: 'YEARLY' }).expect(400);
    await http().post(api('orders/quote')).set(auth(alice.token)).send({ billingCycle: 'YEARLY' }).expect(400);
  });

  it('refuses unpublished plans and unsold billing periods, and validates input', async () => {
    await http().post(api('orders/quote')).set(auth(alice.token)).send({ planId: draftPlanId, billingCycle: 'YEARLY' }).expect(404);
    const r = await http().post(api('orders/quote')).set(auth(alice.token)).send({ planId, billingCycle: 'MONTHLY' }).expect(409);
    expect(r.body.error.code).toBe('NO_PRICE');
    await http().post(api('orders/quote')).set(auth(alice.token)).send({ planId: 'nope', billingCycle: 'YEARLY' }).expect(400);
    await http().post(api('orders/quote')).set(auth(alice.token)).send({ planId, billingCycle: 'WEEKLY' }).expect(400);
  });

  it('ordering needs a billing address, which is copied onto the invoice', async () => {
    const r = await http().post(api('orders')).set(auth(alice.token)).send({ planId, billingCycle: 'YEARLY' }).expect(409);
    expect(r.body.error.code).toBe('NO_BILLING_ADDRESS');
    await http().post(api('organisation/addresses')).set(auth(alice.token)).send({ line1: '12 MG Road', city: 'Bengaluru', stateCode: '29', postalCode: '560001' }).expect(201);
    const ok = await http().post(api('orders')).set(auth(alice.token)).send({ planId, billingCycle: 'YEARLY' }).expect(201);
    const inv = await http().get(api(`invoices/${ok.body.invoice.id}`)).set(auth(alice.token)).expect(200);
    expect(inv.body.billingSnapshot.seller).toBeTypeOf('object'); // company profile as filled in by the admins
    expect(inv.body.billingSnapshot.buyer.address).toMatchObject({ line1: '12 MG Road', stateCode: '29', state: 'Karnataka' });
    await http().post(api(`subscriptions/${ok.body.subscriptionId}/cancel`)).set(auth(alice.token)).send({}).expect(200);
  });

  describe('order → pay', () => {
    let invoiceId: string;
    let subscriptionId: string;
    let number: string;

    it('creates a pending subscription and an issued invoice with a gap-free number', async () => {
      const r = await http().post(api('orders')).set(auth(alice.token)).send({ planId, billingCycle: 'YEARLY' }).expect(201);
      invoiceId = r.body.invoice.id;
      subscriptionId = r.body.subscriptionId;
      number = r.body.invoice.number;
      expect(number).toMatch(/^INV-\d{4}-\d{2}-\d{6}$/);
      expect(r.body.invoice.status).toBe('ISSUED');
      const sub = await db.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
      expect(sub.status).toBe('PENDING');

      const second = await http().post(api('orders')).set(auth(alice.token)).send({ planId, billingCycle: 'YEARLY' }).expect(201);
      const seq = (n: string) => Number(n.split('-').pop());
      expect(seq(second.body.invoice.number)).toBe(seq(number) + 1);
      await http().post(api(`subscriptions/${second.body.subscriptionId}/cancel`)).set(auth(alice.token)).send({}).expect(200);
    });

    it('another organisation cannot see, pay or cancel it', async () => {
      await http().get(api(`invoices/${invoiceId}`)).set(auth(bob.token)).expect(404);
      await http().post(api(`invoices/${invoiceId}/pay`)).set(auth(bob.token)).send({}).expect(404);
      await http().post(api(`subscriptions/${subscriptionId}/cancel`)).set(auth(bob.token)).send({}).expect(404);
      const list = await http().get(api('invoices')).set(auth(bob.token)).expect(200);
      expect(list.body.data).toHaveLength(0);
    });

    it('a failed payment leaves the invoice unpaid and the subscription pending, and can be retried', async () => {
      const r = await http().post(api(`invoices/${invoiceId}/pay`)).set(auth(alice.token)).send({ simulate: 'fail' }).expect(200);
      expect(r.body.status).toBe('FAILED');
      expect(r.body.invoice.status).toBe('ISSUED');
      expect((await db.subscription.findUniqueOrThrow({ where: { id: subscriptionId } })).status).toBe('PENDING');
    });

    it('a successful payment marks the invoice paid, activates the subscription and queues provisioning', async () => {
      const key = `idem-${tag}-1`;
      const r = await http().post(api(`invoices/${invoiceId}/pay`)).set(auth(alice.token)).send({ idempotencyKey: key }).expect(200);
      expect(r.body.status).toBe('SUCCEEDED');
      expect(r.body.invoice.status).toBe('PAID');

      const sub = await db.subscription.findUniqueOrThrow({ where: { id: subscriptionId }, include: { history: true } });
      expect(sub.status).toBe('ACTIVE');
      expect(sub.currentPeriodEnd!.getUTCFullYear()).toBe(sub.currentPeriodStart!.getUTCFullYear() + 1);
      expect(sub.history.map((h) => h.event).sort()).toEqual(['ACTIVATED', 'CREATED']);
      expect(await db.outboxEvent.count({ where: { type: 'subscription.activated', aggregateId: subscriptionId } })).toBe(1);

      // Same key again: no second charge.
      const again = await http().post(api(`invoices/${invoiceId}/pay`)).set(auth(alice.token)).send({ idempotencyKey: key }).expect(200);
      expect(again.body.paymentId).toBe(r.body.paymentId);
      expect(await db.payment.count({ where: { invoiceId, status: 'SUCCEEDED' } })).toBe(1);
    });

    it('cannot pay twice, even with a new key', async () => {
      const r = await http().post(api(`invoices/${invoiceId}/pay`)).set(auth(alice.token)).send({}).expect(409);
      expect(r.body.error.code).toBe('INVOICE_NOT_PAYABLE');
    });

    it('two simultaneous payments charge once', async () => {
      const o = await http().post(api('orders')).set(auth(alice.token)).send({ planId, billingCycle: 'YEARLY' }).expect(201);
      const results = await Promise.all([0, 1].map(() => http().post(api(`invoices/${o.body.invoice.id}/pay`)).set(auth(alice.token)).send({})));
      expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
      expect(await db.payment.count({ where: { invoiceId: o.body.invoice.id, status: 'SUCCEEDED' } })).toBe(1);
    });

    it('lists and shows invoices, subscriptions and the payment trail', async () => {
      const inv = await http().get(api(`invoices/${invoiceId}`)).set(auth(alice.token)).expect(200);
      expect(inv.body.items).toHaveLength(2);
      expect(inv.body.payments.map((p: { status: string }) => p.status).sort()).toEqual(['FAILED', 'SUCCEEDED']);
      expect(inv.body.testMode).toBe(true);
      const list = await http().get(api('invoices?status=PAID')).set(auth(alice.token)).expect(200);
      expect(list.body.data.some((i: { id: string }) => i.id === invoiceId)).toBe(true);
      const subs = await http().get(api('subscriptions')).set(auth(alice.token)).expect(200);
      expect(subs.body.data.find((s: { id: string }) => s.id === subscriptionId).status).toBe('ACTIVE');
    });

    it('cancelling an active subscription ends it at period end; a paid invoice is never voided', async () => {
      const r = await http().post(api(`subscriptions/${subscriptionId}/cancel`)).set(auth(alice.token)).send({ reason: 'test' }).expect(200);
      expect(r.body.status).toBe('ACTIVE');
      expect(r.body.cancelAtPeriodEnd).toBe(true);
      expect((await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status).toBe('PAID');
    });

    it('cancelling a pending subscription voids its unpaid invoice', async () => {
      const o = await http().post(api('orders')).set(auth(alice.token)).send({ planId, billingCycle: 'YEARLY' }).expect(201);
      const r = await http().post(api(`subscriptions/${o.body.subscriptionId}/cancel`)).set(auth(alice.token)).send({}).expect(200);
      expect(r.body.status).toBe('CANCELLED');
      expect((await db.invoice.findUniqueOrThrow({ where: { id: o.body.invoice.id } })).status).toBe('VOID');
      await http().post(api(`invoices/${o.body.invoice.id}/pay`)).set(auth(alice.token)).send({}).expect(409);
    });
  });
});
