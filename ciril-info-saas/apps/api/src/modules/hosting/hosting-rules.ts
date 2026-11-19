import { createHash } from 'node:crypto';
import type { ProductType } from '../../generated/prisma/client.js';

/** Product types that are hosted on a server and need an account set up on a control panel. */
export const HOSTING_PRODUCT_TYPES: readonly ProductType[] = ['WEB_HOSTING', 'WORDPRESS_HOSTING', 'CLOUD_HOSTING', 'VPS_HOSTING'];

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const TLD = /^[a-z]{2,24}$/;

/**
 * A domain name a customer may host: lowercase letters, digits and hyphens in dot-separated labels, with a real-looking
 * ending. The scheme, "www." prefix, path, port and spaces are stripped first so what people paste still works.
 * Returns null when it cannot be a domain (an IP address, a single word, an unsupported character).
 */
export function normaliseDomain(input: string): string | null {
  let d = input.trim().toLowerCase();
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');
  if (d.startsWith('www.')) d = d.slice(4);
  if (d.length < 4 || d.length > 253) return null;
  const labels = d.split('.');
  if (labels.length < 2) return null;
  if (!labels.every((l) => LABEL.test(l))) return null;
  if (!TLD.test(labels[labels.length - 1]!)) return null; // also rules out 192.168.0.1
  return d;
}

/**
 * A proposed panel username: starts with a letter, lowercase letters and digits only, at most 16 characters (the cPanel
 * limit). Built from the domain plus a short stable suffix of a seed, so two customers with similar domains get
 * different names and the same account always gets the same name.
 */
export function panelUsername(domain: string, seed: string): string {
  const stem = domain.split('.')[0]!.replace(/[^a-z0-9]/g, '');
  const letters = (/^[a-z]/.test(stem) ? stem : `a${stem}`).slice(0, 8);
  const suffix = createHash('sha256').update(seed).digest('hex').slice(0, 5);
  return `${letters}${suffix}`.slice(0, 16);
}

/** How long a failed attempt waits before the next one: 1, 2, 4, 8 minutes. Capped at an hour. */
export const retryDelayMs = (attempt: number): number => Math.min(60_000 * 2 ** Math.max(0, attempt - 1), 3_600_000);

export const MAX_ATTEMPTS = 5;
