import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { config } from 'dotenv';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PlatformPrisma } from '../src/database/prisma-clients.js';

config({ path: ['.env', '../../.env'], quiet: true });

export async function createTestApp(): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}

export function platformDb(): PlatformPrisma {
  return new PlatformPrisma(new ConfigService(process.env) as never);
}

/** Unique, clearly-fake address per test run. */
export const testEmail = (label: string) => `t-${label}-${randomUUID().slice(0, 8)}@example.test`;

/** Most recent queued email for an address (reads the outbox, i.e. what the worker will send). */
export async function lastEmail(db: PlatformPrisma, to: string, template: string) {
  const rows = await db.outboxEvent.findMany({
    where: { type: 'email.send', payload: { path: ['to'], equals: to } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  const row = rows.find((r) => (r.payload as { template: string }).template === template);
  return row ? (row.payload as { template: string; to: string; data: Record<string, string> }) : null;
}

export const tokenFromLink = (link: string) => new URL(link).searchParams.get('token')!;

/** Parse a Set-Cookie header into a name → { value, attributes } map. */
export function cookies(setCookie: string[] | string | undefined) {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return Object.fromEntries(
    list.map((c) => {
      const [pair, ...attrs] = c.split(';').map((s) => s.trim());
      const [name, ...v] = pair!.split('=');
      return [name, { value: v.join('='), attrs: attrs.map((a) => a.toLowerCase()) }];
    }),
  ) as Record<string, { value: string; attrs: string[] }>;
}

/** Remove users (and their tenants) created by a test run. */
/**
 * Staff notices made by test tickets and enquiries would otherwise pile up in a real developer's admin bell.
 * Ticket notices whose ticket is gone are removed, and so are notices for the enquiry names the tests use.
 */
export async function purgeTestStaffNotices(db: PlatformPrisma) {
  await db.$executeRaw`DELETE FROM notifications WHERE type IN ('ticket.opened', 'ticket.customer_reply')
    AND NOT EXISTS (SELECT 1 FROM support_tickets t WHERE '/support/' || t.id::text = notifications.link)`;
  await db.$executeRaw`DELETE FROM notifications WHERE type = 'inquiry.new' AND title IN ('New enquiry from Test Visitor', 'New enquiry from Playwright Tester')`;
}

export async function cleanupUsers(db: PlatformPrisma, emails: string[]) {
  const users = await db.user.findMany({ where: { email: { in: emails } }, select: { id: true, memberships: { select: { tenantId: true } } } });
  const tenantIds = users.flatMap((u) => u.memberships.map((m) => m.tenantId));
  await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  await db.outboxEvent.deleteMany({ where: { type: 'email.send', OR: emails.map((e) => ({ payload: { path: ['to'], equals: e } })) } });
  await purgeTestStaffNotices(db);
}

// ─── Staff helpers (MFA-enabled admin sessions for admin-route tests) ───
import request from 'supertest';
import { generateTotpSecret, totp } from '../src/common/security/totp.js';
import { SecretBox } from '../src/common/security/crypto.js';
import { PasswordService } from '../src/modules/auth/password.service.js';

export const TEST_PASSWORD = 'Correct-Horse-42!';

export async function createStaff(db: PlatformPrisma, roleKey: string, label = roleKey.toLowerCase()) {
  const email = testEmail(label);
  const secret = generateTotpSecret();
  const role = await db.role.findUniqueOrThrow({ where: { key: roleKey } });
  const box = new SecretBox(process.env['DATA_ENCRYPTION_KEY']!);
  const user = await db.user.create({
    data: {
      email, firstName: label, lastName: 'Staff', platformRoleId: role.id, emailVerifiedAt: new Date(), passwordChangedAt: new Date(),
      passwordHash: await new PasswordService().hash(TEST_PASSWORD), mfaEnabled: true,
    },
  });
  await db.user.update({ where: { id: user.id }, data: { mfaSecretEnc: box.encrypt(secret, `mfa:${user.id}`) } });
  return { id: user.id, email, secret };
}

/** Full staff sign-in (password + TOTP). Clears the replay marker so tests can sign in repeatedly. */
export async function staffToken(app: NestExpressApplication, db: PlatformPrisma, staff: { id: string; email: string; secret: string }) {
  await db.user.update({ where: { id: staff.id }, data: { mfaLastStep: null } });
  const http = request(app.getHttpServer());
  const step1 = await http.post('/api/v1/auth/login').send({ email: staff.email, password: TEST_PASSWORD, portal: 'admin' });
  const step2 = await request(app.getHttpServer()).post('/api/v1/auth/mfa/verify').send({ mfaToken: step1.body.mfaToken, code: totp(staff.secret) });
  if (step2.status !== 200) throw new Error(`staff login failed: ${step2.status} ${JSON.stringify(step2.body)}`);
  return step2.body.accessToken as string;
}

/** Register + verify + sign in a customer; returns token and their tenant id. */
export async function customer(app: NestExpressApplication, db: PlatformPrisma, label: string) {
  const email = testEmail(label);
  const http = () => request(app.getHttpServer());
  await http().post('/api/v1/auth/register').send({ firstName: label, lastName: 'Customer', email, password: TEST_PASSWORD, organisationName: `Org ${label}`, acceptTerms: true });
  const mail = await lastEmail(db, email, 'verify-email');
  await http().post('/api/v1/auth/verify-email').send({ token: tokenFromLink(mail!.data['link']!) });
  const login = await http().post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD, portal: 'customer' });
  const user = await db.user.findUniqueOrThrow({ where: { email }, include: { memberships: true } });
  return { email, userId: user.id, tenantId: user.memberships[0]!.tenantId, token: login.body.accessToken as string };
}
