# Customer accounts, customer privacy, customer events and store credit

How these features are built. Plans and Admin API names: `docs/spec/customer-privacy-accounts-events.md` and `docs/spec/store-credit.md`.

> **The region table is data to review, not legal advice.** `packages/core/src/services/privacy/regions.ts` lists which regions need opt-in
> consent, a notice, or the data-sale opt-out. It has a `PRIVACY_REGIONS_REVIEWED_AT` date that the admin shows. Laws change and which ones
> apply to a store is the merchant's responsibility. Check the table on every release and replace it with your own list (Settings, Customer
> privacy, Cookie banner, "Manual") if your lawyer says otherwise.

## Customer accounts

- Settings live in `shops.settings.customerAccounts` (`services/accounts/settings.ts`): mode `DISABLED | OPTIONAL | REQUIRED`, sign-in links,
  sign-in methods, order actions, custom URL. The store credit switch is `settings.storeCredit.enabled`.
- **One source of truth for "sign-in required".** `checkoutSettingsOf` derives `accountMode` from the accounts mode and
  `updateCheckoutSettings` writes it back (`required` is `REQUIRED`). Shops saved before this keep working: without a stored mode the legacy
  `checkout.accountMode` decides.
- `DISABLED`: an `onRequest` hook in the account routes answers 404 for every `/account*` path, `shop.customer_accounts_enabled` is false and
  checkout ignores the sign-in requirement. Hidden sign-in links only empty `routes.account_login_url` and `routes.account_register_url`.
- Email-code sign-in (`services/accounts/login-code.ts`): 6 digits, hash stored, 10 minutes, 5 attempts, a new code only after 30 s, rate limits
  per IP and per email in the routes. The customer is created (email verified) when the code is proven.
- Order actions (`services/accounts/order-actions.ts`): buy again, cancel an unfulfilled order within N hours of purchase (restocks and records the
  refund), request a return (a `REQUESTED` return that staff approve). Liquid gets `order.actions` and `customer_accounts`.

## Customer privacy

- Settings: `shops.settings.privacy` (`services/privacy/settings.ts`). The former `settings.cookieBanner.enabled` is read as banner mode `ALWAYS`.
  Manual consent rules are `consent_policies` rows. `policyFor` resolves country+region, country, default row, else "not required".
- **Consent resolution** is pure (`services/privacy/consent.ts`) and mirrored by the browser runtime: region (CDN header `CF-IPCountry` or
  `X-Vercel-IP-Country`, else the shop country), policy, `_shopme_consent` cookie (JSON, `v` bumps ask again), the customer's saved copy when
  newer, GPC (`Sec-GPC: 1`) as a refusal of data sale where the opt-out is required. A banner forced on (`ALWAYS`) works as opt-in everywhere;
  `OFF` treats everything as granted.
- Server-side tracking asks the same function: visits are counted only where analytics may run (`storefront/visits.ts`), `POST /.shopme/events`
  stores nothing without analytics consent.
- Data-sale opt-out: `/pages/data-sale-opt-out`, `customers.data_sale_opt_out`, footer link where the region requires it (`privacy.data_sale_opt_out_url`).
- Marketing consent: `customers.email_marketing_state` and level (`acceptsMarketing` stays in step), SMS columns, double opt-in
  (`subscribeEmail` -> `PENDING` + emailed link `/account/subscribe/confirm/:id/:token` -> `SUBSCRIBED`, `CONFIRMED_OPT_IN`).
- Not done: erasure job (`customerRequestDataErasure`), IP geolocation of our own, consent log export, per-market banner text.

## Customer events and pixels

The browser runtime is `apps/server/src/storefront/privacy-runtime.ts`, injected in the `<head>` of storefront and checkout pages with its
configuration (`<script type="application/json" id="shopme-privacy-config">`).

- `window.Shopify.customerPrivacy` (`currentVisitorConsent`, `shouldShowBanner`, `userCanBeTracked`, `analyticsProcessingAllowed`,
  `marketingAllowed`, `preferencesProcessingAllowed`, `saleOfDataAllowed`, `setTrackingConsent`) and `window.shopme.consent`.
  Events `visitorConsentCollected` and `trackingConsentAccepted` fire on `document`.
- Banner markup carrying `data-consent-*` attributes is wired by the runtime. Aurora ships `snippets/cookie-banner.liquid`; without it the
  runtime builds a plain banner.
- Event bus: `window.shopme.analytics.publish/subscribe` (alias `Shopify.analytics`). Standard events: `page_viewed`, `product_viewed`,
  `collection_viewed`, `search_submitted`, `product_added_to_cart` (patched `fetch` on `/cart/add`, classic form posts replay on the next page),
  `cart_viewed`, `checkout_started`, `checkout_completed` (published by the checkout pages). Up to 100 events are kept and replayed, original timestamp
  and id, to consumers whose consent arrives later.
- Custom pixels (`pixels` table, Settings, Customer events). Code is never inlined in pages: the runtime frames `/.shopme/pixels/:id` with
  `sandbox="allow-scripts"` (no `allow-same-origin`, null origin) only when every required category is allowed and, by default, the visitor did not
  opt out of data sale. The document is served with `Content-Security-Policy: sandbox allow-scripts`. Messages in (`init`, `event`), out (`ready`,
  `storage`, `error`). 20 errors disable the pixel for the page. Code limit 256 KB.
- First-party stream: the runtime batches standard events to `POST /.shopme/events` while analytics is allowed; `storefront_events` keeps 90 days.
- `webPixel*` store settings of an app pixel; running app pixels (an extension runtime) and server pixels are not built.

## Store credit

- Tables `store_credit_accounts` (cached balance), `store_credit_transactions` (CREDIT, DEBIT, DEBIT_REVERT, EXPIRATION) and
  `store_credit_allocations` (what a debit took). Rules in `services/store-credit/index.ts`: debits take the soonest-expiring credit first, every
  write locks the account row, the balance never counts expired credit, `expireStoreCredits` (job, every 15 minutes) is idempotent.
- **Checkout tender** (`services/store-credit/tender.ts`): `planStoreCredit` in `loadCheckout` after gift cards, `payWithStoreCredit` inside the
  order transaction in `createOrder`. Order of tenders: gift cards, store credit, the chosen payment method. A failed online payment reverts the
  debit (`recordPaymentFailure`).
- Refunds: `refundOrder({ storeCredit: { amount, expiresAt } })` (`refundMethods` in the API) and refunds of store-credit payments go back as
  credit (`ORDER_REFUND`, `ORDER_CANCELLATION` when cancelling).
- Liquid `customer.store_credit_account.balance` (nil when the feature is off or the balance is 0).
