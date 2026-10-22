# ADR-008 — Ledger write path (M5)

Status: accepted · Date: 2026-10-22

## Online and offline entries
One service records every entry. It is called with an origin mode:

- **Online** (`POST /v1/accounts/{id}/entries`): the limits engine can refuse the entry.
  Exceeding a merchant-side limit or a representative's own limit (`block100`) needs a
  non-empty `reason` (the override reason, which is signed), otherwise `409
  limit_override_required` with the limits result in `details`. Exceeding the customer's hard
  stop is `409 limit_hard_stop` (the one-time raise arrives in M8).
- **Offline** (entries arriving through `POST /v1/sync`, M7): never refused for business
  reasons (CLAUDE.md rule 6), only flagged.

The app evaluates limits locally first and asks the merchant for the reason before saving, so
its entries normally carry the reason in both modes.

## Flags
`over_limit_override` is set whenever the value limit or a representative's own limit is
exceeded (`block100`), with or without a reason; `over_hard_stop` when the customer's hard stop
is exceeded (offline only, since online refuses it); `pending_acceptance` while the account is
pending; `clock_skew` when `recorded_at` is more than 10 minutes after `received_at` (ADR-001).

## Who signs
An entry's `device_id` must be the caller's own device (the one in the access token) and the
device must not be revoked. Entries are signed over the ADR-001 payload; a bad signature is
`400 invalid_signature`.

## Limits are set through the API
`PUT /v1/accounts/{id}/limits/{merchant|customer}` and `DELETE` of the same path. Merchant side:
owner; customer side: customer. A monthly limit copies the setter's `calendar_pref` (ADR-004).
Hard stop is customer-side only. Both sides read `GET /v1/accounts/{id}/limits`; staff do not
(ADR-003).

## The catalogue learns from sales
A detailed line with `item_id` updates that item's `last_price` and `unit`. A detailed line
without `item_id` matches an item of the shop by name (case- and space-insensitive) or creates
one. Simple-mode lines (no qty or unit price) do not touch the catalogue.

## Chain verification
`GET /v1/accounts/{id}/chain/verify` and the `pnpm --filter @mezgeb/api db:verify-chains`
command check accounts changed since a given time. Scheduling it nightly arrives with pg-boss
in M10.

## Deferred
Staff "request correction" (spec roles table) was built with the app's F7: ADR-012.
