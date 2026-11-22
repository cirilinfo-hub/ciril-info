-- Saved cards and automatic payment of renewal invoices.
-- The card itself stays with the payment provider (Razorpay keeps a token for it). We keep only the provider's token id,
-- the card network, the last four digits and the expiry, which is what the customer needs to recognise it.
CREATE TYPE "SavedCardStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'REMOVED');

CREATE TABLE "saved_cards" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "provider_customer_id" VARCHAR(120) NOT NULL,
    "provider_token_id" VARCHAR(120) NOT NULL,
    "status" "SavedCardStatus" NOT NULL DEFAULT 'PENDING',
    "network" VARCHAR(40),
    "last4" VARCHAR(4),
    "expiry_month" INTEGER,
    "expiry_year" INTEGER,
    "max_amount" DECIMAL(14,2) NOT NULL,
    "auto_pay" BOOLEAN NOT NULL DEFAULT true,
    "failure_reason" VARCHAR(255),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMPTZ(3),
    "removed_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "saved_cards_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "saved_cards_tenant_id_idx" ON "saved_cards"("tenant_id");
CREATE UNIQUE INDEX "saved_cards_provider_token_key" ON "saved_cards"("provider", "provider_token_id");
-- An organisation has at most one card in use (waiting for the bank, or active).
CREATE UNIQUE INDEX "saved_cards_one_live_key" ON "saved_cards"("tenant_id") WHERE "status" IN ('PENDING', 'ACTIVE');
ALTER TABLE "saved_cards" ADD CONSTRAINT "saved_cards_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "saved_cards" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "saved_cards"
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- The provider's customer record for this organisation (Razorpay customer id), made the first time a card is saved.
ALTER TABLE "customer_accounts" ADD COLUMN "payment_customer_id" VARCHAR(120);

-- A checkout that also saves the card, and a charge made automatically to a saved card.
ALTER TABLE "payments" ADD COLUMN "saves_card" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "payments" ADD COLUMN "saved_card_id" UUID;
ALTER TABLE "payments" ADD CONSTRAINT "payments_saved_card_id_fkey" FOREIGN KEY ("saved_card_id") REFERENCES "saved_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Automatic charges of a renewal invoice: how many were tried, and when the last one was.
ALTER TABLE "invoices" ADD COLUMN "auto_charge_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "invoices" ADD COLUMN "auto_charge_last_at" TIMESTAMPTZ(3);

-- Customers see, switch off and remove their card; the API (platform role) and the worker save and charge it.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cirilinfo_platform') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON saved_cards TO cirilinfo_platform;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cirilinfo_app') THEN
    GRANT SELECT, UPDATE ON saved_cards TO cirilinfo_app;
  END IF;
END $$;
