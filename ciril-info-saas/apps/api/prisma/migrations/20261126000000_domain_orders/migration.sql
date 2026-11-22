-- A domain is ordered through an invoice. Staff register it at the registrar and mark it done.
ALTER TABLE "domains" ADD COLUMN "years" INTEGER NOT NULL DEFAULT 1,
                      ADD COLUMN "order_invoice_id" UUID,
                      ADD COLUMN "failure_reason" VARCHAR(255);
CREATE UNIQUE INDEX "domains_order_invoice_id_key" ON "domains"("order_invoice_id");
ALTER TABLE "domains" ADD CONSTRAINT "domains_order_invoice_id_fkey" FOREIGN KEY ("order_invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "domains" ADD CONSTRAINT "domains_years_range" CHECK ("years" BETWEEN 1 AND 10);
-- One live domain per name across all customers, so two people cannot both buy the same name.
CREATE UNIQUE INDEX "domains_live_name_key" ON "domains" (lower("name")) WHERE "status" NOT IN ('CANCELLED', 'FAILED', 'TRANSFERRED_OUT', 'EXPIRED');
