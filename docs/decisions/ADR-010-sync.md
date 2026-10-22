# ADR-010 — Sync protocol (M7)

Status: accepted · Date: 2026-10-22 · Consumers: the Flutter app (F3 sync engine)

## Request
`POST /v1/sync` (authenticated), always `200` unless the request itself is malformed or
unauthenticated.

```json
{ "cursor": "0", "page_size": 1000, "writes": [ { "op": "entry.create", "body": { } } ] }
```

| op | body |
| --- | --- |
| `entry.create` | `account_id` + the `POST /v1/accounts/{id}/entries` body (signed) |
| `account.create` | the `POST /v1/accounts` body |
| `account.update` | `id` + the `PATCH /v1/accounts/{id}` body |
| `representative.create` | `account_id` + the `POST /v1/accounts/{id}/representatives` body |
| `representative.update` | `id` + the `PATCH /v1/representatives/{id}` body |
| `representative.status` | `id` + `{ status }` |
| `dispute.create` | `entry_id` + `{ id, reason }` |
| `dispute.resolve` | `id` + `{ correction_entry_id }` or `{ note }` (the same answer again is a retry) |
| `correction_request.create` | `entry_id` + `{ id, amount, reason }` (ADR-012) |
| `correction_request.resolve` | `id` + `{ correction_entry_id }` or `{ note }` (ADR-012) |
| `limit.set` | `account_id`, `side` + the `PUT /v1/accounts/{id}/limits/{side}` body |
| `limit.delete` | `account_id`, `side` |

At most 200 writes per request. Payments (M8) and orders (M9) add their ops later.

## Writes
Applied **in order, one transaction each**, through the same services as REST. Entries use the
**offline** mode of ADR-008: never refused for limits or inactive representatives, only flagged.
A failed write does not stop the others. Every write is idempotent on its client id, so a lost
response is safe to resend.

Each write gets `{ op, id, status: "ok" | "error", code?, message?, details?, result? }`; `id` is
the object id (`<account_id>:<side>` for limits) and `result` is what the REST route returns.
Malformed bodies are `validation_failed`; access and business errors use the REST codes.

## Response
```json
{
  "results": [],
  "changes": { "accounts": [], "entries": [], "representatives": [], "disputes": [],
               "limits": [], "catalogue": [], "merchants": [] },
  "deleted": { "limits": [ { "account_id": "…", "side": "customer" } ] },
  "heads": [ { "account_id": "…", "seq": 12, "hash": "…" } ],
  "memberships": { "merchants": [ { "id": "…", "role": "owner" } ],
                   "accounts": [ { "id": "…", "role": "customer" } ] },
  "cursor": "1234:0",
  "has_more": false
}
```
- `changes` holds the **current state** of every object changed since the cursor that the
  caller may see, in the same JSON as the REST routes and shaped by role: staff get no balances
  and no limits; customers never get the shop's notes, catalogue or shop-level objects; the
  shop gets representatives without phone or PIN. Clients upsert by id.
- `heads` has the chain head of every account in `accounts` or `entries`: the receipt to store
  (ADR-001).
- `memberships` lists the caller's current roles; the client drops data for shops and accounts
  no longer listed (e.g. staff removed).
- `has_more`: keep calling with the returned cursor until it is `false`.

## Change log and cursor
Triggers on every synced table write `change_log(id, xid, merchant_id, account_id, object_type,
object_id, op)` in the writing transaction (`drizzle/0006_change_log_triggers.sql`). Services
never write it.

A plain increasing id is not a safe cursor: a transaction that started earlier can commit after
a later one, and a client would move past ids that were not yet visible. The cursor is therefore
`xid:id`; a pull returns rows in `(xid, id)` order **only from transactions older than every
transaction still running** (`pg_snapshot_xmin`), which are final. The trade-off is a short
delay: a change becomes visible once older running transactions on the server finish (normally
milliseconds; a long-running transaction anywhere delays everyone). The client already has its
own writes from `results`.

## Not in scope
Push notifications carrying heads (M10) and payments/orders ops (M8, M9).
