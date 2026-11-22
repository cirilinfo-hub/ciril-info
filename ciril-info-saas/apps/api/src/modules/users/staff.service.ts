import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { orderBy, page, skipTake } from '../../common/http/pagination.js';
import { randomToken, sha256Hex } from '../../common/security/crypto.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser, RequestMeta } from '../auth/auth.types.js';
import { PasswordService } from '../auth/password.service.js';
import { SessionService } from '../auth/session.service.js';
import { MailService } from '../mail/mail.service.js';
import { RbacService } from '../rbac/rbac.service.js';
import type { InviteStaffDto, StaffListQuery } from './users.dto.js';

const SETUP_TTL_DAYS = 7;

/** Platform staff (Super Admin, Platform Admin, Finance Admin, Support Agent). */
@Injectable()
export class StaffService {
  private readonly adminUrl: string;

  constructor(
    private readonly db: PlatformPrisma,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly sessions: SessionService,
    private readonly passwords: PasswordService,
    private readonly rbac: RbacService,
    config: ConfigService<Env, true>,
  ) {
    this.adminUrl = config.get('ADMIN_PORTAL_URL', { infer: true }).replace(/\/$/, '');
  }

  async roles() {
    const roles = await this.db.role.findMany({
      orderBy: [{ scope: 'asc' }, { key: 'asc' }],
      select: {
        id: true, key: true, name: true, description: true, scope: true,
        permissions: { select: { permission: { select: { key: true, description: true } } } },
        _count: { select: { platformUsers: { where: { status: { not: 'DISABLED' } } }, memberships: { where: { status: 'ACTIVE' } } } },
      },
    });
    return {
      data: roles.map((r) => ({
        ...r,
        permissions: r.permissions.map((p) => ({ key: p.permission.key.replace(/^(platform|tenant):/, ''), description: p.permission.description })),
        holders: r.scope === 'PLATFORM' ? r._count.platformUsers : r._count.memberships,
        _count: undefined,
      })),
    };
  }

  async list(q: StaffListQuery) {
    const where: Prisma.UserWhereInput = {
      platformRoleId: { not: null },
      ...(q.status ? { status: q.status } : {}),
      ...(q.role ? { platformRole: { key: q.role } } : {}),
      ...(q.search
        ? { OR: [{ email: { contains: q.search, mode: 'insensitive' } }, { firstName: { contains: q.search, mode: 'insensitive' } }, { lastName: { contains: q.search, mode: 'insensitive' } }] }
        : {}),
    };
    const sort = orderBy<Prisma.UserOrderByWithRelationInput>(
      q.sort,
      { name: (d) => ({ firstName: d }), email: (d) => ({ email: d }), lastLoginAt: (d) => ({ lastLoginAt: d }), createdAt: (d) => ({ createdAt: d }) },
      { createdAt: 'asc' },
    );
    const [rows, total] = await this.db.$transaction([
      this.db.user.findMany({
        where, orderBy: sort, ...skipTake(q),
        select: { id: true, email: true, firstName: true, lastName: true, status: true, mfaEnabled: true, lastLoginAt: true, createdAt: true, platformRole: { select: { key: true, name: true } } },
      }),
      this.db.user.count({ where }),
    ]);
    return page(rows, total, q);
  }

  /** Creates an INVITED staff account and emails a one-time setup link (password + MFA on first sign-in). */
  async invite(actor: AuthUser, dto: InviteStaffDto, meta: RequestMeta) {
    const email = dto.email.toLowerCase();
    const role = await this.db.role.findUnique({ where: { key: dto.roleKey }, select: { id: true, name: true, scope: true, key: true } });
    if (!role || role.scope !== 'PLATFORM') throw new BadRequestException({ code: 'BAD_ROLE', message: 'Choose a staff role.' });
    this.assertCanGrant(actor, role.key);
    if (await this.db.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new ConflictException({ code: 'EMAIL_IN_USE', message: 'An account with this email already exists.' });
    }
    const inviter = await this.db.user.findUniqueOrThrow({ where: { id: actor.id }, select: { firstName: true, lastName: true } });
    const token = randomToken();
    const user = await this.db.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: { email, firstName: dto.firstName, lastName: dto.lastName, status: 'INVITED', platformRoleId: role.id },
        select: { id: true },
      });
      await tx.userToken.create({ data: { userId: u.id, purpose: 'ACCOUNT_SETUP', tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + SETUP_TTL_DAYS * 86_400_000) } });
      await this.mail.enqueue({ template: 'staff-invitation', to: email, data: { inviterName: `${inviter.firstName} ${inviter.lastName}`, roleName: role.name, link: `${this.adminUrl}/setup-account?token=${token}` } }, tx);
      await this.audit.record({ action: 'staff.invited', actorId: actor.id, entityType: 'user', entityId: u.id, metadata: { email, role: role.key }, meta }, tx);
      return u;
    });
    return { id: user.id, status: 'INVITED' };
  }

  /** Invited staff member sets their password (public, token-authenticated). MFA is enrolled at first sign-in. */
  async completeSetup(token: string, password: string, meta: RequestMeta) {
    const row = await this.db.userToken.findUnique({ where: { tokenHash: sha256Hex(token) }, include: { user: { select: { id: true, email: true, status: true } } } });
    if (!row || row.purpose !== 'ACCOUNT_SETUP' || row.usedAt || row.expiresAt < new Date() || row.user.status !== 'INVITED') {
      throw new BadRequestException({ code: 'INVALID_LINK', message: 'This link is invalid or has expired. Ask an administrator for a new invitation.' });
    }
    const check = this.passwords.check(password, { email: row.user.email });
    if (!check.ok) throw new BadRequestException({ code: 'WEAK_PASSWORD', message: check.reason });
    const hash = await this.passwords.hash(password);
    await this.db.$transaction(async (tx) => {
      const used = await tx.userToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
      if (used.count === 0) throw new BadRequestException({ code: 'INVALID_LINK', message: 'This link has already been used.' });
      await tx.user.update({ where: { id: row.user.id }, data: { passwordHash: hash, passwordChangedAt: new Date(), emailVerifiedAt: new Date(), status: 'ACTIVE' } });
      await this.audit.record({ action: 'staff.setup_completed', actorId: row.user.id, entityType: 'user', entityId: row.user.id, meta }, tx);
    });
    return { status: 'READY', message: 'Your password is set. Sign in to finish setting up two-step verification.' };
  }

  async changeRole(actor: AuthUser, userId: string, roleKey: string, meta: RequestMeta) {
    if (userId === actor.id) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You cannot change your own role.' });
    const [target, role] = await Promise.all([
      this.db.user.findFirst({ where: { id: userId, platformRoleId: { not: null } }, select: { id: true, status: true, platformRole: { select: { key: true } } } }),
      this.db.role.findUnique({ where: { key: roleKey }, select: { id: true, key: true, scope: true } }),
    ]);
    if (!target) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Staff member not found.' });
    if (!role || role.scope !== 'PLATFORM') throw new BadRequestException({ code: 'BAD_ROLE', message: 'Choose a staff role.' });
    this.assertCanGrant(actor, role.key);
    this.assertCanGrant(actor, target.platformRole!.key);
    await this.db.$transaction(async (tx) => {
      if (target.platformRole!.key === 'SUPER_ADMIN' && role.key !== 'SUPER_ADMIN') await this.assertNotLastSuperAdmin(tx, userId);
      await tx.user.update({ where: { id: userId }, data: { platformRoleId: role.id } });
      // New permissions apply on the next sign-in; end existing sessions so nothing runs with stale rights.
      await this.sessions.revokeAll(userId, 'role_changed', undefined, tx);
      await this.audit.record({ action: 'staff.role_changed', actorId: actor.id, entityType: 'user', entityId: userId, metadata: { from: target.platformRole!.key, to: role.key }, meta }, tx);
    });
  }

  async setStatus(actor: AuthUser, userId: string, status: 'ACTIVE' | 'DISABLED', meta: RequestMeta) {
    if (userId === actor.id) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You cannot disable your own account.' });
    const target = await this.db.user.findFirst({ where: { id: userId, platformRoleId: { not: null } }, select: { status: true, passwordHash: true, platformRole: { select: { key: true } } } });
    if (!target) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Staff member not found.' });
    this.assertCanGrant(actor, target.platformRole!.key);
    if (status === 'ACTIVE' && !target.passwordHash) throw new ConflictException({ code: 'SETUP_PENDING', message: 'This person has not finished setting up their account yet.' });
    await this.db.$transaction(async (tx) => {
      if (status === 'DISABLED' && target.platformRole!.key === 'SUPER_ADMIN') await this.assertNotLastSuperAdmin(tx, userId);
      await tx.user.update({ where: { id: userId }, data: { status } });
      if (status === 'DISABLED') await this.sessions.revokeAll(userId, 'account_disabled', undefined, tx);
      await this.audit.record({ action: status === 'DISABLED' ? 'staff.disabled' : 'staff.enabled', actorId: actor.id, entityType: 'user', entityId: userId, meta }, tx);
    });
  }

  /** Only a Super Admin may grant or modify the Super Admin role. */
  private assertCanGrant(actor: AuthUser, roleKey: string) {
    if (roleKey === 'SUPER_ADMIN' && actor.platformRoleKey !== 'SUPER_ADMIN') {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Only a Super Admin can manage Super Admins.' });
    }
  }

  private async assertNotLastSuperAdmin(tx: Prisma.TransactionClient, exceptUserId: string) {
    const others = await tx.user.count({ where: { id: { not: exceptUserId }, status: 'ACTIVE', platformRole: { key: 'SUPER_ADMIN' } } });
    if (others === 0) throw new ConflictException({ code: 'LAST_SUPER_ADMIN', message: 'There must always be at least one active Super Admin.' });
  }
}
