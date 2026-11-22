import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { BillingLifecycleService } from '../src/modules/billing/billing-lifecycle.service.js';
import { DomainEventsHandler } from '../src/modules/domains/domain-events.handler.js';
import { cleanupUsers, createStaff, createTestApp, customer, platformDb, staffToken } from './utils.js';

/** Domain orders: quote, order, pay, staff registration, refusal, and the clean-up of unpaid orders. The registrar is the test-mode mock. */
describe('Domain orders (e2e)', () => {
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
  const name = (label: string) => `${label}${tag}.${tld}`;
  const address = { line1: '1 Test Street', city: 'Pune', stateCode: '27', postalCode: '411001' };
  const order = (who: typeof alice, domain: string, years = 1) => http().post(api('domains/orders')).set(auth(who.token)).send({ domain, years });
  const quote = (who: typeof alice, domain: string, years = 1) => http().get(api('domains/quote')).set(auth(who.token)).query({ domain, years });
  const pay = (who: typeof alice, invoiceId: string) => http().post(api(`invoices/${invoiceId}/pay`)).set(auth(who.token)).send({});
  const rowOf = (domain: string) => db.domain.findFirstOrThrow({ where: { name: domain }, include: { orderInvoice: true } });

  beforeAll(async () => {
    app = await createTestApp();
    db = platformDb();
    events = app.get(DomainEventsHandler);
    lifecycle = app.get(BillingLifecycleService);
    alice = await customer(app, db, 'dord-a');
    bob = await customer(app, db, 'dord-b');
    const sa = await createStaff(db, 'SUPER_ADMIN', 'dordsa');
    const agent = await createStaff(db, 'SUPPORT_AGENT', 'dordagent');
    adminId = sa.id;
    emails.push(alice.email, bob.email, sa.email, agent.email);
    [admin, reader] = await Promise.all([staffToken(app, db, sa), staffToken(app, db, agent)]);
    await http().post(api('organisation/addresses')).set(auth(alice.token)).send(address).expect(201);
    await http().post(api('organisation/addresses')).set(auth(bob.token)).send(address).expect(201);
    await db.tldPrice.create({ data: { tld, registerPrice: '800.00', renewPrice: '1000.00', transferPrice: '700.00' } });
  });

  afterAll(async () => {
    const tenantIds = [alice?.tenantId, bob?.tenantId].filter(Boolean) as string[];
    await db.notification.deleteMany({ where: { type: { in: ['domain.task'] }, title: { contains: tag } } });
    await db.domain.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.payment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.invoice.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.outboxEvent.deleteMany({ where: { type: 'domain.registration_requested', tenantId: { in: tenantIds } } });
    await db.tldPrice.deleteMany({ where: { tld } });
    await cleanupUsers(db, emails);
    await app.close();
  });

  describe('quote', () => {
    it('needs a sign-in', async () => {
      await http().get(api('domains/quote')).query({ domain: name('q'), years: 1 }).expect(401);
      await http().get(api('domains')).expect(401);
    });

    it('prices a free name, including the renewal for extra years', async () => {
      const one = (await quote(alice, name('quote')).expect(200)).body;
      expect(one).toMatchObject({ domain: name('quote'), years: 1, currency: 'INR', registerPrice: 800, renewPrice: 1000 });
      expect(Number(one.subtotal)).toBe(800);
      const three = (await quote(alice, name('quote'), 3).expect(200)).body;
      expect(Number(three.subtotal)).toBe(800 + 2 * 1000);
    });

    it('refuses what cannot be ordered, with a reason', async () => {
      expect((await quote(alice, 'nodots').expect(400)).body.error.code).toBe('INVALID_DOMAIN');
      expect((await quote(alice, `acme${tag}.nosuchending`).expect(400)).body.error.code).toBe('TLD_NOT_SOLD');
      expect((await quote(alice, name('taken')).expect(409)).body.error.code).toBe('DOMAIN_UNAVAILABLE');
      expect((await quote(alice, name('registrarfail')).expect(502)).body.error.code).toBe('REGISTRAR_UNAVAILABLE');
      await quote(alice, name('years'), 0).expect(400);
      await quote(alice, name('years'), 6).expect(400);
    });

    it('does not offer an ending that is switched off', async () => {
      await db.tldPrice.update({ where: { tld }, data: { isActive: false } });
      expect((await quote(alice, name('off')).expect(400)).body.error.code).toBe('TLD_NOT_SOLD');
      await db.tldPrice.update({ where: { tld }, data: { isActive: true } });
    });
  });

  describe('ordering and cancelling', () => {
    it('creates an unpaid invoice and a pending domain that match the quote', async () => {
      const q = (await quote(alice, name('first')).expect(200)).body;
      const r = await order(alice, name('first')).expect(201);
      expect(r.body.domain).toMatchObject({ name: name('first'), tld, status: 'PENDING_REGISTRATION', stage: 'AWAITING_PAYMENT', years: 1 });
      expect(r.body.invoice.status).toBe('ISSUED');
      expect(r.body.invoice.subscriptionId).toBeNull();
      expect(Number(r.body.invoice.total)).toBe(Number(q.total));
      const items = await db.invoiceItem.findMany({ where: { invoiceId: r.body.invoice.id } });
      expect(items).toHaveLength(1);
      expect(items[0]!.description).toBe(`Domain registration - ${name('first')} (1 year)`);
      expect((await rowOf(name('first'))).orderInvoiceId).toBe(r.body.invoice.id);
      expect(await db.auditLog.count({ where: { action: 'domain.order', entityId: r.body.domain.id } })).toBe(1);
    });

    it('is priced from the years chosen', async () => {
      const r = await order(alice, name('years3'), 3).expect(201);
      expect(r.body.domain.years).toBe(3);
      expect(Number(r.body.invoice.subtotal)).toBe(2800);
    });

    it('lets only one live order hold a name, across organisations', async () => {
      expect((await order(alice, name('first')).expect(409)).body.error.code).toBe('DOMAIN_UNAVAILABLE');
      expect((await order(bob, name('first')).expect(409)).body.error.code).toBe('DOMAIN_UNAVAILABLE');
      expect((await order(bob, name('FIRST').toUpperCase()).expect(409)).body.error.code).toBe('DOMAIN_UNAVAILABLE');
    });

    it('two simultaneous orders for one name produce one order', async () => {
      const results = await Promise.all([order(alice, name('race')), order(bob, name('race'))]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await db.domain.count({ where: { name: name('race') } })).toBe(1);
    });

    it('shows each organisation only its own domains', async () => {
      const a = (await http().get(api('domains')).set(auth(alice.token)).expect(200)).body.data as { name: string; stage: string }[];
      expect(a.map((d) => d.name)).toEqual(expect.arrayContaining([name('first'), name('years3')]));
      const b = (await http().get(api('domains')).set(auth(bob.token)).expect(200)).body.data as { name: string }[];
      expect(b.some((d) => d.name === name('first'))).toBe(false);
    });

    it('needs a billing address', async () => {
      const carol = await customer(app, db, 'dord-c');
      emails.push(carol.email);
      expect((await order(carol, name('noaddr')).expect(409)).body.error.code).toBe('NO_BILLING_ADDRESS');
      await db.invoice.deleteMany({ where: { tenantId: carol.tenantId } });
    });

    it('cancelling an unpaid order voids its invoice and frees the name', async () => {
      const row = await rowOf(name('years3'));
      await http().post(api(`domains/${row.id}/cancel`)).set(auth(bob.token)).expect(404); // not bob's
      const r = await http().post(api(`domains/${row.id}/cancel`)).set(auth(alice.token)).expect(200);
      expect(r.body.stage).toBe('CANCELLED');
      const after = await rowOf(name('years3'));
      expect(after.status).toBe('CANCELLED');
      expect(after.orderInvoice!.status).toBe('VOID');
      await http().post(api(`domains/${row.id}/cancel`)).set(auth(alice.token)).expect(409); // already cancelled
      await order(bob, name('years3')).expect(201); // somebody else can have it now
    });
  });

  describe('payment, registration and refusal', () => {
    let domainId: string;
    let invoiceId: string;

    it('payment turns the order into a task for staff', async () => {
      const r = await order(alice, name('paid')).expect(201);
      domainId = r.body.domain.id;
      invoiceId = r.body.invoice.id;
      expect(await db.outboxEvent.count({ where: { type: 'domain.registration_requested', aggregateId: domainId } })).toBe(0); // not before payment

      const paid = await pay(alice, invoiceId).expect(200);
      expect(paid.body.status).toBe('SUCCEEDED');
      expect(await db.outboxEvent.count({ where: { type: 'domain.registration_requested', aggregateId: domainId } })).toBe(1);
      const listed = (await http().get(api('domains')).set(auth(alice.token)).expect(200)).body.data as { id: string; stage: string }[];
      expect(listed.find((d) => d.id === domainId)!.stage).toBe('REGISTERING');
    });

    it('a paid order cannot be cancelled by the customer', async () => {
      expect((await http().post(api(`domains/${domainId}/cancel`)).set(auth(alice.token)).expect(409)).body.error.code).toBe('DOMAIN_NOT_CANCELLABLE');
    });

    it('the worker event tells staff who can register domains, once per delivery', async () => {
      const event = await db.outboxEvent.findFirstOrThrow({ where: { type: 'domain.registration_requested', aggregateId: domainId } });
      expect(await events.handle('domain.registration_requested', event.payload)).toBe(true);
      const notices = await db.notification.findMany({ where: { type: 'domain.task', title: { contains: tag } } });
      expect(notices.length).toBeGreaterThan(0);
      expect(notices.every((n) => n.link === '/domains')).toBe(true);
      expect(notices.some((n) => n.userId === adminId)).toBe(true);
      expect(await events.handle('subscription.activated', event.payload)).toBe(false); // not ours
    });

    it('staff see it under "needs action", and only people with domains:write may act', async () => {
      const r = await http().get(api('admin/domains')).query({ needsAction: 'true', search: tag }).set(auth(admin)).expect(200);
      expect(r.body.data.map((d: { id: string }) => d.id)).toContain(domainId);
      expect(r.body.data[0].orderInvoice.status).toBe('PAID');
      await http().get(api('admin/domains')).set(auth(reader)).expect(200); // domains:read
      await http().get(api('admin/domains')).set(auth(alice.token)).expect(403);
      await http().post(api(`admin/domains/${domainId}/complete`)).set(auth(reader)).send({}).expect(403);
      await http().post(api(`admin/domains/${domainId}/cannot-register`)).set(auth(reader)).send({ reason: 'No' }).expect(403);
    });

    it('an unpaid order is not a task', async () => {
      const r = await order(alice, name('unpaid')).expect(201);
      const waiting = await http().get(api('admin/domains')).query({ needsAction: 'true', search: name('unpaid') }).set(auth(admin)).expect(200);
      expect(waiting.body.data).toHaveLength(0);
      expect((await http().post(api(`admin/domains/${r.body.domain.id}/complete`)).set(auth(admin)).send({}).expect(409)).body.error.code).toBe('DOMAIN_NOT_PAID');
      expect((await http().post(api(`admin/domains/${r.body.domain.id}/cannot-register`)).set(auth(admin)).send({ reason: 'Not possible' }).expect(409)).body.error.code).toBe('DOMAIN_NOT_PAID');
    });

    it('marking it registered makes it Active, with an expiry, and tells the customer', async () => {
      await http().post(api(`admin/domains/${domainId}/complete`)).set(auth(admin)).send({ expiresAt: '2020-01-01' }).expect(400); // in the past
      await http().post(api(`admin/domains/${domainId}/complete`)).set(auth(admin)).send({ expiresAt: 'soon' }).expect(400);
      const r = await http().post(api(`admin/domains/${domainId}/complete`)).set(auth(admin)).send({ registrarRef: 'REG-123' }).expect(200);
      expect(r.body.status).toBe('ACTIVE');
      const row = await rowOf(name('paid'));
      expect(row.registrarRef).toBe('REG-123');
      expect(row.registeredAt).not.toBeNull();
      const years = (row.expiresAt!.getTime() - row.registeredAt!.getTime()) / (365 * 86_400_000);
      expect(years).toBeGreaterThan(0.99);
      expect(years).toBeLessThan(1.01);

      const mine = (await http().get(api('domains')).set(auth(alice.token)).expect(200)).body.data as { id: string; stage: string; expiresAt: string }[];
      expect(mine.find((d) => d.id === domainId)).toMatchObject({ stage: 'ACTIVE' });
      expect(await db.notification.count({ where: { tenantId: alice.tenantId, type: 'domain.registered' } })).toBe(1);
      const mail = await db.outboxEvent.findFirst({ where: { type: 'email.send', payload: { path: ['template'], equals: 'domain-registered' }, tenantId: alice.tenantId } });
      expect(mail).not.toBeNull();
      expect(await db.auditLog.count({ where: { action: 'domain.registered', entityId: domainId, actorId: adminId } })).toBe(1);
      expect((await http().post(api(`admin/domains/${domainId}/complete`)).set(auth(admin)).send({}).expect(409)).body.error.code).toBe('DOMAIN_NOT_WAITING');
    });

    it('two staff completing at once register it once', async () => {
      const r = await order(alice, name('both')).expect(201);
      await pay(alice, r.body.invoice.id).expect(200);
      const res = await Promise.all([1, 2].map(() => http().post(api(`admin/domains/${r.body.domain.id}/complete`)).set(auth(admin)).send({})));
      expect(res.map((x) => x.status).sort()).toEqual([200, 409]);
      expect(await db.notification.count({ where: { tenantId: alice.tenantId, type: 'domain.registered', title: { contains: name('both') } } })).toBe(1);
    });

    it('a name that could not be registered is marked failed, the customer is told why, and the name is free again', async () => {
      const r = await order(bob, name('refused')).expect(201);
      await pay(bob, r.body.invoice.id).expect(200);
      await http().post(api(`admin/domains/${r.body.domain.id}/cannot-register`)).set(auth(admin)).send({ reason: '' }).expect(400);
      const done = await http().post(api(`admin/domains/${r.body.domain.id}/cannot-register`)).set(auth(admin)).send({ reason: 'The registry refused this name.' }).expect(200);
      expect(done.body.status).toBe('FAILED');
      const mine = (await http().get(api('domains')).set(auth(bob.token)).expect(200)).body.data as { name: string; stage: string; failureReason: string }[];
      expect(mine.find((d) => d.name === name('refused'))).toMatchObject({ stage: 'FAILED', failureReason: 'The registry refused this name.' });
      const note = await db.notification.findFirstOrThrow({ where: { tenantId: bob.tenantId, type: 'domain.failed' } });
      expect(note.body).toContain('The registry refused this name.');
      expect(note.body).toContain('refund');
      await order(alice, name('refused')).expect(201); // released
    });
  });

  describe('clean-up of unpaid orders', () => {
    it('withdraws an order left unpaid for too long, but never one that has been paid', async () => {
      const stale = await order(alice, name('stale')).expect(201);
      const fresh = await order(alice, name('fresh')).expect(201);
      const paid = await order(alice, name('stalepaid')).expect(201);
      await pay(alice, paid.body.invoice.id).expect(200);
      const longAgo = new Date(Date.now() - 40 * 86_400_000);
      await db.domain.updateMany({ where: { id: { in: [stale.body.domain.id, paid.body.domain.id] } }, data: { createdAt: longAgo } });

      await lifecycle.run(new Date());
      expect((await rowOf(name('stale'))).status).toBe('CANCELLED');
      expect((await rowOf(name('stale'))).orderInvoice!.status).toBe('VOID');
      expect((await rowOf(name('fresh'))).status).toBe('PENDING_REGISTRATION');
      expect((await rowOf(name('stalepaid'))).status).toBe('PENDING_REGISTRATION');
      expect(await db.notification.count({ where: { tenantId: alice.tenantId, type: 'order.expired', title: { contains: name('stale') } } })).toBe(1);
      void fresh;
    });
  });
});
