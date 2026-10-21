# ADR-001 — Server-assigned hash chain per account

Status: accepted · Date: 2026-10-21

## Context

The spec requires append-only entries with hash chaining per account. Several devices
(owner, staff, customer) can create entries for the same account while offline, so devices
cannot agree on chain order.

## Decision

The server assigns each entry's position and hash when the entry arrives. Devices identify
and sign their own entries. Both parties keep receipts of the chain head.

## Device side

On first login a device creates an **ECDSA P-256** key pair in the Android Keystore and
registers the public key (SPKI, base64) with `POST /v1/devices`. The server stores it on
`device(id, user_id, public_key, created_at, revoked_at)`.

Each entry created on a device carries:

| Field | Meaning |
| --- | --- |
| `id` | UUID v7, generated on the device; the idempotency key |
| `device_id` | registered device |
| `device_seq` | per-device counter, strictly increasing |
| `recorded_at` | device clock time, RFC 3339 UTC ms |
| `device_sig` | ECDSA P-256 / SHA-256 signature, DER, base64, over the signing payload |

**Signing payload** = UTF-8 bytes of the RFC 8785 (JCS) canonical JSON of:

```
{ id, account_id, type, amount, lines, taken_by_type, representative_id,
  order_id, ref_entry_id, reason, device_id, device_seq, recorded_at }
```

Absent optional fields are `null` (never omitted). `lines` is the array of
`{ name, qty, unit, unit_price, amount, item_id, source }` in display order. Amounts are
integer santim; `qty` is a decimal string (e.g. `"1.5"`) to avoid float differences.

## Server side

Inside one transaction per incoming entry:

1. `SELECT ... FROM account WHERE id = $1 FOR UPDATE` (serializes writes per account).
2. If an entry with this `id` exists, return it unchanged (idempotent retry).
3. Verify `device_sig` with the device's public key; reject if invalid or device revoked.
4. `seq = account.last_seq + 1`; `prev_hash = account.last_hash` (genesis: 64 zeros).
5. `received_at = now()`.
6. `payload_hash = sha256(signing payload)`.
7. `hash = sha256(JCS({ seq, prev_hash, payload_hash, device_sig, received_at }))`, hex.
8. Run limit checks, set `flags`.
9. Insert entry + lines; update `account.last_seq`, `account.last_hash`, cached balance.
10. Write notification rows to the outbox.

Constraints: `UNIQUE(account_id, seq)`, `UNIQUE(id)`, `UNIQUE(device_id, device_seq)`.

### Server-originated entries

Some entries are created by the server in response to an online action (payment confirmation,
hard-stop raise approval). These have `origin = 'server'`, `device_id`/`device_sig` null, and
`request_id` pointing to the authenticated request (the confirm call), whose actor is in the
audit log. They are chained exactly like device entries.

## Receipts

- Every sync response and every push notification payload includes `{ seq, hash }` of the
  account head. Both apps store the latest head they have seen.
- Statements print the closing `seq` and `hash`.
- An app that later receives a chain whose entry at a stored `seq` has a different hash shows
  an integrity warning and reports it.

## Ordering for people vs. for integrity

- Ledger screens and statements sort by `recorded_at` (when the sale happened), tie-break by `seq`.
- Integrity checks use `seq` only.
- If `recorded_at` is more than 10 minutes after `received_at`, add flag `clock_skew`.

## References to other entries

Corrections, disputes and order links reference entries by `id`, never by `seq`
(an offline device doesn't know the `seq` yet).

## Verification

- `GET /v1/accounts/{id}/chain/verify` recomputes the chain and returns ok or the first bad `seq`.
- A nightly job verifies all accounts changed that day and alerts on failure.

## Consequences

- Unsynced entries show as "Not yet synced" and have no `seq`.
- The server is trusted to order entries but cannot alter content (signatures) or silently
  rewrite history (receipts held by both parties).
- Test vectors (payload → JCS bytes → signature verification → hash) live in
  `packages/shared/test-vectors/` and must pass in both TypeScript and Dart.
