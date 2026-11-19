import { addCycle, computeTotals, financialYear, invoiceNumber, toPaise } from './billing.logic.js';

describe('billing logic', () => {
  it('adds billing cycles and clamps month ends', () => {
    expect(addCycle(new Date('2026-01-15T00:00:00Z'), 'MONTHLY')?.toISOString()).toBe('2026-02-15T00:00:00.000Z');
    expect(addCycle(new Date('2026-01-31T00:00:00Z'), 'MONTHLY')?.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(addCycle(new Date('2024-01-31T00:00:00Z'), 'MONTHLY')?.toISOString()).toBe('2024-02-29T00:00:00.000Z');
    expect(addCycle(new Date('2026-03-10T00:00:00Z'), 'YEARLY')?.toISOString()).toBe('2027-03-10T00:00:00.000Z');
    expect(addCycle(new Date('2026-03-10T00:00:00Z'), 'TRIENNIAL')?.toISOString()).toBe('2029-03-10T00:00:00.000Z');
    expect(addCycle(new Date(), 'ONE_TIME')).toBeNull();
  });

  it('files invoices in the Indian financial year', () => {
    expect(financialYear(new Date('2026-04-01T00:00:00+05:30'))).toBe('2026-27');
    expect(financialYear(new Date('2026-03-31T23:59:00+05:30'))).toBe('2025-26');
    expect(financialYear(new Date('2027-01-10T00:00:00Z'))).toBe('2026-27');
    expect(financialYear(new Date('2026-03-31T20:00:00Z'))).toBe('2026-27'); // 01:30 IST on 1 Apr
    expect(invoiceNumber('2026-27', 123)).toBe('INV-2026-27-000123');
  });

  it('computes tax-exclusive totals in paise without drift', () => {
    expect(toPaise('199.99')).toBe(19999);
    const t = computeTotals(
      [
        { description: 'Plan', unitPaise: 19999, quantity: 1 },
        { description: 'Setup', unitPaise: 10000, quantity: 1 },
      ],
      18,
    );
    expect(t.subtotal).toBe('299.99');
    expect(t.taxTotal).toBe('54.00'); // 36.00 (3599.82 paise -> 3600) + 18.00
    expect(t.total).toBe('353.99');
  });

  it('charges no tax when no rate is configured', () => {
    const t = computeTotals([{ description: 'Plan', unitPaise: 50000, quantity: 2 }], 0);
    expect(t.total).toBe('1000.00');
    expect(t.taxTotal).toBe('0.00');
  });
});
