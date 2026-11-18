-- AlterTable
ALTER TABLE "contact_inquiries" ADD COLUMN     "consent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "portfolio_projects" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "client_name" VARCHAR(160) NOT NULL,
    "category" VARCHAR(64) NOT NULL,
    "summary" VARCHAR(400) NOT NULL,
    "description" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "image_url" VARCHAR(512),
    "project_url" VARCHAR(512),
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "is_sample" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "portfolio_projects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_projects_slug_key" ON "portfolio_projects"("slug");

-- CreateIndex
CREATE INDEX "portfolio_projects_is_published_category_sort_order_idx" ON "portfolio_projects"("is_published", "category", "sort_order");

