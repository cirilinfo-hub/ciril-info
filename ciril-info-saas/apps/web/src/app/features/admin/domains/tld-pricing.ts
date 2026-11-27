import type { MarkupType, Rounding, TldImportRow } from '../admin-domains.api';

/**
 * The same sum the API does (apps/api/src/modules/domains/tld-pricing.ts), so the admin sees the price before saving.
 * The API's answer is the one that counts.
 */
export function applyMarkup(cost: number, type: MarkupType, value: number, round: Rounding): number {
  const base = Math.round(cost * 100);
  const v = Math.round(value * 100);
  let p = type === 'PERCENT' ? Math.ceil((base * (10_000 + v)) / 10_000) : base + v;
  if (round === 'RUPEE') p = Math.ceil(p / 100) * 100;
  if (round === 'NINE') {
    const r = Math.ceil(p / 100);
    p = (r + ((9 - (r % 10) + 10) % 10)) * 100;
  }
  return Math.min(p, 1_000_000_000) / 100;
}

/** "+20%", "+₹150", or "By hand". */
export function markupLabel(type: MarkupType | null, value: string | number | null): string {
  if (!type || value == null) return 'By hand';
  const v = Number(value);
  return type === 'PERCENT' ? `+${v}%` : `+₹${v.toLocaleString('en-IN')}`;
}

export interface ParsedImport {
  rows: TldImportRow[];
  /** Lines that could not be read, with their line number (from 1). */
  errors: { line: number; text: string; reason: string }[];
}

const TLD = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)?$/;

/**
 * Reads a pasted price sheet: one ending per line, then its register, renew and transfer purchase prices.
 * Spreadsheet cells (tabs) may carry "₹1,099.00"; typed lines use commas or spaces ("com, 850, 1050, 850"), so there
 * thousands separators are not allowed. A header line and blank lines are skipped.
 */
export function parseImport(text: string): ParsedImport {
  const rows: TldImportRow[] = [];
  const errors: ParsedImport['errors'] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const cells = (line.includes('\t') ? line.split('\t') : line.split(/\s*[,;|]\s*|\s+/)).map((c) => c.trim()).filter(Boolean);
    const tld = (cells[0] ?? '').toLowerCase().replace(/^\./, '');
    if (i === 0 && !TLD.test(tld)) return; // a header such as "Ending  Register  Renew  Transfer"
    if (i === 0 && cells.slice(1).every((c) => !/\d/.test(c))) return;
    if (!TLD.test(tld)) return void errors.push({ line: i + 1, text: line, reason: 'The first item is not an ending such as com or co.in' });
    const nums = cells.slice(1).map((c) => c.replace(/[₹$\s]|rs\.?|inr/gi, '').replace(/,(?=\d{3}\b)/g, ''));
    if (nums.length !== 3) return void errors.push({ line: i + 1, text: line, reason: 'Needs three prices: register, renew, transfer' });
    const values = nums.map(Number);
    if (nums.some((n) => !/^\d{1,8}(\.\d{1,2})?$/.test(n)) || values.some((n) => !Number.isFinite(n))) {
      return void errors.push({ line: i + 1, text: line, reason: 'A price is not an amount such as 850 or 850.50' });
    }
    rows.push({ tld, costRegister: values[0], costRenew: values[1], costTransfer: values[2] });
  });
  return { rows, errors };
}
