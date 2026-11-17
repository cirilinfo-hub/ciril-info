import { BadRequestException, type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import type { TenantPermission } from '../rbac/permissions.js';
import { RbacService } from '../rbac/rbac.service.js';
import { TENANT_PERMS } from './decorators.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Runs after AuthGuard on routes marked @RequireTenant(...). Resolves which tenant
 * the request acts on (X-Tenant-Id header, or the user's only tenant), verifies an
 * ACTIVE membership in an ACTIVE tenant, checks permissions and sets req.tenant.
 * Services then pass req.tenant into TenantPrisma.run(), where PostgreSQL RLS
 * enforces the same boundary again at the database.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: PlatformPrisma,
    private readonly rbac: RbacService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const perms = this.reflector.getAllAndOverride<TenantPermission[] | undefined>(TENANT_PERMS, [ctx.getHandler(), ctx.getClass()]);
    if (!perms) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const user = req.user;
    if (!user || user.portal !== 'customer') {
      throw new ForbiddenException({ code: 'WRONG_PORTAL', message: 'This action is only available in the customer portal.' });
    }

    const requested = req.headers['x-tenant-id'];
    if (requested !== undefined && (typeof requested !== 'string' || !UUID_RE.test(requested))) {
      throw new BadRequestException({ code: 'BAD_TENANT', message: 'Invalid organisation id.' });
    }

    const memberships = await this.db.tenantMembership.findMany({
      where: {
        userId: user.id,
        status: 'ACTIVE',
        tenant: { status: 'ACTIVE' },
        ...(requested ? { tenantId: requested } : {}),
      },
      select: { tenantId: true, roleId: true },
      take: 2,
    });

    if (memberships.length === 0) {
      // Same response whether the tenant does not exist or the user is not a member (no enumeration).
      throw new ForbiddenException({ code: 'NO_TENANT_ACCESS', message: 'You do not have access to this organisation.' });
    }
    if (!requested && memberships.length > 1) {
      throw new BadRequestException({ code: 'TENANT_REQUIRED', message: 'Choose an organisation first.' });
    }

    const m = memberships[0]!;
    const role = await this.rbac.tenantPermissions(m.roleId);
    const missing = perms.filter((p) => !role.permissions.has(p));
    if (missing.length) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Your role in this organisation does not allow this action.', details: { missing } });
    }

    req.tenant = { tenantId: m.tenantId, userId: user.id, roleKey: role.key, permissions: role.permissions };
    return true;
  }
}
