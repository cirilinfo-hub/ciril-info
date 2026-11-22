import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { cleanupUsers, createStaff, createTestApp, customer, platformDb, staffToken } from './utils.js';

/** Admin billing: who can see and void what, and the figures that feed the dashboard. */
describe('Admin billing (e2e)', () => {
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  const tag = randomUUID().slice(0, 8);
  const emails: string[] = [];
  let alice: Awaited<ReturnType<typeof customer>>;
  let finance: string;
  let support: string;
  let planId: string;
  let paidInvoice: string;
  let unpaidInvoice: string;
  let unpaidSub: string;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = (p: string) => `/api/v1/${p}`;

  beforeAll(async () => {
    app = await createTestApp();
    db = platformDb();
    alice = await customer(app, db, 'adminbill');
    const f = await createStaff(db, 'FINANCE_ADMIN', 'abfin');
    const s = await createStaff(db, 'SUPPORT_AGENT', 'absup');
    emails.push(alice.email, f.email, s.email);
    [finance, support] = await Promise.all([staffToken(app, db, f), staffToken(app, db, s)]);

    const category = await db.productCategory.upsert({ where: { slug: 'hosting' }, update: {}, create: { slug: 'hosting', name: 'Hosting' } });
    const product = await db.product.create({ data: { categoryId: category.id, slug: `t-prod-${tag}`, name: `Admin Bill ${tag}`, type: 'WEB_HOSTING', status: 'PUBLISHED' } });
    const plan = await db.plan.create({ data: { productId: product.id, slug: `t-plan-${tag}`, name: `Plan ${tag}`, status: 'PUBLISHED', isSample: true } });
    planId = plan.id;
    await db.pricingVersion.create({ data: { planId, billingCycle: 'YEARLY', price: '1000.00', renewalPrice: '1000.00' } });

    await http().post(api('organisation/addresses')).set(auth(alice.token)).send({ line1: '1 Test Street', city: 'Pune', stateCode: '27', postalCode: '411001' }).expect(201);
    const a = await http().post(api('orders')).set(auth(alice.token)).send({ planId, billingCycle: 'YEARLY' }).expect(201);
    paidInvoice = a.body.invoice.id;
    await http().post(api(`invoices/${paidInvoice}/pay`)).set(auth(alice.token)).send({}).expect(200);
    const b = await http().post(api('orders')).set(auth(alice.token)).send({ planId, billingCycle: 'YEARLY' }).expect(201);
    unpaidInvoice = b.body.invoice.id;
    unpaidSub = b.body.subscriptionId;
  });

  afterAll(async () => {
    await db.payment.deleteMany({ where: { tenantId: alice.tenantId } });
    await db.invoice.deleteMany({ where: { tenantId: alice.tenantId } });
    await db.subscription.deleteMany({ where: { tenantId: alice.tenantId } });
    await db.outboxEvent.deleteMany({ where: { tenantId: alice.tenantId, type: 'subscription.activated' } });
    const products = await db.product.findMany({ where: { slug: `t-prod-${tag}` }, select: { id: true } });
    await db.pricingVersion.deleteMany({ where: { planId } });
    await db.plan.deleteMany({ where: { id: planId } });
    await db.product.deleteMany({ where: { id: { in: products.map((p) => p.id) } } });
    await cleanupUsers(db, emails);
    await app.close();
  });

  it('requires a staff sign-in; customers are refused', async () => {
    await http().get(api('admin/invoices')).expect(401);
    await http().get(api('admin/invoices')).set(auth(alice.token)).expect(403);
    await http().get(api('admin/billing/summary')).set(auth(alice.token)).expect(403);
  });

  it('finance can list, search and filter invoices across customers', async () => {
    const all = await http().get(api('admin/invoices?search=Org adminbill')).set(auth(finance)).expect(200);
    expect(all.body.data.map((i: { id: string }) => i.id)).toEqual(expect.arrayContaining([paidInvoice, unpaidInvoice]));
    expect(all.body.data[0].tenant.name).toContain('adminbill');
    const unpaid = await http().get(api('admin/invoices?status=ISSUED&search=Org adminbill')).set(auth(finance)).expect(200);
    expect(unpaid.body.data.map((i: { id: string }) => i.id)).toEqual([unpaidInvoice]);
    await http().get(api('admin/invoices?status=NOPE')).set(auth(finance)).expect(400);
  });

  it('invoice detail shows items, payments and a test-mode flag', async () => {
    const r = await http().get(api(`admin/invoices/${paidInvoice}`)).set(auth(finance)).expect(200);
    expect(r.body.status).toBe('PAID');
    expect(r.body.items.length).toBeGreaterThan(0);
    expect(r.body.payments[0].status).toBe('SUCCEEDED');
    expect(r.body.testMode).toBe(true);
    expect(r.body.billingSnapshot.buyer.address.stateCode).toBe('27');
    await http().get(api(`admin/invoices/${randomUUID()}`)).set(auth(finance)).expect(404);
  });

  it('subscriptions are listed for staff who may read them', async () => {
    const r = await http().get(api('admin/subscriptions?search=Org adminbill')).set(auth(support)).expect(200);
    expect(r.body.data.map((s: { status: string }) => s.status).sort()).toEqual(['ACTIVE', 'PENDING']);
    await http().get(api('admin/subscriptions?status=ACTIVE&search=Org adminbill')).set(auth(finance)).expect(200);
  });

  it('only staff with billing:write can void, and a reason is required', async () => {
    await http().post(api(`admin/invoices/${unpaidInvoice}/void`)).set(auth(support)).send({ reason: 'not allowed' }).expect(403);
    await http().post(api(`admin/invoices/${unpaidInvoice}/void`)).set(auth(finance)).send({ reason: '' }).expect(400);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: unpaidInvoice } })).status).toBe('ISSUED');
  });

  it('a paid invoice cannot be voided', async () => {
    const r = await http().post(api(`admin/invoices/${paidInvoice}/void`)).set(auth(finance)).send({ reason: 'mistake' }).expect(409);
    expect(r.body.error.code).toBe('INVOICE_NOT_VOIDABLE');
  });

  it('voiding an unpaid first invoice cancels its subscription, is audited and blocks payment', async () => {
    const r = await http().post(api(`admin/invoices/${unpaidInvoice}/void`)).set(auth(finance)).send({ reason: 'Customer asked us to cancel' }).expect(200);
    expect(r.body.status).toBe('VOID');
    expect((await db.subscription.findUniqueOrThrow({ where: { id: unpaidSub } })).status).toBe('CANCELLED');
    const log = await db.auditLog.findFirst({ where: { action: 'invoice.void', entityId: unpaidInvoice } });
    expect(log?.actorId).toBeTruthy();
    await http().post(api(`invoices/${unpaidInvoice}/pay`)).set(auth(alice.token)).send({}).expect(409);
    const again = await http().post(api(`admin/invoices/${unpaidInvoice}/void`)).set(auth(finance)).send({ reason: 'again' }).expect(409);
    expect(again.body.error.message).toContain('already void');
  });

  it('the summary adds up real invoices and flags test payments', async () => {
    const r = await http().get(api('admin/billing/summary')).set(auth(finance)).expect(200);
    expect(Number(r.body.paidLast30Days.total)).toBeGreaterThanOrEqual(1000);
    expect(r.body.paidLast30Days.count).toBeGreaterThanOrEqual(1);
    expect(r.body.activeSubscriptions).toBeGreaterThanOrEqual(1);
    expect(r.body.includesTestPayments).toBe(true);
  });
});
