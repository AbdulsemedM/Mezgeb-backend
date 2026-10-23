#!/bin/sh
# Restore a backup into an EMPTY database (M12). Usage: DATABASE_URL=postgres://... ops/restore.sh file.dump
# Refuses to touch a database that already has the ledger table. Afterwards verify the chains.
set -eu
FILE="$1"
if [ "$(psql "$DATABASE_URL" -tAc "select to_regclass('public.entry') is not null")" = "t" ]; then
  echo "refusing: the target database already has data" >&2
  exit 1
fi
pg_restore --no-owner --exit-on-error --dbname="$DATABASE_URL" "$FILE"
echo "restored $FILE; now run: pnpm --filter @mezgeb/api db:verify-chains"
