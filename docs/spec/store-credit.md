# Store credit

Status: draft for implementation. API version studied: 2026-10. Names are listed for interoperability; behavior text is ours.
Admin screens were observed on our own development store (section 3.1).

## 1. Purpose

Give each customer a spendable balance held by the shop: merchants issue or remove credit, customers see it in their account and
pay with it at checkout, and refunds can be sent to it instead of the original payment method.

Existing in ShopMe: gift cards (`gift_cards`, `gift_card_transactions`, checkout redemption with gateway `gift_card`, see
docs/dev/commerce.md), refunds (`refunds`, `refund_lines`, `transactions`), customers and customer sessions. Store credit differs from
gift cards: it belongs to a customer (no code to share), can be issued with an expiry per grant, is optional per shop, and refunds can
create it.

## 2. Concepts

- **Store credit account**: one per (customer, currency). Created on first credit. Balance is the sum of the unspent, unexpired
  portions of its credits.
- **Transaction** kinds (`StoreCreditAccountTransaction` interface): **credit** (adds value, optional expiry), **debit** (spends or
  removes value), **debit revert** (cancels a debit, e.g. after a failed payment), **expiration** (removes the unspent remainder of a
  credit at its expiry).
- **System event** (`StoreCreditSystemEvent`): why the transaction exists: `ADJUSTMENT` (manual by staff or app), `ORDER_PAYMENT`
  (spent at checkout), `ORDER_REFUND` (refund to credit), `PAYMENT_FAILURE`, `PAYMENT_RETURNED`, `ORDER_CANCELLATION`,
  `TAX_FINALIZATION`, `RECURRING_PAYMENT`. We use ADJUSTMENT, ORDER_PAYMENT, ORDER_REFUND, ORDER_CANCELLATION and PAYMENT_FAILURE; the
  rest are accepted in the enum for compatibility.
- **Setting**: the store credit feature is on or off for the shop (`StoreCreditConfiguration.storeCreditEnabled`). Off hides credit from
  the storefront and checkout but keeps balances.

## 3. Merchant-facing behavior

### 3.1 Admin screens (observed)

**Customer detail page, right column, section "Store credit".** Under the tax details and above tags: the heading, a pencil icon button,
and the current balance or the word "None" when there is no account. A customer with accounts in several currencies lists one line per
currency (inferred).

**Dialog "Adjust store credit"** (opened by the pencil):
- Currency: a dropdown showing the shop currency (disabled when only one currency is possible; other currencies appear once markets
  with other currencies exist).
- Amount: decimal field with the currency code as suffix, starting at 0.00.
- "Set expiration date": caption explaining that local laws about expiring credit differ by country, and a date button whose label
  is "Does not expire" until a date is chosen (opens a calendar).
- "Notify customer": switch (on by default) with a sentence and a link to the notification template; sends an email.
- Buttons: Cancel and a primary "Issue credit", disabled until the amount is greater than zero.
The title says "adjust", so the dialog likely also lets staff remove credit (open question 1).

**Customer detail timeline**: each credit or debit adds an event ("Store credit of $10.00 issued by <staff>", expiry date if any); the
order page shows credit used as a payment line "Store credit" and refunds to credit as a refund line.

**Settings > Customer accounts**: a row "Store credit" with a switch ("let customers view and spend their store credit"); see
customer-privacy-accounts-events.md section 3.1. This is `storeCreditEnabled`.

**Order refund dialog** (existing page): gets a destination choice per refund: "Original payment method" or "Store credit" (amount,
optional expiry). Not captured (open question 2).

**Orders and reports**: order payment summary shows store credit as a payment method; analytics "sales" are unaffected (credit spending is
tender, not discount). Store credit liability report is later.

### 3.2 Rules

1. **Issue credit** (`storeCreditAccountCredit`): amount must be positive; currency must be an enabled currency; creates the account
   if the target is a customer id; `expiresAt`, if given, must be in the future; `notify` sends the email. Optional limit on the balance
   per shop setting (`CREDIT_LIMIT_EXCEEDED`, default no limit).
2. **Debit** (`storeCreditAccountDebit`): amount positive, same currency, not above the balance (`INSUFFICIENT_FUNDS`). Consumption order:
   credits that expire soonest first, credits without expiry last, ties oldest first (the allocation table records it).
3. **Expiry**: a job (every 15 minutes; idempotent) writes an expiration transaction for each credit whose `expires_at` passed and whose
   remainder is above zero. The balance excludes expired credit immediately even before the job runs.
4. **Checkout**: if the shop has credit enabled, the buyer is signed in, and an account exists in the cart currency with a positive balance,
   checkout shows a "Use store credit" line with the available amount and a checkbox, default checked when the balance covers anything.
   The applied amount = min(balance, amount due after discounts and gift cards). Order of tenders: gift cards, then store credit, then
   the remaining payment method. Shipping and taxes can be paid with credit. When the remainder is zero no payment method is needed
   (same as gift cards today). Guests see nothing; a signed-out buyer with an email that has credit is prompted to sign in (later).
5. **Placing the order** debits the account inside the order transaction (`ORDER_PAYMENT`, linking to the order transaction), and records an
   order transaction `SALE` with gateway `store_credit`. If the later payment fails and the order is not created, nothing is debited
   (the debit happens at order creation). If an order is created pending and later fails (async payment), a debit revert `PAYMENT_FAILURE`
   restores the credit with the original expiry.
6. **Refunds**: refunding a paid order lets the merchant pick store credit as a destination for any part of the refundable amount that
   was paid by card or other methods. Amounts refunded to the original tender that was store credit itself go back as credit with the
   original expiry rules (new credit with no expiry unless chosen; open question 3). The credit transaction is `ORDER_REFUND`, expires
   per the chosen date. Cancel and restock of an unfulfilled order paid with credit restores credit (`ORDER_CANCELLATION`).
7. **Currency**: credit in currency X is spendable only on carts in X; no automatic conversion.
8. **Notification**: template `store_credit_account_credit` (subject, body with amount, expiry, balance, link to account page); editable
   in Settings > Notifications like other templates (EN and FR defaults).
9. **Gift cards vs credit**: a gift card product cannot be bought with store credit (same rule as buying a gift card with a gift card today);
   configurable later.

## 4. Data model proposal (Drizzle)

```ts
export const storeCreditAccounts = pgTable('store_credit_accounts', {
  id: pk(), shopId: shopFk(),
  customerId: ref('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),   // owner; company locations later (ownerType)
  currency: text('currency').notNull(),
  balance: money('balance').notNull().default(0),          // cache: sum of remaining on unexpired credits; maintained in the same transaction
  ...timestamps(),
}, (t) => [uniqueIndex('store_credit_accounts_uq').on(t.shopId, t.customerId, t.currency), check('sc_balance_chk', sql`${t.balance} >= 0`)]);

export const storeCreditTransactions = pgTable('store_credit_transactions', {
  id: pk(), shopId: shopFk(),
  accountId: ref('account_id').notNull().references(() => storeCreditAccounts.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),                            // CREDIT | DEBIT | DEBIT_REVERT | EXPIRATION
  event: text('event').notNull().default('ADJUSTMENT'),    // StoreCreditSystemEvent
  amount: money('amount').notNull(),                       // positive magnitude, minor units
  balanceAfter: money('balance_after').notNull(),
  expiresAt: ts('expires_at'),                             // CREDIT only
  remaining: money('remaining'),                           // CREDIT only: unspent portion
  creditTransactionId: ref('credit_transaction_id'),       // EXPIRATION -> the expired credit
  debitTransactionId: ref('debit_transaction_id'),         // DEBIT_REVERT -> the reverted debit
  orderId: ref('order_id'), orderTransactionId: ref('order_transaction_id'),  // origin
  staffUserId: ref('staff_user_id'), note: text('note'),
  notified: boolean('notified').notNull().default(false),
  createdAt: createdAt(),
}, (t) => [index('sc_tx_account_idx').on(t.accountId, t.createdAt), index('sc_tx_expiry_idx').on(t.expiresAt)]);

export const storeCreditAllocations = pgTable('store_credit_allocations', {   // which credits a debit consumed
  debitTransactionId: ref('debit_transaction_id').notNull().references(() => storeCreditTransactions.id, { onDelete: 'cascade' }),
  creditTransactionId: ref('credit_transaction_id').notNull().references(() => storeCreditTransactions.id, { onDelete: 'cascade' }),
  amount: money('amount').notNull(),
}, (t) => [primaryKey({ columns: [t.debitTransactionId, t.creditTransactionId] })]);
```

Shop setting: `shops.settings.storeCredit = { enabled: boolean, creditLimit?: number }`. Orders: payment gateway string `store_credit`
on `transactions`; `orders.total_store_credit` is derived. Checkout: `checkout_meta.store_credit_amount` (the buyer's checkbox and
amount applied) next to `gift_card_codes`. Concurrency: debits lock the account row (`select ... for update`), then credits ordered for
allocation; every write updates `balance` and the transaction's `balanceAfter` in one transaction.

## 5. Admin GraphQL surface

### 5.1 Types (MVP)
`StoreCreditAccount` (id, balance: MoneyV2, owner: `HasStoreCreditAccounts` (Customer implements it), transactions(connection, sortKey
`CREATED_AT`, query)), interface `StoreCreditAccountTransaction` (account, amount, balanceAfterTransaction, createdAt, event, origin), with
objects `StoreCreditAccountCreditTransaction` (also id, expiresAt, remainingAmount), `StoreCreditAccountDebitTransaction` (id),
`StoreCreditAccountDebitRevertTransaction` (id, debitTransaction), `StoreCreditAccountExpirationTransaction` (creditTransaction);
`StoreCreditAccountTransactionOrigin` union (`OrderTransaction`); `StoreCreditConfiguration { storeCreditEnabled }`;
`StoreCreditSystemEvent` enum; `Customer.storeCreditAccounts(first, query)` and `StoreCreditAccountConnection`. Amounts are `MoneyV2`
(decimal string plus `currencyCode`) as everywhere in the API.

### 5.2 Root fields
`storeCreditAccount(id)` and `storeCreditConfiguration` (MVP). Transaction search `query` filters: `created_at`, `event`, `type`
(credit, debit, ...), `order_id`.

### 5.3 Mutations
MVP: `storeCreditAccountCredit(id: ID!, creditInput: StoreCreditAccountCreditInput!)` with `StoreCreditAccountCreditInput { creditAmount:
MoneyInput!, expiresAt: DateTime, notify: Boolean = false }`, returning `StoreCreditAccountCreditPayload { storeCreditAccountTransaction
userErrors }`; `storeCreditAccountDebit(id: ID!, debitInput: StoreCreditAccountDebitInput!)` with `StoreCreditAccountDebitInput { debitAmount:
MoneyInput! }`. The `id` accepts a store credit account id or a customer id (the credit form of an unknown account for a customer
creates the account in the given currency; the debit form does not). Refund: extend `refundCreate` input `RefundInput.refundMethods:
[RefundMethodInput { storeCreditRefund: StoreCreditRefundInput { amount: MoneyInput!, expiresAt: DateTime } }]` (also `refund` preview types);
orders can also show `StoreCreditRefund` in refund methods. Scopes: `read_store_credit_accounts`, `write_store_credit_account_transactions`
(add to scope list; map to the "customers" admin area for staff).
Later: configuration mutation (the setting is toggled in the admin UI through a ShopMe field `shopmeStoreCreditConfigurationUpdate`),
company-location owners, bulk credit via CSV.

### 5.4 userErrors
Credit: `StoreCreditAccountCreditUserError` codes `ACCOUNT_NOT_FOUND`, `OWNER_NOT_FOUND`, `NEGATIVE_OR_ZERO_AMOUNT`, `MISMATCHING_CURRENCY`
(the account currency differs from the amount currency), `EXPIRES_AT_IN_PAST`, `CREDIT_LIMIT_EXCEEDED`, `UNSUPPORTED_CURRENCY`.
Debit: `ACCOUNT_NOT_FOUND`, `NEGATIVE_OR_ZERO_AMOUNT`, `INSUFFICIENT_FUNDS`, `MISMATCHING_CURRENCY`. Refund-related errors reuse
`RefundCreateUserError`-style messages (`STORE_CREDIT_REFUND_MISSING_CUSTOMER`, `STORE_CREDIT_REFUND_EXPIRATION_IN_PAST`,
`NO_REFUND_TO_STORE_CREDIT_PERMISSION`; look up the exact payload type when implementing).

MVP vs later: MVP covers accounts, credit/debit with expiry and notify, expiry job, checkout payment, refund to credit, customer page UI,
account page balance, setting toggle. Later: company owners, balance limits UI, reports, SMS, storefront API.

## 6. Liquid and storefront impact

- `customer.store_credit_account` object (`balance` money in the account currency; nil when the feature is off, the customer has no
  account, or balance is 0; `customer.store_credit_accounts` array for several currencies, later). Classic account pages show "Store credit
  balance: {{ customer.store_credit_account.balance | money }}" in the default theme's account template.
- Checkout page template (ours, not theme-controlled): "Store credit" tender row, applied amount, remaining balance; order confirmation
  and order status pages list "Store credit" as a payment line; emails (`order_confirmation`) include it in the payment summary.
- `/account` JSON data and the customer account API are not covered. A page `/account/store-credit` (transactions list) is later.
- `order.transactions[].gateway` is `store_credit`, `payment_details` empty; `order.total_net_amount`/`total_paid` count it as paid.
- Cart: `/cart.js` does not show credit; checkout only.

## 7. Edge cases

- Credit with expiry spent partially: the remainder expires at the date; the expiration transaction amount = remainder.
- Two credits expiring on the same day: oldest first.
- Debit revert restores to the original credits using the allocation rows (respecting still-valid expiries; an expired original becomes
  an immediate expiration pair is not recorded, just not restored: record a revert for the unexpired part only).
- Refund to credit larger than what was paid is rejected; partial refunds to credit and original method can combine.
- Customer merge/delete: accounts follow merge (balances sum per currency); deleting a customer with credit is refused until zero.
- Taxes: crediting is not taxable income here; reporting of liability is the merchant's duty (note in docs).
- Rounding: all minor units; no fractions.
- Draft orders and POS-like flows: draft orders can use credit as a payment later; MVP is checkout only.
- Concurrent checkouts spending the same credit: second fails at order creation with the existing "payment tender unavailable" error and
  the buyer is returned to the payment step with the new balance.
- Shop disables the feature: balances are retained; Admin API reads and manual adjustments keep working, checkout ignores credit.
- Expiry timestamps are stored in UTC, shown in the shop time zone, expiring at the end of the chosen day in that zone.

## 8. Test plan

- Unit: allocation order, partial spend across credits, expiry job idempotence, debit revert, balance cache vs recomputed sum.
- Service: concurrency (parallel debits), insufficient funds, currency mismatch, limit.
- API conformance: credit/debit payload shapes, `storeCreditAccount.transactions` pagination and union types, user error codes, refund
  with `refundMethods`.
- Checkout: full coverage by credit (no payment method), partial with card, with gift card plus credit plus card, cancel and restock.
- Admin UI: customer page section, dialog validation (disabled button, expiry picker, notify email sent), timeline entries.
- Emails: template rendering with and without expiry.

## 9. Open questions (captures still needed)

Observed: customer sidebar section, "Adjust store credit" dialog, the Customer accounts toggle.
1. **Debit/removal UI**: after credit exists, what the pencil dialog offers (a tab/radio for "remove credit", separate button?) and the
   customer page layout with a non-zero balance (several currencies, list of transactions or link).
2. **Refund dialog** on an order: the destination selector for store credit (labels, expiry field, which customers qualify).
3. What happens when a store-credit-paid order is refunded to "original method" (is it returned as credit with or without expiry).
4. **Checkout view** of an account holder with credit (the tender row wording and default checked state).
5. The "Store credit" notification template in Settings > Notifications (subject and variables).
6. The "Other actions" menu on the customer page (does it hold a credit-related item).
