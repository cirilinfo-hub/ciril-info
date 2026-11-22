import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { DomainEventsHandler } from '../src/modules/domains/domain-events.handler.js';
import { cleanupUsers, createStaff, createTestApp, customer, lastEmail, platformDb, staffToken } from './utils.js';

/** Moving a domain away to another registrar, with no registrar connected: staff release it by hand. */
describe('Domain transfer out (e2e)', () => {
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
  const tld = `o${tag}x`;
  const name = (label: string) => `${label}${tag}.${tld}`;
  const CODE = 'Out#Code-9981x';

  /** An active domain registered long enough ago to move. */
  const activeDomain = (who: typeof alice, label: string, daysAgo = 120) =>
    db.domain.create({ data: { tenantId: who.tenantId, name: name(label), tld, status: 'ACTIVE', registeredAt: new Date(Date.now() - daysAgo * 86_400_000), expiresAt: new Date(Date.now() + 200 * 86_400_000) } });
  const ask = (who: typeof alice, id: string) => http().post(api(`domains/${id}/transfer-out`)).set(auth(who.token)).send({});
  const code = (who: typeof alice, id: string) => http().get(api(`domains/${id}/transfer-out/code`)).set(auth(who.token));
  const withdraw = (who: typeof alice, id: string) => http().post(api(`domains/${id}/transfer-out/cancel`)).set(auth(who.token)).send({});
  const staff = (id: string, action: string, body: object = {}, token = admin) => http().post(api(`admin/domains/${id}/transfer-out/${action}`)).set(auth(token)).send(body);
  const live = (domainId: string) => db.domainTransferOut.findFirst({ where: { domainId }, orderBy: { requestedAt: 'desc' } });

  beforeAll(async () => {
    app = await createTestApp();
    db = platformDb();
    events = app.get(DomainEventsHandler);
    alice = await customer(app, db, 'out-a');
    bob = await customer(app, db, 'out-b');
    const sa = await createStaff(db, 'SUPER_ADMIN', 'outsa');
    const agent = await createStaff(db, 'SUPPORT_AGENT', 'outagent');
    emails.push(alice.email, bob.email, sa.email, agent.email);
    [admin, reader] = await Promise.all([staffToken(app, db, sa), staffToken(app, db, agent)]);
    await db.tldPrice.create({ data: { tld, registerPrice: '500.00', renewPrice: '600.00', transferPrice: '400.00' } });
    await http().post(api('organisation/addresses')).set(auth(alice.token)).send({ line1: '1 Road', city: 'Pune', stateCode: '27', postalCode: '411001' }).expect(201);
  });

  afterAll(async () => {
    const tenantIds = [alice?.tenantId, bob?.tenantId].filter(Boolean) as string[];
    await db.notification.deleteMany({ where: { type: 'domain.task', title: { contains: tag } } });
    await db.domainTransferOut.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.domainRenewal.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.domain.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.payment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.invoice.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.outboxEvent.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.tldPrice.deleteMany({ where: { tld } });
    await cleanupUsers(db, emails);
    await app.close();
  });

  it('refuses what cannot move yet, with a reason', async () => {
    const fresh = await activeDomain(alice, 'fresh', 10);
    const r = await ask(alice, fresh.id).expect(409);
    expect(r.body.error.code).toBe('TRANSFER_TOO_SOON');
    expect(r.body.error.message).toContain('60 days');
    const pending = await db.domain.create({ data: { tenantId: alice.tenantId, name: name('pend'), tld, status: 'PENDING_REGISTRATION' } });
    expect((await ask(alice, pending.id).expect(409)).body.error.code).toBe('DOMAIN_NOT_TRANSFERABLE');
    const other = await activeDomain(bob, 'bobs');
    await ask(alice, other.id).expect(404); // another organisation's domain
    await http().post(api(`domains/${other.id}/transfer-out`)).send({}).expect(401);
  });

  it('staff release it by hand, the customer reads the code, and staff mark it gone', async () => {
    const d = await activeDomain(alice, 'move');
    const r = await ask(alice, d.id).expect(201);
    expect(r.body.status).toBe('REQUESTED');
    expect((await ask(alice, d.id).expect(409)).body.error.code).toBe('TRANSFER_OUT_PENDING');
    expect((await code(alice, d.id).expect(409)).body.error.code).toBe('CODE_NOT_READY');
    // It shows in the customer's list, and renewing is refused while it is going.
    const mine = (await http().get(api('domains')).set(auth(alice.token)).expect(200)).body.data.find((x: { id: string }) => x.id === d.id);
    expect(mine.transferOuts[0]).toMatchObject({ status: 'REQUESTED' });
    expect((await http().post(api(`domains/${d.id}/renew`)).set(auth(alice.token)).send({ years: 1 }).expect(409)).body.error.code).toBe('TRANSFER_OUT_PENDING');

    // No registrar is connected: the worker turns the request into a task for staff.
    const t = (await live(d.id))!;
    await events.handle('domain.transfer_out_requested', { transferOutId: t.id });
    const [task] = await db.notification.findMany({ where: { type: 'domain.task', title: `Release ${name('move')} for transfer` } });
    expect(task!.body).toContain('enter it in Domains');
    const needs = await http().get(api('admin/domains')).query({ needsAction: 'true', search: name('move') }).set(auth(admin)).expect(200);
    expect(needs.body.data.map((x: { id: string }) => x.id)).toContain(d.id);

    await staff(d.id, 'release', { authCode: CODE }, reader).expect(403);
    expect((await staff(d.id, 'release', { authCode: 'has space' }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    const released = await staff(d.id, 'release', { authCode: CODE }).expect(200);
    expect(released.body.transferOuts[0]).toMatchObject({ status: 'RELEASED' });
    expect(JSON.stringify(released.body)).not.toContain(CODE); // staff responses never echo it
    const row = (await live(d.id))!;
    expect(row.authCodeEnc).toMatch(/^v1\./);
    expect((await db.domain.findUniqueOrThrow({ where: { id: d.id } })).locked).toBe(false);
    const mail = await lastEmail(db, alice.email, 'domain-transfer-code');
    expect(JSON.stringify(mail)).not.toContain(CODE); // the email says it is ready, never what it is

    expect((await code(alice, d.id).expect(200)).body).toEqual({ authCode: CODE });
    expect(await db.auditLog.count({ where: { action: 'domain.transfer_out_code_viewed', entityId: d.id } })).toBe(1);

    const gone = await staff(d.id, 'complete').expect(200);
    expect(gone.body.status).toBe('TRANSFERRED_OUT');
    expect(await live(d.id)).toMatchObject({ status: 'COMPLETED', authCodeEnc: null });
    const after = (await http().get(api('domains')).set(auth(alice.token)).expect(200)).body.data.find((x: { id: string }) => x.id === d.id);
    expect(after.stage).toBe('TRANSFERRED_OUT');
    expect(await db.notification.count({ where: { tenantId: alice.tenantId, type: 'domain.transferred_out' } })).toBe(1);
    await code(alice, d.id).expect(404);
  });

  it('closes an unpaid renewal when the domain leaves', async () => {
    const d = await activeDomain(alice, 'unpaid');
    const ren = await http().post(api(`domains/${d.id}/renew`)).set(auth(alice.token)).send({ years: 1 }).expect(201);
    await ask(alice, d.id).expect(201); // an unpaid renewal does not stop it
    await staff(d.id, 'complete').expect(200);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: ren.body.invoice.id } })).status).toBe('VOID');
    expect((await db.domainRenewal.findFirstOrThrow({ where: { domainId: d.id } })).status).toBe('CANCELLED');
  });

  it('a withdrawn transfer is locked again by staff when there is no registrar', async () => {
    const d = await activeDomain(alice, 'back');
    await ask(alice, d.id).expect(201);
    await staff(d.id, 'release', { authCode: CODE }).expect(200);
    const w = await withdraw(alice, d.id).expect(200);
    expect(w.body.status).toBe('CANCELLED');
    expect(await live(d.id)).toMatchObject({ status: 'CANCELLED', authCodeEnc: null });
    const ev = await db.outboxEvent.findFirstOrThrow({ where: { type: 'domain.transfer_out_cancelled', aggregateId: d.id } });
    await events.handle(ev.type, ev.payload);
    expect(await db.notification.count({ where: { type: 'domain.task', title: `Lock ${name('back')} again` } })).toBeGreaterThan(0); // one per staff member
    await withdraw(alice, d.id).expect(404);
    await ask(alice, d.id).expect(201); // can be asked for again
  });

  it('staff can refuse to release it, and the customer is told why', async () => {
    const d = await activeDomain(alice, 'refuse');
    await ask(alice, d.id).expect(201);
    const r = await staff(d.id, 'decline', { reason: 'The registry has locked this domain for a dispute.' }).expect(200);
    expect(r.body.transferOuts).toHaveLength(0);
    expect(await live(d.id)).toMatchObject({ status: 'CANCELLED', failureReason: 'The registry has locked this domain for a dispute.' });
    const n = await db.notification.findFirstOrThrow({ where: { tenantId: alice.tenantId, type: 'domain.transfer_out_declined' } });
    expect(n.body).toContain('dispute');
    expect((await staff(d.id, 'release', { authCode: CODE }).expect(409)).body.error.code).toBe('TRANSFER_OUT_NOT_WAITING');
  });
});
