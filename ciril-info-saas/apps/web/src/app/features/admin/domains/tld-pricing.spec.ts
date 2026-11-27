import { applyMarkup, markupLabel, parseImport } from './tld-pricing';

describe('domain pricing helpers', () => {
  it('works out prices like the API', () => {
    expect(applyMarkup(700, 'PERCENT', 20, 'NINE')).toBe(849);
    expect(applyMarkup(650, 'AMOUNT', 150, 'NONE')).toBe(800);
    expect(applyMarkup(650.01, 'AMOUNT', 0, 'RUPEE')).toBe(651);
    expect(applyMarkup(799.99, 'PERCENT', 12.5, 'NONE')).toBe(899.99);
  });

  it('labels a markup', () => {
    expect(markupLabel('PERCENT', '20.00')).toBe('+20%');
    expect(markupLabel('AMOUNT', 1500)).toBe('+₹1,500');
    expect(markupLabel(null, null)).toBe('By hand');
  });

  it('reads typed lines and spreadsheet cells, skipping a header', () => {
    const r = parseImport('Ending\tRegister\tRenew\tTransfer\n.COM\t₹1,099.00\t₹1,299\t999\n\nin, 650, 750.5, 650\nco.in 450 500 450');
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { tld: 'com', costRegister: 1099, costRenew: 1299, costTransfer: 999 },
      { tld: 'in', costRegister: 650, costRenew: 750.5, costTransfer: 650 },
      { tld: 'co.in', costRegister: 450, costRenew: 500, costTransfer: 450 },
    ]);
  });

  it('reports lines it cannot read, with their line number', () => {
    const r = parseImport('com, 1, 2, 3\nnet, 1, 2\norg, 1, two, 3\nbad ending!, 1, 2, 3');
    expect(r.rows).toHaveLength(1);
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4]);
  });
});
