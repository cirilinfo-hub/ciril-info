import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { vi } from 'vitest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { HostingEventsHandler } from '../src/modules/hosting/hosting-events.handler.js';
import { HostingJobsService } from '../src/modules/hosting/hosting-jobs.service.js';
import { panelUsername } from '../src/modules/hosting/hosting-rules.js';
import { cleanupUsers, createStaff, createTestApp, customer, platformDb, purgeTestStaffNotices, staffToken } from './utils.js';
import { FakePlesk } from './support/fake-plesk.js';

// The app reads its settings when it is first imported, so these are set before any import runs.
const { PORT, KEY } = vi.hoisted(() => {
  const c = { PORT: 43927, KEY: 'integration-plesk-key' };
  Object.assign(process.env, { HOSTING_PROVIDER: 'plesk', PLESK_HOST: '127.0.0.1', PLESK_PORT: String(c.PORT), PLESK_API_KEY: c.KEY, PLESK_TLS: 'off', PLESK_IP: '203.0.113.10' });
  return c;
});

/** Hosting through Plesk: the real adapter, the real job queue, and a pretend Plesk. */
describe('Hosting through Plesk (e2e)', () => {
  const plesk = new FakePlesk(PORT, KEY);
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  let jobs: HostingJobsService;
  let events: HostingEventsHandler;
  let alice: Awaited<ReturnType<typeof customer>>;
  let admin: string;
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
  const makeDue = () => db.provisioningJob.updateMany({ where: { status: 'QUEUED' }, data: { availableAt: new Date(Date.now() - 1000) } });
  const account = (id: string) => db.hostingAccount.findUniqueOrThrow({ where: { id } });
  const jobOf = (accountId: string) => db.provisioningJob.findFirstOrThrow({ where: { hostingAccountId: accountId, action: 'CREATE' }, orderBy: { queuedAt: 'desc' } });
  const paidSub = (planId: string) =>
    db.subscription.create({
      data: {
        tenantId: alice.tenantId, status: 'ACTIVE', billingCycle: 'YEARLY', currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 365 * 86_400_000),
        items: { create: { tenantId: alice.tenantId, planId, pricingVersionId: pv[planId]!, description: 'Hosting', unitPrice: '1000', renewalPrice: '1000' } },
      },
    });
  const setUp = (subscriptionId: string, domain: string) => http().post(api('hosting')).set(auth(alice.token)).send({ subscriptionId, domain });
  async function live(name: string) {
    const sub = await paidSub(basicPlan);
    const r = await setUp(sub.id, dom(name)).expect(201);
    await run();
    const a = await account(r.body.id);
    expect(a.status).toBe('ACTIVE');
    return { subId: sub.id, accountId: a.id, username: a.panelUsername! };
  }

  beforeAll(async () => {
    await plesk.start();
    app = await createTestApp();
    db = platformDb();
    jobs = app.get(HostingJobsService);
    events = app.get(HostingEventsHandler);
    alice = await customer(app, db, 'pl-a');
    const a = await createStaff(db, 'PLATFORM_ADMIN', 'pladm');
    emails.push(alice.email, a.email);
    admin = await staffToken(app, db, a);
    const category = await db.productCategory.upsert({ where: { slug: 'hosting' }, update: {}, create: { slug: 'hosting', name: 'Hosting' } });
    const product = await db.product.create({ data: { categoryId: category.id, slug: `t-pl-${tag}`, name: `Pl ${tag}`, type: 'WEB_HOSTING', status: 'PUBLISHED' } });
    const mk = async (slug: string, panelPackage: string) => {
      const p = await db.plan.create({ data: { productId: product.id, slug: `${slug}-${tag}`, name: `Plan ${slug}`, status: 'PUBLISHED', isSample: true, panelPackage } });
      pv[p.id] = (await db.pricingVersion.create({ data: { planId: p.id, billingCycle: 'YEARLY', price: '1000', renewalPrice: '1000' } })).id;
      return p.id;
    };
    basicPlan = await mk('basic', 'Basic');
    proPlan = await mk('pro', 'Pro');
  });

  beforeEach(() => plesk.reset());

  afterAll(async () => {
    const tenantIds = [alice?.tenantId].filter(Boolean) as string[];
    await db.provisioningJob.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.hostingAccount.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.subscription.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.outboxEvent.deleteMany({ where: { tenantId: { in: tenantIds }, type: 'email.send' } });
    await db.pricingVersion.deleteMany({ where: { planId: { in: [basicPlan, proPlan] } } });
    await db.plan.deleteMany({ where: { id: { in: [basicPlan, proPlan] } } });
    await db.product.deleteMany({ where: { slug: `t-pl-${tag}` } });
    await cleanupUsers(db, emails);
    await purgeTestStaffNotices(db);
    await app.close();
    plesk.stop();
  });

  it('creates a Plesk customer and its subscription on the plan’s service plan and the server IP, and the site goes Active', async () => {
    const sub = await paidSub(basicPlan);
    const r = await setUp(sub.id, dom('create')).expect(201);
    await run();
    const a = await account(r.body.id);
    expect(a.status).toBe('ACTIVE');
    expect(a.panelUsername).toBe(panelUsername(dom('create'), r.body.id));
    const billing = await db.customerAccount.findUniqueOrThrow({ where: { tenantId: alice.tenantId } });
    expect(plesk.customers.get(a.panelUsername!)).toEqual({ email: billing.billingEmail });
    expect(plesk.subscriptions.get(dom('create'))).toMatchObject({ owner: a.panelUsername, plan: 'Basic', ip: '203.0.113.10', login: a.panelUsername, active: true });
    const create = plesk.called('subscription', '--create')[0]!.params;
    const password = create[create.indexOf('-passwd') + 1]!;
    expect(password.length).toBeGreaterThanOrEqual(20);
    expect(JSON.stringify(await db.provisioningJob.findMany({ where: { hostingAccountId: r.body.id } }))).not.toContain(password); // never stored
  });

  it('a busy Plesk is retried later, and a create that already happened is not repeated', async () => {
    plesk.busy = 1;
    const sub = await paidSub(basicPlan);
    const r = await setUp(sub.id, dom('busy')).expect(201);
    await run();
    expect(await jobOf(r.body.id)).toMatchObject({ status: 'QUEUED', attempts: 1 });
    await makeDue();
    await run();
    expect((await account(r.body.id)).status).toBe('ACTIVE');

    // The subscription exists already for the same customer (an earlier reply was lost): recognised, nothing created twice.
    const sub2 = await paidSub(basicPlan);
    const r2 = await setUp(sub2.id, dom('lost')).expect(201);
    const username = panelUsername(dom('lost'), r2.body.id);
    plesk.customers.set(username, { email: 'x@example.test' });
    plesk.subscriptions.set(dom('lost'), { owner: username, plan: 'Basic', ip: '203.0.113.10', login: username, active: true });
    await run();
    expect((await account(r2.body.id)).status).toBe('ACTIVE');
    expect(plesk.called('subscription', '--create').filter((c) => c.params[1] === dom('lost'))).toHaveLength(0);
  });

  it('an unknown service plan goes straight to staff with Plesk’s words', async () => {
    const odd = await db.plan.create({ data: { productId: (await db.plan.findUniqueOrThrow({ where: { id: basicPlan } })).productId, slug: `odd-${tag}`, name: 'Plan odd', status: 'PUBLISHED', isSample: true, panelPackage: 'Nope' } });
    pv[odd.id] = (await db.pricingVersion.create({ data: { planId: odd.id, billingCycle: 'YEARLY', price: '1000', renewalPrice: '1000' } })).id;
    try {
      const sub = await paidSub(odd.id);
      const r = await setUp(sub.id, dom('odd')).expect(201);
      await run();
      const j = await jobOf(r.body.id);
      expect(j.status).toBe('FAILED');
      expect(j.errorMessage).toContain('Service plan "Nope" does not exist');
    } finally {
      await db.provisioningJob.deleteMany({ where: { tenantId: alice.tenantId } });
      await db.hostingAccount.deleteMany({ where: { planId: odd.id } });
      await db.subscriptionItem.deleteMany({ where: { planId: odd.id } });
      await db.pricingVersion.deleteMany({ where: { planId: odd.id } });
      await db.plan.delete({ where: { id: odd.id } });
    }
  });

  it('an ended subscription switches the webspace off, an admin turns it back on, and a plan change switches the service plan', async () => {
    const { subId, accountId } = await live('suspend');
    await events.handle('subscription.expired', { subscriptionId: subId });
    await run();
    expect((await account(accountId)).status).toBe('SUSPENDED');
    expect(plesk.subscriptions.get(dom('suspend'))!.active).toBe(false);
    await http().post(api(`admin/hosting/${accountId}/unsuspend`)).set(auth(admin)).expect(200);
    await run();
    expect((await account(accountId)).status).toBe('ACTIVE');
    expect(plesk.subscriptions.get(dom('suspend'))!.active).toBe(true);

    const up = await live('upgrade');
    await db.subscriptionItem.updateMany({ where: { subscriptionId: up.subId }, data: { planId: proPlan, pricingVersionId: pv[proPlan]! } });
    await events.handle('subscription.plan_changed', { subscriptionId: up.subId });
    await run();
    expect((await account(up.accountId)).planId).toBe(proPlan);
    expect(plesk.subscriptions.get(dom('upgrade'))!.plan).toBe('Pro');
  });
});
