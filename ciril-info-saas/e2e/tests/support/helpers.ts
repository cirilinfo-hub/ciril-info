import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

export const API = process.env['E2E_API_URL'] ?? 'http://localhost:3000';
const MAILPIT = process.env['E2E_MAILPIT_URL'] ?? 'http://localhost:8025';
const API_DIR = resolve(import.meta.dirname, '../../../apps/api');

/** Every e2e account uses this prefix so cleanup can find it. */
export const PREFIX = 'pw-';
export const uniqueEmail = (label: string) => `${PREFIX}${label}-${randomUUID().slice(0, 8)}@example.test`;

export function fixture(...args: string[]): unknown {
  const out = execFileSync(process.execPath, ['--import', 'tsx', 'scripts/e2e-fixtures.ts', ...args], { cwd: API_DIR, encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').pop()!);
}

/** Wait for an email to arrive in Mailpit and return the first link in it. */
export async function linkFromEmail(to: string, contains: string, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json()) as { messages: { ID: string }[] };
    for (const m of list.messages ?? []) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as { Text: string };
      const link = msg.Text.match(/https?:\/\/\S+/g)?.find((l) => l.includes(contains));
      if (link) return link;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email to ${to} containing a "${contains}" link within ${timeoutMs}ms`);
}

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) — what an authenticator app would show. */
export function totp(secretBase32: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0;
  const bytes: number[] = [];
  for (const ch of secretBase32.replace(/\s/g, '').toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const o = h[h.length - 1]! & 15;
  const code = ((h[o]! & 127) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(code % 1_000_000).padStart(6, '0');
}
