# Mezgeb — Business Specification

Oct 18, 2026 · @geab

## Executive summary

Mezgeb (Amharic for "register") digitizes the neighbourhood _dube_ book: a shared, two-sided ledger between a merchant and a regular customer. No bank, lender or wallet sits in the middle, no money moves through the app, and there is no interest or fee on the credit itself.

- **What it does:** records every item a customer or their authorized representative (household member, maid, guard) takes on account; notifies both sides on each entry; enforces value and time limits set by either side; lets the merchant send pay-me requests and the customer report payments made by any means (cash, telebirr, CBE Birr, M-PESA, bank transfer) for the merchant to confirm.

- **What makes it different:** both parties see and confirm the same record; customers, not only merchants, set limits; representatives are first-class; delivery orders from apartments are built in; an AI photo capture turns a picture of the basket into line items.

- **Who pays:** merchants, through a freemium subscription; customers always use it free.

- **Why now:** Ethiopian shops already run dube on paper, smartphones and mobile money are widespread, and digital merchant records are the missing input for future merchant credit.

- **Ask for the pilot:** 50 merchants and about 1,500 customers in two Addis Ababa sub-cities over 12 weeks.

## Problem and opportunity

Dube on paper works because of trust, and fails because of records. The merchant writes in a notebook; the customer keeps the total in their head. Disputes start the day the totals differ.

Pain points observed in the dube practice:

- **No shared record.** Only the merchant holds the book, so the customer cannot check what was charged or by whom.

- **Representatives are invisible.** A maid or guard picks up goods; the household learns the amount only at month end.

- **No limits.** Balances creep up until one side is uncomfortable; neither side has an early warning.

- **Collection is awkward.** Asking for payment face to face strains the relationship, so merchants delay and absorb losses.

- **Payments are untracked.** A customer pays by telebirr or transfer, but the book is not updated until someone remembers.

- **Delivery orders are informal.** Apartment residents phone or text a list; the merchant writes it later, if at all.

The opportunity: replace the notebook with a free, shared record that both sides trust, without turning the relationship into a loan product. The by-product is a clean, consented transaction history per merchant and customer, which is the data banks lack today for merchant and consumer credit.

## Product concept and positioning

Mezgeb is a record-keeping and notification tool, not a credit product. It is positioned as "your dube book, shared".

| Is                                               | Is not                                     |
| ------------------------------------------------ | ------------------------------------------ |
| A shared ledger both parties confirm             | A lender, wallet or payment processor      |
| An agreement tool between two people             | BNPL with interest, fees or credit scoring |
| A notifier for entries, limits and dues          | A debt collector                           |
| Payment-method neutral (any means, then confirm) | A channel that holds or moves money        |

Core capabilities:

- **Onboard by phone number.** The merchant adds a customer with a phone number and an optional nickname ("Floor 4 Abebe", "Blue gate") and sends an SMS invite with an app or web link.

- **Record entries** in simple mode (item and price) or detailed mode (quantity, unit, unit price), switchable per merchant and per customer.

- **AI photo capture.** The merchant photographs the basket; the app proposes line items for a one-tap confirm.

- **Authorized representatives.** The customer names who may take goods (household member, maid, guard), each with an optional own limit; every entry shows who took it.

- **Limits** in value (ETB) and time (week, two weeks, month, custom), set by either side; the stricter one applies; alerts at 80% and 100%.

- **Delivery orders.** The customer sends a list; the merchant accepts, prices and delivers to the house or floor; delivered items post to the ledger.

- **Pay-me requests and payment confirmation.** The merchant requests payment; the customer pays by any means and reports it with a reference; the merchant confirms and the balance clears.

- **Statements.** A running balance and period statements both parties can download or share.

## Target segments and personas

The first segment is neighbourhood grocery shops (_suq_) and mini-markets serving apartment blocks and compounds, where dube is already routine.

| Persona                    | Role           | Context                                                                                     | Main need                                                    |
| -------------------------- | -------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Tigist, shop owner         | Merchant       | Mini-market below a 12-floor condominium; 80 to 120 dube customers; writes in two notebooks | Fast entry at the counter, fewer disputes, polite collection |
| Dawit, shop assistant      | Merchant staff | Serves the counter while the owner is away                                                  | Record entries without seeing the owner's totals or settings |
| Hanna, household head      | Customer       | Works full time; maid and guard buy daily items                                             | See what was taken and by whom; cap monthly spend            |
| Almaz, house helper        | Representative | Buys bread, eggs, oil for the household                                                     | Take goods without carrying cash; no app needed              |
| Kebede, compound guard     | Representative | Picks up items for several households                                                       | Clear attribution to the right household                     |
| Samuel, apartment resident | Customer       | Orders by list, pays at month end by telebirr                                               | Send a list, get delivery, settle once                       |

Adjacent segments for later phases: pharmacies, butchers, cafés with regular office customers, small offices buying supplies on account, and wholesalers selling to retailers on terms.

## Competitive landscape

Digital khata apps prove the model at scale in South Asia, but they are merchant-first; no product found combines customer-set limits, representatives and delivery lists. Ethiopia's best-known dube product is bank-intermediated.

| Product                                                                                                                    | Market     | Model                                                                     | Gap against Mezgeb                                                      |
| -------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [OkCredit](https://okcredit.in/khatabook-alternative)                                                                      | India      | Free merchant ledger; SMS confirmation per entry; reminders with UPI link | No customer limits, no representatives, no delivery lists               |
| Khatabook                                                                                                                  | India      | Merchant ledger plus billing and payments                                 | Merchant-only view; grown into a broader platform                       |
| [Hishabee](https://blog.hishabee.io/?p=1851)                                                                               | Bangladesh | Ledger tied to POS and stock; WhatsApp/SMS reminders                      | Customer side is notifications only                                     |
| [Dube Ale (Dashen Bank / EagleLion)](https://shega.co/post/dashen-bank-introduces-dube-ale-a-buy-now-pay-later-scheme)     | Ethiopia   | Bank BNPL; limit set at a branch; may carry interest                      | A financial institution sits in the middle, which is what Mezgeb avoids |
| [Somaliland bookkeeping app](https://www.shega.co/news/somaliland-startup-brings-digital-bookkeeping-platform-to-ethiopia) | Ethiopia   | Digital credit and debit records for small businesses                     | Merchant bookkeeping, not a shared two-sided record                     |
| Paper notebook                                                                                                             | Everywhere | Free, familiar                                                            | No shared view, no limits, no alerts                                    |

The real competitor is the notebook. Mezgeb must be faster than writing for the merchant and free for the customer.

## Value proposition per party

| Party                         | Gets                                                                                                                                                                  | Gives up                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Merchant                      | Fewer disputes; faster entry by photo; polite automated pay-me requests; a view of total receivables and overdue customers; a digital record usable for future credit | A few seconds per sale; a subscription after the free tier |
| Customer                      | Real-time view of every entry; control over who can buy on their account; own spending limits; one place to report payments                                           | Nothing; always free                                       |
| Representative                | Buys without carrying cash; no app required (SMS receipt optional)                                                                                                    | Nothing                                                    |
| Future partners (banks, MFIs) | With consent only, verified receivables and repayment history for merchant and consumer credit                                                                        | Integration effort                                         |

## Business model and pricing

Merchants pay; customers never do; the credit itself carries no interest or fee. Prices below are proposed starting points in ETB per month, to be tested in the pilot.

| Plan      | Price (ETB/month) | Includes                                                                                 |
| --------- | ----------------- | ---------------------------------------------------------------------------------------- |
| Free      | 0                 | Up to 30 customers; manual entry; in-app notifications; 20 SMS a month                   |
| Shop      | 299               | Unlimited customers; AI photo capture; delivery orders; 300 SMS; statements              |
| Shop Plus | 699               | Everything in Shop; staff accounts with roles; multiple branches; data export; 1,000 SMS |

Later revenue lines, each opt-in and consent-based:

- **SMS bundles** above plan allowance, priced near cost.

- **Payment links** (telebirr, M-PESA, bank QR) inside pay-me requests, on a revenue share with the payment provider. Money still flows directly between customer and merchant accounts.

- **Credit referrals.** With the merchant's consent, a bank or MFI sees their receivables history and offers working capital; Mezgeb earns a referral fee. Mezgeb never lends.

- **Supplier-side ledger** for wholesalers selling to retailers on terms.

Open question: whether a bank (for example CoopBank) sponsors Mezgeb free for its merchants as an acquisition channel, replacing subscription revenue in that segment.

## Go-to-market

Growth is merchant-led and viral by design: each merchant invites 50 to 150 customers, and customers ask their other shops to join.

- **Seed merchants by hand.** Field agents sign up shops around condominium sites (Ayat, CMC, Gotera, Jemo) and enter the first customers with the owner.

- **Customer pull.** Every invite SMS carries "Ask your other shops to use Mezgeb"; a customer can nominate a shop, which receives an invite.

- **Condominium associations.** Present to building committees and guard supervisors; representatives are the hook for households with helpers.

- **Merchant associations and wholesalers.** Distributors visiting retailers onboard them during routes.

- **Bank partnership.** Offer Mezgeb free to a bank's merchant base in exchange for consented data access for credit later.

Language and channel: Amharic first, Afaan Oromo and English at launch; Android app, light web app for customers, SMS fallback for representatives without smartphones.

## Regulatory and legal position

Mezgeb's working assumption is that a record-keeping tool that neither holds funds nor extends credit sits outside NBE's lending and payment-instrument rules. This needs confirmation from counsel and, ideally, an informal NBE view before launch; it is not legal advice.

Design rules that keep it there:

- No funds held, pooled or moved by Mezgeb at any point; payments go directly from customer to merchant.

- No interest, late fees or penalties computed or displayed by the app.

- No credit decisioning or scoring by Mezgeb; limits are what the parties agree.

- Payment links, when added, open the provider's own flow (telebirr, M-PESA, bank app).

Triggers that would change the position: holding a float, charging for credit, offering financing, or selling data. Any of these needs a licensed partner.

Data protection: comply with Ethiopia's Personal Data Protection Proclamation (confirm number and regulator guidance with counsel). Store data in-country or in an approved region, collect consent at invite acceptance, let customers export and delete their data, and share with third parties only with explicit, revocable consent.

Evidential value: each entry is time-stamped, attributed and acknowledged, so a statement can support an informal settlement. Its weight in court is a question for counsel.

## KPIs and success metrics

Pilot targets are proposals to agree before launch.

| Metric                    | Definition                                            | Pilot target (week 12)           |
| ------------------------- | ----------------------------------------------------- | -------------------------------- |
| Active merchants          | Merchants recording 20+ entries a week                | 40 of 50                         |
| Customer activation       | Invited customers who open the app or web link        | 60%                              |
| Entries per merchant      | Weekly entries per active merchant                    | 150                              |
| Photo capture share       | Entries created via AI photo                          | 30%                              |
| Photo accuracy            | Line items accepted without edit                      | 85%                              |
| Payment confirmation time | Median hours from customer report to merchant confirm | Under 12 hours                   |
| Dispute rate              | Entries disputed by the customer                      | Under 2%                         |
| Days sales outstanding    | Average days from entry to settlement                 | 10% lower than baseline notebook |
| Merchant retention        | Merchants active in week 12 who were active in week 4 | 80%                              |
| Willingness to pay        | Merchants choosing a paid plan at pilot end           | 30%                              |

## Risks and mitigations

| Risk                                                  | Likelihood | Impact | Mitigation                                                                                  |
| ----------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------- |
| Entry is slower than the notebook, merchants drop off | High       | High   | Photo capture, favourites, last-basket repeat, voice entry later; measure seconds per entry |
| Customers never install the app                       | Medium     | Medium | Web link with no install; SMS receipts and monthly summary as fallback                      |
| Merchant edits entries after the fact                 | Medium     | High   | Append-only ledger; edits create a visible correction entry both sides see                  |
| Representative misuse                                 | Medium     | Medium | Per-representative limits, instant alerts to the account holder, one-tap revoke             |
| Regulator treats it as credit                         | Low        | High   | Design rules in the regulatory section; early NBE engagement                                |
| Poor connectivity at the counter                      | High       | Medium | Offline-first app; queue and sync; SMS fallback                                             |
| AI misreads items                                     | Medium     | Low    | Always shown for confirm before posting; learns the shop's catalogue and prices             |
| Data misuse fears                                     | Medium     | High   | Clear consent, no data sales, customer export and delete                                    |

## Roadmap and phases

The pilot is the critical phase: paid plans switch on only after pilot KPIs and willingness to pay are proven.

roadmap · 4 phases, 3 gates

Dates are proposals; each gate is a go or no-go review with the sponsor.
