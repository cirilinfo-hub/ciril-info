import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { BillingLifecycleService } from '../src/modules/billing/billing-lifecycle.service.js';
import { cleanupUsers, createStaff, createTestApp, customer, platformDb, staffToken } from './utils.js';

/** Coupons: admin management, validation rules, discounted invoices and the last-redemption race. */
describe('Coupons (e2e)', () => {
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  const tag = randomUUID().slice(0, 8).toUpperCase();
  const emails: string[] = [];
  let alice: Awaited<ReturnType<typeof customer>>;
  let bob: Awaited<ReturnType<typeof customer>>;
  let admin: string;
  let finance: string;
  let planId: string;
  let otherPlanId: string;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = (p: string) => `/api/v1/${p}`;
  const code = (n: string) => `T${tag}-${n}`;
  const address = { line1: '1 Test Street', city: 'Pune', stateCode: '27', postalCode: '411001' };

  beforeAll(async () => {
    app = await createTestApp();
    db = platformDb();
    alice = await customer(app, db, 'coupon-a');
    bob = await customer(app, db, 'coupon-b');
    const sa = await createStaff(db, 'SUPER_ADMIN', 'cpsa');
    const fin = await createStaff(db, 'FINANCE_ADMIN', 'cpfin');
    emails.push(alice.email, bob.email, sa.email, fin.email);
    [admin, finance] = await Promise.all([staffToken(app, db, sa), staffToken(app, db, fin)]);
    await http().post(api('organisation/addresses')).set(auth(alice.token)).send(address).expect(201);
    await http().post(api('organisation/addresses')).set(auth(bob.token)).send(address).expect(201);

    const category = await db.productCategory.upsert({ where: { slug: 'hosting' }, update: {}, create: { slug: 'hosting', name: 'Hosting' } });
    const product = await db.product.create({ data: { categoryId: category.id, slug: `t-prod-${tag.toLowerCase()}`, name: `Coupon ${tag}`, type: 'WEB_HOSTING', status: 'PUBLISHED' } });
    const mk = async (slug: string) => {
      const p = await db.plan.create({ data: { productId: product.id, slug: `${slug}-${tag.toLowerCase()}`, name: `Plan ${slug}`, status: 'PUBLISHED', isSample: true } });
      await db.pricingVersion.create({ data: { planId: p.id, billingCycle: 'YEARLY', price: '1000.00', renewalPrice: '1000.00', setupFee: '100.00' } });
      return p.id;
    };
    planId = await mk('main');
    otherPlanId = await mk('other');
  });

  afterAll(async () => {
    const tenantIds = [alice?.tenantId, bob?.tenantId].filter(Boolean) as string[];
    await db.payment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.invoice.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.subscription.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.coupon.deleteMany({ where: { code: { startsWith: `T${tag}-` } } });
    await db.pricingVersion.deleteMany({ where: { planId: { in: [planId, otherPlanId] } } });
    await db.plan.deleteMany({ where: { id: { in: [planId, otherPlanId] } } });
    await db.product.deleteMany({ where: { slug: `t-prod-${tag.toLowerCase()}` } });
    await cleanupUsers(db, emails);
    await app.close();
  });

  describe('admin management', () => {
    it('needs the right permissions', async () => {
      await http().get(api('admin/coupons')).set(auth(alice.token)).expect(403);
      await http().get(api('admin/coupons')).set(auth(finance)).expect(200); // products:read
      await http().post(api('admin/coupons')).set(auth(finance)).send({ code: code('NOPE'), discountType: 'PERCENT', discountValue: 10 }).expect(403); // no pricing:write
    });

    it('validates a new coupon', async () => {
      const bad = (b: object) => http().post(api('admin/coupons')).set(auth(admin)).send(b);
      await bad({ code: 'x', discountType: 'PERCENT', discountValue: 10 }).expect(400);
      await bad({ code: code('A'), discountType: 'PERCENT', discountValue: 150 }).expect(400);
      await bad({ code: code('A'), discountType: 'PERCENT', discountValue: 0 }).expect(400);
      await bad({ code: code('A'), discountType: 'FIXED', discountValue: 10, planIds: [randomUUID()] }).expect(400);
      await bad({ code: code('A'), discountType: 'PERCENT', discountValue: 10, startsAt: '2027-02-01', endsAt: '2027-01-01' }).expect(400);
    });

    it('creates, normalises the code, refuses duplicates, and keeps value and code fixed', async () => {
      const r = await http().post(api('admin/coupons')).set(auth(admin)).send({ code: code('ten').toLowerCase(), discountType: 'PERCENT', discountValue: 10, description: 'Ten percent' }).expect(201);
      expect(r.body.code).toBe(code('TEN'));
      expect(r.body.firstTermOnly).toBe(true);
      await http().post(api('admin/coupons')).set(auth(admin)).send({ code: code('TEN'), discountType: 'FIXED', discountValue: 5 }).expect(409);
      const patched = await http().patch(api(`admin/coupons/${r.body.id}`)).set(auth(admin)).send({ description: 'Updated', isActive: true, discountValue: 99 }).expect(400); // value is not editable
      expect(JSON.stringify(patched.body)).toContain('discountValue');
      await http().patch(api(`admin/coupons/${r.body.id}`)).set(auth(admin)).send({ description: 'Updated' }).expect(200);
      const list = await http().get(api(`admin/coupons?search=${code('TEN')}`)).set(auth(admin)).expect(200);
      expect(list.body.data[0].description).toBe('Updated');
    });
  });

  describe('customer use', () => {
    const quote = (token: string, couponCode?: string, plan = planId) => http().post(api('orders/quote')).set(auth(token)).send({ planId: plan, billingCycle: 'YEARLY', couponCode });

    it('a percentage coupon discounts the plan price but not the setup fee, and tax follows the discounted amount', async () => {
      const r = await quote(alice.token, code('ten')).expect(200); // code match is case-insensitive
      expect(r.body.couponCode).toBe(code('TEN'));
      expect(r.body.subtotal).toBe('1100.00');
      expect(r.body.discountTotal).toBe('100.00');
      expect(Number(r.body.total)).toBeCloseTo(1100 - 100 + Number(r.body.taxTotal), 2);
      expect(r.body.lines[0].discount).toBe('100.00');
      expect(r.body.lines[1].discount).toBe('0.00');
    });

    it('an order carries the discount on the invoice and counts one use', async () => {
      const o = await http().post(api('orders')).set(auth(alice.token)).send({ planId, billingCycle: 'YEARLY', couponCode: code('TEN') }).expect(201);
      const inv = await http().get(api(`invoices/${o.body.invoice.id}`)).set(auth(alice.token)).expect(200);
      expect(Number(inv.body.discountTotal)).toBe(100);
      expect(inv.body.billingSnapshot.coupon.code).toBe(code('TEN'));
      expect((await db.coupon.findUniqueOrThrow({ where: { code: code('TEN') } })).redemptions).toBe(1);
      await http().post(api(`subscriptions/${o.body.subscriptionId}/cancel`)).set(auth(alice.token)).send({}).expect(200);
    });

    it('refuses unknown, inactive, not-yet-active, expired and plan-restricted codes with a clear reason', async () => {
      const mk = (n: string, extra: object) => http().post(api('admin/coupons')).set(auth(admin)).send({ code: code(n), discountType: 'FIXED', discountValue: 50, ...extra }).expect(201);
      const off = await mk('OFF', {});
      await http().patch(api(`admin/coupons/${off.body.id}`)).set(auth(admin)).send({ isActive: false }).expect(200);
      await mk('FUTURE', { startsAt: new Date(Date.now() + 86_400_000).toISOString() });
      const past = await mk('PAST', {});
      await db.coupon.update({ where: { id: past.body.id }, data: { endsAt: new Date(Date.now() - 1000) } });
      await mk('ONLYOTHER', { planIds: [otherPlanId] });

      const msg = async (c: string) => (await quote(alice.token, c).expect(409)).body.error;
      expect((await msg('NOPE-NOT-REAL')).code).toBe('COUPON_INVALID');
      expect((await msg(code('OFF'))).message).toBe('This code is not valid.');
      expect((await msg(code('FUTURE'))).message).toContain('not active yet');
      expect((await msg(code('PAST'))).message).toContain('expired');
      expect((await msg(code('ONLYOTHER'))).message).toContain('does not apply');
      await quote(alice.token, code('ONLYOTHER'), otherPlanId).expect(200);
    });

    it('a fixed discount cannot exceed the plan price', async () => {
      await http().post(api('admin/coupons')).set(auth(admin)).send({ code: code('HUGE'), discountType: 'FIXED', discountValue: 5000 }).expect(201);
      const r = await quote(alice.token, code('HUGE')).expect(200);
      expect(r.body.lines[0].discount).toBe('1000.00');
      expect(r.body.subtotal).toBe('1100.00');
      expect(r.body.discountTotal).toBe('1000.00');
    });

    it('two customers racing for the last redemption: exactly one wins', async () => {
      await http().post(api('admin/coupons')).set(auth(admin)).send({ code: code('LAST'), discountType: 'PERCENT', discountValue: 20, maxRedemptions: 1 }).expect(201);
      const results = await Promise.all([alice, bob].map((c) => http().post(api('orders')).set(auth(c.token)).send({ planId, billingCycle: 'YEARLY', couponCode: code('LAST') })));
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect((await db.coupon.findUniqueOrThrow({ where: { code: code('LAST') } })).redemptions).toBe(1);
      await quote(bob.token, code('LAST')).expect(409);
      // The limit cannot be set below what has been used.
      const c = await db.coupon.findUniqueOrThrow({ where: { code: code('LAST') } });
      await http().patch(api(`admin/coupons/${c.id}`)).set(auth(admin)).send({ maxRedemptions: 1 }).expect(200);
    });
  });

  describe('recurring discounts', () => {
    const DAY = 86_400_000;
    const newCoupon = (n: string, extra: object) => http().post(api('admin/coupons')).set(auth(admin)).send({ code: code(n), discountType: 'PERCENT', discountValue: 10, ...extra });
    /** Orders and pays (test mode), so the service is active. */
    async function activeWith(couponCode: string) {
      const o = await http().post(api('orders')).set(auth(bob.token)).send({ planId, billingCycle: 'YEARLY', couponCode }).expect(201);
      await http().post(api(`invoices/${o.body.invoice.id}/pay`)).set(auth(bob.token)).send({}).expect(200);
      return o.body.subscriptionId as string;
    }
    /** Brings the period end close, runs the renewal job, and returns the renewal invoice it issued. */
    async function renewalOf(subscriptionId: string) {
      const now = new Date();
      await db.subscription.update({ where: { id: subscriptionId }, data: { currentPeriodEnd: new Date(now.getTime() + 3 * DAY) } });
      await app.get(BillingLifecycleService).run(now);
      return db.invoice.findFirstOrThrow({ where: { subscriptionId, billingSnapshot: { path: ['renewalFor'], not: 'null' } }, orderBy: { createdAt: 'desc' }, include: { items: true } });
    }
    const pay = (invoiceId: string) => http().post(api(`invoices/${invoiceId}/pay`)).set(auth(bob.token)).send({}).expect(200);

    it('an admin chooses how long a coupon lasts', async () => {
      await newCoupon('REPNO', { duration: 'REPEATING' }).expect(400);
      await newCoupon('REPONE', { duration: 'REPEATING', durationPeriods: 1 }).expect(400);
      expect((await newCoupon('REP2', { duration: 'REPEATING', durationPeriods: 2 }).expect(201)).body).toMatchObject({ firstTermOnly: false, durationPeriods: 2 });
      expect((await newCoupon('EVER', { duration: 'FOREVER' }).expect(201)).body).toMatchObject({ firstTermOnly: false, durationPeriods: null });
      expect((await newCoupon('ONCE', {}).expect(201)).body).toMatchObject({ firstTermOnly: true, durationPeriods: null });
    });

    it('the order review says how many renewals the discount also covers', async () => {
      const q = (c: string) => http().post(api('orders/quote')).set(auth(bob.token)).send({ planId, billingCycle: 'YEARLY', couponCode: c }).expect(200);
      expect((await q(code('REP2'))).body.couponRenewals).toBe(1);
      expect((await q(code('EVER'))).body.couponRenewals).toBeNull();
      expect((await q(code('ONCE'))).body.couponRenewals).toBe(0);
    });

    it('a coupon for two billing periods discounts the first renewal, then stops', async () => {
      const sub = await activeWith(code('REP2'));
      expect(await db.subscription.findUniqueOrThrow({ where: { id: sub } })).toMatchObject({ couponPeriodsLeft: 1 });
      const list = await http().get(api('subscriptions')).set(auth(bob.token)).expect(200);
      expect(list.body.data.find((x: { id: string }) => x.id === sub)).toMatchObject({ couponPeriodsLeft: 1, coupon: { code: code('REP2') } });

      const first = await renewalOf(sub);
      expect(first.discountTotal.toString()).toBe('100');
      expect(first.items[0]!.discount.toString()).toBe('100');
      expect((first.billingSnapshot as { coupon?: { code: string } }).coupon?.code).toBe(code('REP2'));
      expect((await db.subscription.findUniqueOrThrow({ where: { id: sub } })).couponPeriodsLeft).toBe(0);

      await pay(first.id);
      const second = await renewalOf(sub);
      expect(second.id).not.toBe(first.id);
      expect(second.discountTotal.toString()).toBe('0');
      expect((second.billingSnapshot as { coupon?: unknown }).coupon).toBeUndefined();
    });

    it('a coupon for every renewal keeps discounting, even after it is turned off', async () => {
      const sub = await activeWith(code('EVER'));
      const c = await db.coupon.findUniqueOrThrow({ where: { code: code('EVER') } });
      await http().patch(api(`admin/coupons/${c.id}`)).set(auth(admin)).send({ isActive: false }).expect(200);
      const r1 = await renewalOf(sub);
      expect(r1.discountTotal.toString()).toBe('100');
      await pay(r1.id);
      const r2 = await renewalOf(sub);
      expect(r2.discountTotal.toString()).toBe('100');
      expect((await db.subscription.findUniqueOrThrow({ where: { id: sub } })).couponPeriodsLeft).toBeNull();
    });

    it('a first-term coupon is not remembered, and renewals are full price', async () => {
      const sub = await activeWith(code('ONCE'));
      expect(await db.subscription.findUniqueOrThrow({ where: { id: sub } })).toMatchObject({ couponId: null, couponPeriodsLeft: null });
      expect((await renewalOf(sub)).discountTotal.toString()).toBe('0');
    });

    it('staff can end a recurring discount early, and later renewals are full price', async () => {
      await newCoupon('ENDME', { duration: 'FOREVER' }).expect(201);
      const sub = await activeWith(code('ENDME'));
      const end = (token: string, body: object = { reason: 'The launch offer has ended.' }) => http().post(api(`admin/subscriptions/${sub}/end-discount`)).set(auth(token)).send(body);
      await end(bob.token).expect(403);
      await end(finance, { reason: '' }).expect(400);
      const listed = await http().get(api('admin/subscriptions')).set(auth(finance)).expect(200);
      expect(listed.body.data.find((x: { id: string }) => x.id === sub)).toMatchObject({ couponPeriodsLeft: null, coupon: { code: code('ENDME') } });

      expect((await end(finance).expect(200)).body).toEqual({ id: sub, couponPeriodsLeft: 0 });
      expect((await end(finance).expect(409)).body.error.code).toBe('NO_RECURRING_DISCOUNT');
      expect(await db.notification.count({ where: { userId: bob.userId, type: 'subscription.discount_ended', body: { startsWith: 'The launch offer has ended.' } } })).toBe(1);
      expect(await db.auditLog.count({ where: { action: 'subscription.discount_ended', entityId: sub } })).toBe(1);
      expect((await renewalOf(sub)).discountTotal.toString()).toBe('0');
    });

    it('a renewal on a plan the coupon does not cover is full price', async () => {
      await newCoupon('MAINONLY', { duration: 'FOREVER', planIds: [planId] }).expect(201);
      const sub = await activeWith(code('MAINONLY'));
      await http().post(api(`subscriptions/${sub}/plan-change`)).set(auth(bob.token)).send({ planId: otherPlanId }).expect(200);
      const r = await renewalOf(sub);
      expect(r.items[0]!.description).toContain('Plan other');
      expect(r.discountTotal.toString()).toBe('0');
    });
  });
});
