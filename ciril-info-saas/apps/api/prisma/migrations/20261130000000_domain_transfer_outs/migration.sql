-- Moving a domain away to another registrar: the customer asks, the domain is unlocked and its authorisation code is
-- issued (by the registrar API, or by staff by hand), and the request ends when the domain leaves or is withdrawn.
CREATE TYPE "TransferOutStatus" AS ENUM ('REQUESTED', 'RELEASED', 'COMPLETED', 'CANCELLED');

CREATE TABLE "domain_transfer_outs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "domain_id" UUID NOT NULL,
    "status" "TransferOutStatus" NOT NULL DEFAULT 'REQUESTED',
    "auth_code_enc" TEXT,
    "failure_reason" VARCHAR(255),
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "domain_transfer_outs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "domain_transfer_outs_tenant_id_idx" ON "domain_transfer_outs"("tenant_id");
CREATE INDEX "domain_transfer_outs_status_idx" ON "domain_transfer_outs"("status");
-- A domain has at most one transfer away going at a time.
CREATE UNIQUE INDEX "domain_transfer_outs_one_live_key" ON "domain_transfer_outs"("domain_id") WHERE "status" IN ('REQUESTED', 'RELEASED');

ALTER TABLE "domain_transfer_outs" ADD CONSTRAINT "domain_transfer_outs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "domain_transfer_outs" ADD CONSTRAINT "domain_transfer_outs_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "domain_transfer_outs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "domain_transfer_outs"
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- Customers ask, read their code and withdraw; staff (the platform role) and the worker release and finish them.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cirilinfo_platform') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON domain_transfer_outs TO cirilinfo_platform;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cirilinfo_app') THEN
    GRANT SELECT, INSERT, UPDATE ON domain_transfer_outs TO cirilinfo_app;
  END IF;
END $$;
