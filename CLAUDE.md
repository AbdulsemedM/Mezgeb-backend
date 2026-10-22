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
  With `DEV_ROUTES=true` (allowed only in development) `GET /v1/dev/otp?phone=` returns the last
  code sent to a phone, for the mobile app's on-device integration test (`apps/api/src/dev/`).
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

Backend patterns (M3):

- Permissions: `apps/api/src/access/permissions.ts` is the single table (ADR-006). Guard routes on
  `/:id` with `@AccountActionRequired('action')` / `@MerchantActionRequired('action')` and read
  `@CurrentAccountAccess()` / `@CurrentMerchantAccess()`; in services use `AccessService.requireAccount/
  requireMerchant`. No role → 404, wrong role → 403 `forbidden_for_role`. A new action needs a row in
  both `permissions.ts` and the expected table in `permissions.test.ts`.
- Account JSON only via `accountView()` (`accounts/account.views.ts`): strips nickname and
  location_note for customers and balance for staff.
- Writes with side effects: in one `db.transaction`, call `AuditService.record(tx, …)` and
  `OutboxService.enqueueSms(tx, …)`. Creates are idempotent on the client `id`: 201 when created,
  200 with the original on retry, 409 `id_conflict` if the id belongs to someone else.
- Outbox: `OutboxDispatcher` polls every `OUTBOX_POLL_MS` (0 in tests; call `t.outbox.runOnce()`).
- Test helpers in `test/setup/shop.ts`: `createShop(t)`, `addStaff(t, shop)`, `invite(t, shop)`,
  `acceptInvite(t, invited)`. Mind the 15-minute access token when a test advances the clock.

Shared core (M4, `packages/shared`; ADR-007):

- `money.ts` (parseBirr, formatBirr, lineAmount, normalizeQty), `jcs.ts` (RFC 8785), `hash.ts`
  (async sha256Hex via Web Crypto), `signing.ts` (ADR-001 payload, payloadHash, entryHash),
  `calendar/` (Ethiopian ↔ Gregorian, Addis local dates as `YYYY-MM-DD`), `limits/` (addPeriod,
  rollingWindow, ledgerState, evaluateLimits).
- Shared source must run in browsers and Node: no `node:*` imports outside tests and
  `src/test-vectors.ts`; no DOM-only types (the API compiles this source without lib DOM).
- Every behaviour has JSON cases in `packages/shared/test-vectors/` for the Dart port. Add a case
  there, not only in a TS test. `signing.json` is generated: `node packages/shared/scripts/gen-signing-vectors.mjs`.

Ledger (M5, `apps/api/src/ledger/`; ADR-008):

- `EntriesService.record(access, auth, body, 'online' | 'offline')` is the only way an entry is
  written: the ADR-001 transaction (row lock, idempotent on id + signature, signature by the
  caller's own device, seq/hash, limits and flags, head + cached balance, catalogue learning,
  audit, SMS). REST is `online` (limits can refuse: `limit_override_required`, `limit_hard_stop`);
  sync (M7) must call it with `offline` (never refused, only flagged).
- Signed text fields are validated, never transformed (no `.trim()` in their zod schema): the
  server must verify the exact bytes the device signed. Bodies: `packages/shared/src/schemas/entries.ts`.
- `chain.ts`: `payloadOf(row, lines)` rebuilds the signing payload from stored rows;
  `verifyAccountChain` (also `pnpm --filter @mezgeb/api db:verify-chains [since]`).
- Limits: `limitsInputFor(db, account, amount, now)` builds the engine input from the database;
  `PUT/DELETE /v1/accounts/:id/limits/:side`, `GET /v1/accounts/:id/limits`.
- Test helpers in `test/setup/ledger.ts`: `purchaseBody`/`correctionBody` (signed with the test
  user's device key), `postEntry`, `buy`; `signEntry` to sign any body. `smsTo(t, phone)` joins every
  SMS to a phone (order within one outbox run is not defined). `t.clock.set(date)` jumps the clock.

Representatives (M6, `apps/api/src/representatives/`; ADR-009):

- Customer-only management (`manage_representatives`); routes on `/v1/representatives/:id` load the
  row, then `AccessService.requireAccount` on its account. Shop views (`shopView`) never contain the
  phone or PIN; the shop's list shows active representatives only.
- In `EntriesService.record`, an inactive representative is refused online and flagged offline
  (`rep_revoked` / `rep_paused`); their own limit goes into the engine through `limitsInputFor(...,
  rep)` (rolling window from `limit_set_at`).

Sync (M7, `apps/api/src/sync/`; ADR-010 is the contract the app builds on):

- `POST /v1/sync` applies writes one transaction each through the REST services (entries in
  `offline` mode), then pulls changes. A new synced op needs a case in `SyncService.run`, a row in
  ADR-010 and a test.
- `change_log` is written only by triggers (`drizzle/0006_change_log_triggers.sql`); a new synced
  table needs a trigger there (new migration) and a branch in `SyncService.hydrate`.
- Sync tests use `startTestApp({ ownContainer: true })`: pulls wait for every older running
  transaction on the server, and other test files would hold that back.

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
