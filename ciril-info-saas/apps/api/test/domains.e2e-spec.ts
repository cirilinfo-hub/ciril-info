import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { cleanupUsers, createStaff, createTestApp, customer, platformDb, staffToken } from './utils.js';

/** Domain search (public) and the admin price list. The registrar is the test-mode mock. */
describe('Domains (e2e)', () => {
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  const tag = randomUUID().slice(0, 6).toLowerCase();
  const emails: string[] = [];
  let admin: string;
  let reader: string;
  let alice: Awaited<ReturnType<typeof customer>>;
  // Endings used only by this spec, so other rows in the shared database never matter.
  const tld = (n: string) => `t${tag}${n}`;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = (p: string) => `/api/v1/${p}`;
  const search = (q: string) => http().get(api('public/domains/search')).query({ q });
  const create = (t: string, extra: object = {}) =>
    http().post(api('admin/domains/tlds')).set(auth(admin)).send({ tld: t, registerPrice: 799, renewPrice: 999, transferPrice: 699, ...extra });

  beforeAll(async () => {
    app = await createTestApp();
    db = platformDb();
    const sa = await createStaff(db, 'SUPER_ADMIN', 'domsa');
    const agent = await createStaff(db, 'SUPPORT_AGENT', 'domagent');
    alice = await customer(app, db, 'dom-a');
    emails.push(sa.email, agent.email, alice.email);
    [admin, reader] = await Promise.all([staffToken(app, db, sa), staffToken(app, db, agent)]);
  });

  afterAll(async () => {
    await db.tldPrice.deleteMany({ where: { tld: { startsWith: `t${tag}` } } });
    await cleanupUsers(db, emails);
    await app.close();
  });

  describe('admin price list', () => {
    it('needs the right permissions', async () => {
      await http().get(api('admin/domains/tlds')).set(auth(alice.token)).expect(403);
      await http().get(api('admin/domains/tlds')).expect(401);
      await http().get(api('admin/domains/tlds')).set(auth(reader)).expect(200); // domains:read
      await http().post(api('admin/domains/tlds')).set(auth(reader)).send({ tld: tld('x'), registerPrice: 1, renewPrice: 1, transferPrice: 1 }).expect(403);
    });

    it('validates what it is given', async () => {
      await create('.bad ending').expect(400);
      await create('a.b.c').expect(400);
      await create(tld('neg'), { registerPrice: -1 }).expect(400);
      await create(tld('frac'), { renewPrice: 10.123 }).expect(400);
      await create(tld('word'), { transferPrice: 'free' }).expect(400);
    });

    it('creates an ending (a leading dot and capitals are tidied), refuses a duplicate, and audits', async () => {
      const r = await create(`.${tld('a').toUpperCase()}`, { isFeatured: true }).expect(201);
      expect(r.body.tld).toBe(tld('a'));
      expect(Number(r.body.registerPrice)).toBe(799);
      expect(r.body.isSample).toBe(false);
      const dup = await create(tld('a')).expect(409);
      expect(dup.body.error.code).toBe('TLD_EXISTS');
      expect(await db.auditLog.count({ where: { action: 'tld.create', entityId: r.body.id } })).toBe(1);
    });

    it('edits prices and turns an ending off, but cannot rename it', async () => {
      const made = await create(tld('b')).expect(201);
      const id = made.body.id as string;
      const upd = await http().patch(api(`admin/domains/tlds/${id}`)).set(auth(admin)).send({ registerPrice: 500, isActive: false, tld: 'renamed' }).expect(400); // tld not allowed
      expect(JSON.stringify(upd.body)).toMatch(/tld/);
      const ok = await http().patch(api(`admin/domains/tlds/${id}`)).set(auth(admin)).send({ registerPrice: 500, isActive: false }).expect(200);
      expect(Number(ok.body.registerPrice)).toBe(500);
      expect(ok.body.isActive).toBe(false);
      await http().patch(api(`admin/domains/tlds/${randomUUID()}`)).set(auth(admin)).send({ isActive: true }).expect(404);
      await http().patch(api(`admin/domains/tlds/${id}`)).set(auth(reader)).send({ isActive: true }).expect(403);
    });

    it('works selling prices out from purchase prices and a markup, and never shows costs publicly', async () => {
      const bad = await http().post(api('admin/domains/tlds')).set(auth(admin)).send({ tld: tld('mk0'), markupType: 'PERCENT', markupValue: 20 }).expect(400);
      expect(bad.body.error.code).toBe('COSTS_REQUIRED');
      await http().post(api('admin/domains/tlds')).set(auth(admin)).send({ tld: tld('mk1') }).expect(400); // no prices, no markup
      const r = await http().post(api('admin/domains/tlds')).set(auth(admin))
        .send({ tld: tld('mk'), costRegister: 700, costRenew: 900, costTransfer: 650, markupType: 'PERCENT', markupValue: 20, markupRound: 'NINE' }).expect(201);
      expect([r.body.registerPrice, r.body.renewPrice, r.body.transferPrice].map(Number)).toEqual([849, 1089, 789]);
      // New costs re-price it; switching to hand pricing keeps the costs.
      const id = r.body.id as string;
      const up = await http().patch(api(`admin/domains/tlds/${id}`)).set(auth(admin)).send({ costRegister: 800 }).expect(200);
      expect(Number(up.body.registerPrice)).toBe(969);
      const hand = await http().patch(api(`admin/domains/tlds/${id}`)).set(auth(admin)).send({ markupType: null, registerPrice: 999 }).expect(200);
      expect(hand.body).toMatchObject({ markupType: null });
      expect(Number(hand.body.registerPrice)).toBe(999);
      expect(Number(hand.body.costRegister)).toBe(800);
      const pub = await http().get(api('public/domains/tlds')).expect(200);
      expect(JSON.stringify(pub.body)).not.toMatch(/cost|markup/i);
    });

    it('applies one markup to many endings, skipping those without purchase prices', async () => {
      const a = await http().post(api('admin/domains/tlds')).set(auth(admin)).send({ tld: tld('bk1'), costRegister: 100, costRenew: 200, costTransfer: 300, markupType: 'AMOUNT', markupValue: 0 }).expect(201);
      const b = await create(tld('bk2')).expect(201); // hand-priced 799/999/699, no costs
      const ids = [a.body.id, b.body.id];
      await http().post(api('admin/domains/tlds/bulk-price')).set(auth(reader)).send({ ids, basis: 'COST', markupType: 'PERCENT', markupValue: 10 }).expect(403);
      const cost = await http().post(api('admin/domains/tlds/bulk-price')).set(auth(admin)).send({ ids, basis: 'COST', markupType: 'PERCENT', markupValue: 10 }).expect(200);
      expect(cost.body).toEqual({ changed: 1, skipped: [{ tld: tld('bk2'), reason: expect.any(String) }] });
      const cur = await http().post(api('admin/domains/tlds/bulk-price')).set(auth(admin)).send({ ids: [b.body.id], basis: 'CURRENT', markupType: 'AMOUNT', markupValue: 100 }).expect(200);
      expect(cur.body.changed).toBe(1);
      const list = await http().get(api('admin/domains/tlds')).query({ search: `t${tag}bk` }).set(auth(admin)).expect(200);
      const by = Object.fromEntries(list.body.data.map((t: { tld: string; registerPrice: string; markupType: string | null }) => [t.tld, t]));
      expect(Number(by[tld('bk1')].registerPrice)).toBe(110);
      expect(by[tld('bk1')].markupType).toBe('PERCENT');
      expect(Number(by[tld('bk2')].registerPrice)).toBe(899);
      expect(await db.auditLog.count({ where: { action: 'tld.bulk_price', actorId: { not: null } } })).toBeGreaterThan(0);
    });

    it('imports purchase prices: updates existing endings, adds new ones switched off, skips new ones without a markup', async () => {
      const rows = [
        { tld: tld('bk1'), costRegister: 200, costRenew: 200, costTransfer: 200 }, // follows a 10% markup
        { tld: tld('bk2'), costRegister: 500, costRenew: 500, costTransfer: 500 }, // hand-priced: prices kept
        { tld: `.${tld('im1').toUpperCase()}`, costRegister: 1000, costRenew: 1100, costTransfer: 900 },
      ];
      const none = await http().post(api('admin/domains/tlds/import')).set(auth(admin)).send({ rows }).expect(200);
      expect(none.body).toMatchObject({ created: 0, updated: 2, skipped: [{ tld: tld('im1') }] });
      const r = await http().post(api('admin/domains/tlds/import')).set(auth(admin)).send({ rows, markup: { markupType: 'AMOUNT', markupValue: 150, markupRound: 'RUPEE' } }).expect(200);
      expect(r.body).toMatchObject({ created: 1, updated: 2, skipped: [] });
      const list = await http().get(api('admin/domains/tlds')).query({ search: `t${tag}` }).set(auth(admin)).expect(200);
      const by = Object.fromEntries(list.body.data.map((t: { tld: string }) => [t.tld, t]));
      expect(Number(by[tld('bk1')].registerPrice)).toBe(220);
      expect(Number(by[tld('bk2')].registerPrice)).toBe(899);
      expect(Number(by[tld('bk2')].costRegister)).toBe(500);
      expect(by[tld('im1')]).toMatchObject({ isActive: false, markupType: 'AMOUNT' });
      expect(Number(by[tld('im1')].registerPrice)).toBe(1150);
      await http().post(api('admin/domains/tlds/import')).set(auth(admin)).send({ rows: [{ tld: 'a.b.c', costRegister: 1, costRenew: 1, costTransfer: 1 }] }).expect(400);
      await http().post(api('admin/domains/tlds/import')).set(auth(admin)).send({ rows: [] }).expect(400);
    });

    it('lists and searches', async () => {
      const r = await http().get(api('admin/domains/tlds')).query({ search: `t${tag}` }).set(auth(admin)).expect(200);
      expect(r.body.data.map((t: { tld: string }) => t.tld)).toEqual(expect.arrayContaining([tld('a'), tld('b')]));
    });
  });

  describe('public search', () => {
    it('needs no sign-in and lists only active endings with their prices', async () => {
      const r = await http().get(api('public/domains/tlds')).expect(200);
      const tlds = r.body.data as { tld: string; registerPrice: number }[];
      expect(tlds.find((t) => t.tld === tld('a'))?.registerPrice).toBe(799);
      expect(tlds.find((t) => t.tld === tld('b'))).toBeUndefined(); // turned off above
    });

    it('checks a bare name against every active ending', async () => {
      const r = await search(`Hello World ${tag}`).expect(200);
      expect(r.body.valid).toBe(true);
      expect(r.body.label).toBe(`helloworld${tag}`);
      const hit = r.body.results.find((x: { tld: string }) => x.tld === tld('a'));
      expect(hit).toMatchObject({ domain: `helloworld${tag}.${tld('a')}`, status: 'AVAILABLE', exact: false, registerPrice: 799, renewPrice: 999, transferPrice: 699 });
    });

    it('puts the ending the visitor typed first and reports a taken name', async () => {
      await create(tld('c')).expect(201);
      const r = await search(`taken${tag}.${tld('c')}`).expect(200);
      expect(r.body.results[0]).toMatchObject({ tld: tld('c'), exact: true, status: 'TAKEN' });
      expect(r.body.unsupportedTld).toBeNull();
    });

    it('says so when the typed ending is not sold, instead of searching something else silently', async () => {
      const r = await search(`acme${tag}.nosuchending`).expect(200);
      expect(r.body.unsupportedTld).toBe('nosuchending');
      expect(r.body.results.every((x: { exact: boolean }) => !x.exact)).toBe(true);
    });

    it('reports invalid names, and a registrar that cannot be reached', async () => {
      expect((await search('-bad-').expect(200)).body).toMatchObject({ valid: false, results: [] });
      await http().get(api('public/domains/search')).expect(400);
      const down = await search(`registrarfail${tag}`).expect(200);
      expect(down.body.registrarOk).toBe(false);
      expect(down.body.results.every((x: { status: string }) => x.status === 'UNKNOWN')).toBe(true);
    });

    it('never offers an ending that is switched off', async () => {
      const r = await search(`fresh${tag}`).expect(200);
      expect(r.body.results.some((x: { tld: string }) => x.tld === tld('b'))).toBe(false);
    });
  });
});
