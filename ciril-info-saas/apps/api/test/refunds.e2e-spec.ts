import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { cleanupUsers, createStaff, createTestApp, customer, platformDb, staffToken } from './utils.js';

/** Refunds: who may issue them, partial and full, over-refund protection, service cancellation and what the customer sees. */
describe('Refunds (e2e)', () => {
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  const tag = randomUUID().slice(0, 8);
  const emails: string[] = [];
  let alice: Awaited<ReturnType<typeof customer>>;
  let bob: Awaited<ReturnType<typeof customer>>;
  let finance: string;
  let support: string;
  let platformAdmin: string;
  let planId: string;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = (p: string) => `/api/v1/${p}`;

  /** An order paid in full by `who`, returning its invoice and subscription. */
  async function paidOrder(who: typeof alice) {
    const o = await http().post(api('orders')).set(auth(who.token)).send({ planId, billingCycle: 'YEARLY' }).expect(201);
    await http().post(api(`invoices/${o.body.invoice.id}/pay`)).set(auth(who.token)).send({}).expect(200);
    const inv = await db.invoice.findUniqueOrThrow({ where: { id: o.body.invoice.id } });
    return { invoiceId: inv.id as string, subscriptionId: o.body.subscriptionId as string, total: Number(inv.total.toString()) };
  }

  beforeAll(async () => {
    app = await createTestApp();
    db = platformDb();
    alice = await customer(app, db, 'refund-a');
    bob = await customer(app, db, 'refund-b');
    const f = await createStaff(db, 'FINANCE_ADMIN', 'rffin');
    const s = await createStaff(db, 'SUPPORT_AGENT', 'rfsup');
    const p = await createStaff(db, 'PLATFORM_ADMIN', 'rfpa');
    emails.push(alice.email, bob.email, f.email, s.email, p.email);
    [finance, support, platformAdmin] = await Promise.all([staffToken(app, db, f), staffToken(app, db, s), staffToken(app, db, p)]);
    for (const c of [alice, bob]) await http().post(api('organisation/addresses')).set(auth(c.token)).send({ line1: '1 Test Street', city: 'Pune', stateCode: '27', postalCode: '411001' }).expect(201);

    const category = await db.productCategory.upsert({ where: { slug: 'hosting' }, update: {}, create: { slug: 'hosting', name: 'Hosting' } });
    const product = await db.product.create({ data: { categoryId: category.id, slug: `t-prod-${tag}`, name: `Refund ${tag}`, type: 'WEB_HOSTING', status: 'PUBLISHED' } });
    const plan = await db.plan.create({ data: { productId: product.id, slug: `t-plan-${tag}`, name: `Plan ${tag}`, status: 'PUBLISHED', isSample: true } });
    planId = plan.id;
    await db.pricingVersion.create({ data: { planId, billingCycle: 'YEARLY', price: '1000.00', renewalPrice: '1000.00' } });
  });

  afterAll(async () => {
    const tenantIds = [alice?.tenantId, bob?.tenantId].filter(Boolean) as string[];
    await db.refund.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.payment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.invoice.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.subscription.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.outboxEvent.deleteMany({ where: { tenantId: { in: tenantIds }, type: { in: ['subscription.activated', 'subscription.cancelled'] } } });
    await db.pricingVersion.deleteMany({ where: { planId } });
    await db.plan.deleteMany({ where: { id: planId } });
    await db.product.deleteMany({ where: { slug: `t-prod-${tag}` } });
    await cleanupUsers(db, emails);
    await app.close();
  });

  it('only roles with billing:refund can refund; customers and others are refused', async () => {
    const { invoiceId } = await paidOrder(alice);
    const url = api(`admin/invoices/${invoiceId}/refunds`);
    await http().post(url).send({ reason: 'x' }).expect(401);
    await http().post(url).set(auth(alice.token)).send({ reason: 'nope' }).expect(403);
    await http().post(url).set(auth(support)).send({ reason: 'nope' }).expect(403);
    await http().post(url).set(auth(platformAdmin)).send({ reason: 'nope' }).expect(403); // PLATFORM_ADMIN deliberately lacks refund
    expect(await db.refund.count({ where: { invoiceId } })).toBe(0);
  });

  it('validates the request and refuses an invoice with nothing paid', async () => {
    const unpaid = await http().post(api('orders')).set(auth(alice.token)).send({ planId, billingCycle: 'YEARLY' }).expect(201);
    const url = api(`admin/invoices/${unpaid.body.invoice.id}/refunds`);
    await http().post(url).set(auth(finance)).send({ reason: '' }).expect(400);
    await http().post(url).set(auth(finance)).send({ reason: 'valid reason', amount: -5 }).expect(400);
    await http().post(url).set(auth(finance)).send({ reason: 'valid reason', amount: 10.555 }).expect(400);
    const r = await http().post(url).set(auth(finance)).send({ reason: 'valid reason' }).expect(409);
    expect(r.body.error.code).toBe('NOTHING_TO_REFUND');
    await http().post(api(`admin/invoices/${randomUUID()}/refunds`)).set(auth(finance)).send({ reason: 'valid reason' }).expect(404);
  });

  it('a partial refund keeps the invoice paid; the rest can follow; no more than was paid', async () => {
    const { invoiceId, total } = await paidOrder(alice);
    const url = api(`admin/invoices/${invoiceId}/refunds`);

    const first = await http().post(url).set(auth(finance)).send({ amount: 100, reason: 'Goodwill' }).expect(200);
    expect(first.body.status).toBe('PAID');
    expect(first.body.refunds).toHaveLength(1);
    expect((await db.payment.findFirstOrThrow({ where: { invoiceId } })).status).toBe('PARTIALLY_REFUNDED');

    const tooMuch = await http().post(url).set(auth(finance)).send({ amount: total, reason: 'Too much' }).expect(409);
    expect(tooMuch.body.error.code).toBe('REFUND_TOO_LARGE');
    expect(tooMuch.body.error.message).toContain((total - 100).toFixed(2));

    const rest = await http().post(url).set(auth(finance)).send({ reason: 'Remaining balance' }).expect(200); // no amount = everything left
    expect(rest.body.status).toBe('REFUNDED');
    expect((await db.payment.findFirstOrThrow({ where: { invoiceId } })).status).toBe('REFUNDED');
    const sum = (await db.refund.findMany({ where: { invoiceId, status: 'SUCCEEDED' } })).reduce((t, r) => t + Number(r.amount.toString()), 0);
    expect(sum).toBeCloseTo(total, 2);

    const again = await http().post(url).set(auth(finance)).send({ reason: 'Again' }).expect(409);
    expect(again.body.error.code).toBe('ALREADY_REFUNDED');
  });

  it('two simultaneous refunds cannot exceed the payment', async () => {
    const { invoiceId, total } = await paidOrder(alice);
    const url = api(`admin/invoices/${invoiceId}/refunds`);
    const results = await Promise.all([0, 1].map(() => http().post(url).set(auth(finance)).send({ amount: total, reason: 'Race' })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const sum = (await db.refund.findMany({ where: { invoiceId, status: 'SUCCEEDED' } })).reduce((t, r) => t + Number(r.amount.toString()), 0);
    expect(sum).toBeCloseTo(total, 2);
  });

  it('a full refund can also cancel the service, queueing the event for provisioning', async () => {
    const { invoiceId, subscriptionId } = await paidOrder(alice);
    expect((await db.subscription.findUniqueOrThrow({ where: { id: subscriptionId } })).status).toBe('ACTIVE');
    await http().post(api(`admin/invoices/${invoiceId}/refunds`)).set(auth(finance)).send({ reason: 'Customer left', cancelService: true }).expect(200);
    const sub = await db.subscription.findUniqueOrThrow({ where: { id: subscriptionId }, include: { history: true } });
    expect(sub.status).toBe('CANCELLED');
    expect(sub.autoRenew).toBe(false);
    expect(sub.history.map((h) => h.event)).toContain('CANCELLED');
    expect(await db.outboxEvent.count({ where: { type: 'subscription.cancelled', aggregateId: subscriptionId } })).toBe(1);
  });

  it('a partial refund never cancels the service, even if asked', async () => {
    const { invoiceId, subscriptionId } = await paidOrder(alice);
    await http().post(api(`admin/invoices/${invoiceId}/refunds`)).set(auth(finance)).send({ amount: 50, reason: 'Partial', cancelService: true }).expect(200);
    expect((await db.subscription.findUniqueOrThrow({ where: { id: subscriptionId } })).status).toBe('ACTIVE');
  });

  it('the customer sees the refund and is notified; another organisation sees nothing', async () => {
    const { invoiceId } = await paidOrder(bob);
    await http().post(api(`admin/invoices/${invoiceId}/refunds`)).set(auth(finance)).send({ amount: 25, reason: 'Courtesy credit' }).expect(200);
    const inv = await http().get(api(`invoices/${invoiceId}`)).set(auth(bob.token)).expect(200);
    expect(inv.body.refunds).toHaveLength(1);
    expect(Number(inv.body.refunds[0].amount)).toBe(25);
    expect(await db.notification.count({ where: { userId: bob.userId, type: 'refund.issued' } })).toBe(1);
    await http().get(api(`invoices/${invoiceId}`)).set(auth(alice.token)).expect(404);
  });

  it('records every refund in the audit log', async () => {
    const actions = (await db.auditLog.findMany({ where: { tenantId: alice.tenantId, action: { startsWith: 'refund.' } } })).map((a) => a.action);
    expect(actions).toContain('refund.issue');
  });
});
