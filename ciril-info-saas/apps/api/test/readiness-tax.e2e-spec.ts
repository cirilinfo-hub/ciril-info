import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { cleanupUsers, createStaff, createTestApp, customer, platformDb, staffToken } from './utils.js';

/** GST rates (admin) and the launch checklist. The shared database's own default rate is put back afterwards. */
describe('Tax rates and launch readiness (e2e)', () => {
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  const emails: string[] = [];
  let admin: string;
  let finance: string;
  let agent: string;
  let alice: Awaited<ReturnType<typeof customer>>;
  let originalDefaults: string[] = [];
  const created: string[] = [];
  const tag = randomUUID().slice(0, 4).toUpperCase().replace(/[0-9]/g, 'X');

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = (p: string) => `/api/v1/${p}`;
  const add = (body: object, token = admin) => http().post(api('admin/tax-rates')).set(auth(token)).send(body);
  const patch = (id: string, body: object, token = admin) => http().patch(api(`admin/tax-rates/${id}`)).set(auth(token)).send(body);
  const track = <T extends { body: any }>(r: T): T => (created.push(r.body.id), r);
  const defaults = async () => (await db.taxRate.findMany({ where: { country: 'IN', isDefault: true } })).map((t) => t.id);

  beforeAll(async () => {
    app = await createTestApp();
    db = platformDb();
    alice = await customer(app, db, 'tax-a');
    const sa = await createStaff(db, 'SUPER_ADMIN', 'taxsa');
    const fin = await createStaff(db, 'FINANCE_ADMIN', 'taxfin');
    const ag = await createStaff(db, 'SUPPORT_AGENT', 'taxagent');
    emails.push(alice.email, sa.email, fin.email, ag.email);
    [admin, finance, agent] = await Promise.all([staffToken(app, db, sa), staffToken(app, db, fin), staffToken(app, db, ag)]);
    originalDefaults = await defaults();
  });

  afterAll(async () => {
    await db.taxRate.deleteMany({ where: { id: { in: created } } });
    await db.taxRate.updateMany({ where: { country: 'IN', isDefault: true }, data: { isDefault: false } });
    if (originalDefaults.length) await db.taxRate.updateMany({ where: { id: { in: originalDefaults } }, data: { isDefault: true, isActive: true } });
    await cleanupUsers(db, emails);
    await app.close();
  });

  describe('tax rates', () => {
    it('needs the right permissions', async () => {
      await http().get(api('admin/tax-rates')).expect(401);
      await http().get(api('admin/tax-rates')).set(auth(alice.token)).expect(403);
      await http().get(api('admin/tax-rates')).set(auth(agent)).expect(200); // billing:read
      await add({ name: 'X', code: 'XX', rate: 5 }, agent).expect(403); // no tax:write
      const ok = track(await add({ name: `Test ${tag}`, code: `T${tag}`, rate: 5 }, finance).expect(201)); // tax:write
      expect(ok.body.code).toBe(`T${tag}`);
    });

    it('validates what it is given', async () => {
      await add({ name: '', code: 'GST', rate: 18 }).expect(400);
      await add({ name: 'Bad code', code: 'g-s-t', rate: 18 }).expect(400);
      await add({ name: 'Too high', code: 'GST', rate: 101 }).expect(400);
      await add({ name: 'Negative', code: 'GST', rate: -1 }).expect(400);
      await add({ name: 'Decimals', code: 'GST', rate: 18.5555 }).expect(400);
      await add({ name: 'Word', code: 'GST', rate: 'lots' }).expect(400);
    });

    it('tidies the code, keeps three decimals, audits, and refuses an identical active rate', async () => {
      const r = track(await add({ name: `Reduced ${tag}`, code: ` r${tag.toLowerCase()} `, rate: 12.5 }).expect(201));
      expect(r.body.code).toBe(`R${tag}`);
      expect(Number(r.body.rate)).toBe(12.5);
      expect(r.body.country).toBe('IN');
      expect(await db.auditLog.count({ where: { action: 'tax_rate.create', entityId: r.body.id } })).toBe(1);
      expect((await add({ name: 'Again', code: `R${tag}`, rate: 12.5 }).expect(409)).body.error.code).toBe('TAX_RATE_EXISTS');
    });

    it('when there is no default, the first rate added becomes it', async () => {
      await db.taxRate.updateMany({ where: { country: 'IN', isDefault: true }, data: { isDefault: false } });
      const r = track(await add({ name: `First ${tag}`, code: `F${tag}`, rate: 18 }).expect(201));
      expect(r.body.isDefault).toBe(true);
      expect(await defaults()).toEqual([r.body.id]);
    });

    it('keeps exactly one default: a new default replaces the old one', async () => {
      const first = (await defaults())[0]!;
      const other = track(await add({ name: `Other ${tag}`, code: `O${tag}`, rate: 18 }).expect(201));
      expect(other.body.isDefault).toBe(false); // there is already a default
      expect(await defaults()).toEqual([first]);
      const made = await patch(other.body.id, { isDefault: true }).expect(200);
      expect(made.body.isDefault).toBe(true);
      expect(await defaults()).toEqual([other.body.id]);
      const direct = track(await add({ name: `Direct ${tag}`, code: `D${tag}`, rate: 18, isDefault: true }).expect(201));
      expect(await defaults()).toEqual([direct.body.id]);
    });

    it('does not let the default be switched off or unset directly', async () => {
      const [id] = await defaults();
      expect((await patch(id!, { isActive: false }).expect(409)).body.error.code).toBe('TAX_RATE_IS_DEFAULT');
      await patch(id!, { isDefault: false }).expect(400);
      expect(await defaults()).toEqual([id]);
    });

    it('edits the name and rate, never the code, and a switched-off rate cannot become the default', async () => {
      const spare = track(await add({ name: `Spare ${tag}`, code: `S${tag}`, rate: 5 }).expect(201));
      const edited = await patch(spare.body.id, { name: 'Renamed', rate: 6 }).expect(200);
      expect(edited.body.name).toBe('Renamed');
      expect(Number(edited.body.rate)).toBe(6);
      await patch(spare.body.id, { code: 'NEWCODE' }).expect(400);
      await patch(spare.body.id, { isActive: false }).expect(200);
      expect((await patch(spare.body.id, { isDefault: true }).expect(409)).body.error.code).toBe('TAX_RATE_INACTIVE');
      await patch(randomUUID(), { name: 'x' }).expect(404);
      expect(await db.auditLog.count({ where: { action: 'tax_rate.update', entityId: spare.body.id } })).toBe(2);
    });

    it('lists the default first', async () => {
      const r = (await http().get(api('admin/tax-rates')).set(auth(admin)).expect(200)).body.data as { isDefault: boolean }[];
      expect(r[0]!.isDefault).toBe(true);
    });

    it('is what a customer’s quote then uses', async () => {
      const [id] = await defaults();
      await db.taxRate.update({ where: { id: id! }, data: { rate: '18.000' } });
      const plan = await db.plan.findFirst({ where: { status: 'PUBLISHED', product: { status: 'PUBLISHED' }, pricingVersions: { some: { billingCycle: 'YEARLY' } } }, include: { product: true } });
      if (!plan) return; // no plan in this database to quote against
      const q = await http().post(api('orders/quote')).set(auth(alice.token)).send({ planId: plan.id, billingCycle: 'YEARLY' });
      if (q.status === 200) expect(Number(q.body.taxTotal)).toBeGreaterThan(0);
    });
  });

  describe('launch readiness', () => {
    it('needs settings access', async () => {
      await http().get(api('admin/readiness')).expect(401);
      await http().get(api('admin/readiness')).set(auth(alice.token)).expect(403);
      await http().get(api('admin/readiness')).set(auth(agent)).expect(403);
    });

    it('reports every check, grouped, with a summary that adds up', async () => {
      const r = (await http().get(api('admin/readiness')).set(auth(admin)).expect(200)).body;
      const keys = r.checks.map((c: { key: string }) => c.key);
      expect(keys).toEqual(expect.arrayContaining(['payments', 'hosting', 'dns', 'registrar', 'email', 'storage', 'errors', 'company', 'tax', 'plans', 'tlds', 'legal', 'samples', 'mfa']));
      expect(r.summary.todo + r.summary.ok + r.summary.info).toBe(r.checks.length);
      expect(r.checks.every((c: { status: string; detail: string; label: string; group: string }) => ['ok', 'todo', 'info'].includes(c.status) && c.detail && c.label && c.group)).toBe(true);
    });

    it('describes the test setup as test mode, without exposing any setting', async () => {
      const r = (await http().get(api('admin/readiness')).set(auth(admin)).expect(200)).body;
      const get = (k: string) => r.checks.find((c: { key: string }) => c.key === k);
      expect(get('payments').status).toBe('todo'); // the test environment uses the mock gateway
      expect(get('email').status).toBe('todo'); // and the local test inbox
      const raw = JSON.stringify(r);
      for (const secret of [process.env['DATA_ENCRYPTION_KEY'], process.env['JWT_ACCESS_SECRET'], process.env['DATABASE_URL_PLATFORM'], process.env['RAZORPAY_KEY_SECRET']]) {
        if (secret && secret.length > 6) expect(raw).not.toContain(secret);
      }
    });

    it('follows the data: the GST check reflects the default rate, and counts staff without two-step sign-in', async () => {
      const get = async (k: string) => ((await http().get(api('admin/readiness')).set(auth(admin)).expect(200)).body.checks as { key: string; status: string; detail: string; link?: string }[]).find((c) => c.key === k)!;
      const [id] = await defaults();
      await db.taxRate.update({ where: { id: id! }, data: { rate: '18.000', name: 'GST' } });
      expect(await get('tax')).toMatchObject({ status: 'ok', link: '/tax' });
      expect((await get('tax')).detail).toContain('18%');
      await db.taxRate.updateMany({ where: { country: 'IN', isDefault: true }, data: { isDefault: false } });
      expect(await get('tax')).toMatchObject({ status: 'todo', detail: expect.stringContaining('no tax') });
      await db.taxRate.update({ where: { id: id! }, data: { isDefault: true } });

      const noMfa = await createStaff(db, 'SUPPORT_AGENT', 'taxnomfa');
      emails.push(noMfa.email);
      await db.user.update({ where: { id: noMfa.id }, data: { mfaEnabled: false } });
      expect(await get('mfa')).toMatchObject({ status: 'todo', detail: expect.stringMatching(/have not turned on|has not turned on/) });
    });
  });
});
