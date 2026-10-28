# Deployment (M12)

Hosting: Vercel + Neon + Cloudflare R2 (ADR-017, see "Vercel" below). The image works on any other host.

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

## Vercel (ADR-017)

Two Vercel projects (team "Abdu's projects", Hobby), deployed with `vercel deploy --prod` from each repository
(linked with `vercel link`): `mezgeb-api` at https://mezgeb-api-gray.vercel.app and `mezgeb-pwa` at
https://mezgeb-pwa.vercel.app. The mobile app's prod flavor defaults to these. `.vercelignore` keeps `.env` out of uploads.

**API**: repository `Mezgeb-backend`, Root Directory `apps/api` (leave "Include files outside
the root directory" on; the workspace builds `@mezgeb/shared`). Everything else comes from
`apps/api/vercel.json`. Environment (Production):

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Neon pooled URL (`…-pooler…/neondb?sslmode=verify-full`) |
| `DATABASE_URL_UNPOOLED` | Neon direct URL (the same without `-pooler`); only the build uses it, to migrate |
| `DB_POOL_MAX` | `3` |
| `OUTBOX_POLL_MS`, `REMINDERS_INTERVAL_MS` | `0` (the timers cannot run; the cron and `waitUntil` replace them) |
| `CRON_SECRET` | 32+ random chars; Vercel Cron sends it to `/v1/cron/daily` |
| `JWT_SECRET`, `OTP_PEPPER` | 32+ random chars each |
| `TRUST_PROXY` | `true` |
| `PUBLIC_WEB_URL` | the PWA's URL |
| `S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `S3_REGION` | `auto` |
| `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | the R2 bucket and an R2 API token (Object Read & Write) |
| `OTP_FIXED_CODE` | only while there is no SMS gateway (the console gateway sends nothing) |
| `VAPID_*` | optional, ADR-016 |

Production deploys migrate first, preview deploys never do. Then check `https://<api>/v1/health`.

**PWA**: repository `Mezgeb-PWA`, the repository root. The build command comes from its
`vercel.json`. Environment: `API_ORIGIN=https://<api>.vercel.app` (the PWA proxies `/v1/*` there,
so leave `VITE_API_URL` empty), `VITE_SUPPORT_PHONE`, `ANDROID_CERT_SHA256`.

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
