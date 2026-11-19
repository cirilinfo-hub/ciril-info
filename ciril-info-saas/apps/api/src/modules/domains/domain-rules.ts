/** Pure rules for domain search. No database, no registrar. */

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
/** A domain ending as stored: "com", "co.in". */
export const TLD_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)?$/;

export interface DomainQuery {
  /** The name part, e.g. "mybusiness". */
  label: string;
  /** The ending the visitor typed, if any, e.g. "com" or "co.in". */
  tld: string | null;
}

/** "  HTTPS://www.My Business.com/about " becomes { label: "mybusiness", tld: "com" }. Null when it cannot be a domain name. */
export function parseDomainQuery(input: string, knownTlds: readonly string[] = []): DomainQuery | null {
  let q = input.trim().toLowerCase();
  q = q.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/?#].*$/, '').replace(/\.$/, '');
  if (q.startsWith('www.')) q = q.slice(4);
  q = q.replace(/\s+/g, '');
  if (!q || q.length > 253) return null;

  // Everything after the first dot is the ending; "name.co.in" needs the known endings to tell "co.in" from a subdomain.
  const dot = q.indexOf('.');
  if (dot === -1) return LABEL.test(q) ? { label: q, tld: null } : null;
  const label = q.slice(0, dot);
  const rest = q.slice(dot + 1);
  if (!LABEL.test(label)) return null;
  if (TLD_PATTERN.test(rest) && (knownTlds.includes(rest) || !rest.includes('.'))) return { label, tld: rest };
  // "shop.name.com": keep the last labels that form a known ending, otherwise the last label.
  const parts = q.split('.');
  for (const take of [2, 1]) {
    if (parts.length <= take) continue;
    const tld = parts.slice(-take).join('.');
    const l = parts[parts.length - take - 1]!;
    if (TLD_PATTERN.test(tld) && LABEL.test(l) && (take === 1 || knownTlds.includes(tld))) return { label: l, tld };
  }
  return null;
}

/** Rupees as a two-decimal string safe to store, or null when it is not a usable price. */
export function priceString(n: number): string | null {
  return Number.isFinite(n) && n >= 0 && n <= 10_000_000 ? n.toFixed(2) : null;
}

export const MAX_YEARS = 5;

/**
 * What a registration for `years` costs in paise before tax: the register price for the first year, then the renewal price
 * for each further year (the way registrars price a multi-year term).
 */
export function registrationPaise(registerPaise: number, renewPaise: number, years: number): number {
  if (!Number.isInteger(years) || years < 1 || years > MAX_YEARS) throw new RangeError(`years must be 1 to ${MAX_YEARS}`);
  return registerPaise + renewPaise * (years - 1);
}

/** The day a registration made on `from` for `years` years ends. Uses the calendar, so 29 February rolls to 28 February. */
export function addYears(from: Date, years: number): Date {
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}
