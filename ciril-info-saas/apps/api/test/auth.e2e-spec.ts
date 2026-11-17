/**
 * Authentication end-to-end against PostgreSQL (real guards, real database roles).
 * Covers mandatory cases #1 registration, #2 login/logout, #16 unauthorized access,
 * plus session rotation/reuse detection, lockout, password reset and staff MFA.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { totp } from '../src/common/security/totp.js';
import { SecretBox } from '../src/common/security/crypto.js';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { cleanupUsers, cookies, createTestApp, lastEmail, platformDb, testEmail, tokenFromLink } from './utils.js';

const PW = 'Correct-Horse-42!';
const CSRF = { 'X-Requested-With': 'cirilinfo' };

describe('Auth (e2e)', () => {
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  const created: string[] = [];
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    db = platformDb();
  });

  afterAll(async () => {
    await cleanupUsers(db, created);
    await db.$disconnect();
    await app.close();
  });

  async function registerVerified(label: string) {
    const email = testEmail(label);
    created.push(email);
    await http()
      .post('/api/v1/auth/register')
      .send({ firstName: 'Test', lastName: label, email, password: PW, organisationName: `Org ${label}`, acceptTerms: true })
      .expect(202);
    const mail = await lastEmail(db, email, 'verify-email');
    await http().post('/api/v1/auth/verify-email').send({ token: tokenFromLink(mail!.data['link']!) }).expect(200);
    return email;
  }

  async function login(email: string, portal: 'customer' | 'admin' = 'customer', password = PW) {
    const res = await http().post('/api/v1/auth/login').send({ email, password, portal });
    return { res, cookie: cookies(res.headers['set-cookie'])[`ci_rt_${portal}`] };
  }

  // ─── #1 Registration ───
  describe('registration', () => {
    it('creates user, organisation, owner membership and billing account, and queues a verification email', async () => {
      const email = testEmail('reg');
      created.push(email);
      const res = await http()
        .post('/api/v1/auth/register')
        .send({ firstName: 'Asha', lastName: 'Test', email, password: PW, organisationName: 'Asha Traders', acceptTerms: true })
        .expect(202);
      expect(res.body.status).toBe('ACCEPTED');

      const user = await db.user.findUniqueOrThrow({
        where: { email },
        include: { memberships: { include: { role: true, tenant: { include: { customerAccount: true } } } } },
      });
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(user.emailVerifiedAt).toBeNull();
      expect(user.memberships).toHaveLength(1);
      expect(user.memberships[0]!.role.key).toBe('TENANT_OWNER');
      expect(user.memberships[0]!.tenant.name).toBe('Asha Traders');
      expect(user.memberships[0]!.tenant.customerAccount?.accountNo).toMatch(/^CI-\d{6}$/);
      expect(await lastEmail(db, email, 'verify-email')).not.toBeNull();
    });

    it('does not reveal existing accounts: same response, "account exists" email instead', async () => {
      const email = await registerVerified('dup');
      const res = await http()
        .post('/api/v1/auth/register')
        .send({ firstName: 'X', lastName: 'Y', email, password: PW, organisationName: 'Other Org', acceptTerms: true })
        .expect(202);
      expect(res.body.status).toBe('ACCEPTED');
      expect(await db.user.count({ where: { email } })).toBe(1);
      expect(await lastEmail(db, email, 'account-exists')).not.toBeNull();
    });

    it('rejects weak passwords, missing consent and unknown fields', async () => {
      const base = { firstName: 'A', lastName: 'B', email: testEmail('weak'), organisationName: 'Org', acceptTerms: true };
      const weak = await http().post('/api/v1/auth/register').send({ ...base, password: 'password123' }).expect(400);
      expect(weak.body.error.code).toBe('WEAK_PASSWORD');
      await http().post('/api/v1/auth/register').send({ ...base, password: PW, acceptTerms: false }).expect(400);
      const extra = await http().post('/api/v1/auth/register').send({ ...base, password: PW, platformRoleId: 'x' }).expect(400);
      expect(extra.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('requires email verification before customer sign-in; verification links are single-use', async () => {
      const email = testEmail('unverified');
      created.push(email);
      await http().post('/api/v1/auth/register').send({ firstName: 'U', lastName: 'V', email, password: PW, organisationName: 'Org', acceptTerms: true });
      const before = await login(email);
      expect(before.res.status).toBe(403);
      expect(before.res.body.error.code).toBe('EMAIL_NOT_VERIFIED');

      const token = tokenFromLink((await lastEmail(db, email, 'verify-email'))!.data['link']!);
      await http().post('/api/v1/auth/verify-email').send({ token }).expect(200);
      const again = await http().post('/api/v1/auth/verify-email').send({ token }).expect(400);
      expect(again.body.error.code).toBe('INVALID_LINK');
      expect((await login(email)).res.status).toBe(200);
    });
  });

  // ─── #2 Login and logout ───
  describe('login, refresh and logout', () => {
    it('returns an access token and an httpOnly, SameSite=Strict refresh cookie scoped to /api/v1/auth', async () => {
      const email = await registerVerified('login');
      const { res, cookie } = await login(email);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'OK', next: 'NONE', expiresIn: 900 });
      expect(res.body.refreshToken).toBeUndefined(); // never in the body
      expect(cookie!.attrs).toEqual(expect.arrayContaining(['httponly', 'samesite=strict', 'path=/api/v1/auth']));

      const me = await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
      expect(me.body.user.email).toBe(email);
      expect(me.body.memberships[0].role.key).toBe('TENANT_OWNER');
      expect(me.body.memberships[0].permissions).toContain('members:write');
      expect(me.body.platform).toBeNull();
    });

    it('uses one generic error for unknown email and wrong password', async () => {
      const email = await registerVerified('generic');
      const wrong = await login(email, 'customer', 'Wrong-password-1');
      const unknown = await login(testEmail('nobody'), 'customer', 'Wrong-password-1');
      expect(wrong.res.status).toBe(401);
      expect(unknown.res.status).toBe(401);
      expect(wrong.res.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(unknown.res.body.error.message).toBe(wrong.res.body.error.message);
    });

    it('customers cannot sign in to the admin portal', async () => {
      const email = await registerVerified('noadmin');
      const { res } = await login(email, 'admin');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('rotates the refresh token; requires the anti-CSRF header', async () => {
      const email = await registerVerified('refresh');
      const { cookie } = await login(email);
      const jar = `ci_rt_customer=${cookie!.value}`;

      const noHeader = await http().post('/api/v1/auth/refresh?portal=customer').set('Cookie', jar).expect(403);
      expect(noHeader.body.error.code).toBe('CSRF');

      const r = await http().post('/api/v1/auth/refresh?portal=customer').set('Cookie', jar).set(CSRF).expect(200);
      const rotated = cookies(r.headers['set-cookie'])['ci_rt_customer']!.value;
      expect(rotated).not.toBe(cookie!.value);
      await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${r.body.accessToken}`).expect(200);
    });

    it('treats replay of an old refresh token as theft and ends the session', async () => {
      const email = await registerVerified('reuse');
      const { res, cookie } = await login(email);
      const old = `ci_rt_customer=${cookie!.value}`;
      const r1 = await http().post('/api/v1/auth/refresh?portal=customer').set('Cookie', old).set(CSRF).expect(200);

      // Immediately: treated as a two-tab race, not theft.
      const race = await http().post('/api/v1/auth/refresh?portal=customer').set('Cookie', old).set(CSRF);
      expect(race.status).toBe(409);

      // Later: theft. Simulate time passing beyond the race window.
      await db.userSession.updateMany({ where: { user: { email } }, data: { lastUsedAt: new Date(Date.now() - 60_000) } });
      const theft = await http().post('/api/v1/auth/refresh?portal=customer').set('Cookie', old).set(CSRF);
      expect(theft.status).toBe(401);

      // Both the original access token and the legitimately rotated one are now dead.
      await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(401);
      await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${r1.body.accessToken}`).expect(401);
      const audit = await db.auditLog.findFirst({ where: { action: 'auth.refresh_reuse_detected', actor: { email } } });
      expect(audit).not.toBeNull();
    });

    it('logout revokes the session immediately and clears the cookie', async () => {
      const email = await registerVerified('logout');
      const { res, cookie } = await login(email);
      const token = res.body.accessToken as string;
      const out = await http().post('/api/v1/auth/logout').set('Authorization', `Bearer ${token}`).set(CSRF).expect(204);
      expect(cookies(out.headers['set-cookie'])['ci_rt_customer']!.value).toBe('');
      const after = await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
      expect(after.body.error.code).toBe('SESSION_ENDED');
      await http().post('/api/v1/auth/refresh?portal=customer').set('Cookie', `ci_rt_customer=${cookie!.value}`).set(CSRF).expect(401);
    });

    it('locks the account after 5 wrong passwords, even for the right password', async () => {
      const email = await registerVerified('lock');
      for (let i = 0; i < 5; i++) expect((await login(email, 'customer', `Wrong-${i}-password`)).res.status).toBe(401);
      const locked = await login(email);
      expect(locked.res.status).toBe(429);
      expect(locked.res.body.error.code).toBe('ACCOUNT_LOCKED');
    });
  });

  // ─── #16 Unauthorized access ───
  describe('unauthorized access', () => {
    it('rejects missing, malformed and tampered tokens', async () => {
      await http().get('/api/v1/auth/me').expect(401);
      await http().get('/api/v1/auth/me').set('Authorization', 'Bearer not-a-jwt').expect(401);
      const email = await registerVerified('tamper');
      const { res } = await login(email);
      const [h, p, s] = (res.body.accessToken as string).split('.');
      const claims = JSON.parse(Buffer.from(p!, 'base64url').toString());
      const forged = Buffer.from(JSON.stringify({ ...claims, aud: 'admin', mfa: true })).toString('base64url');
      await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${h}.${forged}.${s}`).expect(401);
    });

    it('rejects tokens signed with a different secret (alg/secret confusion)', async () => {
      const { JwtService } = await import('@nestjs/jwt');
      const evil = new JwtService({ secret: 'attacker-secret-attacker-secret-1234' }).sign(
        { sub: '00000000-0000-4000-8000-000000000000', sid: '00000000-0000-4000-8000-000000000000', aud: 'admin', typ: 'access', mfa: true, pwc: false },
        { issuer: 'cirilinfo-api' },
      );
      await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${evil}`).expect(401);
    });
  });

  // ─── Password reset ───
  describe('password reset', () => {
    it('gives the same answer for unknown emails', async () => {
      const r = await http().post('/api/v1/auth/forgot-password').send({ email: testEmail('ghost'), portal: 'customer' }).expect(202);
      expect(r.body.status).toBe('ACCEPTED');
    });

    it('resets with a single-use link and signs out every session', async () => {
      const email = await registerVerified('reset');
      const { res } = await login(email);
      await http().post('/api/v1/auth/forgot-password').send({ email, portal: 'customer' }).expect(202);
      const token = tokenFromLink((await lastEmail(db, email, 'password-reset'))!.data['link']!);
      const NEW = 'Brand-New-Passphrase-7';
      await http().post('/api/v1/auth/reset-password').send({ token, password: NEW }).expect(200);
      await http().post('/api/v1/auth/reset-password').send({ token, password: 'Another-Passphrase-8' }).expect(400);
      await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(401);
      expect((await login(email, 'customer', PW)).res.status).toBe(401);
      expect((await login(email, 'customer', NEW)).res.status).toBe(200);
      expect(await lastEmail(db, email, 'password-changed')).not.toBeNull();
    });
  });

  // ─── Staff: forced password change + mandatory MFA ───
  describe('staff sign-in', () => {
    let staffEmail: string;
    const box = new SecretBox(process.env['DATA_ENCRYPTION_KEY']!);

    beforeAll(async () => {
      staffEmail = testEmail('staff');
      created.push(staffEmail);
      const role = await db.role.findUniqueOrThrow({ where: { key: 'SUPPORT_AGENT' } });
      const { PasswordService } = await import('../src/modules/auth/password.service.js');
      await db.user.create({
        data: {
          email: staffEmail, firstName: 'Staff', lastName: 'Member', platformRoleId: role.id, emailVerifiedAt: new Date(),
          passwordHash: await new PasswordService().hash(PW), passwordChangedAt: null, // like the seeded Super Admin
        },
      });
    });

    it('forces a password change, then MFA enrolment, before anything else', async () => {
      const first = await login(staffEmail, 'admin');
      expect(first.res.body.next).toBe('PASSWORD_CHANGE');
      const t1 = first.res.body.accessToken as string;

      const blocked = await http().post('/api/v1/auth/mfa/disable').set('Authorization', `Bearer ${t1}`).send({}).expect(403);
      expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

      const NEW = 'Staff-Strong-Passphrase-9';
      const changed = await http().post('/api/v1/auth/password').set('Authorization', `Bearer ${t1}`).send({ currentPassword: PW, newPassword: NEW }).expect(200);
      const t2 = changed.body.accessToken as string;

      const me = await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${t2}`).expect(200);
      expect(me.body.session).toMatchObject({ portal: 'admin', mfaVerified: false, mustChangePassword: false });
      expect(me.body.platform.role.key).toBe('SUPPORT_AGENT');
      expect(me.body.platform.permissions).toContain('support:write');
      expect(me.body.platform.permissions).not.toContain('billing:refund');

      // Enrol MFA
      const setup = await http().post('/api/v1/auth/mfa/setup').set('Authorization', `Bearer ${t2}`).expect(200);
      expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
      const stored = await db.user.findUniqueOrThrow({ where: { email: staffEmail } });
      expect(stored.mfaSecretEnc).not.toContain(setup.body.secret); // encrypted at rest
      expect(box.decrypt(stored.mfaSecretEnc!, `mfa:${stored.id}`)).toBe(setup.body.secret);

      await http().post('/api/v1/auth/mfa/enable').set('Authorization', `Bearer ${t2}`).send({ code: '000000' }).expect(400);
      const enabled = await http().post('/api/v1/auth/mfa/enable').set('Authorization', `Bearer ${t2}`).send({ code: totp(setup.body.secret) }).expect(200);
      expect(enabled.body.recoveryCodes).toHaveLength(10);
      const meAfter = await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${enabled.body.accessToken}`).expect(200);
      expect(meAfter.body.session.mfaVerified).toBe(true);

      // Next sign-in requires the second factor; a code cannot be replayed; recovery codes work once.
      const second = await login(staffEmail, 'admin', NEW);
      expect(second.res.body.status).toBe('MFA_REQUIRED');
      expect(second.res.body.accessToken).toBeUndefined();
      expect(second.cookie).toBeUndefined();

      // The code used to enable MFA was for the current step, so it is now spent.
      const replay = await http().post('/api/v1/auth/mfa/verify').send({ mfaToken: second.res.body.mfaToken, code: totp(setup.body.secret) });
      expect(replay.status).toBe(401);

      const recovery = enabled.body.recoveryCodes[0] as string;
      const ok = await http().post('/api/v1/auth/mfa/verify').send({ mfaToken: second.res.body.mfaToken, recoveryCode: recovery.toUpperCase() }).expect(200);
      expect(ok.body.next).toBe('NONE');
      const third = await login(staffEmail, 'admin', NEW);
      await http().post('/api/v1/auth/mfa/verify').send({ mfaToken: third.res.body.mfaToken, recoveryCode: recovery }).expect(401);

      // Staff cannot switch MFA off.
      const off = await http().post('/api/v1/auth/mfa/disable').set('Authorization', `Bearer ${ok.body.accessToken}`).send({ recoveryCode: enabled.body.recoveryCodes[1] }).expect(403);
      expect(off.body.error.code).toBe('MFA_REQUIRED_FOR_STAFF');
    });

    it('staff cannot use the customer portal', async () => {
      const { res } = await login(staffEmail, 'customer', 'Staff-Strong-Passphrase-9');
      expect(res.status).toBe(401);
    });
  });

  it('records an audit trail without secrets', async () => {
    const rows = await db.auditLog.findMany({ where: { actor: { email: { in: created } } }, select: { action: true, metadata: true } });
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ['auth.register', 'auth.login', 'auth.login_failed', 'auth.logout', 'auth.password_reset', 'auth.mfa_enabled']) {
      expect(actions).toContain(a);
    }
    expect(JSON.stringify(rows)).not.toMatch(/Correct-Horse|Passphrase/);
  });
});
