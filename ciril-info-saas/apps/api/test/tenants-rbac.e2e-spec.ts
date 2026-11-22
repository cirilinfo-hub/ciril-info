/**
 * Tenants, memberships and RBAC end-to-end.
 * Mandatory cases: #3 tenant creation, #4 tenant membership, #5 role permissions,
 * #6 cross-tenant isolation (HTTP level), #15 admin operations, #16 unauthorized access.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import {
  TEST_PASSWORD,
  cleanupUsers,
  createStaff,
  createTestApp,
  customer,
  lastEmail,
  platformDb,
  staffToken,
  testEmail,
  tokenFromLink,
} from './utils.js';

describe('Tenants & RBAC (e2e)', () => {
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  const emails: string[] = [];
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  let superAdmin: string;
  let support: string;
  let finance: string;
  let alice: Awaited<ReturnType<typeof customer>>;
  let bob: Awaited<ReturnType<typeof customer>>;

  beforeAll(async () => {
    app = await createTestApp();
    db = platformDb();
    const sa = await createStaff(db, 'SUPER_ADMIN', 'sa');
    const sup = await createStaff(db, 'SUPPORT_AGENT', 'support');
    const fin = await createStaff(db, 'FINANCE_ADMIN', 'finance');
    emails.push(sa.email, sup.email, fin.email);
    superAdmin = await staffToken(app, db, sa);
    support = await staffToken(app, db, sup);
    finance = await staffToken(app, db, fin);
    alice = await customer(app, db, 'alice');
    bob = await customer(app, db, 'bob');
    emails.push(alice.email, bob.email);
  });

  afterAll(async () => {
    const created = await db.tenant.findMany({ where: { name: { startsWith: 'E2E ' } }, select: { id: true } });
    await db.tenant.deleteMany({ where: { id: { in: created.map((t) => t.id) } } });
    await cleanupUsers(db, emails);
    await db.$disconnect();
    await app.close();
  });

  // ─── #16 / #5: portal separation and permission checks ───
  describe('access control', () => {
    it('anonymous callers get 401 on every protected route', async () => {
      for (const path of ['/api/v1/organisation', '/api/v1/admin/tenants', '/api/v1/admin/staff', '/api/v1/admin/audit-logs']) {
        await http().get(path).expect(401);
      }
    });

    it('customer tokens cannot reach admin routes, and staff tokens cannot reach customer routes', async () => {
      const r = await http().get('/api/v1/admin/tenants').set(auth(alice.token)).expect(403);
      expect(r.body.error.code).toBe('WRONG_PORTAL');
      const s = await http().get('/api/v1/organisation').set(auth(superAdmin)).expect(403);
      expect(s.body.error.code).toBe('WRONG_PORTAL');
    });

    it('enforces platform permissions per role', async () => {
      await http().get('/api/v1/admin/tenants').set(auth(support)).expect(200); // tenants:read
      const create = await http().post('/api/v1/admin/tenants').set(auth(support)).send({ name: 'E2E Nope', owner: { email: testEmail('x'), firstName: 'X', lastName: 'Y' } }).expect(403);
      expect(create.body.error.details.missing).toContain('tenants:write');
      await http().get('/api/v1/admin/staff').set(auth(support)).expect(403); // users:read not granted
      await http().get('/api/v1/admin/audit-logs').set(auth(finance)).expect(200); // audit:read
      await http().post(`/api/v1/admin/tenants/${alice.tenantId}/suspend`).set(auth(finance)).send({ reason: 'test' }).expect(403);
    });
  });

  // ─── #6 at the HTTP layer ───
  describe('cross-tenant isolation', () => {
    it('a customer cannot act on another organisation by sending its id', async () => {
      const r = await http().get('/api/v1/organisation').set(auth(alice.token)).set('X-Tenant-Id', bob.tenantId).expect(403);
      expect(r.body.error.code).toBe('NO_TENANT_ACCESS');
      await http().patch('/api/v1/organisation').set(auth(alice.token)).set('X-Tenant-Id', bob.tenantId).send({ name: 'pwned' }).expect(403);
      const bobOrg = await db.tenant.findUniqueOrThrow({ where: { id: bob.tenantId } });
      expect(bobOrg.name).not.toBe('pwned');
    });

    it('lists only the caller’s own members and activity', async () => {
      const m = await http().get('/api/v1/organisation/members').set(auth(alice.token)).expect(200);
      expect(m.body.data.map((x: { user: { email: string } }) => x.user.email)).toEqual([alice.email]);
      const a = await http().get('/api/v1/organisation/activity').set(auth(alice.token)).expect(200);
      expect(a.body.data.length).toBeGreaterThan(0);
      expect(JSON.stringify(a.body)).not.toContain(bob.email);
    });

    it('rejects a malformed tenant header', async () => {
      await http().get('/api/v1/organisation').set(auth(alice.token)).set('X-Tenant-Id', "1' OR '1'='1").expect(400);
    });
  });

  // ─── Organisation profile ───
  it('an owner can update the organisation; GSTIN is validated', async () => {
    await http().patch('/api/v1/organisation').set(auth(alice.token)).send({ gstin: 'NOT-A-GSTIN' }).expect(400);
    const r = await http().patch('/api/v1/organisation').set(auth(alice.token)).send({ name: 'Alice Traders', gstin: '29abcde1234f1z5' }).expect(200);
    expect(r.body.name).toBe('Alice Traders');
    expect(r.body.customerAccount.gstin).toBe('29ABCDE1234F1Z5');
  });

  // ─── #4 membership via invitation ───
  describe('memberships', () => {
    let carolEmail: string;
    let carolToken: string;
    let carolMembershipId: string;

    it('owner invites a new member who creates an account from the link', async () => {
      carolEmail = testEmail('carol');
      emails.push(carolEmail);
      await http().post('/api/v1/organisation/invitations').set(auth(alice.token)).send({ email: carolEmail, roleKey: 'CUSTOMER' }).expect(202);
      const invites = await http().get('/api/v1/organisation/invitations').set(auth(alice.token)).expect(200);
      expect(invites.body.data[0].email).toBe(carolEmail);

      const token = tokenFromLink((await lastEmail(db, carolEmail, 'invitation'))!.data['link']!);
      const preview = await http().get(`/api/v1/invitations/preview?token=${token}`).expect(200);
      expect(preview.body).toMatchObject({ organisation: 'Alice Traders', email: carolEmail, accountExists: false });

      await http().post('/api/v1/invitations/accept-new').send({ token, firstName: 'Carol', lastName: 'Member', password: TEST_PASSWORD }).expect(200);
      await http().post('/api/v1/invitations/accept-new').send({ token, firstName: 'Carol', lastName: 'Again', password: TEST_PASSWORD }).expect(400);

      const login = await http().post('/api/v1/auth/login').send({ email: carolEmail, password: TEST_PASSWORD, portal: 'customer' }).expect(200);
      carolToken = login.body.accessToken;
      const me = await http().get('/api/v1/auth/me').set(auth(carolToken)).expect(200);
      expect(me.body.memberships[0]).toMatchObject({ tenant: { id: alice.tenantId }, role: { key: 'CUSTOMER' } });
      expect(me.body.memberships[0].permissions).not.toContain('members:write');
      carolMembershipId = (await db.tenantMembership.findFirstOrThrow({ where: { tenantId: alice.tenantId, user: { email: carolEmail } } })).id;
    });

    it('a plain member cannot invite, edit the organisation or manage people', async () => {
      await http().post('/api/v1/organisation/invitations').set(auth(carolToken)).send({ email: testEmail('z'), roleKey: 'CUSTOMER' }).expect(403);
      await http().patch('/api/v1/organisation').set(auth(carolToken)).send({ name: 'Carol Co' }).expect(403);
      const owner = await db.tenantMembership.findFirstOrThrow({ where: { tenantId: alice.tenantId, userId: alice.userId } });
      await http().delete(`/api/v1/organisation/members/${owner.id}`).set(auth(carolToken)).expect(403);
    });

    it('nobody can be invited as owner, and owners cannot change their own role', async () => {
      await http().post('/api/v1/organisation/invitations').set(auth(alice.token)).send({ email: testEmail('o'), roleKey: 'TENANT_OWNER' }).expect(400);
      const owner = await db.tenantMembership.findFirstOrThrow({ where: { tenantId: alice.tenantId, userId: alice.userId } });
      await http().patch(`/api/v1/organisation/members/${owner.id}`).set(auth(alice.token)).send({ roleKey: 'CUSTOMER' }).expect(403);
    });

    it('owner promotes the member to admin, who then gains team permissions', async () => {
      await http().patch(`/api/v1/organisation/members/${carolMembershipId}`).set(auth(alice.token)).send({ roleKey: 'TENANT_ADMIN' }).expect(204);
      await http().get('/api/v1/organisation/invitations').set(auth(carolToken)).expect(200);
    });

    it('the last owner cannot leave; other members can be removed', async () => {
      const owner = await db.tenantMembership.findFirstOrThrow({ where: { tenantId: alice.tenantId, userId: alice.userId } });
      const leave = await http().delete(`/api/v1/organisation/members/${owner.id}`).set(auth(alice.token)).expect(409);
      expect(leave.body.error.code).toBe('LAST_OWNER');
      await http().delete(`/api/v1/organisation/members/${carolMembershipId}`).set(auth(alice.token)).expect(204);
      const r = await http().get('/api/v1/organisation').set(auth(carolToken)).expect(403);
      expect(r.body.error.code).toBe('NO_TENANT_ACCESS');
    });
  });

  // ─── #3 tenant creation + #15 admin operations ───
  describe('admin tenant management', () => {
    let tenantId: string;
    let ownerEmail: string;

    it('creates a tenant and invites its owner', async () => {
      ownerEmail = testEmail('owner');
      emails.push(ownerEmail);
      const r = await http().post('/api/v1/admin/tenants').set(auth(superAdmin)).send({ name: 'E2E Admin Created', owner: { email: ownerEmail, firstName: 'Olu', lastName: 'Owner' } }).expect(201);
      tenantId = r.body.id;
      expect(r.body.ownerInvited).toBe(true);
      const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, include: { customerAccount: true } });
      expect(t.customerAccount?.billingEmail).toBe(ownerEmail);
      expect(await lastEmail(db, ownerEmail, 'invitation')).not.toBeNull();
      expect(await db.auditLog.count({ where: { action: 'tenant.create', entityId: tenantId } })).toBe(1);
    });

    it('lists, searches, sorts and paginates tenants', async () => {
      const r = await http().get('/api/v1/admin/tenants?search=E2E%20Admin&pageSize=5&sort=-createdAt').set(auth(support)).expect(200);
      expect(r.body.meta).toMatchObject({ page: 1, pageSize: 5 });
      expect(r.body.data.some((t: { id: string }) => t.id === tenantId)).toBe(true);
      await http().get('/api/v1/admin/tenants?sort=passwordHash').set(auth(support)).expect(400);
      await http().get('/api/v1/admin/tenants?pageSize=500').set(auth(support)).expect(400);
    });

    it('suspending a tenant immediately blocks its customers; activating restores access', async () => {
      await http().post(`/api/v1/admin/tenants/${bob.tenantId}/suspend`).set(auth(superAdmin)).send({ reason: 'E2E unpaid invoices' }).expect(200);
      const blocked = await http().get('/api/v1/organisation').set(auth(bob.token)).expect(403);
      expect(blocked.body.error.code).toBe('NO_TENANT_ACCESS');
      await http().post(`/api/v1/admin/tenants/${bob.tenantId}/activate`).set(auth(superAdmin)).expect(200);
      await http().get('/api/v1/organisation').set(auth(bob.token)).expect(200);
      const audit = await http().get(`/api/v1/admin/tenants/${bob.tenantId}/activity`).set(auth(superAdmin)).expect(200);
      expect(audit.body.data.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['tenant.suspend', 'tenant.activate']));
    });

    it('rejects unknown ids and bad payloads cleanly', async () => {
      await http().get('/api/v1/admin/tenants/00000000-0000-4000-8000-000000000000').set(auth(support)).expect(404);
      await http().get('/api/v1/admin/tenants/not-a-uuid').set(auth(support)).expect(400);
      await http().post('/api/v1/admin/tenants').set(auth(superAdmin)).send({ name: 'E2E X', owner: { email: 'bad' } }).expect(400);
    });
  });

  // ─── Staff management ───
  describe('staff', () => {
    it('invites a staff member who sets a password, then must enrol MFA', async () => {
      const email = testEmail('newstaff');
      emails.push(email);
      await http().post('/api/v1/admin/staff').set(auth(superAdmin)).send({ email, firstName: 'New', lastName: 'Staff', roleKey: 'SUPPORT_AGENT' }).expect(201);
      // Cannot sign in before setup.
      await http().post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD, portal: 'admin' }).expect(401);
      const token = tokenFromLink((await lastEmail(db, email, 'staff-invitation'))!.data['link']!);
      await http().post('/api/v1/auth/setup-account').send({ token, password: TEST_PASSWORD }).expect(200);
      const login = await http().post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD, portal: 'admin' }).expect(200);
      expect(login.body.next).toBe('MFA_SETUP');
      const blocked = await http().get('/api/v1/admin/tenants').set(auth(login.body.accessToken)).expect(403);
      expect(blocked.body.error.code).toBe('MFA_SETUP_REQUIRED');
    });

    it('only Super Admins manage Super Admins; you cannot change your own role', async () => {
      const pa = await createStaff(db, 'PLATFORM_ADMIN', 'pa');
      emails.push(pa.email);
      const paToken = await staffToken(app, db, pa);
      // Platform Admin lacks users:write entirely.
      await http().post('/api/v1/admin/staff').set(auth(paToken)).send({ email: testEmail('y'), firstName: 'Y', lastName: 'Z', roleKey: 'SUPER_ADMIN' }).expect(403);
      const me = await db.user.findFirstOrThrow({ where: { email: { startsWith: 't-sa-' }, platformRole: { key: 'SUPER_ADMIN' } }, orderBy: { createdAt: 'desc' } });
      await http().patch(`/api/v1/admin/staff/${me.id}/role`).set(auth(superAdmin)).send({ roleKey: 'SUPPORT_AGENT' }).expect(403);
    });

    it('disabling a staff member ends their sessions at once', async () => {
      const victim = await createStaff(db, 'SUPPORT_AGENT', 'victim');
      emails.push(victim.email);
      const t = await staffToken(app, db, victim);
      await http().get('/api/v1/admin/tenants').set(auth(t)).expect(200);
      await http().post(`/api/v1/admin/staff/${victim.id}/disable`).set(auth(superAdmin)).expect(204);
      await http().get('/api/v1/admin/tenants').set(auth(t)).expect(401);
    });
  });

  it('the audit log is searchable by admins with audit:read', async () => {
    const r = await http().get('/api/v1/admin/audit-logs?action=tenant.&pageSize=50').set(auth(superAdmin)).expect(200);
    expect(r.body.data.every((a: { action: string }) => a.action.startsWith('tenant.'))).toBe(true);
    await http().get('/api/v1/admin/audit-logs').set(auth(support)).expect(403);
  });
});
