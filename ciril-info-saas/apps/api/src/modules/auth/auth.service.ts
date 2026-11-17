import { randomInt } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import { Prisma } from '../../generated/prisma/client.js';
import { SecretBox, randomToken, sha256Hex } from '../../common/security/crypto.js';
import { generateTotpSecret, otpauthUrl, verifyTotp } from '../../common/security/totp.js';
import { AuditService } from '../audit/audit.service.js';
import { MailService } from '../mail/mail.service.js';
import { RbacService } from '../rbac/rbac.service.js';
import type { AuthUser, Portal, RequestMeta } from './auth.types.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';
import { TokenService } from './token.service.js';

export const SECRET_BOX = Symbol('SECRET_BOX');

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const VERIFY_TTL_H = 48;
const RESET_TTL_H = 1;

export type LoginResult =
  | { status: 'OK'; accessToken: string; expiresIn: number; next: 'NONE' | 'MFA_SETUP' | 'PASSWORD_CHANGE'; refreshToken: string; portal: Portal }
  | { status: 'MFA_REQUIRED'; mfaToken: string };

const invalidCredentials = () =>
  new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'The email or password is incorrect.' });

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60) || 'org';

@Injectable()
export class AuthService {
  private readonly urls: { customer: string; admin: string };

  constructor(
    private readonly db: PlatformPrisma,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly tokens: TokenService,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    config: ConfigService<Env, true>,
  ) {
    this.urls = {
      customer: config.get('CUSTOMER_PORTAL_URL', { infer: true }).replace(/\/$/, ''),
      admin: config.get('ADMIN_PORTAL_URL', { infer: true }).replace(/\/$/, ''),
    };
  }

  // ─────────────────────────── Registration ───────────────────────────

  /**
   * Creates user + organisation (tenant) + owner membership + billing account in
   * one transaction and emails a verification link. If the email is already
   * registered, the response is identical and the owner gets an "account exists"
   * email instead — so the endpoint cannot be used to discover accounts.
   */
  async register(
    input: { firstName: string; lastName: string; email: string; password: string; organisationName: string; phone?: string },
    meta: RequestMeta,
  ): Promise<void> {
    const email = input.email.trim().toLowerCase();
    const check = this.passwords.check(input.password, { email });
    if (!check.ok) throw new BadRequestException({ code: 'WEAK_PASSWORD', message: check.reason });

    const existing = await this.db.user.findUnique({ where: { email }, select: { id: true, firstName: true } });
    if (existing) {
      await this.mail.enqueue({
        template: 'account-exists',
        to: email,
        data: { firstName: existing.firstName, loginLink: `${this.urls.customer}/login`, resetLink: `${this.urls.customer}/forgot-password` },
      });
      await this.audit.record({ action: 'auth.register_existing_email', actorId: existing.id, meta });
      return;
    }

    const passwordHash = await this.passwords.hash(input.password);
    const ownerRole = await this.db.role.findUniqueOrThrow({ where: { key: 'TENANT_OWNER' }, select: { id: true } });
    const verifyToken = randomToken();

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await this.db.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              email,
              firstName: input.firstName.trim(),
              lastName: input.lastName.trim(),
              phone: input.phone?.trim() || null,
              passwordHash,
              passwordChangedAt: new Date(),
            },
          });
          const tenant = await tx.tenant.create({
            data: {
              name: input.organisationName.trim(),
              slug: `${slugify(input.organisationName)}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, '')}`,
              status: 'ACTIVE',
              memberships: { create: { userId: user.id, roleId: ownerRole.id } },
              customerAccount: {
                create: {
                  accountNo: `CI-${randomInt(100_000, 1_000_000)}`,
                  billingEmail: email,
                  companyName: input.organisationName.trim(),
                  phone: input.phone?.trim() || null,
                },
              },
            },
          });
          await tx.userToken.create({
            data: { userId: user.id, purpose: 'EMAIL_VERIFY', tokenHash: sha256Hex(verifyToken), expiresAt: hoursFromNow(VERIFY_TTL_H) },
          });
          await this.mail.enqueue(
            { template: 'verify-email', to: email, data: { firstName: user.firstName, link: `${this.urls.customer}/verify-email?token=${verifyToken}` } },
            tx,
          );
          await this.audit.record({ action: 'auth.register', actorId: user.id, tenantId: tenant.id, entityType: 'tenant', entityId: tenant.id, meta }, tx);
        });
        return;
      } catch (err) {
        // Retry only on a collision of the random account number / slug.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const target = String((err.meta as { target?: unknown } | undefined)?.target ?? '');
          if (target.includes('email')) return; // concurrent registration of the same email
          continue;
        }
        throw err;
      }
    }
    throw new ConflictException({ code: 'CONFLICT', message: 'Please try again.' });
  }

  async verifyEmail(token: string, meta: RequestMeta): Promise<void> {
    const row = await this.consumeToken(token, 'EMAIL_VERIFY');
    await this.db.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } });
    await this.audit.record({ action: 'auth.email_verified', actorId: row.userId, meta });
  }

  async resendVerification(emailRaw: string): Promise<void> {
    const email = emailRaw.trim().toLowerCase();
    const user = await this.db.user.findUnique({ where: { email }, select: { id: true, firstName: true, emailVerifiedAt: true } });
    if (!user || user.emailVerifiedAt) return; // same response either way
    const recent = await this.db.userToken.count({
      where: { userId: user.id, purpose: 'EMAIL_VERIFY', createdAt: { gt: new Date(Date.now() - 60_000) } },
    });
    if (recent > 0) return; // at most one email per minute
    const token = randomToken();
    await this.db.$transaction(async (tx) => {
      await tx.userToken.create({ data: { userId: user.id, purpose: 'EMAIL_VERIFY', tokenHash: sha256Hex(token), expiresAt: hoursFromNow(VERIFY_TTL_H) } });
      await this.mail.enqueue({ template: 'verify-email', to: email, data: { firstName: user.firstName, link: `${this.urls.customer}/verify-email?token=${token}` } }, tx);
    });
  }

  // ─────────────────────────── Login ───────────────────────────

  async login(emailRaw: string, password: string, portal: Portal, meta: RequestMeta): Promise<LoginResult> {
    const email = emailRaw.trim().toLowerCase();
    const user = await this.db.user.findUnique({
      where: { email },
      select: {
        id: true, firstName: true, status: true, passwordHash: true, emailVerifiedAt: true, platformRoleId: true,
        mfaEnabled: true, failedLoginCount: true, lockedUntil: true, passwordChangedAt: true,
        memberships: { where: { status: 'ACTIVE' }, select: { id: true }, take: 1 },
      },
    });

    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      await this.passwords.verify(null, password); // keep timing uniform
      throw new HttpException(
        { code: 'ACCOUNT_LOCKED', message: `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes or reset your password.` },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const ok = await this.passwords.verify(user?.passwordHash, password);
    if (!user || !ok) {
      if (user) {
        const failed = user.failedLoginCount + 1;
        await this.db.user.update({
          where: { id: user.id },
          data: { failedLoginCount: failed, lockedUntil: failed >= MAX_FAILED_LOGINS ? minutesFromNow(LOCK_MINUTES) : null },
        });
        await this.audit.record({ action: 'auth.login_failed', actorId: user.id, metadata: { portal, failed }, meta });
      }
      throw invalidCredentials();
    }

    // Portal eligibility. Answer exactly like a wrong password so portals can't be probed.
    if (portal === 'admin' && !user.platformRoleId) throw invalidCredentials();
    if (portal === 'customer' && user.memberships.length === 0) throw invalidCredentials();

    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException({ code: 'ACCOUNT_DISABLED', message: 'This account is disabled. Contact support if you think this is a mistake.' });
    }
    if (portal === 'customer' && !user.emailVerifiedAt) {
      throw new ForbiddenException({ code: 'EMAIL_NOT_VERIFIED', message: 'Please verify your email address first. We can send a new link.' });
    }

    await this.db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });

    if (user.mfaEnabled) {
      await this.audit.record({ action: 'auth.password_ok_mfa_pending', actorId: user.id, metadata: { portal }, meta });
      return { status: 'MFA_REQUIRED', mfaToken: this.tokens.signMfaChallenge(user.id, portal) };
    }
    return this.startSession(user.id, portal, false, meta, !user.passwordChangedAt);
  }

  async completeMfaLogin(mfaToken: string, code: string | undefined, recoveryCode: string | undefined, meta: RequestMeta): Promise<LoginResult> {
    const challenge = this.tokens.verifyMfaChallenge(mfaToken);
    if (!challenge) throw new UnauthorizedException({ code: 'MFA_EXPIRED', message: 'This sign-in attempt expired. Please sign in again.' });
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: challenge.sub },
      select: { id: true, status: true, mfaEnabled: true, mfaSecretEnc: true, mfaLastStep: true, mfaRecoveryHashes: true, passwordChangedAt: true },
    });
    if (user.status !== 'ACTIVE' || !user.mfaEnabled || !user.mfaSecretEnc) throw invalidCredentials();

    await this.checkSecondFactor(user, code, recoveryCode, meta);
    return this.startSession(user.id, challenge.aud, true, meta, !user.passwordChangedAt);
  }

  private async startSession(userId: string, portal: Portal, mfaVerified: boolean, meta: RequestMeta, mustChangePassword: boolean): Promise<LoginResult> {
    const { sessionId, refreshToken } = await this.sessions.create(userId, portal, mfaVerified, meta);
    await this.db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    await this.audit.record({ action: 'auth.login', actorId: userId, entityType: 'session', entityId: sessionId, metadata: { portal, mfaVerified }, meta });
    const next = mustChangePassword ? 'PASSWORD_CHANGE' : portal === 'admin' && !mfaVerified ? 'MFA_SETUP' : 'NONE';
    return {
      status: 'OK',
      portal,
      refreshToken,
      expiresIn: this.tokens.accessTtlSeconds,
      accessToken: this.tokens.signAccess({ sub: userId, sid: sessionId, aud: portal, mfa: mfaVerified, pwc: mustChangePassword }),
      next,
    };
  }

  // ─────────────────────────── Refresh / logout ───────────────────────────

  async refresh(refreshToken: string | undefined, portal: Portal, meta: RequestMeta) {
    if (!refreshToken) throw new UnauthorizedException({ code: 'SESSION_ENDED', message: 'Please sign in.' });
    const r = await this.sessions.rotate(refreshToken, portal);
    if (r.kind === 'race') throw new ConflictException({ code: 'REFRESH_RETRY', message: 'Please retry.' });
    if (r.kind === 'reuse') {
      await this.audit.record({ action: 'auth.refresh_reuse_detected', actorId: r.userId, entityType: 'session', entityId: r.sessionId, meta });
    }
    if (r.kind !== 'ok') throw new UnauthorizedException({ code: 'SESSION_ENDED', message: 'Your session has ended. Please sign in again.' });

    const user = await this.db.user.findUnique({ where: { id: r.userId }, select: { status: true, passwordChangedAt: true } });
    if (!user || user.status !== 'ACTIVE') {
      await this.sessions.revoke(r.sessionId, 'user_inactive');
      throw new UnauthorizedException({ code: 'SESSION_ENDED', message: 'Your session has ended. Please sign in again.' });
    }
    return {
      refreshToken: r.refreshToken,
      expiresIn: this.tokens.accessTtlSeconds,
      accessToken: this.tokens.signAccess({ sub: r.userId, sid: r.sessionId, aud: portal, mfa: r.mfaVerified, pwc: !user.passwordChangedAt }),
    };
  }

  async logout(user: AuthUser, meta: RequestMeta) {
    await this.sessions.revoke(user.sessionId, 'logout');
    await this.audit.record({ action: 'auth.logout', actorId: user.id, entityType: 'session', entityId: user.sessionId, meta });
  }

  // ─────────────────────────── Passwords ───────────────────────────

  async forgotPassword(emailRaw: string, portal: Portal, meta: RequestMeta): Promise<void> {
    const email = emailRaw.trim().toLowerCase();
    const user = await this.db.user.findUnique({ where: { email }, select: { id: true, firstName: true, status: true } });
    if (!user || user.status === 'DISABLED') return; // identical response
    const recent = await this.db.userToken.count({
      where: { userId: user.id, purpose: 'PASSWORD_RESET', createdAt: { gt: new Date(Date.now() - 60_000) } },
    });
    if (recent > 0) return;
    const token = randomToken();
    const base = portal === 'admin' ? this.urls.admin : this.urls.customer;
    await this.db.$transaction(async (tx) => {
      await tx.userToken.create({ data: { userId: user.id, purpose: 'PASSWORD_RESET', tokenHash: sha256Hex(token), expiresAt: hoursFromNow(RESET_TTL_H) } });
      await this.mail.enqueue({ template: 'password-reset', to: email, data: { firstName: user.firstName, link: `${base}/reset-password?token=${token}` } }, tx);
      await this.audit.record({ action: 'auth.password_reset_requested', actorId: user.id, meta }, tx);
    });
  }

  async resetPassword(token: string, newPassword: string, meta: RequestMeta): Promise<void> {
    const row = await this.consumeToken(token, 'PASSWORD_RESET', false);
    const user = await this.db.user.findUniqueOrThrow({ where: { id: row.userId }, select: { id: true, email: true, firstName: true } });
    const check = this.passwords.check(newPassword, { email: user.email });
    if (!check.ok) throw new BadRequestException({ code: 'WEAK_PASSWORD', message: check.reason });
    const hash = await this.passwords.hash(newPassword);
    await this.db.$transaction(async (tx) => {
      const used = await tx.userToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
      if (used.count === 0) throw invalidLink();
      await tx.user.update({
        where: { id: user.id },
        // A working reset link proves control of the inbox, so the address counts as verified.
        data: { passwordHash: hash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null, emailVerifiedAt: new Date() },
      });
      await this.sessions.revokeAll(user.id, 'password_reset', undefined, tx);
      await this.mail.enqueue({ template: 'password-changed', to: user.email, data: { firstName: user.firstName } }, tx);
      await this.audit.record({ action: 'auth.password_reset', actorId: user.id, meta }, tx);
    });
  }

  async changePassword(auth: AuthUser, current: string, next: string, meta: RequestMeta) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: auth.id }, select: { passwordHash: true, email: true, firstName: true } });
    if (!(await this.passwords.verify(user.passwordHash, current))) {
      throw new BadRequestException({ code: 'WRONG_PASSWORD', message: 'Your current password is incorrect.' });
    }
    if (current === next) throw new BadRequestException({ code: 'WEAK_PASSWORD', message: 'Choose a password you have not used here before.' });
    const check = this.passwords.check(next, { email: user.email });
    if (!check.ok) throw new BadRequestException({ code: 'WEAK_PASSWORD', message: check.reason });
    const hash = await this.passwords.hash(next);
    await this.db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: auth.id }, data: { passwordHash: hash, passwordChangedAt: new Date() } });
      await this.sessions.revokeAll(auth.id, 'password_changed', auth.sessionId, tx);
      await this.mail.enqueue({ template: 'password-changed', to: user.email, data: { firstName: user.firstName } }, tx);
      await this.audit.record({ action: 'auth.password_changed', actorId: auth.id, meta }, tx);
    });
    // Re-issue the access token without the "must change password" flag.
    return {
      accessToken: this.tokens.signAccess({ sub: auth.id, sid: auth.sessionId, aud: auth.portal, mfa: auth.mfaVerified, pwc: false }),
      expiresIn: this.tokens.accessTtlSeconds,
    };
  }

  // ─────────────────────────── MFA (TOTP) ───────────────────────────

  /** Step 1: create a pending secret (not active until confirmed with a valid code). */
  async mfaSetup(auth: AuthUser) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: auth.id }, select: { email: true, mfaEnabled: true } });
    if (user.mfaEnabled) throw new ConflictException({ code: 'MFA_ALREADY_ENABLED', message: 'Two-step verification is already on.' });
    const secret = generateTotpSecret();
    await this.db.user.update({ where: { id: auth.id }, data: { mfaSecretEnc: this.box.encrypt(secret, `mfa:${auth.id}`) } });
    return { secret, otpauthUrl: otpauthUrl(secret, user.email) };
  }

  /** Step 2: confirm with a code; returns one-time recovery codes (shown once). */
  async mfaEnable(auth: AuthUser, code: string, meta: RequestMeta) {
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: auth.id },
      select: { email: true, firstName: true, mfaEnabled: true, mfaSecretEnc: true, mfaLastStep: true },
    });
    if (user.mfaEnabled) throw new ConflictException({ code: 'MFA_ALREADY_ENABLED', message: 'Two-step verification is already on.' });
    if (!user.mfaSecretEnc) throw new BadRequestException({ code: 'MFA_NOT_STARTED', message: 'Start setup first.' });
    const secret = this.box.decrypt(user.mfaSecretEnc, `mfa:${auth.id}`);
    const step = verifyTotp(secret, code);
    if (step === null) throw new BadRequestException({ code: 'INVALID_CODE', message: 'That code is not valid. Check the time on your phone and try again.' });

    const recoveryCodes = Array.from({ length: 10 }, () => formatRecovery(randomToken(10)));
    await this.db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: auth.id },
        data: { mfaEnabled: true, mfaLastStep: BigInt(step), mfaRecoveryHashes: recoveryCodes.map((c) => sha256Hex(normaliseRecovery(c))) },
      });
      await this.sessions.markMfaVerified(auth.sessionId, tx);
      await this.mail.enqueue({ template: 'mfa-enabled', to: user.email, data: { firstName: user.firstName } }, tx);
      await this.audit.record({ action: 'auth.mfa_enabled', actorId: auth.id, meta }, tx);
    });
    return {
      recoveryCodes,
      accessToken: this.tokens.signAccess({ sub: auth.id, sid: auth.sessionId, aud: auth.portal, mfa: true, pwc: auth.mustChangePassword }),
      expiresIn: this.tokens.accessTtlSeconds,
    };
  }

  /** Customers may turn MFA off (with a valid code). Staff cannot: it is mandatory for privileged users. */
  async mfaDisable(auth: AuthUser, code: string | undefined, recoveryCode: string | undefined, meta: RequestMeta) {
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: auth.id },
      select: { id: true, platformRoleId: true, mfaEnabled: true, mfaSecretEnc: true, mfaLastStep: true, mfaRecoveryHashes: true },
    });
    if (user.platformRoleId) throw new ForbiddenException({ code: 'MFA_REQUIRED_FOR_STAFF', message: 'Two-step verification is required for staff accounts.' });
    if (!user.mfaEnabled) return;
    await this.checkSecondFactor(user, code, recoveryCode, meta);
    await this.db.user.update({ where: { id: auth.id }, data: { mfaEnabled: false, mfaSecretEnc: null, mfaLastStep: null, mfaRecoveryHashes: [] } });
    await this.audit.record({ action: 'auth.mfa_disabled', actorId: auth.id, meta });
  }

  private async checkSecondFactor(
    user: { id: string; mfaSecretEnc: string | null; mfaLastStep: bigint | null; mfaRecoveryHashes: string[] },
    code: string | undefined,
    recoveryCode: string | undefined,
    meta: RequestMeta,
  ) {
    if (code) {
      const step = verifyTotp(this.box.decrypt(user.mfaSecretEnc!, `mfa:${user.id}`), code);
      // Replay protection: a step at or before the last accepted one is rejected. The conditional update makes this atomic.
      if (step !== null) {
        const r = await this.db.user.updateMany({
          where: { id: user.id, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: BigInt(step) } }] },
          data: { mfaLastStep: BigInt(step) },
        });
        if (r.count === 1) return;
      }
    } else if (recoveryCode) {
      const hash = sha256Hex(normaliseRecovery(recoveryCode));
      if (user.mfaRecoveryHashes.includes(hash)) {
        await this.db.user.update({ where: { id: user.id }, data: { mfaRecoveryHashes: user.mfaRecoveryHashes.filter((h) => h !== hash) } });
        await this.audit.record({ action: 'auth.mfa_recovery_code_used', actorId: user.id, metadata: { remaining: user.mfaRecoveryHashes.length - 1 }, meta });
        return;
      }
    }
    await this.audit.record({ action: 'auth.mfa_failed', actorId: user.id, meta });
    throw new UnauthorizedException({ code: 'INVALID_CODE', message: 'That code is not valid.' });
  }

  // ─────────────────────────── Profile ───────────────────────────

  async me(auth: AuthUser) {
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: auth.id },
      select: {
        id: true, email: true, firstName: true, lastName: true, phone: true, emailVerifiedAt: true, mfaEnabled: true,
        lastLoginAt: true, createdAt: true, mfaRecoveryHashes: true,
        platformRole: { select: { key: true, name: true } },
        memberships: {
          where: { status: 'ACTIVE', tenant: { status: { in: ['ACTIVE', 'SUSPENDED'] } } },
          select: { roleId: true, role: { select: { key: true, name: true } }, tenant: { select: { id: true, name: true, slug: true, status: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    const memberships = await Promise.all(
      user.memberships.map(async (m) => ({
        tenant: m.tenant,
        role: m.role,
        permissions: [...(await this.rbac.tenantPermissions(m.roleId)).permissions].sort(),
      })),
    );
    return {
      user: {
        id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, phone: user.phone,
        emailVerified: !!user.emailVerifiedAt, mfaEnabled: user.mfaEnabled, recoveryCodesLeft: user.mfaRecoveryHashes.length,
        lastLoginAt: user.lastLoginAt, createdAt: user.createdAt,
      },
      session: { portal: auth.portal, mfaVerified: auth.mfaVerified, mustChangePassword: auth.mustChangePassword },
      platform: auth.portal === 'admin' && user.platformRole
        ? { role: user.platformRole, permissions: [...auth.platformPermissions].sort() }
        : null,
      memberships: auth.portal === 'customer' ? memberships : [],
    };
  }

  // ─────────────────────────── helpers ───────────────────────────

  private async consumeToken(token: string, purpose: 'EMAIL_VERIFY' | 'PASSWORD_RESET', markUsed = true) {
    const row = await this.db.userToken.findUnique({ where: { tokenHash: sha256Hex(token) } });
    if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt < new Date()) throw invalidLink();
    if (markUsed) {
      const used = await this.db.userToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
      if (used.count === 0) throw invalidLink();
    }
    return row;
  }
}

const invalidLink = () =>
  new BadRequestException({ code: 'INVALID_LINK', message: 'This link is invalid or has expired. Request a new one.' });

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000);
const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000);
/** "abcd-efgh-ijkl" style recovery codes, case-insensitive. */
const formatRecovery = (raw: string) => raw.toLowerCase().replace(/[^a-z0-9]/g, 'x').slice(0, 12).match(/.{4}/g)!.join('-');
const normaliseRecovery = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '');
