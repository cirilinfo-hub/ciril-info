import { type CouponRow, couponProblem } from './coupons.js';

const base: CouponRow = {
  id: 'c1', code: 'SAVE', discountType: 'PERCENT', discountValue: '10', currency: null, planIds: [], maxRedemptions: null, redemptions: 0,
  firstTermOnly: true, startsAt: null, endsAt: null, isActive: true,
};
const ctx = { planId: 'p1', currency: 'INR', now: new Date('2026-06-01T00:00:00Z') };

describe('coupon rules', () => {
  it('accepts a plain active coupon', () => expect(couponProblem(base, ctx)).toBeNull());
  it('refuses inactive and recurring coupons', () => {
    expect(couponProblem({ ...base, isActive: false }, ctx)).toBe('This code is not valid.');
    expect(couponProblem({ ...base, firstTermOnly: false }, ctx)).toBe('This code is not valid.');
  });
  it('checks the date window', () => {
    expect(couponProblem({ ...base, startsAt: new Date('2026-07-01') }, ctx)).toContain('not active yet');
    expect(couponProblem({ ...base, endsAt: new Date('2026-05-01') }, ctx)).toContain('expired');
    expect(couponProblem({ ...base, startsAt: new Date('2026-05-01'), endsAt: new Date('2026-07-01') }, ctx)).toBeNull();
  });
  it('enforces the redemption limit', () => {
    expect(couponProblem({ ...base, maxRedemptions: 5, redemptions: 5 }, ctx)).toContain('maximum number of times');
    expect(couponProblem({ ...base, maxRedemptions: 5, redemptions: 4 }, ctx)).toBeNull();
  });
  it('restricts to listed plans and a fixed amount to its currency', () => {
    expect(couponProblem({ ...base, planIds: ['p2'] }, ctx)).toContain('does not apply');
    expect(couponProblem({ ...base, planIds: ['p1', 'p2'] }, ctx)).toBeNull();
    expect(couponProblem({ ...base, discountType: 'FIXED', currency: 'USD' }, ctx)).toContain('does not apply');
    expect(couponProblem({ ...base, discountType: 'FIXED', currency: 'INR' }, ctx)).toBeNull();
  });
});
