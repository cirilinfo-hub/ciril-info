import { Injectable, type OnModuleInit } from '@nestjs/common';
import argon2 from 'argon2';

/** OWASP-recommended argon2id parameters (19 MiB, 2 iterations). */
const ARGON = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

const COMMON = new Set([
  'password', 'password1', 'password123', '1234567890', '12345678910', 'qwertyuiop', 'iloveyou12',
  'welcome123', 'admin12345', 'letmein123', 'cirilinfo', 'cirilinfo123', 'changeme123',
]);

export interface PasswordCheck {
  ok: boolean;
  reason?: string;
}

@Injectable()
export class PasswordService implements OnModuleInit {
  /** Hash of a random value, verified against when the user does not exist, so timing doesn't reveal accounts. */
  private dummyHash = '';

  async onModuleInit() {
    this.dummyHash = await argon2.hash(`dummy-${Math.random()}`, ARGON);
  }

  /** NIST 800-63B style: length over composition rules, block common and personal passwords. */
  check(password: string, context: { email?: string; name?: string } = {}): PasswordCheck {
    if (password.length < 10) return { ok: false, reason: 'Use at least 10 characters.' };
    if (password.length > 128) return { ok: false, reason: 'Use 128 characters or fewer.' };
    const lower = password.toLowerCase();
    if (COMMON.has(lower)) return { ok: false, reason: 'This password is too common. Choose something less predictable.' };
    if (/^(.)\1+$/.test(password)) return { ok: false, reason: 'Avoid repeating a single character.' };
    const local = context.email?.split('@')[0]?.toLowerCase();
    if (local && local.length >= 4 && lower.includes(local)) return { ok: false, reason: 'Don’t include your email address in your password.' };
    return { ok: true };
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON);
  }

  /** Always runs a full argon2 verification, even when there is no stored hash. */
  async verify(hash: string | null | undefined, password: string): Promise<boolean> {
    try {
      if (!hash) {
        await argon2.verify(this.dummyHash, password);
        return false;
      }
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }
}
