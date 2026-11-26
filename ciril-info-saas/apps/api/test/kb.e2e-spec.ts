import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { cleanupUsers, createStaff, createTestApp, platformDb, staffToken } from './utils.js';

/**
 * Help centre: who may write articles, publish rules, and that the public API only ever
 * shows published articles. Uses its own tagged rows.
 */
describe('Help centre / knowledge base (e2e)', () => {
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  let admin: string;
  let support: string;
  let finance: string;
  const emails: string[] = [];
  const tag = randomUUID().slice(0, 8);
  const catSlug = `t-kb-${tag}`;
  let categoryId = '';

  const http = () => request(app.getHttpServer());
  const api = (p: string) => `/api/v1/admin/kb/${p}`;
  const pub = (p: string) => `/api/v1/public/kb/${p}`;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const article = (slug: string, extra: Record<string, unknown> = {}) => ({
    categoryId, slug, title: `Reset a mailbox password ${tag}`, summary: 'How to reset it.',
    body: '## Steps\n1. Open Email.\n2. Choose Reset.\n\n<b>not html</b>', ...extra,
  });

  beforeAll(async () => {
    app = await createTestApp();
    db = platformDb();
    const sa = await createStaff(db, 'SUPER_ADMIN', 'kbsa');
    const sup = await createStaff(db, 'SUPPORT_AGENT', 'kbsupport');
    const fin = await createStaff(db, 'FINANCE_ADMIN', 'kbfinance');
    emails.push(sa.email, sup.email, fin.email);
    [admin, support, finance] = await Promise.all([staffToken(app, db, sa), staffToken(app, db, sup), staffToken(app, db, fin)]);
  });

  afterAll(async () => {
    await db.kbArticle.deleteMany({ where: { slug: { startsWith: `t-kb-${tag}` } } });
    await db.kbCategory.deleteMany({ where: { slug: { startsWith: catSlug } } });
    await cleanupUsers(db, emails);
    await app.close();
  });

  it('needs a staff session and the kb:write permission', async () => {
    await http().get(api('categories')).expect(401);
    await http().get(api('categories')).set(auth(finance)).expect(403);
    await http().post(api('categories')).set(auth(finance)).send({ slug: catSlug, name: 'X' }).expect(403);
  });

  it('support agents can create categories and articles', async () => {
    const c = await http().post(api('categories')).set(auth(support)).send({ slug: catSlug, name: `Email ${tag}` }).expect(201);
    categoryId = c.body.id;
    await http().post(api('categories')).set(auth(admin)).send({ slug: catSlug, name: 'Dup' }).expect(409);
  });

  it('validates articles and refuses an unknown category', async () => {
    const bad = await http().post(api('articles')).set(auth(support)).send({ ...article(`t-kb-${tag}-bad`), slug: 'Not A Slug', body: '' }).expect(400);
    expect(JSON.stringify(bad.body)).toMatch(/slug|lowercase/i);
    await http().post(api('articles')).set(auth(support)).send(article(`t-kb-${tag}-x`, { categoryId: randomUUID() })).expect(404);
  });

  it('keeps drafts private, and publishes with a publish date', async () => {
    const slug = `t-kb-${tag}-reset`;
    const a = await http().post(api('articles')).set(auth(support)).send(article(slug)).expect(201);
    expect(a.body.status).toBe('DRAFT');
    expect(a.body.publishedAt).toBeNull();

    await http().get(pub(`articles/${slug}`)).expect(404);
    const listed = await http().get(pub('articles')).query({ search: tag }).expect(200);
    expect(listed.body.data).toHaveLength(0);
    const cats = await http().get(pub('categories')).expect(200);
    expect(cats.body.data.find((c: { slug: string }) => c.slug === catSlug)).toBeUndefined();

    const p = await http().patch(api(`articles/${a.body.id}`)).set(auth(support)).send({ status: 'PUBLISHED' }).expect(200);
    expect(p.body.publishedAt).not.toBeNull();
    const firstPublished = p.body.publishedAt;

    const shown = await http().get(pub(`articles/${slug}`)).expect(200);
    expect(shown.body.title).toContain(tag);
    expect(shown.body.category.slug).toBe(catSlug);
    expect(shown.body.blocks).toEqual([
      { type: 'heading', text: 'Steps' },
      { type: 'steps', items: ['Open Email.', 'Choose Reset.'] },
      { type: 'paragraph', text: '<b>not html</b>' },
    ]);
    expect(shown.body).not.toHaveProperty('body');

    // Editing a published article keeps its first publish date.
    const e = await http().patch(api(`articles/${a.body.id}`)).set(auth(admin)).send({ summary: 'Updated.' }).expect(200);
    expect(e.body.publishedAt).toBe(firstPublished);

    const cats2 = await http().get(pub('categories')).expect(200);
    expect(cats2.body.data.find((c: { slug: string }) => c.slug === catSlug)).toMatchObject({ articleCount: 1 });

    // Archiving hides it again.
    await http().patch(api(`articles/${a.body.id}`)).set(auth(admin)).send({ status: 'ARCHIVED' }).expect(200);
    await http().get(pub(`articles/${slug}`)).expect(404);
    await http().patch(api(`articles/${a.body.id}`)).set(auth(admin)).send({ status: 'PUBLISHED' }).expect(200);
  });

  it('searches every word, title matches first, and limits suggestions', async () => {
    const slug = `t-kb-${tag}-dns`;
    await http().post(api('articles')).set(auth(support))
      .send(article(slug, { title: `Point a domain ${tag}`, summary: 'DNS basics.', body: 'Mentions mailbox password once.', status: 'PUBLISHED' }))
      .expect(201);

    const both = await http().get(pub('articles')).query({ search: `${tag} mailbox password` }).expect(200);
    expect(both.body.data.map((a: { slug: string }) => a.slug)).toEqual([`t-kb-${tag}-reset`, slug]);

    const one = await http().get(pub('articles')).query({ search: `${tag} domain` }).expect(200);
    expect(one.body.data.map((a: { slug: string }) => a.slug)).toEqual([slug]);

    const limited = await http().get(pub('articles')).query({ search: tag, limit: 1 }).expect(200);
    expect(limited.body.data).toHaveLength(1);

    // Filler words are ignored; a filler-only search finds nothing rather than everything.
    const filler = await http().get(pub('articles')).query({ search: `how do I ${tag} domain` }).expect(200);
    expect(filler.body.data.map((a: { slug: string }) => a.slug)).toEqual([slug]);
    const none = await http().get(pub('articles')).query({ search: 'how do I' }).expect(200);
    expect(none.body.data).toHaveLength(0);

    // Suggestions match any word, best first: the subject below matches only the DNS article's title.
    const any = await http().get(pub('articles')).query({ search: `${tag} point unrelatedword`, match: 'any' }).expect(200);
    expect(any.body.data[0].slug).toBe(slug);
    const strict = await http().get(pub('articles')).query({ search: `${tag} point unrelatedword` }).expect(200);
    expect(strict.body.data).toHaveLength(0);
    expect(any.body.data[0]).not.toHaveProperty('body');

    const inCat = await http().get(pub('articles')).query({ category: catSlug }).expect(200);
    expect(inCat.body.data).toHaveLength(2);

    const detail = await http().get(pub(`articles/${slug}`)).expect(200);
    expect(detail.body.related.map((r: { slug: string }) => r.slug)).toEqual([`t-kb-${tag}-reset`]);
  });

  it('will not delete a category that still has articles, and records an audit trail', async () => {
    const r = await http().delete(api(`categories/${categoryId}`)).set(auth(admin)).expect(409);
    expect(r.body.code ?? r.body.error?.code).toBe('CATEGORY_NOT_EMPTY');
    const logs = await db.auditLog.count({ where: { entityType: 'kb_article', action: { startsWith: 'kb.article.' } , entityId: { in: (await db.kbArticle.findMany({ where: { categoryId }, select: { id: true } })).map((a) => a.id) } } });
    expect(logs).toBeGreaterThanOrEqual(4);
  });

  it('rejects odd slugs on the public article route', async () => {
    await http().get(pub('articles/Bad%20Slug')).expect(400);
  });
});
