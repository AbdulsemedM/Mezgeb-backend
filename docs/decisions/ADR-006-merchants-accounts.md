# ADR-006 — Merchants, staff, accounts and permissions

Status: accepted · Date: 2026-10-21

## One shop per owner
In the MVP a user owns at most one shop (multiple branches are out of scope). The same person
may be staff at another shop and a customer at any number of shops.

## Permissions (resolved per account, never from a global role)
The role on an account is `owner` or `staff` (from `merchant_staff` of the account's merchant)
or `customer` (`account.customer_user_id`). The permission table lives in
`apps/api/src/accounts/permissions.ts` and follows the spec's roles table plus ADR-003, with
these readings:

- Staff can **view entries** (they need them to request corrections) but not balances, totals or
  limit usage.
- **Recording a payment received** (cash at the counter, PAY-4) is owner-only: it posts as
  confirmed, which is the same power as confirming a payment.
- Changing the per-customer **detail mode** is owner-only; the customer's own **view preference**
  is customer-only.
- A caller with no role on an account gets `404`, never `403`, so account ids cannot be probed.
  A caller with a role that lacks the permission gets `403 forbidden_for_role`.

## Private merchant notes
`nickname` (rule 8) **and** `location_note` are the merchant's private notes and never appear in
customer-facing responses.

## Invites and placeholder users
Inviting a phone that has no user creates one without a verified phone. `app_user.phone_verified_at`
is set on the first OTP verification; `is_new_user` in the verify response means "first
verification". The merchant may choose the customer's SMS language at invite; otherwise Amharic.
The invite link is `PUBLIC_WEB_URL/a/{account_id}`; the link carries no secret, since the account
opens only after an OTP for that phone. A shop cannot invite its own owner or staff.

## Terms versions
The agreement text has a version (`dube-2026-10`). Creating a shop and accepting an invite both
send the version the client displayed; a mismatch is `409 terms_outdated`. The version is stored
next to the acceptance time.

## Outbox before M10
Notifications are written to `notification` in the same transaction as the change. Until M10
replaces it with pg-boss (quiet hours, push), a small in-process dispatcher polls pending rows with
`FOR UPDATE SKIP LOCKED`, renders the i18n template and sends SMS, retrying up to 5 times.

## ECDSA signatures from the PWA
DER stays the only signature encoding on the wire (ADR-001). WebCrypto produces raw P1363
signatures (r‖s); `packages/shared` provides `p1363ToDer` and `derToP1363`, with test vectors.
