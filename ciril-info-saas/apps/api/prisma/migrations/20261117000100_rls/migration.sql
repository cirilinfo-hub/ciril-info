-- ═══════════════════════════════════════════════════════════════════════════
-- Tenant isolation: PostgreSQL Row-Level Security
--
-- Database roles (created by infra/postgres/init/01-roles.sh, NOT here):
--   cirilinfo_owner     owns the schema, runs migrations.
--   cirilinfo_app       customer-facing API requests. NOBYPASSRLS. Every query
--                       runs inside a transaction that sets app.tenant_id and
--                       app.user_id (see src/database/tenant-prisma.service.ts).
--                       If they are not set, policies match NO rows (fail closed).
--   cirilinfo_platform  admin portal, auth flows, worker. BYPASSRLS. Only used
--                       behind platform RBAC permission checks.
-- ═══════════════════════════════════════════════════════════════════════════

-- Context helpers. NULLIF turns an unset/empty setting into NULL → no match.
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

-- ─── Tenant-owned tables: tenant_id must equal the session tenant ───
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenant_memberships', 'invitations',
    'customer_accounts', 'customer_addresses',
    'hosting_accounts', 'hosting_resources', 'provisioning_jobs',
    'domains', 'dns_records', 'domain_transfers',
    'subscriptions', 'subscription_items', 'subscription_history',
    'invoices', 'invoice_items', 'payments', 'refunds',
    'support_tickets', 'ticket_messages', 'ticket_attachments'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = app_current_tenant())
         WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- ─── tenants: a session sees only its own tenant row ───
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON tenants
  USING (id = app_current_tenant())
  WITH CHECK (id = app_current_tenant());

-- ─── users: self, members of the current tenant, and platform staff (names on tickets) ───
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_visible ON users FOR SELECT
  USING (
    id = app_current_user()
    OR platform_role_id IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM tenant_memberships m
      WHERE m.user_id = users.id AND m.tenant_id = app_current_tenant()
    )
  );
CREATE POLICY users_update_self ON users FOR UPDATE
  USING (id = app_current_user())
  WITH CHECK (id = app_current_user());

-- ─── notifications: only the recipient ───
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notifications_owner ON notifications
  USING (user_id = app_current_user())
  WITH CHECK (user_id = app_current_user());

-- ─── audit_logs: tenant can read/write its own entries; append-only via grants ───
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_tenant ON audit_logs
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- ─── outbox_events: app may enqueue events for its own tenant only ───
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY outbox_tenant ON outbox_events
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- ═══════════════════════════════════════════════════════════════════════════
-- Grants (only if the runtime roles exist — they are created by the infra
-- init script; CI creates them before running migrations).
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cirilinfo_platform') THEN
    GRANT USAGE ON SCHEMA public TO cirilinfo_platform;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cirilinfo_platform;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cirilinfo_platform;
    GRANT EXECUTE ON FUNCTION app_current_tenant(), app_current_user() TO cirilinfo_platform;
    -- Audit log is append-only for everyone except the owner.
    REVOKE UPDATE, DELETE ON audit_logs FROM cirilinfo_platform;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cirilinfo_app') THEN
    GRANT USAGE ON SCHEMA public TO cirilinfo_app;
    GRANT EXECUTE ON FUNCTION app_current_tenant(), app_current_user() TO cirilinfo_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cirilinfo_app;

    -- Tenant-owned data (RLS-protected)
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      tenant_memberships, invitations, customer_addresses,
      dns_records, ticket_attachments
      TO cirilinfo_app;
    GRANT SELECT, INSERT, UPDATE ON
      customer_accounts, hosting_accounts, domains, domain_transfers,
      subscriptions, subscription_items, invoices, invoice_items,
      payments, refunds, support_tickets, ticket_messages
      TO cirilinfo_app;
    GRANT SELECT, INSERT ON subscription_history, provisioning_jobs TO cirilinfo_app;
    GRANT SELECT ON hosting_resources TO cirilinfo_app;
    GRANT SELECT, UPDATE ON tenants TO cirilinfo_app;
    GRANT SELECT, INSERT, UPDATE ON notifications TO cirilinfo_app;
    GRANT SELECT, INSERT ON audit_logs TO cirilinfo_app;
    GRANT INSERT ON outbox_events TO cirilinfo_app;

    -- users: column-level grants; password_hash / mfa_secret_enc are never readable.
    GRANT SELECT (id, email, first_name, last_name, phone, status, email_verified_at,
                  platform_role_id, mfa_enabled, last_login_at, created_at, updated_at)
      ON users TO cirilinfo_app;
    GRANT UPDATE (first_name, last_name, phone, updated_at) ON users TO cirilinfo_app;

    -- Read-only global catalogue
    GRANT SELECT ON roles, permissions, role_permissions,
      product_categories, products, plans, plan_features, pricing_versions,
      promotions, tax_rates
      TO cirilinfo_app;
    -- Coupons: only what checkout needs to validate a code
    GRANT SELECT (id, code, discount_type, discount_value, currency, plan_ids,
                  max_redemptions, redemptions, first_term_only, starts_at, ends_at, is_active)
      ON coupons TO cirilinfo_app;
    -- Infrastructure: non-secret columns only
    GRANT SELECT (id, name, hostname, location, nameservers, status) ON hosting_servers TO cirilinfo_app;
    GRANT SELECT (id, name, is_active) ON domain_registrars TO cirilinfo_app;
  END IF;
END $$;
