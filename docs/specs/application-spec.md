# Mezgeb — Application Specification

Oct 18, 2026 · @geab

## Scope and principles

This spec defines the Mezgeb MVP: a merchant app (Android, offline-first), a customer app (Android plus a no-install web app), SMS for representatives, and a cloud backend. It pairs with the Mezgeb Business Specification.

Design principles:

- **One shared truth.** Each merchant–customer pair has exactly one ledger; both sides read the same entries.

- **Append-only.** Entries are never edited or deleted; corrections are new entries that reference the original.

- **Money never touches Mezgeb.** The app records claims and confirmations, not transfers.

- **Faster than paper.** A routine entry takes under 10 seconds; photo capture under 15 seconds including confirm.

- **Works offline.** The counter must never wait for the network.

- **Amharic first.** All screens, SMS and notifications in Amharic, Afaan Oromo and English; Ethiopian calendar shown alongside Gregorian.

Terms used: _account_ = the relationship between one merchant and one customer; _entry_ = one recorded event on an account (purchase, delivery, payment, correction); _representative_ = a person the customer authorizes to take goods on their account.

## Roles and permissions

| Action                         | Merchant owner     | Merchant staff | Customer                  | Representative               |
| ------------------------------ | ------------------ | -------------- | ------------------------- | ---------------------------- |
| Onboard customer, set nickname | Yes                | Yes            | No                        | No                           |
| Record purchase entry          | Yes                | Yes            | No                        | No (is attributed)           |
| Record correction              | Yes                | Request only   | Dispute only              | No                           |
| See all balances and totals    | Yes                | No             | Own account only          | No                           |
| Set merchant-side limits       | Yes                | No             | No                        | No                           |
| Set customer-side limits       | No                 | No             | Yes                       | No                           |
| Add or revoke representatives  | No                 | No             | Yes                       | No                           |
| Send pay-me request            | Yes                | No             | No                        | No                           |
| Report payment                 | No                 | No             | Yes                       | No                           |
| Confirm or reject payment      | Yes                | No             | No                        | No                           |
| Send delivery order            | No                 | No             | Yes                       | Optional, if customer allows |
| Accept and deliver order       | Yes                | Yes            | No                        | No                           |
| Change record detail mode      | Yes (shop default) | No             | Yes (own view preference) | No                           |
| Receive SMS receipt            | No                 | No             | Yes                       | Optional                     |

A merchant may also be a customer of another merchant; roles are per account, not per person.

## Functional requirements by module

Priority: M = must for MVP, S = should, C = could.

### Onboarding (ONB)

| ID    | Requirement                                                                                                                                                 | Priority |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| ONB-1 | Merchant signs up with phone number and SMS OTP; enters shop name, location (sub-city, woreda, landmark) and default detail mode                            | M        |
| ONB-2 | Merchant adds a customer by phone number (typed or from contacts), with optional nickname and optional location note (block, floor, unit)                   | M        |
| ONB-3 | System sends an invite SMS in the customer's language with app download and web link; link signs in by OTP                                                  | M        |
| ONB-4 | Customer accepts the agreement terms (no interest, no fees, limits) before the account goes active; until then entries are recorded as "pending acceptance" | M        |
| ONB-5 | Nickname is private to the merchant; the customer sees the shop name and their own name                                                                     | M        |
| ONB-6 | Customer can join an existing merchant by scanning the shop's QR code                                                                                       | S        |
| ONB-7 | Bulk import of customers from contacts with a nickname per row                                                                                              | C        |

### Ledger entries (LED)

| ID    | Requirement                                                                                                                                                  | Priority |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| LED-1 | Merchant records a purchase with line items; each line has item name and amount (simple mode) or name, quantity, unit, unit price and amount (detailed mode) | M        |
| LED-2 | Detail mode set per shop, overridable per customer and per entry by toggle                                                                                   | M        |
| LED-3 | Each entry records who took the goods: the customer, a named representative, or delivery                                                                     | M        |
| LED-4 | Shop catalogue with item names, units and last price; typing suggests items; favourites and "repeat last basket"                                             | M        |
| LED-5 | Entries are append-only; a correction entry references the original, shows reason, and notifies the customer                                                 | M        |
| LED-6 | Customer can dispute an entry with a reason; merchant resolves by correction or by note                                                                      | M        |
| LED-7 | Running balance per account and statement by period (week, month, custom), shareable as PDF or image                                                         | M        |
| LED-8 | Entries can carry a photo of the basket or receipt                                                                                                           | S        |
| LED-9 | Voice entry ("two litres of oil, one bread")                                                                                                                 | C        |

### Representatives (REP)

| ID    | Requirement                                                                                                                     | Priority |
| ----- | ------------------------------------------------------------------------------------------------------------------------------- | -------- |
| REP-1 | Customer adds a representative with name, relationship (household member, maid, guard, driver, other) and optional phone number | M        |
| REP-2 | Representative may have an own value limit per period, within the account limit                                                 | M        |
| REP-3 | Customer can pause or revoke a representative instantly; merchant sees the change at once                                       | M        |
| REP-4 | Merchant picks the representative from a list at entry time; an unknown person cannot be added by the merchant                  | M        |
| REP-5 | Optional SMS receipt to the representative after each entry                                                                     | S        |
| REP-6 | Optional 4-digit PIN per representative that the merchant asks for at the counter                                               | S        |

### Limits (LIM) — rules in the next section

| ID    | Requirement                                                                                                        | Priority |
| ----- | ------------------------------------------------------------------------------------------------------------------ | -------- |
| LIM-1 | Both merchant and customer can set a value limit (ETB) and a time limit (period after which the balance is due)    | M        |
| LIM-2 | Alerts to both sides at 80% and 100% of the value limit, and 3 days before and on the time limit due date          | M        |
| LIM-3 | At 100%, merchant sees a block warning; merchant can override per entry with a reason, which notifies the customer | M        |
| LIM-4 | Customer can choose alert-only or hard stop for their own limit                                                    | S        |

### Payments and pay-me (PAY)

| ID    | Requirement                                                                                                                                       | Priority |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| PAY-1 | Merchant sends a pay-me request for the full balance or an amount, with optional message and due date                                             | M        |
| PAY-2 | Customer reports a payment with amount, method (cash, telebirr, CBE Birr, M-PESA, bank transfer, other), reference number and optional screenshot | M        |
| PAY-3 | Merchant confirms or rejects with reason; only confirmed payments reduce the balance                                                              | M        |
| PAY-4 | Merchant can record a payment received directly (for example cash at the counter), which posts as confirmed and notifies the customer             | M        |
| PAY-5 | Partial payments allowed; balance and limit usage update at once                                                                                  | M        |
| PAY-6 | Reported payment not acted on in 48 hours triggers a reminder to the merchant                                                                     | S        |
| PAY-7 | Pay-me message carries payment details the merchant chose (telebirr number, account number, merchant QR)                                          | S        |

### Delivery orders (ORD)

| ID    | Requirement                                                                                                                         | Priority |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- | -------- |
| ORD-1 | Customer sends a list of items (free text or from the shop catalogue) with delivery address (block, floor, unit) and preferred time | M        |
| ORD-2 | Merchant accepts, edits quantities, marks out-of-stock items, prices the list and marks it out for delivery                         | M        |
| ORD-3 | On delivery the order posts to the ledger as one entry; the customer is notified                                                    | M        |
| ORD-4 | Customer can confirm receipt or flag a missing item                                                                                 | S        |
| ORD-5 | Repeat a past order in one tap                                                                                                      | S        |

### Dashboard and reports (DSH)

| ID    | Requirement                                                                                                 | Priority |
| ----- | ----------------------------------------------------------------------------------------------------------- | -------- |
| DSH-1 | Merchant home: total outstanding, customers near or over limit, payments awaiting confirmation, open orders | M        |
| DSH-2 | Customer home: balance per shop, limit usage, recent entries, open pay-me requests                          | M        |
| DSH-3 | Merchant reports: receivables ageing, top items on account, collections this month                          | S        |

## Limits engine rules

The stricter limit always applies: effective value limit = the lower of the merchant's and the customer's; effective due date = the earlier of the two time limits.

- **Value limit** is checked against the open balance (purchases minus confirmed payments) plus the new entry.

- **Representative limit** is checked against that representative's purchases in the current period, in addition to the account limit.

- **Time limit** is a period type: weekly, every two weeks, monthly (Gregorian or Ethiopian month), or custom days. The period starts at the first unpaid entry; when the period ends, the open balance is due even if the value limit is not reached.

- **Thresholds:** 80% of value limit → warning to both; 100% → block warning to merchant and alert to customer; due date minus 3 days → reminder to customer; due date → due notice to both; due date plus 7 days → overdue flag on the merchant dashboard.

- **At 100%:** if the customer chose hard stop, the merchant cannot post without the customer approving a one-time raise from their phone; otherwise the merchant can override with a reason, which the customer sees.

- **Reset:** a confirmed payment that clears the balance restarts the time period on the next entry. Partial payments do not restart the period.

- **Changes:** either side can change their own limit at any time; the other side is notified. A lowered limit below the current balance does not block past entries, only new ones.

Worked example: merchant limit ETB 5,000 monthly; customer limit ETB 4,000 every two weeks. Effective: ETB 4,000, due two weeks after the first unpaid entry. The maid has her own ETB 1,500 limit inside that.

## Payment and pay-me lifecycle

A reported payment stays _pending_ until the merchant acts; only _confirmed_ payments change the balance and the limit usage.

payment lifecycle · 2 entry paths, 1 decision

Payment states: reported → confirmed | rejected; a rejected report can be corrected and resubmitted. Pay-me request states: sent → seen → partially paid | paid | expired. A merchant-recorded payment skips review and posts as confirmed, with a notice to the customer.

## Delivery order flow

A delivery order is a request, not a ledger entry; it posts to the ledger only when the merchant marks it delivered.

- Customer (or an allowed representative) creates a list: catalogue items or free text, quantities, delivery note (block, floor, unit, gate), preferred time. Status sent.

- Merchant sees it in the Orders tab with a sound alert; accepts or declines with reason. Status accepted.

- Merchant picks items, adjusts quantities, marks unavailable items, and confirms prices. Customer sees the priced list. Status priced.

- Merchant marks out for delivery, optionally naming the delivery person. Status out_for_delivery.

- Merchant marks delivered; the order becomes one purchase entry with taken_by = delivery and a link to the order. Status delivered.

- Customer may confirm receipt or flag a missing or wrong item within 24 hours; a flag opens a dispute on that entry.

Limits apply at step 3: if the priced order would pass the limit, the merchant sees the warning before accepting delivery.

## AI photo capture

The merchant photographs the basket on the counter; the app proposes line items, and nothing posts until the merchant taps confirm.

- **Model:** a small on-device object detector and classifier (for example a MobileNet or YOLO-nano class model, quantized, under 15 MB) trained on common Ethiopian shop items: eggs, bread, oil (by bottle size), pasta, macaroni, rice, sugar, teff flour, lentils, soap, detergent, soft drinks, water, tissue, milk, coffee.

- **Counting:** detect instances and count them ("6 eggs", "2 oil 1 L"); packaged goods are read by shape, colour and visible brand text.

- **Pricing:** each detected item maps to the shop's catalogue; the price is the shop's last price for that item and unit.

- **Fallback:** items the model is unsure of (confidence under 0.6) appear as "Unknown item" with the photo crop, for the merchant to name once; the shop catalogue learns it.

- **Learning:** confirmed photos and corrections, with merchant consent, train a shared model in the cloud; each shop also keeps a local alias list.

- **Offline:** detection runs on the phone; no network needed.

- **Privacy:** photos are stored with the entry only if the merchant chooses; faces in frame are blurred before upload.

- **Accuracy target:** 85% of lines accepted without edit by pilot week 12.

A cloud vision model may be used during the pilot to bootstrap labels, before the on-device model is good enough.

## Notifications matrix

Push goes to app users; SMS is the fallback for customers without the app and for representatives who opted in.

| Event                           | Merchant            | Customer                                | Representative          | Channel            |
| ------------------------------- | ------------------- | --------------------------------------- | ----------------------- | ------------------ |
| Customer invited                | —                   | Invite with link                        | —                       | SMS                |
| Purchase recorded               | —                   | Items, amount, who took it, new balance | Receipt (optional)      | Push, SMS fallback |
| Correction recorded             | —                   | What changed and why                    | —                       | Push, SMS fallback |
| Entry disputed                  | Dispute with reason | —                                       | —                       | Push               |
| Limit 80% reached               | Warning             | Warning                                 | Own limit warning       | Push               |
| Limit 100% reached              | Block warning       | Alert                                   | Own limit alert         | Push, SMS          |
| Limit override used             | —                   | Alert with reason                       | —                       | Push, SMS          |
| Time limit in 3 days            | —                   | Reminder                                | —                       | Push               |
| Time limit reached              | Due notice          | Due notice                              | —                       | Push, SMS          |
| Pay-me request sent             | —                   | Request with amount and payment details | —                       | Push, SMS          |
| Payment reported                | Review request      | —                                       | —                       | Push               |
| Payment confirmed or rejected   | —                   | Result and new balance                  | —                       | Push, SMS          |
| Representative added or revoked | Change notice       | —                                       | Added or removed notice | Push, SMS          |
| Limit changed by other side     | Notice              | Notice                                  | —                       | Push               |
| Delivery order sent             | New order alert     | —                                       | —                       | Push with sound    |
| Order priced, out, delivered    | —                   | Status update                           | —                       | Push               |

Quiet hours 21:00–07:00 hold non-urgent notices until morning. SMS cost is capped per plan.

## Data model

Core entities, PostgreSQL. All money in integer santim (1 ETB = 100 santim). All tables carry created_at, created_by, device_id and a client-generated UUID for offline sync.

| Entity         | Key fields                                                                                                                                                                             | Notes                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| user           | id, phone, name, language, calendar_pref                                                                                                                                               | One person, any role               |
| merchant       | id, owner_user_id, shop_name, location, default_detail_mode, plan                                                                                                                      | Shop                               |
| merchant_staff | merchant_id, user_id, role (owner, staff)                                                                                                                                              | Permissions per role               |
| account        | id, merchant_id, customer_user_id, nickname, location_note, status (pending, active, paused, closed), terms_accepted_at                                                                | One per merchant–customer pair     |
| representative | id, account_id, name, relationship, phone, pin_hash, status, limit_value, limit_period                                                                                                 | Created only by the customer       |
| limit          | account_id, set_by (merchant, customer), value, period_type, period_days, mode (alert, hard_stop)                                                                                      | Two rows max per account           |
| catalogue_item | id, merchant_id, name, aliases, unit, last_price, photo_label                                                                                                                          | Per shop                           |
| entry          | id, account_id, type (purchase, payment, correction), amount, taken_by_type (customer, representative, delivery), representative_id, order_id, ref_entry_id, reason, photo_url, status | Append-only                        |
| entry_line     | entry_id, item_id, name, qty, unit, unit_price, amount, source (manual, photo, order)                                                                                                  | Detailed or simple                 |
| payment_report | id, account_id, amount, method, reference, screenshot_url, status (reported, confirmed, rejected), reviewed_by, reviewed_at                                                            | Becomes a payment entry on confirm |
| payme_request  | id, account_id, amount, message, due_date, status                                                                                                                                      | Sent by merchant                   |
| order          | id, account_id, lines (json), address_note, preferred_time, status, delivered_entry_id                                                                                                 | Delivery orders                    |
| dispute        | id, entry_id, raised_by, reason, status, resolution_entry_id                                                                                                                           |                                    |
| notification   | id, user_id, event, payload, channel, sent_at, read_at                                                                                                                                 | Outbox                             |
| audit_log      | id, actor, action, object, before, after, at                                                                                                                                           | Immutable                          |

Balance is derived: sum of purchase and correction entries minus confirmed payment entries, cached per account and recomputed on every write.

## Architecture

A modular monolith is enough for the pilot; the services below are modules in one deployable, split later only if load requires it.

architecture · clients, gateway, services, data

Suggested stack: Kotlin or Flutter for the merchant app with a local SQLite store and sync queue; React web app for customers; Node.js (NestJS) or Go backend; PostgreSQL; S3-compatible storage; TensorFlow Lite for on-device vision. Representatives are reached by SMS only (dashed). Payment provider deep links come in phase 2 and never route funds through Mezgeb.

## API outline

REST over HTTPS, JSON, versioned under /v1. Auth by phone OTP issuing a short-lived JWT plus refresh token. Every write accepts a client UUID and is idempotent, so offline queues can retry safely.

| Method      | Path                             | Purpose                                                           | Caller             |
| ----------- | -------------------------------- | ----------------------------------------------------------------- | ------------------ |
| POST        | /auth/otp, /auth/verify          | Request and verify OTP                                            | All                |
| POST        | /merchants                       | Create shop                                                       | Merchant           |
| POST        | /accounts                        | Invite customer by phone, nickname                                | Merchant           |
| POST        | /accounts/{id}/accept            | Accept terms, activate                                            | Customer           |
| GET         | /accounts?role=merchant│customer | List accounts with balance and limit usage                        | Both               |
| GET         | /accounts/{id}/entries?from&to   | Ledger and statement                                              | Both               |
| POST        | /accounts/{id}/entries           | Record purchase or correction                                     | Merchant           |
| POST        | /entries/{id}/disputes           | Dispute an entry                                                  | Customer           |
| POST        | /vision/detect                   | Optional cloud detection fallback; returns proposed lines         | Merchant           |
| PUT         | /accounts/{id}/limits/{side}     | Set value and time limit                                          | Owner of that side |
| POST, PATCH | /accounts/{id}/representatives   | Add, pause, revoke                                                | Customer           |
| POST        | /accounts/{id}/payme             | Send pay-me request                                               | Merchant           |
| POST        | /accounts/{id}/payments          | Report payment (customer) or record received payment (merchant)   | Both               |
| POST        | /payments/{id}/confirm, /reject  | Review a reported payment                                         | Merchant           |
| POST        | /accounts/{id}/orders            | Send delivery order                                               | Customer           |
| PATCH       | /orders/{id}                     | Accept, price, out for delivery, delivered                        | Merchant           |
| POST        | /sync                            | Batch push of offline writes; returns server changes since cursor | Apps               |
| GET         | /accounts/{id}/statement.pdf     | Shareable statement                                               | Both               |

Limit checks run server-side on every purchase write and client-side against the last synced state when offline; an offline entry that turns out to exceed a hard-stop limit is posted and flagged for the customer, never silently dropped.

## Non-functional requirements, security and privacy

| Area          | Requirement                                                                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Speed         | Manual entry under 10 s; photo to confirmed entry under 15 s; app cold start under 3 s on a 2 GB RAM Android phone                                                                                  |
| Offline       | All merchant actions except pay-me and confirm work offline; sync within 60 s of reconnect; conflicts resolved by append (no overwrites)                                                            |
| Devices       | Android 8+; merchant APK under 30 MB including the vision model; customer web app works on 3G                                                                                                       |
| Availability  | 99.5% monthly for the API during pilot; 99.9% at launch                                                                                                                                             |
| Scale         | Design for 10,000 merchants and 1 million accounts without re-architecture                                                                                                                          |
| Security      | TLS 1.2+; encryption at rest; OTP rate limiting; staff accounts with least privilege; device binding for merchant owners; representative PIN hashed                                                 |
| Integrity     | Append-only entries with hash chaining per account so any tampering is detectable; immutable audit log                                                                                              |
| Privacy       | Consent at invite acceptance; data stored in-country or approved region; customer export and delete; nickname never shown to customer; photo faces blurred; no data sharing without explicit opt-in |
| Localization  | Amharic, Afaan Oromo, English; Ethiopian and Gregorian calendars; ETB formatting                                                                                                                    |
| Accessibility | Large tap targets at the counter; icons with labels; works one-handed                                                                                                                               |
| Observability | Structured logs, metrics per KPI in the business spec, crash reporting                                                                                                                              |

## MVP scope and open questions

The MVP ships every M requirement above; S items enter during the pilot as merchants ask for them; C items wait for phase 2.

Out of MVP: payment links inside pay-me, staff roles beyond owner and one assistant, multiple branches, voice entry, credit-partner data sharing, iOS app.

Open questions:

- ☐ Should a customer be able to see a merchant's catalogue and prices before ordering, or only the priced list after?

- ☐ Does a representative need any app at all, or is SMS plus optional PIN enough for the pilot?

- ☐ Which SMS gateway and sender ID (ethio telecom, Safaricom, aggregator)?

- ☐ Is a cloud vision model acceptable for pilot bootstrapping under the data protection rules?

- ☐ Should time limits follow the Ethiopian month by default?

- ☐ What happens to the ledger if a merchant closes the shop: customer keeps read-only access for how long?
