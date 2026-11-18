import { Injectable, NotFoundException } from '@nestjs/common';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import { LEGAL_SLUGS, LEGAL_TITLES, legalKey, readLegalDocument, type LegalSlug } from '../settings/legal-documents.js';
import { SITE_CLAIMS_KEY, readSiteClaims } from '../settings/site-claims.js';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import type { CreateInquiryDto } from './public.dto.js';

const num = (d: { toString(): string } | null | undefined) => (d == null ? null : Number(d.toString()));
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Public, unauthenticated reads. Only PUBLISHED content is ever returned. */
@Injectable()
export class PublicService {
  private readonly apiUrl: string;

  constructor(
    private readonly db: PlatformPrisma,
    config: ConfigService<Env, true>,
  ) {
    this.apiUrl = config.get('API_URL', { infer: true }).replace(/\/$/, '');
  }

  /** Uploaded images are stored as "/uploads/images/…"; the website needs a full address. */
  private imageUrl(ref: string | null): string | null {
    return ref?.startsWith('/uploads/') ? `${this.apiUrl}/api/v1${ref}` : ref;
  }

  /** Company contact details and website claims. Null means "not set": the site shows "to be added". */
  async site() {
    const [profile, claims, legalRows] = await Promise.all([
      this.db.systemSetting.findUnique({ where: { key: 'company.profile' } }),
      this.db.systemSetting.findUnique({ where: { key: SITE_CLAIMS_KEY } }),
      this.db.systemSetting.findMany({ where: { key: { in: LEGAL_SLUGS.map(legalKey) } } }),
    ]);
    const p = (profile?.value ?? {}) as Record<string, unknown>;
    const a = (p['address'] ?? {}) as Record<string, unknown>;
    const address =
      ['line1', 'line2', 'city', 'state', 'postalCode']
        .map((k) => str(a[k]))
        .filter(Boolean)
        .join(', ') || null;
    const legal = legalRows
      .map((r) => ({ slug: r.key.replace(/^legal\./, '') as LegalSlug, doc: readLegalDocument(r.value) }))
      .filter((x) => x.doc?.status === 'PUBLISHED')
      .map((x) => ({ slug: x.slug, title: LEGAL_TITLES[x.slug] }));
    return {
      company: {
        name: str(p['brandName']) ?? 'Ciril Info',
        email: str(p['email']),
        phone: str(p['phone']),
        whatsapp: str(p['whatsapp']),
        address,
        hours: str(p['businessHours']),
      },
      claims: readSiteClaims(claims?.value),
      legal,
    };
  }

  /** Published product lines with their published plans and the current prices. */
  async catalog() {
    const now = new Date();
    const products = await this.db.product.findMany({
      where: { status: 'PUBLISHED', plans: { some: { status: 'PUBLISHED' } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        category: { select: { slug: true, name: true } },
        plans: {
          where: { status: 'PUBLISHED' },
          orderBy: { sortOrder: 'asc' },
          include: {
            features: { orderBy: { sortOrder: 'asc' } },
            pricingVersions: {
              where: { effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
              orderBy: { effectiveFrom: 'desc' },
            },
          },
        },
      },
    });
    return {
      data: products
        .map((pr) => ({
          slug: pr.slug,
          name: pr.name,
          type: pr.type,
          category: pr.category.slug,
          tagline: pr.tagline,
          description: pr.description,
          plans: pr.plans
            .map((pl) => {
              // Newest effective price per billing cycle.
              const byCycle = new Map<string, (typeof pl.pricingVersions)[number]>();
              for (const v of pl.pricingVersions) if (!byCycle.has(v.billingCycle)) byCycle.set(v.billingCycle, v);
              return {
                slug: pl.slug,
                name: pl.name,
                description: pl.description,
                isFeatured: pl.isFeatured,
                features: pl.features.map((f) => ({ label: f.label, value: f.value, highlight: f.highlight })),
                prices: [...byCycle.values()].map((v) => ({
                  cycle: v.billingCycle,
                  currency: v.currency,
                  price: num(v.price)!,
                  renewalPrice: num(v.renewalPrice)!,
                  listPrice: num(v.listPrice),
                  setupFee: num(v.setupFee)!,
                })),
              };
            })
            // A plan without a current price cannot be bought, so it is not shown.
            .filter((pl) => pl.prices.length > 0),
        }))
        .filter((pr) => pr.plans.length > 0),
    };
  }

  async testimonials(placement?: string) {
    const rows = await this.db.testimonial.findMany({
      where: { isPublished: true, consentConfirmed: true },
      orderBy: [{ sortOrder: 'asc' }, { publishedAt: 'desc' }],
      take: 24,
    });
    const shown = rows.filter((t) => !placement || t.placements.length === 0 || t.placements.includes(placement));
    return {
      data: shown.map((t) => ({
        id: t.id,
        quote: t.quote,
        authorName: t.authorName,
        authorRole: t.authorRole,
        rating: t.rating,
        isSample: t.isSample,
      })),
    };
  }

  async faqs(topic?: string) {
    const rows = await this.db.faq.findMany({
      where: { isPublished: true, ...(topic ? { topic } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      take: 100,
    });
    return { data: rows.map((f) => ({ id: f.id, topic: f.topic, question: f.question, answer: f.answer })) };
  }

  async projects() {
    const rows = await this.db.portfolioProject.findMany({
      where: { isPublished: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      take: 100,
    });
    return {
      data: rows.map((p) => ({
        slug: p.slug,
        title: p.title,
        clientName: p.clientName,
        category: p.category,
        summary: p.summary,
        description: p.description,
        scope: p.scope,
        tags: p.tags,
        imageUrl: this.imageUrl(p.imageUrl),
        projectUrl: p.projectUrl,
        isSample: p.isSample,
      })),
    };
  }

  async legal(slug: string) {
    if (!(LEGAL_SLUGS as readonly string[]).includes(slug)) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Page not found.' });
    }
    const row = await this.db.systemSetting.findUnique({ where: { key: legalKey(slug as LegalSlug) } });
    const doc = readLegalDocument(row?.value);
    if (!doc || doc.status !== 'PUBLISHED') {
      throw new NotFoundException({ code: 'NOT_PUBLISHED', message: 'This page has not been published yet.' });
    }
    return { slug, ...doc };
  }

  /** Stores an enquiry. Bots that fill the hidden field get a normal-looking response and nothing is saved. */
  async createInquiry(dto: CreateInquiryDto, ip: string | undefined) {
    if (dto.website) return { received: true };
    await this.db.contactInquiry.create({
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone || null,
        company: dto.company || null,
        service: dto.service,
        budget: dto.budget || null,
        message: dto.message,
        ipAddress: ip && /^[0-9a-f:.]+$/i.test(ip) ? ip : null,
      },
    });
    return { received: true };
  }
}
