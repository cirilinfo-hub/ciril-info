-- Two live hosting accounts can never share a domain, even if two customers submit it at the same instant.
-- Prisma cannot model a partial index, so it lives here only.
CREATE UNIQUE INDEX "hosting_accounts_live_domain_key" ON "hosting_accounts" (lower("primary_domain"))
  WHERE status NOT IN ('CANCELLED', 'TERMINATED', 'FAILED');
