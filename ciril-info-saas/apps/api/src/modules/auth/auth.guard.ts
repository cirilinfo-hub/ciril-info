import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import type { PlatformPermission } from '../rbac/permissions.js';
import { RbacService } from '../rbac/rbac.service.js';
import type { AuthUser, Portal } from './auth.types.js';
import { ALLOW_INCOMPLETE, IS_PUBLIC, PLATFORM_PERMS, PORTAL } from './decorators.js';
import { TokenService } from './token.service.js';

const EMPTY = new Set<PlatformPermission>();

/**
 * Global guard. Every route requires a valid access token unless marked @Public().
 * Also enforces: session not revoked, portal separation, completed MFA for admin,
 * forced password change, and platform permissions (@RequirePlatform).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly db: PlatformPrisma,
    private readonly rbac: RbacService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const claims = token ? this.tokens.verifyAccess(token) : null;
    if (!claims) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Please sign in.' });

    // Revocation check on every request: logout, password reset and admin suspension take effect immediately.
    const session = await this.db.userSession.findUnique({
      where: { id: claims.sid },
      select: {
        revokedAt: true,
        expiresAt: true,
        userId: true,
        user: { select: { email: true, status: true, platformRoleId: true } },
      },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date() || session.userId !== claims.sub || session.user.status !== 'ACTIVE') {
      throw new UnauthorizedException({ code: 'SESSION_ENDED', message: 'Your session has ended. Please sign in again.' });
    }

    let platformRoleKey: string | null = null;
    let platformPermissions: ReadonlySet<PlatformPermission> = EMPTY;
    if (session.user.platformRoleId && claims.aud === 'admin') {
      const r = await this.rbac.platformPermissions(session.user.platformRoleId);
      platformRoleKey = r.key;
      platformPermissions = r.permissions;
    }

    const user: AuthUser = {
      id: claims.sub,
      sessionId: claims.sid,
      portal: claims.aud,
      email: session.user.email,
      mfaVerified: claims.mfa,
      mustChangePassword: claims.pwc,
      platformRoleKey,
      platformPermissions,
    };
    req.user = user;

    // Incomplete sign-in (MFA enrolment pending for staff, or password change required).
    const incomplete = user.mustChangePassword || (user.portal === 'admin' && !user.mfaVerified);
    if (incomplete && !this.reflector.getAllAndOverride<boolean>(ALLOW_INCOMPLETE, targets)) {
      throw new ForbiddenException({
        code: user.mustChangePassword ? 'PASSWORD_CHANGE_REQUIRED' : 'MFA_SETUP_REQUIRED',
        message: user.mustChangePassword ? 'Please choose a new password to continue.' : 'Set up two-step verification to continue.',
      });
    }

    const perms = this.reflector.getAllAndOverride<PlatformPermission[] | undefined>(PLATFORM_PERMS, targets);
    const portal: Portal | undefined = perms ? 'admin' : this.reflector.getAllAndOverride<Portal | undefined>(PORTAL, targets);
    if (portal && user.portal !== portal) {
      throw new ForbiddenException({ code: 'WRONG_PORTAL', message: 'This action is not available from this portal.' });
    }
    if (perms?.length) {
      if (!platformRoleKey) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have access to this area.' });
      const missing = perms.filter((p) => !platformPermissions.has(p));
      if (missing.length) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Your role does not allow this action.', details: { missing } });
      }
    }
    return true;
  }
}
