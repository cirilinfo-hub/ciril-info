-- TDS a customer deducted at source: counts towards paying an invoice, is never refundable by us, and needs a certificate.
CREATE TABLE "tds_deductions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "section" VARCHAR(20),
    "certificate_number" VARCHAR(60),
    "certificate_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "tds_deductions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tds_deductions_amount_positive" CHECK ("amount" > 0)
);
CREATE UNIQUE INDEX "tds_deductions_invoice_id_key" ON "tds_deductions"("invoice_id");
CREATE INDEX "tds_deductions_tenant_id_idx" ON "tds_deductions"("tenant_id");
CREATE INDEX "tds_deductions_certificate_at_idx" ON "tds_deductions"("certificate_at");
ALTER TABLE "tds_deductions" ADD CONSTRAINT "tds_deductions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tds_deductions" ADD CONSTRAINT "tds_deductions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tds_deductions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tds_deductions"
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- Customers read their own; staff record them.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cirilinfo_platform') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON tds_deductions TO cirilinfo_platform;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cirilinfo_app') THEN
    GRANT SELECT ON tds_deductions TO cirilinfo_app;
  END IF;
END $$;
