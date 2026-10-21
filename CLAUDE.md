# Mezgeb — project context for Claude

Mezgeb ("register" in Amharic) digitizes the Ethiopian neighbourhood *dube* book: a shared,
two-sided, append-only ledger between a merchant and a regular customer. No money moves
through Mezgeb, and there is no interest or fee. Full specs live in `docs/specs/`; decisions
that override or extend the specs live in `docs/decisions/` (decisions win when they conflict).

## Repository layout

- `apps/api` — NestJS (TypeScript) backend. **Built first.**
- `apps/mobile` — Flutter app for merchants AND customers (roles are per account). Built second.
- `apps/web` — lightweight customer PWA for the no-install invite link. Built third.
- `packages/shared` — TypeScript code shared by the API and the PWA: types, limits engine,
  canonical JSON, money and calendar helpers. The Flutter app ports the same logic to Dart
  and must pass the same test vectors in `packages/shared/test-vectors/`.
- `docs/` — specs, decisions, backend plan, the clickable demo (UX reference only, not code to reuse).

## Non-negotiable rules

1. **Entries are append-only.** Never write code that UPDATEs or DELETEs a row in `entry` or
   `entry_line`. Corrections are new entries with `ref_entry_id`. The server sets `seq`,
   `prev_hash`, `hash` and `received_at` in the same insert, never afterwards.
2. **Money is integer santim** (1 ETB = 100 santim). Never use floats for money anywhere.
3. **Money never touches Mezgeb.** No code that moves, holds or computes interest on funds.
4. **Every write is idempotent** on a client-generated UUID. Retrying the same request must
   return the original result, never create a duplicate.
5. **The server assigns chain order** (see `docs/decisions/ADR-001-entry-chain.md`). Phones never
   compute `seq`, `prev_hash` or `hash`.
6. **Offline entries are never rejected** for business reasons (limits, revoked representative).
   They are posted and flagged. Only malformed or unauthenticated writes are rejected.
7. **Permissions are checked per account**, from the caller's role on that account
   (owner, staff, customer), never from a global user role.
8. **Nickname is private** to the merchant side; never return it in customer-facing responses.
9. All user-facing text goes through i18n keys (am, om, en). No hard-coded strings in responses
   that reach users (SMS, push).

## Conventions (backend)

- NestJS modules per spec module: auth, merchants, accounts, ledger, limits, representatives,
  payments, orders, notifications, sync, statements, vision, dashboard.
- PostgreSQL with Drizzle ORM; migrations committed; raw SQL allowed where row locking needs it.
- Queue/outbox: `pg-boss` (Postgres-backed, no Redis).
- Validation: `zod` schemas in `packages/shared`, reused by the PWA.
- Tests: Vitest; integration tests against a real Postgres via Testcontainers. Every module
  ships with tests; the ledger and limits modules need exhaustive tests.
- Timestamps: RFC 3339 UTC with milliseconds. IDs: UUID v7.
- API versioned under `/v1`, JSON, errors as `{ code, message, details? }`.
- External services behind interfaces with a fake implementation for dev/tests:
  `SmsGateway`, `PushSender`, `ObjectStorage`, `VisionProvider`.

## Commands

Node 22, pnpm 10 (no Bun). Docker must be running for integration tests and local services.

- `pnpm install` — install the workspace.
- `cp .env.example .env` then `pnpm db:up` / `pnpm db:down` — local Postgres 16 on
  **localhost:55432** (5432/5433 are taken by local installs on the dev machine) and MinIO on
  9000 (console 9001, bucket `mezgeb-dev`).
- `pnpm --filter @mezgeb/api dev` — builds `@mezgeb/shared`, then runs the API in watch mode on
  :3000, reading `../../.env`. The console SMS gateway logs OTP codes there.
- `pnpm test` — all Vitest suites; API integration tests start their own Postgres via Testcontainers.
- `pnpm --filter @mezgeb/api exec vitest run test/health.int.test.ts` — a single test file.
- `pnpm lint`, `pnpm typecheck`, `pnpm format` / `pnpm format:check`, `pnpm build`.
- TypeScript is pinned to 6.x: typescript-eslint doesn't support TS 7 yet.
- Prettier ignores `docs/`, `CLAUDE.md` and READMEs; never run it over hand-written docs.
- Errors: throw `AppError(code, message, status, details?)`; the global filter renders `{ code, message, details? }`.

Backend patterns (M2):

- Every route needs a Bearer access token (global `JwtAuthGuard`) unless marked `@Public()`;
  `@CurrentAuth()` gives `{ userId, deviceId }`. Auth design: ADR-005.
- Request bodies: zod schema in `packages/shared/src/schemas/`, applied with
  `@Body(new ZodValidationPipe(schema))` → 400 `validation_failed`. JSON is snake_case.
- Time: inject `Clock`, never `new Date()` in services; tests use `FakeClock` (`t.clock.advance(ms)`).
- Server-generated ids: `uuidv7()` from `@mezgeb/shared`.
- User-facing text: `t(key, language, params)` from `apps/api/src/i18n/messages.ts`; am/om drafts are
  marked `TODO(i18n-review)`.
- Device keys and signatures: `apps/api/src/devices/device-key.ts` (P-256 SPKI, DER signatures).
- `@mezgeb/shared` types resolve to its `src` (no build needed for typecheck/tests); its runtime
  `dist` must be built before running the API (`pnpm build` does this in order).

Database (schema in `apps/api/src/db/schema.ts`, one file on purpose; migrations in `apps/api/drizzle/`):

- `pnpm --filter @mezgeb/api db:generate` — after editing the schema, generate the next migration.
  CI fails if the committed migrations don't match the schema.
- `pnpm --filter @mezgeb/api exec drizzle-kit generate --custom --name=<name>` — hand-written SQL
  migration (triggers, functions). `0001_append_only_triggers.sql` blocks UPDATE/DELETE/TRUNCATE on
  `entry`, `entry_line`, `audit_log` with SQLSTATE `MZ001`.
- `pnpm build && pnpm --filter @mezgeb/api db:migrate` — apply migrations to `DATABASE_URL`.

Tests:

- Vitest global setup starts one Postgres container and migrates a template DB once.
  `createTestDb()` (`apps/api/test/setup/db.ts`) clones it per test file; `createTestDb('empty')` is unmigrated.
- `startTestApp()` (`test/setup/test-app.ts`) boots the API on a random port against a fresh DB,
  with `t.clock` (FakeClock), `t.sms` (in-memory SMS) and `t.get/post/delete(path, body, { token, ip })`;
  `{ ownContainer: true }` for tests that must stop the database.
- Auth helpers in `test/setup/auth.ts`: `login(t)` (full OTP sign-in → tokens + device key),
  `newDevice()`, `refreshBody(device, token)`, `nextIp()` (per-IP limits are real in tests).
- Fixtures in `test/setup/fixtures.ts`: `seedAccount()`, `purchase()` (a valid entry row to override),
  `pgError()` (unwraps the Postgres error so tests can assert `code` and `constraint`).

## How to work in this repo

- Work milestone by milestone from `docs/backend-plan.md`. Don't start the next milestone
  until the current one's acceptance checks pass.
- Before changing behaviour described in the specs, check `docs/decisions/`. If something is
  unclear or the specs conflict, stop and ask rather than guess; record the answer as a new ADR.
