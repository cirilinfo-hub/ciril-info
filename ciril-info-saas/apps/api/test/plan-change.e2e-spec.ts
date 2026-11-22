import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { BillingLifecycleService } from '../src/modules/billing/billing-lifecycle.service.js';
import { cleanupUsers, createTestApp, customer, platformDb } from './utils.js';

const DAY = 86_400_000;

/** Plan changes at the next renewal: options, validation, the renewal at the new price, and the switch on payment. */
describe('Plan change at renewal (e2e)', () => {
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  let lifecycle: BillingLifecycleService;
  let alice: Awaited<ReturnType<typeof customer>>;
  let bob: Awaited<ReturnType<typeof customer>>;
  const tag = randomUUID().slice(0, 8);
  const emails: string[] = [];
  const t0 = new Date();
  let basic: string;
  let pro: string;
  let monthlyOnly: string;
  let draftPlan: string;
  let otherProduct: string;
  const versions: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = (p: string) => `/api/v1/${p}`;

  async function plan(productId: string, slug: string, status: 'PUBLISHED' | 'DRAFT', prices: Partial<Record<'YEARLY' | 'MONTHLY', [string, string]>>) {
    const p = await db.plan.create({ data: { productId, slug: `${slug}-${tag}`, name: `Plan ${slug}`, status, isSample: true } });
    for (const [cycle, [price, renewal]] of Object.entries(prices) as ['YEARLY' | 'MONTHLY', [string, string]][]) {
      const v = await db.pricingVersion.create({ data: { planId: p.id, billingCycle: cycle, price, renewalPrice: renewal } });
      if (cycle === 'YEARLY') versions[p.id] = v.id;
    }
    return p.id;
  }

  /** An ACTIVE yearly subscription on `planId`, paid until `periodEnd`. */
  async function activeSub(planId: string, periodEnd: Date, extra: { cancelAtPeriodEnd?: boolean; status?: 'ACTIVE' | 'PENDING' } = {}) {
    const renewal = (await db.pricingVersion.findUniqueOrThrow({ where: { id: versions[planId]! } })).renewalPrice;
    return db.subscription.create({
      data: {
        tenantId: alice.tenantId, status: extra.status ?? 'ACTIVE', billingCycle: 'YEARLY', currentPeriodStart: new Date(periodEnd.getTime() - 365 * DAY), currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: extra.cancelAtPeriodEnd ?? false, autoRenew: !extra.cancelAtPeriodEnd,
        items: { create: { tenantId: alice.tenantId, planId, pricingVersionId: versions[planId]!, description: `Item ${planId.slice(0, 4)}`, unitPrice: renewal, renewalPrice: renewal } },
      },
    });
  }
  const change = (subId: string, token = alice.token, body: object = { planId: pro }) => http().post(api(`subscriptions/${subId}/plan-change`)).set(auth(token)).send(body);

  beforeAll(async () => {
    app = await createTestApp();
    db = platformDb();
    lifecycle = app.get(BillingLifecycleService);
    alice = await customer(app, db, 'chg-a');
    bob = await customer(app, db, 'chg-b');
    emails.push(alice.email, bob.email);
    for (const c of [alice, bob]) await http().post(api('organisation/addresses')).set(auth(c.token)).send({ line1: '1 Test Street', city: 'Pune', stateCode: '27', postalCode: '411001' }).expect(201);

    const category = await db.productCategory.upsert({ where: { slug: 'hosting' }, update: {}, create: { slug: 'hosting', name: 'Hosting' } });
    const mkProduct = (s: string) => db.product.create({ data: { categoryId: category.id, slug: `t-${s}-${tag}`, name: `Product ${s}`, type: 'WEB_HOSTING', status: 'PUBLISHED' } });
    const main = await mkProduct('main');
    const other = await mkProduct('other');
    basic = await plan(main.id, 'basic', 'PUBLISHED', { YEARLY: ['1000.00', '1000.00'] });
    pro = await plan(main.id, 'pro', 'PUBLISHED', { YEARLY: ['2000.00', '2000.00'] });
    monthlyOnly = await plan(main.id, 'monthly', 'PUBLISHED', { MONTHLY: ['100.00', '100.00'] });
    draftPlan = await plan(main.id, 'draft', 'DRAFT', { YEARLY: ['3000.00', '3000.00'] });
    otherProduct = await plan(other.id, 'elsewhere', 'PUBLISHED', { YEARLY: ['500.00', '500.00'] });
  });

  afterAll(async () => {
    const tenantIds = [alice?.tenantId, bob?.tenantId].filter(Boolean) as string[];
    await db.payment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.invoice.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.subscription.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.outboxEvent.deleteMany({ where: { tenantId: { in: tenantIds }, type: { in: ['subscription.activated', 'subscription.plan_changed', 'email.send'] } } });
    const planIds = [basic, pro, monthlyOnly, draftPlan, otherProduct];
    await db.pricingVersion.deleteMany({ where: { planId: { in: planIds } } });
    await db.plan.deleteMany({ where: { id: { in: planIds } } });
    await db.product.deleteMany({ where: { slug: { endsWith: `-${tag}` } } });
    await cleanupUsers(db, emails);
    await app.close();
  });

  it('lists only other published plans of the same product sold for the billing period', async () => {
    const sub = await activeSub(basic, new Date(t0.getTime() + 200 * DAY));
    const r = await http().get(api(`subscriptions/${sub.id}/plan-options`)).set(auth(alice.token)).expect(200);
    const ids = r.body.plans.map((p: { planId: string }) => p.planId);
    expect(ids).toEqual(expect.arrayContaining([basic, pro]));
    expect(ids).not.toContain(monthlyOnly); // no yearly price
    expect(ids).not.toContain(draftPlan); // not published
    expect(ids).not.toContain(otherProduct); // a different product
    expect(r.body.plans.find((p: { planId: string }) => p.planId === basic).isCurrent).toBe(true);
    expect(Number(r.body.plans.find((p: { planId: string }) => p.planId === pro).renewalPrice)).toBe(2000);
  });

  it('refuses invalid choices and other customers', async () => {
    const sub = await activeSub(basic, new Date(t0.getTime() + 200 * DAY));
    await http().post(api(`subscriptions/${sub.id}/plan-change`)).send({ planId: pro }).expect(401);
    await change(sub.id, alice.token, {}).expect(400);
    expect((await change(sub.id, alice.token, { planId: basic }).expect(409)).body.error.message).toContain('already on this plan');
    expect((await change(sub.id, alice.token, { planId: otherProduct }).expect(409)).body.error.message).toContain('same product');
    expect((await change(sub.id, alice.token, { planId: monthlyOnly }).expect(409)).body.error.code).toBe('NO_PRICE');
    await change(sub.id, alice.token, { planId: draftPlan }).expect(404);
    await change(sub.id, alice.token, { planId: randomUUID() }).expect(404);
    await change(sub.id, bob.token).expect(404); // not their subscription
    await http().get(api(`subscriptions/${sub.id}/plan-options`)).set(auth(bob.token)).expect(404);
    expect((await db.subscription.findUniqueOrThrow({ where: { id: sub.id } })).scheduledPlanId).toBeNull();
  });

  it('only an active, renewing service can change plan', async () => {
    const ending = await activeSub(basic, new Date(t0.getTime() + 200 * DAY), { cancelAtPeriodEnd: true });
    expect((await change(ending.id).expect(409)).body.error.code).toBe('PLAN_CHANGE_UNAVAILABLE');
    const pending = await db.subscription.create({
      data: { tenantId: alice.tenantId, status: 'PENDING', billingCycle: 'YEARLY', items: { create: { tenantId: alice.tenantId, planId: basic, pricingVersionId: versions[basic]!, description: 'x', unitPrice: '1000', renewalPrice: '1000' } } },
    });
    expect((await change(pending.id).expect(409)).body.error.code).toBe('PLAN_CHANGE_UNAVAILABLE');
  });

  describe('upgrade at renewal', () => {
    let subId: string;
    let end: Date;

    it('schedules the change, shows it on the service, and can be withdrawn and set again', async () => {
      end = new Date(t0.getTime() + 60 * DAY);
      subId = (await activeSub(basic, end)).id;
      const r = await change(subId, alice.token, { planRef: `t-main-${tag}/pro-${tag}` }).expect(200); // product/plan reference
      expect(r.body.scheduledPlanId).toBe(pro);
      const list = await http().get(api('subscriptions')).set(auth(alice.token)).expect(200);
      expect(list.body.data.find((s: { id: string }) => s.id === subId).scheduledPlan.name).toBe('Plan pro');

      await http().delete(api(`subscriptions/${subId}/plan-change`)).set(auth(alice.token)).expect(204);
      await http().delete(api(`subscriptions/${subId}/plan-change`)).set(auth(alice.token)).expect(204); // repeatable
      expect((await db.subscription.findUniqueOrThrow({ where: { id: subId } })).scheduledPlanId).toBeNull();
      await change(subId).expect(200);
    });

    it('the renewal invoice is at the new plan price; the current plan stays until it is paid', async () => {
      await lifecycle.run(new Date(end.getTime() - 5 * DAY));
      const [inv] = await db.invoice.findMany({ where: { subscriptionId: subId }, include: { items: true } });
      expect(Number(inv!.subtotal)).toBe(2000);
      expect(inv!.items[0]!.description).toContain('Plan pro');
      expect((inv!.billingSnapshot as { planChange?: { planId: string } }).planChange?.planId).toBe(pro);
      const item = await db.subscriptionItem.findFirstOrThrow({ where: { subscriptionId: subId } });
      expect(item.planId).toBe(basic);
    });

    it('once the renewal invoice exists, a further change has to wait', async () => {
      const r = await change(subId, alice.token, { planId: basic }).expect(409);
      expect(r.body.error.code).toBe('RENEWAL_ALREADY_INVOICED');
    });

    it('paying switches the plan, records an upgrade and queues the event', async () => {
      const [inv] = await db.invoice.findMany({ where: { subscriptionId: subId } });
      await http().post(api(`invoices/${inv!.id}/pay`)).set(auth(alice.token)).send({}).expect(200);
      const sub = await db.subscription.findUniqueOrThrow({ where: { id: subId }, include: { items: true, history: true } });
      expect(sub.items[0]!.planId).toBe(pro);
      expect(Number(sub.items[0]!.renewalPrice)).toBe(2000);
      expect(sub.items[0]!.pricingVersionId).toBe(versions[pro]);
      expect(sub.scheduledPlanId).toBeNull();
      expect(sub.history.map((h) => h.event)).toEqual(expect.arrayContaining(['RENEWED', 'UPGRADED']));
      expect(await db.outboxEvent.count({ where: { type: 'subscription.plan_changed', aggregateId: subId } })).toBe(1);
      expect(sub.currentPeriodStart!.toISOString()).toBe(end.toISOString());
    });
  });

  it('a downgrade is recorded as one', async () => {
    const end = new Date(t0.getTime() + 61 * DAY);
    const sub = await activeSub(pro, end);
    await change(sub.id, alice.token, { planId: basic }).expect(200);
    await lifecycle.run(new Date(end.getTime() - 3 * DAY));
    const [inv] = await db.invoice.findMany({ where: { subscriptionId: sub.id } });
    expect(Number(inv!.subtotal)).toBe(1000);
    await http().post(api(`invoices/${inv!.id}/pay`)).set(auth(alice.token)).send({}).expect(200);
    const after = await db.subscription.findUniqueOrThrow({ where: { id: sub.id }, include: { items: true, history: true } });
    expect(after.items[0]!.planId).toBe(basic);
    expect(after.history.map((h) => h.event)).toContain('DOWNGRADED');
  });

  it('if the chosen plan is withdrawn before renewal, the renewal stays on the current plan', async () => {
    const end = new Date(t0.getTime() + 62 * DAY);
    const sub = await activeSub(basic, end);
    await change(sub.id).expect(200);
    await db.plan.update({ where: { id: pro }, data: { status: 'DRAFT' } });
    try {
      await lifecycle.run(new Date(end.getTime() - 2 * DAY));
    } finally {
      await db.plan.update({ where: { id: pro }, data: { status: 'PUBLISHED' } });
    }
    const [inv] = await db.invoice.findMany({ where: { subscriptionId: sub.id } });
    expect(Number(inv!.subtotal)).toBe(1000); // renewal at the current plan's price
    expect((inv!.billingSnapshot as { planChange?: unknown }).planChange).toBeUndefined();
    expect((await db.subscription.findUniqueOrThrow({ where: { id: sub.id } })).scheduledPlanId).toBeNull();
  });
});
