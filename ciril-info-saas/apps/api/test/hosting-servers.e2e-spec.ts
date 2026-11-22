import { randomUUID } from 'node:crypto';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { vi } from 'vitest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { HostingEventsHandler } from '../src/modules/hosting/hosting-events.handler.js';
import { HostingJobsService } from '../src/modules/hosting/hosting-jobs.service.js';
import { cleanupUsers, createStaff, createTestApp, customer, platformDb, purgeTestStaffNotices, staffToken } from './utils.js';
import { FakePlesk } from './support/fake-plesk.js';

vi.hoisted(() => {
  Object.assign(process.env, { HOSTING_PROVIDER: 'servers' });
});

const PLESK_A = 43941;
const WHM = 43943;

/** A tiny pretend WHM: version, accountsummary, createacct, suspendacct, with a fixed token. */
class MiniWhm {
  server!: Server;
  accounts = new Map<string, { domain: string; suspended: boolean }>();
  constructor(private readonly port: number, private readonly token: string) {}
  async start() {
    this.server = createServer((req, res) => void this.route(req, res));
    await new Promise<void>((r) => this.server.listen(this.port, '127.0.0.1', r));
  }
  stop() {
    this.server.closeAllConnections();
    this.server.close();
  }
  private async route(req: IncomingMessage, res: ServerResponse) {
    let raw = '';
    for await (const c of req) raw += c;
    const send = (body: unknown, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `whm root:${this.token}`) return send({ error: 'denied' }, 403);
    const form = Object.fromEntries(new URLSearchParams(raw));
    const fn = (req.url ?? '').replace('/json-api/', '');
    const ok = (data: object = {}) => send({ metadata: { result: 1, reason: 'OK' }, data });
    const user = form['user'] ?? form['username'] ?? '';
    if (fn === 'version') return ok({ version: '11.120.0.5' });
    if (fn === 'accountsummary') return ok({ acct: this.accounts.has(user) ? [{ user, domain: this.accounts.get(user)!.domain }] : [] });
    if (fn === 'createacct') { this.accounts.set(user, { domain: form['domain']!, suspended: false }); return ok(); }
    if (fn === 'suspendacct') { this.accounts.get(user)!.suspended = true; return ok(); }
    return send({ metadata: { result: 0, reason: `Unknown function ${fn}` } });
  }
}

/** Several hosting servers: the admin list, connection tests, and where new accounts are placed. */
describe('Hosting over several servers (e2e)', () => {
  const pleskA = new FakePlesk(PLESK_A, 'plesk-key-a');
  const whm = new MiniWhm(WHM, 'whm-token');
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  let jobs: HostingJobsService;
  let events: HostingEventsHandler;
  let alice: Awaited<ReturnType<typeof customer>>;
  let superAdmin: string;
  let platformAdmin: string;
  const tag = randomUUID().slice(0, 8);
  const emails: string[] = [];
  let anyPlan: string;
  let cpanelPlan: string;
  const pv: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = (p: string) => `/api/v1/${p}`;
  const dom = (n: string) => `${n}-${tag}.example.com`;
  const addServer = (body: object, token = superAdmin) => http().post(api('admin/hosting-servers')).set(auth(token)).send(body);
  async function placed(name: string, planId = anyPlan) {
    const sub = await db.subscription.create({
      data: {
        tenantId: alice.tenantId, status: 'ACTIVE', billingCycle: 'YEARLY', currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 365 * 86_400_000),
        items: { create: { tenantId: alice.tenantId, planId, pricingVersionId: pv[planId]!, description: 'Hosting', unitPrice: '1000', renewalPrice: '1000' } },
      },
    });
    const r = await http().post(api('hosting')).set(auth(alice.token)).send({ subscriptionId: sub.id, domain: dom(name) }).expect(201);
    await jobs.runDue(20);
    return { sub, account: await db.hostingAccount.findUniqueOrThrow({ where: { id: r.body.id }, include: { server: true } }) };
  }

  beforeAll(async () => {
    await Promise.all([pleskA.start(), whm.start()]);
    app = await createTestApp();
    db = platformDb();
    jobs = app.get(HostingJobsService);
    events = app.get(HostingEventsHandler);
    alice = await customer(app, db, `srv-${tag}`);
    const sa = await createStaff(db, 'SUPER_ADMIN', 'srvsa');
    const pa = await createStaff(db, 'PLATFORM_ADMIN', 'srvpa');
    emails.push(alice.email, sa.email, pa.email);
    [superAdmin, platformAdmin] = await Promise.all([staffToken(app, db, sa), staffToken(app, db, pa)]);
    const category = await db.productCategory.upsert({ where: { slug: 'hosting' }, update: {}, create: { slug: 'hosting', name: 'Hosting' } });
    const product = await db.product.create({ data: { categoryId: category.id, slug: `t-srv-${tag}`, name: `Srv ${tag}`, type: 'WEB_HOSTING', status: 'PUBLISHED' } });
    const mk = async (slug: string) => {
      const p = await db.plan.create({ data: { productId: product.id, slug: `${slug}-${tag}`, name: `Plan ${slug}`, status: 'PUBLISHED', isSample: true } });
      pv[p.id] = (await db.pricingVersion.create({ data: { planId: p.id, billingCycle: 'YEARLY', price: '1000', renewalPrice: '1000' } })).id;
      return p.id;
    };
    anyPlan = await mk('any');
    cpanelPlan = await mk('cp');
    // Staff set the panel package and server type from the plan editor.
    await http().patch(api(`admin/catalog/plans/${anyPlan}`)).set(auth(superAdmin)).send({ panelPackage: 'Basic' }).expect(204);
    await http().patch(api(`admin/catalog/plans/${cpanelPlan}`)).set(auth(superAdmin)).send({ panelPackage: 'pkg-basic', hostingPanel: 'CPANEL' }).expect(204);
  });

  afterAll(async () => {
    await db.provisioningJob.deleteMany({ where: { tenantId: alice.tenantId } });
    await db.hostingAccount.deleteMany({ where: { tenantId: alice.tenantId } });
    await db.subscription.deleteMany({ where: { tenantId: alice.tenantId } });
    await db.hostingServer.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await db.pricingVersion.deleteMany({ where: { planId: { in: [anyPlan, cpanelPlan] } } });
    await db.plan.deleteMany({ where: { id: { in: [anyPlan, cpanelPlan] } } });
    await db.product.deleteMany({ where: { slug: `t-srv-${tag}` } });
    await cleanupUsers(db, emails);
    await purgeTestStaffNotices(db);
    await app.close();
    pleskA.stop();
    whm.stop();
  });

  it('the plan editor saves the panel package and server type', async () => {
    expect(await db.plan.findUniqueOrThrow({ where: { id: cpanelPlan } })).toMatchObject({ panelPackage: 'pkg-basic', hostingPanel: 'CPANEL' });
    await http().patch(api(`admin/catalog/plans/${cpanelPlan}`)).set(auth(superAdmin)).send({ hostingPanel: 'DIRECTADMIN' }).expect(400);
  });

  it('a super admin adds servers (credentials never come back), others can only look, and Test connection checks each one', async () => {
    const plesk = { name: 'Plesk A', hostname: '127.0.0.1', ipAddress: '203.0.113.11', panel: 'PLESK', port: PLESK_A, tls: 'off', maxAccounts: 2, secret: 'plesk-key-a' };
    await addServer(plesk, platformAdmin).expect(403);
    const a = await addServer(plesk).expect(201);
    expect(a.body).toMatchObject({ credentialsSet: true, accounts: 0, status: 'ACTIVE' });
    expect(JSON.stringify(a.body)).not.toContain('plesk-key-a');
    expect((await db.hostingServer.findUniqueOrThrow({ where: { id: a.body.id } })).credentialsEnc).not.toContain('plesk-key-a');
    ids['a'] = a.body.id;
    ids['w'] = (await addServer({ name: 'WHM 1', hostname: 'localhost', ipAddress: '203.0.113.13', panel: 'CPANEL', port: WHM, tls: 'off', username: 'root', maxAccounts: 10, secret: 'whm-token' }).expect(201)).body.id;
    await addServer({ ...plesk, name: 'Dup' }).expect(409);

    const list = await http().get(api('admin/hosting-servers')).set(auth(platformAdmin)).expect(200);
    expect(list.body.inUse).toBe(true);
    expect(JSON.stringify(list.body)).not.toMatch(/plesk-key-a|whm-token|credentialsEnc/);

    expect((await http().post(api(`admin/hosting-servers/${ids['w']}/test`)).set(auth(platformAdmin)).expect(200)).body).toMatchObject({ ok: true, message: 'Connected: WHM 11.120.0.5' });
    // A wrong key is reported, and fixing it does not need the old one.
    await http().patch(api(`admin/hosting-servers/${ids['a']}`)).set(auth(superAdmin)).send({ secret: 'not-the-right-key' }).expect(200);
    expect((await http().post(api(`admin/hosting-servers/${ids['a']}/test`)).set(auth(superAdmin)).expect(200)).body).toMatchObject({ ok: false, message: expect.stringContaining('API key') });
    await http().patch(api(`admin/hosting-servers/${ids['a']}`)).set(auth(superAdmin)).send({ secret: 'plesk-key-a' }).expect(200);
  });

  it('new accounts go to the server with the most room, respect a plan’s server type and limits, and later actions go to their server', async () => {
    // A cPanel-only plan lands on the WHM server.
    const cp = await placed('cp', cpanelPlan);
    expect(cp.account).toMatchObject({ status: 'ACTIVE', serverId: ids['w'] });
    expect(whm.accounts.get(cp.account.panelUsername!)?.domain).toBe(dom('cp'));

    // "Any" plans go to the emptier server for its size: Plesk A (0 of 2) first, then the WHM (1 of 10), never past A's limit.
    const one = await placed('one');
    expect(one.account.serverId).toBe(ids['a']);
    expect(pleskA.subscriptions.get(dom('one'))).toMatchObject({ plan: 'Basic', ip: '203.0.113.11' });
    // Then by how full each is for its size: A is 1 of 2 (50%), so the WHM fills to 5 of 10 before A gets its second.
    const where = (serverId: string) => db.hostingAccount.count({ where: { tenantId: alice.tenantId, serverId, status: 'ACTIVE' } });
    for (const n of ['two', 'three', 'four', 'five']) expect((await placed(n)).account.serverId).toBe(ids['w']);
    expect((await placed('six')).account.serverId).toBe(ids['a']); // a tie at 50%: the one with fewer accounts
    expect(await where(ids['a']!)).toBe(2); // now full at its limit of 2
    expect((await placed('seven')).account.serverId).toBe(ids['w']); // a full server takes no more
    expect(await where(ids['w']!)).toBe(6);

    // Suspending goes to the server the account lives on.
    await events.handle('subscription.expired', { subscriptionId: one.sub.id });
    await jobs.runDue(20);
    expect(pleskA.subscriptions.get(dom('one'))!.active).toBe(false);
  });

  it('servers in maintenance are skipped; with no room left the job goes to staff with a clear reason', async () => {
    await db.hostingServer.updateMany({ where: { id: { in: Object.values(ids) } }, data: { status: 'MAINTENANCE' } });
    try {
      const r = await placed('none');
      const job = await db.provisioningJob.findFirstOrThrow({ where: { hostingAccountId: r.account.id } });
      expect(job.status).toBe('FAILED');
      expect(job.errorMessage).toContain('Admin > Hosting servers');
      expect(r.account.serverId).toBeNull();
    } finally {
      await db.hostingServer.updateMany({ where: { id: { in: Object.values(ids) } }, data: { status: 'ACTIVE' } });
    }
  });
});
