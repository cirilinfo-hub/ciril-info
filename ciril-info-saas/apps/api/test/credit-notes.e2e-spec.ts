import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { cleanupUsers, createStaff, createTestApp, customer, platformDb, staffToken } from './utils.js';

/** GST credit notes: one per refund, tax found inside the refund, CGST/SGST or IGST, exact totals and access rules. */
describe('Credit notes (e2e)', () => {
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  const tag = randomUUID().slice(0, 8);
  const emails: string[] = [];
  let alice: Awaited<ReturnType<typeof customer>>; // buyer in Maharashtra (27)
  let bob: Awaited<ReturnType<typeof customer>>;
  let finance: string;
  let support: string;
  let planId: string;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = (p: string) => `/api/v1/${p}`;

  /** A paid order whose invoice says the seller is in `sellerState` (or nowhere). */
  async function paidInvoice(sellerState: string | null) {
    const o = await http().post(api('orders')).set(auth(alice.token)).send({ planId, billingCycle: 'YEARLY' }).expect(201);
    await http().post(api(`invoices/${o.body.invoice.id}/pay`)).set(auth(alice.token)).send({}).expect(200);
    const inv = await db.invoice.findUniqueOrThrow({ where: { id: o.body.invoice.id } });
    const snap = (inv.billingSnapshot ?? {}) as Record<string, unknown>;
    await db.invoice.update({ where: { id: inv.id }, data: { billingSnapshot: { ...snap, seller: sellerState ? { name: 'Test Seller', address: { stateCode: sellerState } } : { name: 'Test Seller' } } } });
    return { id: inv.id, number: inv.number, total: Number(inv.total.toString()), tax: Number(inv.taxTotal.toString()) };
  }
  const refund = (invoiceId: string, body: object) => http().post(api(`admin/invoices/${invoiceId}/refunds`)).set(auth(finance)).send(body);
  const notes = (invoiceId: string) => db.creditNote.findMany({ where: { invoiceId }, orderBy: { createdAt: 'asc' } });
  const n = (d: { toString(): string }) => Number(d.toString());

  beforeAll(async () => {
    app = await createTestApp();
    db = platformDb();
    alice = await customer(app, db, 'cn-a');
    bob = await customer(app, db, 'cn-b');
    const f = await createStaff(db, 'FINANCE_ADMIN', 'cnfin');
    const s = await createStaff(db, 'SUPPORT_AGENT', 'cnsup');
    emails.push(alice.email, bob.email, f.email, s.email);
    [finance, support] = await Promise.all([staffToken(app, db, f), staffToken(app, db, s)]);
    await http().post(api('organisation/addresses')).set(auth(alice.token)).send({ line1: '1 Test Street', city: 'Pune', stateCode: '27', postalCode: '411001' }).expect(201);

    const category = await db.productCategory.upsert({ where: { slug: 'hosting' }, update: {}, create: { slug: 'hosting', name: 'Hosting' } });
    const product = await db.product.create({ data: { categoryId: category.id, slug: `t-prod-${tag}`, name: `Credit ${tag}`, type: 'WEB_HOSTING', status: 'PUBLISHED' } });
    const plan = await db.plan.create({ data: { productId: product.id, slug: `t-plan-${tag}`, name: `Plan ${tag}`, status: 'PUBLISHED', isSample: true } });
    planId = plan.id;
    await db.pricingVersion.create({ data: { planId, billingCycle: 'YEARLY', price: '1000.00', renewalPrice: '1000.00' } });
  });

  afterAll(async () => {
    const tenantIds = [alice?.tenantId, bob?.tenantId].filter(Boolean) as string[];
    await db.creditNote.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.refund.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.payment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.invoice.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.subscription.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.outboxEvent.deleteMany({ where: { tenantId: { in: tenantIds }, type: { in: ['subscription.activated', 'subscription.cancelled'] } } });
    await db.pricingVersion.deleteMany({ where: { planId } });
    await db.plan.deleteMany({ where: { id: planId } });
    await db.product.deleteMany({ where: { slug: `t-prod-${tag}` } });
    await cleanupUsers(db, emails);
    await app.close();
  });

  it('every refund gets a numbered credit note; a partial one carries a proportional share of the tax, split CGST/SGST in the same state', async () => {
    const inv = await paidInvoice('27');
    expect(inv.tax).toBeGreaterThan(0);
    await refund(inv.id, { amount: 100, reason: 'Goodwill credit' }).expect(200);
    const [cn] = await notes(inv.id);
    expect(cn!.number).toMatch(/^CN-\d{4}-\d{2}-\d{6}$/);
    expect(n(cn!.total)).toBe(100);
    const expectedTax = Math.round((100 * 100 * inv.tax) / inv.total) / 100;
    expect(n(cn!.taxTotal)).toBeCloseTo(expectedTax, 2);
    expect(n(cn!.subtotal) + n(cn!.taxTotal)).toBeCloseTo(100, 2); // taxable value + tax = the refund
    const gst = (cn!.snapshot as { gst: { kind: string; cgst: string; sgst: string; igst: string } }).gst;
    expect(gst.kind).toBe('INTRA');
    expect(Number(gst.cgst) + Number(gst.sgst)).toBeCloseTo(n(cn!.taxTotal), 2);
    expect(Number(gst.igst)).toBe(0);
    expect((cn!.snapshot as { original: { number: string } }).original.number).toBe(inv.number);
  });

  it('a different seller state gives IGST; no seller state is not guessed', async () => {
    const inter = await paidInvoice('29');
    await refund(inter.id, { amount: 200, reason: 'Courtesy' }).expect(200);
    const gstInter = ((await notes(inter.id))[0]!.snapshot as { gst: { kind: string; igst: string; cgst: string } }).gst;
    expect(gstInter.kind).toBe('INTER');
    expect(Number(gstInter.igst)).toBeCloseTo(n((await notes(inter.id))[0]!.taxTotal), 2);
    expect(Number(gstInter.cgst)).toBe(0);

    const unknown = await paidInvoice(null);
    await refund(unknown.id, { amount: 200, reason: 'Courtesy' }).expect(200);
    const gstUnknown = ((await notes(unknown.id))[0]!.snapshot as { gst: { kind: string; gst: string } }).gst;
    expect(gstUnknown.kind).toBe('UNKNOWN');
    expect(Number(gstUnknown.gst)).toBeCloseTo(n((await notes(unknown.id))[0]!.taxTotal), 2);
  });

  it('several refunds add up exactly to the invoice: total, tax and taxable value', async () => {
    const inv = await paidInvoice('27');
    await refund(inv.id, { amount: 333.33, reason: 'First' }).expect(200);
    await refund(inv.id, { amount: 333.33, reason: 'Second' }).expect(200);
    await refund(inv.id, { reason: 'Everything left' }).expect(200); // the final one takes the rest
    const all = await notes(inv.id);
    expect(all).toHaveLength(3);
    expect(new Set(all.map((c) => c.number)).size).toBe(3);
    const sum = (f: (c: (typeof all)[number]) => number) => Math.round(all.reduce((t, c) => t + f(c), 0) * 100) / 100;
    expect(sum((c) => n(c.total))).toBe(inv.total);
    expect(sum((c) => n(c.taxTotal))).toBe(inv.tax); // no paisa lost or invented
    expect(sum((c) => n(c.subtotal))).toBe(Math.round((inv.total - inv.tax) * 100) / 100);
  });

  it('credit note numbers run in sequence and are never reused', async () => {
    const inv = await paidInvoice('27');
    await refund(inv.id, { amount: 10, reason: 'One' }).expect(200);
    await refund(inv.id, { amount: 10, reason: 'Two' }).expect(200);
    const [a, b] = await notes(inv.id);
    const seq = (x: string) => Number(x.split('-').pop());
    expect(seq(b!.number)).toBeGreaterThan(seq(a!.number));
  });

  it('a failed validation issues no credit note', async () => {
    const inv = await paidInvoice('27');
    await refund(inv.id, { amount: inv.total + 1, reason: 'Too much' }).expect(409);
    expect(await notes(inv.id)).toHaveLength(0);
  });

  describe('reading them', () => {
    let invoiceId: string;
    let creditNoteId: string;

    beforeAll(async () => {
      invoiceId = (await paidInvoice('27')).id;
      await refund(invoiceId, { amount: 50, reason: 'Read test' }).expect(200);
      creditNoteId = (await notes(invoiceId))[0]!.id;
    });

    it('the invoice lists its credit notes for the customer and for staff', async () => {
      const mine = await http().get(api(`invoices/${invoiceId}`)).set(auth(alice.token)).expect(200);
      expect(mine.body.refunds[0].creditNote.id).toBe(creditNoteId);
      expect(mine.body.refunds[0].creditNote.number).toMatch(/^CN-/);
      const staff = await http().get(api(`admin/invoices/${invoiceId}`)).set(auth(support)).expect(200);
      expect(staff.body.refunds[0].creditNote.number).toBe(mine.body.refunds[0].creditNote.number);
    });

    it('the customer can open it; everything needed to print is there', async () => {
      const r = await http().get(api(`credit-notes/${creditNoteId}`)).set(auth(alice.token)).expect(200);
      expect(r.body.number).toMatch(/^CN-/);
      expect(r.body.invoice.id).toBe(invoiceId);
      expect(r.body.reason).toBe('Read test');
      expect(r.body.snapshot.seller.name).toBe('Test Seller');
      expect(r.body.snapshot.buyer.address.stateCode).toBe('27');
      expect(r.body.snapshot.gst.kind).toBe('INTRA');
    });

    it('another organisation, anonymous callers and customers on the admin route are refused', async () => {
      await http().get(api(`credit-notes/${creditNoteId}`)).expect(401);
      await http().get(api(`credit-notes/${creditNoteId}`)).set(auth(bob.token)).expect(404);
      await http().get(api(`admin/credit-notes/${creditNoteId}`)).set(auth(alice.token)).expect(403);
    });

    it('staff with billing access can open it', async () => {
      const r = await http().get(api(`admin/credit-notes/${creditNoteId}`)).set(auth(support)).expect(200);
      expect(r.body.tenant.name).toContain('Org cn-a');
      await http().get(api(`admin/credit-notes/${randomUUID()}`)).set(auth(support)).expect(404);
    });
  });
});
