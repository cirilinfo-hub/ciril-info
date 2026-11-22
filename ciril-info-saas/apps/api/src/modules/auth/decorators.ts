import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import type { PlatformPermission, TenantPermission } from '../rbac/permissions.js';
import type { AuthUser, Portal, RequestMeta, TenantContext } from './auth.types.js';

export const IS_PUBLIC = 'auth:public';
export const ALLOW_INCOMPLETE = 'auth:allow-incomplete';
export const PORTAL = 'auth:portal';
export const PLATFORM_PERMS = 'auth:platform-perms';
export const TENANT_PERMS = 'auth:tenant-perms';

/** No authentication required (marketing data, login, register, webhooks…). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Reachable before MFA enrolment / forced password change is complete
 * (e.g. /auth/me, /auth/mfa/setup, /auth/password). Everything else is blocked.
 */
export const AllowIncompleteAuth = () => SetMetadata(ALLOW_INCOMPLETE, true);

/** Restrict a controller/route to sessions from one portal. */
export const RequirePortal = (portal: Portal) => SetMetadata(PORTAL, portal);

/** Admin portal: caller's platform role must grant ALL listed permissions. Implies admin portal. */
export const RequirePlatform = (...perms: PlatformPermission[]) => SetMetadata(PLATFORM_PERMS, perms);

/**
 * Customer portal: caller must be an active member of the tenant in X-Tenant-Id
 * (or their only tenant) with ALL listed permissions. Sets req.tenant.
 */
export const RequireTenant = (...perms: TenantPermission[]) => SetMetadata(TENANT_PERMS, perms);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<Request>().user;
  if (!user) throw new Error('CurrentUser used on a route without authentication');
  return user;
});

export const CurrentTenant = createParamDecorator((_: unknown, ctx: ExecutionContext): TenantContext => {
  const tenant = ctx.switchToHttp().getRequest<Request>().tenant;
  if (!tenant) throw new Error('CurrentTenant used on a route without @RequireTenant');
  return tenant;
});

export const ReqMeta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMeta => {
  const req = ctx.switchToHttp().getRequest<Request & { id?: string }>();
  return {
    ip: req.ip,
    userAgent: req.headers['user-agent']?.slice(0, 512),
    requestId: req.id ? String(req.id) : undefined,
  };
});
