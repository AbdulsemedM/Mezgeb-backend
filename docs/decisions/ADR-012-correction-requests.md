# ADR-012 — Staff correction requests; statements

Status: accepted · Date: 2026-10-23

## Context
Staff cannot post corrections (ADR-006, the spec roles table: "staff request only"). M5 left
the request out (ADR-008). The app's F7 needs it, and needs the statement PDF from M11 (LED-7,
US-14).

## Decision
- **Correction requests.** Staff ask with `POST /v1/entries/{id}/correction-requests {id, amount,
  reason}`, where `amount` is the proposed correction (signed santim, never 0). The owner gets an
  SMS (`sms.correction_request`; push from M10). The owner answers with
  `POST /v1/correction-requests/{id}/resolve`:
  - `{correction_entry_id}` after posting the correction (status `corrected`; the entry must be a
    correction of the same entry); or
  - `{note}` to decline (status `declined`).
  The same answer again is a retry; a different answer is `409 correction_request_resolved`.
- Requests are **shop-side only**: they sync to owner and staff (change_log trigger, pull filtered
  by shop membership) and never to the customer. `GET /v1/accounts/{id}/correction-requests`
  refuses customers.
- **Offline.** `correction_request.create`, `correction_request.resolve` and `dispute.resolve` are
  sync ops (ADR-010). The owner can post the correction and resolve in one batch. Dispute
  resolution is now idempotent too.
- **Statement.** `GET /v1/accounts/{id}/statement.pdf?from&to` (Addis local dates, both included),
  for the owner and the customer only (`view_statement`, ADR-003). It contains:
  - the opening balance (everything recorded before `from`);
  - one row per entry in `recorded_at` order, with date, what (items, or the correction reason),
    who took it, the signed amount and the running balance (payments count as negative);
  - the closing balance, and the last entry's `seq` and `hash` as a receipt (ADR-001).
  It is in the reader's language and calendar. The customer's copy shows their own name, never
  the shop's nickname for them (rule 8). It is rendered with pdfkit and Noto Sans Ethiopic
  (`apps/api/assets/fonts/`, OFL), which covers Ge'ez and Latin. Gregorian dates in am/om are
  numeric (`22/10/2026`); Ethiopian dates use the month names.

## Consequences
- A staff request is a message to the owner, not a ledger entry. Only the owner's correction
  changes the balance.
- Statements are online only (MOB-001); the app shares the downloaded PDF.
