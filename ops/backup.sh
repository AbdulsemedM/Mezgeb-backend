#!/bin/sh
# Daily database backup (M12). Usage: DATABASE_URL=postgres://... ops/backup.sh [dir]
# Writes a compressed custom-format dump; keeps the last KEEP_DAYS (default 30) dumps.
# The ledger is append-only and hash chained: after a restore run `pnpm --filter @mezgeb/api
# db:verify-chains` to prove nothing was lost or altered.
set -eu
DIR="${1:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"
mkdir -p "$DIR"
FILE="$DIR/mezgeb-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --format=custom --compress=9 --no-owner --file="$FILE.part" "$DATABASE_URL"
mv "$FILE.part" "$FILE"
find "$DIR" -name 'mezgeb-*.dump' -mtime +"$KEEP_DAYS" -delete
echo "$FILE"
