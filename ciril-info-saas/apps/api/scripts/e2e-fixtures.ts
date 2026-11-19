/**
 * Test fixtures for the Playwright suite (development/test databases only).
 *   tsx scripts/e2e-fixtures.ts create-staff <email> <password> <ROLE_KEY>
 *   tsx scripts/e2e-fixtures.ts create-staff-ready <email> <password> <ROLE_KEY>   (password set, two-step on; prints the secret)
 *   tsx scripts/e2e-fixtures.ts cleanup <email-prefix>
 *   tsx scripts/e2e-fixtures.ts seed-public | cleanup-public   (website content used by the public-page tests)
 * Refuses to run when NODE_ENV=production and only touches @example.test addresses.
 */
import { config } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import argon2 from 'argon2';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { SecretBox } from '../src/common/security/crypto.js';
import { generateTotpSecret } from '../src/common/security/totp.js';

config({ path: ['.env', '../../.env'], quiet: true });
if (process.env['NODE_ENV'] === 'production') throw new Error('e2e fixtures are not allowed in production');

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env['DATABASE_URL_PLATFORM']! }) });
const [cmd, ...args] = process.argv.slice(2);
const testOnly = (email: string) => {
  if (!email.endsWith('@example.test')) throw new Error('fixtures only manage @example.test addresses');
};

const pwLegal = {
  title: 'PW Refund Policy', intro: 'Test intro', status: 'PUBLISHED', showDraftNotice: false, updatedOn: null,
  sections: [{ heading: 'PW heading', body: ['PW body paragraph.'], bullets: ['PW bullet'] }],
};

async function cleanupPublic() {
  const planIds = (await db.plan.findMany({ where: { slug: { startsWith: 'pw-' } }, select: { id: true } })).map((p) => p.id);
  await db.pricingVersion.deleteMany({ where: { planId: { in: planIds } } });
  await db.planFeature.deleteMany({ where: { planId: { in: planIds } } });
  await db.plan.deleteMany({ where: { id: { in: planIds } } });
  await db.product.deleteMany({ where: { slug: { startsWith: 'pw-' } } });
  // Images uploaded through the admin form by the browser tests.
  const withImages = await db.portfolioProject.findMany({ where: { slug: { startsWith: 'pw-' }, imageUrl: { startsWith: '/uploads/images/' } }, select: { imageUrl: true } });
  for (const p of withImages) {
    const file = p.imageUrl!.split('/').pop()!;
    if (/^[0-9a-f-]{36}\.(png|jpg|webp)$/.test(file)) await rm(join(resolve(process.cwd(), process.env['STORAGE_LOCAL_DIR'] ?? './storage'), 'images', file), { force: true });
  }
  await db.portfolioProject.deleteMany({ where: { slug: { startsWith: 'pw-' } } });
  await db.testimonial.deleteMany({ where: { quote: { startsWith: 'PW ' } } });
  await db.faq.deleteMany({ where: { question: { startsWith: 'PW ' } } });
  await db.systemSetting.deleteMany({ where: { key: 'legal.refund-policy', value: { path: ['title'], equals: 'PW Refund Policy' } } });
  await db.contactInquiry.deleteMany({ where: { email: { startsWith: 'pw-', endsWith: '@example.test' } } });
}

async function main() {
  if (cmd === 'create-staff') {
    const [email, password, roleKey] = args as [string, string, string];
    testOnly(email);
    const role = await db.role.findUniqueOrThrow({ where: { key: roleKey } });
    const user = await db.user.create({
      data: {
        email, firstName: 'E2E', lastName: 'Staff', platformRoleId: role.id, emailVerifiedAt: new Date(),
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        passwordChangedAt: null, // forces the change-password step, like the seeded Super Admin
      },
    });
    console.log(JSON.stringify({ id: user.id }));
  } else if (cmd === 'create-staff-ready') {
    const [email, password, roleKey] = args as [string, string, string];
    testOnly(email);
    const role = await db.role.findUniqueOrThrow({ where: { key: roleKey } });
    const secret = generateTotpSecret();
    const user = await db.user.create({
      data: {
        email, firstName: 'E2E', lastName: 'Staff', platformRoleId: role.id, emailVerifiedAt: new Date(), passwordChangedAt: new Date(),
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }), mfaEnabled: true,
      },
    });
    const box = new SecretBox(process.env['DATA_ENCRYPTION_KEY']!);
    await db.user.update({ where: { id: user.id }, data: { mfaSecretEnc: box.encrypt(secret, `mfa:${user.id}`) } });
    console.log(JSON.stringify({ id: user.id, secret }));
  } else if (cmd === 'cleanup') {
    const [prefix] = args as [string];
    const users = await db.user.findMany({ where: { email: { startsWith: prefix, endsWith: '@example.test' } }, select: { id: true, memberships: { select: { tenantId: true } } } });
    const tenantIds = users.flatMap((u) => u.memberships.map((m) => m.tenantId));
    // Customers created by staff in the browser tests exist only as an invitation to their owner.
    const invited = await db.invitation.findMany({ where: { email: { startsWith: prefix, endsWith: '@example.test' } }, select: { tenantId: true } });
    tenantIds.push(...invited.map((i) => i.tenantId).filter((t): t is string => !!t));
    // Orders placed by the browser tests: tenant deletion is restricted while billing records exist.
    await db.supportTicket.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.payment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.invoice.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.subscription.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.outboxEvent.deleteMany({ where: { tenantId: { in: tenantIds }, type: 'subscription.activated' } });
    await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await db.invitation.deleteMany({ where: { email: { startsWith: prefix, endsWith: '@example.test' } } });
    await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    console.log(JSON.stringify({ removedUsers: users.length, removedTenants: tenantIds.length }));
  } else if (cmd === 'seed-public') {
    await cleanupPublic();
    const category = await db.productCategory.upsert({ where: { slug: 'hosting' }, update: {}, create: { slug: 'hosting', name: 'Hosting' } });
    const product = await db.product.create({
      data: { categoryId: category.id, slug: 'pw-hosting', name: 'PW Hosting', type: 'WEB_HOSTING', tagline: 'Plans created by the browser tests', status: 'PUBLISHED' },
    });
    const prices = (monthly: number, yearly: number, list: number, renewal: number) => ({
      create: [
        { billingCycle: 'MONTHLY' as const, price: monthly, renewalPrice: monthly },
        { billingCycle: 'YEARLY' as const, price: yearly, renewalPrice: renewal, listPrice: list },
      ],
    });
    await db.plan.create({
      data: {
        productId: product.id, slug: 'pw-starter', name: 'PW Starter', description: 'First plan', status: 'PUBLISHED', sortOrder: 0,
        features: { create: [{ label: '1 website', sortOrder: 0 }, { label: '10 GB storage', sortOrder: 1 }, { label: 'Email support', sortOrder: 2 }] },
        pricingVersions: prices(100, 960, 1200, 1440),
      },
    });
    await db.plan.create({
      data: {
        productId: product.id, slug: 'pw-pro', name: 'PW Pro', description: 'Second plan', status: 'PUBLISHED', isFeatured: true, sortOrder: 1,
        features: { create: [{ label: '10 websites', sortOrder: 0 }, { label: '50 GB storage', sortOrder: 1 }, { label: 'Email support', sortOrder: 2 }, { label: 'Daily backups', sortOrder: 3 }] },
        pricingVersions: prices(200, 1920, 2400, 2400),
      },
    });
    await db.portfolioProject.create({
      data: {
        slug: 'pw-project', title: 'PW concept', clientName: 'PW Client', category: 'PW Design', summary: 'A project created by the browser tests.',
        description: 'Overview text for the test project.', scope: ['Scope item one', 'Scope item two'], tags: ['Alpha', 'Beta'], isPublished: true, isSample: true, sortOrder: -10,
      },
    });
    await db.portfolioProject.create({
      data: { slug: 'pw-project-2', title: 'PW second', clientName: 'PW Other Client', category: 'PW Marketing', summary: 'Second test project.', isPublished: true, isSample: true, sortOrder: -9 },
    });
    await db.testimonial.create({
      data: { quote: 'PW testimonial quote', authorName: 'PW Person', authorRole: 'PW Role', isPublished: true, consentConfirmed: true, consentNote: 'test', isSample: true, publishedAt: new Date(), sortOrder: -10 },
    });
    await db.faq.create({ data: { topic: 'pricing', question: 'PW pricing question?', answer: 'PW pricing answer.', isPublished: true, isSample: true, sortOrder: -10 } });
    await db.systemSetting.upsert({
      where: { key: 'legal.refund-policy' },
      update: { value: pwLegal },
      create: { key: 'legal.refund-policy', value: pwLegal },
    });
    console.log(JSON.stringify({ seeded: true }));
  } else if (cmd === 'cleanup-public') {
    await cleanupPublic();
    console.log(JSON.stringify({ cleaned: true }));
  } else {
    throw new Error(`unknown command ${cmd}`);
  }
}

main().finally(() => db.$disconnect());
