# Customer accounts settings, customer privacy and customer events

Status: draft for implementation. API version studied: 2026-10. Names are listed for interoperability; behavior text is ours.
Admin screens were observed on our own development store (section 3.1). Three settings pages are specified together because they
share one consent model.

## 1. Purpose

1. **Customer accounts settings**: whether accounts are required, optional or off; which sign-in methods exist; where sign-in links
   appear; what customers may do with past orders; whether store credit is visible; the account URL.
2. **Customer privacy**: which visitors must be asked for cookie/tracking consent (by region), the cookie banner, the data-sale opt-out
   page and flag, privacy policy links, marketing consent collection at checkout.
3. **Customer events**: a first-party stream of storefront and checkout events delivered, only with the right consent, to analytics
   pixels (merchant-pasted scripts and later installable pixel extensions).

Existing in ShopMe: customer accounts (register, login with password, reset, order history, addresses; `sessions.kind = 'customer'`),
`customers.acceptsMarketing`, policies editor (`services/legal.ts`, `shops.settings.policies`), a basic cookie banner
(`shops.settings.cookieBanner = { enabled, message }`, Liquid/HTML injection), customer data export, visits analytics (`visits`),
`POST /contact` and newsletter forms, notification templates. Missing: requirement modes, email-code sign-in, region rules, consent
state and API, data-sale opt-out, marketing consent states, pixels and event bus, privacy API.

## 2. Concepts

- **Accounts mode**: `DISABLED` (no sign-in, guest checkout only), `OPTIONAL` (default), `REQUIRED` (checkout needs sign-in or sign-up).
  Matches `ShopCustomerAccountsSetting`. `CustomerAccountsV2` fields (`customerAccountsVersion`, `loginLinksVisibleOnStorefrontAndCheckout`,
  `loginRequiredAtCheckout`, `url`) are exposed too; ShopMe has one account system, version `NEW_CUSTOMER_ACCOUNTS` is reported.
- **Sign-in methods**: `password` (existing) and `email_code` (one-time numeric code sent by email, no password). At least one must be on.
- **Consent categories**: `analytics`, `marketing`, `preferences`, `sale_of_data`. First three are opt-in categories; `sale_of_data` is an
  opt-out flag (allowed unless the visitor opts out).
- **Consent policy** (`ConsentPolicy`): for a region (country code, optional region/state code), `consentRequired` (opt-in banner needed
  before tracking) and `dataSaleOptOutRequired` (an opt-out mechanism must be offered). "Automated" mode means ShopMe uses a built-in
  region table (data file kept in the repo and reviewed on release; not legal advice); "manual" mode means the merchant's list of
  `ConsentPolicy` rows applies.
- **Pixel**: a script that subscribes to customer events. Kinds: `CUSTOM` (merchant-pasted JavaScript), `APP` (installed extension with
  JSON settings; `WebPixel` in the API), `SERVER` (events forwarded to an HTTPS endpoint; `ServerPixel`). Each pixel declares required
  consent categories.
- **Customer event**: a named object with `id`, `name`, `timestamp`, `clientId`, `type` (`standard` or `dom`), `context` (document location,
  user agent, screen size, locale, currency) and `data`.

## 3. Merchant-facing behavior

### 3.1 Admin screens (observed)

All three pages sit under Settings (left settings menu: Customer accounts, Customer events, Customer privacy, Policies...).

**Settings > Customer accounts.** Page title, then two groups.
- "Sign-in links": one row with an icon, title "Show sign-in links", a sentence ("in the online store header and at checkout") and an
  on/off switch (on by default) = `loginLinksVisibleOnStorefrontAndCheckout`.
- "Customer accounts" (info icon): a first card with two rows, each with a small right-hand button:
  *Configuration* ("configure apps, brand image and features for checkout and customer accounts"; button "Customize", opens the
  customer-account editor; ours: a page for logo/colors/text of account pages, later), and *Order actions* ("let customers reorder,
  return items or cancel orders; set conditions with return and cancellation rules"; button "Manage", opens toggles: reorder, request
  return, request cancellation, and a link to the returns rules page). A second card with three rows: *Authentication* ("manage sign-in
  methods and account access"; button "Manage": password / email code, and the requirement mode; not captured), *Store credit* ("let customers
  see and spend their store credit"; on/off switch, see store-credit.md), *URL* ("use this URL wherever you want customers to reach their
  account"; button "Manage" for a custom domain or path) with the account URL shown in a grey read-only box below.

**Settings > Customer privacy.** Title "Customer privacy"; sections:
- "Privacy settings": a card of three rows, each with an icon, title, status sentence, an "Automated" badge with a green dot, and a chevron:
  *Privacy policy* ("published on your online store"), *Cookie banner* ("not required for the regions where you sell"), *Data-sale opt-out
  page* ("active in California, Colorado and 13 other states"). Each row opens its own page (policy editor/generator; banner settings; opt-out
  page settings). The badge turns to "Manual"/"Off" when the merchant overrides.
- A card for a network-wide data-sharing programme with an "On" badge and a "Turn off" button (not applicable to ShopMe; omit).
- "Marketing settings" (info icon): two rows with chevrons: *Email and SMS marketing at checkout* ("ask customers for their marketing
  preferences": opens options for the checkbox shown at checkout, default checked or not, which channels) and *Double opt-in for marketing*
  ("ask customers to confirm their details": sends a confirmation email before `SUBSCRIBED`).
- "Data storage location": a card with a flag and the country where data is hosted (read-only; ShopMe self-hosted shows the server region
  from config, or "Self-hosted"). A footnote says recommended settings are provided for convenience and legal compliance remains the merchant's
  responsibility with a link to learn more.

**Settings > Customer events.** Title "Customer events"; section "Pixels" (info icon); the card is empty with an illustration, headline "This
is where you will manage your pixels", a sentence ("collect customer events with app pixel integrations or custom pixels") and two buttons:
"Add custom pixel" (secondary) and "Explore pixel apps" (primary). Both buttons are repeated at the top right of the page. A link at the bottom:
"Learn more about pixels". With pixels present (inferred): a list with name, type badge (Custom, App), status (Connected / Disconnected), consent
requirement summary, and a row menu (view code, connect/disconnect, edit, delete). The custom pixel form: name, code editor, "Customer privacy"
section (required permissions: none/analytics/marketing/preferences and "data sale" setting), Save, Connect.

### 3.2 Accounts behavior

- Mode `DISABLED`: `/account*` routes return 404 (the existing `account` links disappear), checkout is guest only, `customer` is nil.
- `OPTIONAL`: checkout offers "sign in", create account is a checkbox/after-purchase email invite.
- `REQUIRED`: visiting checkout without a session redirects to `/account/login?checkout_url=...`; after sign-in the cart merges and returns.
  Guest orders are impossible (draft orders and Admin API unaffected).
- Sign-in links visibility toggles `{{ shop.customer_accounts_enabled }}`-gated links in themes via `routes.account_login_url` being present
  or not, and the checkout "Sign in" link. When off, routes still exist (if mode is not DISABLED) but are not linked.
- Email-code sign-in: user enters email; server sends a 6-digit code valid 10 minutes, 5 attempts, resend after 30 s; success creates or finds
  the customer and the session. Rate limit by IP and email. Password remains when enabled; users with password can still request a reset.
- Order actions: toggles feed account order pages: "Buy again" (adds lines to cart), "Request return" (existing returns service creates a return
  request when eligible), "Request cancellation" (unfulfilled orders only, creates a request visible to staff). All off by default except reorder.
- Account URL: `/account` on the primary domain; a custom value is a path or an absolute URL redirect (later).
- Account invites: `customerSendAccountInviteEmail`, `customerGenerateAccountActivationUrl` exist in the API (the notification templates for
  account welcome and invite are a known gap in the coverage report); this spec adds the sending flow.

### 3.3 Consent resolution (storefront)

1. Determine the visitor's region: market country (markets.md 3.2) else IP geolocation if enabled else shop country.
2. Look up the policy: manual rows first (country+region, then country, then default), else the built-in table, else "not required".
3. Compute state:
   - not required: `analytics`, `marketing`, `preferences` are treated as granted (implicit), `sale_of_data` allowed unless the visitor
     opted out;
   - required: all three denied until the visitor consents through the banner; `sale_of_data` follows the opt-out when
     `dataSaleOptOutRequired`.
4. Persist the choice in the first-party cookie `_shopme_consent` (JSON: version, analytics, marketing, preferences, saleOfData, region,
   timestamp; 12 months). For signed-in customers store a copy on the customer (`customers.consent` jsonb) and restore it on login.
5. Banner: shown when consent is required and no valid cookie exists, or when the merchant forces it (mode `ALWAYS`); buttons Accept all,
   Decline, Manage (category toggles). Text, colors, position are settings; text translatable. Mode `OFF` hides it and treats consent as
   granted (the merchant owns the legal risk; the admin shows a warning).
6. Everything consent-sensitive checks the state: visits analytics (store a visit only with analytics consent, otherwise count anonymously
   without identifiers), pixels, cart attributes written by tracking scripts, marketing cookies (`_fbp`-like are the pixels' business).
7. Data-sale opt-out: page `/pages/data-sale-opt-out` (auto-created content when the feature is automated; a form with email; when submitted
   marks the matching customer `data_sale_opt_out = true` and sets the cookie flag) and a footer link "Do not sell or share my personal
   information" shown in regions where required. `Customer.dataSaleOptOut` is exposed; exports and event forwarding (`SERVER` pixels, third-party
   apps) exclude opted-out customers' identifiers. Honors the browser opt-out signal header `Sec-GPC: 1` as an opt-out in regions where required.

### 3.4 Customer events stream

- The storefront layout includes (through `{{ content_for_header }}`) the ShopMe runtime script and, for each connected pixel allowed by
  consent, a sandbox frame. Events are published once on an in-page bus and delivered to pixels in order. Pixels never see events before
  their required consent exists; events published before consent can be replayed after (only those created while the page was open, max 100,
  newest wins), with their original timestamp.
- Standard events (names kept for compatibility): `page_viewed`, `product_viewed`, `collection_viewed`, `search_submitted`,
  `product_added_to_cart`, `product_removed_from_cart`, `cart_viewed`, `checkout_started`, `checkout_contact_info_submitted`,
  `checkout_address_info_submitted`, `checkout_shipping_info_submitted`, `payment_info_submitted`, `checkout_completed`. DOM events:
  `clicked`, `form_submitted`, `input_focused`, `input_blurred`, `input_changed` (opt-in per pixel). Custom events: `shopme.publish(name, data)`
  from theme code (compat alias `Shopify.analytics.publish`).
- Event payload fields mirror the standard (data.cartLine, productVariant { id, title, price {amount, currencyCode}, product {title, id, vendor,
  type}, sku, image }, checkout { token, currencyCode, totalPrice, lineItems, shippingLine, order { id } ... }); documented in a separate
  reference when implemented.
- Pixel runtime API available to pixel code: `analytics.subscribe(name, handler)` (also `'all_events'`), `init` (initial context: customer
  { id, email hash, ordersCount }, cart, shop), `browser.cookie.get/set`, `browser.localStorage.*`, `browser.sessionStorage.*` (async),
  `settings` (APP pixels). Execution is sandboxed in a null-origin iframe (no parent DOM access) so a pixel cannot read the page; network is
  free, as in browsers.
- First-party storage: when `analytics` consent is granted (or implicit), selected events are recorded server-side by `POST /.shopme/events`
  (batched, rate limited) into `storefront_events` for the built-in analytics (conversion funnel); retention 90 days. Without consent, only
  aggregate counters are updated.
- Server pixels: for `SERVER` kind, the server forwards events to a configured HTTPS endpoint with an HMAC signature header (like webhooks)
  only when the visitor consented to marketing/analytics as configured.
- Checkout events are published from our checkout pages (they are first-party), so pixels see the same events on both storefront and checkout.

## 4. Data model proposal (Drizzle)

```ts
// Accounts settings (shop.settings.customerAccounts, validated by zod), default:
// { mode: 'OPTIONAL', loginLinksVisible: true, signIn: { password: true, emailCode: false },
//   orderActions: { reorder: true, returns: false, cancellations: false }, storeCredit: false, url: null }

export const customerLoginCodes = pgTable('customer_login_codes', {
  id: pk(), shopId: shopFk(), email: text('email').notNull(), codeHash: text('code_hash').notNull(),
  attempts: integer('attempts').notNull().default(0), expiresAt: ts('expires_at').notNull(), consumedAt: ts('consumed_at'), createdAt: createdAt(),
}, (t) => [index('customer_login_codes_email_idx').on(t.shopId, t.email)]);

export const consentPolicies = pgTable('consent_policies', {          // manual rules (ConsentPolicy)
  id: pk(), shopId: shopFk(),
  countryCode: text('country_code'),                        // null = default for all
  regionCode: text('region_code'),                          // e.g. 'CA' for California when countryCode = 'US'
  consentRequired: boolean('consent_required').notNull().default(false),
  dataSaleOptOutRequired: boolean('data_sale_opt_out_required').notNull().default(false),
}, (t) => [uniqueIndex('consent_policies_uq').on(t.shopId, t.countryCode, t.regionCode)]);
// shop.settings.privacy = { mode: 'AUTO'|'MANUAL', cookieBanner: { mode: 'AUTO'|'ALWAYS'|'OFF', message, position, style },
//   dataSaleOptOutPage: 'AUTO'|'OFF', marketingAtCheckout: { enabled, channels: ['EMAIL','SMS'], prechecked }, doubleOptIn: boolean }
// Built-in region table: packages/core/src/data/privacy-regions.json  { "consentRequired": [...], "dataSaleOptOut": [...] }

// customers: add columns
//   dataSaleOptOut: boolean default false; consent: jsonb (last consent state);
//   emailMarketingState / emailMarketingOptInLevel / emailMarketingUpdatedAt; smsMarketingState / smsMarketingOptInLevel / smsMarketingUpdatedAt / smsMarketingCollectedFrom
//   (acceptsMarketing stays as derived: emailMarketingState = SUBSCRIBED)

export const pixels = pgTable('pixels', {
  id: pk(), shopId: shopFk(), kind: text('kind').notNull(),   // CUSTOM | APP | SERVER
  name: text('name').notNull(), code: text('code'),            // CUSTOM source
  settings: jsonb('settings').notNull().default({}),           // APP settings JSON; SERVER { endpointUrl, secret }
  connected: boolean('connected').notNull().default(false),
  requiredConsent: text('required_consent').array().notNull().default([]),   // subset of analytics|marketing|preferences
  respectSaleOptOut: boolean('respect_sale_opt_out').notNull().default(true),
  domEvents: boolean('dom_events').notNull().default(false),
  ...timestamps(),
});
export const storefrontEvents = pgTable('storefront_events', {   // first-party stream, analytics consent only
  id: pk(), shopId: shopFk(), name: text('name').notNull(), clientId: text('client_id'), customerId: ref('customer_id'),
  data: jsonb('data'), context: jsonb('context'), occurredAt: ts('occurred_at').notNull(), createdAt: createdAt(),
}, (t) => [index('storefront_events_idx').on(t.shopId, t.name, t.occurredAt)]);
```

Existing `shops.settings.cookieBanner` migrates into `settings.privacy.cookieBanner` (enabled true becomes mode `ALWAYS`, false becomes
`AUTO`). Existing `acceptsMarketing = true` customers become email state `SUBSCRIBED`, opt-in `UNKNOWN`, updated at the customer's last update.

## 5. Admin GraphQL surface

### 5.1 Accounts
`Shop.customerAccounts: ShopCustomerAccountsSetting! (REQUIRED, OPTIONAL, DISABLED)` and `Shop.customerAccountsV2: CustomerAccountsV2!
{ customerAccountsVersion, loginLinksVisibleOnStorefrontAndCheckout, loginRequiredAtCheckout, url }` (read-only in the reference API;
ShopMe adds `shopmeCustomerAccountsSettingsUpdate(input)` with mode, links, signIn methods, order actions, store credit toggle).
Existing customer mutations keep: `customerSendAccountInviteEmail(customerId, email)`, `customerGenerateAccountActivationUrl(customerId)`
(new, MVP), `customerRequestDataErasure(customerId)` (new, MVP: anonymizes after the retention rules; uses a job; scope `write_customers`).
Errors: `CustomerSendAccountInviteEmailUserError` codes `INVALID`; data erasure `CustomerRequestDataErasureUserError` codes `DOES_NOT_EXIST`,
`FAILED`.

### 5.2 Privacy
Types: `ConsentPolicy` (id, shopId, countryCode `PrivacyCountryCode`, regionCode, consentRequired, dataSaleOptOutRequired),
`ConsentPolicyRegion` (countryCode, regionCode), `PrivacySettings { banner { enabled autoManaged translations } dataSaleOptOutPage
{ autoManaged } privacyPolicy { autoManaged supportedLocales } }`, `CookieBanner`, `DataSaleOptOutPage`, `PrivacyPolicy`,
`Customer.dataSaleOptOut: Boolean!`. Roots: `privacySettings`, `consentPolicy(id, countryCode, regionCode, consentRequired,
dataSaleOptOutRequired)`, `consentPolicyRegions`. Mutations: `consentPolicyUpdate(consentPolicies: [ConsentPolicyInput {countryCode,
regionCode, consentRequired, dataSaleOptOutRequired}!]!)` returning `updatedPolicies` and `ConsentPolicyError` codes
`COUNTRY_CODE_REQUIRED`, `REGION_CODE_REQUIRED`, `REGION_CODE_MUST_MATCH_COUNTRY_CODE`, `SHOPIFY_COOKIE_BANNER_NOT_DISABLED` (we map: the
built-in banner must be set to manual/off before custom banners can be authoritative), `UNSUPORTED_CONSENT_POLICY` (spelling as in the
schema); `privacyFeaturesDisable(featuresToDisable: [PrivacyFeaturesEnum!]!)` (COOKIE_BANNER, DATA_SALE_OPT_OUT_PAGE, PRIVACY_POLICY);
`dataSaleOptOut(email: String!)` returning `customerId` and `DataSaleOptOutUserError` code `FAILED`.
Policies: `ShopPolicy` (id, type, title, body, url, createdAt, updatedAt, translations), `shopPolicyUpdate(shopPolicy: {type, body})`
(exists; extend `ShopPolicyType` with `TERMS_OF_SALE`, `LEGAL_NOTICE`, `SUBSCRIPTION_POLICY`; codes `TOO_BIG`), `Shop.shopPolicies`.
Marketing consent: `Customer.emailMarketingConsent { marketingState, marketingOptInLevel, consentUpdatedAt }`, `Customer.smsMarketingConsent`,
`customerEmailMarketingConsentUpdate(input)`, `customerSmsMarketingConsentUpdate(input)` with enums `CustomerEmailMarketingState` (NOT_SUBSCRIBED,
PENDING, SUBSCRIBED, UNSUBSCRIBED, REDACTED, INVALID), `CustomerSmsMarketingState` (NOT_SUBSCRIBED, PENDING, SUBSCRIBED, UNSUBSCRIBED,
REDACTED), `CustomerMarketingOptInLevel` (SINGLE_OPT_IN, CONFIRMED_OPT_IN, UNKNOWN), `CustomerMarketingConsentState` (NEVER_SUBSCRIBED, PENDING,
SUBSCRIBED, UNSUBSCRIBED, REDACTED), `CustomerConsentCollectedFrom` (SHOPIFY becomes `SHOPME` internally but serializes as `SHOPIFY` for
compatibility, OTHER). Error codes `INVALID`, `INCLUSION`, `INTERNAL_ERROR`, `MISSING_ARGUMENT`.

### 5.3 Events
`WebPixel { id settings }`, `ServerPixel { id status webhookEndpointAddress }` with `ServerPixelStatus` (CONNECTED, DISCONNECTED_UNCONFIGURED,
DISCONNECTED_CONFIGURED). Roots `webPixel(id)`, `serverPixel`. Mutations: `webPixelCreate(webPixel: {settings: JSON})`, `webPixelUpdate(id,
webPixel)`, `webPixelDelete(id)`, `serverPixelCreate`, `serverPixelDelete` with `ErrorsWebPixelUserErrorCode` (BLANK, TAKEN, NOT_FOUND,
INVALID_SETTINGS, UNABLE_TO_DELETE, NO_EXTENSION, INVALID_CONFIGURATION_JSON, INVALID_SETTINGS_DEFINITION, UNEXPECTED_ERROR,
INVALID_RUNTIME_CONTEXT). Custom (merchant-pasted) pixels have no Admin API in the reference schema, so ShopMe adds
`shopmeCustomPixels`, `shopmeCustomPixelCreate/Update/Delete/Connect/Disconnect` (input: name, code, requiredConsent, respectSaleOptOut,
domEvents). Scopes: `read_pixels`, `write_pixels`, `read_customer_events` (new) and `read_privacy_settings`, `write_privacy_settings`.

MVP vs later:
- MVP: accounts mode and sign-in links, email-code sign-in, order action toggles, consent policy table + resolution + cookie banner v2, consent
  JS API, data-sale opt-out page and flag, marketing consent states and double opt-in, privacy admin pages, event bus with custom pixels,
  `storefront_events` stream and API above.
- Later: app pixels (extension runtime), server pixels, customer-account editor, custom account URL, geolocation, consent log export, per-market
  banner text, GPC for non-US regions.

## 6. Liquid and storefront impact

- Liquid: `shop.customer_accounts_enabled` and `shop.customer_accounts_optional` booleans (from the mode); `routes.account_login_url`,
  `routes.account_register_url` present only when mode is not DISABLED and login links are on; `customer.accepts_marketing` (derived) and
  `customer.email_marketing_state`, `customer.sms_marketing_state` (ShopMe additions); policies: `shop.privacy_policy`, `shop.refund_policy`,
  `shop.terms_of_service`, `shop.shipping_policy` unchanged, plus `shop.terms_of_sale`, `shop.legal_notice`, `shop.subscription_policy`
  (new) and the `policies` array. `{{ content_for_header }}` now emits the consent runtime, banner container and pixel loader.
- JS globals for theme compatibility: `window.Shopify.customerPrivacy` with `currentVisitorConsent()` (returns analytics/marketing/preferences
  /sale_of_data as the strings `'yes'`, `'no'`, `''`), `shouldShowBanner()`, `userCanBeTracked()`, `analyticsProcessingAllowed()`,
  `marketingAllowed()`, `preferencesProcessingAllowed()`, `saleOfDataAllowed()`, `setTrackingConsent({analytics, marketing, preferences,
  sale_of_data, headlessStorefront?}, callback)`, and events `visitorConsentCollected`, `trackingConsentAccepted`. Also `window.shopme.consent` with
  the same data. Themes can render their own banner by calling `setTrackingConsent`.
- Sections: the default theme gets a footer "Do not sell or share my personal information" link (visible via `request.privacy_flags`
  or a Liquid object `shop.data_sale_opt_out_required`, ShopMe addition) and a consent banner container; Aurora gets the new banner styles.
- Account pages: `customer` unchanged; store credit and order actions render per 3.2; the login template gets a second flow for email code
  (form `customer_login` with `login_method`; email-code uses `customer.code` path), compatible forms: `{% form 'customer_login' %}` stays.
- Newsletter and contact forms respect double opt-in: `POST /contact#newsletter` creates PENDING and sends a confirmation link.
- `/cart` and AJAX unchanged. Pages `/policies/<handle>` unchanged; add `/policies/terms-of-sale` etc.
- `GET /.shopme/consent.json` returns resolved consent state and banner config for headless storefronts.

## 7. Edge cases

- Visitor changes country: re-resolve; consent granted in a "required" region stays valid, a denial in a not-required region does not
  retroactively block.
- Shared cookie versioning: bump `v` when policy categories change to re-ask.
- Signed-in customer consent on another device: customer copy wins if newer.
- Do-not-track and GPC: GPC maps to opt-out of sale (US regions), not to analytics denial.
- Pixels added with all categories empty run for everyone (explicit warning in the form).
- Event replay: only events from this page load, never from stored history; duplicates are suppressed by event id.
- Large pixel scripts: limit 256 KB; scripts executing too long (>1 s per event) are logged and the pixel disabled after 20 failures.
- Checkout pages are not themeable, so banner/pixel injection there is ours; ensure no third-party script on checkout besides pixels in sandbox.
- Erasure request: customer record kept as anonymous stub if it has orders (legal retention), personal data removed; job result visible in admin.
- Account mode switch to REQUIRED with open guest carts: carts are kept; checkout asks to sign in/up.
- Email-code abuse: lock after 5 failures per code, 20 per hour per IP.
- Policy generator ("Automated" privacy policy) is a template with shop data filled in; flagged as a template, not legal advice.
- Region table drift: ship it as versioned data; admin shows "last reviewed" date.

## 8. Test plan

- Unit: region policy lookup precedence (country+region > country > default; manual vs auto), consent state computation, cookie encode/decode
  and versioning, opt-out via GPC.
- Service: email-code sign-in (expiry, attempts, rate limits), accounts mode behaviors on routes and checkout, marketing consent transitions
  incl. double opt-in, data sale opt-out marking and event filtering, erasure job.
- API conformance: `consentPolicy*`, `privacySettings`, `dataSaleOptOut`, marketing consent mutations (errors), `shopPolicyUpdate` new types,
  `webPixel*`, custom pixel extension mutations; scopes enforced.
- Storefront: banner display rules, `Shopify.customerPrivacy` API behavior, event bus order, replay after consent, sandbox isolation test,
  `storefront_events` written only with consent.
- Admin: the three pages (toggles, row navigation, empty and filled pixel list, validation).

## 9. Open questions (captures still needed)

Observed: Customer accounts page, Customer privacy page, Customer events empty state.
1. **Authentication > Manage** (sign-in methods and the account-required option): the options, wording, defaults.
2. **Order actions > Manage** and **Configuration > Customize** targets.
3. **Cookie banner** detail page (opened from the Customer privacy row): modes, text and style fields, region list, preview.
4. **Data-sale opt-out page** row detail and the 15-state list shown; **Privacy policy** row detail (generator and languages).
5. **Email and SMS marketing at checkout** and **double opt-in** detail pages.
6. **Add custom pixel** form (fields, privacy/permission section, code editor, connect step) and a **pixel list with one pixel**
   (columns, statuses, row menu).
7. A storefront capture with the banner shown (position, buttons, manage dialog) if a reference store can show one in an EU region.
8. API probe: `consentPolicyRegions` and `consentPolicy` output on a reference store to seed the built-in region table.
