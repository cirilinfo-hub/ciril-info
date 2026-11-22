import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { vi } from 'vitest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { HostingEventsHandler } from '../src/modules/hosting/hosting-events.handler.js';
import { HostingJobsService } from '../src/modules/hosting/hosting-jobs.service.js';
import { cleanupUsers, createStaff, createTestApp, customer, platformDb, purgeTestStaffNotices, staffToken } from './utils.js';

// Manual mode: no panel is called. The app reads its settings when it is first imported, so this is set before any import runs.
vi.hoisted(() => {
  process.env['HOSTING_PROVIDER'] = 'manual';
});

/** Manual hosting: every job becomes a task for staff, who do it by hand and mark it done. */
describe('Manual hosting (e2e)', () => {
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  let jobs: HostingJobsService;
  let events: HostingEventsHandler;
  let alice: Awaited<ReturnType<typeof customer>>;
  let admin: string;
  let adminId: string;
  let support: string;
  const tag = randomUUID().slice(0, 8);
  const emails: string[] = [];
  let basicPlan: string;
  let proPlan: string;
  const pv: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = (p: string) => `/api/v1/${p}`;
  const dom = (n: string) => `${n}-${tag}.example.com`;
  const run = () => jobs.runDue(20);
  const account = (id: string) => db.hostingAccount.findUniqueOrThrow({ where: { id } });
  const jobOf = (accountId: string, action = 'CREATE') => db.provisioningJob.findFirstOrThrow({ where: { hostingAccountId: accountId, action: action as 'CREATE' }, orderBy: { queuedAt: 'desc' } });
  const complete = (accountId: string, jobId: string, body: object = {}, token = admin) => http().post(api(`admin/hosting/${accountId}/jobs/${jobId}/complete`)).set(auth(token)).send(body);

  async function paidSub(planId: string) {
    return db.subscription.create({
      data: {
        tenantId: alice.tenantId, status: 'ACTIVE', billingCycle: 'YEARLY', currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 365 * 86_400_000),
        items: { create: { tenantId: alice.tenantId, planId, pricingVersionId: pv[planId]!, description: 'Hosting', unitPrice: '1000', renewalPrice: '1000' } },
      },
    });
  }
  /** Set up hosting and have a person finish it: an ACTIVE account. */
  async function liveAccount(name: string, username: string) {
    const sub = await paidSub(basicPlan);
    const r = await http().post(api('hosting')).set(auth(alice.token)).send({ subscriptionId: sub.id, domain: dom(name) }).expect(201);
    await run();
    await complete(r.body.id, (await jobOf(r.body.id)).id, { panelUsername: username }).expect(200);
    return { subId: sub.id, accountId: r.body.id as string };
  }

  beforeAll(async () => {
    app = await createTestApp();
    db = platformDb();
    jobs = app.get(HostingJobsService);
    events = app.get(HostingEventsHandler);
    alice = await customer(app, db, 'man-a');
    const a = await createStaff(db, 'PLATFORM_ADMIN', 'manadm');
    const s = await createStaff(db, 'SUPPORT_AGENT', 'mansup');
    adminId = a.id;
    emails.push(alice.email, a.email, s.email);
    [admin, support] = await Promise.all([staffToken(app, db, a), staffToken(app, db, s)]);

    const category = await db.productCategory.upsert({ where: { slug: 'hosting' }, update: {}, create: { slug: 'hosting', name: 'Hosting' } });
    const product = await db.product.create({ data: { categoryId: category.id, slug: `t-mhost-${tag}`, name: `Manual ${tag}`, type: 'WEB_HOSTING', status: 'PUBLISHED' } });
    const mk = async (slug: string, panelPackage: string) => {
      const p = await db.plan.create({ data: { productId: product.id, slug: `${slug}-${tag}`, name: `Plan ${slug}`, status: 'PUBLISHED', isSample: true, panelPackage } });
      pv[p.id] = (await db.pricingVersion.create({ data: { planId: p.id, billingCycle: 'YEARLY', price: '1000', renewalPrice: '1000' } })).id;
      return p.id;
    };
    basicPlan = await mk('basic', 'pkg-basic');
    proPlan = await mk('pro', 'pkg-pro');
  });

  afterAll(async () => {
    await db.provisioningJob.deleteMany({ where: { tenantId: alice.tenantId } });
    await db.hostingAccount.deleteMany({ where: { tenantId: alice.tenantId } });
    await db.subscription.deleteMany({ where: { tenantId: alice.tenantId } });
    await db.outboxEvent.deleteMany({ where: { tenantId: alice.tenantId, type: 'email.send' } });
    await db.notification.deleteMany({ where: { type: { in: ['hosting.task', 'hosting.failed'] }, OR: [{ title: { contains: tag } }, { body: { contains: tag } }] } });
    await db.pricingVersion.deleteMany({ where: { planId: { in: [basicPlan, proPlan] } } });
    await db.plan.deleteMany({ where: { id: { in: [basicPlan, proPlan] } } });
    await db.product.deleteMany({ where: { slug: `t-mhost-${tag}` } });
    await cleanupUsers(db, emails);
    await purgeTestStaffNotices(db);
    await app.close();
  });

  it('a set-up waits for staff instead of calling a panel, and the customer sees "Setting up"', async () => {
    const sub = await paidSub(basicPlan);
    const r = await http().post(api('hosting')).set(auth(alice.token)).send({ subscriptionId: sub.id, domain: dom('first') }).expect(201);
    await run();
    expect(await jobOf(r.body.id)).toMatchObject({ status: 'AWAITING_STAFF', attempts: 1 });
    expect((await account(r.body.id)).status).toBe('PROVISIONING');
    expect(await run()).toBe(0); // it is not picked up again

    const list = await http().get(api('hosting')).set(auth(alice.token)).expect(200);
    expect(list.body.manualSetup).toBe(true);
    expect(list.body.accounts.find((a: { id: string }) => a.id === r.body.id).status).toBe('PROVISIONING');

    // Staff with hosting:write are told, with what to do and which plan package to use.
    const n = await db.notification.findFirst({ where: { userId: adminId, type: 'hosting.task', title: { contains: dom('first') } } });
    expect(n?.title).toContain('create the account for');
    expect(n?.body).toBe('Plan package: pkg-basic');
  });

  it('the admin list can show just the accounts that need a person', async () => {
    const sub = await paidSub(basicPlan);
    const r = await http().post(api('hosting')).set(auth(alice.token)).send({ subscriptionId: sub.id, domain: dom('needs') }).expect(201);
    await run();
    const needs = await http().get(api(`admin/hosting?needsAction=true&search=${dom('needs')}`)).set(auth(admin)).expect(200);
    expect(needs.body.data.map((a: { id: string }) => a.id)).toEqual([r.body.id]);
    expect(needs.body.data[0].lastJob).toMatchObject({ action: 'CREATE', status: 'AWAITING_STAFF' });
    const dash = await http().get(api('admin/dashboard')).set(auth(admin)).expect(200);
    expect(dash.body.hosting.waiting).toBeGreaterThanOrEqual(1);
  });

  describe('finishing a task', () => {
    let accountId: string;
    let jobId: string;

    beforeAll(async () => {
      const sub = await paidSub(basicPlan);
      accountId = (await http().post(api('hosting')).set(auth(alice.token)).send({ subscriptionId: sub.id, domain: dom('finish') }).expect(201)).body.id;
      await run();
      jobId = (await jobOf(accountId)).id;
    });

    it('needs the right role', async () => {
      await complete(accountId, jobId, { panelUsername: 'abc123' }, alice.token).expect(403);
      await complete(accountId, jobId, { panelUsername: 'abc123' }, support).expect(403); // hosting:read only
    });

    it('a new account needs the username that was created on the panel, in the panel’s format', async () => {
      for (const bad of [{}, { panelUsername: '' }, { panelUsername: '1abc' }, { panelUsername: 'has space' }, { panelUsername: 'UPPER-case!' }]) {
        const r = await complete(accountId, jobId, bad);
        expect([400]).toContain(r.status);
      }
      expect((await complete(accountId, jobId, { panelUsername: 'a'.repeat(17) }).expect(400)).body.error.code).toBeDefined();
      expect((await account(accountId)).status).toBe('PROVISIONING');
    });

    it('marking it done activates the account with that username, tells the customer and records who did it', async () => {
      const r = await complete(accountId, jobId, { panelUsername: 'Done123', note: 'Created in the WHM panel' }).expect(200);
      expect(r.body.status).toBe('ACTIVE');
      expect(r.body.panelUsername).toBe('done123'); // tidied to lower case
      expect(await jobOf(accountId)).toMatchObject({ status: 'SUCCEEDED' });
      expect((await jobOf(accountId)).result).toMatchObject({});
      expect(await db.notification.count({ where: { userId: alice.userId, type: 'hosting.ready', title: { contains: dom('finish') } } })).toBe(1);
      expect(await db.outboxEvent.count({ where: { tenantId: alice.tenantId, type: 'email.send', payload: { path: ['data', 'domain'], equals: dom('finish') } } })).toBe(1);
      expect(await db.auditLog.count({ where: { action: 'hosting.task_done', entityId: accountId, actorId: adminId } })).toBe(1);
      await complete(accountId, jobId, { panelUsername: 'again1' }).expect(409); // already done
    });
  });

  it('staff who cannot do a task say why: the account fails, the customer is reassured, and it can be retried', async () => {
    const sub = await paidSub(basicPlan);
    const r = await http().post(api('hosting')).set(auth(alice.token)).send({ subscriptionId: sub.id, domain: dom('cant') }).expect(201);
    await run();
    const job = await jobOf(r.body.id);
    await http().post(api(`admin/hosting/${r.body.id}/jobs/${job.id}/cannot-complete`)).set(auth(admin)).send({ reason: '' }).expect(400);
    await http().post(api(`admin/hosting/${r.body.id}/jobs/${job.id}/cannot-complete`)).set(auth(support)).send({ reason: 'no' }).expect(403);
    const res = await http().post(api(`admin/hosting/${r.body.id}/jobs/${job.id}/cannot-complete`)).set(auth(admin)).send({ reason: 'Domain is on a blocklist' }).expect(200);
    expect(res.body.status).toBe('FAILED');
    expect(await jobOf(r.body.id)).toMatchObject({ status: 'FAILED', errorMessage: 'Domain is on a blocklist' });
    const note = await db.notification.findFirst({ where: { userId: alice.userId, type: 'hosting.problem' }, orderBy: { createdAt: 'desc' } });
    expect(note?.body).toContain('Our team has been told');
    expect(note?.body).not.toContain('blocklist');

    // Retrying puts it back as a task for a person.
    await http().post(api(`admin/hosting/${r.body.id}/jobs/${job.id}/retry`)).set(auth(admin)).expect(200);
    await run();
    expect(await jobOf(r.body.id)).toMatchObject({ status: 'AWAITING_STAFF' });
    await complete(r.body.id, job.id, { panelUsername: 'retried1' }).expect(200);
    expect((await account(r.body.id)).status).toBe('ACTIVE');
  });

  describe('changes to a live account are tasks too', () => {
    it('expiry becomes a suspend task, not repeated by a repeated event, and completing it suspends the account', async () => {
      const { subId, accountId } = await liveAccount('expiring', 'expir1');
      await events.handle('subscription.expired', { subscriptionId: subId });
      await events.handle('subscription.expired', { subscriptionId: subId }); // delivered twice
      await run();
      expect(await db.provisioningJob.count({ where: { hostingAccountId: accountId, action: 'SUSPEND' } })).toBe(1);
      const job = await jobOf(accountId, 'SUSPEND');
      expect(job.status).toBe('AWAITING_STAFF');
      expect((await account(accountId)).status).toBe('ACTIVE'); // nothing happens until a person does it
      await complete(accountId, job.id).expect(200); // no username needed: the account already has one
      expect(await account(accountId)).toMatchObject({ status: 'SUSPENDED', suspendReason: 'The subscription ended' });
      expect(await db.notification.count({ where: { userId: alice.userId, type: 'hosting.suspended', title: { contains: dom('expiring') } } })).toBe(1);
    });

    it('a plan change becomes a task naming the new package, and completing it updates the plan', async () => {
      const { subId, accountId } = await liveAccount('upgrade', 'upgr1');
      await db.subscriptionItem.updateMany({ where: { subscriptionId: subId }, data: { planId: proPlan, pricingVersionId: pv[proPlan]! } });
      await events.handle('subscription.plan_changed', { subscriptionId: subId });
      await run();
      const job = await jobOf(accountId, 'CHANGE_PLAN');
      expect(job.status).toBe('AWAITING_STAFF');
      expect((await account(accountId)).planId).toBe(basicPlan);
      await complete(accountId, job.id, { note: 'Switched to pkg-pro' }).expect(200);
      expect((await account(accountId)).planId).toBe(proPlan);
    });

    it('a staff suspend and restore also go through tasks', async () => {
      const { accountId } = await liveAccount('byhand', 'hand1');
      await http().post(api(`admin/hosting/${accountId}/suspend`)).set(auth(admin)).send({ reason: 'Abuse report' }).expect(200);
      await run();
      await complete(accountId, (await jobOf(accountId, 'SUSPEND')).id).expect(200);
      expect(await account(accountId)).toMatchObject({ status: 'SUSPENDED', suspendReason: 'Abuse report' });
      await http().post(api(`admin/hosting/${accountId}/unsuspend`)).set(auth(admin)).expect(200);
      await run();
      await complete(accountId, (await jobOf(accountId, 'UNSUSPEND')).id).expect(200);
      expect((await account(accountId)).status).toBe('ACTIVE');
    });
  });
});
