import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { vi } from 'vitest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { DomainEventsHandler } from '../src/modules/domains/domain-events.handler.js';
import { RegistrarError } from '../src/modules/domains/providers/registrar-provider.js';
import { RegistrarAutomationService } from '../src/modules/domains/registrar-automation.service.js';
import { FakeGoDaddy } from './support/fake-godaddy.js';
import { cleanupUsers, createStaff, createTestApp, customer, platformDb, purgeTestStaffNotices, staffToken } from './utils.js';

// The app reads its settings when it is first imported, so these are set before any import runs.
const { PORT } = vi.hoisted(() => {
  const c = { PORT: 43919 };
  Object.assign(process.env, { REGISTRAR_PROVIDER: 'godaddy', GODADDY_API_KEY: 'gd-key', GODADDY_API_SECRET: 'gd-secret', GODADDY_API_BASE: `http://127.0.0.1:${c.PORT}`, GODADDY_MAX_YEARLY_COST: '50' });
  return c;
});

/** Paid domain orders placed automatically at GoDaddy (a pretend one): registration, renewal, transfer, failures and retries. */
describe('Domain registrar: GoDaddy (e2e)', () => {
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  let events: DomainEventsHandler;
  let automation: RegistrarAutomationService;
  const gd = new FakeGoDaddy();
  const tag = randomUUID().slice(0, 6).toLowerCase();
  const tld = `g${tag}x`;
  const emails: string[] = [];
  let alice: Awaited<ReturnType<typeof customer>>;
  let nophone: Awaited<ReturnType<typeof customer>>;
  let admin: string;
  let reader: string;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = (p: string) => `/api/v1/${p}`;
  const address = { line1: '7 Hill Road', city: 'Pune', stateCode: '27', postalCode: '411001' };
  const name = (label: string) => `${label}${tag}.${tld}`;
  const row = (domain: string) => db.domain.findFirstOrThrow({ where: { name: domain } });
  const tasks = (domain: string) => db.notification.findMany({ where: { type: 'domain.task', title: { contains: domain } } });

  /** Orders and pays for a domain, returning its id. The paid event is handled by the test, as the worker would. */
  async function bought(who: typeof alice, domain: string, years = 1) {
    const o = await http().post(api('domains/orders')).set(auth(who.token)).send({ domain, years }).expect(201);
    await http().post(api(`invoices/${o.body.invoice.id}/pay`)).set(auth(who.token)).send({}).expect(200);
    return o.body.domain.id as string;
  }
  const registered = (domainId: string, final = false) => events.handle('domain.registration_requested', { domainId }, { final });

  beforeAll(async () => {
    await gd.start(PORT);
    app = await createTestApp();
    db = platformDb();
    events = app.get(DomainEventsHandler);
    automation = app.get(RegistrarAutomationService);
    alice = await customer(app, db, 'gd-a');
    nophone = await customer(app, db, 'gd-b');
    const sa = await createStaff(db, 'SUPER_ADMIN', 'gdsa');
    const agent = await createStaff(db, 'SUPPORT_AGENT', 'gdagent');
    emails.push(alice.email, nophone.email, sa.email, agent.email);
    [admin, reader] = await Promise.all([staffToken(app, db, sa), staffToken(app, db, agent)]);
    for (const who of [alice, nophone]) await http().post(api('organisation/addresses')).set(auth(who.token)).send(address).expect(201);
    await http().patch(api('organisation')).set(auth(alice.token)).send({ phone: '+91 98765 43210', companyName: 'Alice Traders' }).expect(200);
    await db.tldPrice.create({ data: { tld, registerPrice: '800.00', renewPrice: '1000.00', transferPrice: '700.00' } });
  });

  beforeEach(() => gd.reset());

  afterAll(async () => {
    const tenantIds = [alice?.tenantId, nophone?.tenantId].filter(Boolean) as string[];
    await purgeTestStaffNotices(db);
    await db.notification.deleteMany({ where: { type: 'domain.task', title: { contains: tag } } });
    await db.domainRenewal.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.domainTransfer.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.domain.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.payment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.invoice.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.outboxEvent.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.tldPrice.deleteMany({ where: { tld } });
    await cleanupUsers(db, emails);
    await app.close();
    await gd.stop();
  });

  it('says GoDaddy is connected and places orders itself', async () => {
    expect((await http().get(api('admin/domains/registrar')).set(auth(reader)).expect(200)).body).toEqual({ provider: 'GODADDY', automated: true });
  });

  it('searches at GoDaddy', async () => {
    gd.taken.add(name('busy'));
    const r = await http().get(api('public/domains/search')).query({ q: name('busy') }).expect(200);
    expect(r.body.results.find((x: { domain: string }) => x.domain === name('busy')).status).toBe('TAKEN');
    expect(gd.called('POST', '/v1/domains/available')[0]!.body).toContain(name('busy'));
  });

  it('registers a paid order at GoDaddy, with the customer as registrant, and tells the customer', async () => {
    const id = await bought(alice, name('first'), 2);
    expect(await registered(id)).toBe(true);
    const d = await row(name('first'));
    expect(d.status).toBe('ACTIVE');
    expect(d.registrarRef).toMatch(/^\d+$/);
    expect(d.expiresAt!.getUTCFullYear()).toBe(new Date().getUTCFullYear() + 2);
    const [buy] = gd.called('POST', '/v1/domains/purchase');
    expect(buy!.body).toMatchObject({
      domain: name('first'), period: 2, renewAuto: false,
      consent: { agreementKeys: ['DNRA'], agreedBy: expect.stringMatching(/^(127\.0\.0\.1|::1)$/) },
      contactRegistrant: { organization: 'Alice Traders', phone: '+91.9876543210', addressMailing: { address1: '7 Hill Road', city: 'Pune', state: 'Maharashtra', postalCode: '411001', country: 'IN' } },
    });
    expect(await db.notification.count({ where: { tenantId: alice.tenantId, type: 'domain.registered' } })).toBe(1);
    expect(await tasks(name('first'))).toHaveLength(0); // nothing for staff to do
    const log = await db.auditLog.findFirstOrThrow({ where: { action: 'domain.registered', entityId: id } });
    expect(log.actorId).toBeNull(); // done by the system

    // The worker delivering the event again buys nothing more.
    await registered(id);
    expect(gd.called('POST', '/v1/domains/purchase')).toHaveLength(1);
  });

  it('records a name the account already holds instead of buying it again', async () => {
    const id = await bought(alice, name('held'));
    gd.owned.set(name('held'), { domainId: 4242, status: 'ACTIVE', expires: new Date(Date.now() + 360 * 86_400_000) });
    await registered(id);
    expect(gd.called('POST', '/v1/domains/purchase')).toHaveLength(0);
    expect(await row(name('held'))).toMatchObject({ status: 'ACTIVE', registrarRef: '4242' });
  });

  it('tries a busy GoDaddy again later, and hands it to staff once the tries run out', async () => {
    const id = await bought(alice, name('busy2'));
    gd.fail('purchase', 503, 2);
    await expect(registered(id, false)).rejects.toBeInstanceOf(RegistrarError); // the worker will try again
    expect((await row(name('busy2'))).status).toBe('PENDING_REGISTRATION');
    expect(await tasks(name('busy2'))).toHaveLength(0);

    await registered(id, true); // the last try
    const d = await row(name('busy2'));
    expect(d.status).toBe('PENDING_REGISTRATION');
    expect(d.failureReason).toContain('automatic tries have run out');
    const [task] = await tasks(name('busy2'));
    expect(task!.body).toContain('The registrar could not register it');

    // Staff try again once GoDaddy is back.
    const r = await http().post(api(`admin/domains/${id}/registrar-retry`)).set(auth(admin)).send({}).expect(200);
    expect(r.body.outcome).toEqual({ result: 'done' });
    expect(r.body.domain).toMatchObject({ status: 'ACTIVE', failureReason: null });
  });

  it('hands a problem a person must fix to staff at once, and a retry works once it is fixed', async () => {
    const id = await bought(nophone, name('nophone'));
    expect(await registered(id, false)).toBe(true); // not thrown: trying again would not help
    const d = await row(name('nophone'));
    expect(d.status).toBe('PENDING_REGISTRATION');
    expect(d.failureReason).toContain('phone number');
    expect((await tasks(name('nophone')))[0]!.body).toContain('phone number');
    expect(gd.called('POST', '/v1/domains/purchase')).toHaveLength(0);

    // Only staff who can manage domains may retry.
    await http().post(api(`admin/domains/${id}/registrar-retry`)).set(auth(reader)).send({}).expect(403);
    const still = await http().post(api(`admin/domains/${id}/registrar-retry`)).set(auth(admin)).send({}).expect(200);
    expect(still.body.outcome).toMatchObject({ result: 'manual', reason: expect.stringContaining('phone number') });

    await http().patch(api('organisation')).set(auth(nophone.token)).send({ phone: '98765 01234' }).expect(200);
    const ok = await http().post(api(`admin/domains/${id}/registrar-retry`)).set(auth(admin)).send({}).expect(200);
    expect(ok.body.outcome).toEqual({ result: 'done' });
    expect(gd.called('POST', '/v1/domains/purchase')[0]!.body.contactRegistrant.phone).toBe('+91.9876501234');
    expect((await http().post(api(`admin/domains/${id}/registrar-retry`)).set(auth(admin)).send({}).expect(409)).body.error.code).toBe('NOTHING_WAITING');
  });

  it('does not buy a premium name, and tells staff why', async () => {
    gd.prices.set(name('gold'), 900_000_000);
    const id = await bought(alice, name('gold'));
    await registered(id);
    expect(gd.called('POST', '/v1/domains/purchase')).toHaveLength(0);
    expect((await row(name('gold'))).failureReason).toContain('premium');
    expect((await tasks(name('gold')))[0]!.body).toContain('900.00 USD a year');
  });

  it('renews a paid renewal at GoDaddy, and never renews twice', async () => {
    const id = (await row(name('first'))).id;
    const before = (await row(name('first'))).expiresAt!;
    const renew = async () => {
      const o = await http().post(api(`domains/${id}/renew`)).set(auth(alice.token)).send({ years: 1 }).expect(201);
      await http().post(api(`invoices/${o.body.invoice.id}/pay`)).set(auth(alice.token)).send({}).expect(200);
      return (await db.domainRenewal.findFirstOrThrow({ where: { domainId: id, status: 'PENDING' } })).id;
    };
    const renewalId = await renew();
    await events.handle('domain.renewal_requested', { renewalId }, { final: false });
    expect(gd.called('POST', `/v1/domains/${name('first')}/renew`)).toHaveLength(1);
    const after = (await row(name('first'))).expiresAt!;
    expect(after.getUTCFullYear()).toBe(before.getUTCFullYear() + 1);
    expect((await db.domainRenewal.findUniqueOrThrow({ where: { id: renewalId } })).status).toBe('DONE');
    expect(await db.notification.count({ where: { tenantId: alice.tenantId, type: 'domain.renewed' } })).toBe(1);

    // Renewed at GoDaddy, but the result was never recorded here (say the worker stopped): the next try records it without paying.
    const second = await renew();
    const held = gd.owned.get(name('first'))!;
    held.expires = new Date(held.expires);
    held.expires.setUTCFullYear(held.expires.getUTCFullYear() + 1);
    gd.calls = [];
    await events.handle('domain.renewal_requested', { renewalId: second }, { final: false });
    expect(gd.called('POST', `/v1/domains/${name('first')}/renew`)).toHaveLength(0);
    expect((await db.domainRenewal.findUniqueOrThrow({ where: { id: second } })).status).toBe('DONE');
    expect((await row(name('first'))).expiresAt!.toISOString()).toBe(held.expires.toISOString());
  });

  it('starts a paid transfer at GoDaddy, and finishes it when the domain arrives', async () => {
    gd.taken.add(name('move'));
    const o = await http().post(api('domains/transfers')).set(auth(alice.token)).send({ domain: name('move'), authCode: 'Ab3$kL9!zQ-77' }).expect(201);
    await http().post(api(`invoices/${o.body.invoice.id}/pay`)).set(auth(alice.token)).send({}).expect(200);
    const t = await db.domainTransfer.findFirstOrThrow({ where: { domain: { name: name('move') } } });
    gd.taken.delete(name('move')); // GoDaddy now takes it in

    await events.handle('domain.transfer_requested', { transferId: t.id }, { final: false });
    const [start] = gd.called('POST', `/v1/domains/${name('move')}/transfer`);
    expect(start!.body.authCode).toBe('Ab3$kL9!zQ-77');
    expect((await db.domainTransfer.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('IN_PROGRESS');
    expect(await db.notification.count({ where: { tenantId: alice.tenantId, type: 'domain.transfer_started' } })).toBe(1);

    expect(await automation.syncTransfers()).toBe(0); // still with the old registrar
    gd.finishTransfer(name('move'));
    expect(await automation.syncTransfers()).toBeGreaterThanOrEqual(1);
    const done = await db.domainTransfer.findUniqueOrThrow({ where: { id: t.id } });
    expect(done).toMatchObject({ status: 'COMPLETED', authCodeEnc: null });
    expect((await row(name('move'))).status).toBe('ACTIVE');
  });

  it('hands a transfer GoDaddy refuses to staff, with the reason', async () => {
    gd.taken.add(name('wrong'));
    const o = await http().post(api('domains/transfers')).set(auth(alice.token)).send({ domain: name('wrong'), authCode: 'WRONG-CODE' }).expect(201);
    await http().post(api(`invoices/${o.body.invoice.id}/pay`)).set(auth(alice.token)).send({}).expect(200);
    const t = await db.domainTransfer.findFirstOrThrow({ where: { domain: { name: name('wrong') } } });
    gd.taken.delete(name('wrong'));
    await events.handle('domain.transfer_requested', { transferId: t.id }, { final: false });
    const after = await db.domainTransfer.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.status).toBe('REQUESTED');
    expect(after.failureReason).toContain('authorization code is not valid');
    expect((await tasks(name('wrong')))[0]!.body).toContain('could not start the transfer');
  });

  it('releases a domain for transfer away at GoDaddy, and records it gone once it leaves', async () => {
    const d = await db.domain.create({ data: { tenantId: alice.tenantId, name: name('leave'), tld, status: 'ACTIVE', registeredAt: new Date(Date.now() - 400 * 86_400_000), expiresAt: new Date(Date.now() + 100 * 86_400_000) } });
    gd.owned.set(name('leave'), { domainId: 5150, status: 'ACTIVE', expires: d.expiresAt!, authCode: 'GD-Auth-777' });
    await http().post(api(`domains/${d.id}/transfer-out`)).set(auth(alice.token)).send({}).expect(201);
    const t = await db.domainTransferOut.findFirstOrThrow({ where: { domainId: d.id } });
    await events.handle('domain.transfer_out_requested', { transferOutId: t.id }, { final: false });
    expect(gd.called('PATCH', `/v1/domains/${name('leave')}`)[0]!.body).toEqual({ locked: false });
    expect(gd.owned.get(name('leave'))!.locked).toBe(false);
    expect((await db.domainTransferOut.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('RELEASED');
    expect((await http().get(api(`domains/${d.id}/transfer-out/code`)).set(auth(alice.token)).expect(200)).body).toEqual({ authCode: 'GD-Auth-777' });
    expect(await tasks(name('leave'))).toHaveLength(0);

    expect(await automation.syncTransfers()).toBe(0); // still here
    gd.transferAway(name('leave'));
    expect(await automation.syncTransfers()).toBeGreaterThanOrEqual(1);
    expect((await row(name('leave'))).status).toBe('TRANSFERRED_OUT');
    expect((await db.domainTransferOut.findUniqueOrThrow({ where: { id: t.id } }))).toMatchObject({ status: 'COMPLETED', authCodeEnc: null });
  });

  it('locks a domain again at GoDaddy when the transfer away is withdrawn', async () => {
    const d = await db.domain.create({ data: { tenantId: alice.tenantId, name: name('stay'), tld, status: 'ACTIVE', registeredAt: new Date(Date.now() - 400 * 86_400_000), expiresAt: new Date(Date.now() + 100 * 86_400_000) } });
    gd.owned.set(name('stay'), { domainId: 5151, status: 'ACTIVE', expires: d.expiresAt! });
    await http().post(api(`domains/${d.id}/transfer-out`)).set(auth(alice.token)).send({}).expect(201);
    const t = await db.domainTransferOut.findFirstOrThrow({ where: { domainId: d.id } });
    await events.handle('domain.transfer_out_requested', { transferOutId: t.id }, { final: false });
    await http().post(api(`domains/${d.id}/transfer-out/cancel`)).set(auth(alice.token)).send({}).expect(200);
    await events.handle('domain.transfer_out_cancelled', { transferOutId: t.id }, { final: false });
    expect(gd.owned.get(name('stay'))!.locked).toBe(true);
    expect((await row(name('stay'))).locked).toBe(true);
    expect(await tasks(name('stay'))).toHaveLength(0);
  });
});
