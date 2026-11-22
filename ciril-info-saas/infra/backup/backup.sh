#!/usr/bin/env bash
# Backs up the database and the uploaded files. Run it every night (see DEPLOYMENT.md).
#
#   infra/backup/backup.sh
#
# What it makes, in BACKUP_DIR:
#   db-<time>.dump        the whole PostgreSQL database (compressed, restorable with restore.sh)
#   files-<time>.tar.gz   the uploaded files (project images, ticket attachments)
# It checks that the database dump can be read back before keeping it, and deletes backups older than KEEP_DAYS.
# It does NOT back up .env. Keep that, and especially DATA_ENCRYPTION_KEY, somewhere safe of its own: without that key the
# encrypted data in a restored database (two-step sign-in secrets, transfer codes) cannot be read.
#
# Settings (environment variables; the defaults suit the production server):
#   BACKUP_DIR         where to put backups                       /opt/cirilinfo/backups
#   KEEP_DAYS          how long to keep them                      14
#   DB                 database name                              cirilinfo
#   PGUSER             database superuser                         postgres
#   PG_EXEC            how to run a command inside the database   docker compose ... exec -T postgres
#   STORAGE_VOLUME     Docker volume holding uploaded files       cirilinfo_storage  (empty to skip files)
#   HELPER_IMAGE       small image with tar, to read the volume   alpine:3
#   RSYNC_TARGET       optional: copy new backups elsewhere       (not set)  e.g. backup@host:/backups/cirilinfo/
set -euo pipefail
umask 077
export MSYS_NO_PATHCONV=1 # keeps Git Bash on Windows from rewriting /data

BACKUP_DIR="${BACKUP_DIR:-/opt/cirilinfo/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
DB="${DB:-cirilinfo}"
PGUSER="${PGUSER:-postgres}"
PG_EXEC="${PG_EXEC:-docker compose --env-file /opt/cirilinfo/.env -f /opt/cirilinfo/docker-compose.yml exec -T postgres}"
STORAGE_VOLUME="${STORAGE_VOLUME-cirilinfo_storage}"
HELPER_IMAGE="${HELPER_IMAGE:-alpine:3}"

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
fail() { log "BACKUP FAILED: $*" >&2; exit 1; }

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
partial="$BACKUP_DIR/.db-$stamp.partial"
trap 'rm -f "$partial" "$BACKUP_DIR/.files-'"$stamp"'.partial"' EXIT

log "dumping database $DB"
# shellcheck disable=SC2086 # PG_EXEC is a command line on purpose
$PG_EXEC pg_dump -U "$PGUSER" -d "$DB" -Fc > "$partial" || fail "pg_dump did not finish"
[ -s "$partial" ] || fail "the dump is empty"
# A dump that cannot be read back is not a backup.
# shellcheck disable=SC2086
$PG_EXEC pg_restore --list < "$partial" > /dev/null || fail "the dump cannot be read back"
mv "$partial" "$BACKUP_DIR/db-$stamp.dump"
log "database saved: db-$stamp.dump ($(wc -c < "$BACKUP_DIR/db-$stamp.dump" | tr -d ' ') bytes)"

if [ -n "$STORAGE_VOLUME" ]; then
  if docker volume inspect "$STORAGE_VOLUME" > /dev/null 2>&1; then
    files="$BACKUP_DIR/.files-$stamp.partial"
    docker run --rm -v "$STORAGE_VOLUME":/data:ro "$HELPER_IMAGE" tar czf - -C /data . > "$files" || fail "could not archive the uploaded files"
    tar tzf "$files" > /dev/null || fail "the files archive cannot be read back"
    mv "$files" "$BACKUP_DIR/files-$stamp.tar.gz"
    log "files saved: files-$stamp.tar.gz"
  else
    log "WARNING: volume $STORAGE_VOLUME not found, uploaded files were not backed up"
  fi
fi

if [ -n "${RSYNC_TARGET:-}" ]; then
  rsync -a --partial "$BACKUP_DIR/db-$stamp.dump" "$BACKUP_DIR/files-$stamp.tar.gz" "$RSYNC_TARGET" 2> /dev/null || rsync -a --partial "$BACKUP_DIR/db-$stamp.dump" "$RSYNC_TARGET" || fail "could not copy to $RSYNC_TARGET"
  log "copied to $RSYNC_TARGET"
fi

find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'db-*.dump' -o -name 'files-*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete
log "done. Backups kept for $KEEP_DAYS days in $BACKUP_DIR"
