# Storefront routes (observed behaviour)

Status: observation notes for the ShopMe storefront router. Written in our own words
from black-box requests against a Shopify development store (fake data, one market,
one language, USD, storefront password enabled). Status codes, paths and query
parameter names are interoperability facts; no vendor code or doc text is copied.

Probe tooling: `scripts/re/capture-storefront.mjs` (screenshots, HAR, Ajax) plus an
ad-hoc route probe (redirect-aware GETs, results kept in the private capture
directory as `raw/storefront/routes-probe.json`). Redirects were not followed when
recording statuses below. "Template" is the page type reported by the store's own
analytics block in the HTML (`pageType`) and the Online Store 2.0 template naming
that the theme ships (`templates/*.json`).

## 1. Route table

| Route | Status | Template (pageType) | Notes |
|---|---|---|---|
| `/` | 200 | `index` | Home. |
| `/collections` | 200 | `list-collections` | All collections. Title "Collections". |
| `/collections/all` | 200 | `collection` | Built-in "all products" collection, title "Products". |
| `/collections/:handle` | 200 / 404 | `collection` | Unknown handle: 404 with the 404 template. |
| `/collections/:handle?page=N` | 200 | `collection` | Pagination; `<title>` gets a "Page N" segment (`Products - Page 2 - <shop>`). |
| `/collections/:handle/:tag` | 200 | `collection` | Tag-filtered collection; title becomes `<collection> - tagged "<Tag>"`. Tag match is case-insensitive in the observed request (`/snowboard` matched the tag `Snowboard`). |
| `/collections/:handle.atom` | 200 `application/atom+xml` | feed | Atom product feed (also for `all`). |
| `/collections/:handle/products.json` | 200 | json | See `ajax-cart-api.md`. |
| `/products` | 200 | `list-collections` | **Quirk:** renders the collections list, not a product index. |
| `/products/:handle` | 200 / 404 | `product` | 404 template when unknown. |
| `/products/:handle?variant=<id>` | 200 | `product` | Preselects the variant. An unknown variant id (`?variant=1`) still returns 200 (falls back to the default selection). |
| `/products/:handle?view=<suffix>` | 200 | `product` | An unknown `view` suffix falls back to the normal `product` template (no error). Alternate templates are selected as `product.<view>` when present. |
| `/products/:handle?sections=a,b` | 200 `application/json` | section rendering | Returns `{ "<id>": "<html>" }` instead of a page. |
| `/products/:handle?section_id=<id>` | 200 for a real section id, 404 otherwise | partial HTML | Section-only render, used by the theme to swap content when the variant changes. `section_id=main` was a 404. |
| `/products/:handle.js` / `.json` / `.oembed` | 200 | json | `.oembed` returns JSON `application/json`; others see `ajax-cart-api.md`. |
| `/collections/:collection/products/:handle` | 200 | `product` | Product within a collection context (breadcrumb/recommendation context only). Does not redirect to the canonical URL. |
| `/cart` | 200 | `cart` | Cart page. `?view=<x>` falls back to the default template. |
| `/cart.js`, `/cart.json`, `/cart/add(.js)`, `/cart/change(.js)`, `/cart/update(.js)`, `/cart/clear(.js)` | 200 | json | See `ajax-cart-api.md`. |
| `/cart/clear` (no `.js`) | 302 -> `/cart` | redirect | Classic navigation helper. |
| `/cart/<variant_id>:<qty>[,<variant_id>:<qty>]` | 302 -> `/checkouts/cn/<token>/<locale>?_r=<opaque>` | redirect | Cart permalink: adds the lines and jumps to checkout. |
| `/checkout` | 302 -> `/checkouts/cn/<token>/<locale>?_r=<opaque>` (cart has items), 302 -> `/` (empty cart) | redirect | `<locale>` was `en-us`. Checkout itself is on the same host in this store. |
| `/search` | 200 | `search` | With no `q`: empty search page, title "Search". |
| `/search?q=<text>` | 200 | `search` | Title `Search: N results found for "<text>"`. `N` was 11 for `snow`; `0` for no matches (still 200). |
| `/search?q=..&type=product` | 200 | `search` | Resource-type restriction (comma-separated list supported by the platform; only `product` probed). |
| `/search?q=..&options[prefix]=last` | 200 | `search` | Prefix-matching option; accepted. |
| `/search?q=..&sort_by=<key>` | 200 | `search` | `sort_by` accepted; same key set as collections. |
| `/search/suggest(.json)` | 200 | json/html | Predictive search, see `ajax-cart-api.md`. |
| `/pages/:handle` | 200 / 404 | `page` (`page.contact` for `contact`) | Handle-specific template suffix: the `contact` page uses the `page.contact` template. |
| `/pages` | 404 | `404` | No page index route. |
| `/blogs/:blog` | 200 / 404 | `blog` | Blog index. |
| `/blogs` | 404 | `404` | No blogs index route. |
| `/blogs/:blog/:article` | 200 / 404 | `article` | Only the 404 path was probed (store has no articles). |
| `/blogs/:blog.atom`, `/blogs/:blog/tagged/:tag` | not probed | | Platform-standard. |
| `/policies/:handle` | 200 / 404 | `policy` | Handles seen: `refund-policy`, `privacy-policy`, `terms-of-service`, `shipping-policy` (also linked from the footer). Unknown handle: 404. |
| `/account`, `/account/login`, `/account/register`, `/account/orders` | 302 -> external account host (`https://shopify.com/<shop-numeric-id>/account?...`) | redirect | This store uses the hosted "new customer accounts" flow, so the storefront has no login form at `/account/login`. Query string on the redirect carries locale, region and an opaque signed `buyer_flags` blob. |
| `/account/logout` | 302 -> `/` | redirect | |
| `/password` | 200 (form) | `password` | Storefront password page. Shown to visitors while password protection is on. |
| `POST /password` | 302 -> `/` | | Correct password sets an unlock cookie. A wrong password re-renders the page (not captured as a distinct status). |
| `/robots.txt` | 200 `text/plain` | generated | Reachable even when the password page is on. |
| `/sitemap.xml` | 200 `application/xml` | generated | Index of child sitemaps. `/sitemap_products_1.xml` returned **400** (child sitemaps use a signed/opaque URL form listed in the index; the guessed path is invalid). |
| `/.well-known/ucp` | 200 `application/json` | generated | Machine-readable commerce profile document (linked from the home page head). |
| `/<anything-else>` | 404 | `404` | HTML 404 page, title `404 Not Found - <shop>`, status 404. |
| `/gift_cards/<id>`, `/orders/<token>` | 404 | `404` | Without a valid id. A `gift_card.liquid` template exists in the theme. |

### Not found / absent

- `/en`, `/en-us`, `/fr`, `/en/products/<h>`: all 404. **No locale or market URL prefix** is active on this store (single market, single language). `localization` and `cart_currency` cookies exist but no URL prefixing. ShopMe should treat `/<locale>/...` as an optional feature, off by default.
- `/localization.json`, `/apple-touch-icon.png`: 404.
- `/collections/nope`, `/products/nope`, `/pages/nope`, `/blogs/<b>/nope`, `/policies/nope`: HTML 404 (template `404`).

## 2. Password gate

- When password protection is on, every storefront path answers **302 to `/password`** for a visitor without the unlock cookie, including JSON endpoints (`/cart.js`, `/products/x.js`) and unknown paths. For `/sitemap.xml` the first response was a 404-with-`Location: /password` combination (inconsistent; ignore).
- Exempt: `/password` (200) and `/robots.txt` (200).
- `POST /password` (form body is the password field plus the platform's hidden form fields; values never recorded) answers `302 -> /`.
- After unlocking, a browser session behaves as a normal storefront. Unlocking sets cookies on the shop domain (see cookie table in `ajax-cart-api.md`).

## 3. Query parameters

### Collection / search listing

| Param | Observed values | Behaviour |
|---|---|---|
| `sort_by` | `price-ascending`, `price-descending`, `title-ascending`, `created-descending`, `best-selling`, `manual` (not probed), `bogus` | All 200. An unknown value is ignored (page renders in default order). `title-descending`, `created-ascending` follow the same pattern by platform convention (not probed). |
| `page` | integer | 1-based page; title gets `Page N`. The theme page size is a theme setting. |
| `filter.v.availability` | `1` (in stock), `0` | Accepted (200) on `/collections/*`; effect depends on the store's filter configuration. |
| `filter.v.price.gte` / `filter.v.price.lte` | decimal in major units (`10`, `100`) | Range filter; reduced the number of product cards rendered (26 -> 22 card markers) in the probe. |
| `filter.p.product_type`, `filter.p.vendor`, `filter.p.tag`, `filter.v.option.<name>` | `filter.p.product_type=snowboard` returned 200 | Product-level and option-level filters follow the same `filter.<scope>.<key>` pattern. |
| `view` | `json` (probed on a collection) | Falls back to the default template when no `collection.<view>` template exists (200 HTML). |

The filter set available on a store depends on its filter configuration; unconfigured
filter params are simply ignored (200).

### Product

| Param | Behaviour |
|---|---|
| `variant` | Preselect variant; unknown id ignored. |
| `view` | Alternate template suffix; unknown ignored. |
| `sections`, `section_id` | Section Rendering API (see above). |
| tracking: `_pos`, `_psq`, `_psid`, `pr_prod_strat`, `pr_rec_id` ... | Appended by search suggestions/recommendations to product URLs; ignored by the router. |

### Cart

`view` is ignored; `sections=` on `/cart` returns section JSON; `GET /cart/add.js?id=..&quantity=..` and `GET /cart/clear.js` mutate state (see Ajax doc).

## 4. HTML structure hooks used by the front end

Only interface facts: the front end expects section wrappers with ids
`shopify-section-<section id>` in any page or section-rendering response, and relies on
`pageType` style data in an inline analytics block (`"pageType":"collection" | "product" | "cart" | "search" | "page" | "blog" | "policy" | "password" | "index" | "list-collections" | "404"`).
Page `<title>` conventions: `<resource title> - <shop name>`; the home page title is just the shop name; 404 pages are `404 Not Found - <shop name>`; search pages are `Search: N results found for "<q>" - <shop name>` (query HTML-escaped).

## 5. Checkout (capture only, nothing submitted)

`/checkout` redirects into a hosted checkout route of the form `/checkouts/cn/<token>/<locale>`.
The page loads contact/delivery/shipping-method/payment sections client-side; the test gateway
note lists three magic card-number values to simulate approve/decline/failure. When a cart
holds more than the available stock the checkout opens with a modal titled "Quantity update"
and clamps the line (an oversized cart line of 1,000,000 was reduced to the available 10) with
"Return to cart" and "Continue checkout" actions. No order or payment was submitted.

## 6. Screenshots (private; not committed)

Directory: `$RE_OUT/screenshots/storefront/` (default `~/shopme-re/screenshots/storefront/`; in the
authoring session `/home/user/shopme-re/screenshots/storefront/`). Each name exists with a
`desktop-` (1440x900, scale 1, full page) and a `mobile-` (iPhone 13 profile, scale 1, full page) prefix:

- `*-home.png` : `/`
- `*-collections-all.png` : `/collections/all`
- `*-collection.png` : first collection from `/collections.json` (`/collections/automated-collection`)
- `*-product-variants.png` : `/products/the-complete-snowboard` (5 colour variants)
- `*-product-out-of-stock.png` : `/products/the-out-of-stock-snowboard`
- `*-search.png` : `/search?q=snowboard`
- `*-cart-drawer-or-after-add.png` : product page right after clicking "Add to cart" in the UI (this theme shows an inline error/notification rather than a drawer; the captured state shows the "maximum quantity already in your cart" error because the cart was already at the stock limit)
- `*-cart-page.png` : `/cart`
- `*-checkout-contact-shipping.png`, `*-checkout-payment.png` : `/checkout` at the top and scrolled to the bottom (payment form skeleton, "Pay now" never clicked)
- `*-account-login.png` : `/account/login` after redirect to the hosted account page
- `*-404.png` : `/this-page-does-not-exist-404`

Total 24 files. Screenshot state depends on cart contents at capture time (see the
Ajax doc's quirks about stock).

## 7. Conformance test candidates

1. Router: `/`, `/collections`, `/collections/all`, `/collections/:h`, `/products/:h`, `/cart`, `/search`, `/pages/:h`, `/blogs/:b`, `/blogs/:b/:a`, `/policies/:h` return 200 with the right page type; unknown handles give 404 with the 404 template and HTTP 404.
2. `/products` and `/collections` both render the list-of-collections template.
3. `/pages` and `/blogs` (no handle) are 404.
4. `/collections/:h/:tag` filters by tag; title carries `tagged "<Tag>"`.
5. `?page=N` pagination and `Page N` title segment.
6. `?variant=<unknown>` yields 200, not 404.
7. `?view=<unknown>` falls back to the default template.
8. `?sections=a,b` on any page returns a JSON object with exactly the requested keys; `section_id` returns partial HTML or 404.
9. `sort_by=<unknown>` is ignored (200).
10. Search with zero results is 200 and the title says `0 results found`.
11. `/cart/<variant>:<qty>` redirects (302) to the checkout URL after adding the lines; `/checkout` with an empty cart redirects to `/`.
12. `/account/login` redirect when new customer accounts are on (ShopMe: configurable; legacy mode would render a local login form).
13. Password mode: all paths 302 -> `/password` except `/password` and `/robots.txt`; correct POST gives 302 -> `/` and subsequent requests succeed; `/cart.js` while locked gives the same 302.
14. No locale prefix routing when only one market/language is configured (`/en` is a 404).
15. `/robots.txt` and `/sitemap.xml` exist; `.atom` feeds exist for collections.
