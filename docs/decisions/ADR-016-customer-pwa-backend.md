# ADR-016 — Backend for the customer PWA

Status: accepted · Date: 2026-10-26 · Implements the backend list in the PWA's WEB-001
(`web/docs/decisions/WEB-001-customer-pwa.md`) · Extends ADR-005, ADR-006, ADR-015

## Context
The customer PWA lives in its own repository (`web/`, decided with the product owner) and uses
`@mezgeb/shared` from this one. WEB-001 needs five backend changes before W1. One of them
conflicted with ADR-005: refresh needs a device signature over the refresh token, but the PWA
keeps that token in an httpOnly cookie that JavaScript cannot read.

## Decision

### Invite short codes
- Creating an account also creates an `account_invite` row: an 8-character code from
  `INVITE_CODE_ALPHABET` (no 0/O, 1/I/L, U), valid 14 days. The invite SMS links to
  `PUBLIC_WEB_URL/i/<code>` (it was `/a/<account_id>`).
- `GET /v1/invites/{code}` is public. It shows only the shop name, the SMS language the shop
  chose (to preselect the language screen), the account id and a `state`: `open`, `expired`,
  `accepted` or `closed`. Never the phone, nickname or balance. Codes are case-insensitive;
  spaces and dashes are ignored (`normalizeInviteCode`, vectors in `invite-code.json`).
- Expiry only affects the link. A pending account can still be accepted after sign-in.
- Pending invites after sign-in: `GET /v1/accounts?role=customer` already returns every account
  of the caller with its `status`; the PWA shows the `pending` ones. No new endpoint.

### WebOTP
Every OTP SMS ends with a line `@<PUBLIC_WEB_URL host> #<code>`, so Android Chrome fills the code.

### Cookie session for the PWA
- `POST /v1/auth/verify` takes `session: 'cookie'`. The refresh token is then set as cookie
  `mz_refresh` (HttpOnly, Secure, SameSite=Lax, Path=/v1/auth, expires with the token) and left
  out of the body. Every token pair now also has `refresh_id`, the token row's public id.
- `POST /v1/auth/web/refresh {device_id, device_sig}` reads the token from the cookie. The device
  signs `mezgeb-refresh-web-v1:<refresh_id>` with its non-extractable WebCrypto key (DER, as in
  ADR-006). Rotation, reuse detection and the 2-minute retry grace are unchanged from ADR-005:
  a lost response is retried with the old cookie and the old `refresh_id`.
- A stolen cookie is useless without the browser's key; the signature also defeats CSRF on the
  refresh route. `POST /v1/auth/logout` clears the cookie.
- CORS: the origin of `PUBLIC_WEB_URL` (plus `CORS_ORIGINS`) may call the API with credentials.
  In production the PWA and API are same-site (`mezgeb.et` / `api.mezgeb.et`).

### Web Push
- `PUT /v1/devices/me/push-token` also takes `webpush:` + the browser's PushSubscription JSON
  (validated; `400 invalid_push_token` otherwise). `GET /v1/devices/web-push-key` (public) gives
  the VAPID public key, or null when web push is off.
- `RoutingPushSender` sends app tokens to the native (FCM) sender and web subscriptions to
  `WebPushSender` (VAPID via the `web-push` library, sent with `fetch`; 404/410 = invalid).
  `PushSender.accepts(token)` lets the outbox count only tokens a configured sender can reach,
  so with FCM off but VAPID on, the PWA gets pushes and the app still gets SMS.
- Web push is on when `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are set.

### One-time raises in the PWA (added for W5)
`GET /v1/accounts/{id}/raises` lists the raise requests still waiting (pending, not expired),
newest first, with the `approve_raise` permission. The PWA shows them so the customer approves
without a code (ADR-011). Approving stays online only.

### Payments in the PWA (added for W6)
- `POST /v1/payme-requests/{id}/seen` (customer only): `sent` becomes `seen` when the customer
  opens the request; later statuses stay. Idempotent. This is ADR-013's `seen`.
- Receipt photos: `PUT /v1/payment-reports/{id}/receipt` takes the raw image (JPEG, PNG or WebP,
  at most 600 KB; the PWA compresses it first) from the customer, while the report is not yet
  reviewed. It is stored through `ObjectStorage` (S3/MinIO; in memory in tests) at
  `receipts/<account>/<report>`, and `payment_report.screenshot_url` keeps the key. PUT replaces,
  so retries are safe. `GET` on the same path serves it to the owner and the customer (never
  staff: money). Report views carry `has_receipt`.

### Orders in the PWA (added for W7)
`GET /v1/accounts/{id}/catalogue` (customer, `send_order`) lists the shop's items as id, name and
unit, for picking an order. No prices or search aliases: the shop prices each order (ADR-014).

### Served by the PWA, not the API
The web manifest and `/.well-known/assetlinks.json` (package `et.mezgeb.app`, release
certificate fingerprint at build time) are static files of the PWA.

## Consequences
- Invite links sent before this change (`/a/<id>`) are not resolved; there were none in production.
- `GET /v1/invites/{code}` is public. A code has 30^8 ≈ 6.6 × 10^11 values and lives 14 days,
  and it reveals only a shop name; no extra rate limit for now.
