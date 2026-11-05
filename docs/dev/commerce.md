# Commerce: gift cards, abandoned checkouts, order edits and returns, discounts

Wave 7a (coverage report P1-1 to P1-4). Schema: `packages/core/src/db/schema/wave7a.ts`, migration `0004_wave7a_commerce`.

## Gift cards (`services/gift-cards`)

- Tables `gift_cards` (code stored upper-case, 8-20 letters/digits; `token` for the public page; balance in minor units, CHECK `>= 0`) and `gift_card_transactions` (signed amounts; the sum is the balance).
- Checkout: `checkout_meta.gift_card_codes` holds the codes the buyer entered. `loadCheckout` returns `giftCards`, `giftCardTotal` and `amountDue` (total minus gift cards, a gift card never pays for gift card products). `submitCheckout` passes the allocation to `createOrder`, which debits every card atomically (`balance >= amount`, else the order is refused with `gift_card_unavailable`) and records one SUCCESS `SALE` transaction with gateway `gift_card` per card. The payment method collects `amountDue`; `amountDue = 0` needs no payment method and the order is PAID.
- Gift card products: a product flagged `isGiftCard` issues one card per unit when the order is paid (event `order.paid` -> job `giftcards.issue`, idempotent per order line). Recipient details come from the line properties `Recipient email`, `Recipient name` and `Message`. The `gift_card_issued` notification (EN/FR, editable) goes to the recipient, else the buyer; the job `gift-card-notifications` (every minute) sends cards that are due (manual cards with a recipient and `sendNotificationAt`).
- Storefront: `/gift_cards/:token` renders `templates/gift_card.liquid` (Aurora; `{% layout none %}`) with the Liquid `gift_card` object (`balance`, `initial_value` in minor units, `code` in groups of four, `last_characters`, `currency`, `enabled`, `expired`, `expires_on`, `message`, `recipient`, `customer`, `url`, `qr_identifier`). Shops installed before this wave get a minimal built-in page until the theme is updated.
- Admin API: `giftCards`, `giftCard`, `giftCardsCount`, `giftCardConfiguration`, `giftCardCreate/Update/Deactivate/Credit/Debit/SendNotificationToCustomer/SendNotificationToRecipient`. Search: `status:`, `balance_status:`, `source:purchased|manual`, `last_characters:`, `initial_value:`, `balance:`, `created_at:`, `expires_on:`. Admin: Products > Gift cards (`/gift-cards`).

## Abandoned checkouts (`services/abandoned.ts`)

- An abandoned checkout is a cart with an email and items, not completed, idle for the configured delay (`shops.settings.abandonedCheckouts = { enabled, delayHours: 1|6|10|24 }`, default off / 10 h). `checkout_meta` records the recovery emails sent.
- Job `abandoned-checkout-recovery` (every 10 minutes) emails each idle checkout once when enabled. Manual send: `shopmeAbandonedCheckoutRecoveryEmailSend(id)` (ShopMe extension). Settings: `shopmeAbandonedCheckoutSettings` / `shopmeAbandonedCheckoutSettingsUpdate`.
- The email (`abandoned_checkout` template) links to `/checkouts/:token/recover`, which sets the cart cookie and opens the checkout.
- Admin API: `abandonedCheckouts` (Shopify shape plus `shopmeEmail`, `shopmeRecoveryEmailsSent`), `abandonedCheckoutsCount`, `node(id:)`. Admin: Orders > Abandoned checkouts (`/orders/abandoned`).

## Order editing and returns (`services/order-edit.ts`, `services/returns.ts`)

- `orderEditBegin` creates (or reuses) an `order_edits` session; `orderEditAddVariant`, `orderEditSetQuantity` (`restock`), `orderEditAddLineItemDiscount` stage changes on the server; every response is the recalculated `CalculatedOrder` (`totalOutstandingSet`: positive = payment due, negative = refund owed). `orderEditCommit` rewrites quantities, discounted totals and tax per line, adds lines (priced with the checkout engine), commits or releases stock, recomputes the order totals, sets PARTIALLY_PAID when the new total exceeds what was paid, and records an `order.edited` event. It does not move money. Fulfilled units cannot be removed.
- Returns: `returnCreate` (OPEN) / `returnRequest` (REQUESTED) / `returnApproveRequest` / `returnClose`. `fulfillmentLineItemId` accepts a `LineItem` or `FulfillmentLineItem` id. ShopMe adds `shopmeRestock` on `ReturnLineItemInput` (default true): restocking happens when the return is closed. `Order.returns`, `Order.returnStatus`, `LineItem.shopmeReturnableQuantity`. Refunds stay separate (`refundCreate`, which has its own restock choice).
- Admin: order detail > Edit (`/orders/:id/edit`), "Return items" dialog, Returns card.

## Discounts (`services/discounts`, `services/pricing`)

- `discounts.kind = AUTOMATIC` discounts have no code and apply to every matching cart (cart, Ajax, Liquid and checkout). `discount_extensions` holds the subtype (`BASIC | FREE_SHIPPING | BXGY`), the combination rules and the BXGY configuration.
- Admin API: `discountAutomaticBasic/FreeShipping/Bxgy` create/update, `discountAutomaticActivate/Deactivate/Delete`, `automaticDiscountNode(s)`, `discountCodeBxgyCreate/Update`; `discountNodes` lists code and automatic discounts. Admin: type chooser (amount off products, buy X get Y, amount off order, free shipping) and a Method select (code or automatic).
- BXGY (`bxgyAmounts`): disjoint buy/get sets discount the cheapest eligible get units, X buy units per use; when the sets overlap every X+Y units discount the Y cheapest; `usesPerOrder` caps the number of uses.
- Combinations (`resolveCombinations`, deterministic): candidates are ranked by standalone savings (then lowest id) and kept when they combine with all kept ones; two discounts combine when each allows the other's class (product / order / shipping); discounts of the same class never combine, except product discounts that both allow it. Kept discounts apply product, then order, then shipping. A code that cannot combine is refused (`not_combinable`). Existing discounts default to "combines with nothing".
