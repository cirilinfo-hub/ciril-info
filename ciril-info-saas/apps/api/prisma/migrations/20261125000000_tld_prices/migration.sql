-- Domain ending prices the website shows and charges. Platform (admin/public) access only.
CREATE TABLE "tld_prices" (
    "id" UUID NOT NULL,
    "tld" CITEXT NOT NULL,
    "register_price" DECIMAL(14,2) NOT NULL,
    "renew_price" DECIMAL(14,2) NOT NULL,
    "transfer_price" DECIMAL(14,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_sample" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "tld_prices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tld_prices_tld_format" CHECK ("tld" ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)?$'),
    CONSTRAINT "tld_prices_non_negative" CHECK ("register_price" >= 0 AND "renew_price" >= 0 AND "transfer_price" >= 0)
);
CREATE UNIQUE INDEX "tld_prices_tld_key" ON "tld_prices"("tld");
