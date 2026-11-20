#!/usr/bin/env bash
# Restores a database backup made by backup.sh into a database that does not exist yet.
#
#   infra/backup/restore.sh <db-dump-file> --into <new-database-name> [--force]
#
# It will not touch an existing database unless you say --force, which drops it first. To recover a lost server, bring the stack up
# on a fresh volume (the roles are created by the first start), restore into a new database, check it, then follow DEPLOYMENT.md
# to point the stack at it. See also restore-test.sh, which does this into a throwaway database to prove a backup works.
#
# Settings: PGUSER (postgres) and PG_EXEC (a command that runs inside the database container), as in backup.sh.
set -euo pipefail
export MSYS_NO_PATHCONV=1

PGUSER="${PGUSER:-postgres}"
PG_EXEC="${PG_EXEC:-docker compose --env-file /opt/cirilinfo/.env -f /opt/cirilinfo/docker-compose.yml exec -T postgres}"

usage() { echo "usage: $0 <db-dump-file> --into <new-database-name> [--force]" >&2; exit 2; }
[ $# -ge 3 ] || usage
dump="$1"; shift
into=""; force=0
while [ $# -gt 0 ]; do
  case "$1" in
    --into) into="${2:-}"; shift 2 ;;
    --force) force=1; shift ;;
    *) usage ;;
  esac
done
[ -n "$into" ] || usage
[[ "$into" =~ ^[a-zA-Z_][a-zA-Z0-9_]{0,62}$ ]] || { echo "the database name may only have letters, digits and underscores" >&2; exit 2; }
[ -s "$dump" ] || { echo "cannot read $dump" >&2; exit 2; }

# shellcheck disable=SC2086 # PG_EXEC is a command line on purpose
exists="$($PG_EXEC psql -U "$PGUSER" -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname = '$into'")"
if [ "$exists" = "1" ]; then
  [ "$force" = "1" ] || { echo "database $into already exists. Use --force to replace it." >&2; exit 1; }
  # shellcheck disable=SC2086
  $PG_EXEC dropdb -U "$PGUSER" --if-exists "$into"
fi
# shellcheck disable=SC2086
$PG_EXEC createdb -U "$PGUSER" "$into"
echo "restoring $dump into $into ..."
# shellcheck disable=SC2086
if ! $PG_EXEC pg_restore -U "$PGUSER" -d "$into" --exit-on-error < "$dump"; then
  # Do not leave a half-restored database lying around to be mistaken for a good one.
  $PG_EXEC dropdb -U "$PGUSER" --if-exists "$into" > /dev/null 2>&1 || true
  echo "the restore failed, and the new database $into was removed" >&2
  exit 1
fi
echo "restored into $into"
