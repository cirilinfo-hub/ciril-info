-- AlterTable
ALTER TABLE "portfolio_projects" ADD COLUMN     "scope" TEXT[] DEFAULT ARRAY[]::TEXT[];
