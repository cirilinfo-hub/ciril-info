-- Changing a domain's contact details (registrant, also used for admin, tech and billing) from the client area.
-- The customer asks, the change is made at the registrar (worker or staff), and the details are recorded on the domain.
CREATE TYPE "ContactChangeStatus" AS ENUM ('REQUESTED', 'DONE', 'CANCELLED');

-- The contact details last recorded for the domain (null: the organisation's details at registration time).
ALTER TABLE "domains" ADD COLUMN "contact" JSONB;

CREATE TABLE "domain_contact_changes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "domain_id" UUID NOT NULL,
    "contact" JSONB NOT NULL,
    "status" "ContactChangeStatus" NOT NULL DEFAULT 'REQUESTED',
    "failure_reason" VARCHAR(255),
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "domain_contact_changes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "domain_contact_changes_tenant_id_idx" ON "domain_contact_changes"("tenant_id");
CREATE INDEX "domain_contact_changes_status_idx" ON "domain_contact_changes"("status");
CREATE UNIQUE INDEX "domain_contact_changes_one_live_key" ON "domain_contact_changes"("domain_id") WHERE "status" = 'REQUESTED';

ALTER TABLE "domain_contact_changes" ADD CONSTRAINT "domain_contact_changes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "domain_contact_changes" ADD CONSTRAINT "domain_contact_changes_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "domain_contact_changes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "domain_contact_changes"
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cirilinfo_platform') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON domain_contact_changes TO cirilinfo_platform;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cirilinfo_app') THEN
    GRANT SELECT, INSERT, UPDATE ON domain_contact_changes TO cirilinfo_app;
  END IF;
END $$;
