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
npm run dev:worker              # sends queued email (read it in Mailpit: http://localhost:8025)
npm run dev:web                 # http://localhost:4200
```

| Local URL | Site |
|---|---|
| http://localhost:4200 | Public website: Home, About, Services (+5 detail pages), Hosting (+ product pages), Pricing, Our Work, Contact, legal pages |
| http://localhost:4200/portal | Customer portal: register, sign in, organisation, team, security |
| http://localhost:4200/admin | Admin portal: staff sign-in with mandatory two-step verification |

The seeded Super Admin signs in with `SEED_SUPERADMIN_EMAIL` and `SEED_SUPERADMIN_PASSWORD` from `.env`. The first sign-in forces a new password and two-step set-up.

**Tests**
```bash
npm test                        # unit tests (API + web)
npm run test:integration        # API integration: auth, tenants, RBAC, tenant isolation (dev database)
npm --prefix apps/api run build # then:
npm run test:e2e                # Playwright: starts API, worker and web; reads real emails from Mailpit
```

## Conventions

- **One Angular component per file.** With Angular 21's build, a file declaring several `@Component`s made `ng build` finish but never exit, which would stall CI. CI jobs also have time limits.
- **Authorisation lives in the API.** Angular guards only choose which screen to show. Every endpoint is checked by `AuthGuard` / `TenantGuard`, and again by PostgreSQL RLS.
- **No placeholder business data in production.** Prices, testimonials, FAQs and website claims come from the admin portal. Sample data is for development only (`SEED_SAMPLE_DATA`).

## Where public website content comes from

| Content | Source | When empty |
|---|---|---|
| Services, About, process, general copy | `apps/web/src/app/features/public/content/` (from the approved design) | n/a: general descriptions only, no prices, results or client claims |
| Plans, prices, renewals, features | Published products/plans/pricing in the database (`GET /api/v1/public/catalog`) | Pages say plans are being finalised |
| Testimonials | `testimonials`, shown only when published **and** consent is recorded (enforced by a DB CHECK) | Section hidden |
| FAQs | `faqs`, per topic (`home`, `pricing`, `hosting`, `contact`, a product slug) | Section hidden |
| Projects (Our Work) | `portfolio_projects` | "Projects are on their way" |
| Uptime %, money-back days, data centres, support hours … | `system_settings` key `site.claims` | Not shown anywhere |
| Phone, email, address, hours, WhatsApp | `system_settings` key `company.profile` | "… to be added" |
| Privacy, Terms, Refund, Cancellation, SLA | `system_settings` keys `legal.<slug>`; only `PUBLISHED` is public | "This page is being prepared"; footer link hidden |

Starter Privacy/Terms drafts are seeded as **DRAFT**. Refund, Cancellation and SLA are not drafted: those are business commitments only CirilInfo can decide. With `SEED_SAMPLE_DATA=true` (development only) sample plans, testimonials, FAQs, projects and the draft legal pages are shown, each labelled as a sample; `npm run db:purge-samples` removes them. These are now edited in the admin portal (Phase 5, first part): Products & Pricing, Projects, Testimonials, FAQs, Legal pages, Website claims, Company profile, and Enquiries. Changes are audited, and a testimonial cannot be published without recorded consent. Project cover images are uploaded from the admin form (PNG, JPEG or WebP, up to 3 MB) and stored under `STORAGE_LOCAL_DIR` (default `apps/api/storage/images`); in production that folder must be a persistent volume that is backed up.

"Choose Plan" does not fake a checkout: it opens customer sign-up with the plan attached. Domain search needs the registrar integration (Phase 6), so it is not shown.

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
| 2 Auth, tenants, RBAC, audit | ✅ API + customer/admin sign-in, organisation, team and security screens. 38 unit, 50 integration and 26 browser tests |
| 3 Public website | ✅ All design pages built from the published catalogue, FAQs, testimonials, projects and website claims in the database; enquiry form stores to `contact_inquiries`. 38 unit + 61 integration (API), 14 web unit, browser tests at 3 widths |
| 4 Ordering and billing (customer side) | 🚧 In progress: plan review → order → gap-free invoice number → pay → subscription activated, plus Services and Invoices screens. Payments use a **labelled test-mode mock** (refused in production); tax uses the default GST rate in `tax_rates` (the seed creates 18%; admins can change it). Support tickets: customers open and reply to tickets, the admin Support inbox answers them (with private internal notes, assignment, priority and status); customers are told by email and in-app that a reply exists, but the reply text is never emailed. Billing addresses (with GST state) are managed under Organisation; ordering requires one and copies it onto the invoice. Invoices can be printed or saved as PDF from the browser; the seller block comes from the admin Company profile (legal name, GSTIN, address) and is copied onto each invoice when issued. Notifications: a bell in the customer top bar (unread badge, latest notices, mark read) and a Notifications page; ticket replies and payments create them. Admin billing: Invoices (search, filter, detail, void with a reason) and Subscriptions screens, and billing and open-ticket figures on the dashboard (money is flagged when it includes test-mode payments). Renewals run in the worker every 10 minutes: a renewal invoice is issued `RENEWAL_LEAD_DAYS` (default 14) before a period ends, unpaid invoices become Overdue, an unpaid subscription is Past due after its period ends and Expires after `PAST_DUE_GRACE_DAYS` (default 7), and a cancelled one expires at period end (an event is queued for Phase 6 to suspend hosting). A first order still unpaid after `ABANDONED_ORDER_DAYS` (default 14) is cancelled and its invoice voided. Coupons: admins create percentage or fixed-amount codes (optionally limited by plan, dates and number of uses; the code, type and amount are fixed once created); customers enter a code on the order review; it discounts the first term only, tax is charged on the discounted amount, and a use is reserved atomically so the last redemption cannot be won twice. Refunds: finance and super admins (`billing:refund`) refund a paid invoice in full or in part with a recorded reason; the amount is capped at what is left, simultaneous requests cannot over-refund, a full refund can also cancel the service (event queued for Phase 6), the customer is notified and sees it on the invoice. With the test-mode gateway a refund is bookkeeping only; real money movement arrives with the Phase 6 gateway. Not yet built: GST credit notes for refunds of taxed invoices, ticket file attachments, admin-side notifications, manual payments, upgrades and downgrades, recurring discounts. 49 unit, 149 integration, 128 browser tests |
| 5 Admin content | ✅ first part (see above); billing and support screens pending |
| 6–7 | Pending (real payment gateway, registrar, hosting provisioning) |
