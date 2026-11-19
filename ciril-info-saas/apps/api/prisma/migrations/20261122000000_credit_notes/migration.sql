-- CreateTable
CREATE TABLE "credit_notes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "refund_id" UUID NOT NULL,
    "number" VARCHAR(32) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "subtotal" DECIMAL(14,2) NOT NULL,
    "tax_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "reason" VARCHAR(255) NOT NULL,
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_number_key" ON "credit_notes"("number");
CREATE UNIQUE INDEX "credit_notes_refund_id_key" ON "credit_notes"("refund_id");
CREATE INDEX "credit_notes_tenant_id_idx" ON "credit_notes"("tenant_id");
CREATE INDEX "credit_notes_invoice_id_idx" ON "credit_notes"("invoice_id");

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant isolation, like the other billing tables: a customer session sees only its own credit notes.
ALTER TABLE "credit_notes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "credit_notes"
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- Customers can read their credit notes; only staff (the platform role) issue them.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cirilinfo_platform') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON credit_notes TO cirilinfo_platform;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cirilinfo_app') THEN
    GRANT SELECT ON credit_notes TO cirilinfo_app;
  END IF;
END $$;
