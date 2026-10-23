# ADR-014 — Delivery orders

Status: accepted · Date: 2026-10-23

## Context
M9 (ORD-1 to ORD-4, US-12). Customers send orders from the PWA. The merchant app handles them
and must be able to mark an order delivered without signal.

## Decision
- **Customer (PWA)**:
  - `POST /v1/accounts/{id}/orders {id, lines[{name, qty?, unit?, item_id?, note?}],
    address_note?, preferred_time?}` (`send_order`). Everyone in the shop gets an SMS (push from
    M10).
  - `POST /v1/orders/{id}/receipt {missing?}` confirms receipt; a missing item opens a dispute
    on the delivery entry (ORD-4).
- **Shop (owner and staff, `handle_order`)**, by REST or as sync ops (`order.accept`,
  `order.decline`, `order.price`, `order.out`), so they work offline:
  - `sent → accepted → priced → out_for_delivery → delivered`;
  - `declined` (with a reason) from sent, accepted or priced;
  - pricing again while priced is allowed.
  - Pricing replaces `lines` with the priced list. Each line has qty × unit price, and lines
    marked `unavailable` stay listed with amount 0. The customer's original list stays in the
    audit log.
  - A step the order already passed returns the order unchanged, so retried syncs are harmless.
    Steps out of order are `409 invalid_order_step`.
- **Delivered** is the signed purchase entry itself, with `order_id` and `taken_by_type:
  delivery` (the order id is part of the ADR-001 payload). Recording it marks the order
  delivered and links `delivered_entry_id`, in the same transaction.
  - It is refused (`409 order_already_delivered`) when another entry already delivered the
    order. That is a duplicate, not a business rule, so it does not break rule 6.
  - It is also refused for a sent or declined order.
  - The usual purchase SMS tells the customer, plus SMS at priced, out for delivery and declined.
- Limits are checked as for any purchase: on the phone at pricing (owner) and on the delivered
  entry (online refused, offline flagged).
- Orders sync to the shop (owner and staff) and the customer.

## Consequences
- Two phones delivering the same order offline: the second entry is refused when it syncs and
  shows as not sent on that phone. Nothing is charged twice.
