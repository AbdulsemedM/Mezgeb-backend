# ADR-009 — Representatives (M6)

Status: accepted · Date: 2026-10-22

## Paused representatives offline
ADR-003 flags an offline entry attributed to a revoked representative with `rep_revoked`. An
offline entry attributed to a **paused** one gets its own flag, `rep_paused`, so the two stay
distinguishable. Both alert the customer. Online, both are refused with `409
representative_inactive` (`details.status`).

## The PIN is checked online only
A 4-digit PIN has 10,000 values, so its hash cannot be sent to phones for offline checking.
`POST /v1/representatives/{id}/verify-pin` (owner, staff) answers `{ ok }` or
`{ ok: false, attempts_left }`; 5 wrong tries in a row lock it (`409 pin_locked`) until the
customer sets a new PIN. PINs are stored as salted scrypt hashes and never returned. When the
counter is offline, the app skips the PIN and says so.

## Who sees what
The shop's list (`GET /v1/accounts/{id}/representatives`) shows only active representatives,
without phone or receipt settings; it includes the own limit and `has_pin`, which the counter
needs. The customer sees all of them with their status. Revoked is final.

## Own limits
`limit_set_at` (Addis local date) is the anchor of the rolling periods (ADR-007); it is set when
the limit is set or changed. Spend in the period = the representative's purchases recorded in
the current window.

## Merchant notices until push
"Representative added or revoked" goes to the shop owner by SMS until push notifications arrive
(M10).
