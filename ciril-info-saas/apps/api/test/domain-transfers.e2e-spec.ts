import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { BillingLifecycleService } from '../src/modules/billing/billing-lifecycle.service.js';
import { DomainEventsHandler } from '../src/modules/domains/domain-events.handler.js';
import { addYears } from '../src/modules/domains/domain-rules.js';
import { cleanupUsers, createStaff, createTestApp, customer, platformDb, staffToken } from './utils.js';

/** Transferring a domain in: quote, order with the authorisation code, pay, staff start and finish it, refusal, and clean-up. */
describe('Domain transfers (e2e)', () => {
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  let events: DomainEventsHandler;
  let lifecycle: BillingLifecycleService;
  const tag = randomUUID().slice(0, 6).toLowerCase();
  const tld = `t${tag}x`;
  const emails: string[] = [];
  let alice: Awaited<ReturnType<typeof customer>>;
  let bob: Awaited<ReturnType<typeof customer>>;
  let admin: string;
  let adminId: string;
  let reader: string;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = (p: string) => `/api/v1/${p}`;
  const address = { line1: '1 Test Street', city: 'Pune', stateCode: '27', postalCode: '411001' };
  /** A name the mock registrar says is registered elsewhere (it contains "taken"). */
  const name = (label: string) => `taken${label}${tag}.${tld}`;
  const CODE = 'Ab3$kL9!zQ-77';
  const quote = (who: typeof alice, domain: string) => http().get(api('domains/transfers/quote')).set(auth(who.token)).query({ domain });
  const order = (who: typeof alice, domain: string, authCode = CODE) => http().post(api('domains/transfers')).set(auth(who.token)).send({ domain, authCode });
  const pay = (who: typeof alice, invoiceId: string) => http().post(api(`invoices/${invoiceId}/pay`)).set(auth(who.token)).send({});
  const row = (domain: string) => db.domain.findFirstOrThrow({ where: { name: domain }, include: { transfers: { orderBy: { requestedAt: 'desc' } } } });
  const adminPost = (id: string, action: string, body: object = {}, token = admin) => http().post(api(`admin/domains/${id}/transfer/${action}`)).set(auth(token)).send(body);

  beforeAll(async () => {
    app = await createTestApp();
    db = platformDb();
    events = app.get(DomainEventsHandler);
    lifecycle = app.get(BillingLifecycleService);
    alice = await customer(app, db, 'xfer-a');
    bob = await customer(app, db, 'xfer-b');
    const sa = await createStaff(db, 'SUPER_ADMIN', 'xfersa');
    const agent = await createStaff(db, 'SUPPORT_AGENT', 'xferagent');
    adminId = sa.id;
    emails.push(alice.email, bob.email, sa.email, agent.email);
    [admin, reader] = await Promise.all([staffToken(app, db, sa), staffToken(app, db, agent)]);
    await http().post(api('organisation/addresses')).set(auth(alice.token)).send(address).expect(201);
    await http().post(api('organisation/addresses')).set(auth(bob.token)).send(address).expect(201);
    await db.tldPrice.create({ data: { tld, registerPrice: '800.00', renewPrice: '1000.00', transferPrice: '700.00' } });
  });

  afterAll(async () => {
    const tenantIds = [alice?.tenantId, bob?.tenantId].filter(Boolean) as string[];
    await db.notification.deleteMany({ where: { type: 'domain.task', title: { contains: tag } } });
    await db.domainTransfer.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.domain.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.payment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.invoice.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.outboxEvent.deleteMany({ where: { tenantId: { in: tenantIds }, type: 'domain.transfer_requested' } });
    await db.tldPrice.deleteMany({ where: { tld } });
    await cleanupUsers(db, emails);
    await app.close();
  });

  describe('quote', () => {
    it('needs a sign-in', async () => {
      await http().get(api('domains/transfers/quote')).query({ domain: name('q') }).expect(401);
    });

    it('prices a domain registered elsewhere at the transfer price', async () => {
      const q = (await quote(alice, name('quote')).expect(200)).body;
      expect(q).toMatchObject({ domain: name('quote'), currency: 'INR', transferPrice: 700 });
      expect(Number(q.subtotal)).toBe(700);
    });

    it('refuses what cannot be transferred, with a reason', async () => {
      expect((await quote(alice, 'nodots').expect(400)).body.error.code).toBe('INVALID_DOMAIN');
      expect((await quote(alice, `taken${tag}.nosuchending`).expect(400)).body.error.code).toBe('TLD_NOT_SOLD');
      // A free name is registered, not transferred.
      expect((await quote(alice, `free${tag}.${tld}`).expect(409)).body.error.code).toBe('NOT_REGISTERED');
      expect((await quote(alice, `registrarfail${tag}.${tld}`).expect(502)).body.error.code).toBe('REGISTRAR_UNAVAILABLE');
    });
  });

  describe('ordering', () => {
    it('needs a plausible authorisation code', async () => {
      for (const bad of ['', '123', 'has a space', 'x'.repeat(200)]) {
        expect((await order(alice, name('code'), bad).expect(400)).body.error.code).toMatch(/INVALID_AUTH_CODE|VALIDATION_FAILED/);
      }
      expect(await db.domain.count({ where: { name: name('code') } })).toBe(0);
    });

    it('creates an unpaid invoice and a pending transfer, and never exposes the code', async () => {
      const r = await order(alice, name('first')).expect(201);
      expect(r.body.domain).toMatchObject({ name: name('first'), status: 'PENDING_TRANSFER', stage: 'TRANSFER_AWAITING_PAYMENT' });
      expect(r.body.invoice.status).toBe('ISSUED');
      expect(Number(r.body.invoice.subtotal)).toBe(700);
      expect(JSON.stringify(r.body)).not.toContain(CODE);
      const items = await db.invoiceItem.findMany({ where: { invoiceId: r.body.invoice.id } });
      expect(items[0]!.description).toBe(`Domain transfer - ${name('first')} (includes 1 year)`);

      const t = (await row(name('first'))).transfers[0]!;
      expect(t.status).toBe('REQUESTED');
      expect(t.invoiceId).toBe(r.body.invoice.id);
      expect(t.authCodeEnc).toMatch(/^v1\./); // stored encrypted
      expect(t.authCodeEnc).not.toContain(CODE);
      const listed = await http().get(api('domains')).set(auth(alice.token)).expect(200);
      expect(JSON.stringify(listed.body)).not.toContain(CODE);
      expect(listed.body.data.find((d: { name: string }) => d.name === name('first')).stage).toBe('TRANSFER_AWAITING_PAYMENT');
      expect(await db.auditLog.count({ where: { action: 'domain.transfer_requested', entityId: r.body.domain.id } })).toBe(1);
      expect(JSON.stringify(await db.auditLog.findMany({ where: { entityId: r.body.domain.id } }))).not.toContain(CODE);
    });

    it('lets only one live order hold a name, and refuses one that is not registered anywhere', async () => {
      expect((await order(alice, name('first')).expect(409)).body.error.code).toBe('DOMAIN_UNAVAILABLE');
      expect((await order(bob, name('first')).expect(409)).body.error.code).toBe('DOMAIN_UNAVAILABLE');
      expect((await order(alice, `free2${tag}.${tld}`).expect(409)).body.error.code).toBe('NOT_REGISTERED');
      const results = await Promise.all([order(alice, name('race')), order(bob, name('race'))]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    });

    it('cancelling an unpaid transfer voids the invoice, deletes the code, and releases the name', async () => {
      const r = await order(alice, name('cancel')).expect(201);
      await http().post(api(`domains/${r.body.domain.id}/cancel`)).set(auth(bob.token)).expect(404);
      await http().post(api(`domains/${r.body.domain.id}/cancel`)).set(auth(alice.token)).expect(200);
      const after = await row(name('cancel'));
      expect(after.status).toBe('CANCELLED');
      expect(after.transfers[0]).toMatchObject({ status: 'CANCELLED', authCodeEnc: null });
      expect((await db.invoice.findUniqueOrThrow({ where: { id: r.body.invoice.id } })).status).toBe('VOID');
      await order(bob, name('cancel')).expect(201); // somebody else can have it now
    });
  });

  describe('payment and staff', () => {
    let id: string;
    let invoiceId: string;

    it('payment turns it into a task for staff', async () => {
      const r = await order(alice, name('paid')).expect(201);
      id = r.body.domain.id;
      invoiceId = r.body.invoice.id;
      expect(await db.outboxEvent.count({ where: { type: 'domain.transfer_requested', aggregateId: id } })).toBe(0);
      await adminPost(id, 'start').expect(409); // unpaid
      expect((await http().get(api(`admin/domains/${id}/transfer/auth-code`)).set(auth(admin)).expect(409)).body.error.code).toBe('TRANSFER_NOT_PAID');

      await pay(alice, invoiceId).expect(200);
      const event = await db.outboxEvent.findFirstOrThrow({ where: { type: 'domain.transfer_requested', aggregateId: id } });
      expect(await events.handle('domain.transfer_requested', event.payload)).toBe(true);
      const notices = await db.notification.findMany({ where: { type: 'domain.task', title: `Transfer in ${name('paid')}` } });
      expect(notices.some((n) => n.userId === adminId)).toBe(true);
      const listed = (await http().get(api('domains')).set(auth(alice.token)).expect(200)).body.data as { id: string; stage: string }[];
      expect(listed.find((d) => d.id === id)!.stage).toBe('TRANSFERRING');
      expect((await http().post(api(`domains/${id}/cancel`)).set(auth(alice.token)).expect(409)).body.error.code).toBe('DOMAIN_NOT_CANCELLABLE');
    });

    it('staff see it under "needs action", and only people with domains:write may see the code or act', async () => {
      const waiting = await http().get(api('admin/domains')).query({ needsAction: 'true', search: name('paid') }).set(auth(admin)).expect(200);
      expect(waiting.body.data.map((d: { id: string }) => d.id)).toContain(id);
      expect(JSON.stringify(waiting.body)).not.toContain(CODE); // the list never carries it
      await http().get(api('admin/domains')).set(auth(reader)).expect(200);
      await http().get(api(`admin/domains/${id}/transfer/auth-code`)).set(auth(reader)).expect(403);
      await http().get(api(`admin/domains/${id}/transfer/auth-code`)).set(auth(alice.token)).expect(403);
      await adminPost(id, 'start', {}, reader).expect(403);
    });

    it('shows staff the code, and records each time it is viewed', async () => {
      const r = await http().get(api(`admin/domains/${id}/transfer/auth-code`)).set(auth(admin)).expect(200);
      expect(r.body.authCode).toBe(CODE);
      expect(await db.auditLog.count({ where: { action: 'domain.transfer_code_viewed', entityId: id, actorId: adminId } })).toBe(1);
      expect(JSON.stringify(await db.auditLog.findMany({ where: { entityId: id } }))).not.toContain(CODE);
    });

    it('starting it tells the customer, and cannot be done twice', async () => {
      await adminPost(id, 'start').expect(200);
      expect((await row(name('paid'))).transfers[0]!.status).toBe('IN_PROGRESS');
      expect(await db.notification.count({ where: { tenantId: alice.tenantId, type: 'domain.transfer_started' } })).toBe(1);
      expect((await adminPost(id, 'start').expect(409)).body.error.code).toBe('TRANSFER_NOT_WAITING');
      await http().get(api(`admin/domains/${id}/transfer/auth-code`)).set(auth(admin)).expect(200); // still needed until it is done
    });

    it('completing it makes the domain Active for a year, deletes the code, and tells the customer', async () => {
      await adminPost(id, 'complete', { expiresAt: '2020-01-01' }).expect(400);
      await adminPost(id, 'complete', {}, reader).expect(403);
      await adminPost(id, 'complete', { registrarRef: 'XFER-1' }).expect(200);
      const after = await row(name('paid'));
      expect(after.status).toBe('ACTIVE');
      expect(Math.abs(after.expiresAt!.getTime() - addYears(new Date(), 1).getTime())).toBeLessThan(60_000);
      expect(after.registrarRef).toBe('XFER-1');
      expect(after.transfers[0]).toMatchObject({ status: 'COMPLETED', authCodeEnc: null });
      expect(await db.notification.count({ where: { tenantId: alice.tenantId, type: 'domain.transferred' } })).toBe(1);
      expect(await db.outboxEvent.count({ where: { type: 'email.send', tenantId: alice.tenantId, payload: { path: ['template'], equals: 'domain-transferred' } } })).toBe(1);
      expect((await adminPost(id, 'complete').expect(409)).body.error.code).toBe('TRANSFER_NOT_WAITING');
      expect((await http().get(api(`admin/domains/${id}/transfer/auth-code`)).set(auth(admin)).expect(409)).body.error.code).toBe('TRANSFER_NOT_WAITING');
      expect((await http().get(api('domains')).set(auth(alice.token)).expect(200)).body.data.find((d: { id: string }) => d.id === id).stage).toBe('ACTIVE');
    });

    it('can be completed straight from paid, and two staff at once complete it once', async () => {
      const r = await order(alice, name('both')).expect(201);
      await pay(alice, r.body.invoice.id).expect(200);
      const res = await Promise.all([adminPost(r.body.domain.id, 'complete'), adminPost(r.body.domain.id, 'complete')]);
      expect(res.map((x) => x.status).sort()).toEqual([200, 409]);
      expect((await row(name('both'))).status).toBe('ACTIVE');
    });

    it('a transfer that fails is closed with a reason, the code is deleted, the customer is told, and the name is free again', async () => {
      const r = await order(bob, name('refused')).expect(201);
      await pay(bob, r.body.invoice.id).expect(200);
      await adminPost(r.body.domain.id, 'fail', { reason: '' }).expect(400);
      await adminPost(r.body.domain.id, 'fail', { reason: 'No' }, reader).expect(403);
      await adminPost(r.body.domain.id, 'fail', { reason: 'The domain is locked at the current registrar.' }).expect(200);
      const after = await row(name('refused'));
      expect(after.status).toBe('FAILED');
      expect(after.transfers[0]).toMatchObject({ status: 'REJECTED', authCodeEnc: null, failureReason: 'The domain is locked at the current registrar.' });
      const note = await db.notification.findFirstOrThrow({ where: { tenantId: bob.tenantId, type: 'domain.transfer_failed' } });
      expect(note.body).toContain('locked');
      expect(note.body).toContain('refund');
      const mine = (await http().get(api('domains')).set(auth(bob.token)).expect(200)).body.data as { name: string; stage: string; failureReason: string }[];
      expect(mine.find((d) => d.name === name('refused'))).toMatchObject({ stage: 'FAILED', failureReason: 'The domain is locked at the current registrar.' });
      await order(alice, name('refused')).expect(201); // released
    });
  });

  describe('clean-up', () => {
    it('withdraws a transfer left unpaid for too long, deleting its code, but never one that has been paid', async () => {
      const stale = await order(alice, name('stale')).expect(201);
      const paid = await order(alice, name('stalepaid')).expect(201);
      await pay(alice, paid.body.invoice.id).expect(200);
      const longAgo = new Date(Date.now() - 40 * 86_400_000);
      await db.domain.updateMany({ where: { id: { in: [stale.body.domain.id, paid.body.domain.id] } }, data: { createdAt: longAgo } });
      await lifecycle.run(new Date());
      const a = await row(name('stale'));
      expect(a.status).toBe('CANCELLED');
      expect(a.transfers[0]).toMatchObject({ status: 'CANCELLED', authCodeEnc: null });
      expect((await db.invoice.findUniqueOrThrow({ where: { id: stale.body.invoice.id } })).status).toBe('VOID');
      const b = await row(name('stalepaid'));
      expect(b.status).toBe('PENDING_TRANSFER');
      expect(b.transfers[0]!.authCodeEnc).not.toBeNull();
    });
  });
});
