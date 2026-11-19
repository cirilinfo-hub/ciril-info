import { randomUUID } from 'node:crypto';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { vi } from 'vitest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { HostingEventsHandler } from '../src/modules/hosting/hosting-events.handler.js';
import { HostingJobsService } from '../src/modules/hosting/hosting-jobs.service.js';
import { panelUsername } from '../src/modules/hosting/hosting-rules.js';
import { cleanupUsers, createStaff, createTestApp, customer, platformDb, purgeTestStaffNotices, staffToken } from './utils.js';

// The app reads its settings when it is first imported, so these are set before any import runs.
const { PORT, TOKEN } = vi.hoisted(() => {
  const c = { PORT: 43918, TOKEN: 'integration-whm-token' };
  Object.assign(process.env, { HOSTING_PROVIDER: 'cpanel', CPANEL_HOST: '127.0.0.1', CPANEL_PORT: String(c.PORT), CPANEL_USER: 'root', CPANEL_API_TOKEN: c.TOKEN, CPANEL_TLS: 'off' });
  return c;
});

interface Call { fn: string; form: Record<string, string> }

/** A pretend WHM: it checks the token, keeps accounts, records calls, and can be made busy or strict about packages. */
class FakeWhm {
  server!: Server;
  calls: Call[] = [];
  accounts = new Map<string, { domain: string; suspended: boolean; pkg: string }>();
  packages = new Set(['pkg-basic', 'pkg-pro']);
  busy = 0;
  rejectToken = false;

  async start() {
    this.server = createServer((req, res) => void this.route(req, res));
    await new Promise<void>((r) => this.server.listen(PORT, '127.0.0.1', r));
  }
  stop() {
    this.server.closeAllConnections();
    this.server.close();
  }
  reset() {
    this.calls = [];
    this.busy = 0;
    this.rejectToken = false;
  }
  called(fn: string) {
    return this.calls.filter((c) => c.fn === fn);
  }

  private async route(req: IncomingMessage, res: ServerResponse) {
    let raw = '';
    for await (const c of req) raw += c;
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (this.rejectToken || req.headers.authorization !== `whm root:${TOKEN}`) return send(403, { error: 'Access denied' });
    const form = Object.fromEntries(new URLSearchParams(raw));
    const fn = (req.url ?? '').replace('/json-api/', '');
    this.calls.push({ fn, form });
    const ok = (data: object = {}) => send(200, { metadata: { result: 1, reason: 'OK' }, data });
    const fail = (reason: string) => send(200, { metadata: { result: 0, reason } });
    const user = form['user'] ?? form['username'] ?? '';
    const acct = this.accounts.get(user);
    if (fn === 'accountsummary') return ok({ acct: acct ? [{ user, domain: acct.domain }] : [] });
    if (fn === 'createacct') {
      if (this.busy > 0) {
        this.busy--;
        return fail('The server is busy, please try again.');
      }
      if (!this.packages.has(form['plan']!)) return fail(`The package "${form['plan']}" does not exist.`);
      this.accounts.set(user, { domain: form['domain']!, suspended: false, pkg: form['plan']! });
      return ok();
    }
    if (!acct) return fail(`The account ${user} does not exist.`);
    if (fn === 'suspendacct') { acct.suspended = true; return ok(); }
    if (fn === 'unsuspendacct') { acct.suspended = false; return ok(); }
    if (fn === 'changepackage') { acct.pkg = form['pkg']!; return ok(); }
    if (fn === 'removeacct') { this.accounts.delete(user); return ok(); }
    return fail(`Unknown function ${fn}`);
  }
}

/** Hosting through cPanel/WHM: the real adapter, the real job queue, and a pretend WHM. */
describe('Hosting through cPanel (e2e)', () => {
  const whm = new FakeWhm();
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
  const jobOf = (accountId: string, action = 'CREATE') => db.provisioningJob.findFirstOrThrow({ where: { hostingAccountId: accountId, action: action as 'CREATE' }, orderBy: { queuedAt: 'desc' } });

  async function paidSub(planId: string) {
    return db.subscription.create({
      data: {
        tenantId: alice.tenantId, status: 'ACTIVE', billingCycle: 'YEARLY', currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 365 * 86_400_000),
        items: { create: { tenantId: alice.tenantId, planId, pricingVersionId: pv[planId]!, description: 'Hosting', unitPrice: '1000', renewalPrice: '1000' } },
      },
    });
  }
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
    await whm.start();
    app = await createTestApp();
    db = platformDb();
    jobs = app.get(HostingJobsService);
    events = app.get(HostingEventsHandler);
    alice = await customer(app, db, 'cp-a');
    const a = await createStaff(db, 'PLATFORM_ADMIN', 'cpadm');
    emails.push(alice.email, a.email);
    admin = await staffToken(app, db, a);
    const category = await db.productCategory.upsert({ where: { slug: 'hosting' }, update: {}, create: { slug: 'hosting', name: 'Hosting' } });
    const product = await db.product.create({ data: { categoryId: category.id, slug: `t-cp-${tag}`, name: `Cp ${tag}`, type: 'WEB_HOSTING', status: 'PUBLISHED' } });
    const mk = async (slug: string, panelPackage: string) => {
      const p = await db.plan.create({ data: { productId: product.id, slug: `${slug}-${tag}`, name: `Plan ${slug}`, status: 'PUBLISHED', isSample: true, panelPackage } });
      pv[p.id] = (await db.pricingVersion.create({ data: { planId: p.id, billingCycle: 'YEARLY', price: '1000', renewalPrice: '1000' } })).id;
      return p.id;
    };
    basicPlan = await mk('basic', 'pkg-basic');
    proPlan = await mk('pro', 'pkg-pro');
  });

  beforeEach(() => whm.reset());

  afterAll(async () => {
    const tenantIds = [alice?.tenantId].filter(Boolean) as string[];
    await db.provisioningJob.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.hostingAccount.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.subscription.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.outboxEvent.deleteMany({ where: { tenantId: { in: tenantIds }, type: 'email.send' } });
    await db.notification.deleteMany({ where: { type: { in: ['hosting.failed'] }, body: { contains: tag } } });
    await db.pricingVersion.deleteMany({ where: { planId: { in: [basicPlan, proPlan] } } });
    await db.plan.deleteMany({ where: { id: { in: [basicPlan, proPlan] } } });
    await db.product.deleteMany({ where: { slug: `t-cp-${tag}` } });
    await cleanupUsers(db, emails);
    await purgeTestStaffNotices(db);
    await app.close();
    whm.stop();
  });

  it('creates the account on WHM with the plan’s package and the customer’s email, and the site goes Active', async () => {
    const sub = await paidSub(basicPlan);
    const r = await setUp(sub.id, dom('create')).expect(201);
    await run();
    const a = await account(r.body.id);
    expect(a.status).toBe('ACTIVE');
    expect(a.panelUsername).toBe(panelUsername(dom('create'), r.body.id));
    expect((await jobOf(r.body.id)).status).toBe('SUCCEEDED');

    const create = whm.called('createacct')[0]!;
    expect(create.form).toMatchObject({ username: a.panelUsername, domain: dom('create'), plan: 'pkg-basic', sendemail: '1' });
    const billing = await db.customerAccount.findUniqueOrThrow({ where: { tenantId: alice.tenantId } });
    expect(create.form['contactemail']).toBe(billing.billingEmail);
    expect(create.form['password']!.length).toBeGreaterThanOrEqual(20);
    expect(JSON.stringify(await db.provisioningJob.findMany({ where: { hostingAccountId: r.body.id } }))).not.toContain(create.form['password']!); // never stored
    expect(whm.accounts.get(a.panelUsername!)).toMatchObject({ domain: dom('create'), pkg: 'pkg-basic' });
  });

  it('a busy WHM is retried later and then succeeds, without creating twice', async () => {
    whm.busy = 1;
    const sub = await paidSub(basicPlan);
    const r = await setUp(sub.id, dom('busy')).expect(201);
    await run();
    const j = await jobOf(r.body.id);
    expect(j).toMatchObject({ status: 'QUEUED', attempts: 1 });
    expect(j.errorMessage).toContain('busy');
    await makeDue();
    await run();
    expect((await jobOf(r.body.id)).status).toBe('SUCCEEDED');
    expect((await account(r.body.id)).status).toBe('ACTIVE');
    expect([...whm.accounts.values()].filter((x) => x.domain === dom('busy'))).toHaveLength(1);
  });

  it('a create that already worked (the reply was lost) is recognised and not repeated', async () => {
    const sub = await paidSub(basicPlan);
    const r = await setUp(sub.id, dom('lost')).expect(201);
    const username = panelUsername(dom('lost'), r.body.id);
    whm.accounts.set(username, { domain: dom('lost'), suspended: false, pkg: 'pkg-basic' }); // WHM made it, we never heard
    await run();
    expect((await account(r.body.id)).status).toBe('ACTIVE');
    expect(whm.called('createacct')).toHaveLength(0);
  });

  it('a refusal from WHM (unknown package) goes straight to staff with WHM’s words, and is not retried', async () => {
    whm.packages.delete('pkg-basic');
    try {
      const sub = await paidSub(basicPlan);
      const r = await setUp(sub.id, dom('badpkg')).expect(201);
      await run();
      const j = await jobOf(r.body.id);
      expect(j).toMatchObject({ status: 'FAILED', attempts: 1 });
      expect(j.errorMessage).toContain('does not exist');
      expect((await account(r.body.id)).status).toBe('FAILED');
      const detail = await http().get(api(`admin/hosting/${r.body.id}`)).set(auth(admin)).expect(200);
      expect(detail.body.jobs[0].errorMessage).toContain('does not exist');
      // The admin fixes the package on the panel and retries.
      whm.packages.add('pkg-basic');
      await http().post(api(`admin/hosting/${r.body.id}/jobs/${j.id}/retry`)).set(auth(admin)).expect(200);
      await run();
      expect((await account(r.body.id)).status).toBe('ACTIVE');
    } finally {
      whm.packages.add('pkg-basic');
    }
  });

  it('a refused API token fails clearly for staff instead of retrying forever', async () => {
    whm.rejectToken = true;
    const sub = await paidSub(basicPlan);
    const r = await setUp(sub.id, dom('token')).expect(201);
    await run();
    const j = await jobOf(r.body.id);
    expect(j).toMatchObject({ status: 'FAILED', attempts: 1 });
    expect(j.errorMessage).toContain('API token');
  });

  it('an ended subscription suspends the account on WHM, and an admin can restore it', async () => {
    const { subId, accountId, username } = await live('suspend');
    await events.handle('subscription.expired', { subscriptionId: subId });
    await run();
    expect((await account(accountId)).status).toBe('SUSPENDED');
    expect(whm.accounts.get(username)!.suspended).toBe(true);
    expect(whm.called('suspendacct')[0]!.form).toMatchObject({ user: username, reason: 'The subscription ended' });

    await http().post(api(`admin/hosting/${accountId}/unsuspend`)).set(auth(admin)).expect(200);
    await run();
    expect((await account(accountId)).status).toBe('ACTIVE');
    expect(whm.accounts.get(username)!.suspended).toBe(false);
  });

  it('a plan change moves the account to the new package on WHM', async () => {
    const { subId, accountId, username } = await live('upgrade');
    await db.subscriptionItem.updateMany({ where: { subscriptionId: subId }, data: { planId: proPlan, pricingVersionId: pv[proPlan]! } });
    await events.handle('subscription.plan_changed', { subscriptionId: subId });
    await run();
    expect((await account(accountId)).planId).toBe(proPlan);
    expect(whm.accounts.get(username)!.pkg).toBe('pkg-pro');
  });
});
