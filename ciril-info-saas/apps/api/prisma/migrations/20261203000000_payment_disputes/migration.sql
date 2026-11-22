-- Chargebacks (disputes) raised by a customer's bank against a payment, as the payment provider reports them.
-- Staff answer them in the provider's dashboard; this keeps the record, the deadline and the outcome.
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'WON', 'LOST', 'CLOSED');

CREATE TABLE "payment_disputes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "provider_dispute_id" VARCHAR(120) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "amount_deducted" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "reason_code" VARCHAR(60),
    "reason" VARCHAR(255),
    "phase" VARCHAR(40),
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "respond_by" TIMESTAMPTZ(3),
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_disputes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payment_disputes_provider_dispute_key" ON "payment_disputes"("provider", "provider_dispute_id");
CREATE INDEX "payment_disputes_tenant_id_idx" ON "payment_disputes"("tenant_id");
CREATE INDEX "payment_disputes_invoice_id_idx" ON "payment_disputes"("invoice_id");
CREATE INDEX "payment_disputes_status_idx" ON "payment_disputes"("status");
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_disputes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payment_disputes"
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- Staff only: the customer-facing role gets no access.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cirilinfo_platform') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON payment_disputes TO cirilinfo_platform;
  END IF;
END $$;
