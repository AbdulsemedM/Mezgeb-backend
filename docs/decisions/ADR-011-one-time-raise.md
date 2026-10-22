# ADR-011 — One-time raise over the customer's hard stop

Status: accepted · Date: 2026-10-22

## Context
Spec LIM-3: when the customer chose a hard stop, the shop cannot post a purchase beyond it
"without the customer approving a one-time raise from their phone". ADR-008 deferred this to
M8. The merchant app's counter screen (F6) needs it now, and customers have no app screens or
web pages yet.

## Decision
- **The customer approves with an SMS code.** The shop (owner or staff) asks:
  `POST /v1/accounts/{id}/raises {id, amount}`. The server texts the customer a 6-digit code with
  the shop name and the amount (`sms.raise_code`). The customer, or a representative who calls
  them, tells the shop the code. The shop sends it:
  `POST /v1/accounts/{id}/raises/{raiseId}/approve {code}`. This works with any phone. When the
  customer app exists, the customer approves the same request without a code (role `customer`).
- **Online only.** Asking needs the server to send the SMS. Offline, the app keeps ADR-003: a
  clear warning, then the sale is posted and flagged `over_hard_stop`.
- **Amount** is how far over the hard stop the customer allows, once. The app asks for exactly
  what the sale needs.
- **Use.** An approved raise is valid for 60 minutes. The next purchase on the account recorded
  while it is valid, online or through sync, is evaluated with `oneTimeRaise = amount`. If that
  removes `over_hard_stop`, the purchase posts without the flag and the raise becomes `used`
  (`used_by_entry_id`). A purchase beyond the raise is still refused online, or flagged offline,
  and the raise stays unused.
- **Code rules** (like the sign-in code, ADR-005): stored only as an HMAC with `OTP_PEPPER`, sent
  straight to the SMS gateway rather than through the outbox, so it never sits in the database.
  15 minutes to use it. 5 wrong codes expire the request. A new request on the account expires
  the one still waiting. Per account, one request a minute and 5 an hour (`raise_rate_limited`).
- **Errors:** `no_hard_stop` and `account_not_active` (409), `code_required` (400),
  `raise_code_invalid` with `attempts_left`, `raise_code_locked` and `raise_expired` (409).
- Raises are not synced: the request and approval happen online at the counter.
- Permissions: `request_raise` owner and staff; `approve_raise` owner and staff (with the code)
  and customer (without).

## Consequences
- The spec's "from their phone" is met with SMS, without an inbound SMS gateway.
- A customer who gives the code by voice cannot see the full sale on their phone first. The SMS
  names the shop and the amount over the limit, and the purchase SMS follows the sale.
