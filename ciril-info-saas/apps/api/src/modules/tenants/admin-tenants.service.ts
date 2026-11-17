import { randomInt } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import { Prisma } from '../../generated/prisma/client.js';
import { orderBy, page, skipTake } from '../../common/http/pagination.js';
import { randomToken, sha256Hex } from '../../common/security/crypto.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser, RequestMeta } from '../auth/auth.types.js';
import { MailService } from '../mail/mail.service.js';
import type { AdminCreateTenantDto, AdminTenantListQuery, AdminUpdateTenantDto } from './tenants.dto.js';

const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60) || 'org';

/** Admin-portal tenant management (platform role, guarded by platform permissions). */
@Injectable()
export class AdminTenantsService {
  private readonly portalUrl: string;

  constructor(
    private readonly db: PlatformPrisma,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    config: ConfigService<Env, true>,
  ) {
    this.portalUrl = config.get('CUSTOMER_PORTAL_URL', { infer: true }).replace(/\/$/, '');
  }

  async list(q: AdminTenantListQuery) {
    const where: Prisma.TenantWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { customerAccount: { accountNo: { contains: q.search, mode: 'insensitive' } } },
              { customerAccount: { billingEmail: { contains: q.search, mode: 'insensitive' } } },
              { memberships: { some: { user: { email: { contains: q.search, mode: 'insensitive' } } } } },
            ],
          }
        : {}),
    };
    const sort = orderBy<Prisma.TenantOrderByWithRelationInput>(
      q.sort,
      { name: (d) => ({ name: d }), createdAt: (d) => ({ createdAt: d }), status: (d) => ({ status: d }) },
      { createdAt: 'desc' },
    );
    const [rows, total] = await this.db.$transaction([
      this.db.tenant.findMany({
        where,
        orderBy: sort,
        ...skipTake(q),
        select: {
          id: true, name: true, slug: true, status: true, createdAt: true, suspendedAt: true,
          customerAccount: { select: { accountNo: true, billingEmail: true } },
          memberships: { where: { status: 'ACTIVE', role: { key: 'TENANT_OWNER' } }, take: 1, select: { user: { select: { id: true, firstName: true, lastName: true, email: true } } } },
          _count: { select: { memberships: { where: { status: 'ACTIVE' } }, subscriptions: true, domains: true, hostingAccounts: true } },
        },
      }),
      this.db.tenant.count({ where }),
    ]);
    return page(
      rows.map(({ memberships, ...t }) => ({ ...t, owner: memberships[0]?.user ?? null })),
      total,
      q,
    );
  }

  async get(id: string) {
    const t = await this.db.tenant.findUnique({
      where: { id },
      select: {
        id: true, name: true, slug: true, status: true, createdAt: true, updatedAt: true, suspendedAt: true,
        customerAccount: true,
        addresses: true,
        memberships: {
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'asc' },
          select: { id: true, createdAt: true, role: { select: { key: true, name: true } }, user: { select: { id: true, email: true, firstName: true, lastName: true, status: true, lastLoginAt: true, mfaEnabled: true } } },
        },
        invitations: { where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, email: true, expiresAt: true, role: { select: { key: true, name: true } } } },
        _count: { select: { subscriptions: true, domains: true, hostingAccounts: true, invoices: true, tickets: true } },
      },
    });
    if (!t) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Tenant not found.' });
    return t;
  }

  /**
   * Mandatory case #3 (tenant creation). Creates the organisation and its billing
   * account. If the owner already has a customer account they are added directly;
   * otherwise they receive an invitation to set up their login.
   */
  async create(actor: AuthUser, dto: AdminCreateTenantDto, meta: RequestMeta) {
    const email = dto.owner.email.toLowerCase();
    const ownerRole = await this.db.role.findUniqueOrThrow({ where: { key: 'TENANT_OWNER' }, select: { id: true, name: true } });
    const existing = await this.db.user.findUnique({ where: { email }, select: { id: true, platformRoleId: true } });
    if (existing?.platformRoleId) {
      throw new ConflictException({ code: 'STAFF_EMAIL', message: 'That email belongs to a staff account. Use a different owner email.' });
    }
    const actorUser = await this.db.user.findUniqueOrThrow({ where: { id: actor.id }, select: { firstName: true, lastName: true } });

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.db.$transaction(async (tx) => {
          const tenant = await tx.tenant.create({
            data: {
              name: dto.name,
              slug: `${slugify(dto.name)}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, '')}`,
              status: 'ACTIVE',
              customerAccount: { create: { accountNo: `CI-${randomInt(100_000, 1_000_000)}`, billingEmail: email, companyName: dto.name, phone: dto.phone ?? null } },
            },
            select: { id: true, name: true },
          });
          if (existing) {
            await tx.tenantMembership.create({ data: { tenantId: tenant.id, userId: existing.id, roleId: ownerRole.id } });
          } else {
            const token = randomToken();
            await tx.invitation.create({
              data: { tenantId: tenant.id, email, roleId: ownerRole.id, tokenHash: sha256Hex(token), invitedById: actor.id, expiresAt: new Date(Date.now() + 7 * 86_400_000) },
            });
            await this.mail.enqueue(
              { template: 'invitation', to: email, data: { inviterName: `${actorUser.firstName} ${actorUser.lastName} (Ciril Info)`, organisation: tenant.name, roleName: ownerRole.name, link: `${this.portalUrl}/invitations/accept?token=${token}` } },
              tx,
              tenant.id,
            );
          }
          await this.audit.record({ action: 'tenant.create', actorId: actor.id, tenantId: tenant.id, entityType: 'tenant', entityId: tenant.id, metadata: { name: dto.name, ownerEmail: email, ownerExisted: !!existing }, meta }, tx);
          return { id: tenant.id, ownerInvited: !existing };
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue; // slug/account-no collision
        throw err;
      }
    }
    throw new ConflictException({ code: 'CONFLICT', message: 'Please try again.' });
  }

  async update(actor: AuthUser, id: string, dto: AdminUpdateTenantDto, meta: RequestMeta) {
    await this.get(id);
    const { name, ...account } = dto;
    await this.db.$transaction(async (tx) => {
      if (name !== undefined) await tx.tenant.update({ where: { id }, data: { name } });
      if (Object.keys(account).length) {
        await tx.customerAccount.update({ where: { tenantId: id }, data: { ...account, billingEmail: account.billingEmail?.toLowerCase() } });
      }
      await this.audit.record({ action: 'tenant.update', actorId: actor.id, tenantId: id, entityType: 'tenant', entityId: id, metadata: { fields: Object.keys(dto) }, meta }, tx);
    });
    return this.get(id);
  }

  async setStatus(actor: AuthUser, id: string, status: 'ACTIVE' | 'SUSPENDED', reason: string | undefined, meta: RequestMeta) {
    const t = await this.db.tenant.findUnique({ where: { id }, select: { status: true } });
    if (!t) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Tenant not found.' });
    if (t.status === status) return this.get(id);
    if (t.status === 'CLOSED') throw new ConflictException({ code: 'TENANT_CLOSED', message: 'Closed tenants cannot be changed.' });
    await this.db.$transaction(async (tx) => {
      await tx.tenant.update({ where: { id }, data: { status, suspendedAt: status === 'SUSPENDED' ? new Date() : null } });
      await this.audit.record({ action: status === 'SUSPENDED' ? 'tenant.suspend' : 'tenant.activate', actorId: actor.id, tenantId: id, entityType: 'tenant', entityId: id, metadata: { reason, from: t.status }, meta }, tx);
    });
    return this.get(id);
  }

  async activity(id: string, q: { page: number; pageSize: number }) {
    const where = { tenantId: id };
    const [rows, total] = await this.db.$transaction([
      this.db.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q), select: { id: true, action: true, entityType: true, entityId: true, metadata: true, ipAddress: true, createdAt: true, actor: { select: { id: true, email: true, firstName: true, lastName: true } } } }),
      this.db.auditLog.count({ where }),
    ]);
    return page(rows, total, q);
  }
}
