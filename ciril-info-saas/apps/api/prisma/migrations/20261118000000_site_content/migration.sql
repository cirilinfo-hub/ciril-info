-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "is_sample" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "testimonials" (
    "id" UUID NOT NULL,
    "quote" VARCHAR(600) NOT NULL,
    "author_name" VARCHAR(120) NOT NULL,
    "author_role" VARCHAR(160),
    "avatar_url" VARCHAR(512),
    "rating" SMALLINT,
    "placements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "consent_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "consent_note" VARCHAR(255),
    "is_sample" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "testimonials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faqs" (
    "id" UUID NOT NULL,
    "topic" VARCHAR(64) NOT NULL,
    "question" VARCHAR(255) NOT NULL,
    "answer" TEXT NOT NULL,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "is_sample" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "faqs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "testimonials_is_published_sort_order_idx" ON "testimonials"("is_published", "sort_order");

-- CreateIndex
CREATE INDEX "faqs_topic_is_published_sort_order_idx" ON "faqs"("topic", "is_published", "sort_order");


-- ─── Integrity rules enforced by the database, not just the API ───
-- A testimonial can only be public if the customer agreed to be quoted.
ALTER TABLE "testimonials"
  ADD CONSTRAINT "testimonials_publish_requires_consent" CHECK (NOT is_published OR consent_confirmed),
  ADD CONSTRAINT "testimonials_rating_range" CHECK (rating IS NULL OR rating BETWEEN 1 AND 5);

-- ─── Grants (platform role already covered by default privileges) ───
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cirilinfo_app') THEN
    GRANT SELECT ON testimonials, faqs TO cirilinfo_app;
  END IF;
END $$;
