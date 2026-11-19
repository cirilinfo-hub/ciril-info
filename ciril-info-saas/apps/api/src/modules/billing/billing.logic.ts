import type { BillingCycle } from '../../generated/prisma/client.js';

export const CYCLE_MONTHS: Record<BillingCycle, number | null> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  YEARLY: 12,
  BIENNIAL: 24,
  TRIENNIAL: 36,
  ONE_TIME: null,
};

/** End of a term that starts at `start`. One-time purchases have no end. Clamps 31 Jan + 1 month to 28/29 Feb. */
export function addCycle(start: Date, cycle: BillingCycle): Date | null {
  const months = CYCLE_MONTHS[cycle];
  if (months === null) return null;
  const d = new Date(start);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/** Indian financial year (1 Apr to 31 Mar) as "2026-27". Uses IST so 31 Mar night is not misfiled. */
export function financialYear(at: Date): string {
  const ist = new Date(at.getTime() + 5.5 * 3_600_000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export const invoiceNumber = (fy: string, seq: number) => `INV-${fy}-${String(seq).padStart(6, '0')}`;

/** Money is handled in integer paise so totals never drift. */
export const toPaise = (v: { toString(): string } | number | string): number => Math.round(Number(v.toString()) * 100);
export const fromPaise = (p: number): string => (p / 100).toFixed(2);

export interface PricedLine {
  description: string;
  unitPaise: number;
  quantity: number;
  /** Discount taken off this line before tax, in paise. */
  discountPaise?: number;
}

export interface LineTotals {
  description: string;
  quantity: number;
  unitPrice: string;
  discount: string;
  taxRate: string;
  taxAmount: string;
  lineTotal: string;
}

export interface Totals {
  lines: LineTotals[];
  /** Before discounts and tax. */
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
}

/** How much a coupon takes off a price. Never more than the price itself; a percentage rounds to the nearest paisa. */
export function couponDiscountPaise(type: 'PERCENT' | 'FIXED', value: { toString(): string } | number | string, pricePaise: number): number {
  const v = Number(value.toString());
  const raw = type === 'PERCENT' ? Math.round((pricePaise * Math.min(Math.max(v, 0), 100)) / 100) : Math.round(v * 100);
  return Math.min(Math.max(raw, 0), pricePaise);
}

/** Tax is exclusive and charged on the discounted amount, rounded per line. `taxPercent` may be 0. */
export function computeTotals(lines: readonly PricedLine[], taxPercent: number): Totals {
  let subtotal = 0;
  let discounts = 0;
  let tax = 0;
  const out = lines.map((l) => {
    const gross = l.unitPaise * l.quantity;
    const discount = Math.min(l.discountPaise ?? 0, gross);
    const net = gross - discount;
    const t = Math.round((net * taxPercent) / 100);
    subtotal += gross;
    discounts += discount;
    tax += t;
    return {
      description: l.description,
      quantity: l.quantity,
      unitPrice: fromPaise(l.unitPaise),
      discount: fromPaise(discount),
      taxRate: taxPercent.toFixed(3),
      taxAmount: fromPaise(t),
      lineTotal: fromPaise(net + t),
    };
  });
  return { lines: out, subtotal: fromPaise(subtotal), discountTotal: fromPaise(discounts), taxTotal: fromPaise(tax), total: fromPaise(subtotal - discounts + tax) };
}
