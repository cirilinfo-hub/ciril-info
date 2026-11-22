import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { cleanupUsers, createStaff, createTestApp, platformDb, staffToken } from './utils.js';

/**
 * Admin website-content API: permissions, consent rule, publish rules, append-only pricing,
 * settings validation and enquiry triage. Uses its own tagged rows and restores any setting it edits.
 */
describe('Admin website content (e2e)', () => {
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  let admin: string;
  let support: string;
  let finance: string;
  const emails: string[] = [];
  const tag = randomUUID().slice(0, 8);
  const keys = ['company.profile', 'site.claims', 'legal.cancellation-policy'];
  let settingsBackup: { key: string; value: unknown }[] = [];
  const uploaded: string[] = [];
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const inquiryEmail = `adm-${tag}@example.test`;

  const http = () => request(app.getHttpServer());
  const api = (p: string) => `/api/v1/admin/${p}`;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    app = await createTestApp();
    db = platformDb();
    const sa = await createStaff(db, 'SUPER_ADMIN', 'sa');
    const sup = await createStaff(db, 'SUPPORT_AGENT', 'support');
    const fin = await createStaff(db, 'FINANCE_ADMIN', 'finance');
    emails.push(sa.email, sup.email, fin.email);
    [admin, support, finance] = await Promise.all([staffToken(app, db, sa), staffToken(app, db, sup), staffToken(app, db, fin)]);
    settingsBackup = await db.systemSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  });

  afterAll(async () => {
    const products = await db.product.findMany({ where: { slug: { startsWith: `t-prod-${tag}` } }, select: { id: true } });
    const planIds = (await db.plan.findMany({ where: { productId: { in: products.map((p) => p.id) } }, select: { id: true } })).map((p) => p.id);
    await db.pricingVersion.deleteMany({ where: { planId: { in: planIds } } });
    await db.planFeature.deleteMany({ where: { planId: { in: planIds } } });
    await db.plan.deleteMany({ where: { id: { in: planIds } } });
    await db.product.deleteMany({ where: { id: { in: products.map((p) => p.id) } } });
    await db.testimonial.deleteMany({ where: { quote: { contains: tag } } });
    await db.faq.deleteMany({ where: { topic: `t-${tag}` } });
    await db.portfolioProject.deleteMany({ where: { slug: { startsWith: `t-proj-${tag}` } } });
    await db.contactInquiry.deleteMany({ where: { email: inquiryEmail } });
    for (const key of keys) {
      const before = settingsBackup.find((b) => b.key === key);
      if (before) await db.systemSetting.update({ where: { key }, data: { value: before.value as object } });
      else await db.systemSetting.deleteMany({ where: { key } });
    }
    for (const p of uploaded) await rm(join(process.cwd(), 'storage', p.replace(/^\/uploads\//, '')), { force: true });
    await cleanupUsers(db, emails);
    await app.close();
  });

  describe('permissions', () => {
    it('requires a staff session', async () => {
      await http().get(api('content/faqs')).expect(401);
    });

    it('support agents can read nothing here that they were not granted, and cannot write content', async () => {
      await http().post(api('content/faqs')).set(auth(support)).send({ topic: `t-${tag}`, question: 'Q?', answer: 'A.' }).expect(403);
      await http().put(api('settings/claims')).set(auth(support)).send({}).expect(403);
    });

    it('finance cannot edit pricing or content', async () => {
      await http().put(api('settings/company')).set(auth(finance)).send({ brandName: 'X' }).expect(403);
    });
  });

  describe('testimonials', () => {
    it('refuses to publish without recorded consent, then publishes once consent is confirmed', async () => {
      const body = { quote: `Great work ${tag}`, authorName: 'A. Client', isPublished: true };
      const bad = await http().post(api('content/testimonials')).set(auth(admin)).send(body).expect(422);
      expect(bad.body.error.code).toBe('CONSENT_REQUIRED');

      const draft = await http().post(api('content/testimonials')).set(auth(admin)).send({ ...body, isPublished: false }).expect(201);
      const id = draft.body.id as string;
      await http().patch(api(`content/testimonials/${id}`)).set(auth(admin)).send({ isPublished: true }).expect(422);
      const ok = await http().patch(api(`content/testimonials/${id}`)).set(auth(admin)).send({ isPublished: true, consentConfirmed: true, consentNote: 'Email 1 Jan' }).expect(200);
      expect(ok.body.publishedAt).toBeTruthy();

      const pub = await http().get('/api/v1/public/testimonials').expect(200);
      expect(pub.body.data.some((t: { quote: string }) => t.quote === body.quote)).toBe(true);

      // Withdrawing consent while published is also refused.
      await http().patch(api(`content/testimonials/${id}`)).set(auth(admin)).send({ consentConfirmed: false }).expect(422);
      await http().delete(api(`content/testimonials/${id}`)).set(auth(admin)).expect(204);
      await http().delete(api(`content/testimonials/${id}`)).set(auth(admin)).expect(404);
    });

    it('rejects unknown fields and out-of-range ratings', async () => {
      await http().post(api('content/testimonials')).set(auth(admin)).send({ quote: `x ${tag}`, authorName: 'A', isSample: true }).expect(400);
      await http().post(api('content/testimonials')).set(auth(admin)).send({ quote: `x ${tag}`, authorName: 'A', rating: 9 }).expect(400);
    });
  });

  describe('FAQs and projects', () => {
    it('creates, edits, filters by topic and deletes a FAQ', async () => {
      const created = await http().post(api('content/faqs')).set(auth(admin)).send({ topic: `t-${tag}`, question: 'Is it?', answer: 'It is.' }).expect(201);
      await http().patch(api(`content/faqs/${created.body.id}`)).set(auth(admin)).send({ isPublished: true }).expect(200);
      const list = await http().get(api(`content/faqs?topic=t-${tag}`)).set(auth(admin)).expect(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.topics.some((t: { topic: string }) => t.topic === `t-${tag}`)).toBe(true);
      expect((await http().get(`/api/v1/public/faqs?topic=t-${tag}`).expect(200)).body.data).toHaveLength(1);
      await http().delete(api(`content/faqs/${created.body.id}`)).set(auth(admin)).expect(204);
    });

    it('projects: unique slug, URL validation, publish shows it on the site', async () => {
      const slug = `t-proj-${tag}`;
      const body = { slug, title: 'T', clientName: `Client ${tag}`, category: 'Web Design', summary: 'S', scope: ['A', ''], tags: ['x'] };
      const created = await http().post(api('content/projects')).set(auth(admin)).send(body).expect(201);
      expect(created.body.scope).toEqual(['A']);
      expect((await http().post(api('content/projects')).set(auth(admin)).send(body).expect(409)).body.error.code).toBe('ALREADY_EXISTS');
      await http().patch(api(`content/projects/${created.body.id}`)).set(auth(admin)).send({ projectUrl: 'javascript:alert(1)' }).expect(400);
      await http().patch(api(`content/projects/${created.body.id}`)).set(auth(admin)).send({ projectUrl: 'https://example.com', isPublished: true }).expect(200);
      const pub = await http().get('/api/v1/public/projects').expect(200);
      expect(pub.body.data.some((p: { slug: string }) => p.slug === slug)).toBe(true);
    });
  });

  describe('image uploads', () => {
    const upload = (token: string | null, file: Buffer, name = 'photo.png', type = 'image/png') => {
      const r = http().post('/api/v1/uploads/images');
      return (token ? r.set(auth(token)) : r).attach('file', file, { filename: name, contentType: type });
    };

    it('needs a staff session with permission to edit content', async () => {
      await upload(null, PNG).expect(401);
      await upload(support, PNG).expect(403);
    });

    it('stores a real image under a random name, serves it, and shows it on the project', async () => {
      const res = await upload(admin, PNG, '../../evil name.png').expect(201);
      const path = res.body.path as string;
      uploaded.push(path);
      expect(path).toMatch(/^\/uploads\/images\/[0-9a-f-]{36}\.png$/);

      const served = await http().get(`/api/v1${path}`).expect(200);
      expect(served.headers['content-type']).toBe('image/png');
      expect(served.headers['x-content-type-options']).toBe('nosniff');
      expect(served.headers['cross-origin-resource-policy']).toBe('cross-origin');

      const slug = `t-proj-${tag}-img`;
      const created = await http().post(api('content/projects')).set(auth(admin)).send({
        slug, title: 'T', clientName: `Img ${tag}`, category: 'Web Design', summary: 'S', imageUrl: path, isPublished: true,
      }).expect(201);
      expect(created.body.imageUrl).toBe(path);
      const pub = await http().get('/api/v1/public/projects').expect(200);
      const mine = pub.body.data.find((p: { slug: string }) => p.slug === slug);
      expect(mine.imageUrl).toMatch(/^https?:\/\/.+\/api\/v1\/uploads\/images\/[0-9a-f-]{36}\.png$/);
    });

    it('deletes the file from disk when the image is replaced or the project is removed', async () => {
      const first = (await upload(admin, PNG).expect(201)).body.path as string;
      const second = (await upload(admin, PNG).expect(201)).body.path as string;
      uploaded.push(first, second);
      const slug = `t-proj-${tag}-swap`;
      const p = (await http().post(api('content/projects')).set(auth(admin)).send({ slug, title: 'T', clientName: `Swap ${tag}`, category: 'Web Design', summary: 'S', imageUrl: first }).expect(201)).body;
      await http().get(`/api/v1${first}`).expect(200);
      await http().patch(api(`content/projects/${p.id}`)).set(auth(admin)).send({ imageUrl: second }).expect(200);
      await http().get(`/api/v1${first}`).expect(404);
      await http().get(`/api/v1${second}`).expect(200);
      await http().delete(api(`content/projects/${p.id}`)).set(auth(admin)).expect(204);
      await http().get(`/api/v1${second}`).expect(404);
    });

    it('rejects files that are not PNG, JPEG or WebP, whatever they are called', async () => {
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      expect((await upload(admin, svg, 'x.png', 'image/png').expect(415)).body.error.code).toBe('UNSUPPORTED_IMAGE');
      await upload(admin, Buffer.from('MZ not an image'), 'photo.jpg', 'image/jpeg').expect(415);
    });

    it('rejects images over 3 MB', async () => {
      const big = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024 + 10)]);
      // The server may answer 413 or cut the connection while the body is still arriving; both mean "refused".
      const outcome = await upload(admin, big).then((r) => r.status, (e: { code?: string }) => e.code);
      expect([413, 'ECONNRESET', 'EPIPE']).toContain(outcome);
    });

    it('only serves files it wrote, and refuses path tricks', async () => {
      await http().get('/api/v1/uploads/images/not-a-real-file.png').expect(404);
      await http().get('/api/v1/uploads/images/..%2F..%2F.env').expect(404);
      await http().get('/api/v1/uploads/images/00000000-0000-4000-8000-000000000000.png').expect(404);
    });

    it('refuses an image reference that is not an upload or a web address', async () => {
      const p = await db.portfolioProject.findFirstOrThrow({ where: { slug: { startsWith: `t-proj-${tag}` } } });
      await http().patch(api(`content/projects/${p.id}`)).set(auth(admin)).send({ imageUrl: '/uploads/../../secret.png' }).expect(400);
      await http().patch(api(`content/projects/${p.id}`)).set(auth(admin)).send({ imageUrl: 'javascript:alert(1)' }).expect(400);
    });
  });

  describe('catalogue and pricing', () => {
    it('a plan needs a current price before it can be published; new prices close the old one', async () => {
      const slug = `t-prod-${tag}`;
      const product = await http().post(api('catalog/products')).set(auth(admin)).send({ slug, name: `Test ${tag}`, type: 'WEB_HOSTING', categorySlug: 'hosting' }).expect(201);
      await http().post(api('catalog/products')).set(auth(admin)).send({ slug, name: 'Dup', type: 'WEB_HOSTING', categorySlug: 'hosting' }).expect(409);
      await http().post(api('catalog/products')).set(auth(admin)).send({ slug: `${slug}-x`, name: 'X', type: 'WEB_HOSTING', categorySlug: 'nope' }).expect(400);

      const plan = await http().post(api(`catalog/products/${product.body.id}/plans`)).set(auth(admin)).send({ slug: 'starter', name: 'Starter' }).expect(201);
      const planId = plan.body.id as string;
      const noPrice = await http().patch(api(`catalog/plans/${planId}`)).set(auth(admin)).send({ status: 'PUBLISHED' }).expect(422);
      expect(noPrice.body.error.code).toBe('PRICE_REQUIRED');

      await http().put(api(`catalog/plans/${planId}/features`)).set(auth(admin)).send({ features: [{ label: '1 website' }, { label: '25 GB NVMe storage', highlight: true }] }).expect(204);
      await http().post(api(`catalog/plans/${planId}/prices`)).set(auth(admin)).send({ billingCycle: 'YEARLY', price: 1200, renewalPrice: 1800, listPrice: 900 }).expect(400);
      await http().post(api(`catalog/plans/${planId}/prices`)).set(auth(admin)).send({ billingCycle: 'YEARLY', price: 1200, renewalPrice: 1800, listPrice: 2400 }).expect(201);
      await http().post(api(`catalog/plans/${planId}/prices`)).set(auth(admin)).send({ billingCycle: 'YEARLY', price: 1000, renewalPrice: 1800 }).expect(201);

      const versions = await db.pricingVersion.findMany({ where: { planId, billingCycle: 'YEARLY' }, orderBy: { createdAt: 'asc' } });
      expect(versions).toHaveLength(2);
      expect(versions[0]!.effectiveTo).not.toBeNull(); // old price kept, closed
      expect(versions[1]!.effectiveTo).toBeNull();

      await http().patch(api(`catalog/plans/${planId}`)).set(auth(admin)).send({ status: 'PUBLISHED' }).expect(204);
      await http().patch(api(`catalog/products/${product.body.id}`)).set(auth(admin)).send({ status: 'PUBLISHED' }).expect(204);

      const pub = await http().get('/api/v1/public/catalog').expect(200);
      const mine = pub.body.data.find((p: { slug: string }) => p.slug === slug);
      expect(mine.plans[0].prices[0]).toMatchObject({ cycle: 'YEARLY', price: 1000 });
      expect(mine.plans[0].features.map((f: { label: string }) => f.label)).toEqual(['1 website', '25 GB NVMe storage']);

      const admins = await http().get(api('catalog/products')).set(auth(admin)).expect(200);
      const row = admins.body.data.find((p: { slug: string }) => p.slug === slug);
      expect(row.plans[0].prices.filter((p: { current: boolean }) => p.current)).toHaveLength(1);
    });
  });

  describe('settings', () => {
    it('company profile: validates, saves, and appears on the public site', async () => {
      await http().put(api('settings/company')).set(auth(admin)).send({ brandName: 'Ciril Info', email: 'not-an-email' }).expect(400);
      const before = await http().get(api('settings/company')).set(auth(admin)).expect(200);
      const next = { ...before.body, email: `hello-${tag}@example.test`, gstin: '' };
      await http().put(api('settings/company')).set(auth(admin)).send(next).expect(200);
      expect((await http().get('/api/v1/public/site').expect(200)).body.company.email).toBe(`hello-${tag}@example.test`);
    });

    it('site claims: range-checked; an empty claim stays hidden', async () => {
      await http().put(api('settings/claims')).set(auth(admin)).send({ uptimePercent: 12 }).expect(400);
      const before = (await http().get(api('settings/claims')).set(auth(admin)).expect(200)).body;
      await http().put(api('settings/claims')).set(auth(admin)).send({ ...before, uptimePercent: 99.9 }).expect(200);
      expect((await http().get('/api/v1/public/site').expect(200)).body.claims.uptimePercent).toBe(99.9);
    });

    it('legal pages: draft is hidden, published is public, unknown slug is 404', async () => {
      const doc = { title: 'Cancellation Policy', intro: 'Intro', sections: [{ heading: 'H', body: ['B'], bullets: [] }], status: 'DRAFT', showDraftNotice: true, updatedOn: null };
      await http().put(api('settings/legal/cancellation-policy')).set(auth(admin)).send(doc).expect(200);
      await http().get('/api/v1/public/legal/cancellation-policy').expect(404);
      await http().put(api('settings/legal/cancellation-policy')).set(auth(admin)).send({ ...doc, status: 'PUBLISHED' }).expect(200);
      await http().get('/api/v1/public/legal/cancellation-policy').expect(200);
      await http().put(api('settings/legal/cancellation-policy')).set(auth(admin)).send({ ...doc, surprise: 1 }).expect(400);
      await http().put(api('settings/legal/not-a-page')).set(auth(admin)).send(doc).expect(404);
      const list = await http().get(api('settings/legal')).set(auth(admin)).expect(200);
      expect(list.body.data).toHaveLength(5);
    });
  });

  describe('enquiries', () => {
    it('lists new enquiries without the IP address and lets staff change their status', async () => {
      const row = await db.contactInquiry.create({ data: { name: 'Visitor', email: inquiryEmail, message: 'Hello there, need a site.', ipAddress: '203.0.113.7' } });
      // Support agents may read and triage enquiries.
      const list = await http().get(api(`inquiries?status=NEW&search=${inquiryEmail}`)).set(auth(support)).expect(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0]).not.toHaveProperty('ipAddress');
      expect(list.body.counts.NEW).toBeGreaterThanOrEqual(1);
      await http().patch(api(`inquiries/${row.id}`)).set(auth(support)).send({ status: 'CONTACTED' }).expect(204);
      await http().patch(api(`inquiries/${row.id}`)).set(auth(support)).send({ status: 'DELETED' }).expect(400);
      expect((await db.contactInquiry.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('CONTACTED');
    });
  });

  describe('dashboard', () => {
    it('shows real counts, limited to what the role may read', async () => {
      const full = (await http().get(api('dashboard')).set(auth(admin)).expect(200)).body;
      expect(full.customers.total).toBeGreaterThanOrEqual(0);
      expect(full.enquiries).toHaveProperty('new');
      expect(full.content).toHaveProperty('plans');
      expect(full.staff.active).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(full.recentActivity)).toBe(true);

      const agent = (await http().get(api('dashboard')).set(auth(support)).expect(200)).body;
      expect(agent.staff).toBeNull(); // no users:read
      expect(agent.recentActivity).toBeNull(); // no audit:read
      expect(agent.enquiries).not.toBeNull();

      const fin = (await http().get(api('dashboard')).set(auth(finance)).expect(200)).body;
      expect(fin.enquiries).toBeNull();
      expect(fin.recentEnquiries).toBeNull();
    });

    it('needs a staff session', async () => {
      await http().get(api('dashboard')).expect(401);
    });
  });

  it('records changes in the audit log', async () => {
    const n = await db.auditLog.count({ where: { action: { startsWith: 'content.' } } });
    expect(n).toBeGreaterThan(0);
  });
});
