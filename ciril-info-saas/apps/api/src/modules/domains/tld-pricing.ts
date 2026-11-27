/** Works out domain selling prices from what the registrar charges us. Pure, so it is easy to test and to show in the admin. */

export type MarkupType = 'PERCENT' | 'AMOUNT';
export type Rounding = 'NONE' | 'RUPEE' | 'NINE';

export interface Markup {
  type: MarkupType;
  /** Percent (18 = 18%) or rupees, up to two decimals. */
  value: number;
  round: Rounding;
}

export const MAX_PRICE = 10_000_000;

/** Rupees in paise, without floating-point drift (799.1 → 79910). */
const toPaise = (rupees: number) => Math.round(rupees * 100);

/** cost + markup, rounded up as asked; never below cost. Returns rupees with at most two decimals. */
export function applyMarkup(cost: number, m: Markup): number {
  const base = toPaise(cost);
  const v = toPaise(m.value); // percent ×100, or paise
  let p = m.type === 'PERCENT' ? Math.ceil((base * (10_000 + v)) / 10_000) : base + v;
  if (m.round === 'RUPEE') p = Math.ceil(p / 100) * 100;
  if (m.round === 'NINE') {
    const r = Math.ceil(p / 100);
    p = (r + ((9 - (r % 10) + 10) % 10)) * 100;
  }
  return Math.min(p, toPaise(MAX_PRICE)) / 100;
}

export interface Costs {
  costRegister: number;
  costRenew: number;
  costTransfer: number;
}

/** The three selling prices for an ending from its three costs. */
export function sellingPrices(c: Costs, m: Markup) {
  return { registerPrice: applyMarkup(c.costRegister, m), renewPrice: applyMarkup(c.costRenew, m), transferPrice: applyMarkup(c.costTransfer, m) };
}
