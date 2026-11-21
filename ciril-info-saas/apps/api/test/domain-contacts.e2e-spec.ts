import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { DomainEventsHandler } from '../src/modules/domains/domain-events.handler.js';
import { cleanupUsers, createStaff, createTestApp, customer, lastEmail, platformDb, staffToken } from './utils.js';

/** Changing a domain's contact details from the client area, with no registrar connected: staff make the change by hand. */
describe('Domain contacts (e2e)', () => {
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  let events: DomainEventsHandler;
  const tag = randomUUID().slice(0, 6).toLowerCase();
  const emails: string[] = [];
  let alice: Awaited<ReturnType<typeof customer>>;
  let bob: Awaited<ReturnType<typeof customer>>;
  let admin: string;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = (p: string) => `/api/v1/${p}`;
  const tld = `c${tag}x`;
  const name = (label: string) => `${label}${tag}.${tld}`;
  const NEW = { firstName: 'Meera', lastName: 'Nair', organisation: 'Nair Designs', email: 'meera@example.test', phone: '+91 90000 11111', address1: '5 Beach Road', city: 'Kochi', state: 'Kerala', postalCode: '682001', country: 'IN', acknowledged: true };

  const activeDomain = (who: typeof alice, label: string) =>
    db.domain.create({ data: { tenantId: who.tenantId, name: name(label), tld, status: 'ACTIVE', registeredAt: new Date(Date.now() - 100 * 86_400_000), expiresAt: new Date(Date.now() + 200 * 86_400_000) } });
  const ask = (who: typeof alice, id: string, body: object) => http().post(api(`domains/${id}/contacts`)).set(auth(who.token)).send(body);

  beforeAll(async () => {
    app = await createTestApp();
    db = platformDb();
    events = app.get(DomainEventsHandler);
    alice = await customer(app, db, 'ct-a');
    bob = await customer(app, db, 'ct-b');
    const sa = await createStaff(db, 'SUPER_ADMIN', 'ctsa');
    emails.push(alice.email, bob.email, sa.email);
    admin = await staffToken(app, db, sa);
    await http().post(api('organisation/addresses')).set(auth(alice.token)).send({ line1: '1 Hill Road', city: 'Pune', stateCode: '27', postalCode: '411001' }).expect(201);
    await db.customerAccount.update({ where: { tenantId: alice.tenantId }, data: { phone: '98765 43210' } });
  });

  afterAll(async () => {
    const tenantIds = [alice?.tenantId, bob?.tenantId].filter(Boolean) as string[];
    await db.notification.deleteMany({ where: { type: 'domain.task', title: { contains: tag } } });
    await db.domain.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.outboxEvent.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await cleanupUsers(db, emails);
    await app.close();
  });

  it("shows the organisation's details until contacts have been changed", async () => {
    const d = await activeDomain(alice, 'show');
    const r = await http().get(api(`domains/${d.id}/contacts`)).set(auth(alice.token)).expect(200);
    expect(r.body).toMatchObject({ recorded: false, pending: null, contact: { email: alice.email, phone: '98765 43210', address1: '1 Hill Road', city: 'Pune', country: 'IN' } });
    await http().get(api(`domains/${d.id}/contacts`)).set(auth(bob.token)).expect(404);
  });

  it('checks the details and needs the warning acknowledged', async () => {
    const d = await activeDomain(alice, 'check');
    expect((await ask(alice, d.id, { ...NEW, acknowledged: false }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    expect((await ask(alice, d.id, { ...NEW, email: 'not-an-email' }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    expect((await ask(alice, d.id, { ...NEW, phone: '12-34-56' }).expect(400)).body.error.code).toBe('CONTACT_INVALID');
    expect((await ask(alice, d.id, { ...NEW, country: 'India' }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    const pending = await db.domain.create({ data: { tenantId: alice.tenantId, name: name('pend'), tld, status: 'PENDING_REGISTRATION' } });
    expect((await ask(alice, pending.id, NEW).expect(409)).body.error.code).toBe('DOMAIN_NOT_ACTIVE');
    const bobs = await activeDomain(bob, 'bobs');
    await ask(alice, bobs.id, NEW).expect(404);
  });

  it('staff get the task, set the details, and the owners are told; the details are then on record', async () => {
    const d = await activeDomain(alice, 'move');
    await ask(alice, d.id, NEW).expect(201);
    expect((await ask(alice, d.id, NEW).expect(409)).body.error.code).toBe('CONTACT_CHANGE_PENDING');
    const change = await db.domainContactChange.findFirstOrThrow({ where: { domainId: d.id } });
    expect(change.contact).toMatchObject({ firstName: 'Meera', email: 'meera@example.test', country: 'IN' });
    expect(change.contact).not.toHaveProperty('acknowledged');
    expect((await db.auditLog.findFirstOrThrow({ where: { action: 'domain.contacts_requested', entityId: d.id } })).metadata).toMatchObject({ registrantChange: true });

    await events.handle('domain.contacts_requested', { changeId: change.id });
    expect(await db.notification.count({ where: { type: 'domain.task', title: `Change the contacts of ${name('move')}` } })).toBeGreaterThan(0);
    const waiting = await http().get(api('admin/domains?needsAction=true')).set(auth(admin)).expect(200);
    expect(waiting.body.data.find((x: { id: string }) => x.id === d.id).contactChanges[0].contact).toMatchObject({ lastName: 'Nair' });

    await http().post(api(`admin/domains/${d.id}/contacts/complete`)).set(auth(admin)).send({}).expect(200);
    expect((await db.domain.findUniqueOrThrow({ where: { id: d.id } })).contact).toMatchObject({ firstName: 'Meera', organisation: 'Nair Designs' });
    expect((await lastEmail(db, alice.email, 'domain-contacts-changed'))?.data).toMatchObject({ domain: name('move') });
    const now = await http().get(api(`domains/${d.id}/contacts`)).set(auth(alice.token)).expect(200);
    expect(now.body).toMatchObject({ recorded: true, pending: null, contact: { lastName: 'Nair' } });
    expect((await ask(alice, d.id, NEW).expect(409)).body.error.code).toBe('CONTACT_UNCHANGED');
  });

  it('the customer can withdraw a change, and staff can refuse one with a reason', async () => {
    const d = await activeDomain(alice, 'undo');
    await ask(alice, d.id, NEW).expect(201);
    await http().post(api(`domains/${d.id}/contacts/cancel`)).set(auth(alice.token)).send({}).expect(200);
    await http().post(api(`domains/${d.id}/contacts/cancel`)).set(auth(alice.token)).send({}).expect(404);
    await ask(alice, d.id, NEW).expect(201);
    await http().post(api(`admin/domains/${d.id}/contacts/decline`)).set(auth(admin)).send({ reason: 'Please confirm this change by phone first.' }).expect(200);
    expect((await db.domain.findUniqueOrThrow({ where: { id: d.id } })).contact).toBeNull();
    expect(await db.notification.count({ where: { userId: alice.userId, type: 'domain.contacts_declined', body: 'Please confirm this change by phone first.' } })).toBe(1);
  });
});
