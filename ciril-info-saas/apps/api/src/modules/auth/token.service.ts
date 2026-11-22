import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../../config/env.js';
import type { AccessClaims, MfaChallengeClaims, Portal } from './auth.types.js';

const ISSUER = 'cirilinfo-api';

@Injectable()
export class TokenService {
  private readonly accessTtl: number;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService<Env, true>,
  ) {
    this.accessTtl = config.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
  }

  get accessTtlSeconds() {
    return this.accessTtl;
  }

  signAccess(c: Omit<AccessClaims, 'typ'>): string {
    return this.jwt.sign({ ...c, typ: 'access' }, { expiresIn: this.accessTtl, issuer: ISSUER, algorithm: 'HS256' });
  }

  verifyAccess(token: string): AccessClaims | null {
    try {
      const c = this.jwt.verify<AccessClaims>(token, { issuer: ISSUER, algorithms: ['HS256'] });
      return c.typ === 'access' ? c : null;
    } catch {
      return null;
    }
  }

  signMfaChallenge(userId: string, portal: Portal): string {
    return this.jwt.sign({ sub: userId, aud: portal, typ: 'mfa' } satisfies MfaChallengeClaims, {
      expiresIn: 300,
      issuer: ISSUER,
      algorithm: 'HS256',
    });
  }

  verifyMfaChallenge(token: string): MfaChallengeClaims | null {
    try {
      const c = this.jwt.verify<MfaChallengeClaims>(token, { issuer: ISSUER, algorithms: ['HS256'] });
      return c.typ === 'mfa' ? c : null;
    } catch {
      return null;
    }
  }
}
