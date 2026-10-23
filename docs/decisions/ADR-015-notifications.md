# ADR-015 — Notifications: routing, quiet hours, SMS cap, reminders

Status: accepted · Date: 2026-10-23

## Context
M10 and the spec's notifications matrix. There is no Firebase project yet; the product owner
chose "SMS now, FCM ready".

## Decision
- **One routing point.** Every notice goes through `OutboxService.notify(tx, notice)` in the
  caller's transaction (ADR-006). `NOTIFICATION_RULES` (`outbox/notification-rules.ts`) is the
  matrix, one row per event:
  - `both`: push and SMS (the matrix's "Push, SMS");
  - `push`: push when the person has the app with a push token, otherwise SMS. This covers the
    matrix's "Push, SMS fallback", and also its push-only rows while push is not set up for
    everyone;
  - `sms`: SMS only (invites, representative receipts).
- **Push** sits behind `PushSender`: `PUSH_PROVIDER=none` (the default, so everything goes by
  SMS) or `fake` (in memory, dev and tests). The app registers its FCM token with
  `PUT /v1/devices/me/push-token {token|null}`; a token moves to the newest device that reports
  it.
  - The dispatcher sends one push to all of a person's live tokens, with the event and the
    account head `{account_id, seq, hash}` (ADR-001 receipts). New orders ring (`sound`).
  - Tokens the provider reports invalid are cleared. A push that cannot go is not retried: it
    becomes an SMS when its event allows it.
  - Plugging in FCM means adding an `FcmPushSender`, a provider value and the service-account
    key. Nothing else changes.
- **Quiet hours** run 21:00–07:00 Addis time. Non-urgent notices are scheduled for 07:00.
  Urgent ones go at once: money changes (purchases, corrections, payments, over-limit alerts)
  and replies the person is waiting for (order steps, payment results).
- **SMS cap:** each shop has a monthly SMS cap per plan (`SMS_CAP_FREE` 300, `SMS_CAP_SHOP`
  1500, `SMS_CAP_SHOP_PLUS` 5000 by default; the numbers are a starting point for the pilot).
  SMS past the cap are stored as `cancelled` with `cancelledReason: sms_cap`, so they can be
  counted. Invites are never capped. OTP and raise codes go straight to the gateway and are not
  counted.
- **Scheduled reminders** (`RemindersService`, every `REMINDERS_INTERVAL_MS`):
  - "Time limit in 3 days" (`due_soon`, to the customer) and "time limit reached"
    (`due_today`, to the customer and the owner), from the ADR-007 due dates;
  - PAY-6: a payment report not reviewed in 48 hours reminds the owner.
  - Each reminder has a key, so it is sent once.
- **New matrix rows:** "Limit changed by other side" (`limit_changed`), and the representative's
  own added/removed notice when they have a phone.

## Consequences
- While `PUSH_PROVIDER=none`, the pilot runs entirely on SMS. Watch the cap counts.
- The rules table is the one place to change a channel or the urgency of an event.
