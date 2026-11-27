-- Domain prices: what the registrar charges us (cost) and an optional markup that works out the selling prices from it.
CREATE TYPE "TldMarkup" AS ENUM ('PERCENT', 'AMOUNT');
CREATE TYPE "TldRounding" AS ENUM ('NONE', 'RUPEE', 'NINE');

ALTER TABLE "tld_prices"
  ADD COLUMN "cost_register" DECIMAL(14,2),
  ADD COLUMN "cost_renew" DECIMAL(14,2),
  ADD COLUMN "cost_transfer" DECIMAL(14,2),
  ADD COLUMN "markup_type" "TldMarkup",
  ADD COLUMN "markup_value" DECIMAL(14,2),
  ADD COLUMN "markup_round" "TldRounding" NOT NULL DEFAULT 'NONE';

ALTER TABLE "tld_prices"
  ADD CONSTRAINT "tld_prices_costs_non_negative" CHECK (
    (cost_register IS NULL OR cost_register >= 0) AND (cost_renew IS NULL OR cost_renew >= 0) AND (cost_transfer IS NULL OR cost_transfer >= 0)),
  -- A markup needs a value and all three costs to work from.
  ADD CONSTRAINT "tld_prices_markup_complete" CHECK (
    markup_type IS NULL OR (markup_value IS NOT NULL AND markup_value >= 0 AND cost_register IS NOT NULL AND cost_renew IS NOT NULL AND cost_transfer IS NOT NULL));
