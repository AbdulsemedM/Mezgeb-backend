# Backend build plan (apps/api)

Work one milestone at a time. Each milestone ends with its acceptance checks passing,
a commit, and a short update to the "Commands" section of `CLAUDE.md` if anything changed.

## How to prompt Claude for each milestone

Paste this, replacing the milestone number:

> Read CLAUDE.md, every file in docs/decisions/, and milestone **M_** in docs/backend-plan.md.
> Then read the parts of docs/specs/application-spec.md that the milestone references.
> First give me a short plan: files you'll create, schema changes, and the tests you'll write.
> Wait for my OK. Then write the tests first, implement until they pass, and run the full
> test suite. Ask me if anything in the specs is unclear or conflicts with a decision.

Review the plan before saying OK. Most mistakes are cheaper to catch there.

---

## M0 — Scaffolding

- pnpm monorepo: `apps/api` (NestJS), `packages/shared` (TS library), placeholders for
  `apps/mobile` and `apps/web`.
- Docker Compose for local Postgres 16 and MinIO (S3-compatible).
- Config module with validated env (zod), structured logging (pino), health endpoint.
- Vitest + Testcontainers wired up; ESLint + Prettier; GitHub Actions running lint and tests.

**Done when:** `pnpm test` passes with one integration test that hits `/v1/health` and a real DB.

## M1 — Database schema

- Drizzle schema and first migration for every entity in the spec's data model, plus:
  `device`, `account.last_seq`, `account.last_hash`, `account.balance_santim`,
  `entry.seq/prev_hash/hash/device_id/device_seq/device_sig/recorded_at/received_at/flags/origin/request_id`.
- Common columns: `created_at`, `created_by`, `device_id`, client UUID.
- Constraints from ADR-001. A DB trigger that raises on UPDATE or DELETE of `entry`,
  `entry_line` and `audit_log` (defence in depth for rule 1).

**Done when:** migration runs clean on an empty DB; a test proves UPDATE/DELETE on `entry` fails.

## M2 — Auth and devices

- `POST /v1/auth/otp`, `POST /v1/auth/verify` → short-lived JWT + rotating refresh token.
- OTP: 6 digits, hashed at rest, 5-minute expiry, rate limits per phone and per IP.
- Ethiopian phone number normalization (+2519…, +2517…).
- `POST /v1/devices` registers a device public key (ADR-001); refresh tokens bound to device.
- `SmsGateway` interface with a console fake.

**Done when:** tests cover OTP happy path, expiry, wrong code lockout, rate limits, refresh rotation and reuse detection.

## M3 — Merchants, staff and accounts

- `POST /v1/merchants`; owner + max one staff (ADR-003).
- `POST /v1/accounts` invite by phone with nickname and location note → status `pending`,
  invite SMS via outbox (template from pilot kit).
- `POST /v1/accounts/{id}/accept` stores `terms_accepted_at` → `active`.
- `GET /v1/accounts?role=merchant|customer`.
- An `AccountRole` guard: resolves the caller's role on the account (owner/staff/customer)
  and checks it against the roles table (spec + ADR-003). Nickname stripped from customer responses.

**Done when:** a permission test matrix covers every action × role in the spec's table.

## M4 — Shared core (packages/shared)

- Money helpers (santim), RFC 8785 canonical JSON, signing-payload builder (ADR-001).
- Ethiopian ↔ Gregorian conversion, including Pagume and leap years.
- **Limits engine** as a pure function: inputs = both limits, representative limit, open
  balance, period start, representative spend in period, new amount, now, calendars;
  output = `ok | warn80 | block100 | hard_stop` plus due date and flags.
- Test vectors in `packages/shared/test-vectors/` (JSON files) for canonical JSON,
  signatures, hashes, limits and calendar, so the Dart port can run the same cases later.

**Done when:** limits tests include the spec's worked example (5,000 monthly vs 4,000 two-weekly, maid 1,500), period reset rules, partial payments, lowered limits, and Pagume.

## M5 — Ledger write path and chain

- `POST /v1/accounts/{id}/entries` for purchases and corrections, implementing the server
  transaction in ADR-001 exactly (lock, idempotency, signature, seq/hash, limits, flags,
  balance, outbox).
- Online limit behaviour: return warnings; at 100% require override reason (merchant) or
  block under hard stop. Offline-origin entries are never blocked (ADR-003), only flagged.
- Detail modes (simple/detailed), catalogue items and last price updates.
- `POST /v1/entries/{id}/disputes`; resolution by correction or note.
- `GET /v1/accounts/{id}/entries?from&to` sorted by `recorded_at`, then `seq`.
- `GET /v1/accounts/{id}/chain/verify` and the nightly verification job.

**Done when:** concurrency test (50 parallel writes to one account → contiguous seq, valid chain); idempotent retry test; tamper test (manually altered row → verify reports that seq); bad signature rejected.

## M6 — Representatives

- Customer adds/pauses/revokes representatives with own limit and optional PIN (hashed).
- Merchant's picker endpoint returns only active representatives.
- Entries attributed to a revoked representative: online → rejected with a clear error;
  offline-origin → posted with `rep_revoked` flag (ADR-003).

**Done when:** US-04 and US-06 acceptance criteria from the pilot kit pass as API tests.

## M7 — Sync

- `POST /v1/sync`: body = batch of queued writes (entries, accounts, representatives, orders…)
  + cursor; each write goes through the same service as its REST endpoint; response = per-write
  results + all server changes since cursor + new cursor + account heads `{seq, hash}`.
- Cursor = monotonically increasing server change id (a `change_log` table or per-table
  `server_version` from a sequence).
- Partial failure: valid writes commit, invalid ones return errors; never all-or-nothing for the batch.

**Done when:** tests simulate owner and staff devices offline, both recording, then syncing in either order → identical final state and valid chain.

## M8 — Payments and pay-me

- Pay-me requests (state machine: sent → seen → partially_paid | paid | expired).
- Customer payment reports (reported → confirmed | rejected, resubmit after reject).
- Merchant confirm/reject (online only); merchant-recorded cash payment.
- Confirmation creates a server-origin payment entry (ADR-001).
- Hard-stop one-time raise: merchant requests, customer approves from phone. (Built early with the app's F6: ADR-011, approval by SMS code.)
- 48-hour reminder job for unreviewed reports. (Moved to M10 with the scheduler; M8 built per ADR-013.)

**Done when:** US-09, US-10, US-11 pass; balance and limit usage update correctly with partial payments; period reset only on full clearance.

## M9 — Delivery orders

- State machine sent → accepted → priced → out_for_delivery → delivered (and declined).
- Limit check at pricing; delivered posts one purchase entry with `taken_by = delivery`, linked to the order.
- Receipt confirmation or missing-item flag within 24 h → opens a dispute.

**Done when:** US-12 passes, including an offline "delivered" from the merchant device.

## M10 — Notifications

- Outbox processor (pg-boss): push via FCM (`PushSender`), SMS fallback (`SmsGateway`).
- Every event in the spec's notifications matrix, templates in am/om/en with placeholders.
- Quiet hours 21:00–07:00 (Africa/Addis_Ababa) for non-urgent events; SMS cap per plan.
- Push payloads carry the account head `{seq, hash}`.

**Done when:** a test per matrix row asserts recipients, channel and rendered text.

## M11 — Statements and dashboards

- `GET /v1/accounts/{id}/statement.pdf` with entries, payments, who took what, closing balance,
  closing seq and hash, in the requester's language and calendar. (Built early with the app's F7:
  ADR-012.)
- Merchant home (DSH-1) and customer home (DSH-2) endpoints; DSH-3 reports if time allows.

## M12 — Vision proxy, hardening, deployment

- `POST /v1/vision/detect` behind `VisionProvider`, mapping detections to the shop catalogue;
  store confirmed photos + corrections (with consent) for training.
- OpenAPI docs generated; load test (10k merchants, 1M accounts seed); security review
  checklist (OTP abuse, IDOR on every account route, JWT handling).
- Deployment: container image, migrations on deploy, backups, metrics for the business KPIs.
