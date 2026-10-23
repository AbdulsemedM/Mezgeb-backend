# Security review checklist (M12)

Run through this before each release. "Test" names the automated check; the rest are manual.

## Sign-in and OTP (ADR-005)

- [x] Codes are 6 digits, live 5 minutes, stored as HMAC-SHA256 with `OTP_PEPPER`, never in logs.
  Test: `test/auth/*`.
- [x] At most 5 wrong tries per code, then `otp_locked`; resend after 60 s; 5 codes per phone and
  20 per IP per hour (`otp.service.ts`). Test: `test/auth/*`.
- [x] Per-IP limits read the real client IP: set `TRUST_PROXY=true` only behind a proxy that
  overwrites `X-Forwarded-For`.
- [ ] Production SMS gateway configured; dev routes off (`DEV_ROUTES` refuses to start outside
  development).

## Tokens and devices

- [x] Access tokens: HS256 only, 15 minutes, `JWT_SECRET` at least 32 chars, kept in memory on
  the phone. Unsigned (`alg: none`), wrongly signed and edited tokens get 401.
  Test: `test/security/idor.int.test.ts`.
- [x] Refresh tokens rotate; reuse revokes the family; refresh needs a signature from the device
  key (P-256 in the Android KeyStore, never exported).
- [x] Every non-public route returns 401 without a token; only health and `auth/*` are public.
  Tests: `test/security/idor.int.test.ts`, `src/openapi/openapi.test.ts`.
- [x] Logs redact `Authorization` and cookies.

## Access to data (ADR-006)

- [x] IDOR: a signed-in stranger calling every route that takes an id, with real ids, gets 404
  (or 400), never 2xx or 403. The test reads the routes from the controllers, so a new route is
  covered automatically. Test: `test/security/idor.int.test.ts`.
- [x] Staff never see balances, totals or limits (ADR-003). Tests: `test/access/*`.
- [x] Every write body is validated by a shared zod schema. Test: `src/openapi/openapi.test.ts`.

## Ledger integrity (ADR-001)

- [x] `entry`, `entry_line` and `audit_log` are append-only (triggers, SQLSTATE `MZ001`).
- [x] Signed entries are verified on the server; seq, prev_hash and hash come from the server only.
- [ ] After any restore, `db:verify-chains` reports 0 broken.

## Deployment

- [ ] Secrets (`JWT_SECRET`, `OTP_PEPPER`, database, S3, SMS) come from the host's secret store,
  never from an image or a committed file. `.dockerignore` keeps `.env` out of the build.
- [ ] HTTPS only at the proxy; the prod app refuses plain HTTP (Android manifest).
- [x] The image runs as the `node` user and does not send `X-Powered-By`.
- [ ] Daily backup running, and a restore tested this quarter (`docs/deployment.md`).
- [ ] Dependency audit: `pnpm audit --prod` has no high or critical issues.
