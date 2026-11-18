import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { createTestApp, platformDb } from './utils.js';

/**
 * Public website API: only published, consented, currently-priced content is exposed,
 * and enquiries are validated, stored and bot-filtered. Uses its own uniquely-named rows
 * and removes them afterwards, so it is safe against a database that has sample data.
 */
describe('Public website API (e2e)', () => {
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  const tag = randomUUID().slice(0, 8);
  const get = (path: string) => request(app.getHttpServer()).get(`/api/v1/public/${path}`);
  const slugs = { product: `t-prod-${tag}`, project: `t-proj-${tag}` };
  let legalBackup: { key: string; value: unknown }[] = [];
  const inquiryEmails: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    db = platformDb();

    const category = await db.productCategory.upsert({ where: { slug: 'hosting' }, update: {}, create: { slug: 'hosting', name: 'Hosting' } });
    const product = await db.product.create({
      data: { categoryId: category.id, slug: slugs.product, name: `Test Product ${tag}`, type: 'WEB_HOSTING', status: 'PUBLISHED' },
    });
    const price = (extra: object = {}) => ({ billingCycle: 'YEARLY' as const, price: 1200, renewalPrice: 1800, listPrice: 2400, ...extra });
    await db.plan.create({
      data: {
        productId: product.id, slug: 'visible', name: 'Visible', status: 'PUBLISHED',
        features: { create: [{ label: '1 website', sortOrder: 0 }] },
        pricingVersions: { create: [price(), price({ billingCycle: 'MONTHLY', price: 249, renewalPrice: 249, listPrice: null })] },
      },
    });
    // Published but no price → not shown.
    await db.plan.create({ data: { productId: product.id, slug: 'no-price', name: 'No price', status: 'PUBLISHED' } });
    // Draft → not shown.
    await db.plan.create({ data: { productId: product.id, slug: 'draft', name: 'Draft', status: 'DRAFT', pricingVersions: { create: [price()] } } });
    // Only an expired price → not shown.
    await db.plan.create({
      data: {
        productId: product.id, slug: 'expired', name: 'Expired', status: 'PUBLISHED',
        pricingVersions: { create: [price({ effectiveFrom: new Date('2020-01-01'), effectiveTo: new Date('2021-01-01') })] },
      },
    });

    await db.testimonial.createMany({
      data: [
        { quote: `shown ${tag}`, authorName: 'A', isPublished: true, consentConfirmed: true, placements: ['pricing'] },
        { quote: `hidden-draft ${tag}`, authorName: 'B', isPublished: false, consentConfirmed: true },
      ],
    });
    await db.faq.createMany({
      data: [
        { topic: `t-${tag}`, question: 'Shown?', answer: 'Yes.', isPublished: true },
        { topic: `t-${tag}`, question: 'Hidden?', answer: 'No.', isPublished: false },
      ],
    });
    await db.portfolioProject.createMany({
      data: [
        { slug: slugs.project, title: 'T', clientName: `Client ${tag}`, category: 'Web Design', summary: 's', isPublished: true, scope: ['One'] },
        { slug: `${slugs.project}-draft`, title: 'T', clientName: `Draft ${tag}`, category: 'Web Design', summary: 's', isPublished: false },
      ],
    });

    legalBackup = await db.systemSetting.findMany({ where: { key: { in: ['legal.sla', 'legal.refund-policy'] } }, select: { key: true, value: true } });
    const doc = (status: 'DRAFT' | 'PUBLISHED') => ({ title: 'Doc', intro: 'Intro', sections: [{ heading: 'H', body: ['Body'], bullets: [] }], status, showDraftNotice: false, updatedOn: null });
    await db.systemSetting.upsert({ where: { key: 'legal.sla' }, update: { value: doc('PUBLISHED') }, create: { key: 'legal.sla', value: doc('PUBLISHED') } });
    await db.systemSetting.upsert({ where: { key: 'legal.refund-policy' }, update: { value: doc('DRAFT') }, create: { key: 'legal.refund-policy', value: doc('DRAFT') } });
  });

  afterAll(async () => {
    const planIds = (await db.plan.findMany({ where: { product: { slug: slugs.product } }, select: { id: true } })).map((p) => p.id);
    await db.pricingVersion.deleteMany({ where: { planId: { in: planIds } } });
    await db.planFeature.deleteMany({ where: { planId: { in: planIds } } });
    await db.plan.deleteMany({ where: { id: { in: planIds } } });
    await db.product.deleteMany({ where: { slug: slugs.product } });
    await db.testimonial.deleteMany({ where: { quote: { contains: tag } } });
    await db.faq.deleteMany({ where: { topic: `t-${tag}` } });
    await db.portfolioProject.deleteMany({ where: { slug: { startsWith: slugs.project } } });
    for (const key of ['legal.sla', 'legal.refund-policy']) {
      const before = legalBackup.find((b) => b.key === key);
      if (before) await db.systemSetting.update({ where: { key }, data: { value: before.value as object } });
      else await db.systemSetting.deleteMany({ where: { key } });
    }
    await db.contactInquiry.deleteMany({ where: { email: { in: inquiryEmails } } });
    await app.close();
  });

  it('GET /public/site is open and never returns unset values as invented text', async () => {
    const res = await get('site').expect(200);
    expect(res.body.company).toHaveProperty('email');
    expect(res.body.claims).toHaveProperty('uptimePercent');
    // Only the published legal page is listed.
    const slugsListed = res.body.legal.map((l: { slug: string }) => l.slug);
    expect(slugsListed).toContain('sla');
    expect(slugsListed).not.toContain('refund-policy');
  });

  it('catalog shows only published plans that have a current price, with per-cycle prices', async () => {
    const res = await get('catalog').expect(200);
    const product = res.body.data.find((p: { slug: string }) => p.slug === slugs.product);
    expect(product).toBeDefined();
    expect(product.plans.map((p: { slug: string }) => p.slug)).toEqual(['visible']);
    const yearly = product.plans[0].prices.find((p: { cycle: string }) => p.cycle === 'YEARLY');
    expect(yearly).toMatchObject({ price: 1200, renewalPrice: 1800, listPrice: 2400, currency: 'INR' });
    expect(product.plans[0].prices).toHaveLength(2);
  });

  it('testimonials: only published and consented ones; placement filter applies', async () => {
    const all = (await get('testimonials').expect(200)).body.data.map((t: { quote: string }) => t.quote);
    expect(all.some((q: string) => q === `shown ${tag}`)).toBe(true);
    expect(all.some((q: string) => q.startsWith('hidden-draft'))).toBe(false);
    const home = (await get('testimonials?placement=home').expect(200)).body.data.map((t: { quote: string }) => t.quote);
    expect(home).not.toContain(`shown ${tag}`);
    const pricing = (await get('testimonials?placement=pricing').expect(200)).body.data.map((t: { quote: string }) => t.quote);
    expect(pricing).toContain(`shown ${tag}`);
  });

  it('the database refuses to publish a testimonial without recorded consent', async () => {
    await expect(
      db.testimonial.create({ data: { quote: `no-consent ${tag}`, authorName: 'X', isPublished: true, consentConfirmed: false } }),
    ).rejects.toThrow();
  });

  it('FAQs: unpublished are hidden, topic filter applies, bad topic is rejected', async () => {
    const res = await get(`faqs?topic=t-${tag}`).expect(200);
    expect(res.body.data.map((f: { question: string }) => f.question)).toEqual(['Shown?']);
    await get('faqs?topic=NOT%20VALID!').expect(400);
  });

  it('projects: only published, with scope', async () => {
    const res = await get('projects').expect(200);
    const mine = res.body.data.filter((p: { slug: string }) => p.slug.startsWith(slugs.project));
    expect(mine.map((p: { slug: string }) => p.slug)).toEqual([slugs.project]);
    expect(mine[0].scope).toEqual(['One']);
  });

  it('legal: published is served; draft and unknown are 404', async () => {
    const ok = await get('legal/sla').expect(200);
    expect(ok.body).toMatchObject({ slug: 'sla', title: 'Doc', status: 'PUBLISHED' });
    const draft = await get('legal/refund-policy').expect(404);
    expect(draft.body.error.code).toBe('NOT_PUBLISHED');
    await get('legal/not-a-page').expect(404);
  });

  describe('POST /public/inquiries', () => {
    const base = () => ({
      name: 'Test Visitor',
      email: `inq-${randomUUID().slice(0, 8)}@example.test`,
      service: 'Web Design',
      message: 'We would like a new website for our studio.',
      consent: true,
    });
    const post = (body: object) => request(app.getHttpServer()).post('/api/v1/public/inquiries').send(body);

    it('stores a valid enquiry with the consent time', async () => {
      const body = base();
      inquiryEmails.push(body.email);
      await post(body).expect(201, { received: true });
      const row = await db.contactInquiry.findFirst({ where: { email: body.email } });
      expect(row).toMatchObject({ name: 'Test Visitor', service: 'Web Design', status: 'NEW' });
      expect(row!.consentAt).toBeInstanceOf(Date);
    });

    it('rejects a missing consent, an unknown service and a too-short message', async () => {
      expect((await post({ ...base(), consent: false }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
      await post({ ...base(), service: 'Hacking' }).expect(400);
      await post({ ...base(), message: 'short' }).expect(400);
      await post({ ...base(), email: 'not-an-email' }).expect(400);
    });

    it('rejects unexpected fields (no mass assignment)', async () => {
      await post({ ...base(), status: 'CLOSED' }).expect(400);
    });

    it('silently ignores bot submissions that fill the hidden field', async () => {
      const body = { ...base(), website: 'http://spam.example' };
      inquiryEmails.push(body.email);
      await post(body).expect(201, { received: true });
      expect(await db.contactInquiry.count({ where: { email: body.email } })).toBe(0);
    });
  });
});
