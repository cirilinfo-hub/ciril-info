# HOSTING_ASSESSMENT.md — CirilInfo SaaS Platform

**Phase:** 0 (Inspection) · **Date:** 2026-11-17 · **Status:** Awaiting approval

Everything below was gathered read-only, through the Hostinger API connector and from the design files in this repository. Nothing on the hosting account was installed, changed or restarted.

**Sources:**
- Hostinger API: subscriptions, VPS list, domain portfolio, hosted websites, DNS zone, VPS catalog.
- The repository: `Design/`.
- The Claude artifact `8r3Xtgi7A5oXiTzCjePjUm`.

---

## 1. Summary

| Question | Answer |
|---|---|
| Is there a Hostinger VPS? | **No.** `vps_virtual-machines_list` returned an empty list. |
| What hosting is there? | **Business Web Hosting**: shared hosting on CloudLinux. It is active, renews yearly on 2027-04-01 at ₹7,788/yr, and has auto-renew on. |
| Can that plan run the required stack? | **No.** The plan has no PostgreSQL, Redis, Docker, root access or always-on background workers. See section 3. |
| Recommendation | **Option A with an upgrade.** Buy a Hostinger **KVM 2** VPS and deploy the approved Docker Compose stack on it. |
| What happens to the shared plan? | Keep it. Five existing websites run on it and none of them is affected by this project. |

As the master prompt says, I will **not** swap PostgreSQL for MySQL or drop the queue and worker to fit the shared plan.

---

## 2. Current Hostinger account (verified)

### 2.1 Subscriptions

| Product | Status | Renewal |
|---|---|---|
| Business Web Hosting | active, auto-renew | ₹7,788/yr, next 2027-04-01 |
| .COM domain (francisciril.com) | active, auto-renew | ₹1,516/yr |
| .COM domains ×5 (incl. **cirilinfo.com**) | non_renewing | each expires 2027 |

> ⚠ **cirilinfo.com is set to non-renewing and expires on 2027-02-24.** For a commercial platform, turn auto-renew on in hPanel. I have not changed it.

### 2.2 Websites on the shared plan (account `u639300710`)

| Domain | Type |
|---|---|
| matrixaqua.com | WordPress |
| anmara.co (+ login.anmara.co) | other |
| dryraze.com | Node.js |
| francisciril.com | other |

**cirilinfo.com is not attached as a website** on this plan.

### 2.3 DNS for cirilinfo.com (Hostinger nameservers)

| Name | Type | Value | TTL |
|---|---|---|---|
| @ | A | 2.57.91.91 | 50 |
| www | CNAME | cirilinfo.com. | 300 |

- There are no `app`, `admin` or `api` records yet.
- There are no MX records, so email on cirilinfo.com is not set up.
- 2.57.91.91 is not tied to any website on the account. It is most likely a Hostinger parking or default address. Confirm this before cut-over.

---

## 3. Technology compatibility: current Business plan

The "Status" column shows how each result was established: verified through the API, or taken from the documented limits of Hostinger's shared plans.

| Requirement | On Business Web Hosting | Status |
|---|---|---|
| Node.js app hosting | ✅ Managed Node.js apps (dryraze.com already uses it). Single process, managed by hPanel. | Verified (API) |
| Angular (static build) | ✅ Can be served as static files | Plan docs |
| NestJS API | ⚠ Runs as a managed Node.js app. No custom ports and no process supervisor. | Plan docs |
| **PostgreSQL** | ❌ Only MySQL/MariaDB is offered | Plan docs |
| Prisma + RLS | ❌ Prisma would run on MySQL, but MySQL has no Row-Level Security | Plan docs |
| **Redis** | ❌ Not available | Plan docs |
| **BullMQ / persistent worker** | ❌ No always-on background processes. Cron jobs only. | Plan docs |
| **Docker / Compose** | ❌ No root access, no container runtime | Plan docs |
| Nginx (custom config) | ❌ LiteSpeed is managed by Hostinger | Plan docs |
| Root / SSH | SSH as a jailed user only, no root | Plan docs |
| Cron | ✅ Available | Plan docs |
| SSL | ✅ Free Let's Encrypt for every domain and subdomain | Plan docs |
| Backups | ✅ Hostinger-managed backups | Plan docs |
| Git deploy | ✅ hPanel Git / GitHub auto-deploy | Verified (API surface) |

**Conclusion:** the shared plan **cannot** run the required architecture:
- no PostgreSQL, so no RLS-based tenant isolation;
- no Redis or BullMQ, so no queued jobs for provisioning, webhooks or renewals;
- no Docker;
- no worker process.

Running it there would mean dropping requirements that sections 8–11 of the master prompt make mandatory.

---

## 4. Recommended hosting: Hostinger VPS

Live INR prices from the Hostinger catalog. The first-term price is shown first and the renewal price in brackets.

| Plan | vCPU | RAM | Disk | 1-year price | Fit |
|---|---|---|---|---|---|
| KVM 1 | 1 | 4 GB | 50 GB | ₹8,388 (renews ₹13,788) | Tight. PostgreSQL, Redis, API, worker and Nginx share 1 core, and there is no headroom for build or migration spikes. |
| **KVM 2** ✅ | 2 | 8 GB | 100 GB | **₹11,148 (renews ₹16,788)** | **Recommended.** Comfortable for launch and early growth, with room for staging on the same box if needed. |
| KVM 4 | 4 | 16 GB | 200 GB | ₹15,108 (renews ₹31,188) | Move here once paying tenants or traffic outgrow KVM 2. |

**Recommended setup for the VPS:**
- **OS:** Ubuntu 24.04 LTS, using the plain template with no control panel.
- **Backups:** turn on Hostinger weekly VPS backups. These come in addition to our own daily `pg_dump` sent to off-server S3-compatible storage.
- **Location:** a data centre in India or nearby, for customers in India.
- **SSH:** key-only. Add your public key in hPanel and disable password login.

> I will not buy a VPS. The purchase is a billing action, so you should do it in hPanel, or tell me explicitly to place the order through the API.

---

## 5. Proposed deployment architecture (on KVM 2)

```
                    Internet (HTTPS only, 80 → 443 redirect)
                                   │
                         ┌─────────▼─────────┐
                         │  Nginx (container) │  TLS via Let's Encrypt (certbot)
                         └──┬──────┬──────┬───┘
     cirilinfo.com / www ───┘      │      └─── api.cirilinfo.com
     app.cirilinfo.com  ───────────┤             │
     admin.cirilinfo.com ──────────┘             │
            │ static Angular bundles             ▼
            │ (public / customer / admin    ┌──────────┐     ┌──────────┐
            │  layouts, one build)          │ NestJS   │────▶│  Redis   │◀─┐
            ▼                               │ API      │     │ (auth,   │  │
                                            └────┬─────┘     │ private) │  │
                                                 │           └──────────┘  │
                                                 ▼                         │
                                          ┌─────────────┐          ┌──────┴─────┐
                                          │ PostgreSQL  │◀─────────│  Worker    │
                                          │ 16 + RLS    │          │ (BullMQ)   │
                                          │ (private)   │          └────────────┘
                                          └─────────────┘
```

**Network and access**
- Only ports 22, 80 and 443 are open (UFW, plus the Hostinger firewall).
- PostgreSQL and Redis sit on an internal Docker network only.

**Persistence and backups**
- PostgreSQL, Redis (AOF), uploads and certificates use persistent volumes.
- A nightly `pg_dump` runs and is copied off-server. Restores are tested; see BACKUP_RESTORE.md.

**DNS changes needed (applied only at deploy time, with your approval)**

| Name | Record |
|---|---|
| `@` | A → VPS IP |
| `www` | CNAME → @ |
| `app` | A → VPS IP |
| `admin` | A → VPS IP |
| `api` | A → VPS IP |

**Future AWS move**
- The same containers can run on ECS or EC2.
- PostgreSQL can move to RDS and Redis to ElastiCache.
- Uploads already go to S3-compatible storage.

---

## 6. Recommended technology stack (versions confirmed at install)

| Layer | Choice |
|---|---|
| Frontend | Angular (latest stable 21.x): standalone components, Signals, lazy routes, SCSS |
| Backend | Node.js 22 LTS, NestJS 11, REST under `/api/v1`, Swagger |
| Database | PostgreSQL 16, Prisma ORM with migrations, UUID keys, RLS policies set per transaction through `SET LOCAL app.tenant_id` |
| Queue | Redis 7 + BullMQ, run in a separate worker container |
| Infrastructure | Docker Compose, Nginx, certbot, UFW, GitHub Actions deploying over SSH |
| Testing | Jest, Supertest, Playwright, plus a dedicated tenant-isolation test suite |
| Observability | Pino structured logs, `/health` checks, Sentry and OpenTelemetry (optional until a DSN is supplied) |

---

## 7. Design reference inspection

The artifact `8r3Xtgi7A5oXiTzCjePjUm` was readable, and its exported source is in this repository under `Design/`:

| Path | Contents |
|---|---|
| `Design/tokens.json`, `Design/README.md` | The design system "Calm, violet-led productivity" |
| `Design/components/` | 32 components: Button, TextField, Select, Table, Modal, Toast, Sidebar, NavBar, Tabs, Pagination, Badge, StatBlock and others |
| `Design/website/src/` | React source for the site pages and **11 admin modules**: dashboard, customers, hosting, domains, subscriptions, plans, billing, reports, support, users, settings |
| `Design/screenshots/` | 390 / 1024 / 1440px captures of home, hosting, VPS, email, domain registration, pricing and every admin page |

**Extracted design language.** All of these will be ported to SCSS tokens in Angular:
- **Colour:** violet scale (`violet-500` #7B6CF6 for surfaces, `violet-600` #6352E6 for actions), orchid accent CTA (`orchid-600` #BE3AAA, once per view), ink neutrals (`ink-900` #1C1A33 for text), and status pairs of `-50` backgrounds with `-700` text.
- **Type:** Urbanist (weights 400/500/600/700/800). Display 56/64, H1 40/48, H2 32/40, body 16/26, all on a 4px grid.
- **Shape:** pill buttons and inputs, card radii 16–24px, violet band radius 40px.
- **Elevation:** violet-tinted shadows (`xs` to `xl`).
- **Focus:** a 4px focus ring in `rgba(123,108,246,.32)`.
- **Layout:** containers of 1200/1280px, sections 120px apart (80 on tablet, 64 on mobile), gutter 120/40/20px, nav 72px (64px on mobile), sidebar 280px. Breakpoints at 640/768/1024/1280/1440px.
- **Admin layout:** left sidebar with grouped sections, top search bar, KPI stat cards, chart cards and list cards. These use the same tokens as the public site, which matches section 13 of the master prompt.

**Gaps to extend, keeping the same design language:**
- the customer portal (`app.`) has no mock-ups yet. It will reuse the admin shell with a customer navigation.
- the About, Services, Contact, Auth and legal pages are partly covered by the original site bundle and will be built from the same components.
- there is no logo file. The text wordmark "ciril**info**" will be used until a logo is supplied.

**Important:** the admin mock-ups use sample figures such as 2,380 customers and ₹15.4 L revenue. In production every one of these numbers will come from PostgreSQL, and an empty state will show when there is no data.

---

## 8. What I need from you to proceed

1. **Approval** of Option A (Hostinger KVM 2 VPS with Ubuntu 24.04 and the Docker Compose stack).
2. **The VPS purchase** through hPanel. Then send me the **IP address** only, and add your **SSH public key** in hPanel. Never send passwords or private keys.
3. **Auto-renew turned on for cirilinfo.com** (currently non-renewing, expires 2027-02-24).
4. **Later, for Phase 6.** Use a secrets manager or the server `.env`, never chat, for these:
   - Razorpay and/or Stripe keys;
   - email provider: Resend or AWS SES;
   - S3-compatible storage;
   - registrar API access;
   - cPanel/WHM or Plesk API access.

   Until they arrive, development uses mock adapters that are clearly labelled as mocks.

### Next step after approval: Phase 1 (fully local; nothing touches Hostinger)
- Set up a monorepo: `frontend/` (Angular), `api/` (NestJS), `worker/`, `prisma/`, `infra/` (Compose, Nginx).
- Port the design-system tokens and components to Angular.
- Add Docker Compose for local development (PostgreSQL, Redis).
- Add a GitHub Actions CI skeleton.
