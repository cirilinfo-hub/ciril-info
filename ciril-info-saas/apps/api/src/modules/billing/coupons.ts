/** The parts of a coupon the rules look at. */
export interface CouponRow {
  id: string;
  code: string;
  discountType: 'PERCENT' | 'FIXED';
  discountValue: { toString(): string };
  currency: string | null;
  planIds: string[];
  maxRedemptions: number | null;
  redemptions: number;
  firstTermOnly: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
}

/**
 * Why a coupon cannot be used right now, in words a customer can act on, or null when it can.
 * Coupons discount the first term only; a coupon that is not marked first-term-only is refused until
 * recurring discounts are supported, so a customer is never promised something renewals would not honour.
 */
export function couponProblem(c: CouponRow, ctx: { planId: string; currency: string; now: Date }): string | null {
  if (!c.isActive || !c.firstTermOnly) return 'This code is not valid.';
  if (c.startsAt && c.startsAt > ctx.now) return 'This code is not active yet.';
  if (c.endsAt && c.endsAt < ctx.now) return 'This code has expired.';
  if (c.maxRedemptions !== null && c.redemptions >= c.maxRedemptions) return 'This code has already been used the maximum number of times.';
  if (c.planIds.length && !c.planIds.includes(ctx.planId)) return 'This code does not apply to this plan.';
  if (c.discountType === 'FIXED' && c.currency && c.currency !== ctx.currency) return 'This code does not apply to this plan.';
  return null;
}
