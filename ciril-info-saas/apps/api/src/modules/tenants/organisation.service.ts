import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { PlatformPrisma, TenantPrisma } from '../../database/prisma-clients.js';
import { randomToken, sha256Hex } from '../../common/security/crypto.js';
import { type ListQueryDto, page, skipTake } from '../../common/http/pagination.js';
import { AuditService } from '../audit/audit.service.js';
import type { RequestMeta, TenantContext } from '../auth/auth.types.js';
import { PasswordService } from '../auth/password.service.js';
import { MailService } from '../mail/mail.service.js';
import type { UpdateOrganisationDto } from './tenants.dto.js';
import { canAssign, canRemove } from './tenant-roles.js';

const INVITE_TTL_DAYS = 7;

/** Columns of `users` the tenant role may read (password/MFA columns are not granted). */
const userPublic = { id: true, email: true, firstName: true, lastName: true, lastLoginAt: true } as const;

/**
 * Customer-portal organisation management. Every query runs through
 * TenantPrisma.run(), so PostgreSQL RLS confines it to the caller's tenant.
 */
@Injectable()
export class OrganisationService {
  private readonly portalUrl: string;

  constructor(
    private readonly tenantDb: TenantPrisma,
    private readonly platformDb: PlatformPrisma,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly passwords: PasswordService,
    config: ConfigService<Env, true>,
  ) {
    this.portalUrl = config.get('CUSTOMER_PORTAL_URL', { infer: true }).replace(/\/$/, '');
  }

  get(ctx: TenantContext) {
    return this.tenantDb.run(ctx, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: ctx.tenantId },
        select: {
          id: true, name: true, slug: true, status: true, createdAt: true,
          customerAccount: { select: { accountNo: true, companyName: true, billingEmail: true, phone: true, gstin: true, currency: true } },
          addresses: { select: { id: true, label: true, line1: true, line2: true, city: true, state: true, stateCode: true, postalCode: true, country: true, isDefault: true } },
          _count: { select: { memberships: { where: { status: 'ACTIVE' } } } },
        },
      });
      return { ...tenant, role: ctx.roleKey, permissions: [...ctx.permissions].sort() };
    });
  }

  update(ctx: TenantContext, dto: UpdateOrganisationDto, meta: RequestMeta) {
    return this.tenantDb.run(ctx, async (tx) => {
      const { name, ...account } = dto;
      if (name !== undefined) await tx.tenant.update({ where: { id: ctx.tenantId }, data: { name } });
      if (Object.keys(account).length) {
        await tx.customerAccount.update({
          where: { tenantId: ctx.tenantId },
          data: { ...account, billingEmail: account.billingEmail?.toLowerCase() },
        });
      }
      await tx.auditLog.create({
        data: { action: 'organisation.update', actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'tenant', entityId: ctx.tenantId, metadata: { fields: Object.keys(dto) }, ipAddress: meta.ip ?? null, requestId: meta.requestId },
      });
    }).then(() => this.get(ctx));
  }

  // ─── Members ───

  listMembers(ctx: TenantContext) {
    return this.tenantDb.run(ctx, async (tx) => {
      const rows = await tx.tenantMembership.findMany({
        where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
        select: { id: true, createdAt: true, role: { select: { key: true, name: true } }, user: { select: userPublic } },
        orderBy: { createdAt: 'asc' },
      });
      return { data: rows.map((r) => ({ ...r, isYou: r.user.id === ctx.userId })) };
    });
  }

  async changeRole(ctx: TenantContext, membershipId: string, roleKey: string, meta: RequestMeta) {
    const role = await this.platformDb.role.findUniqueOrThrow({ where: { key: roleKey }, select: { id: true } });
    return this.tenantDb.run(ctx, async (tx) => {
      const m = await tx.tenantMembership.findFirst({ where: { id: membershipId, status: 'ACTIVE' }, select: { userId: true, role: { select: { key: true } } } });
      if (!m) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Member not found.' });
      if (m.userId === ctx.userId) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You cannot change your own role.' });
      if (!canAssign(ctx.roleKey, roleKey, m.role.key)) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Your role does not allow this change.' });
      await tx.tenantMembership.update({ where: { id: membershipId }, data: { roleId: role.id } });
      await tx.auditLog.create({ data: { action: 'member.role_changed', actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'membership', entityId: membershipId, metadata: { from: m.role.key, to: roleKey }, ipAddress: meta.ip ?? null, requestId: meta.requestId } });
    });
  }

  async removeMember(ctx: TenantContext, membershipId: string, meta: RequestMeta) {
    return this.tenantDb.run(ctx, async (tx) => {
      const m = await tx.tenantMembership.findFirst({ where: { id: membershipId, status: 'ACTIVE' }, select: { userId: true, role: { select: { key: true } } } });
      if (!m) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Member not found.' });
      const self = m.userId === ctx.userId;
      if (!self && !canRemove(ctx.roleKey, m.role.key)) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Your role does not allow removing this member.' });
      if (m.role.key === 'TENANT_OWNER') {
        const owners = await tx.tenantMembership.count({ where: { status: 'ACTIVE', role: { key: 'TENANT_OWNER' } } });
        if (owners <= 1) throw new ConflictException({ code: 'LAST_OWNER', message: 'An organisation must keep at least one owner.' });
      }
      await tx.tenantMembership.update({ where: { id: membershipId }, data: { status: 'REMOVED' } });
      await tx.auditLog.create({ data: { action: self ? 'member.left' : 'member.removed', actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'membership', entityId: membershipId, ipAddress: meta.ip ?? null, requestId: meta.requestId } });
    });
  }

  // ─── Invitations ───

  async invite(ctx: TenantContext, emailRaw: string, roleKey: string, meta: RequestMeta) {
    const email = emailRaw.toLowerCase();
    if (!canAssign(ctx.roleKey, roleKey)) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Your role cannot invite someone with that role.' });
    const role = await this.platformDb.role.findUniqueOrThrow({ where: { key: roleKey }, select: { id: true, name: true } });
    const token = randomToken();

    await this.tenantDb.run(ctx, async (tx) => {
      const already = await tx.tenantMembership.findFirst({ where: { status: 'ACTIVE', user: { email } }, select: { id: true } });
      if (already) throw new ConflictException({ code: 'ALREADY_MEMBER', message: 'That person is already a member.' });
      // Replace any pending invitation for the same address.
      await tx.invitation.updateMany({ where: { email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      const inviter = await tx.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { firstName: true, lastName: true } });
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { name: true } });
      const inv = await tx.invitation.create({
        data: { tenantId: ctx.tenantId, email, roleId: role.id, tokenHash: sha256Hex(token), invitedById: ctx.userId, expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000) },
        select: { id: true },
      });
      await this.mail.enqueue(
        { template: 'invitation', to: email, data: { inviterName: `${inviter.firstName} ${inviter.lastName}`, organisation: tenant.name, roleName: role.name, link: `${this.portalUrl}/invitations/accept?token=${token}` } },
        tx,
        ctx.tenantId,
      );
      await tx.auditLog.create({ data: { action: 'member.invited', actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'invitation', entityId: inv.id, metadata: { email, role: roleKey }, ipAddress: meta.ip ?? null, requestId: meta.requestId } });
    });
  }

  listInvitations(ctx: TenantContext) {
    return this.tenantDb.run(ctx, async (tx) => ({
      data: await tx.invitation.findMany({
        where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true, email: true, expiresAt: true, createdAt: true, role: { select: { key: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    }));
  }

  revokeInvitation(ctx: TenantContext, id: string, meta: RequestMeta) {
    return this.tenantDb.run(ctx, async (tx) => {
      const r = await tx.invitation.updateMany({ where: { id, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      if (r.count === 0) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Invitation not found.' });
      await tx.auditLog.create({ data: { action: 'member.invitation_revoked', actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'invitation', entityId: id, ipAddress: meta.ip ?? null, requestId: meta.requestId } });
    });
  }

  // ─── Accepting (runs before the user has a tenant context → platform role, token-scoped) ───

  private async findInvitation(token: string) {
    const inv = await this.platformDb.invitation.findUnique({
      where: { tokenHash: sha256Hex(token) },
      select: { id: true, email: true, tenantId: true, roleId: true, expiresAt: true, acceptedAt: true, revokedAt: true, role: { select: { key: true, name: true } }, tenant: { select: { name: true, status: true } } },
    });
    if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date() || inv.tenant.status !== 'ACTIVE') {
      throw new BadRequestException({ code: 'INVALID_LINK', message: 'This invitation is invalid or has expired. Ask for a new one.' });
    }
    return inv;
  }

  async previewInvitation(token: string) {
    const inv = await this.findInvitation(token);
    const exists = await this.platformDb.user.count({ where: { email: inv.email } });
    return { organisation: inv.tenant.name, email: inv.email, role: inv.role, accountExists: exists > 0 };
  }

  /** New person: create the account (email is proven by possession of the link) and join. */
  async acceptAsNewUser(dto: { token: string; firstName: string; lastName: string; password: string }, meta: RequestMeta) {
    const inv = await this.findInvitation(dto.token);
    if (await this.platformDb.user.count({ where: { email: inv.email } })) {
      throw new ConflictException({ code: 'SIGN_IN_TO_ACCEPT', message: 'You already have an account. Sign in to accept this invitation.' });
    }
    const check = this.passwords.check(dto.password, { email: inv.email });
    if (!check.ok) throw new BadRequestException({ code: 'WEAK_PASSWORD', message: check.reason });
    const hash = await this.passwords.hash(dto.password);
    await this.platformDb.$transaction(async (tx) => {
      const claimed = await tx.invitation.updateMany({ where: { id: inv.id, acceptedAt: null, revokedAt: null }, data: { acceptedAt: new Date() } });
      if (claimed.count === 0) throw new BadRequestException({ code: 'INVALID_LINK', message: 'This invitation has already been used.' });
      const user = await tx.user.create({
        data: { email: inv.email, firstName: dto.firstName, lastName: dto.lastName, passwordHash: hash, passwordChangedAt: new Date(), emailVerifiedAt: new Date() },
      });
      await tx.tenantMembership.create({ data: { tenantId: inv.tenantId, userId: user.id, roleId: inv.roleId } });
      await this.audit.record({ action: 'member.joined', actorId: user.id, tenantId: inv.tenantId, entityType: 'invitation', entityId: inv.id, meta }, tx);
    });
    return { status: 'JOINED', organisation: inv.tenant.name };
  }

  /** Existing user, signed in to the customer portal with the invited email address. */
  async acceptAsUser(userId: string, token: string, meta: RequestMeta) {
    const inv = await this.findInvitation(token);
    const user = await this.platformDb.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    if (user.email !== inv.email) {
      throw new ForbiddenException({ code: 'WRONG_ACCOUNT', message: `This invitation is for ${inv.email}. Sign in with that address to accept it.` });
    }
    await this.platformDb.$transaction(async (tx) => {
      const claimed = await tx.invitation.updateMany({ where: { id: inv.id, acceptedAt: null, revokedAt: null }, data: { acceptedAt: new Date() } });
      if (claimed.count === 0) throw new BadRequestException({ code: 'INVALID_LINK', message: 'This invitation has already been used.' });
      await tx.tenantMembership.upsert({
        where: { tenantId_userId: { tenantId: inv.tenantId, userId } },
        update: { status: 'ACTIVE', roleId: inv.roleId },
        create: { tenantId: inv.tenantId, userId, roleId: inv.roleId },
      });
      await this.audit.record({ action: 'member.joined', actorId: userId, tenantId: inv.tenantId, entityType: 'invitation', entityId: inv.id, meta }, tx);
    });
    return { status: 'JOINED', organisation: inv.tenant.name, tenantId: inv.tenantId };
  }

  // ─── Activity (this tenant's audit trail, RLS-scoped) ───

  activity(ctx: TenantContext, q: ListQueryDto & { action?: string }) {
    return this.tenantDb.run(ctx, async (tx) => {
      const where = { tenantId: ctx.tenantId, ...(q.action ? { action: { startsWith: q.action } } : {}) };
      const [rows, total] = await Promise.all([
        tx.auditLog.findMany({
          where,
          select: { id: true, action: true, entityType: true, entityId: true, createdAt: true, ipAddress: true, actor: { select: { firstName: true, lastName: true, email: true } } },
          orderBy: { createdAt: 'desc' },
          ...skipTake(q),
        }),
        tx.auditLog.count({ where }),
      ]);
      return page(rows, total, q);
    });
  }
}
