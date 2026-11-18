# ADR-018 — SMS through Cooperative Bank of Oromia

Status: accepted · Date: 2026-11-18 · Extends ADR-005 (OTP), ADR-015 (notifications), ADR-017

## Context
Until now every SMS went to `ConsoleSmsGateway` and every OTP was `OTP_FIXED_CODE`. Cooperative
Bank of Oromia provides an SMS API behind its WSO2 API manager: an OAuth2 `client_credentials`
token (1 hour), then `POST {"phone_number": "09…", "text": "…"}` with the bearer token. An accepted
message answers `202 {"success": true, "message": "SMS request processed"}`. Ethiopic text is
accepted.

## Decision
- `SMS_PROVIDER=console | coopbank` (default `console`). `coopbank` uses `CoopbankSmsGateway`
  (`apps/api/src/sms/coopbank-sms-gateway.ts`) with `COOPBANK_SMS_CLIENT_ID/SECRET` and
  `COOPBANK_SMS_TOKEN_URL/SEND_URL` (default: the UAT gateway).
- The gateway caches the token per process until 60 s before expiry (one request at a time), gets a
  new one once on a 401, times out after 10 s, and throws on a non-2xx answer or `success: false`,
  so the outbox retries notifications and an OTP request fails visibly rather than silently.
- Numbers are stored E.164 (`+2519…`) and sent in the local form (`09…`).
- `OTP_FIXED_CODE` is refused with `SMS_PROVIDER=coopbank`: real SMS means random codes.
- `GET /v1/dev/otp` only reads the console gateway; with real SMS it answers 404.
- Tests keep the in-memory console gateway; the gateway itself has unit tests with a fake fetch.

## Relay through a queue (same day)
The bank's firewall answers Vercel with a "Request Rejected" page: only allowlisted networks may
call the API, and Vercel has no fixed IPs on our plan. A bank server (10.1.193.25, private address,
outbound HTTPS only, no open port and no Cloudflare Tunnel) can reach both Coopbank and the
internet. So:

- `SMS_PROVIDER=queue`: `QueueSmsGateway` `LPUSH`es `{id, to, text, created_at}` (JSON) onto the
  Upstash Redis list `SMS_QUEUE_KEY` (`mezgeb:sms`) over Upstash's REST API. Success means queued.
- `apps/sms-relay/relay.mjs` (one file, no dependencies) runs on the bank server: `BLMOVE` to
  `<key>:processing` (20 s blocking wait; polls every 10 s if blocking is refused), sends through
  Coopbank (3 attempts), then `LREM`. Crash leftovers go back to the queue at start (at least
  once). Messages older than `SMS_MAX_AGE_S` (1 h) are dropped; repeated failures go to
  `<key>:failed`. Kept alive by a per-minute cron line with `flock` (no root needed).
- Neon (free tier) is not involved: the relay never calls the API or the database, so the
  database can still go idle. Upstash's free tier counts commands: a 20 s wait is about 130k a
  month.
- `SMS_PROVIDER=coopbank` stays for hosts inside the allowlist (e.g. the Docker image on a bank
  server).

## Open
- Production URLs and credentials (the defaults are UAT).
- Whether the provider reports delivery (we only know the request was accepted).
