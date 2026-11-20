import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { cleanupUsers, createStaff, createTestApp, customer, platformDb, staffToken } from './utils.js';

/** Payments recorded by hand: a bank transfer, UPI, cheque or cash that reached the business outside the checkout. */
describe('Manual payments (e2e)', () => {
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  const tag = randomUUID().slice(0, 8);
  const emails: string[] = [];
  let alice: Awaited<ReturnType<typeof customer>>;
  let finance: string;
  let agent: string;
  let superAdmin: string;
  let planId: string;
  const today = new Date().toISOString().slice(0, 10);

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = (p: string) => `/api/v1/${p}`;
  const address = { line1: '1 Test Street', city: 'Pune', stateCode: '27', postalCode: '411001' };
  const bank = (over: object = {}) => ({ method: 'BANK_TRANSFER', reference: `UTR${tag}`, receivedOn: today, ...over });
  const record = (invoiceId: string, body: object, token = finance) => http().post(api(`admin/invoices/${invoiceId}/payments`)).set(auth(token)).send(body);
  /** A fresh unpaid invoice (and a pending subscription) for alice. */
  async function invoice() {
    const o = await http().post(api('orders')).set(auth(alice.token)).send({ planId, billingCycle: 'YEARLY' }).expect(201);
    return { id: o.body.invoice.id as string, subscriptionId: o.body.subscriptionId as string, total: o.body.invoice.total as string };
  }
  const inv = (id: string) => db.invoice.findUniqueOrThrow({ where: { id }, include: { payments: true } });

  beforeAll(async () => {
    app = await createTestApp();
    db = platformDb();
    alice = await customer(app, db, 'man-a');
    const fin = await createStaff(db, 'FINANCE_ADMIN', 'manfin');
    const ag = await createStaff(db, 'SUPPORT_AGENT', 'managent');
    const sa = await createStaff(db, 'SUPER_ADMIN', 'mansa');
    emails.push(alice.email, fin.email, ag.email, sa.email);
    [finance, agent, superAdmin] = await Promise.all([staffToken(app, db, fin), staffToken(app, db, ag), staffToken(app, db, sa)]);
    await http().post(api('organisation/addresses')).set(auth(alice.token)).send(address).expect(201);
    const category = await db.productCategory.upsert({ where: { slug: 'hosting' }, update: {}, create: { slug: 'hosting', name: 'Hosting' } });
    const product = await db.product.create({ data: { categoryId: category.id, slug: `t-man-${tag}`, name: `Man ${tag}`, type: 'WEB_HOSTING', status: 'PUBLISHED' } });
    const plan = await db.plan.create({ data: { productId: product.id, slug: `p-${tag}`, name: `Plan ${tag}`, status: 'PUBLISHED', isSample: true } });
    await db.pricingVersion.create({ data: { planId: plan.id, billingCycle: 'YEARLY', price: '1000.00', renewalPrice: '1000.00' } });
    planId = plan.id;
  });

  afterAll(async () => {
    const tenantIds = [alice?.tenantId].filter(Boolean) as string[];
    await db.creditNote.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.refund.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.payment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.invoice.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.subscription.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.outboxEvent.deleteMany({ where: { tenantId: { in: tenantIds }, type: 'subscription.activated' } });
    await db.pricingVersion.deleteMany({ where: { planId } });
    await db.plan.deleteMany({ where: { id: planId } });
    await db.product.deleteMany({ where: { slug: `t-man-${tag}` } });
    await cleanupUsers(db, emails);
    await app.close();
  });

  it('needs billing write access', async () => {
    const i = await invoice();
    await http().post(api(`admin/invoices/${i.id}/payments`)).send(bank()).expect(401);
    await record(i.id, bank(), alice.token).expect(403);
    await record(i.id, bank(), agent).expect(403);
    expect((await inv(i.id)).status).toBe('ISSUED');
  });

  it('validates what it is given', async () => {
    const i = await invoice();
    await record(i.id, bank({ method: 'BITCOIN' })).expect(400);
    expect((await record(i.id, bank({ reference: '' })).expect(400)).body.error.message).toContain('reference');
    expect((await record(i.id, { method: 'UPI', receivedOn: today }).expect(400)).body.error.message).toContain('reference');
    await record(i.id, bank({ receivedOn: 'yesterday' })).expect(400);
    await record(i.id, bank({ receivedOn: '2026-02-31' })).expect(400); // not a real day
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    expect((await record(i.id, bank({ receivedOn: future })).expect(400)).body.error.message).toContain('future');
    expect((await record(i.id, bank({ receivedOn: '2000-01-01' })).expect(400)).body.error.message).toContain('before the invoice');
    await record(i.id, bank({ idempotencyKey: 'not-a-uuid' })).expect(400);
    expect((await inv(i.id)).payments).toHaveLength(0);
  });

  it('records the whole payment: the invoice is paid, the service starts, and the customer is told', async () => {
    const i = await invoice();
    const r = await record(i.id, bank({ reference: `UTR-A-${tag}`, note: 'HDFC, 19 Nov' })).expect(200);
    expect(r.body.status).toBe('PAID');
    const after = await inv(i.id);
    expect(Number(after.amountPaid)).toBe(Number(after.total));
    expect(after.paidAt).not.toBeNull();
    expect(after.payments).toHaveLength(1);
    expect(after.payments[0]).toMatchObject({ provider: 'MANUAL', status: 'SUCCEEDED', method: 'bank_transfer', providerPaymentId: `BANK_TRANSFER:UTR-A-${tag}`.toUpperCase() });
    expect(after.payments[0]!.verifiedAt!.toISOString().slice(0, 10)).toBe(today); // when the money arrived
    expect((await db.subscription.findUniqueOrThrow({ where: { id: i.subscriptionId } })).status).toBe('ACTIVE');
    expect(await db.outboxEvent.count({ where: { type: 'subscription.activated', aggregateId: i.subscriptionId } })).toBe(1);
    expect(await db.notification.count({ where: { tenantId: alice.tenantId, type: 'payment.succeeded', link: `/invoices/${i.id}` } })).toBe(1);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'payment.manual_recorded', entityId: i.id } });
    expect(audit.actorId).not.toBeNull();
    expect(audit.metadata).toMatchObject({ method: 'BANK_TRANSFER', reference: `UTR-A-${tag}`, note: 'HDFC, 19 Nov', receivedOn: today });
    // The customer sees it on their own invoice.
    const mine = await http().get(api(`invoices/${i.id}`)).set(auth(alice.token)).expect(200);
    expect(mine.body.status).toBe('PAID');
  });

  it('refuses a second payment on a paid invoice, and one on a voided invoice', async () => {
    const paid = await invoice();
    await record(paid.id, bank({ reference: `UTR-B-${tag}` })).expect(200);
    expect((await record(paid.id, bank({ reference: `UTR-B2-${tag}` })).expect(409)).body.error.code).toBe('INVOICE_NOT_PAYABLE');
    const voided = await invoice();
    await http().post(api(`admin/invoices/${voided.id}/void`)).set(auth(superAdmin)).send({ reason: 'Customer cancelled' }).expect(200);
    expect((await record(voided.id, bank({ reference: `UTR-C-${tag}` })).expect(409)).body.error.code).toBe('INVOICE_NOT_PAYABLE');
    await record(randomUUID(), bank()).expect(404);
  });

  it('never records the same bank reference twice', async () => {
    const a = await invoice();
    const b = await invoice();
    await record(a.id, bank({ reference: `UTR-D-${tag}` })).expect(200);
    expect((await record(b.id, bank({ reference: ` utr-d-${tag} ` })).expect(409)).body.error.code).toBe('REFERENCE_ALREADY_RECORDED'); // case and spaces do not matter
    expect((await inv(b.id)).payments).toHaveLength(0);
    expect((await inv(b.id)).status).toBe('ISSUED');
    // The same number under a different method is a different payment.
    await record(b.id, bank({ method: 'UPI', reference: `UTR-D-${tag}` })).expect(200);
  });

  it('one form submission records one payment, even if it is sent twice', async () => {
    const i = await invoice();
    const key = randomUUID();
    await record(i.id, bank({ reference: `UTR-E-${tag}`, idempotencyKey: key })).expect(200);
    const again = await record(i.id, bank({ reference: `UTR-E-${tag}`, idempotencyKey: key })).expect(200);
    expect(again.body.status).toBe('PAID');
    expect((await inv(i.id)).payments).toHaveLength(1);
  });

  it('two staff recording at once pay the invoice once', async () => {
    const i = await invoice();
    const res = await Promise.all([record(i.id, bank({ reference: `UTR-F1-${tag}` })), record(i.id, bank({ reference: `UTR-F2-${tag}` }), superAdmin)]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    const after = await inv(i.id);
    expect(after.payments.filter((p) => p.status === 'SUCCEEDED')).toHaveLength(1);
    expect(await db.outboxEvent.count({ where: { type: 'subscription.activated', aggregateId: (await db.invoice.findUniqueOrThrow({ where: { id: i.id } })).subscriptionId! } })).toBe(1);
  });

  it('cash and "other" need no reference', async () => {
    const i = await invoice();
    await record(i.id, { method: 'CASH', receivedOn: today }).expect(200);
    const p = (await inv(i.id)).payments[0]!;
    expect(p).toMatchObject({ provider: 'MANUAL', method: 'cash', providerPaymentId: null });
  });

  it('bank details on the company profile are validated, and reach the invoice so customers can pay by transfer', async () => {
    const original = await db.systemSetting.findUnique({ where: { key: 'company.profile' } });
    try {
      const current = (await http().get(api('admin/settings/company')).set(auth(superAdmin)).expect(200)).body;
      const save = (bank: object) => http().put(api('admin/settings/company')).set(auth(superAdmin)).send({ ...current, bank });
      const good = { accountName: 'Ciril Info Pvt Ltd', bankName: 'HDFC Bank', accountNumber: '50100123456789', ifsc: 'hdfc0001234', upiId: 'cirilinfo@hdfcbank' };
      await save({ ...good, ifsc: 'NOTANIFSC' }).expect(400);
      await save({ ...good, accountNumber: '12AB' }).expect(400);
      await save({ ...good, upiId: 'no-at-sign' }).expect(400);
      const saved = await save(good).expect(200);
      expect(saved.body.bank).toMatchObject({ ifsc: 'HDFC0001234', accountNumber: '50100123456789' }); // IFSC is stored in capitals

      const i = await invoice();
      const snapshot = (await inv(i.id)).billingSnapshot as { seller?: { bank?: Record<string, string> } };
      expect(snapshot.seller?.bank).toMatchObject({ bankName: 'HDFC Bank', upiId: 'cirilinfo@hdfcbank' });
      // The customer's own copy carries it, so their invoice page can show how to pay.
      const mine = await http().get(api(`invoices/${i.id}`)).set(auth(alice.token)).expect(200);
      expect(mine.body.billingSnapshot.seller.bank.accountNumber).toBe('50100123456789');
      // The public website never does.
      expect(JSON.stringify((await http().get(api('public/site')).expect(200)).body)).not.toContain('50100123456789');
    } finally {
      if (original) await db.systemSetting.update({ where: { key: 'company.profile' }, data: { value: original.value as never } });
    }
  });

  it('a payment recorded by hand can be refunded, without asking the gateway, and a credit note is issued', async () => {
    const i = await invoice();
    await record(i.id, bank({ reference: `UTR-G-${tag}` })).expect(200);
    const r = await http().post(api(`admin/invoices/${i.id}/refunds`)).set(auth(finance)).send({ reason: 'Customer cancelled within the guarantee' }).expect(200);
    expect(r.body.status).toBe('REFUNDED');
    const refund = await db.refund.findFirstOrThrow({ where: { invoiceId: i.id } });
    expect(refund).toMatchObject({ status: 'SUCCEEDED', providerRefundId: null }); // nothing came back from a gateway, because there was none
    expect(await db.creditNote.count({ where: { invoiceId: i.id } })).toBe(1);
  });
});
