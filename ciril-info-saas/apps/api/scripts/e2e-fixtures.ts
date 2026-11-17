/**
 * Test fixtures for the Playwright suite (development/test databases only).
 *   tsx scripts/e2e-fixtures.ts create-staff <email> <password> <ROLE_KEY>
 *   tsx scripts/e2e-fixtures.ts cleanup <email-prefix>
 * Refuses to run when NODE_ENV=production and only touches @example.test addresses.
 */
import { config } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import argon2 from 'argon2';
import { PrismaClient } from '../src/generated/prisma/client.js';

config({ path: ['.env', '../../.env'], quiet: true });
if (process.env['NODE_ENV'] === 'production') throw new Error('e2e fixtures are not allowed in production');

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env['DATABASE_URL_PLATFORM']! }) });
const [cmd, ...args] = process.argv.slice(2);
const testOnly = (email: string) => {
  if (!email.endsWith('@example.test')) throw new Error('fixtures only manage @example.test addresses');
};

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
  } else if (cmd === 'cleanup') {
    const [prefix] = args as [string];
    const users = await db.user.findMany({ where: { email: { startsWith: prefix, endsWith: '@example.test' } }, select: { id: true, memberships: { select: { tenantId: true } } } });
    const tenantIds = users.flatMap((u) => u.memberships.map((m) => m.tenantId));
    await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await db.invitation.deleteMany({ where: { email: { startsWith: prefix, endsWith: '@example.test' } } });
    await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    console.log(JSON.stringify({ removedUsers: users.length, removedTenants: tenantIds.length }));
  } else {
    throw new Error(`unknown command ${cmd}`);
  }
}

main().finally(() => db.$disconnect());
