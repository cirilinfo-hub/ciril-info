import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import type { Env } from '../../config/env.js';
import { PlatformPrisma, type Tx } from '../../database/prisma-clients.js';
import { randomToken, sha256Hex } from '../../common/security/crypto.js';
import type { Portal, RequestMeta } from './auth.types.js';

export const REFRESH_COOKIE_PATH = '/api/v1/auth';
export const refreshCookieName = (portal: Portal) => `ci_rt_${portal}`;

/** Window in which reuse of the previous refresh token is treated as a concurrent-tab race, not theft. */
const RACE_WINDOW_MS = 10_000;

export type RotateResult =
  | { kind: 'ok'; sessionId: string; userId: string; refreshToken: string; mfaVerified: boolean }
  | { kind: 'race' }
  | { kind: 'reuse'; sessionId: string; userId: string }
  | { kind: 'invalid' };

/**
 * Refresh-token sessions. One row per sign-in; the raw token lives only in the
 * browser's httpOnly cookie, the database stores its SHA-256 hash.
 */
@Injectable()
export class SessionService {
  private readonly ttlDays: number;
  private readonly cookieBase: CookieOptions;

  constructor(
    private readonly db: PlatformPrisma,
    config: ConfigService<Env, true>,
  ) {
    this.ttlDays = config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true });
    const secure = config.get('API_URL', { infer: true }).startsWith('https://');
    const domain = config.get('COOKIE_DOMAIN', { infer: true }) || undefined;
    this.cookieBase = { httpOnly: true, secure, sameSite: 'strict', path: REFRESH_COOKIE_PATH, domain };
  }

  async create(
    userId: string,
    portal: Portal,
    mfaVerified: boolean,
    meta: RequestMeta,
    tx?: Tx,
  ): Promise<{ sessionId: string; refreshToken: string }> {
    const refreshToken = randomToken();
    const session = await (tx ?? this.db).userSession.create({
      data: {
        userId,
        audience: portal,
        mfaVerified,
        refreshTokenHash: sha256Hex(refreshToken),
        userAgent: meta.userAgent,
        ipAddress: meta.ip ?? null,
        expiresAt: new Date(Date.now() + this.ttlDays * 86_400_000),
      },
      select: { id: true },
    });
    return { sessionId: session.id, refreshToken };
  }

  async rotate(refreshToken: string, portal: Portal): Promise<RotateResult> {
    const hash = sha256Hex(refreshToken);
    return this.db.$transaction(async (tx) => {
      const current = await tx.userSession.findUnique({ where: { refreshTokenHash: hash } });
      if (current) {
        if (current.revokedAt || current.expiresAt < new Date() || current.audience !== portal) return { kind: 'invalid' as const };
        const next = randomToken();
        // Conditional update guards against two requests rotating the same token concurrently.
        const updated = await tx.userSession.updateMany({
          where: { id: current.id, refreshTokenHash: hash, revokedAt: null },
          data: { previousTokenHash: hash, refreshTokenHash: sha256Hex(next), lastUsedAt: new Date() },
        });
        if (updated.count === 0) return { kind: 'race' as const };
        return { kind: 'ok' as const, sessionId: current.id, userId: current.userId, refreshToken: next, mfaVerified: current.mfaVerified };
      }

      const previous = await tx.userSession.findFirst({ where: { previousTokenHash: hash, revokedAt: null } });
      if (!previous) return { kind: 'invalid' as const };
      if (Date.now() - previous.lastUsedAt.getTime() < RACE_WINDOW_MS) return { kind: 'race' as const };
      // An old token was replayed after rotation: assume theft and end the session.
      await tx.userSession.update({ where: { id: previous.id }, data: { revokedAt: new Date(), revokedReason: 'refresh_token_reuse' } });
      return { kind: 'reuse' as const, sessionId: previous.id, userId: previous.userId };
    });
  }

  async markMfaVerified(sessionId: string, tx?: Tx) {
    await (tx ?? this.db).userSession.update({ where: { id: sessionId }, data: { mfaVerified: true } });
  }

  async revoke(sessionId: string, reason: string) {
    await this.db.userSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
  }

  /** Revoke every session of a user, optionally keeping one (e.g. the session that changed the password). */
  async revokeAll(userId: string, reason: string, exceptSessionId?: string, tx?: Tx): Promise<number> {
    const r = await (tx ?? this.db).userSession.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return r.count;
  }

  setCookie(res: Response, portal: Portal, refreshToken: string) {
    res.cookie(refreshCookieName(portal), refreshToken, { ...this.cookieBase, maxAge: this.ttlDays * 86_400_000 });
  }

  clearCookie(res: Response, portal: Portal) {
    res.clearCookie(refreshCookieName(portal), this.cookieBase);
  }
}
