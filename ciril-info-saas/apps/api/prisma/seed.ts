/**
 * Idempotent seed. Safe to run repeatedly (`npm run db:seed`).
 *
 * Every environment:
 *  - RBAC roles + permissions (synced with src/modules/rbac/permissions.ts)
 *  - Super Admin, created once from SEED_SUPERADMIN_EMAIL / SEED_SUPERADMIN_PASSWORD
 *  - Product lines (DRAFT, no plans, no prices) — real pricing is entered in the admin portal
 *  - Default GST rate and an empty company profile
 *
 * Development only, when SEED_SAMPLE_DATA=true (refused in production):
 *  - Sample plans/prices, testimonials and FAQs, all flagged is_sample
 *  - Mock hosting server and mock registrar
 *
 * `npm run db:purge-samples` deletes all sample rows.
 *
 * Runs as the platform role (RLS bypass) because it writes global + platform data.
 */
import { config } from 'dotenv';
import argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../src/generated/prisma/client.js';
import {
  ALL_PLATFORM_PERMISSIONS,
  ALL_TENANT_PERMISSIONS,
  PLATFORM_PERMISSIONS,
  PLATFORM_ROLES,
  TENANT_PERMISSIONS,
  TENANT_ROLES,
  resolvePermissions,
} from '../src/modules/rbac/permissions.js';
import { EMPTY_SITE_CLAIMS, SITE_CLAIMS_KEY, readSiteClaims } from '../src/modules/settings/site-claims.js';
import { LEGAL_DRAFTS } from './seed-data/legal.js';
import { PRODUCT_LINES } from './seed-data/product-lines.js';
import {
  SAMPLE_EMAIL_PLANS,
  SAMPLE_FAQS,
  SAMPLE_KB,
  SAMPLE_HOSTING,
  SAMPLE_SITE_CLAIMS,
  SAMPLE_TESTIMONIALS,
  SAMPLE_PROJECTS,
  SAMPLE_TLD_PRICING,
} from './seed-data/samples.js';

config({ path: ['.env', '../../.env'], quiet: true });

const url = process.env['DATABASE_URL_PLATFORM'];
if (!url) throw new Error('DATABASE_URL_PLATFORM is not set');
const isProd = process.env['NODE_ENV'] === 'production';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
const D = (n: number) => new Prisma.Decimal(n.toFixed(2));
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// ─────────────────────────── RBAC ───────────────────────────

async function seedRbac() {
  const permIds = new Map<string, string>();
  for (const [key, description] of Object.entries(PLATFORM_PERMISSIONS)) {
    const p = await prisma.permission.upsert({
      where: { key: `platform:${key}` },
      update: { description },
      create: { key: `platform:${key}`, description, scope: 'PLATFORM' },
    });
    permIds.set(`platform:${key}`, p.id);
  }
  for (const [key, description] of Object.entries(TENANT_PERMISSIONS)) {
    const p = await prisma.permission.upsert({
      where: { key: `tenant:${key}` },
      update: { description },
      create: { key: `tenant:${key}`, description, scope: 'TENANT' },
    });
    permIds.set(`tenant:${key}`, p.id);
  }

  const sync = async (scope: 'PLATFORM' | 'TENANT', key: string, name: string, description: string, perms: string[]) => {
    const role = await prisma.role.upsert({
      where: { key },
      update: { name, description, scope },
      create: { key, name, description, scope, isSystem: true },
    });
    const prefix = scope === 'PLATFORM' ? 'platform:' : 'tenant:';
    const wanted = perms.map((p) => permIds.get(prefix + p)!);
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: { notIn: wanted } } }),
      prisma.rolePermission.createMany({
        data: wanted.map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      }),
    ]);
  };

  for (const r of PLATFORM_ROLES) await sync('PLATFORM', r.key, r.name, r.description, resolvePermissions(r, ALL_PLATFORM_PERMISSIONS));
  for (const r of TENANT_ROLES) await sync('TENANT', r.key, r.name, r.description, resolvePermissions(r, ALL_TENANT_PERMISSIONS));
  console.log(`✓ RBAC: ${PLATFORM_ROLES.length + TENANT_ROLES.length} roles, ${permIds.size} permissions`);
}

async function seedSuperAdmin() {
  const email = (process.env['SEED_SUPERADMIN_EMAIL'] ?? '').trim().toLowerCase();
  const password = process.env['SEED_SUPERADMIN_PASSWORD'] ?? '';
  if (!email) return console.log('• Super Admin: SEED_SUPERADMIN_EMAIL not set, skipped');
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return console.log(`• Super Admin: ${email} already exists, unchanged`);
  if (password.length < 12) throw new Error('SEED_SUPERADMIN_PASSWORD must be at least 12 characters');

  const role = await prisma.role.findUniqueOrThrow({ where: { key: 'SUPER_ADMIN' } });
  await prisma.user.create({
    data: {
      email,
      firstName: 'Super',
      lastName: 'Admin',
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      platformRoleId: role.id,
      emailVerifiedAt: new Date(),
      // Null forces a password change on first login (see auth module).
      passwordChangedAt: null,
    },
  });
  console.log(`✓ Super Admin created: ${email}`);
}

// ─────────────────────────── Catalogue structure (all environments) ───────────────────────────

async function seedCatalogStructure() {
  const category = async (slug: string, name: string, sortOrder: number, description?: string) =>
    prisma.productCategory.upsert({ where: { slug }, update: {}, create: { slug, name, sortOrder, description } });

  const cats = {
    hosting: await category('hosting', 'Hosting', 1, 'Web, WordPress, cloud and VPS hosting'),
    domains: await category('domains', 'Domains', 2, 'Registration and transfer'),
    email: await category('email', 'Business Email', 3, 'Mailboxes on your domain'),
    services: await category('services', 'Services', 4, 'Design, development, maintenance and marketing'),
  };

  let created = 0;
  for (const [i, p] of PRODUCT_LINES.entries()) {
    if (await prisma.product.findUnique({ where: { slug: p.slug } })) continue;
    await prisma.product.create({
      data: { categoryId: cats[p.category].id, slug: p.slug, name: p.name, type: p.type, status: 'DRAFT', sortOrder: i },
    });
    created++;
  }

  // Indian GST for these services is 18%. Editable under Settings → Tax.
  if (!(await prisma.taxRate.findFirst({ where: { code: 'GST', country: 'IN' } }))) {
    await prisma.taxRate.create({ data: { name: 'GST 18%', code: 'GST', rate: new Prisma.Decimal('18.000'), country: 'IN', isDefault: true } });
  }

  // Blank until an admin fills it in (Settings → Company). The public site shows
  // "to be added" placeholders rather than inventing contact details.
  await prisma.systemSetting.upsert({
    where: { key: 'company.profile' },
    update: {},
    create: {
      key: 'company.profile',
      value: {
        legalName: '',
        brandName: 'Ciril Info',
        email: '',
        phone: '',
        whatsapp: '',
        businessHours: '',
        gstin: '',
        address: { line1: '', city: '', state: '', stateCode: '', postalCode: '', country: 'IN' },
        invoicePrefix: 'INV',
      },
    },
  });
  // Website claims (uptime, money-back, data centres …): empty = not shown on the site.
  await prisma.systemSetting.upsert({
    where: { key: SITE_CLAIMS_KEY },
    update: {},
    create: { key: SITE_CLAIMS_KEY, value: EMPTY_SITE_CLAIMS },
  });
  // Legal pages: starter drafts, NEVER public until an admin publishes them.
  for (const d of LEGAL_DRAFTS) {
    await prisma.systemSetting.upsert({
      where: { key: `legal.${d.slug}` },
      update: {},
      create: {
        key: `legal.${d.slug}`,
        value: { title: d.title, intro: d.intro, sections: d.sections, status: 'DRAFT', showDraftNotice: true, updatedOn: null },
      },
    });
  }
  console.log(`✓ Catalogue structure: ${created} new product lines (draft, no plans or prices); website claims empty`);
}

// ─────────────────────────── Sample data (development only) ───────────────────────────

async function seedSamples() {
  if (isProd) throw new Error('Refusing to seed sample data when NODE_ENV=production');

  const addPlan = async (
    productSlug: string,
    p: { name: string; description?: string; featured?: boolean; sortOrder: number; features: string[] },
    prices: { cycle: 'MONTHLY' | 'YEARLY'; price: number; renewal: number; list?: number }[],
  ) => {
    const product = await prisma.product.update({ where: { slug: productSlug }, data: { status: 'PUBLISHED' } });
    const slug = slugify(p.name);
    if (await prisma.plan.findUnique({ where: { productId_slug: { productId: product.id, slug } } })) return 0;
    await prisma.plan.create({
      data: {
        productId: product.id,
        slug,
        name: p.name,
        description: p.description,
        isFeatured: !!p.featured,
        isSample: true,
        status: 'PUBLISHED',
        sortOrder: p.sortOrder,
        features: { create: p.features.map((label, i) => ({ label, sortOrder: i })) },
        pricingVersions: {
          create: prices.map((x) => ({
            billingCycle: x.cycle,
            price: D(x.price),
            renewalPrice: D(x.renewal),
            listPrice: x.list !== undefined ? D(x.list) : null,
          })),
        },
      },
    });
    return 1;
  };

  let plans = 0;
  for (const cat of SAMPLE_HOSTING) {
    for (const [i, pl] of cat.plans.entries()) {
      const yearlyMonthly = Math.round(pl.monthly * (1 - pl.yearlyDisc));
      const renewMonthly = Math.round(pl.monthly * (1 - pl.renewDisc));
      plans += await addPlan(
        cat.slug,
        { name: pl.name, description: pl.tagline, featured: pl.featured, sortOrder: i, features: pl.features },
        [
          { cycle: 'MONTHLY', price: pl.monthly, renewal: pl.monthly },
          { cycle: 'YEARLY', price: yearlyMonthly * 12, renewal: renewMonthly * 12, list: pl.monthly * 12 },
        ],
      );
    }
  }
  for (const [i, pl] of SAMPLE_EMAIL_PLANS.entries()) {
    plans += await addPlan(
      'business-email',
      { name: pl.name, description: 'Per mailbox, billed yearly', featured: pl.featured, sortOrder: i, features: pl.features },
      [{ cycle: 'YEARLY', price: pl.monthly * 12, renewal: pl.monthly * 12 }],
    );
  }

  let testimonials = 0;
  if ((await prisma.testimonial.count({ where: { isSample: true } })) === 0) {
    const r = await prisma.testimonial.createMany({
      data: SAMPLE_TESTIMONIALS.map((t, i) => ({
        ...t,
        isSample: true,
        isPublished: true,
        consentConfirmed: true,
        consentNote: 'SAMPLE: fictional person, development only',
        publishedAt: new Date(),
        sortOrder: i,
      })),
    });
    testimonials = r.count;
  }

  let faqs = 0;
  if ((await prisma.faq.count({ where: { isSample: true } })) === 0) {
    const r = await prisma.faq.createMany({
      data: SAMPLE_FAQS.map((f, i) => ({ ...f, isSample: true, isPublished: true, sortOrder: i })),
    });
    faqs = r.count;
  }

  let kbArticles = 0;
  for (const [ci, group] of SAMPLE_KB.entries()) {
    const category = await prisma.kbCategory.upsert({ where: { slug: group.category.slug }, update: {}, create: { ...group.category, sortOrder: ci } });
    for (const [i, a] of group.articles.entries()) {
      if (await prisma.kbArticle.findUnique({ where: { slug: a.slug } })) continue;
      await prisma.kbArticle.create({ data: { ...a, categoryId: category.id, status: 'PUBLISHED', publishedAt: new Date(), isSample: true, sortOrder: i } });
      kbArticles++;
    }
  }

  let projects = 0;
  for (const [i, pr] of SAMPLE_PROJECTS.entries()) {
    if (await prisma.portfolioProject.findUnique({ where: { slug: pr.slug } })) continue;
    await prisma.portfolioProject.create({ data: { ...pr, isSample: true, isPublished: true, sortOrder: i } });
    projects++;
  }

  // Show the draft legal pages in development (still labelled "Draft for review").
  for (const d of LEGAL_DRAFTS) {
    const key = `legal.${d.slug}`;
    const row = await prisma.systemSetting.findUnique({ where: { key } });
    const v = (row?.value ?? {}) as Record<string, unknown>;
    if (v['status'] !== 'PUBLISHED') {
      await prisma.systemSetting.update({ where: { key }, data: { value: { ...v, status: 'PUBLISHED', showDraftNotice: true, _sample: true } } });
    }
  }

  // Design placeholder claims, only if the admin has not set any real ones.
  const claims = await prisma.systemSetting.findUnique({ where: { key: SITE_CLAIMS_KEY } });
  const current = readSiteClaims(claims?.value);
  if (JSON.stringify(current) === JSON.stringify(EMPTY_SITE_CLAIMS)) {
    await prisma.systemSetting.upsert({
      where: { key: SITE_CLAIMS_KEY },
      update: { value: { ...SAMPLE_SITE_CLAIMS, _sample: true } },
      create: { key: SITE_CLAIMS_KEY, value: { ...SAMPLE_SITE_CLAIMS, _sample: true } },
    });
  }

  await prisma.hostingServer.upsert({
    where: { hostname: 'mock-1.local' },
    update: {},
    create: { name: 'Mock Server 1 (dev)', hostname: 'mock-1.local', ipAddress: '127.0.0.1', panel: 'MOCK', location: 'Local', nameservers: ['ns1.mock.local', 'ns2.mock.local'] },
  });
  await prisma.domainRegistrar.upsert({
    where: { name: 'Mock Registrar (dev)' },
    update: {},
    create: {
      name: 'Mock Registrar (dev)',
      adapter: 'mock',
      isDefault: true,
      tldPricing: SAMPLE_TLD_PRICING.map(([tld, register, renew]) => ({ tld, register, renew, transfer: register })),
    },
  });
  // Sample domain prices for the website's domain search (dev only, flagged so they can be purged).
  for (const [i, [dotTld, register, renew]] of SAMPLE_TLD_PRICING.entries()) {
    const tld = dotTld.replace(/^\./, '');
    if (await prisma.tldPrice.findUnique({ where: { tld } })) continue;
    await prisma.tldPrice.create({ data: { tld, registerPrice: register, renewPrice: renew, transferPrice: register, isFeatured: i < 4, sortOrder: i, isSample: true } });
  }
  console.log(`✓ SAMPLE data (dev only): ${plans} plans, ${testimonials} testimonials, ${faqs} FAQs, ${kbArticles} help articles, ${projects} projects, mock server + registrar`);
}

/** `npm run db:purge-samples`: removes every sample row. Run before entering real data. */
async function purgeSamples() {
  const used = await prisma.subscriptionItem.findMany({ where: { plan: { isSample: true } }, select: { planId: true } });
  const usedIds = [...new Set(used.map((x) => x.planId))];
  const ids = (await prisma.plan.findMany({ where: { isSample: true, id: { notIn: usedIds } }, select: { id: true } })).map((p) => p.id);
  const [, , plans, t, f, pj] = await prisma.$transaction([
    prisma.planFeature.deleteMany({ where: { planId: { in: ids } } }),
    prisma.pricingVersion.deleteMany({ where: { planId: { in: ids } } }),
    prisma.plan.deleteMany({ where: { id: { in: ids } } }),
    prisma.testimonial.deleteMany({ where: { isSample: true } }),
    prisma.faq.deleteMany({ where: { isSample: true } }),
    prisma.portfolioProject.deleteMany({ where: { isSample: true } }),
    prisma.tldPrice.deleteMany({ where: { isSample: true } }),
  ]);
  const kb = await prisma.kbArticle.deleteMany({ where: { isSample: true } });
  // Sample categories go too, once empty (a category staff added real articles to is kept).
  await prisma.kbCategory.deleteMany({ where: { slug: { in: SAMPLE_KB.map((g) => g.category.slug) }, articles: { none: {} } } });
  // Legal pages published only by the sample seed go back to draft.
  for (const d of LEGAL_DRAFTS) {
    const key = `legal.${d.slug}`;
    const row = await prisma.systemSetting.findUnique({ where: { key } });
    const { _sample, ...v } = (row?.value ?? {}) as Record<string, unknown>;
    if (_sample) await prisma.systemSetting.update({ where: { key }, data: { value: { ...v, status: 'DRAFT' } } });
  }
  // Sample website claims are reset to empty; real ones (no _sample marker) are kept.
  const claims = await prisma.systemSetting.findUnique({ where: { key: SITE_CLAIMS_KEY } });
  if ((claims?.value as Record<string, unknown> | null)?.['_sample']) {
    await prisma.systemSetting.update({ where: { key: SITE_CLAIMS_KEY }, data: { value: EMPTY_SITE_CLAIMS } });
  }
  // Products left without plans go back to draft so nothing empty is published.
  await prisma.product.updateMany({ where: { plans: { none: {} }, status: 'PUBLISHED' }, data: { status: 'DRAFT' } });
  console.log(
    `✓ Purged samples: ${plans.count} plans, ${t.count} testimonials, ${f.count} FAQs, ${kb.count} help articles, ${pj.count} projects` +
      (usedIds.length ? ` (${usedIds.length} sample plans kept because subscriptions reference them)` : ''),
  );
}

async function main() {
  if (process.argv.includes('--purge-samples')) return purgeSamples();
  await seedRbac();
  await seedSuperAdmin();
  await seedCatalogStructure();
  const wantSamples = ['1', 'true'].includes((process.env['SEED_SAMPLE_DATA'] ?? '').toLowerCase());
  if (wantSamples) await seedSamples();
  else console.log('• Sample data: skipped (set SEED_SAMPLE_DATA=true in development to add it)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
