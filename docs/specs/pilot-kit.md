# Mezgeb — Pilot Kit

Oct 18, 2026 · @geab

Everything needed to run the 12-week Mezgeb pilot: stories for the build team, the pilot plan, the agreement both parties accept, message templates and a demo script.

## User stories with acceptance criteria

IDs map to the requirement IDs in the Application Specification.

| ID                   | Story                                                                                                      | Acceptance criteria                                                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| US-01 (ONB-2, 3)     | As a merchant, I add a customer by phone number and nickname so I can start recording without them present | Given a valid Ethiopian number, when I save, then the account shows "Invited" and an invite SMS is sent within 30 s; the nickname is visible only to me                                    |
| US-02 (ONB-4)        | As a customer, I accept the shop's terms from the invite link so the account becomes shared                | Given I open the link and verify OTP, when I accept, then I see the shop, my balance and every pending entry, and the account turns "Active" for both                                      |
| US-03 (LED-1, 2)     | As a merchant, I record a sale in simple or detailed mode                                                  | Given detailed mode, I can enter qty, unit and unit price and the line total is computed; given simple mode, I enter name and amount only; the toggle is one tap and persists per customer |
| US-04 (LED-3, REP-4) | As a merchant, I record who took the goods                                                                 | I must pick Customer, a listed representative, or Delivery; an unlisted person cannot be selected; the customer notification names the person                                              |
| US-05 (AI)           | As a merchant, I photograph the basket and confirm detected items                                          | Proposed lines appear in under 5 s offline; each line is editable; unknown items show the crop; nothing posts until I tap Confirm                                                          |
| US-06 (REP-1, 2, 3)  | As a customer, I add my maid with a monthly limit and can revoke her                                       | She appears in the merchant's picker at once; entries past her limit trigger a warning; after revoke, she disappears from the picker within one sync                                       |
| US-07 (LIM-1, 2)     | As a customer, I set a value and time limit                                                                | I can set ETB amount and period; I get alerts at 80% and 100%, and 3 days before the due date; the merchant sees the effective (stricter) limit                                            |
| US-08 (LIM-3)        | As a merchant, I am warned before passing a limit                                                          | At 100% a blocking dialog shows; override needs a reason; the customer is alerted with that reason                                                                                         |
| US-09 (PAY-1)        | As a merchant, I send a pay-me request                                                                     | I choose full balance or an amount, add a message; the customer receives it with my payment details                                                                                        |
| US-10 (PAY-2, 3)     | As a customer, I report a telebirr payment and the merchant confirms it                                    | My report shows "Awaiting confirmation"; when confirmed my balance drops by that amount; when rejected I see the reason and can resubmit                                                   |
| US-11 (PAY-4)        | As a merchant, I record cash paid at the counter                                                           | It posts as confirmed and the customer is notified with the new balance                                                                                                                    |
| US-12 (ORD-1 to 3)   | As an apartment customer, I send a list for delivery to my floor                                           | The merchant can accept, adjust and price it; on Delivered it posts as one entry marked Delivery with my floor note                                                                        |
| US-13 (LED-5, 6)     | As a customer, I dispute a wrong entry                                                                     | I give a reason; the merchant sees it; resolution is a correction entry both see; the original stays visible                                                                               |
| US-14 (LED-7)        | As either party, I share a monthly statement                                                               | PDF or image with all entries, payments, who took what, and closing balance                                                                                                                |
| US-15 (DSH-1)        | As a merchant, I see who owes what at a glance                                                             | Home shows total outstanding, near-limit and overdue customers, payments to confirm, open orders                                                                                           |

## Pilot plan

The pilot runs 12 weeks with 50 merchants and about 1,500 customers in two Addis Ababa sub-cities, and ends with a go or no-go review against the KPIs in the Business Specification.

| Item              | Plan                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| Locations         | Two sub-cities with dense condominium blocks (for example Yeka and Bole), 25 merchants each          |
| Merchant mix      | 35 grocery or mini-market, 5 butchers, 5 pharmacies, 5 cafés with office customers                   |
| Merchant criteria | Runs a dube notebook today; 30+ regular credit customers; owner uses an Android phone                |
| Customer mix      | At least 30% households with a maid or guard; at least 20% apartment delivery users                  |
| Team              | 1 product lead, 2 field agents, 1 support line, build team on call                                   |
| Incentive         | Free Shop plan for the pilot and 3 months after; SMS covered                                         |
| Baseline          | Photograph each merchant's notebook in week 1: customer count, open balances, average days to settle |
| Measurement       | Weekly KPI dashboard; 10 merchant and 10 customer interviews in weeks 4 and 10                       |

pilot plan · 12 weeks, 4 stages

Exit criteria for launch: 40 of 50 merchants active, dispute rate under 2%, and 30% choosing a paid plan.

## Merchant–customer dube agreement template

Shown to the customer on invite acceptance and to the merchant at sign-up. Draft for counsel review; not legal advice.

**Mezgeb Dube Agreement**

Between **[Shop name]** ("the Merchant") and **[Customer name, phone]** ("the Customer"), accepted electronically on **[date]**.

- **Purpose.** The Merchant may supply goods to the Customer, or to people the Customer authorizes, with payment later. Mezgeb is only the shared record of these purchases and payments.

- **No interest, no fees.** The Customer pays only the price of the goods recorded. Neither party charges interest, late fees or penalties through this arrangement.

- **No lender.** No bank, lender or Mezgeb itself provides credit or holds money. Payments go directly from the Customer to the Merchant by any means they agree.

- **Records.** Every purchase is recorded with items, amount, date, time and who took the goods. Both parties can see every record. Records are never deleted; mistakes are fixed by a correction both can see.

- **Authorized representatives.** The Customer decides who may take goods on the account and may set a limit for each. The Merchant supplies only listed representatives. The Customer is responsible for purchases by listed representatives until they are removed.

- **Limits.** Either party may set a spending limit and a payment period. The lower amount and the shorter period apply. Either party may change their own limit at any time with notice to the other.

- **Payments.** The Customer reports each payment in Mezgeb. A payment reduces the balance once the Merchant confirms it. The Merchant confirms or explains a rejection within a reasonable time.

- **Disputes.** Either party may dispute a record in Mezgeb with a reason. The parties will try to settle it between themselves using the records.

- **Ending.** Either party may end the arrangement. Any open balance remains payable. Both keep read access to the records for [12] months.

- **Data.** Records are used only to run this arrangement. They are not shared with anyone else without the Customer's and Merchant's explicit consent.

Accepted by the Merchant: [name, date, time]
Accepted by the Customer: [name, date, time]

## SMS and notification templates

English masters; each needs Amharic and Afaan Oromo versions reviewed by a native speaker. SMS stays under 160 characters where possible. Placeholders in braces.

| Event                             | Template                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| Invite                            | {shop} added you to Mezgeb, your shared dube book. See every purchase and your balance: {link} |
| Purchase                          | {shop}: {items} = {amount} ETB, taken by {person}. Balance {balance} ETB. {link}               |
| Purchase (representative receipt) | {shop}: {items} = {amount} ETB recorded for {customer}.                                        |
| Limit 80%                         | {shop}: you have used {pct}% of your {limit} ETB limit. Balance {balance} ETB.                 |
| Limit reached                     | {shop}: your {limit} ETB limit is reached. New purchases need your approval. {link}            |
| Override                          | {shop} recorded {amount} ETB above your limit. Reason: {reason}.                               |
| Due soon                          | {shop}: your balance of {balance} ETB is due on {date}.                                        |
| Pay-me                            | {shop} requests {amount} ETB. {message} Pay to: {payment_details}. Then report it: {link}      |
| Payment confirmed                 | {shop} confirmed your {amount} ETB payment. New balance {balance} ETB.                         |
| Payment rejected                  | {shop} could not confirm your {amount} ETB payment: {reason}. Check and resend: {link}         |
| Rep added                         | {customer} authorized you to take goods at {shop}. Limit {limit} ETB per {period}.             |
| Order delivered                   | {shop} delivered your order to {address}: {amount} ETB. Balance {balance} ETB.                 |

## Demo script for the clickable prototype

A 10-minute walkthrough of the [Mezgeb demo](https://claude.ai/artifact/1AJzKG3oaP5jYwNmU8rmA1). The merchant phone (Tigist Mini Market) and the customer phone (Hanna, Floor 4) share one live ledger; Almaz the house helper has an SMS-only phone. Press Reset demo before presenting.

- **Photo sale.** Merchant: Floor 4 Hanna → Photo sale → Use sample basket. Show the detected eggs, oil and pasta, name the unsure item or remove it, add to sale, record. Point out the 80% limit alert on both phones.

- **Shared record.** Customer: Dube book. The new entry is there with photo source and who took it. Toggle Simple and Detailed.

- **Representative.** Merchant: record 6 bread taken by Almaz. Her SMS receipt appears on the third phone.

- **Customer limits.** Customer: My limits → Hard stop → Save. The merchant gets a notice. Record another large sale: the merchant now has to ask Hanna, who approves once on her phone.

- **New representative.** Customer: People → add Tesfaye the guard with a 400 ETB limit. He appears at once in the merchant's who-is-taking picker.

- **Delivery order.** Customer: Order → send milk, bread, tomatoes to Floor 4. Merchant: Orders → accept, mark an item out of stock, send priced list, mark delivered. It posts as one Delivery entry.

- **Pay-me.** Merchant: Pay-me request. Customer: I paid · report it (telebirr, reference prefilled).

- **Confirm.** Merchant: Payments → Confirm received. Both balances drop; the pay-me clears when the balance reaches zero.

- **Dispute.** Customer: open an entry → Dispute. Merchant: Home shows the dispute → post a correction. The original stays visible; the correction is a new line.

- **Onboard.** Merchant: Add customer → phone, name, nickname "Floor 6 Betty" → the invite SMS preview. Simulate acceptance from her account page.

Things to say along the way: no money moves through the app; no interest or fees; every entry is permanent and visible to both; the photo detector in the demo is simulated.
