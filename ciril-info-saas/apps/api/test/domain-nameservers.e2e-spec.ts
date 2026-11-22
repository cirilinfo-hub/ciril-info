import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { DomainEventsHandler } from '../src/modules/domains/domain-events.handler.js';
import { cleanupUsers, createStaff, createTestApp, customer, lastEmail, platformDb, staffToken } from './utils.js';

/** Changing a domain's nameservers from the client area, with no registrar connected: staff make the change by hand. */
describe('Domain nameservers (e2e)', () => {
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  let events: DomainEventsHandler;
  const tag = randomUUID().slice(0, 6).toLowerCase();
  const emails: string[] = [];
  let alice: Awaited<ReturnType<typeof customer>>;
  let bob: Awaited<ReturnType<typeof customer>>;
  let admin: string;
  let reader: string;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = (p: string) => `/api/v1/${p}`;
  const tld = `n${tag}x`;
  const name = (label: string) => `${label}${tag}.${tld}`;
  const NEW = ['ns1.newhost.com', 'ns2.newhost.com'];

  const activeDomain = (who: typeof alice, label: string, nameservers: string[] = ['ns1.oldhost.com', 'ns2.oldhost.com']) =>
    db.domain.create({ data: { tenantId: who.tenantId, name: name(label), tld, status: 'ACTIVE', registeredAt: new Date(Date.now() - 100 * 86_400_000), expiresAt: new Date(Date.now() + 200 * 86_400_000), nameservers } });
  const ask = (who: typeof alice, id: string, nameservers: string[]) => http().post(api(`domains/${id}/nameservers`)).set(auth(who.token)).send({ nameservers });
  const staff = (id: string, action: string, body: object = {}, token = admin) => http().post(api(`admin/domains/${id}/nameservers/${action}`)).set(auth(token)).send(body);

  beforeAll(async () => {
    app = await createTestApp();
    db = platformDb();
    events = app.get(DomainEventsHandler);
    alice = await customer(app, db, 'ns-a');
    bob = await customer(app, db, 'ns-b');
    const sa = await createStaff(db, 'SUPER_ADMIN', 'nssa');
    const agent = await createStaff(db, 'SUPPORT_AGENT', 'nsagent');
    emails.push(alice.email, bob.email, sa.email, agent.email);
    [admin, reader] = await Promise.all([staffToken(app, db, sa), staffToken(app, db, agent)]);
  });

  afterAll(async () => {
    const tenantIds = [alice?.tenantId, bob?.tenantId].filter(Boolean) as string[];
    await db.notification.deleteMany({ where: { type: 'domain.task', title: { contains: tag } } });
    await db.domain.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.outboxEvent.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await cleanupUsers(db, emails);
    await app.close();
  });

  it('checks what the customer typed and refuses what cannot be changed, with a reason', async () => {
    const d = await activeDomain(alice, 'check');
    expect((await ask(alice, d.id, ['ns1.newhost.com']).expect(400)).body.error.code).toBe('NAMESERVERS_INVALID');
    expect((await ask(alice, d.id, ['ns1.newhost.com', 'not a host']).expect(400)).body.error.message).toContain('"not a host"');
    expect((await ask(alice, d.id, [`ns1.${name('check')}`, 'ns2.newhost.com']).expect(400)).body.error.message).toContain('glue records');
    expect((await ask(alice, d.id, ['NS2.oldhost.com.', 'ns1.oldhost.com']).expect(409)).body.error.code).toBe('NAMESERVERS_UNCHANGED');
    const pending = await db.domain.create({ data: { tenantId: alice.tenantId, name: name('pend'), tld, status: 'PENDING_REGISTRATION' } });
    expect((await ask(alice, pending.id, NEW).expect(409)).body.error.code).toBe('DOMAIN_NOT_ACTIVE');
    const bobs = await activeDomain(bob, 'bobs');
    await ask(alice, bobs.id, NEW).expect(404); // another organisation's domain
  });

  it('staff are given the task, make the change, and the customer is told', async () => {
    const d = await activeDomain(alice, 'move');
    const r = await ask(alice, d.id, [' NS1.NewHost.com ', 'ns2.newhost.com.']).expect(201);
    expect(r.body).toMatchObject({ status: 'REQUESTED', nameservers: NEW });
    expect((await ask(alice, d.id, ['ns1.other.com', 'ns2.other.com']).expect(409)).body.error.code).toBe('NAMESERVER_CHANGE_PENDING');
    const list = await http().get(api('domains')).set(auth(alice.token)).expect(200);
    expect(list.body.data.find((x: { id: string }) => x.id === d.id)).toMatchObject({ nameservers: ['ns1.oldhost.com', 'ns2.oldhost.com'], nameserverChanges: [{ nameservers: NEW }] });

    const change = await db.domainNameserverChange.findFirstOrThrow({ where: { domainId: d.id } });
    await events.handle('domain.nameservers_requested', { changeId: change.id });
    const task = await db.notification.findFirstOrThrow({ where: { type: 'domain.task', title: `Change the nameservers of ${name('move')}` } });
    expect(task.body).toContain('ns1.newhost.com, ns2.newhost.com');

    const waiting = await http().get(api('admin/domains?needsAction=true')).set(auth(admin)).expect(200);
    expect(waiting.body.data.some((x: { id: string }) => x.id === d.id)).toBe(true);
    await staff(d.id, 'complete', {}, reader).expect(403); // a support agent can look but not act
    const done = await staff(d.id, 'complete').expect(200);
    expect(done.body.nameservers).toEqual(NEW);
    expect(done.body.nameserverChanges).toEqual([]);
    expect(await db.domainNameserverChange.findUniqueOrThrow({ where: { id: change.id } })).toMatchObject({ status: 'DONE' });
    expect((await lastEmail(db, alice.email, 'domain-nameservers-changed'))?.data).toMatchObject({ domain: name('move'), nameservers: 'ns1.newhost.com, ns2.newhost.com' });
    await staff(d.id, 'complete').expect(409); // nothing waiting any more
  });

  it('the customer can withdraw a change before it is made, and staff can refuse one with a reason', async () => {
    const d = await activeDomain(alice, 'undo');
    await ask(alice, d.id, NEW).expect(201);
    await http().post(api(`domains/${d.id}/nameservers/cancel`)).set(auth(alice.token)).send({}).expect(200);
    await http().post(api(`domains/${d.id}/nameservers/cancel`)).set(auth(alice.token)).send({}).expect(404);
    const c = await db.domainNameserverChange.findFirstOrThrow({ where: { domainId: d.id } });
    expect(c.status).toBe('CANCELLED');
    // A queued event for a withdrawn change does nothing.
    await events.handle('domain.nameservers_requested', { changeId: c.id });
    expect(await db.notification.count({ where: { type: 'domain.task', title: { contains: name('undo') } } })).toBe(0);

    await ask(alice, d.id, NEW).expect(201); // asking again is fine once the first is closed
    await staff(d.id, 'decline', { reason: 'The registry has locked this domain.' }).expect(200);
    expect((await db.domain.findUniqueOrThrow({ where: { id: d.id } })).nameservers).toEqual(['ns1.oldhost.com', 'ns2.oldhost.com']);
    expect(await db.notification.count({ where: { userId: alice.userId, type: 'domain.nameservers_declined', body: 'The registry has locked this domain.' } })).toBe(1);
  });

  it('our own nameservers are offered when they are set', async () => {
    const r = await http().get(api('domains/nameservers/defaults')).set(auth(alice.token)).expect(200);
    expect(Array.isArray(r.body.nameservers)).toBe(true);
  });
});
