-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN "scheduled_plan_id" UUID,
ADD COLUMN "scheduled_at" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "subscriptions_scheduled_plan_id_idx" ON "subscriptions"("scheduled_plan_id");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_scheduled_plan_id_fkey" FOREIGN KEY ("scheduled_plan_id") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
