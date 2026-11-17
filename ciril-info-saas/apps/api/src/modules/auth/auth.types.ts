import type { PlatformPermission, TenantPermission } from '../rbac/permissions.js';

/** Which front end a session belongs to. Tokens from one cannot be used on the other. */
export type Portal = 'customer' | 'admin';
export const PORTALS: readonly Portal[] = ['customer', 'admin'];

/** Claims inside the 15-minute access JWT. */
export interface AccessClaims {
  sub: string; // user id
  sid: string; // session id (revocation is checked on every request)
  aud: Portal;
  typ: 'access';
  /** Second factor completed for this session. Required for admin portal. */
  mfa: boolean;
  /** Password change required before anything else (e.g. seeded admin). */
  pwc: boolean;
}

/** Short-lived token proving the password step passed; exchanged for a session after TOTP. */
export interface MfaChallengeClaims {
  sub: string;
  aud: Portal;
  typ: 'mfa';
}

/** Attached to the request by AuthGuard. */
export interface AuthUser {
  id: string;
  sessionId: string;
  portal: Portal;
  email: string;
  mfaVerified: boolean;
  mustChangePassword: boolean;
  platformRoleKey: string | null;
  platformPermissions: ReadonlySet<PlatformPermission>;
}

/** Attached to the request by TenantGuard for customer-portal endpoints. */
export interface TenantContext {
  tenantId: string;
  userId: string;
  roleKey: string;
  permissions: ReadonlySet<TenantPermission>;
}

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

declare module 'express' {
  interface Request {
    user?: AuthUser;
    tenant?: TenantContext;
  }
}
