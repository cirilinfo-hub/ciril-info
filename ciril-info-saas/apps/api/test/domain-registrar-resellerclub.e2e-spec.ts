import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { vi } from 'vitest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { DomainEventsHandler } from '../src/modules/domains/domain-events.handler.js';
import { RegistrarError } from '../src/modules/domains/providers/registrar-provider.js';
import { RegistrarAutomationService } from '../src/modules/domains/registrar-automation.service.js';
import { FakeResellerClub } from './support/fake-resellerclub.js';
import { cleanupUsers, createStaff, createTestApp, customer, platformDb, purgeTestStaffNotices, staffToken } from './utils.js';

// The app reads its settings when it is first imported, so these are set before any import runs.
const { PORT } = vi.hoisted(() => {
  const c = { PORT: 43919 };
  Object.assign(process.env, {
    REGISTRAR_PROVIDER: 'resellerclub', RESELLERCLUB_RESELLER_ID: 'rc-reseller', RESELLERCLUB_API_KEY: 'rc-key', RESELLERCLUB_CUSTOMER_ID: '31337',
    RESELLERCLUB_API_BASE: `http://127.0.0.1:${c.PORT}/api`, REGISTRAR_MAX_YEARLY_COST: '5000',
  });
  return c;
});

/** Paid domain orders placed automatically at ResellerClub (a pretend one): registration, renewal, transfer, failures, retries and purchase prices. */
describe('Domain registrar: ResellerClub (e2e)', () => {
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  let events: DomainEventsHandler;
  let automation: RegistrarAutomationService;
  const rc = new FakeResellerClub();
  const tag = randomUUID().slice(0, 6).toLowerCase();
  const tld = `r${tag}x`;
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
  const cheap = { addnewdomain: 650, renewdomain: 780, addtransferdomain: 640 };

  /** Orders and pays for a domain, returning its id. The paid event is handled by the test, as the worker would. */
  async function bought(who: typeof alice, domain: string, years = 1) {
    const o = await http().post(api('domains/orders')).set(auth(who.token)).send({ domain, years }).expect(201);
    await http().post(api(`invoices/${o.body.invoice.id}/pay`)).set(auth(who.token)).send({}).expect(200);
    return o.body.domain.id as string;
  }
  const registered = (domainId: string, final = false) => events.handle('domain.registration_requested', { domainId }, { final });
  const activeDomain = (label: string) =>
    db.domain.create({ data: { tenantId: alice.tenantId, name: name(label), tld, status: 'ACTIVE', registeredAt: new Date(Date.now() - 400 * 86_400_000), expiresAt: new Date(Date.now() + 100 * 86_400_000) } });

  beforeAll(async () => {
    await rc.start(PORT);
    rc.classKeys.set(tld, 'testkey');
    rc.costs.set('testkey', cheap);
    app = await createTestApp();
    db = platformDb();
    events = app.get(DomainEventsHandler);
    automation = app.get(RegistrarAutomationService);
    alice = await customer(app, db, 'rc-a');
    nophone = await customer(app, db, 'rc-b');
    const sa = await createStaff(db, 'SUPER_ADMIN', 'rcsa');
    const agent = await createStaff(db, 'SUPPORT_AGENT', 'rcagent');
    emails.push(alice.email, nophone.email, sa.email, agent.email);
    [admin, reader] = await Promise.all([staffToken(app, db, sa), staffToken(app, db, agent)]);
    for (const who of [alice, nophone]) await http().post(api('organisation/addresses')).set(auth(who.token)).send(address).expect(201);
    await http().patch(api('organisation')).set(auth(alice.token)).send({ phone: '+91 98765 43210', companyName: 'Alice Traders' }).expect(200);
    await db.tldPrice.create({ data: { tld, registerPrice: '800.00', renewPrice: '1000.00', transferPrice: '700.00' } });
  });

  beforeEach(() => rc.reset());

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
    await rc.stop();
  });

  it('says ResellerClub is connected, places orders itself and reads purchase prices', async () => {
    expect((await http().get(api('admin/domains/registrar')).set(auth(reader)).expect(200)).body).toEqual({ provider: 'RESELLERCLUB', automated: true, pricing: 'ResellerClub' });
  });

  it('searches at ResellerClub', async () => {
    rc.taken.add(name('busy'));
    const r = await http().get(api('public/domains/search')).query({ q: name('busy') }).expect(200);
    expect(r.body.results.find((x: { domain: string }) => x.domain === name('busy')).status).toBe('TAKEN');
    expect(rc.called('domains/available.json')[0]!.params).toMatchObject({ 'domain-name': expect.arrayContaining([`busy${tag}`]), tlds: [tld] });
  });

  it('registers a paid order at ResellerClub, with the customer as registrant, and tells the customer', async () => {
    const id = await bought(alice, name('first'), 2);
    expect(await registered(id)).toBe(true);
    const d = await row(name('first'));
    expect(d.status).toBe('ACTIVE');
    expect(d.registrarRef).toMatch(/^\d+$/);
    expect(d.expiresAt!.getUTCFullYear()).toBe(new Date().getUTCFullYear() + 2);
    const [buy] = rc.called('domains/register.json');
    expect(buy!.params).toMatchObject({ 'domain-name': [name('first')], years: ['2'], 'invoice-option': ['NoInvoice'], 'auto-renew': ['false'], 'customer-id': ['31337'] });
    expect(rc.called('contacts/add.json')[0]!.params).toMatchObject({
      company: ['Alice Traders'], 'phone-cc': ['91'], phone: ['9876543210'], 'address-line-1': ['7 Hill Road'], city: ['Pune'], state: ['Maharashtra'], zipcode: ['411001'], country: ['IN'],
    });
    expect(await db.notification.count({ where: { tenantId: alice.tenantId, type: 'domain.registered' } })).toBe(1);
    expect(await tasks(name('first'))).toHaveLength(0); // nothing for staff to do
    const log = await db.auditLog.findFirstOrThrow({ where: { action: 'domain.registered', entityId: id } });
    expect(log.actorId).toBeNull(); // done by the system

    // The worker delivering the event again buys nothing more.
    await registered(id);
    expect(rc.called('domains/register.json')).toHaveLength(1);
  });

  it('records a name the account already holds instead of buying it again', async () => {
    const id = await bought(alice, name('held'));
    const h = rc.hold(name('held'));
    await registered(id);
    expect(rc.called('domains/register.json')).toHaveLength(0);
    expect(await row(name('held'))).toMatchObject({ status: 'ACTIVE', registrarRef: String(h.orderid) });
  });

  it('tries a busy ResellerClub again later, and hands it to staff once the tries run out', async () => {
    const id = await bought(alice, name('busy2'));
    rc.fail('domains/register.json', 503, 'busy', 2);
    await expect(registered(id, false)).rejects.toBeInstanceOf(RegistrarError); // the worker will try again
    expect((await row(name('busy2'))).status).toBe('PENDING_REGISTRATION');
    expect(await tasks(name('busy2'))).toHaveLength(0);

    await registered(id, true); // the last try
    const d = await row(name('busy2'));
    expect(d.status).toBe('PENDING_REGISTRATION');
    expect(d.failureReason).toContain('automatic tries have run out');
    const [task] = await tasks(name('busy2'));
    expect(task!.body).toContain('The registrar could not register it');

    // Staff try again once ResellerClub is back.
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
    expect(rc.called('domains/register.json')).toHaveLength(0);

    // Only staff who can manage domains may retry.
    await http().post(api(`admin/domains/${id}/registrar-retry`)).set(auth(reader)).send({}).expect(403);
    const still = await http().post(api(`admin/domains/${id}/registrar-retry`)).set(auth(admin)).send({}).expect(200);
    expect(still.body.outcome).toMatchObject({ result: 'manual', reason: expect.stringContaining('phone number') });

    await http().patch(api('organisation')).set(auth(nophone.token)).send({ phone: '98765 01234' }).expect(200);
    const ok = await http().post(api(`admin/domains/${id}/registrar-retry`)).set(auth(admin)).send({}).expect(200);
    expect(ok.body.outcome).toEqual({ result: 'done' });
    expect(rc.called('contacts/add.json').at(-1)!.params.phone).toEqual(['9876501234']);
    expect((await http().post(api(`admin/domains/${id}/registrar-retry`)).set(auth(admin)).send({}).expect(409)).body.error.code).toBe('NOTHING_WAITING');
  });

  it('hands a refusal (no funds) to staff with the registrar’s reason', async () => {
    const id = await bought(alice, name('broke'));
    rc.fail('domains/register.json', 500, 'Insufficient funds in your reseller account');
    await registered(id);
    expect((await row(name('broke'))).failureReason).toContain('Insufficient funds');
    expect((await tasks(name('broke')))[0]!.body).toContain('Insufficient funds');
  });

  it('does not buy an ending dearer than the limit, and tells staff why', async () => {
    rc.costs.set('testkey', { ...cheap, addnewdomain: 9000 });
    const id = await bought(alice, name('gold'));
    await registered(id);
    rc.costs.set('testkey', cheap);
    expect(rc.called('domains/register.json')).toHaveLength(0);
    expect((await row(name('gold'))).failureReason).toContain('REGISTRAR_MAX_YEARLY_COST');
    expect((await tasks(name('gold')))[0]!.body).toContain('9000.00 a year');
  });

  it('renews a paid renewal at ResellerClub, and never renews twice', async () => {
    const id = (await row(name('first'))).id;
    const before = (await row(name('first'))).expiresAt!;
    const renew = async () => {
      const o = await http().post(api(`domains/${id}/renew`)).set(auth(alice.token)).send({ years: 1 }).expect(201);
      await http().post(api(`invoices/${o.body.invoice.id}/pay`)).set(auth(alice.token)).send({}).expect(200);
      return (await db.domainRenewal.findFirstOrThrow({ where: { domainId: id, status: 'PENDING' } })).id;
    };
    const renewalId = await renew();
    await events.handle('domain.renewal_requested', { renewalId }, { final: false });
    expect(rc.called('domains/renew.json')).toHaveLength(1);
    const after = (await row(name('first'))).expiresAt!;
    expect(after.getTime() - before.getTime()).toBe(365 * 86_400_000);
    expect((await db.domainRenewal.findUniqueOrThrow({ where: { id: renewalId } })).status).toBe('DONE');
    expect(await db.notification.count({ where: { tenantId: alice.tenantId, type: 'domain.renewed' } })).toBe(1);

    // Renewed at ResellerClub, but the result was never recorded here (say the worker stopped): the next try records it without paying.
    const second = await renew();
    const held = rc.owned.get(name('first'))!;
    held.endtime += 365 * 86_400;
    rc.calls = [];
    await events.handle('domain.renewal_requested', { renewalId: second }, { final: false });
    expect(rc.called('domains/renew.json')).toHaveLength(0);
    expect((await db.domainRenewal.findUniqueOrThrow({ where: { id: second } })).status).toBe('DONE');
    expect((await row(name('first'))).expiresAt!.getTime()).toBe(held.endtime * 1000);
  });

  it('starts a paid transfer at ResellerClub, and finishes it when the domain arrives', async () => {
    rc.taken.add(name('move'));
    const o = await http().post(api('domains/transfers')).set(auth(alice.token)).send({ domain: name('move'), authCode: 'Ab3$kL9!zQ-77' }).expect(201);
    await http().post(api(`invoices/${o.body.invoice.id}/pay`)).set(auth(alice.token)).send({}).expect(200);
    const t = await db.domainTransfer.findFirstOrThrow({ where: { domain: { name: name('move') } } });

    await events.handle('domain.transfer_requested', { transferId: t.id }, { final: false });
    const [start] = rc.called('domains/transfer.json');
    expect(start!.params['auth-code']).toEqual(['Ab3$kL9!zQ-77']);
    expect((await db.domainTransfer.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('IN_PROGRESS');
    expect(await db.notification.count({ where: { tenantId: alice.tenantId, type: 'domain.transfer_started' } })).toBe(1);

    expect(await automation.syncTransfers()).toBe(0); // still with the old registrar
    rc.finishTransfer(name('move'));
    expect(await automation.syncTransfers()).toBeGreaterThanOrEqual(1);
    const done = await db.domainTransfer.findUniqueOrThrow({ where: { id: t.id } });
    expect(done).toMatchObject({ status: 'COMPLETED', authCodeEnc: null });
    expect((await row(name('move'))).status).toBe('ACTIVE');
  });

  it('hands a transfer ResellerClub refuses to staff, with the reason', async () => {
    rc.taken.add(name('wrong'));
    rc.authCodes.set(name('wrong'), 'RIGHT-CODE');
    const o = await http().post(api('domains/transfers')).set(auth(alice.token)).send({ domain: name('wrong'), authCode: 'WRONG-CODE' }).expect(201);
    await http().post(api(`invoices/${o.body.invoice.id}/pay`)).set(auth(alice.token)).send({}).expect(200);
    const t = await db.domainTransfer.findFirstOrThrow({ where: { domain: { name: name('wrong') } } });
    await events.handle('domain.transfer_requested', { transferId: t.id }, { final: false });
    const after = await db.domainTransfer.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.status).toBe('REQUESTED');
    expect(after.failureReason).toContain('authorization code is not valid');
    expect((await tasks(name('wrong')))[0]!.body).toContain('could not start the transfer');
  });

  it('releases a domain for transfer away at ResellerClub, and records it gone once it leaves', async () => {
    const d = await activeDomain('leave');
    rc.hold(name('leave'), { domsecret: 'RC-Auth-777' });
    await http().post(api(`domains/${d.id}/transfer-out`)).set(auth(alice.token)).send({}).expect(201);
    const t = await db.domainTransferOut.findFirstOrThrow({ where: { domainId: d.id } });
    await events.handle('domain.transfer_out_requested', { transferOutId: t.id }, { final: false });
    expect(rc.called('domains/disable-theft-protection.json')).toHaveLength(1);
    expect(rc.owned.get(name('leave'))!.locked).toBe(false);
    expect((await db.domainTransferOut.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('RELEASED');
    expect((await http().get(api(`domains/${d.id}/transfer-out/code`)).set(auth(alice.token)).expect(200)).body).toEqual({ authCode: 'RC-Auth-777' });
    expect(await tasks(name('leave'))).toHaveLength(0);

    expect(await automation.syncTransfers()).toBe(0); // still here
    rc.transferAway(name('leave'));
    expect(await automation.syncTransfers()).toBeGreaterThanOrEqual(1);
    expect((await row(name('leave'))).status).toBe('TRANSFERRED_OUT');
    expect(await db.domainTransferOut.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ status: 'COMPLETED', authCodeEnc: null });
  });

  it('locks a domain again at ResellerClub when the transfer away is withdrawn', async () => {
    const d = await activeDomain('stay');
    rc.hold(name('stay'));
    await http().post(api(`domains/${d.id}/transfer-out`)).set(auth(alice.token)).send({}).expect(201);
    const t = await db.domainTransferOut.findFirstOrThrow({ where: { domainId: d.id } });
    await events.handle('domain.transfer_out_requested', { transferOutId: t.id }, { final: false });
    await http().post(api(`domains/${d.id}/transfer-out/cancel`)).set(auth(alice.token)).send({}).expect(200);
    await events.handle('domain.transfer_out_cancelled', { transferOutId: t.id }, { final: false });
    expect(rc.owned.get(name('stay'))!.locked).toBe(true);
    expect((await row(name('stay'))).locked).toBe(true);
    expect(await tasks(name('stay'))).toHaveLength(0);
  });

  it('changes nameservers at ResellerClub and records them, with no task for staff', async () => {
    const d = await activeDomain('dns');
    rc.hold(name('dns'));
    await http().post(api(`domains/${d.id}/nameservers`)).set(auth(alice.token)).send({ nameservers: ['ns1.site.io', 'ns2.site.io'] }).expect(201);
    const c = await db.domainNameserverChange.findFirstOrThrow({ where: { domainId: d.id } });
    await events.handle('domain.nameservers_requested', { changeId: c.id }, { final: false });
    expect(rc.called('domains/modify-ns.json').at(-1)!.params.ns).toEqual(['ns1.site.io', 'ns2.site.io']);
    expect(rc.owned.get(name('dns'))!.ns).toEqual(['ns1.site.io', 'ns2.site.io']);
    expect((await row(name('dns'))).nameservers).toEqual(['ns1.site.io', 'ns2.site.io']);
    expect((await db.domainNameserverChange.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('DONE');
    expect(await tasks(name('dns'))).toHaveLength(0);
  });

  it('changes the contacts at ResellerClub (all four roles), records them, and leaves no task', async () => {
    const d = await activeDomain('who');
    rc.hold(name('who'));
    const contact = { firstName: 'Ravi', lastName: 'Iyer', email: 'ravi@example.test', phone: '+91 98111 22233', address1: '9 Lake Road', city: 'Chennai', state: 'Tamil Nadu', postalCode: '600001', country: 'IN' };
    await http().post(api(`domains/${d.id}/contacts`)).set(auth(alice.token)).send({ ...contact, acknowledged: true }).expect(201);
    const c = await db.domainContactChange.findFirstOrThrow({ where: { domainId: d.id } });
    await events.handle('domain.contacts_requested', { changeId: c.id }, { final: false });
    const [mod] = rc.called('domains/modify-contact.json');
    const cid = mod!.params['reg-contact-id']![0]!;
    for (const role of ['admin-contact-id', 'tech-contact-id', 'billing-contact-id']) expect(mod!.params[role]).toEqual([cid]);
    expect(rc.contacts.get(cid)).toMatchObject({ name: 'Ravi Iyer', phoneCc: '91', phone: '9811122233', city: 'Chennai' });
    expect((await row(name('who'))).contact).toMatchObject({ firstName: 'Ravi' });
    expect((await db.domainContactChange.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('DONE');
    expect(await tasks(name('who'))).toHaveLength(0);
  });

  it('hands a nameserver change to staff when ResellerClub does not hold the domain', async () => {
    const d = await activeDomain('elsewhere');
    await http().post(api(`domains/${d.id}/nameservers`)).set(auth(alice.token)).send({ nameservers: ['ns1.site.io', 'ns2.site.io'] }).expect(201);
    const c = await db.domainNameserverChange.findFirstOrThrow({ where: { domainId: d.id } });
    await events.handle('domain.nameservers_requested', { changeId: c.id }, { final: false });
    expect(await db.domainNameserverChange.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ status: 'REQUESTED', failureReason: expect.stringContaining('does not hold') });
    expect((await tasks(name('elsewhere')))[0]!.body).toContain('could not change them');
  });

  it('reads purchase prices from ResellerClub for the admin price list', async () => {
    await http().get(api('admin/domains/tlds/registrar-costs')).query({ tlds: 'com' }).set(auth(alice.token)).expect(403);
    const r = await http().get(api('admin/domains/tlds/registrar-costs')).query({ tlds: `com, .${tld.toUpperCase()}, zzz, com` }).set(auth(admin)).expect(200);
    expect(r.body).toEqual({
      registrar: 'ResellerClub',
      rows: [{ tld: 'com', costRegister: 899.5, costRenew: 1049, costTransfer: 899.5 }, { tld, costRegister: 650, costRenew: 780, costTransfer: 640 }],
      missing: [{ tld: 'zzz', reason: expect.any(String) }],
    });
    await http().get(api('admin/domains/tlds/registrar-costs')).query({ tlds: 'bad ending!' }).set(auth(admin)).expect(400);
  });
});
