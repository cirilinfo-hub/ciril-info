/**
 * Tenant isolation against a real PostgreSQL with the production RLS policies
 * and database roles. Requires migrations applied (CI does this; locally run
 * `npm run db:migrate` with the dev database up).
 *
 * Mandatory test case #6 (cross-tenant data isolation).
 */
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { PlatformPrisma, TenantPrisma } from '../src/database/prisma-clients.js';

config({ path: ['.env', '../../.env'], quiet: true });

describe('Tenant isolation (PostgreSQL RLS)', () => {
  const cfg = new ConfigService(process.env);
  const platform = new PlatformPrisma(cfg as never);
  const tenantDb = new TenantPrisma(cfg as never);

  const run = randomUUID().slice(0, 8);
  let tenantA: string;
  let tenantB: string;
  let userA: string;
  let userB: string;

  beforeAll(async () => {
    const role = await platform.role.findUniqueOrThrow({ where: { key: 'TENANT_OWNER' } });
    const mk = async (label: string) => {
      const user = await platform.user.create({
        data: { email: `iso-${label}-${run}@example.test`, firstName: label, lastName: 'Owner', passwordHash: 'not-a-real-hash' },
      });
      const tenant = await platform.tenant.create({
        data: {
          name: `Isolation ${label} ${run}`,
          slug: `iso-${label}-${run}`,
          memberships: { create: { userId: user.id, roleId: role.id } },
          customerAccount: { create: { accountNo: `T-${label}-${run}`, billingEmail: user.email } },
        },
      });
      return { user: user.id, tenant: tenant.id };
    };
    ({ user: userA, tenant: tenantA } = await mk('a'));
    ({ user: userB, tenant: tenantB } = await mk('b'));
  });

  afterAll(async () => {
    await platform.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await platform.user.deleteMany({ where: { id: { in: [userA, userB] } } });
    await Promise.all([platform.$disconnect(), tenantDb.onModuleDestroy()]);
  });

  it('a tenant sees only its own rows', async () => {
    const accounts = await tenantDb.run({ tenantId: tenantA, userId: userA }, (tx) => tx.customerAccount.findMany());
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.tenantId).toBe(tenantA);
  });

  it('cannot read another tenant’s row even when asking for it by id', async () => {
    const other = await tenantDb.run({ tenantId: tenantA, userId: userA }, (tx) =>
      tx.customerAccount.findFirst({ where: { tenantId: tenantB } }),
    );
    expect(other).toBeNull();
  });

  it('cannot write rows into another tenant', async () => {
    await expect(
      tenantDb.run({ tenantId: tenantA, userId: userA }, (tx) =>
        tx.customerAddress.create({
          data: { tenantId: tenantB, line1: 'x', city: 'x', state: 'x', postalCode: '000000' },
        }),
      ),
    ).rejects.toThrow();
  });

  it('cannot update another tenant’s rows', async () => {
    const result = await tenantDb.run({ tenantId: tenantA, userId: userA }, (tx) =>
      tx.customerAccount.updateMany({ where: { tenantId: tenantB }, data: { companyName: 'hijacked' } }),
    );
    expect(result.count).toBe(0);
    const b = await platform.customerAccount.findUniqueOrThrow({ where: { tenantId: tenantB } });
    expect(b.companyName).not.toBe('hijacked');
  });

  it('sees only its own tenant record', async () => {
    const tenants = await tenantDb.run({ tenantId: tenantA, userId: userA }, (tx) => tx.tenant.findMany({ select: { id: true } }));
    expect(tenants.map((t) => t.id)).toEqual([tenantA]);
  });

  it('can see fellow members but not other tenants’ users', async () => {
    const users = await tenantDb.run({ tenantId: tenantA, userId: userA }, (tx) =>
      tx.user.findMany({ where: { id: { in: [userA, userB] } }, select: { id: true } }),
    );
    expect(users.map((u) => u.id)).toEqual([userA]);
  });

  it('can never read password hashes through the tenant role', async () => {
    await expect(
      tenantDb.run({ tenantId: tenantA, userId: userA }, (tx) =>
        tx.user.findFirst({ where: { id: userA }, select: { passwordHash: true } }),
      ),
    ).rejects.toThrow();
  });

  it('context does not leak between transactions on pooled connections', async () => {
    await tenantDb.run({ tenantId: tenantA, userId: userA }, (tx) => tx.customerAccount.findMany());
    const b = await tenantDb.run({ tenantId: tenantB, userId: userB }, (tx) => tx.customerAccount.findMany());
    expect(b.map((x) => x.tenantId)).toEqual([tenantB]);
  });

  it('rejects malformed scope values before touching the database', async () => {
    await expect(
      tenantDb.run({ tenantId: "x' OR 1=1 --", userId: userA }, (tx) => tx.customerAccount.findMany()),
    ).rejects.toThrow('invalid tenant scope');
  });
});
