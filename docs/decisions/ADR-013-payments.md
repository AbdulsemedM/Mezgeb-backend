# ADR-013 — Payments: cash at the counter, pay-me, payment reports

Status: accepted · Date: 2026-10-23

## Context
M8 (PAY-1 to PAY-7). The merchant app must record cash at the counter without signal. Customers
use a separate PWA (decided with the product owner), so payment reports come from there.

## Decision
- **Cash at the counter (PAY-4)** is a device entry of type `payment`, signed like a sale
  (ADR-001) and sent with `entry.create`, online or through sync. It is owner only
  (`record_payment`, ADR-006) and posts as confirmed. Its body has `method` (`cash`, `telebirr`,
  `cbe_birr`, `mpesa`, `bank_transfer`, `other`), stored in `entry.payment_method`. The method
  is not part of the signed payload, which stays exactly ADR-001. A payment has no lines, no
  "who took it" and no reference. Balance = Σ purchase + Σ correction − Σ payment (ADR-004).
  Limits are not checked for payments. The customer gets `sms.payment_recorded` with the new
  balance.
- **Pay-me (PAY-1, PAY-7)**: `POST /v1/accounts/{id}/payme-requests {id, amount, message?,
  due_date?}`, owner only, online. It copies the shop's `payment_details` (set with `PATCH
  /v1/merchants/{id}`) and texts the customer (`sms.payme`).
- **PAY-5**: after each payment, open requests move to `partially_paid`, or to `paid` once the
  payments recorded since the request cover its amount (oldest request first). `seen` and
  `expired` come with the PWA and M10.
- **Payment reports (PAY-2, PAY-3)**:
  - The customer reports with `POST /v1/accounts/{id}/payment-reports {id, amount, method,
    reference?, resubmitted_from_id?}`. A resubmission must point at a rejected report. The
    owner gets an SMS.
  - The owner reviews online: `POST /v1/payment-reports/{id}/confirm` records a **server-origin
    payment entry** (ADR-001: no device fields, `request_id`, actor in the audit log) in the same
    transaction as the report. `.../reject {reason}` texts the customer the reason.
  - Confirming twice returns the same report. Reviewing after a different answer is
    `409 payment_report_reviewed`.
- **Sync**: `payme_requests` and `payment_reports` sync to owner and customer only; staff never
  get them (money, ADR-003). Entries carry `payment_method`.
- The 48-hour reminder for unreviewed reports (PAY-6) arrives with the M10 scheduler.

## Consequences
- An offline cash payment is final once synced. Fixing a wrong one takes a correction, as for
  sales.
- Without the PWA, reports exist only through the API; the app's "payments to confirm" fills
  once the PWA ships.
