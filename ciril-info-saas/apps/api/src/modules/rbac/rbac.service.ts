import { Injectable } from '@nestjs/common';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import type { PlatformPermission, TenantPermission } from './permissions.js';

interface CachedRole {
  key: string;
  permissions: Set<string>;
  at: number;
}

/**
 * Resolves role → permissions from the database (roles / role_permissions),
 * cached for 60 seconds so a permission change takes effect within a minute
 * without a query per request.
 */
@Injectable()
export class RbacService {
  private readonly cache = new Map<string, CachedRole>();
  private readonly ttlMs = 60_000;

  constructor(private readonly db: PlatformPrisma) {}

  async role(roleId: string): Promise<CachedRole> {
    const hit = this.cache.get(roleId);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit;
    const role = await this.db.role.findUniqueOrThrow({
      where: { id: roleId },
      select: { key: true, permissions: { select: { permission: { select: { key: true } } } } },
    });
    // Stored keys are namespaced ("platform:users:read"); strip the scope prefix.
    const permissions = new Set(role.permissions.map((rp) => rp.permission.key.replace(/^(platform|tenant):/, '')));
    const entry = { key: role.key, permissions, at: Date.now() };
    this.cache.set(roleId, entry);
    return entry;
  }

  async platformPermissions(roleId: string): Promise<{ key: string; permissions: Set<PlatformPermission> }> {
    const r = await this.role(roleId);
    return { key: r.key, permissions: r.permissions as Set<PlatformPermission> };
  }

  async tenantPermissions(roleId: string): Promise<{ key: string; permissions: Set<TenantPermission> }> {
    const r = await this.role(roleId);
    return { key: r.key, permissions: r.permissions as Set<TenantPermission> };
  }

  invalidate(roleId?: string) {
    if (roleId) this.cache.delete(roleId);
    else this.cache.clear();
  }
}
