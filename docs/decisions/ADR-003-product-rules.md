# ADR-003 — Product rules settled before build

Status: accepted · Date: 2026-10-21

## Calendar
- The user picks Ethiopian or Gregorian once, at first launch; stored in `user.calendar_pref`.
  It can be changed later in settings.
- Dates are stored in UTC; conversion is display-only.
- A monthly time limit follows the calendar of the person who set that limit. Each party sees
  the due date in their own calendar.
- Pagume (the 13th Ethiopian month, 5–6 days) belongs to Nehase's billing month for monthly limits.

## Offline sale beyond a hard-stop limit
- The entry is posted (never dropped) with flag `over_hard_stop`; the customer is alerted.
- After that, new purchases on the account are blocked until the customer approves a one-time
  raise or a payment is confirmed.
- Same treatment for an offline entry attributed to a representative who was already revoked:
  posted with flag `rep_revoked`, customer alerted.

## Shop assistant (staff) permissions — fixed for the MVP
Staff can: add customers and set nicknames, record purchases, request corrections,
accept and deliver orders.
Staff cannot: see balances or totals, set limits, send pay-me requests, confirm or reject
payments, change detail mode, manage staff.
One owner and at most one staff member per shop in the MVP.
