import type { BillingCycle, CatalogPlan, CatalogPrice } from './public-api';

const MONTHS: Record<BillingCycle, number> = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12, BIENNIAL: 24, TRIENNIAL: 36, ONE_TIME: 1 };

export const CYCLE_LABEL: Record<BillingCycle, string> = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  YEARLY: 'Yearly',
  BIENNIAL: '2 years',
  TRIENNIAL: '3 years',
  ONE_TIME: 'One-time',
};

const BILLED: Record<BillingCycle, string> = {
  MONTHLY: 'billed monthly',
  QUARTERLY: 'billed every 3 months',
  YEARLY: 'billed for the first year',
  BIENNIAL: 'billed for the first 2 years',
  TRIENNIAL: 'billed for the first 3 years',
  ONE_TIME: 'one-time payment',
};

export function formatMoney(amount: number, currency = 'INR'): string {
  const whole = Math.abs(amount - Math.round(amount)) < 0.005;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(amount);
}

export interface PlanPriceView {
  cycle: BillingCycle;
  /** Per-month amount for the first term. */
  perMonth: string;
  /** Suffix after the amount: "/mo", or empty for one-time. */
  suffix: string;
  /** "₹720 billed for the first year" */
  billed: string;
  /** Strike-through list price per month, when a list price is set and higher. */
  was: string | null;
  /** Whole-percent saving against the list price. */
  savePct: number | null;
  /** "Renews at ₹119/mo" (null for one-time). */
  renews: string | null;
}

/** Turns a stored price into the design's price block. Returns null if the plan has no price for the cycle. */
export function priceView(plan: CatalogPlan, cycle: BillingCycle): PlanPriceView | null {
  const p: CatalogPrice | undefined = plan.prices.find((x) => x.cycle === cycle);
  if (!p) return null;
  const m = MONTHS[p.cycle];
  const oneTime = p.cycle === 'ONE_TIME';
  const per = (n: number) => formatMoney(n / m, p.currency);
  const hasList = p.listPrice != null && p.listPrice > p.price;
  return {
    cycle: p.cycle,
    perMonth: per(p.price),
    suffix: oneTime ? '' : '/mo',
    billed: `${formatMoney(p.price, p.currency)} ${BILLED[p.cycle]}`,
    was: hasList ? per(p.listPrice!) : null,
    savePct: hasList ? Math.round((1 - p.price / p.listPrice!) * 100) : null,
    renews: oneTime ? null : `Renews at ${per(p.renewalPrice)}/mo`,
  };
}

/** Billing cycles offered by any plan in the list, cheapest-commitment first. */
export function cyclesOf(plans: CatalogPlan[]): BillingCycle[] {
  const set = new Set<BillingCycle>();
  for (const pl of plans) for (const pr of pl.prices) set.add(pr.cycle);
  return (Object.keys(MONTHS) as BillingCycle[]).filter((c) => set.has(c));
}

/** Lowest per-month first-term price across a product's plans, for "From ₹60/mo". */
export function fromPrice(plans: CatalogPlan[]): string | null {
  let best: { n: number; currency: string } | null = null;
  for (const pl of plans)
    for (const pr of pl.prices) {
      if (pr.cycle === 'ONE_TIME') continue;
      const n = pr.price / MONTHS[pr.cycle];
      if (!best || n < best.n) best = { n, currency: pr.currency };
    }
  return best ? `From ${formatMoney(best.n, best.currency)}/mo` : null;
}

export interface CompareRow {
  label: string;
  /** Per plan: a value, true (included) or false (not included). */
  cells: (string | boolean)[];
}

// "25 GB NVMe storage", "5 email accounts", "Unlimited databases", "Unmetered bandwidth"
const LEADING_VALUE = /^(unlimited|unmetered|~?\d[\d,.]*\s?(?:GB|TB|MB|vCPU cores?|vCPU|visits\/month)?)\s+(.+)$/i;

function normaliseKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/\bwordpress sites?\b/, 'websites')
    .replace(/\bwebsites?\b/, 'websites')
    .replace(/\b(\w+?)s\b$/, '$1');
}

/** Builds comparison rows from plan features: "label + value" when the data has it, otherwise parsed from the text. */
export function compareRows(plans: CatalogPlan[]): CompareRow[] {
  const rows = new Map<string, { label: string; cells: (string | boolean)[] }>();
  plans.forEach((plan, col) => {
    for (const f of plan.features) {
      let key: string;
      let label: string;
      let value: string | boolean = true;
      if (f.value) {
        label = f.label;
        key = normaliseKey(f.label);
        value = f.value.toLowerCase() === 'true' ? true : f.value;
      } else {
        const m = LEADING_VALUE.exec(f.label);
        if (m) {
          value = m[1]!.replace(/^~/, '');
          label = m[2]!.charAt(0).toUpperCase() + m[2]!.slice(1);
          key = normaliseKey(m[2]!);
        } else {
          label = f.label;
          key = normaliseKey(f.label);
        }
      }
      let row = rows.get(key);
      if (!row) {
        row = { label, cells: plans.map(() => false) };
        rows.set(key, row);
      }
      // Plans word the same row differently ("1 website" / "25 websites"): keep the longer wording.
      if (label.length > row.label.length) row.label = label;
      row.cells[col] = value;
    }
  });
  return [...rows.values()];
}
