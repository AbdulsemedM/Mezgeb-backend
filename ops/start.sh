#!/bin/sh
# Container start (M12): apply pending migrations (safe to repeat), then run the API.
# Several replicas starting together are fine: runMigrations waits on an advisory lock.
set -e
node dist/db/migrate.cli.js
exec node dist/main.js
