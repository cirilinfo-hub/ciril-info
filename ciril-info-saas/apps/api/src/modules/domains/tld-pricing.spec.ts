import { applyMarkup, sellingPrices } from './tld-pricing.js';

describe('applyMarkup', () => {
  it('adds a percentage, rounding up to the paisa', () => {
    expect(applyMarkup(1000, { type: 'PERCENT', value: 20, round: 'NONE' })).toBe(1200);
    expect(applyMarkup(799.99, { type: 'PERCENT', value: 12.5, round: 'NONE' })).toBe(899.99); // 899.98875 → up
    expect(applyMarkup(0.1, { type: 'PERCENT', value: 10, round: 'NONE' })).toBe(0.11);
  });

  it('adds a fixed amount', () => {
    expect(applyMarkup(650, { type: 'AMOUNT', value: 150, round: 'NONE' })).toBe(800);
    expect(applyMarkup(650.4, { type: 'AMOUNT', value: 0.2, round: 'NONE' })).toBe(650.6);
  });

  it('rounds up to whole rupees or to end in 9, never down', () => {
    expect(applyMarkup(650.01, { type: 'AMOUNT', value: 0, round: 'RUPEE' })).toBe(651);
    expect(applyMarkup(700, { type: 'AMOUNT', value: 0, round: 'RUPEE' })).toBe(700);
    expect(applyMarkup(781, { type: 'AMOUNT', value: 0, round: 'NINE' })).toBe(789);
    expect(applyMarkup(789, { type: 'AMOUNT', value: 0, round: 'NINE' })).toBe(789);
    expect(applyMarkup(789.5, { type: 'AMOUNT', value: 0, round: 'NINE' })).toBe(799);
    expect(applyMarkup(1000, { type: 'PERCENT', value: 25, round: 'NINE' })).toBe(1259);
  });

  it('a zero markup sells at cost', () => {
    expect(applyMarkup(845.5, { type: 'PERCENT', value: 0, round: 'NONE' })).toBe(845.5);
  });

  it('caps at the largest price the list accepts', () => {
    expect(applyMarkup(9_999_999, { type: 'PERCENT', value: 100, round: 'NONE' })).toBe(10_000_000);
  });
});

describe('sellingPrices', () => {
  it('prices all three from their costs', () => {
    expect(sellingPrices({ costRegister: 700, costRenew: 900, costTransfer: 650 }, { type: 'AMOUNT', value: 100, round: 'NINE' })).toEqual({ registerPrice: 809, renewPrice: 1009, transferPrice: 759 });
  });
});
