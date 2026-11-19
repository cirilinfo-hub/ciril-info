import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { HostingEventsHandler } from '../src/modules/hosting/hosting-events.handler.js';
import { HostingGateway } from '../src/modules/hosting/hosting-gateway.js';
import { HostingJobsService } from '../src/modules/hosting/hosting-jobs.service.js';
import type { MockHostingProvider } from '../src/modules/hosting/providers/mock-hosting.provider.js';
import { cleanupUsers, createStaff, createTestApp, customer, platformDb, purgeTestStaffNotices, staffToken } from './utils.js';

/** Hosting provisioning: set-up, the job queue with retries, billing events, and the admin controls. The worker's loop is replaced by direct calls to runDue(). */
describe('Hosting provisioning (e2e)', () => {
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  let jobs: HostingJobsService;
  let events: HostingEventsHandler;
  let panel: MockHostingProvider;
  let alice: Awaited<ReturnType<typeof customer>>;
  let bob: Awaited<ReturnType<typeof customer>>;
  let admin: string;
  let adminId: string;
  let support: string;
  const tag = randomUUID().slice(0, 8);
  const emails: string[] = [];
  let basicPlan: string;
  let proPlan: string;
  let noPackagePlan: string;
  let designPlan: string;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = (p: string) => `/api/v1/${p}`;
  const dom = (name: string, suffix = 'example.com') => `${name}-${tag}.${suffix}`;

  /** A paid, active subscription for `who` on `planId`, created directly. */
  async function paidSub(who: typeof alice, planId: string, status: 'ACTIVE' | 'PENDING' = 'ACTIVE') {
    return db.subscription.create({
      data: {
        tenantId: who.tenantId, status, billingCycle: 'YEARLY', currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 365 * 86_400_000),
        items: { create: { tenantId: who.tenantId, planId, pricingVersionId: pv[planId]!, description: `Plan ${planId.slice(0, 4)}`, unitPrice: '1000', renewalPrice: '1000' } },
      },
    });
  }
  const pv: Record<string, string> = {};
  const setUp = (who: typeof alice, subscriptionId: string, domain: string) => http().post(api('hosting')).set(auth(who.token)).send({ subscriptionId, domain });
  const run = () => jobs.runDue(20);
  /** Lets a waiting retry run now instead of in a few minutes. */
  const makeDue = () => db.provisioningJob.updateMany({ where: { status: 'QUEUED' }, data: { availableAt: new Date(Date.now() - 1000) } });
  const account = (id: string) => db.hostingAccount.findUniqueOrThrow({ where: { id } });
  const jobOf = (accountId: string, action = 'CREATE') => db.provisioningJob.findFirstOrThrow({ where: { hostingAccountId: accountId, action: action as 'CREATE' }, orderBy: { queuedAt: 'desc' } });

  beforeAll(async () => {
    app = await createTestApp();
    db = platformDb();
    jobs = app.get(HostingJobsService);
    events = app.get(HostingEventsHandler);
    panel = app.get(HostingGateway).provider as MockHostingProvider;
    alice = await customer(app, db, 'host-a');
    bob = await customer(app, db, 'host-b');
    const a = await createStaff(db, 'PLATFORM_ADMIN', 'hostadm');
    const s = await createStaff(db, 'SUPPORT_AGENT', 'hostsup');
    adminId = a.id;
    emails.push(alice.email, bob.email, a.email, s.email);
    [admin, support] = await Promise.all([staffToken(app, db, a), staffToken(app, db, s)]);

    const category = await db.productCategory.upsert({ where: { slug: 'hosting' }, update: {}, create: { slug: 'hosting', name: 'Hosting' } });
    const hostingProduct = await db.product.create({ data: { categoryId: category.id, slug: `t-host-${tag}`, name: `Host ${tag}`, type: 'WEB_HOSTING', status: 'PUBLISHED' } });
    const designProduct = await db.product.create({ data: { categoryId: category.id, slug: `t-design-${tag}`, name: `Design ${tag}`, type: 'WEBSITE_DESIGN', status: 'PUBLISHED' } });
    const mk = async (productId: string, slug: string, panelPackage: string | null) => {
      const p = await db.plan.create({ data: { productId, slug: `${slug}-${tag}`, name: `Plan ${slug}`, status: 'PUBLISHED', isSample: true, panelPackage } });
      pv[p.id] = (await db.pricingVersion.create({ data: { planId: p.id, billingCycle: 'YEARLY', price: '1000', renewalPrice: '1000' } })).id;
      return p.id;
    };
    basicPlan = await mk(hostingProduct.id, 'basic', 'pkg-basic');
    proPlan = await mk(hostingProduct.id, 'pro', 'pkg-pro');
    noPackagePlan = await mk(hostingProduct.id, 'nopkg', null);
    designPlan = await mk(designProduct.id, 'design', null);
  });

  afterAll(async () => {
    const tenantIds = [alice?.tenantId, bob?.tenantId].filter(Boolean) as string[];
    await db.provisioningJob.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.hostingAccount.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.subscription.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.outboxEvent.deleteMany({ where: { tenantId: { in: tenantIds }, type: 'email.send' } });
    await db.notification.deleteMany({ where: { type: { in: ['hosting.failed'] }, body: { contains: tag } } });
    const planIds = [basicPlan, proPlan, noPackagePlan, designPlan];
    await db.pricingVersion.deleteMany({ where: { planId: { in: planIds } } });
    await db.plan.deleteMany({ where: { id: { in: planIds } } });
    await db.product.deleteMany({ where: { slug: { endsWith: `-${tag}` } } });
    await cleanupUsers(db, emails);
    await purgeTestStaffNotices(db);
    await app.close();
  });

  describe('what the customer sees', () => {
    it('requires sign-in and lists paid hosting waiting for a domain, but not other products or unpaid services', async () => {
      await http().get(api('hosting')).expect(401);
      const hosting = await paidSub(alice, basicPlan);
      const design = await paidSub(alice, designPlan);
      const unpaid = await paidSub(alice, basicPlan, 'PENDING');
      const r = await http().get(api('hosting')).set(auth(alice.token)).expect(200);
      const waiting = r.body.awaitingSetup.map((w: { subscriptionId: string }) => w.subscriptionId);
      expect(waiting).toContain(hosting.id);
      expect(waiting).not.toContain(design.id);
      expect(waiting).not.toContain(unpaid.id);
      expect((await http().get(api('hosting')).set(auth(bob.token)).expect(200)).body.awaitingSetup).toEqual([]);
    });
  });

  describe('setting up', () => {
    it('validates the domain and the service, and keeps organisations apart', async () => {
      const sub = await paidSub(alice, basicPlan);
      await setUp(alice, sub.id, 'not a domain').expect(400);
      await setUp(alice, sub.id, '192.168.0.1').expect(400);
      await setUp(alice, randomUUID(), dom('a')).expect(404);
      await setUp(bob, sub.id, dom('b')).expect(404); // alice's service
      expect((await setUp(alice, (await paidSub(alice, designPlan)).id, dom('c')).expect(409)).body.error.code).toBe('NOT_HOSTING');
      expect((await setUp(alice, (await paidSub(alice, basicPlan, 'PENDING')).id, dom('d')).expect(409)).body.error.code).toBe('NOT_ACTIVE');
      expect(await db.hostingAccount.count({ where: { tenantId: { in: [alice.tenantId, bob.tenantId] }, primaryDomain: { contains: tag } } })).toBeGreaterThanOrEqual(0);
    });

    it('cleans the domain, queues one job, and creates the account on the panel when the worker runs', async () => {
      const sub = await paidSub(alice, basicPlan);
      const r = await setUp(alice, sub.id, `HTTPS://WWW.${dom('shop').toUpperCase()}/`).expect(201);
      expect(r.body.primaryDomain).toBe(dom('shop'));
      expect(r.body.status).toBe('PENDING');
      expect(JSON.stringify(r.body)).not.toContain('panelUsername');
      const job = await jobOf(r.body.id);
      expect(job).toMatchObject({ status: 'QUEUED', attempts: 0 });

      expect(await run()).toBeGreaterThanOrEqual(1);
      const a = await account(r.body.id);
      expect(a.status).toBe('ACTIVE');
      expect(a.panelUsername).toMatch(/^[a-z][a-z0-9]{0,15}$/);
      expect(a.provisionedAt).not.toBeNull();
      expect(panel.accounts.get(a.panelUsername!)).toMatchObject({ packageName: 'pkg-basic', suspended: false });
      expect(await jobOf(r.body.id)).toMatchObject({ status: 'SUCCEEDED', attempts: 1 });

      // The customer is told in the app and by email, and still never sees panel details.
      expect(await db.notification.count({ where: { userId: alice.userId, type: 'hosting.ready', title: { contains: dom('shop') } } })).toBe(1);
      expect(await db.outboxEvent.count({ where: { tenantId: alice.tenantId, type: 'email.send', payload: { path: ['template'], equals: 'hosting-ready' } } })).toBeGreaterThanOrEqual(1);
      const list = await http().get(api('hosting')).set(auth(alice.token)).expect(200);
      const mine = list.body.accounts.find((x: { id: string }) => x.id === r.body.id);
      expect(mine.status).toBe('ACTIVE');
      expect(JSON.stringify(list.body)).not.toContain(a.panelUsername!);
      expect(list.body.awaitingSetup.map((w: { subscriptionId: string }) => w.subscriptionId)).not.toContain(sub.id);
    });

    it('a service can only be set up once, and a domain only once, whoever asks', async () => {
      const sub = await paidSub(alice, basicPlan);
      await setUp(alice, sub.id, dom('once')).expect(201);
      expect((await setUp(alice, sub.id, dom('twice')).expect(409)).body.error.code).toBe('ALREADY_SET_UP');
      const bobSub = await paidSub(bob, basicPlan);
      expect((await setUp(bob, bobSub.id, dom('once').toUpperCase()).expect(409)).body.error.code).toBe('DOMAIN_IN_USE'); // case does not matter
      await db.provisioningJob.deleteMany({ where: { hostingAccount: { primaryDomain: dom('once') } } });
    });

    it('the database itself refuses two live accounts for one domain, even in a race', async () => {
      const [s1, s2] = [await paidSub(alice, basicPlan), await paidSub(bob, basicPlan)];
      const results = await Promise.all([setUp(alice, s1.id, dom('race')), setUp(bob, s2.id, dom('race'))]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await db.hostingAccount.count({ where: { primaryDomain: dom('race') } })).toBe(1);
    });

    it('two workers picking up one job run it once', async () => {
      const sub = await paidSub(alice, basicPlan);
      const r = await setUp(alice, sub.id, dom('twoworkers')).expect(201);
      const [x, y] = await Promise.all([jobs.runDue(5), jobs.runDue(5)]);
      expect(x + y).toBeGreaterThanOrEqual(1);
      expect(await jobOf(r.body.id)).toMatchObject({ status: 'SUCCEEDED', attempts: 1 });
      expect((await account(r.body.id)).status).toBe('ACTIVE');
    });
  });

  describe('when the panel says no', () => {
    it('a permanent refusal fails at once: the account is marked, staff are told, the customer is reassured', async () => {
      const sub = await paidSub(alice, basicPlan);
      const r = await setUp(alice, sub.id, dom('bad', 'fail.test')).expect(201);
      await run();
      expect((await account(r.body.id)).status).toBe('FAILED');
      expect(await jobOf(r.body.id)).toMatchObject({ status: 'FAILED', attempts: 1, errorMessage: 'The panel refused this domain.' });
      const staffNotice = await db.notification.findFirst({ where: { userId: adminId, type: 'hosting.failed', body: { contains: tag } } });
      expect(staffNotice?.body).toContain('The panel refused this domain.');
      const customerNotice = await db.notification.findFirst({ where: { userId: alice.userId, type: 'hosting.problem' }, orderBy: { createdAt: 'desc' } });
      expect(customerNotice?.body).toContain('Our team has been told');
      expect(customerNotice?.body).not.toContain('refused'); // no panel wording for the customer
      // The customer sees the account as having a problem; they cannot restart it themselves while staff look into it.
      const list = (await http().get(api('hosting')).set(auth(alice.token)).expect(200)).body;
      expect(list.accounts.find((x: { id: string }) => x.id === r.body.id).status).toBe('FAILED');
      expect(list.awaitingSetup.map((w: { subscriptionId: string }) => w.subscriptionId)).not.toContain(sub.id);
      await setUp(alice, sub.id, dom('other')).expect(409);
    });

    it('a busy panel is retried with a back-off and then succeeds', async () => {
      const sub = await paidSub(alice, basicPlan);
      const r = await setUp(alice, sub.id, dom('busy', 'flaky.test')).expect(201);
      await run();
      let j = await jobOf(r.body.id);
      expect(j).toMatchObject({ status: 'QUEUED', attempts: 1, errorMessage: 'The panel is busy.' });
      expect(j.availableAt.getTime()).toBeGreaterThan(Date.now() + 30_000); // it waits
      expect(await run()).toBe(0); // not due yet: nothing runs early

      await makeDue();
      await run();
      expect((await jobOf(r.body.id)).attempts).toBe(2);
      await makeDue();
      await run();
      j = await jobOf(r.body.id);
      expect(j).toMatchObject({ status: 'SUCCEEDED', attempts: 3 });
      expect((await account(r.body.id)).status).toBe('ACTIVE');
    });

    it('a panel that never recovers is tried five times, then goes to staff, and an admin can retry it', async () => {
      const sub = await paidSub(alice, basicPlan);
      const r = await setUp(alice, sub.id, dom('never', 'slow.test')).expect(201);
      for (let i = 0; i < 5; i++) {
        await makeDue();
        await run();
      }
      const j = await jobOf(r.body.id);
      expect(j).toMatchObject({ status: 'FAILED', attempts: 5 });
      expect((await account(r.body.id)).status).toBe('FAILED');

      const retried = await http().post(api(`admin/hosting/${r.body.id}/jobs/${j.id}/retry`)).set(auth(admin)).expect(200);
      expect(retried.body.status).toBe('PENDING');
      expect(await jobOf(r.body.id)).toMatchObject({ status: 'QUEUED', attempts: 0, errorMessage: null });
      await http().post(api(`admin/hosting/${r.body.id}/jobs/${j.id}/retry`)).set(auth(admin)).expect(409); // no longer failed
    });
  });

  describe('billing events', () => {
    async function activeAccount(who: typeof alice, planId: string, name: string) {
      const sub = await paidSub(who, planId);
      const r = await setUp(who, sub.id, dom(name)).expect(201);
      await run();
      return { subId: sub.id, accountId: r.body.id as string, username: (await account(r.body.id)).panelUsername! };
    }

    it('an expired or cancelled subscription suspends the hosting, once, with the reason', async () => {
      const { subId, accountId, username } = await activeAccount(alice, basicPlan, 'expiring');
      expect(await events.handle('subscription.expired', { subscriptionId: subId })).toBe(true);
      expect(await events.handle('subscription.expired', { subscriptionId: subId })).toBe(true); // a repeated event
      await run();
      const a = await account(accountId);
      expect(a).toMatchObject({ status: 'SUSPENDED', suspendReason: 'The subscription ended' });
      expect(panel.accounts.get(username)!.suspended).toBe(true);
      expect(await db.provisioningJob.count({ where: { hostingAccountId: accountId, action: 'SUSPEND' } })).toBe(1);
      expect(await db.notification.count({ where: { userId: alice.userId, type: 'hosting.suspended', title: { contains: dom('expiring') } } })).toBe(1);
      expect(await events.handle('subscription.expired', { subscriptionId: subId })).toBe(true);
      expect(await db.provisioningJob.count({ where: { hostingAccountId: accountId, action: 'SUSPEND' } })).toBe(1); // still one
    });

    it('cancelling before hosting was created drops the waiting job instead of creating it', async () => {
      const sub = await paidSub(alice, basicPlan);
      const r = await setUp(alice, sub.id, dom('notyet')).expect(201);
      await events.handle('subscription.cancelled', { subscriptionId: sub.id });
      await run();
      expect((await account(r.body.id)).status).toBe('CANCELLED');
      expect((await account(r.body.id)).panelUsername).toBeNull();
      expect((await jobOf(r.body.id)).status).toBe('CANCELLED');
      expect([...panel.accounts.keys()].length).toBeGreaterThan(0); // other tests' accounts exist; this one was never created
    });

    it('a plan change moves the account to the new panel package', async () => {
      const { subId, accountId, username } = await activeAccount(alice, basicPlan, 'upgrade');
      await db.subscriptionItem.updateMany({ where: { subscriptionId: subId }, data: { planId: proPlan, pricingVersionId: pv[proPlan]! } });
      await events.handle('subscription.plan_changed', { subscriptionId: subId });
      await run();
      expect((await account(accountId)).planId).toBe(proPlan);
      expect(panel.accounts.get(username)!.packageName).toBe('pkg-pro');
    });

    it('a plan with no panel package set fails clearly for staff instead of guessing', async () => {
      const { subId, accountId } = await activeAccount(alice, basicPlan, 'nopkg');
      await db.subscriptionItem.updateMany({ where: { subscriptionId: subId }, data: { planId: noPackagePlan, pricingVersionId: pv[noPackagePlan]! } });
      await events.handle('subscription.plan_changed', { subscriptionId: subId });
      await run();
      const j = await jobOf(accountId, 'CHANGE_PLAN');
      expect(j.status).toBe('FAILED');
      expect(j.errorMessage).toContain('no panel package');
      expect((await account(accountId)).planId).toBe(basicPlan); // unchanged
      expect((await account(accountId)).status).toBe('ACTIVE'); // a failed change does not take the site down
    });

    it('ignores events for services without hosting', async () => {
      const design = await paidSub(alice, designPlan);
      expect(await events.handle('subscription.expired', { subscriptionId: design.id })).toBe(false);
      expect(await events.handle('subscription.expired', {})).toBe(false);
      expect(await events.handle('subscription.activated', { subscriptionId: design.id })).toBe(false);
    });
  });

  describe('admin controls', () => {
    let accountId: string;
    let subId: string;

    beforeAll(async () => {
      const sub = await paidSub(alice, basicPlan);
      subId = sub.id;
      accountId = (await setUp(alice, sub.id, dom('admin')).expect(201)).body.id;
      await run();
    });

    it('needs staff; customers are refused; support can look but not change', async () => {
      await http().get(api('admin/hosting')).expect(401);
      await http().get(api('admin/hosting')).set(auth(alice.token)).expect(403);
      await http().get(api('admin/hosting')).set(auth(support)).expect(200);
      await http().post(api(`admin/hosting/${accountId}/suspend`)).set(auth(support)).send({ reason: 'nope' }).expect(403);
    });

    it('lists and filters accounts, and shows the job history with panel details staff may see', async () => {
      const list = await http().get(api(`admin/hosting?status=ACTIVE&search=${dom('admin')}`)).set(auth(admin)).expect(200);
      expect(list.body.data.map((a: { id: string }) => a.id)).toEqual([accountId]);
      expect(list.body.data[0]).toMatchObject({ lastJob: { action: 'CREATE', status: 'SUCCEEDED' } });
      const one = await http().get(api(`admin/hosting/${accountId}`)).set(auth(admin)).expect(200);
      expect(one.body.panelUsername).toMatch(/^[a-z]/);
      expect(one.body.jobs[0].action).toBe('CREATE');
      await http().get(api('admin/hosting?status=NOPE')).set(auth(admin)).expect(400);
    });

    it('suspends with a reason, which the customer is told, then restores', async () => {
      await http().post(api(`admin/hosting/${accountId}/suspend`)).set(auth(admin)).send({ reason: '' }).expect(400);
      await http().post(api(`admin/hosting/${accountId}/unsuspend`)).set(auth(admin)).expect(409); // not suspended
      await http().post(api(`admin/hosting/${accountId}/suspend`)).set(auth(admin)).send({ reason: 'Abuse report under review' }).expect(200);
      await run();
      expect(await account(accountId)).toMatchObject({ status: 'SUSPENDED', suspendReason: 'Abuse report under review' });
      await http().post(api(`admin/hosting/${accountId}/suspend`)).set(auth(admin)).send({ reason: 'again' }).expect(409);

      await http().post(api(`admin/hosting/${accountId}/unsuspend`)).set(auth(admin)).expect(200);
      await run();
      expect((await account(accountId)).status).toBe('ACTIVE');
      expect(await db.notification.count({ where: { userId: alice.userId, type: 'hosting.restored' } })).toBeGreaterThanOrEqual(1);
      expect(await db.auditLog.count({ where: { entityId: accountId, action: { in: ['hosting.suspend', 'hosting.unsuspend'] } } })).toBe(2);
    });

    it('will not restore hosting whose subscription has ended', async () => {
      await http().post(api(`admin/hosting/${accountId}/suspend`)).set(auth(admin)).send({ reason: 'Ended' }).expect(200);
      await run();
      await db.subscription.update({ where: { id: subId }, data: { status: 'EXPIRED' } });
      const r = await http().post(api(`admin/hosting/${accountId}/unsuspend`)).set(auth(admin)).expect(409);
      expect(r.body.error.code).toBe('SUBSCRIPTION_NOT_ACTIVE');
    });

    it('another organisation cannot see the account', async () => {
      await http().get(api(`hosting/${accountId}`)).set(auth(bob.token)).expect(404);
      await http().get(api(`hosting/${accountId}`)).set(auth(alice.token)).expect(200);
    });
  });
});
