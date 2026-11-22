-- Changing a domain's nameservers from the client area: the customer asks, the change is made at the registrar (by the
-- registrar API in the worker, or by staff by hand), and the domain's recorded nameservers are updated.
CREATE TYPE "NameserverChangeStatus" AS ENUM ('REQUESTED', 'DONE', 'CANCELLED');

CREATE TABLE "domain_nameserver_changes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "domain_id" UUID NOT NULL,
    "nameservers" TEXT[] NOT NULL,
    "status" "NameserverChangeStatus" NOT NULL DEFAULT 'REQUESTED',
    "failure_reason" VARCHAR(255),
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "domain_nameserver_changes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "domain_nameserver_changes_tenant_id_idx" ON "domain_nameserver_changes"("tenant_id");
CREATE INDEX "domain_nameserver_changes_status_idx" ON "domain_nameserver_changes"("status");
-- One change waiting per domain.
CREATE UNIQUE INDEX "domain_nameserver_changes_one_live_key" ON "domain_nameserver_changes"("domain_id") WHERE "status" = 'REQUESTED';

ALTER TABLE "domain_nameserver_changes" ADD CONSTRAINT "domain_nameserver_changes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "domain_nameserver_changes" ADD CONSTRAINT "domain_nameserver_changes_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "domain_nameserver_changes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "domain_nameserver_changes"
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- Customers ask and withdraw; staff (the platform role) and the worker carry them out.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cirilinfo_platform') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON domain_nameserver_changes TO cirilinfo_platform;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cirilinfo_app') THEN
    GRANT SELECT, INSERT, UPDATE ON domain_nameserver_changes TO cirilinfo_app;
  END IF;
END $$;
