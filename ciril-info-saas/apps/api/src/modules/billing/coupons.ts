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
  durationPeriods?: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
}

/**
 * How long a coupon keeps discounting: the first term only, the first N billing periods (counting the first), or every
 * period. A recurring coupon is honoured at each renewal it covers, even if it is later turned off or expires: the
 * customer was promised it when they ordered.
 */
export type CouponDuration = { kind: 'ONCE' } | { kind: 'REPEATING'; periods: number } | { kind: 'FOREVER' };

export function couponDuration(c: Pick<CouponRow, 'firstTermOnly' | 'durationPeriods'>): CouponDuration {
  if (c.firstTermOnly) return { kind: 'ONCE' };
  return c.durationPeriods ? { kind: 'REPEATING', periods: c.durationPeriods } : { kind: 'FOREVER' };
}

/** How many renewals a newly ordered subscription still gets discounted: none, a number, or null for every renewal. */
export function renewalsCovered(d: CouponDuration): number | null {
  return d.kind === 'ONCE' ? 0 : d.kind === 'REPEATING' ? d.periods - 1 : null;
}

/** Why a coupon cannot be used right now, in words a customer can act on, or null when it can. */
export function couponProblem(c: CouponRow, ctx: { planId: string; currency: string; now: Date }): string | null {
  if (!c.isActive) return 'This code is not valid.';
  if (c.startsAt && c.startsAt > ctx.now) return 'This code is not active yet.';
  if (c.endsAt && c.endsAt < ctx.now) return 'This code has expired.';
  if (c.maxRedemptions !== null && c.redemptions >= c.maxRedemptions) return 'This code has already been used the maximum number of times.';
  return couponFits(c, ctx);
}

/** Whether a coupon applies to this plan and currency (checked again at each renewal, which may be on another plan). */
export function couponFits(c: Pick<CouponRow, 'planIds' | 'discountType' | 'currency'>, ctx: { planId: string; currency: string }): string | null {
  if (c.planIds.length && !c.planIds.includes(ctx.planId)) return 'This code does not apply to this plan.';
  if (c.discountType === 'FIXED' && c.currency && c.currency !== ctx.currency) return 'This code does not apply to this plan.';
  return null;
}
