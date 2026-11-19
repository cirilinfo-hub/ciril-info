-- Renewing a domain: its own invoice, then a task for staff to renew it at the registrar.
CREATE TYPE "DomainRenewalStatus" AS ENUM ('PENDING', 'DONE', 'CANCELLED');

ALTER TABLE "domains" ADD COLUMN "reminder_stage" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "domain_renewals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "domain_id" UUID NOT NULL,
    "years" INTEGER NOT NULL,
    "invoice_id" UUID NOT NULL,
    "status" "DomainRenewalStatus" NOT NULL DEFAULT 'PENDING',
    "failure_reason" VARCHAR(255),
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    CONSTRAINT "domain_renewals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "domain_renewals_years_range" CHECK ("years" BETWEEN 1 AND 10)
);
CREATE UNIQUE INDEX "domain_renewals_invoice_id_key" ON "domain_renewals"("invoice_id");
CREATE INDEX "domain_renewals_tenant_id_idx" ON "domain_renewals"("tenant_id");
CREATE INDEX "domain_renewals_domain_id_status_idx" ON "domain_renewals"("domain_id", "status");
-- A domain has at most one renewal waiting at a time.
CREATE UNIQUE INDEX "domain_renewals_one_pending_key" ON "domain_renewals"("domain_id") WHERE "status" = 'PENDING';

ALTER TABLE "domain_renewals" ADD CONSTRAINT "domain_renewals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "domain_renewals" ADD CONSTRAINT "domain_renewals_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "domain_renewals" ADD CONSTRAINT "domain_renewals_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant isolation, like the other billing tables.
ALTER TABLE "domain_renewals" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "domain_renewals"
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- Customers ask for and withdraw renewals; staff (the platform role) complete them.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cirilinfo_platform') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON domain_renewals TO cirilinfo_platform;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cirilinfo_app') THEN
    GRANT SELECT, INSERT, UPDATE ON domain_renewals TO cirilinfo_app;
  END IF;
END $$;
