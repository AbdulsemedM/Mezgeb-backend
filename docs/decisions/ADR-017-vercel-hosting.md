# ADR-017 — Hosting on Vercel with Neon

Status: accepted · Date: 2026-10-28 · Extends M12 (`docs/deployment.md`), ADR-015, ADR-016

## Context
The product owner chose Vercel (Hobby plan) for both the API and the customer PWA, with a Neon
Postgres database and Cloudflare R2 for receipt photos. Vercel runs the API as serverless
functions: no process stays up between requests, so the in-process outbox timer (2 s) and
reminders timer (1 h) do not run. Hobby crons run at most once a day. `*.vercel.app` is a public
suffix, so a PWA and an API on two `vercel.app` hosts are different sites and the `SameSite=Lax`
refresh cookie (ADR-016) would never reach the API.

## Decision
- **API** (`apps/api`, Vercel root directory `apps/api`): `api/index.js` re-exports
  `dist/serverless.js`, which builds the Nest app once per function instance. `vercel.json`
  rewrites every path to it. `OUTBOX_POLL_MS=0` and `REMINDERS_INTERVAL_MS=0` turn the timers off.
- **Outbox:** after every non-GET request the instance runs `OutboxDispatcher.runOnce()` once the
  response has gone (`waitUntil`). Rows are locked with SKIP LOCKED, so concurrent instances are
  safe (as with replicas).
- **Daily cron:** `GET /v1/cron/daily` (03:00 UTC, 06:00 Addis) runs the reminders, then drains
  the outbox (up to 20 batches). It needs `Authorization: Bearer <CRON_SECRET>` (Vercel Cron sends
  it) and is mounted only when `CRON_SECRET` is set; elsewhere it does not exist. It is internal,
  so it is not in `API_CONTROLLERS` / OpenAPI.
- **Database:** `DATABASE_URL` is Neon's pooled URL with `DB_POOL_MAX=3` per instance.
  Migrations take a session advisory lock, which a transaction pooler does not keep, so they run
  on the direct URL: the Vercel build runs `db:migrate` with `DATABASE_URL_UNPOOLED` on production
  deploys only (preview builds never migrate).
- **PWA** (`web` repository): its build writes Vercel's Build Output (`scripts/vercel-output.mjs`)
  with the headers of the PWA's `docs/deployment.md` (the CSP comes from each build's `csp.txt`)
  and proxies `/v1/*` to the API project (`API_ORIGIN`). The PWA and the API therefore share one
  origin; `VITE_API_URL` stays empty and the cookie, CORS and CSP settings are unchanged.

## Consequences
- Notices deferred by quiet hours, and failed sends waiting for a retry, wait for the next write
  on any account or for the daily cron, at most a day. Pro (minute crons) would remove the gap:
  change the schedule to `* * * * *`, and add an hourly reminders cron if needed.
- `TRUST_PROXY=true`: Vercel sets `X-Forwarded-For`.
- The Docker image (`ops/start.sh`) still works unchanged for any other host.
