# ADR-004 — Schema details settled in M1

Status: accepted · Date: 2026-10-21

## Entry status
The spec's `entry.status` column is dropped: an entry cannot be updated, so a status could
never change. Disputes live in `dispute`. An entry recorded while the account is not yet active
(ONB-4, "pending acceptance") carries the flag `pending_acceptance`, set at insert; current
state is read from `account.status`.

## Correction amounts are signed
A correction carries the delta: negative reduces the balance, positive adds to it
(never zero). Balance = Σ purchase + Σ correction − Σ payment. Purchase and payment amounts
are always positive.

## Monthly limits store their calendar
`account_limit.calendar` (and `representative.limit_calendar`) is copied from the setter's
`calendar_pref` when the limit is set. Changing the app calendar later does not move the due
date of an existing limit; setting the limit again does.

## Quantities are canonical decimal text
`entry_line.qty` is stored as text exactly as signed, in canonical form
(`0`, `1`, `1.5`, `0.25`: no leading zeros, no trailing fractional zeros, no sign). This lets
chain verification rebuild the signing payload byte for byte.

## Table names
`user`, `limit` and `order` are SQL reserved words; the tables are `app_user`,
`account_limit` and `delivery_order`.

## Identifiers
Every row's `id` is a UUID v7. For rows created on a device it is the client-generated
idempotency key; rows created by the server get a v7 generated in code (Postgres 16 has no
`uuidv7()`), never a DB default.

## Auth tables
OTP challenges and refresh tokens are not in the spec's data model; they are added in M2.
