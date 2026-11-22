import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { BillingLifecycleService } from '../src/modules/billing/billing-lifecycle.service.js';
import { cleanupUsers, createTestApp, customer, platformDb } from './utils.js';

const DAY = 86_400_000;

/**
 * Renewals, overdue, past due and expiry. A fake clock moves time forward; subscriptions are created directly so each
 * scenario starts from a known period. Assertions look only at this test's own rows (the job is global).
 */
describe('Billing lifecycle (e2e)', () => {
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  let lifecycle: BillingLifecycleService;
  let alice: Awaited<ReturnType<typeof customer>>;
  const tag = randomUUID().slice(0, 8);
  const emails: string[] = [];
  let planId: string;
  let versionId: string;
  const t0 = new Date();

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = (p: string) => `/api/v1/${p}`;

  /** An ACTIVE yearly subscription whose paid period ends at `periodEnd`. */
  async function activeSub(periodEnd: Date, extra: { cancelAtPeriodEnd?: boolean; autoRenew?: boolean } = {}) {
    return db.subscription.create({
      data: {
        tenantId: alice.tenantId, status: 'ACTIVE', billingCycle: 'YEARLY', currentPeriodStart: new Date(periodEnd.getTime() - 365 * DAY), currentPeriodEnd: periodEnd,
        autoRenew: extra.autoRenew ?? true, cancelAtPeriodEnd: extra.cancelAtPeriodEnd ?? false,
        items: { create: { tenantId: alice.tenantId, planId, pricingVersionId: versionId, description: `Plan ${tag}`, unitPrice: '1000.00', renewalPrice: '2500.00' } },
      },
    });
  }
  const renewalInvoices = (subscriptionId: string) => db.invoice.findMany({ where: { subscriptionId }, orderBy: { createdAt: 'asc' }, include: { items: true } });

  beforeAll(async () => {
    app = await createTestApp();
    db = platformDb();
    lifecycle = app.get(BillingLifecycleService);
    alice = await customer(app, db, 'lifecycle');
    emails.push(alice.email);
    const category = await db.productCategory.upsert({ where: { slug: 'hosting' }, update: {}, create: { slug: 'hosting', name: 'Hosting' } });
    const product = await db.product.create({ data: { categoryId: category.id, slug: `t-prod-${tag}`, name: `Lifecycle ${tag}`, type: 'WEB_HOSTING', status: 'PUBLISHED' } });
    const plan = await db.plan.create({ data: { productId: product.id, slug: `t-plan-${tag}`, name: `Plan ${tag}`, status: 'PUBLISHED', isSample: true } });
    planId = plan.id;
    versionId = (await db.pricingVersion.create({ data: { planId, billingCycle: 'YEARLY', price: '1000.00', renewalPrice: '2500.00' } })).id;
  });

  afterAll(async () => {
    await db.payment.deleteMany({ where: { tenantId: alice.tenantId } });
    await db.invoice.deleteMany({ where: { tenantId: alice.tenantId } });
    await db.subscription.deleteMany({ where: { tenantId: alice.tenantId } });
    await db.outboxEvent.deleteMany({ where: { tenantId: alice.tenantId, type: { in: ['subscription.activated', 'subscription.expired', 'email.send'] } } });
    await db.pricingVersion.deleteMany({ where: { planId } });
    await db.plan.deleteMany({ where: { id: planId } });
    await db.product.deleteMany({ where: { slug: `t-prod-${tag}` } });
    await cleanupUsers(db, emails);
    await app.close();
  });

  it('issues one renewal invoice at the renewal price, 14 days ahead, and tells the customer', async () => {
    const end = new Date(t0.getTime() + 10 * DAY);
    const sub = await activeSub(end);
    const far = await activeSub(new Date(t0.getTime() + 60 * DAY));

    await lifecycle.run(t0);
    const [inv, ...rest] = await renewalInvoices(sub.id);
    expect(rest).toHaveLength(0);
    expect(inv!.status).toBe('ISSUED');
    expect(inv!.dueAt!.toISOString()).toBe(end.toISOString());
    expect(inv!.items[0]!.description).toContain('(renewal)');
    expect(Number(inv!.subtotal)).toBe(2500);
    expect(inv!.number).toMatch(/^INV-\d{4}-\d{2}-\d{6}$/);
    expect(await renewalInvoices(far.id)).toHaveLength(0); // not due yet

    expect(await db.notification.count({ where: { userId: alice.userId, type: 'invoice.renewal' } })).toBe(1);
    expect(await db.outboxEvent.count({ where: { tenantId: alice.tenantId, type: 'email.send', payload: { path: ['template'], equals: 'renewal-invoice' } } })).toBe(1);

    await lifecycle.run(t0);
    await lifecycle.run(new Date(t0.getTime() + DAY));
    expect(await renewalInvoices(sub.id)).toHaveLength(1); // once per period, however often it runs
  });

  it('paying the renewal extends the period from its old end', async () => {
    const end = new Date(t0.getTime() + 5 * DAY);
    const sub = await activeSub(end);
    await lifecycle.run(t0);
    const [inv] = await renewalInvoices(sub.id);
    const paid = await http().post(api(`invoices/${inv!.id}/pay`)).set(auth(alice.token)).send({}).expect(200);
    expect(paid.body.invoice.status).toBe('PAID');
    const after = await db.subscription.findUniqueOrThrow({ where: { id: sub.id }, include: { history: true } });
    expect(after.status).toBe('ACTIVE');
    expect(after.currentPeriodStart!.toISOString()).toBe(end.toISOString());
    expect(after.currentPeriodEnd!.getUTCFullYear()).toBe(end.getUTCFullYear() + 1);
    expect(after.history.map((h) => h.event)).toContain('RENEWED');
    // Nothing more to do until the next period approaches.
    await lifecycle.run(new Date(end.getTime() + DAY));
    expect(await renewalInvoices(sub.id)).toHaveLength(1);
    expect((await db.subscription.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe('ACTIVE');
  });

  it('unpaid: overdue, then past due, then paying late still renews', async () => {
    const end = new Date(t0.getTime() + 3 * DAY);
    const sub = await activeSub(end);
    await lifecycle.run(t0);
    const [inv] = await renewalInvoices(sub.id);

    await lifecycle.run(new Date(end.getTime() + DAY));
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv!.id } })).status).toBe('OVERDUE');
    expect((await db.subscription.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe('PAST_DUE');
    expect(await db.notification.count({ where: { userId: alice.userId, type: 'subscription.past_due' } })).toBeGreaterThanOrEqual(1);

    await http().post(api(`invoices/${inv!.id}/pay`)).set(auth(alice.token)).send({}).expect(200);
    const after = await db.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after.status).toBe('ACTIVE');
    expect(after.currentPeriodStart!.toISOString()).toBe(end.toISOString());
  });

  it('unpaid beyond the grace period expires the service and voids the invoice', async () => {
    const end = new Date(t0.getTime() + 2 * DAY);
    const sub = await activeSub(end);
    await lifecycle.run(t0);
    await lifecycle.run(new Date(end.getTime() + DAY));
    expect((await db.subscription.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe('PAST_DUE');

    await lifecycle.run(new Date(end.getTime() + 8 * DAY));
    const after = await db.subscription.findUniqueOrThrow({ where: { id: sub.id }, include: { history: true } });
    expect(after.status).toBe('EXPIRED');
    expect(after.history.map((h) => h.event)).toContain('EXPIRED');
    expect((await renewalInvoices(sub.id))[0]!.status).toBe('VOID');
    expect(await db.outboxEvent.count({ where: { type: 'subscription.expired', aggregateId: sub.id } })).toBe(1);
    // An expired service cannot be paid for any more.
    await http().post(api(`invoices/${(await renewalInvoices(sub.id))[0]!.id}/pay`)).set(auth(alice.token)).send({}).expect(409);
  });

  it('a cancelled subscription gets no renewal invoice and simply expires at period end', async () => {
    const end = new Date(t0.getTime() + 4 * DAY);
    const sub = await activeSub(end, { cancelAtPeriodEnd: true, autoRenew: false });
    await lifecycle.run(t0);
    expect(await renewalInvoices(sub.id)).toHaveLength(0);
    await lifecycle.run(new Date(end.getTime() + 1000));
    expect((await db.subscription.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe('EXPIRED');
  });

  it('an unpaid first order is cancelled after 14 days; a recent one and a paid one are left alone', async () => {
    const mk = async (ageDays: number) => {
      const sub = await db.subscription.create({
        data: {
          tenantId: alice.tenantId, status: 'PENDING', billingCycle: 'YEARLY', createdAt: new Date(t0.getTime() - ageDays * DAY),
          items: { create: { tenantId: alice.tenantId, planId, pricingVersionId: versionId, description: `Plan ${tag}`, unitPrice: '1000.00', renewalPrice: '1000.00' } },
        },
      });
      const inv = await db.invoice.create({
        data: { tenantId: alice.tenantId, subscriptionId: sub.id, number: `T-${randomUUID().slice(0, 8)}`, status: 'ISSUED', subtotal: '1000.00', total: '1000.00', issuedAt: new Date(t0.getTime() - ageDays * DAY) },
      });
      return { sub, inv };
    };
    const old = await mk(15);
    const fresh = await mk(3);

    await lifecycle.run(t0);
    expect((await db.subscription.findUniqueOrThrow({ where: { id: old.sub.id } })).status).toBe('CANCELLED');
    expect((await db.invoice.findUniqueOrThrow({ where: { id: old.inv.id } })).status).toBe('VOID');
    expect((await db.subscription.findUniqueOrThrow({ where: { id: fresh.sub.id } })).status).toBe('PENDING');
    expect((await db.invoice.findUniqueOrThrow({ where: { id: fresh.inv.id } })).status).toBe('ISSUED');
    expect(await db.notification.count({ where: { userId: alice.userId, type: 'order.expired' } })).toBe(1);
    await http().post(api(`invoices/${old.inv.id}/pay`)).set(auth(alice.token)).send({}).expect(409);

    // Later, the fresh one is also abandoned.
    await lifecycle.run(new Date(t0.getTime() + 12 * DAY));
    expect((await db.subscription.findUniqueOrThrow({ where: { id: fresh.sub.id } })).status).toBe('CANCELLED');
  });

  it('suspended organisations are not billed', async () => {
    const end = new Date(t0.getTime() + 3 * DAY);
    const sub = await activeSub(end);
    await db.tenant.update({ where: { id: alice.tenantId }, data: { status: 'SUSPENDED' } });
    try {
      await lifecycle.run(t0);
      expect(await renewalInvoices(sub.id)).toHaveLength(0);
    } finally {
      await db.tenant.update({ where: { id: alice.tenantId }, data: { status: 'ACTIVE' } });
    }
  });
});
