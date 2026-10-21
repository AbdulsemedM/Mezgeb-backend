# ADR-007 — Limits engine and calendar details

Status: accepted · Date: 2026-10-21

## Representative limit periods roll from the day the limit was set
A representative's own limit (REP-2) resets every period counted from the date the customer
set it: periods are `[anchor + k·P, anchor + (k+1)·P)`. A monthly limit set on the 10th resets
on the 10th of every month. This works the same for weekly, biweekly, monthly (in the setter's
calendar) and custom-day periods. M6 stores the anchor as `representative.limit_set_at`; changing
the limit moves the anchor.

## Exactly at the limit is allowed
A purchase that brings the balance exactly to the limit posts (with the "100% reached" alert).
Only exceeding it gives `block100` (merchant may override with a reason) or `hard_stop`.

## Hard stop is the customer's own limit
`hard_stop` applies only when the customer's hard-stop limit (plus an approved one-time raise)
would be exceeded. Exceeding a lower merchant limit is `block100`.

## Representative over their own limit is `block100`
The merchant may override with a reason, as for the account limit. There is no hard-stop mode
for representatives.

## Thresholds are integer comparisons and alerts fire on crossing
80% means `projected × 100 ≥ limit × 80`. The engine reports which thresholds a purchase
crosses, so each alert fires once when crossed, not on every later sale.

## Local dates are Addis Ababa (UTC+3)
Period starts and due dates are Gregorian calendar dates in Africa/Addis_Ababa (fixed UTC+3, no
DST), written `YYYY-MM-DD`. A balance is due from 00:00 local time on the due date; "due soon"
starts 3 days before; "overdue" 7 days after. The time limit never blocks purchases.

## Monthly periods
- Gregorian: same day next month, clamped to the month's end (Jan 31 → Feb 28/29). Periods
  are always counted from the start date, never chained, so a 31st anchor returns to the 31st.
- Ethiopian: billing months are the 12 thirty-day months; Pagume belongs to Nehase's billing month
  (ADR-003). A period starting on day d of Nehase is due on day d of Meskerem; a period starting
  in Pagume is treated as starting on Nehase 30.

## Period start
The time period starts at the first entry that takes the balance (in `seq` order) from ≤ 0 to
> 0, on that entry's local `recorded_at` date. Partial payments do not restart it; a balance at
or below zero (paid off, corrected away, or overpaid) ends it. If no period is running, the new
purchase starts one today.

## Money
Line amounts are `unit_price × qty` rounded half up to the nearest santim, computed with
integers (qty is a decimal string). Formatting: `ETB 1,234.50` (en, om) and `1,234.50 ብር` (am).
