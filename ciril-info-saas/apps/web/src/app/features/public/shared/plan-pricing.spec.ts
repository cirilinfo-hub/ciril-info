import { compareRows, cyclesOf, formatMoney, fromPrice, priceView } from './plan-pricing';
import type { CatalogPlan } from './public-api';

const plan = (over: Partial<CatalogPlan> = {}): CatalogPlan => ({
  slug: 'starter',
  name: 'Starter',
  description: null,
  isFeatured: false,
  features: [],
  prices: [
    { cycle: 'MONTHLY', currency: 'INR', price: 149, renewalPrice: 149, listPrice: null, setupFee: 0 },
    { cycle: 'YEARLY', currency: 'INR', price: 720, renewalPrice: 1428, listPrice: 1788, setupFee: 0 },
  ],
  ...over,
});

describe('formatMoney', () => {
  it('uses Indian grouping and hides .00 on whole amounts', () => {
    expect(formatMoney(1344)).toBe('₹1,344');
    expect(formatMoney(99.5)).toBe('₹99.50');
  });
});

describe('priceView', () => {
  it('shows the yearly price per month with list price, saving and renewal', () => {
    const v = priceView(plan(), 'YEARLY')!;
    expect(v.perMonth).toBe('₹60');
    expect(v.suffix).toBe('/mo');
    expect(v.was).toBe('₹149');
    expect(v.savePct).toBe(60);
    expect(v.billed).toBe('₹720 billed for the first year');
    expect(v.renews).toBe('Renews at ₹119/mo');
  });

  it('shows no strike-through or saving when there is no higher list price', () => {
    const v = priceView(plan(), 'MONTHLY')!;
    expect(v.was).toBeNull();
    expect(v.savePct).toBeNull();
    expect(v.billed).toBe('₹149 billed monthly');
  });

  it('returns null when the plan has no price for the cycle', () => {
    expect(priceView(plan({ prices: [] }), 'YEARLY')).toBeNull();
  });

  it('one-time prices have no per-month suffix or renewal line', () => {
    const v = priceView(plan({ prices: [{ cycle: 'ONE_TIME', currency: 'INR', price: 999, renewalPrice: 999, listPrice: null, setupFee: 0 }] }), 'ONE_TIME')!;
    expect(v.suffix).toBe('');
    expect(v.renews).toBeNull();
  });
});

describe('cyclesOf / fromPrice', () => {
  it('lists the cycles in use, shortest commitment first', () => {
    expect(cyclesOf([plan()])).toEqual(['MONTHLY', 'YEARLY']);
  });

  it('finds the lowest per-month price', () => {
    expect(fromPrice([plan()])).toBe('From ₹60/mo');
    expect(fromPrice([])).toBeNull();
  });
});

describe('compareRows', () => {
  const f = (label: string, value: string | null = null) => ({ label, value, highlight: false });

  it('lines up "25 GB NVMe storage" style features across plans', () => {
    const rows = compareRows([
      plan({ features: [f('1 website'), f('25 GB NVMe storage'), f('Free SSL certificate')] }),
      plan({ slug: 'b', features: [f('25 websites'), f('100 GB NVMe storage'), f('Free SSL certificate'), f('Daily backups')] }),
    ]);
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.cells]));
    expect(byLabel['Websites']).toEqual(['1', '25']);
    expect(byLabel['NVMe storage']).toEqual(['25 GB', '100 GB']);
    expect(byLabel['Free SSL certificate']).toEqual([true, true]);
    expect(byLabel['Daily backups']).toEqual([false, true]);
  });

  it('prefers an explicit label + value over parsing the text', () => {
    const rows = compareRows([plan({ features: [f('Storage', '25 GB')] }), plan({ slug: 'b', features: [f('Storage', '100 GB')] })]);
    expect(rows).toEqual([{ label: 'Storage', cells: ['25 GB', '100 GB'] }]);
  });
});
