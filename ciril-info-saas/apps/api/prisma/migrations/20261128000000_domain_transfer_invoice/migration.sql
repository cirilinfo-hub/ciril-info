-- Transferring a domain in is paid by its own invoice, like a registration or a renewal.
ALTER TABLE "domain_transfers" ADD COLUMN "invoice_id" UUID;
CREATE UNIQUE INDEX "domain_transfers_invoice_id_key" ON "domain_transfers"("invoice_id");
ALTER TABLE "domain_transfers" ADD CONSTRAINT "domain_transfers_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
