import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { BillingLifecycleService } from '../src/modules/billing/billing-lifecycle.service.js';
import { DomainEventsHandler } from '../src/modules/domains/domain-events.handler.js';
import { addYears } from '../src/modules/domains/domain-rules.js';
import { cleanupUsers, createStaff, createTestApp, customer, platformDb, staffToken } from './utils.js';

const DAY = 86_400_000;

/** Domain renewals and expiry: ask, pay, staff renew, decline, and the reminders and expiry the lifecycle job sends. */
describe('Domain renewals (e2e)', () => {
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
  let reader: string;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = (p: string) => `/api/v1/${p}`;
  const address = { line1: '1 Test Street', city: 'Pune', stateCode: '27', postalCode: '411001' };
  const renew = (who: typeof alice, id: string, years = 1) => http().post(api(`domains/${id}/renew`)).set(auth(who.token)).send({ years });
  const pay = (who: typeof alice, invoiceId: string) => http().post(api(`invoices/${invoiceId}/pay`)).set(auth(who.token)).send({});
  const complete = (id: string, body: object = {}, token = admin) => http().post(api(`admin/domains/${id}/renewal/complete`)).set(auth(token)).send(body);
  const row = (id: string) => db.domain.findUniqueOrThrow({ where: { id }, include: { renewals: { orderBy: { requestedAt: 'desc' } } } });
  /** A registered domain for `who`, ending `days` from now (negative: already ended). */
  async function domain(who: typeof alice, label: string, days: number, over: { status?: 'ACTIVE' | 'EXPIRED' | 'PENDING_REGISTRATION'; tld?: string } = {}) {
    const t = over.tld ?? tld;
    return db.domain.create({ data: { tenantId: who.tenantId, name: `${label}${tag}.${t}`, tld: t, status: over.status ?? 'ACTIVE', registeredAt: new Date(Date.now() - 300 * DAY), expiresAt: new Date(Date.now() + days * DAY) } });
  }

  beforeAll(async () => {
    app = await createTestApp();
    db = platformDb();
    events = app.get(DomainEventsHandler);
    lifecycle = app.get(BillingLifecycleService);
    alice = await customer(app, db, 'drn-a');
    bob = await customer(app, db, 'drn-b');
    const sa = await createStaff(db, 'SUPER_ADMIN', 'drnsa');
    const agent = await createStaff(db, 'SUPPORT_AGENT', 'drnagent');
    emails.push(alice.email, bob.email, sa.email, agent.email);
    [admin, reader] = await Promise.all([staffToken(app, db, sa), staffToken(app, db, agent)]);
    await http().post(api('organisation/addresses')).set(auth(alice.token)).send(address).expect(201);
    await http().post(api('organisation/addresses')).set(auth(bob.token)).send(address).expect(201);
    await db.tldPrice.create({ data: { tld, registerPrice: '800.00', renewPrice: '1000.00', transferPrice: '700.00' } });
  });

  afterAll(async () => {
    const tenantIds = [alice?.tenantId, bob?.tenantId].filter(Boolean) as string[];
    await db.notification.deleteMany({ where: { type: 'domain.task', title: { contains: tag } } });
    await db.domainRenewal.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.domain.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.payment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.invoice.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.outboxEvent.deleteMany({ where: { tenantId: { in: tenantIds }, type: { in: ['domain.renewal_requested', 'domain.registration_requested'] } } });
    await db.tldPrice.deleteMany({ where: { tld: { startsWith: `t${tag}` } } });
    await cleanupUsers(db, emails);
    await app.close();
  });

  describe('asking to renew', () => {
    it('needs a sign-in and a registered domain of your own', async () => {
      const d = await domain(alice, 'own', 100);
      await http().post(api(`domains/${d.id}/renew`)).send({ years: 1 }).expect(401);
      await renew(bob, d.id).expect(404);
      await renew(alice, randomUUID()).expect(404);
      const pending = await domain(alice, 'pendingreg', 0, { status: 'PENDING_REGISTRATION' });
      expect((await renew(alice, pending.id).expect(409)).body.error.code).toBe('DOMAIN_NOT_RENEWABLE');
    });

    it('checks the years and the price', async () => {
      const d = await domain(alice, 'years', 100);
      await renew(alice, d.id, 0).expect(400);
      await renew(alice, d.id, 6).expect(400);
      const noPrice = await domain(alice, 'noprice', 100, { tld: `t${tag}none` });
      expect((await renew(alice, noPrice.id).expect(409)).body.error.code).toBe('RENEWAL_PRICE_UNAVAILABLE');
    });

    it('is charged at the renewal price for every year, with an invoice and one waiting renewal', async () => {
      const d = await domain(alice, 'price', 100);
      const r = await renew(alice, d.id, 2).expect(201);
      expect(r.body.invoice.status).toBe('ISSUED');
      expect(r.body.invoice.subscriptionId).toBeNull();
      expect(Number(r.body.invoice.subtotal)).toBe(2000); // 2 x 1000, not the register price
      const items = await db.invoiceItem.findMany({ where: { invoiceId: r.body.invoice.id } });
      expect(items[0]!.description).toBe(`Domain renewal - ${d.name} (2 years)`);
      expect((await row(d.id)).renewals[0]).toMatchObject({ years: 2, status: 'PENDING', invoiceId: r.body.invoice.id });
      expect(await db.auditLog.count({ where: { action: 'domain.renewal_requested', entityId: d.id } })).toBe(1);

      const listed = (await http().get(api('domains')).set(auth(alice.token)).expect(200)).body.data as { id: string; renewal: { stage: string; years: number } | null }[];
      expect(listed.find((x) => x.id === d.id)!.renewal).toMatchObject({ stage: 'AWAITING_PAYMENT', years: 2 });
      expect((await renew(alice, d.id).expect(409)).body.error.code).toBe('RENEWAL_PENDING');
    });

    it('quotes the renewal before anything is created, with the same rules', async () => {
      const d = await domain(alice, 'quote', 100);
      const q = (await http().get(api(`domains/${d.id}/renew/quote`)).query({ years: 3 }).set(auth(alice.token)).expect(200)).body;
      expect(q).toMatchObject({ domain: d.name, years: 3, currency: 'INR', renewPrice: 1000 });
      expect(Number(q.subtotal)).toBe(3000);
      expect(Math.abs(new Date(q.newExpiry).getTime() - addYears(d.expiresAt!, 3).getTime())).toBeLessThan(1000);
      expect(await db.domainRenewal.count({ where: { domainId: d.id } })).toBe(0); // only a quote
      await http().get(api(`domains/${d.id}/renew/quote`)).query({ years: 3 }).set(auth(bob.token)).expect(404);
      await http().get(api(`domains/${d.id}/renew/quote`)).query({ years: 9 }).set(auth(alice.token)).expect(400);
      await http().get(api(`domains/${d.id}/renew/quote`)).query({ years: 1 }).expect(401);
    });

    it('two clicks at once make one renewal', async () => {
      const d = await domain(alice, 'race', 100);
      const res = await Promise.all([renew(alice, d.id), renew(alice, d.id)]);
      expect(res.map((x) => x.status).sort()).toEqual([201, 409]);
      expect(await db.domainRenewal.count({ where: { domainId: d.id } })).toBe(1);
    });

    it('does not let a domain be paid more than ten years ahead', async () => {
      const d = await domain(alice, 'far', 9 * 365);
      expect((await renew(alice, d.id, 5).expect(400)).body.error.code).toBe('TERM_TOO_LONG');
      await renew(alice, d.id, 1).expect(201);
    });

    it('an unpaid renewal can be cancelled, which voids the invoice and allows a new one', async () => {
      const d = await domain(alice, 'cancel', 100);
      const r = await renew(alice, d.id).expect(201);
      await http().post(api(`domains/renewals/${r.body.renewal.id}/cancel`)).set(auth(bob.token)).expect(404);
      await http().post(api(`domains/renewals/${r.body.renewal.id}/cancel`)).set(auth(alice.token)).expect(200);
      const after = await row(d.id);
      expect(after.renewals[0]!.status).toBe('CANCELLED');
      expect((await db.invoice.findUniqueOrThrow({ where: { id: r.body.invoice.id } })).status).toBe('VOID');
      await http().post(api(`domains/renewals/${r.body.renewal.id}/cancel`)).set(auth(alice.token)).expect(409);
      await renew(alice, d.id).expect(201);
    });
  });

  describe('payment and staff', () => {
    it('a paid renewal becomes a task, staff renew it, and the end date moves on by the years paid', async () => {
      const d = await domain(alice, 'paid', 100);
      const r = await renew(alice, d.id, 2).expect(201);
      expect(await db.outboxEvent.count({ where: { type: 'domain.renewal_requested', aggregateId: d.id } })).toBe(0); // not before payment
      await complete(d.id).expect(409); // unpaid
      expect((await complete(d.id)).body.error.code).toBe('RENEWAL_NOT_PAID');

      await pay(alice, r.body.invoice.id).expect(200);
      const event = await db.outboxEvent.findFirstOrThrow({ where: { type: 'domain.renewal_requested', aggregateId: d.id } });
      expect(await events.handle('domain.renewal_requested', event.payload)).toBe(true);
      expect((await db.notification.findMany({ where: { type: 'domain.task', title: `Renew ${d.name}` } })).length).toBeGreaterThan(0);

      const listed = (await http().get(api('domains')).set(auth(alice.token)).expect(200)).body.data as { id: string; renewal: { stage: string } }[];
      expect(listed.find((x) => x.id === d.id)!.renewal.stage).toBe('RENEWING');
      await http().post(api(`domains/renewals/${r.body.renewal.id}/cancel`)).set(auth(alice.token)).expect(409); // paid

      const waiting = await http().get(api('admin/domains')).query({ needsAction: 'true', search: d.name }).set(auth(admin)).expect(200);
      expect(waiting.body.data.map((x: { id: string }) => x.id)).toContain(d.id);
      await http().get(api('admin/domains')).set(auth(reader)).expect(200);
      await complete(d.id, {}, reader).expect(403);

      const before = d.expiresAt!;
      await complete(d.id, { expiresAt: new Date(before.getTime() - DAY).toISOString() }).expect(400); // earlier than now ends
      const done = await complete(d.id, { registrarRef: 'RENEW-1' }).expect(200);
      expect(done.body.status).toBe('ACTIVE');
      const after = await row(d.id);
      expect(Math.abs(after.expiresAt!.getTime() - addYears(before, 2).getTime())).toBeLessThan(1000);
      expect(after.renewals[0]).toMatchObject({ status: 'DONE' });
      expect(after.renewals[0]!.completedAt).not.toBeNull();
      expect(after.registrarRef).toBe('RENEW-1');
      expect(after.reminderStage).toBe(0);
      expect(await db.notification.count({ where: { tenantId: alice.tenantId, type: 'domain.renewed', title: { contains: d.name } } })).toBe(1);
      expect(await db.outboxEvent.count({ where: { type: 'email.send', tenantId: alice.tenantId, payload: { path: ['template'], equals: 'domain-renewed' } } })).toBeGreaterThan(0);
      expect(await db.auditLog.count({ where: { action: 'domain.renewed', entityId: d.id } })).toBe(1);
      expect((await complete(d.id)).body.error.code).toBe('RENEWAL_NOT_WAITING');
      await renew(alice, d.id).expect(201); // can renew again
    });

    it('two staff completing at once renew it once', async () => {
      const d = await domain(alice, 'both', 100);
      const r = await renew(alice, d.id).expect(201);
      await pay(alice, r.body.invoice.id).expect(200);
      const res = await Promise.all([complete(d.id), complete(d.id)]);
      expect(res.map((x) => x.status).sort()).toEqual([200, 409]);
      expect(Math.abs((await row(d.id)).expiresAt!.getTime() - addYears(d.expiresAt!, 1).getTime())).toBeLessThan(1000);
    });

    it('a renewal staff cannot do is closed with a reason, the domain is left as it was, and the customer is told', async () => {
      const d = await domain(bob, 'refused', 100);
      const r = await renew(bob, d.id).expect(201);
      await pay(bob, r.body.invoice.id).expect(200);
      await http().post(api(`admin/domains/${d.id}/renewal/cannot-renew`)).set(auth(admin)).send({ reason: '' }).expect(400);
      await http().post(api(`admin/domains/${d.id}/renewal/cannot-renew`)).set(auth(reader)).send({ reason: 'No' }).expect(403);
      await http().post(api(`admin/domains/${d.id}/renewal/cannot-renew`)).set(auth(admin)).send({ reason: 'The registrar is closed for this ending.' }).expect(200);
      const after = await row(d.id);
      expect(after.expiresAt!.getTime()).toBe(d.expiresAt!.getTime());
      expect(after.status).toBe('ACTIVE');
      expect(after.renewals[0]).toMatchObject({ status: 'CANCELLED', failureReason: 'The registrar is closed for this ending.' });
      const note = await db.notification.findFirstOrThrow({ where: { tenantId: bob.tenantId, type: 'domain.renewal_failed' } });
      expect(note.body).toContain('refund');
      await renew(bob, d.id).expect(201);
    });

    it('a domain that has already expired can still be renewed, and the new end date counts from today', async () => {
      const d = await domain(alice, 'lapsed', -10, { status: 'EXPIRED' });
      const r = await renew(alice, d.id, 1).expect(201);
      await pay(alice, r.body.invoice.id).expect(200);
      await complete(d.id).expect(200);
      const after = await row(d.id);
      expect(after.status).toBe('ACTIVE');
      expect(Math.abs(after.expiresAt!.getTime() - addYears(new Date(), 1).getTime())).toBeLessThan(60_000);
    });
  });

  describe('expiry reminders and expiry', () => {
    const stage = async (id: string) => (await row(id)).reminderStage;
    const notices = (name: string, type: string) => db.notification.count({ where: { tenantId: alice.tenantId, type, title: { contains: name } } });
    const mails = (name: string) => db.outboxEvent.count({ where: { type: 'email.send', tenantId: alice.tenantId, AND: [{ payload: { path: ['template'], equals: 'domain-expiring' } }, { payload: { path: ['data', 'domain'], equals: name } }] } });

    it('warns at thirty days, then seven, once each, and does not nag', async () => {
      const d = await domain(alice, 'warn', 20);
      await lifecycle.run(new Date());
      expect(await stage(d.id)).toBe(1);
      expect(await notices(d.name, 'domain.expiring')).toBe(1);
      expect(await mails(d.name)).toBe(1);
      await lifecycle.run(new Date()); // again: nothing new
      expect(await notices(d.name, 'domain.expiring')).toBe(1);
      expect(await mails(d.name)).toBe(1);

      await db.domain.update({ where: { id: d.id }, data: { expiresAt: new Date(Date.now() + 5 * DAY) } });
      await lifecycle.run(new Date());
      expect(await stage(d.id)).toBe(2);
      expect(await notices(d.name, 'domain.expiring')).toBe(2);
      expect((await row(d.id)).status).toBe('ACTIVE');
    });

    it('leaves a domain alone when it is more than thirty days from ending', async () => {
      const d = await domain(alice, 'far2', 90);
      await lifecycle.run(new Date());
      expect(await stage(d.id)).toBe(0);
      expect(await notices(d.name, 'domain.expiring')).toBe(0);
    });

    it('marks a domain expired when its date passes, and tells the customer', async () => {
      const d = await domain(alice, 'ended', -1);
      await lifecycle.run(new Date());
      const after = await row(d.id);
      expect(after.status).toBe('EXPIRED');
      expect(after.reminderStage).toBe(3);
      expect(await notices(d.name, 'domain.expired')).toBe(1);
      await lifecycle.run(new Date());
      expect(await notices(d.name, 'domain.expired')).toBe(1);
    });

    it('does not expire a domain whose renewal is paid and only waiting for staff', async () => {
      const d = await domain(alice, 'waitstaff', 3);
      const r = await renew(alice, d.id).expect(201);
      await pay(alice, r.body.invoice.id).expect(200);
      await db.domain.update({ where: { id: d.id }, data: { expiresAt: new Date(Date.now() - DAY) } });
      await lifecycle.run(new Date());
      expect((await row(d.id)).status).toBe('ACTIVE');
      await complete(d.id).expect(200); // staff catch up
      const after = await row(d.id);
      expect(after.status).toBe('ACTIVE');
      expect(after.reminderStage).toBe(0);
    });

    it('does not touch domains that are not registered yet', async () => {
      const d = await domain(alice, 'unreg', 5, { status: 'PENDING_REGISTRATION' });
      await lifecycle.run(new Date());
      expect(await stage(d.id)).toBe(0);
    });
  });
});
