#!/bin/bash
# Runs once, on first start of an empty PostgreSQL data volume
# (docker-entrypoint-initdb.d). Creates the three application roles.
# Passwords come from environment variables — never hard-coded.
set -euo pipefail

: "${DB_OWNER_PASSWORD:?DB_OWNER_PASSWORD is required}"
: "${DB_APP_PASSWORD:?DB_APP_PASSWORD is required}"
: "${DB_PLATFORM_PASSWORD:?DB_PLATFORM_PASSWORD is required}"
DB_NAME="${POSTGRES_DB:-cirilinfo}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$DB_NAME" \
  -v owner_pw="$DB_OWNER_PASSWORD" \
  -v app_pw="$DB_APP_PASSWORD" \
  -v platform_pw="$DB_PLATFORM_PASSWORD" \
  -v db="$DB_NAME" <<-'EOSQL'
  -- Schema owner / migrations. Not a superuser.
  CREATE ROLE cirilinfo_owner LOGIN PASSWORD :'owner_pw' NOSUPERUSER NOCREATEROLE CREATEDB BYPASSRLS;
  -- Customer-facing runtime role: Row-Level Security always applies.
  CREATE ROLE cirilinfo_app LOGIN PASSWORD :'app_pw' NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;
  -- Platform/admin/worker runtime role.
  CREATE ROLE cirilinfo_platform LOGIN PASSWORD :'platform_pw' NOSUPERUSER NOCREATEROLE NOCREATEDB BYPASSRLS;

  ALTER DATABASE :"db" OWNER TO cirilinfo_owner;
  ALTER SCHEMA public OWNER TO cirilinfo_owner;
  REVOKE ALL ON SCHEMA public FROM PUBLIC;
  GRANT CONNECT ON DATABASE :"db" TO cirilinfo_app, cirilinfo_platform;

  -- citext must be created by a superuser once; migrations then use IF NOT EXISTS.
  CREATE EXTENSION IF NOT EXISTS citext;
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  -- Tables created later by the owner are automatically usable by the platform role.
  ALTER DEFAULT PRIVILEGES FOR ROLE cirilinfo_owner IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cirilinfo_platform;
  ALTER DEFAULT PRIVILEGES FOR ROLE cirilinfo_owner IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO cirilinfo_platform;
EOSQL

echo "CirilInfo database roles created."
