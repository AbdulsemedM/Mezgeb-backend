# ADR-005 — Auth sessions and device binding

Status: accepted · Date: 2026-10-21

## Device registration happens at login
`POST /v1/auth/verify` takes `device: { id, public_key, label? }` and registers the device
(idempotent on `id`) in the same call. Refresh tokens are bound to a device from the moment
they are issued, so the device must exist first; a separate `POST /v1/devices` step would be
a chicken-and-egg. `/v1/devices` lists and revokes devices.

A device `id` belongs to one user and one key forever: re-sending the same id, user and key is
accepted; anything else is `409 device_conflict`.

## Refresh requires proof of possession
`POST /v1/auth/refresh` takes `{ refresh_token, device_id, device_sig }`. `device_sig` is an
ECDSA P-256 / SHA-256 signature (DER, base64) over the UTF-8 bytes of
`mezgeb-refresh-v1:<refresh_token>`, made with the device key registered at login. A stolen
refresh token is useless without the phone's key store. The PWA uses a non-extractable
WebCrypto key and converts its raw signature to DER.

## Rotation, reuse detection and retry grace
Every refresh marks the presented token used and issues a successor in the same family.
Presenting a used token revokes the whole family (`401 refresh_reused`), except in one case:
if the token was rotated less than **2 minutes** ago and its successor has never been used,
the client most likely lost the response on a bad connection. The server then revokes the
unused successor and rotates again.

## Lifetimes and limits
- Access token: HS256 JWT, 15 minutes, claims `sub` (user id) and `did` (device id).
- Refresh token: 60 days from the last rotation (merchants can be offline for long periods).
- OTP: 6 digits, HMAC-SHA256 with a server pepper at rest, 5-minute expiry, single use,
  5 wrong attempts kill the challenge.
- OTP requests: per phone 1 per 60 s and 5 per hour; per IP 20 per hour.
- `POST /v1/auth/otp` answers the same whether or not the phone is registered.

## API JSON is snake_case
Request and response bodies use snake_case, matching the field names in ADR-001.

## Ethiopian phone numbers
Only mobile numbers are accepted, normalized to E.164: `+2519XXXXXXXX` (ethio telecom) or
`+2517XXXXXXXX` (Safaricom). Accepted inputs include `09…`, `07…`, `9…`, `251…`, `+251…`, with
spaces, dashes or dots.
