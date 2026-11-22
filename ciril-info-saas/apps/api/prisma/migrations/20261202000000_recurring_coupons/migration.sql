-- Recurring discounts. A coupon either takes money off the first term only (as before), off the first N billing
-- periods (duration_periods = N, counting the first), or off every period (first_term_only = false, duration_periods null).
ALTER TABLE "coupons" ADD COLUMN "duration_periods" INTEGER;
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_duration_periods_check" CHECK ("duration_periods" IS NULL OR ("duration_periods" >= 2 AND "first_term_only" = false));

-- The recurring coupon a subscription was ordered with, and how many more renewals it discounts (null: every renewal).
ALTER TABLE "subscriptions" ADD COLUMN "coupon_id" UUID;
ALTER TABLE "subscriptions" ADD COLUMN "coupon_periods_left" INTEGER;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "subscriptions_coupon_id_idx" ON "subscriptions"("coupon_id");
