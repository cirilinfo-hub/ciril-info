-- AlterTable
ALTER TABLE "provisioning_jobs" ADD COLUMN "payload" JSONB,
ADD COLUMN "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "provisioning_jobs_status_available_at_idx" ON "provisioning_jobs"("status", "available_at");
DROP INDEX IF EXISTS "provisioning_jobs_status_queued_at_idx";
