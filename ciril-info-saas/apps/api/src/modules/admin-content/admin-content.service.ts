import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import { page, skipTake } from '../../common/http/pagination.js';
import { UploadsService } from '../uploads/uploads.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser, RequestMeta } from '../auth/auth.types.js';
import { LEGAL_SLUGS, LEGAL_TITLES, legalDocumentSchema, legalKey, readLegalDocument, type LegalSlug } from '../settings/legal-documents.js';
import { SITE_CLAIMS_KEY, readSiteClaims, siteClaimsSchema } from '../settings/site-claims.js';
import type {
  FaqDto, FaqListQuery, FaqPatchDto, InquiryListQuery, PlanDto, PlanPatchDto, PriceDto, ProductDto, ProductPatchDto, ProjectDto,
  ProjectPatchDto, TestimonialDto, TestimonialPatchDto,
} from './admin-content.dto.js';
import type { ListQueryDto } from '../../common/http/pagination.js';

const num = (d: { toString(): string } | null | undefined) => (d == null ? null : Number(d.toString()));
const COMPANY_KEY = 'company.profile';

const optText = (max: number) => z.string().trim().max(max).default('');
export const companyProfileSchema = z
  .object({
    legalName: optText(160),
    brandName: z.string().trim().min(1, 'Enter the brand name.').max(120),
    email: z.union([z.literal(''), z.string().trim().email('Enter a valid email address.').max(254)]).default(''),
    phone: optText(32),
    whatsapp: optText(32),
    businessHours: optText(160),
    gstin: z.union([z.literal(''), z.string().trim().toUpperCase().regex(/^[0-9A-Z]{15}$/, 'GSTIN has 15 letters and digits.')]).default(''),
    invoicePrefix: z.string().trim().min(1).max(10).default('INV'),
    /** Where customers can pay by bank transfer or UPI. Printed on invoices and shown on an unpaid invoice. All optional. */
    bank: z
      .object({
        accountName: optText(120),
        bankName: optText(120),
        accountNumber: z.union([z.literal(''), z.string().trim().regex(/^\d{6,20}$/, 'The account number has 6 to 20 digits.')]).default(''),
        ifsc: z.union([z.literal(''), z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'An IFSC code is 4 letters, a 0, then 6 letters or digits.')]).default(''),
        upiId: z.union([z.literal(''), z.string().trim().regex(/^[\w.\-]{2,}@[A-Za-z]{2,}$/, 'A UPI ID looks like name@bank.')]).default(''),
      })
      .strict()
      .default({ accountName: '', bankName: '', accountNumber: '', ifsc: '', upiId: '' }),
    address: z
      .object({
        line1: optText(160), line2: optText(160), city: optText(80), state: optText(80), stateCode: optText(4),
        postalCode: optText(12), country: z.string().trim().length(2).toUpperCase().default('IN'),
      })
      .strict()
      .default({ line1: '', line2: '', city: '', state: '', stateCode: '', postalCode: '', country: 'IN' }),
  })
  .strict();

function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  throw new BadRequestException({
    code: 'VALIDATION_FAILED',
    message: 'Some fields need attention.',
    details: r.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
  });
}

/** Admin editing of everything the public website shows. All writes are audited. */
@Injectable()
export class AdminContentService {
  private readonly isProd: boolean;

  constructor(
    private readonly db: PlatformPrisma,
    private readonly audit: AuditService,
    private readonly uploads: UploadsService,
    config: ConfigService,
  ) {
    this.isProd = config.get('NODE_ENV') === 'production';
  }

  // ---------------------------------------------------------------- helpers
  private async run<T>(fn: () => Promise<T>, what: string): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'P2002') throw new ConflictException({ code: 'ALREADY_EXISTS', message: `${what} with this name or slug already exists.` });
      if (code === 'P2025') throw new NotFoundException({ code: 'NOT_FOUND', message: `${what} not found.` });
      throw e;
    }
  }
  private notFound(what: string): never {
    throw new NotFoundException({ code: 'NOT_FOUND', message: `${what} not found.` });
  }
  private log(user: AuthUser, meta: RequestMeta, action: string, entityType: string, entityId: string, metadata?: Record<string, unknown>) {
    return this.audit.record({ action, actorId: user.id, entityType, entityId, metadata, meta });
  }

  // ----------------------------------------------------------- testimonials
  async listTestimonials(q: ListQueryDto) {
    const where: Prisma.TestimonialWhereInput = q.search
      ? { OR: [{ quote: { contains: q.search, mode: 'insensitive' } }, { authorName: { contains: q.search, mode: 'insensitive' } }] }
      : {};
    const [rows, total] = await Promise.all([
      this.db.testimonial.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        ...skipTake(q),
      }),
      this.db.testimonial.count({ where }),
    ]);
    return page(rows, total, q);
  }

  private assertCanPublishTestimonial(t: { isPublished: boolean; consentConfirmed: boolean }) {
    if (t.isPublished && !t.consentConfirmed) {
      throw new UnprocessableEntityException({
        code: 'CONSENT_REQUIRED',
        message: 'Record the customer’s consent before publishing this testimonial.',
      });
    }
  }

  async createTestimonial(user: AuthUser, dto: TestimonialDto, meta: RequestMeta) {
    this.assertCanPublishTestimonial({ isPublished: !!dto.isPublished, consentConfirmed: !!dto.consentConfirmed });
    const row = await this.db.testimonial.create({
      data: { ...dto, publishedAt: dto.isPublished ? new Date() : null },
    });
    await this.log(user, meta, 'content.testimonial.create', 'testimonial', row.id, { published: row.isPublished });
    return row;
  }

  async updateTestimonial(user: AuthUser, id: string, dto: TestimonialPatchDto, meta: RequestMeta) {
    const cur = await this.db.testimonial.findUnique({ where: { id } });
    if (!cur) this.notFound('Testimonial');
    const next = { isPublished: dto.isPublished ?? cur.isPublished, consentConfirmed: dto.consentConfirmed ?? cur.consentConfirmed };
    this.assertCanPublishTestimonial(next);
    const row = await this.db.testimonial.update({
      where: { id },
      data: { ...dto, publishedAt: next.isPublished ? (cur.publishedAt ?? new Date()) : null },
    });
    await this.log(user, meta, 'content.testimonial.update', 'testimonial', id, { fields: Object.keys(dto), published: row.isPublished });
    return row;
  }

  async deleteTestimonial(user: AuthUser, id: string, meta: RequestMeta) {
    await this.run(() => this.db.testimonial.delete({ where: { id } }), 'Testimonial');
    await this.log(user, meta, 'content.testimonial.delete', 'testimonial', id);
  }

  // ------------------------------------------------------------------- FAQs
  async listFaqs(q: FaqListQuery) {
    const where: Prisma.FaqWhereInput = {
      ...(q.topic ? { topic: q.topic } : {}),
      ...(q.search ? { OR: [{ question: { contains: q.search, mode: 'insensitive' } }, { answer: { contains: q.search, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total, topics] = await Promise.all([
      this.db.faq.findMany({ where, orderBy: [{ topic: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }], ...skipTake(q) }),
      this.db.faq.count({ where }),
      this.db.faq.groupBy({ by: ['topic'], _count: true, orderBy: { topic: 'asc' } }),
    ]);
    return { ...page(rows, total, q), topics: topics.map((t) => ({ topic: t.topic, count: t._count })) };
  }

  async createFaq(user: AuthUser, dto: FaqDto, meta: RequestMeta) {
    const row = await this.db.faq.create({ data: dto });
    await this.log(user, meta, 'content.faq.create', 'faq', row.id, { topic: row.topic });
    return row;
  }

  async updateFaq(user: AuthUser, id: string, dto: FaqPatchDto, meta: RequestMeta) {
    const row = await this.run(() => this.db.faq.update({ where: { id }, data: dto }), 'FAQ');
    await this.log(user, meta, 'content.faq.update', 'faq', id, { fields: Object.keys(dto) });
    return row;
  }

  async deleteFaq(user: AuthUser, id: string, meta: RequestMeta) {
    await this.run(() => this.db.faq.delete({ where: { id } }), 'FAQ');
    await this.log(user, meta, 'content.faq.delete', 'faq', id);
  }

  // --------------------------------------------------------------- projects
  async listProjects(q: ListQueryDto) {
    const where: Prisma.PortfolioProjectWhereInput = q.search
      ? { OR: [{ title: { contains: q.search, mode: 'insensitive' } }, { clientName: { contains: q.search, mode: 'insensitive' } }] }
      : {};
    const [rows, total] = await Promise.all([
      this.db.portfolioProject.findMany({ where, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }], ...skipTake(q) }),
      this.db.portfolioProject.count({ where }),
    ]);
    return page(rows, total, q);
  }

  async createProject(user: AuthUser, dto: ProjectDto, meta: RequestMeta) {
    const row = await this.run(() => this.db.portfolioProject.create({ data: dto }), 'Project');
    await this.log(user, meta, 'content.project.create', 'project', row.id, { slug: row.slug });
    return row;
  }

  /** Removes an uploaded image from disk once no project refers to it. */
  private async dropImageIfUnused(ref: string | null | undefined) {
    if (!ref?.startsWith('/uploads/')) return;
    if ((await this.db.portfolioProject.count({ where: { imageUrl: ref } })) === 0) await this.uploads.remove(ref);
  }

  async updateProject(user: AuthUser, id: string, dto: ProjectPatchDto, meta: RequestMeta) {
    const before = await this.db.portfolioProject.findUnique({ where: { id }, select: { imageUrl: true } });
    const row = await this.run(() => this.db.portfolioProject.update({ where: { id }, data: dto }), 'Project');
    if (before && before.imageUrl !== row.imageUrl) await this.dropImageIfUnused(before.imageUrl);
    await this.log(user, meta, 'content.project.update', 'project', id, { fields: Object.keys(dto), published: row.isPublished });
    return row;
  }

  async deleteProject(user: AuthUser, id: string, meta: RequestMeta) {
    const row = await this.run(() => this.db.portfolioProject.delete({ where: { id } }), 'Project');
    await this.dropImageIfUnused(row.imageUrl);
    await this.log(user, meta, 'content.project.delete', 'project', id);
  }

  // -------------------------------------------------------------- catalogue
  categories() {
    return this.db.productCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { slug: true, name: true } }).then((data) => ({ data }));
  }

  async listProducts() {
    const now = new Date();
    const products = await this.db.product.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        category: { select: { slug: true, name: true } },
        plans: {
          orderBy: { sortOrder: 'asc' },
          include: {
            features: { orderBy: { sortOrder: 'asc' } },
            pricingVersions: { orderBy: [{ billingCycle: 'asc' }, { effectiveFrom: 'desc' }] },
          },
        },
      },
    });
    return {
      data: products.map((p) => ({
        id: p.id, slug: p.slug, name: p.name, type: p.type, tagline: p.tagline, description: p.description, status: p.status,
        sortOrder: p.sortOrder, category: p.category,
        plans: p.plans.map((pl) => ({
          id: pl.id, slug: pl.slug, name: pl.name, description: pl.description, isFeatured: pl.isFeatured, status: pl.status,
          sortOrder: pl.sortOrder, isSample: pl.isSample,
          features: pl.features.map((f) => ({ label: f.label, value: f.value, highlight: f.highlight })),
          prices: pl.pricingVersions.map((v) => ({
            id: v.id, billingCycle: v.billingCycle, currency: v.currency, price: num(v.price)!, renewalPrice: num(v.renewalPrice)!,
            listPrice: num(v.listPrice), setupFee: num(v.setupFee)!, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo,
            current: v.effectiveFrom <= now && (!v.effectiveTo || v.effectiveTo > now),
          })),
        })),
      })),
    };
  }

  async createProduct(user: AuthUser, dto: ProductDto, meta: RequestMeta) {
    const category = await this.db.productCategory.findUnique({ where: { slug: dto.categorySlug } });
    if (!category) throw new BadRequestException({ code: 'UNKNOWN_CATEGORY', message: 'Choose an existing category.' });
    const { categorySlug: _c, ...rest } = dto;
    const row = await this.run(() => this.db.product.create({ data: { ...rest, categoryId: category.id } }), 'Product');
    await this.log(user, meta, 'catalog.product.create', 'product', row.id, { slug: row.slug });
    return { id: row.id };
  }

  async updateProduct(user: AuthUser, id: string, dto: ProductPatchDto, meta: RequestMeta) {
    await this.run(() => this.db.product.update({ where: { id }, data: dto }), 'Product');
    await this.log(user, meta, 'catalog.product.update', 'product', id, { fields: Object.keys(dto), status: dto.status });
  }

  async createPlan(user: AuthUser, productId: string, dto: PlanDto, meta: RequestMeta) {
    if (dto.status === 'PUBLISHED') {
      throw new UnprocessableEntityException({ code: 'PRICE_REQUIRED', message: 'Add a price first, then publish the plan.' });
    }
    const row = await this.run(() => this.db.plan.create({ data: { ...dto, productId } }), 'Plan');
    await this.log(user, meta, 'catalog.plan.create', 'plan', row.id, { slug: row.slug });
    return { id: row.id };
  }

  async updatePlan(user: AuthUser, id: string, dto: PlanPatchDto, meta: RequestMeta) {
    const plan = await this.db.plan.findUnique({ where: { id }, include: { pricingVersions: true } });
    if (!plan) this.notFound('Plan');
    if (dto.status === 'PUBLISHED' && plan.status !== 'PUBLISHED') {
      if (plan.isSample && this.isProd) {
        throw new UnprocessableEntityException({ code: 'SAMPLE_NOT_PUBLISHABLE', message: 'Sample plans cannot be published in production.' });
      }
      const now = new Date();
      const hasPrice = plan.pricingVersions.some((v) => v.effectiveFrom <= now && (!v.effectiveTo || v.effectiveTo > now));
      if (!hasPrice) throw new UnprocessableEntityException({ code: 'PRICE_REQUIRED', message: 'Add a current price before publishing this plan.' });
    }
    await this.db.plan.update({ where: { id }, data: dto });
    await this.log(user, meta, 'catalog.plan.update', 'plan', id, { fields: Object.keys(dto), status: dto.status });
  }

  async setFeatures(user: AuthUser, planId: string, features: { label: string; value?: string | null; highlight?: boolean }[], meta: RequestMeta) {
    await this.run(
      () =>
        this.db.$transaction([
          this.db.plan.findUniqueOrThrow({ where: { id: planId }, select: { id: true } }),
          this.db.planFeature.deleteMany({ where: { planId } }),
          this.db.planFeature.createMany({
            data: features.map((f, i) => ({ planId, label: f.label, value: f.value ?? null, highlight: !!f.highlight, sortOrder: i })),
          }),
        ]),
      'Plan',
    );
    await this.log(user, meta, 'catalog.plan.features', 'plan', planId, { count: features.length });
  }

  /**
   * Adds a new price for a billing cycle. The price that is current is closed (effective_to = now), never edited,
   * so invoices and subscriptions keep pointing at the price they were sold at.
   */
  async addPrice(user: AuthUser, planId: string, dto: PriceDto, meta: RequestMeta) {
    if (dto.listPrice != null && dto.listPrice < dto.price) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The list price must not be lower than the price.', details: [{ field: 'listPrice', message: 'List price must be at least the price.' }] });
    }
    const id = await this.db.$transaction(async (tx) => {
      const plan = await tx.plan.findUnique({ where: { id: planId }, select: { id: true } });
      if (!plan) this.notFound('Plan');
      const now = new Date();
      await tx.pricingVersion.updateMany({
        where: { planId, billingCycle: dto.billingCycle, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
        data: { effectiveTo: now },
      });
      const v = await tx.pricingVersion.create({
        data: {
          planId, billingCycle: dto.billingCycle, price: dto.price, renewalPrice: dto.renewalPrice, listPrice: dto.listPrice ?? null,
          setupFee: dto.setupFee ?? 0, effectiveFrom: now,
        },
      });
      return v.id;
    });
    await this.log(user, meta, 'catalog.price.add', 'plan', planId, { cycle: dto.billingCycle, price: dto.price, renewalPrice: dto.renewalPrice });
    return { id };
  }

  // ---------------------------------------------------------------- settings
  async getCompany() {
    const row = await this.db.systemSetting.findUnique({ where: { key: COMPANY_KEY } });
    const { _sample: _s, ...value } = (row?.value ?? {}) as Record<string, unknown>;
    const parsed = companyProfileSchema.safeParse({ brandName: 'Ciril Info', ...value });
    return parsed.success ? parsed.data : companyProfileSchema.parse({ brandName: 'Ciril Info' });
  }

  async setCompany(user: AuthUser, input: unknown, meta: RequestMeta) {
    const value = parseOrThrow(companyProfileSchema, input);
    await this.db.systemSetting.upsert({
      where: { key: COMPANY_KEY },
      update: { value, updatedById: user.id },
      create: { key: COMPANY_KEY, value, updatedById: user.id },
    });
    await this.log(user, meta, 'settings.company.update', 'setting', COMPANY_KEY);
    return value;
  }

  async getClaims() {
    const row = await this.db.systemSetting.findUnique({ where: { key: SITE_CLAIMS_KEY } });
    return readSiteClaims(row?.value);
  }

  async setClaims(user: AuthUser, input: unknown, meta: RequestMeta) {
    const value = parseOrThrow(siteClaimsSchema, input);
    await this.db.systemSetting.upsert({
      where: { key: SITE_CLAIMS_KEY },
      update: { value, updatedById: user.id },
      create: { key: SITE_CLAIMS_KEY, value, updatedById: user.id },
    });
    await this.log(user, meta, 'settings.claims.update', 'setting', SITE_CLAIMS_KEY);
    return value;
  }

  async listLegal() {
    const rows = await this.db.systemSetting.findMany({ where: { key: { in: LEGAL_SLUGS.map(legalKey) } } });
    return {
      data: LEGAL_SLUGS.map((slug) => {
        const row = rows.find((r) => r.key === legalKey(slug));
        const doc = readLegalDocument(row?.value);
        return { slug, title: LEGAL_TITLES[slug], status: doc?.status ?? 'NOT_STARTED', updatedAt: row?.updatedAt ?? null };
      }),
    };
  }

  private assertLegalSlug(slug: string): asserts slug is LegalSlug {
    if (!(LEGAL_SLUGS as readonly string[]).includes(slug)) this.notFound('Page');
  }

  async getLegal(slug: string) {
    this.assertLegalSlug(slug);
    const row = await this.db.systemSetting.findUnique({ where: { key: legalKey(slug) } });
    const doc = readLegalDocument(row?.value);
    return { slug, ...(doc ?? legalDocumentSchema.parse({ title: LEGAL_TITLES[slug] })), exists: !!doc };
  }

  async setLegal(user: AuthUser, slug: string, input: unknown, meta: RequestMeta) {
    this.assertLegalSlug(slug);
    const value = parseOrThrow(legalDocumentSchema, input);
    await this.db.systemSetting.upsert({
      where: { key: legalKey(slug) },
      update: { value, updatedById: user.id },
      create: { key: legalKey(slug), value, updatedById: user.id },
    });
    await this.log(user, meta, 'settings.legal.update', 'setting', legalKey(slug), { status: value.status });
    return { slug, ...value, exists: true };
  }

  // -------------------------------------------------------------- inquiries
  async listInquiries(q: InquiryListQuery) {
    const where: Prisma.ContactInquiryWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }, { message: { contains: q.search, mode: 'insensitive' } }] }
        : {}),
    };
    const [rows, total, counts] = await Promise.all([
      this.db.contactInquiry.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q) }),
      this.db.contactInquiry.count({ where }),
      this.db.contactInquiry.groupBy({ by: ['status'], _count: true }),
    ]);
    return {
      ...page(rows.map(({ ipAddress: _ip, ...r }) => r), total, q),
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
    };
  }

  async setInquiryStatus(user: AuthUser, id: string, status: InquiryListQuery['status'] & string, meta: RequestMeta) {
    await this.run(() => this.db.contactInquiry.update({ where: { id }, data: { status } }), 'Enquiry');
    await this.log(user, meta, 'inquiry.status', 'inquiry', id, { status });
  }
}
