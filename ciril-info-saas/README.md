# CirilInfo SaaS Platform

The public website (cirilinfo.com), customer portal (app.cirilinfo.com), admin portal (admin.cirilinfo.com) and API (api.cirilinfo.com) for CirilInfo.

| Path | What it is |
|---|---|
| `apps/web` | Angular 21 single build for all three sites. The hostname picks the route tree; see `src/app/core/config/runtime-config.ts`. |
| `apps/api` | NestJS 12 REST API (`/api/v1`) and the background worker (`src/worker.ts`). Prisma 7 + PostgreSQL 16. |
| `apps/api/prisma` | Schema, migrations (including the Row-Level Security policies) and the idempotent seed. |
| `e2e` | Playwright tests at desktop (1440), tablet (1024) and mobile (390) widths. |
| `infra` | Dockerfiles, Nginx config and the PostgreSQL role setup. |
| `../Design` | The approved design reference. `apps/web/src/styles/design-system/` is extracted from it verbatim. |

## Run it locally

**Prerequisites**
- Node 24
- Docker Desktop (with WSL2 on Windows)

**One-time setup**
```bash
cp .env.example .env            # then fill in the secrets; see the comments in the file
npm run install:all
npm run services:up             # PostgreSQL 16, Redis 7, Mailpit (http://localhost:8025)
npm run db:migrate
npm run db:seed                 # roles, permissions, Super Admin, catalogue (idempotent)
```

**Every day, in separate terminals**
```bash
npm run dev:api                 # http://localhost:3000   API docs: http://localhost:3000/api/docs
npm run dev:web                 # http://localhost:4200   (/ public site, /portal customer, /admin admin)
```

**Tests**
```bash
npm test                        # unit tests (API + web)
npm run test:integration        # API + tenant-isolation tests against the dev database
npm run test:e2e                # Playwright; starts the web dev server automatically
```

## Multi-tenant security model (short version)

- Every customer-owned table carries `tenant_id` and is protected by **PostgreSQL Row-Level Security**.
- Customer requests use the `cirilinfo_app` role, which cannot bypass RLS. They run through `TenantPrisma.run(scope, fn)`, which sets the tenant for that transaction only. If code forgets to set a scope, it gets *no rows*, not every tenant's rows.
- The `cirilinfo_app` role cannot read `password_hash` or MFA secrets, even for its own users.
- Admin, authentication and worker code uses `cirilinfo_platform`, and only behind platform permission checks.
- `test/tenant-isolation.e2e-spec.ts` proves this against a real database on every CI run.

Details: `prisma/migrations/20261117000100_rls/migration.sql` and `src/database/prisma-clients.ts`.

## Status

See `HOSTING_ASSESSMENT.md` for the hosting decision: a Hostinger KVM 2 VPS, to be purchased.

| Phase | Status |
|---|---|
| 0 Inspection | ✅ Approved; developing locally first |
| 1 Foundation | ✅ Done and verified locally against PostgreSQL 16 + Redis 7 in Docker (migrations, RLS, idempotent seed, tenant-isolation tests, production images, worker outbox relay) |
| 2 Auth, tenants, RBAC, audit | ⏭ Next |
| 3–7 | Pending |
