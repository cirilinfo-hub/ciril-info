#!/usr/bin/env bash
# The restore drill: proves your newest backup really restores. Run it once a month, and after any change to the backup set-up.
#
#   infra/backup/restore-test.sh [<db-dump-file>]     (default: the newest db-*.dump in BACKUP_DIR)
#
# It restores the backup into a throwaway database, checks it holds data and the same set of tables as the live database, and
# deletes the throwaway database. It never changes the live database.
set -euo pipefail
export MSYS_NO_PATHCONV=1

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/opt/cirilinfo/backups}"
DB="${DB:-cirilinfo}"
PGUSER="${PGUSER:-postgres}"
PG_EXEC="${PG_EXEC:-docker compose --env-file /opt/cirilinfo/.env -f /opt/cirilinfo/docker-compose.yml exec -T postgres}"
export PGUSER PG_EXEC

dump="${1:-$(ls -1t "$BACKUP_DIR"/db-*.dump 2> /dev/null | head -n 1 || true)}"
[ -n "$dump" ] && [ -s "$dump" ] || { echo "no backup to test. Run backup.sh first." >&2; exit 1; }
scratch="restore_test_$(date -u +%Y%m%d%H%M%S)"
# shellcheck disable=SC2086 # PG_EXEC is a command line on purpose
psql_in() { $PG_EXEC psql -U "$PGUSER" -d "$1" -Atc "$2"; }
cleanup() { $PG_EXEC dropdb -U "$PGUSER" --if-exists "$scratch" > /dev/null 2>&1 || true; }
trap cleanup EXIT

echo "testing $dump"
"$HERE/restore.sh" "$dump" --into "$scratch" > /dev/null

tables_live="$(psql_in "$DB" "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")"
tables_back="$(psql_in "$scratch" "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")"
users_back="$(psql_in "$scratch" "SELECT count(*) FROM users")"
roles_back="$(psql_in "$scratch" "SELECT count(*) FROM roles")"
migrations_back="$(psql_in "$scratch" "SELECT count(*) FROM _prisma_migrations")"
migrations_live="$(psql_in "$DB" "SELECT count(*) FROM _prisma_migrations")"
echo "tables: live $tables_live, backup $tables_back | users in backup: $users_back | roles: $roles_back | migrations: live $migrations_live, backup $migrations_back"

[ "$tables_live" = "$tables_back" ] || { echo "RESTORE TEST FAILED: the backup has a different set of tables" >&2; exit 1; }
[ "$roles_back" -gt 0 ] || { echo "RESTORE TEST FAILED: no roles in the backup" >&2; exit 1; }
[ "$users_back" -gt 0 ] || { echo "RESTORE TEST FAILED: no users in the backup" >&2; exit 1; }
# A backup older than the last migration is fine (it just predates it), but it can never be newer than the live database.
[ "$migrations_back" -le "$migrations_live" ] || { echo "RESTORE TEST FAILED: the backup is from a newer database than this one" >&2; exit 1; }
echo "RESTORE TEST PASSED"
