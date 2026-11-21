/**
 * Test fixtures for the Playwright suite (development/test databases only).
 *   tsx scripts/e2e-fixtures.ts create-staff <email> <password> <ROLE_KEY>
 *   tsx scripts/e2e-fixtures.ts create-staff-ready <email> <password> <ROLE_KEY>   (password set, two-step on; prints the secret)
 *   tsx scripts/e2e-fixtures.ts cleanup <email-prefix>
 *   tsx scripts/e2e-fixtures.ts seed-public | cleanup-public   (website content used by the public-page tests)
 *   tsx scripts/e2e-fixtures.ts add-tld <pw-ending> <register> <renew> <transfer>   (a domain ending the browser tests can sell)
 *   tsx scripts/e2e-fixtures.ts add-domain <customer-email> <name> <pw-ending> <days-until-expiry>   (a registered domain the customer already owns)
 *   tsx scripts/e2e-fixtures.ts set-bank | clear-bank   (test bank details on the company profile, removed again afterwards)
 *   tsx scripts/e2e-fixtures.ts hosting-awaiting <customer-email> <domain>   (a hosting set-up waiting for staff, as in manual mode)
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
  await db.coupon.deleteMany({ where: { code: { startsWith: 'PW-' } } });
  await db.tldPrice.deleteMany({ where: { tld: { startsWith: 'pw' } } });
  await db.taxRate.deleteMany({ where: { code: { startsWith: 'PW' }, isDefault: false } });
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
  // Staff notices left by the test tickets and enquiries.
  await db.$executeRaw`DELETE FROM notifications WHERE type IN ('ticket.opened', 'ticket.customer_reply') AND NOT EXISTS (SELECT 1 FROM support_tickets t WHERE '/support/' || t.id::text = notifications.link)`;
  await db.$executeRaw`DELETE FROM notifications WHERE type = 'inquiry.new' AND title IN ('New enquiry from Test Visitor', 'New enquiry from Playwright Tester')`;
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
    // Ticket attachments live on disk, outside the database.
    for (const t of tenantIds) await rm(join(resolve(process.cwd(), process.env['STORAGE_LOCAL_DIR'] ?? './storage'), 'tickets', t), { recursive: true, force: true });
    await db.supportTicket.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.provisioningJob.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.hostingAccount.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.domainRenewal.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.domain.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.tdsDeduction.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.creditNote.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.refund.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.payment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.invoice.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.subscription.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.outboxEvent.deleteMany({ where: { tenantId: { in: tenantIds }, type: { in: ['subscription.activated', 'domain.registration_requested', 'domain.renewal_requested', 'domain.transfer_requested'] } } });
    await db.$executeRaw`DELETE FROM notifications WHERE type = 'domain.task' AND (title LIKE 'Register pw%' OR title LIKE 'Renew pw%' OR title LIKE 'Transfer in pw%')`;
    await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await db.$executeRaw`DELETE FROM notifications WHERE type IN ('ticket.opened', 'ticket.customer_reply') AND NOT EXISTS (SELECT 1 FROM support_tickets t WHERE '/support/' || t.id::text = notifications.link)`;
    await db.invitation.deleteMany({ where: { email: { startsWith: prefix, endsWith: '@example.test' } } });
    await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    console.log(JSON.stringify({ removedUsers: users.length, removedTenants: tenantIds.length }));
  } else if (cmd === 'add-tld') {
    const [tld, register, renew, transfer] = args as [string, string, string, string];
    if (!tld.startsWith('pw')) throw new Error('Test endings must start with "pw"');
    await db.tldPrice.upsert({ where: { tld }, update: { isActive: true }, create: { tld, registerPrice: register, renewPrice: renew, transferPrice: transfer } });
    console.log('{}');
  } else if (cmd === 'add-domain') {
    const [email, name, tld, days] = args as [string, string, string, string];
    testOnly(email);
    if (!tld.startsWith('pw')) throw new Error('Test endings must start with "pw"');
    const user = await db.user.findUniqueOrThrow({ where: { email }, select: { memberships: { select: { tenantId: true }, take: 1 } } });
    const day = 86_400_000;
    await db.domain.create({
      data: { tenantId: user.memberships[0]!.tenantId, name: `${name}.${tld}`, tld, status: 'ACTIVE', registeredAt: new Date(Date.now() - 200 * day), expiresAt: new Date(Date.now() + Number(days) * day) },
    });
    console.log('{}');
  } else if (cmd === 'set-bank' || cmd === 'clear-bank') {
    const row = await db.systemSetting.findUnique({ where: { key: 'company.profile' } });
    const value = { ...((row?.value ?? {}) as Record<string, unknown>) };
    if (cmd === 'set-bank') {
      value['bank'] = { accountName: 'PW Test Account', bankName: 'PW Test Bank', accountNumber: '1234567890', ifsc: 'PWTB0000001', upiId: 'pwtest@pwbank' };
      // A database with no profile yet gets a bare one, marked so clear-bank removes it again.
      if (!row) Object.assign(value, { brandName: 'Ciril Info', _pwCreated: true });
      await db.systemSetting.upsert({ where: { key: 'company.profile' }, update: { value: value as never }, create: { key: 'company.profile', value: value as never } });
    } else if (row) {
      if (value['_pwCreated']) await db.systemSetting.delete({ where: { key: 'company.profile' } });
      else {
        delete value['bank'];
        await db.systemSetting.update({ where: { key: 'company.profile' }, data: { value: value as never } });
      }
    }
    console.log('{}');
  } else if (cmd === 'hosting-awaiting') {
    const [email, domain] = args as [string, string];
    testOnly(email);
    const user = await db.user.findUniqueOrThrow({ where: { email }, select: { memberships: { select: { tenantId: true }, take: 1 } } });
    const tenantId = user.memberships[0]!.tenantId;
    const sub = await db.subscription.findFirstOrThrow({ where: { tenantId, status: 'ACTIVE' }, select: { id: true, items: { select: { planId: true }, take: 1 } } });
    const account = await db.hostingAccount.create({ data: { tenantId, subscriptionId: sub.id, planId: sub.items[0]!.planId, primaryDomain: domain, status: 'PROVISIONING' }, select: { id: true } });
    await db.provisioningJob.create({ data: { tenantId, hostingAccountId: account.id, action: 'CREATE', status: 'AWAITING_STAFF', idempotencyKey: `create:${account.id}` } });
    console.log(JSON.stringify({ accountId: account.id }));
  } else if (cmd === 'add-dispute') {
    // A chargeback on the test customer's latest successful payment, as Razorpay's webhook would record it.
    const [email] = args as [string];
    testOnly(email);
    const user = await db.user.findUniqueOrThrow({ where: { email }, select: { memberships: { select: { tenantId: true }, take: 1 } } });
    const p = await db.payment.findFirstOrThrow({ where: { tenantId: user.memberships[0]!.tenantId, status: 'SUCCEEDED' }, orderBy: { createdAt: 'desc' } });
    const d = await db.paymentDispute.create({
      data: {
        tenantId: p.tenantId, paymentId: p.id, invoiceId: p.invoiceId, provider: p.provider, providerDisputeId: `disp_pw${Date.now()}`, amount: p.amount, currency: p.currency,
        status: 'OPEN', phase: 'chargeback', reasonCode: 'fraud', reason: 'PW customer does not recognise the payment', respondBy: new Date(Date.now() + 7 * 86_400_000),
      },
      select: { providerDisputeId: true },
    });
    console.log(JSON.stringify(d));
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
