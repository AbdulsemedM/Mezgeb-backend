# Deployment (M12)

Hosting and domains are not chosen yet. This is what any host needs.

## The image

    docker build -t mezgeb-api .

The container runs `ops/start.sh`: it applies pending migrations, then starts the API on `PORT`
(default 3000). Several replicas can start at once: `runMigrations` waits on a Postgres advisory
lock, so only one applies anything. `HEALTHCHECK` calls `GET /v1/health` (503 when the database
is down).

Environment (see `apps/api/src/config/env.schema.ts`; the API refuses to start if one is wrong):
`DATABASE_URL`, `S3_*`, `JWT_SECRET`, `OTP_PEPPER` (both at least 32 random chars), `NODE_ENV=production`
(set in the image), `TRUST_PROXY=true` behind a load balancer, `PUBLIC_WEB_URL`, `PUSH_PROVIDER`,
`SMS_CAP_*`. Never set `DEV_ROUTES` in production; the API refuses it.

## Backups

- `DATABASE_URL=... ops/backup.sh /backups` once a day (cron on the host or a scheduled job).
  It writes a compressed `pg_dump` and keeps 30 days (`KEEP_DAYS`). Copy the folder off the host.
- `DATABASE_URL=... ops/restore.sh file.dump` into an empty database only (it refuses one with
  data). Then run migrations (start the image once) and `pnpm --filter @mezgeb/api db:verify-chains`:
  the hash chains prove no entry was lost or changed.
- Both need the Postgres client tools (`pg_dump`, `pg_restore`, `psql`), version 16 or newer.

Tested on 2026-10-23: dev database backed up, restored into an empty database, the same row
counts, a second restore refused, chains verified (0 broken).

## Not done yet

- Vision proxy (`POST /v1/vision/detect`): dropped with the photo sale (owner decision).
- Load test with 10k merchants and 1M accounts, and business KPI metrics: once there is a host
  to run them on.
- Release signing for the app, Firebase (push), the production SMS gateway.
