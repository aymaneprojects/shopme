# Storefront Ajax / cart API (observed behaviour)

Status: observation notes for the Shoppen compatibility layer. Written in our own
words from black-box captures of a Shopify development store (fake data, storefront
password protected). Endpoint paths, parameter names, JSON field names and status
codes are listed because they are interoperability facts. No vendor code or doc text
is reproduced.

Capture method: `scripts/re/capture-storefront.mjs` (Playwright, same-origin
`fetch` from a page that already passed the password gate). Raw exchanges live in the
private capture directory (`$RE_OUT/raw/storefront/ajax/NN-name.json`, not committed).
Numbers in brackets such as `[#18]` point at those files.

All money values in these endpoints are **integers in minor units** (cents for USD),
except where a field is explicitly a decimal string/number (called out below).
`id`s are 64-bit integers (they exceed 2^53 only in some stores; treat as int64).

## 0. Conventions common to all cart endpoints

| Topic | Observation |
|---|---|
| Base | Same origin as the storefront (`/cart.js`, `/cart/add.js`, ...). A `.js` suffix means "JSON body". |
| Content types in | JSON (`application/json`), `application/x-www-form-urlencoded`, and `multipart/form-data` (what the theme's product form sends). |
| Content type out | Success bodies are JSON but sent as `text/javascript; charset=utf-8` for `/cart*.js` and `/cart/add*`; `application/json; charset=utf-8` for the `.json` endpoints. One 422 (update.js unknown variant) came back as `application/json`. Clients must not rely on the media type. |
| Caching | Mutations: `cache-control: no-cache, no-store`. `GET /cart.js`: no cache-control header observed. `.json` catalog endpoints: no cache-control observed. |
| Cart identity | A cookie (see Cookies) identifies the cart; the first mutation creates it. `GET /cart.js` on a visitor with no cart returns an empty cart with a fresh `token`. |
| Password gate | While the storefront password is on, every storefront path (including `/cart.js`, `/products/x.js`) answers `302 -> /password` for visitors without the unlock cookie; fetch follows it and the client receives the password page as HTML (status 200, `redirected: true`). `/robots.txt` and `/password` are exempt. |
| Rate limiting | Burst traffic (dozens of requests per minute, most easily failed adds) produced `429` with an **HTML** "verifying your connection" interstitial, on any path including `GET /cart.js`; it lasted several minutes. Not a JSON error. Not worth replicating beyond a generic `429`. |
| Unknown extra fields | Ignored silently. |
| Variant ids | Always numeric variant ids (not GIDs). Strings of digits are accepted for `id` in `change.js`; a non-numeric string in `add.js` gives "Cannot find variant". |

### Error body shape

Two shapes occur; both carry the same human text twice:

```json
{ "status": 422, "message": "<text>", "description": "<same text>" }
{ "status": "unprocessable_entity", "message": "<text>", "description": "<same text>" }
{ "status": "bad_request", "message": "<text>", "description": "<text>" }
```

`status` is an **integer** for most 422s from `add.js`/`update.js` and a **string**
slug (`unprocessable_entity`, `bad_request`) for `change.js` 422 and for 400s. The HTTP status
code is authoritative. See "Error catalogue" at the end.

## 1. Cart object (`GET /cart.js`, and the body of change/update/clear)

```json
{
  "token": "<24 alnum>?key=<32 hex>",
  "note": "",
  "attributes": {},
  "original_total_price": 489965,
  "total_price": 405973,
  "total_discount": 83992,
  "total_weight": 31751.4659,
  "item_count": 7,
  "items": [ /* line items, see below */ ],
  "requires_shipping": true,
  "currency": "USD",
  "items_subtotal_price": 405973,
  "cart_level_discount_applications": [],
  "discount_codes": []
}
```

| Field | Type | Notes |
|---|---|---|
| `token` | string | Cart token. Observed format: 24 alphanumerics, then `?key=` and 32 hex chars. The same token is also the checkout token embedded in the `/checkouts/cn/<token>/<locale>` redirect (without the `?key=` part). Stable across the whole cart lifetime, including after `clear.js`. |
| `note` | string | Order note, `""` when unset (never null on `GET /cart.js`; `POST /cart/clear.js` on a brand-new cart returned `null` once). |
| `attributes` | object string->string | Cart attributes. Empty cart: `{}`. |
| `original_total_price` | int | Sum of `original_line_price` (before any discounts). |
| `total_price` | int | Total after line-level discounts (cart-level discounts too when present). Excludes shipping/tax. |
| `total_discount` | int | `original_total_price - total_price`. |
| `total_weight` | number | Grams, **float** (e.g. `31751.4659`), sum of `grams * quantity`. |
| `item_count` | int | Sum of quantities (not number of lines). |
| `items` | array | Line items, newest-added line first for a fresh add (see ordering). |
| `requires_shipping` | bool | True if any line requires shipping; false for an empty cart. |
| `currency` | string | ISO 4217 presentment currency. |
| `items_subtotal_price` | int | Sum of `final_line_price`. Equals `total_price` in captures without cart-level discounts. |
| `cart_level_discount_applications` | array | Cart-wide discount applications; `[]` here. |
| `discount_codes` | array | `[]` unless codes were applied via the cart. |

`POST /cart/change.js` and `POST /cart/update.js` return this object plus extra keys
(`items_added`/`items_removed` for change, `items_changelog` for update, optional
`sections`). `/cart/clear.js` returns the plain cart object.

### Line item (`items[]`)

Fields seen on every line (types in brackets). Prices are minor-unit ints unless noted.

- Identity: `id` [int, equals `variant_id`], `variant_id` [int], `product_id` [int], `key` [string], `handle` [string], `url` [string, `/products/<handle>?variant=<variant_id>`].
- Quantity/props: `quantity` [int], `properties` [object string->string; `{}` when none].
- Titles: `title` (product title + ` - ` + variant title; just the product title for single-variant products), `product_title`, `variant_title`, `untranslated_product_title`, `untranslated_variant_title`, `product_description` (plain text, truncated), `product_type`, `vendor`, `sku` (`""` if none), `variant_options` [array of option values], `options_with_values` [array of `{name,value}`], `product_has_only_default_variant` [bool].
- Money (per unit): `price` (equals `original_price`), `original_price`, `discounted_price`, `final_price`; (per line): `line_price`, `original_line_price`, `final_line_price`; discount: `total_discount` (per line, total), `discounts` [array of `{amount, title}`], `line_level_total_discount` [int], `line_level_discount_allocations` [array, see below].
- `presentment_price`: a **decimal number** (`699.95`), not minor units.
- Physical/flags: `grams` [int per unit], `taxable`, `requires_shipping`, `gift_card` [bools].
- Media: `featured_image` {`url`,`alt`,`width`,`height`,`aspect_ratio`}, `image` [string URL of the same image].

`line_level_discount_allocations[]` entries: `{ amount, discount_application: { type: "automatic"|..., key (uuid), title, description, value (string, e.g. "30.0"), value_type ("percentage"|"fixed_amount"), allocation_method ("each"|"across"|"one"), target_selection ("entitled"|"all"|"explicit"), target_type ("line_item"|"shipping_line"), total_allocated_amount, created_at } }`. The test store had an automatic "buy three, get 30 percent off" discount; lines with qty>=1 of the qualifying product got `discounted_price = round(price * 0.7)` (`48997` from `69995`) and per-line `total_discount = unit discount * quantity`. Discount math is store-config dependent and out of scope for the cart API clone, but the response shape matters.

### `key` format

`"<variant_id>:<32 hex>"`. The hex part is a digest of the line's customisation
(properties and selling plan etc.): the same variant with different `properties`
yields different keys (and thus separate lines); the same variant+properties merges into
one line and the key is stable. Example keys with identical variant id but different
properties had different hex tails. The key tail for a plain variant line was identical when the line was re-created after a clear (the same 32-hex tail appeared in both captures), so it is derived from the variant and line customisation, not from the cart.

### Ordering and merging of lines

- Adding a variant (with identical `properties`) that is already in the cart increases that line's `quantity`; no new line.
- Adding the same variant with different `properties` creates a new line.
- A newly created line is inserted at the **top** of `items[]`; existing lines keep their relative order. Example: adding A, then A with `gift` property, then (A merge), then a two-item add of [A with `engraving`, B] produced `[B, A(engraving), A(gift), A]`. So within one multi-item request the later request item ends up higher.
- Line numbers for `change.js` (`line`) are **1-based** positions in `items[]`.

## 2. `GET /cart.js` and `GET /cart.json`

- No params. Returns the cart object (section 1). Both `/cart.js` and `/cart.json` work; same body (`text/javascript` vs `application/json` content type). The theme itself uses `/cart.json`.
- Empty/new visitor: `item_count 0`, `items []`, `total_price 0`, `requires_shipping false`, `note ""`, `attributes {}`, real `token`.
- `?sections=` on `/cart.js` is ignored (no `sections` key returned).

## 3. `POST /cart/add.js`

Also reachable as `POST /cart/add` (no `.js`) with `X-Requested-With: XMLHttpRequest` /
`Accept: application/javascript`, which is what the theme's product form does (multipart
body). Without `.js` and without those hints a normal form post redirects the browser to `/cart`
(not captured; classic behaviour).

**Observed oddity:** `GET /cart/add.js?id=<variant>&quantity=1` also adds to the cart and returns 200 [#41]. Likewise `GET /cart/clear.js` clears [#40]. Mutation by GET is accepted.

### Request formats

1. JSON, multi-item: `{"items":[{"id":<variant>,"quantity":1,"properties":{...}}, ...]}`.
2. JSON, single item at top level: `{"id":<variant>,"quantity":1}` (+ optional `properties`).
3. Form-encoded: `id=<variant>&quantity=1&properties[name]=value` (also `selling_plan`, per classic API; not tested).
4. Multipart (theme): fields `id`, `quantity`, `form_type=product`, option names, `product-id`, `section-id`, `sections` (comma list).

Item fields: `id` (variant id, required), `quantity` (int, default 1), `properties` (object), `selling_plan` (id; untested).
Top-level optional: `sections` (comma-separated string; the theme code also passes arrays in `update.js`), `sections_url` (path used to render the sections in the context of that page).

### Response (success)

- **Multi-item (`items` array in request):** `200`, body `{"items":[ <line>, ... ]}` with the added/updated lines in request order. `sections` key added when requested [#31]. Each `<line>` is the full line-item shape (section 1) **with the line's resulting total `quantity`**, not just the quantity added (second add of the same line returned quantity 2) [#70].
- **Single item (top-level `id`/form-encoded):** `200`, body is just the line-item object (no wrapper) [#08, #09].
- Quantity `0` in a JSON items array on an empty cart: `200 {"items":[]}`: nothing added, no error [#73]. (With a full cart it returned a 422 "maximum quantity ... already in your cart"; see errors.)

### Section rendering

`sections` (string `a,b`) renders those theme sections after the mutation and returns
`"sections": { "<id>": "<html>" }` in the response body. Works as a request-body
field (JSON/form) and as a query parameter on the URL (`/cart/add.js?sections=header`). The rendered
HTML is the whole section wrapper (`<div id="shopify-section-header" ...>`), ~17 KB for a header.
Because the response shape for single-item adds is the bare line object, the
`sections` key is merged into that same object when requested [#71]. `sections_url` selects the page
context used for rendering. Unknown section ids: not captured.

## 4. `POST /cart/change.js`

Changes the quantity (or properties) of **one line**. Body JSON or form-encoded.

| Param | Meaning |
|---|---|
| `line` | 1-based line index. |
| `id` | Either a line `key` (`variant:hash`) or a bare variant id (string/number). |
| `quantity` | New absolute quantity; `0` removes the line. |
| `properties` | Replace the line's properties (object). Changing properties re-keys the line. |
| `selling_plan` | untested |
| `sections`, `sections_url` | as in add. |

Response: `200` full cart object (section 1) plus:

- `items_added`: array of `{product_id, variant_id, id (uuid-like line event id), image, price (DECIMAL STRING "699.95"), presentment_price (number), quantity (delta added), title, product_title, variant_title, vendor, product_type, sku, url, untranslated_product_title, untranslated_variant_title, view_key (= line key)}`
- `items_removed`: same shape; `quantity` is the **delta removed** (changing 3 -> 2 gives `items_removed[0].quantity = 1`).
- `sections` when requested.

Behaviour notes:
- `{"line":1,"quantity":3}` [#12], `{"id":"<key>","quantity":2}` [#15], and the form-encoded `line=1&quantity=1` [#17] all work.
- `id` as a bare variant id applied to **every** line of that variant, including lines with different properties, in one capture (two property-lines both went to the requested quantity) [#16]. Treat "id = variant id" as "all lines of that variant" for conformance purposes.
- `{"line":1,"properties":{...}}` with no quantity updates properties only [#19].
- `line` out of range: `422 {"status":"unprocessable_entity","message":"line parameter is invalid.","description":"line parameter is invalid."}` [#18].
- Quantity above available stock: `422` with the "Only N items were added to your cart due to availability." text (N = available), see errors. The cart is not changed to the requested value.

## 5. `POST /cart/update.js`

Bulk update plus note/attributes. Body JSON or form-encoded.

| Param | Meaning |
|---|---|
| `updates` | Either an **array of quantities by line position** (`[2,1,0,0]`, 0 removes) or an **object mapping variant id (or line key) -> quantity** (`{"<variant>":2}`). Form-encoded: `updates[<variant>]=1` (or `updates[]=1&updates[]=2`). |
| `note` | String; sets the cart note. `""` clears. |
| `attributes` | Object string->string; **merges** into existing attributes. A key with value `""` deletes that attribute [#28]. |
| `discount` | Comma-separated discount codes (the theme sends this; untested here). |
| `sections`, `sections_url` | as above (theme sends sections as array in one place and comma string in others). |

Response: `200` full cart plus `items_changelog: { "added": [ {variant_id, quantity} ] }`
(a list of lines whose quantity went **up**, `{"added":[]}` otherwise) and `sections` when
requested. No `items_added/items_removed` here.

Notes:
- Array form: `updates:[2,1,0,0]` on a 4-line cart set quantities and removed lines 3 and 4 [#21].
- Variant-id object form was only exercised on a variant that had a single line [#23]; behaviour for a variant spread over several lines (different properties) is untested.
- `update.js` does **not** enforce inventory: `{"updates":{"<variant>":50}}` on a variant with stock 10 returned `200` with quantity 50 and `items_changelog.added[0].quantity = 40` [#81]. Inventory is only clamped later at checkout (a "Quantity update" dialog showed items reduced to the available 10).
- Unknown variant id: `422 {"status":422,"message":"Cart Error","description":"Cannot find variant"}` with `content-type: application/json` [#26].
- Updating only `note`/`attributes` leaves lines untouched [#24]; form-encoded `note=form+note&attributes[k]=v` works [#25].

## 6. `POST /cart/clear.js`

No body needed (JSON `{}` is fine). Returns `200` with the empty cart object (section 1); the `token` is **unchanged**. Also accepted as `GET`. **`note` and `attributes` are NOT reset**: after a clear the cart still carried the previously set note and attributes [#38, #39]. Quirk: on the very first call for a brand-new cart, the clear response had `note: null` whereas `GET /cart.js` returns `""` [#04].

## 7. Product endpoints

### `GET /products/<handle>.js`
Legacy product JSON, **prices in minor units**, `text/javascript`.

Top-level keys: `id`, `title`, `handle`, `description` (HTML string), `published_at`, `created_at` (ISO 8601 with local offset, `2026-11-04T05:36:19-05:00`), `vendor`, `type`, `tags` [array of strings], `price`, `price_min`, `price_max`, `available` [bool], `price_varies` [bool], `compare_at_price` [int|null], `compare_at_price_min`, `compare_at_price_max` [ints, 0 when none], `compare_at_price_varies`, `variants` [array], `images` [array of protocol-relative URLs `//cdn...`], `featured_image` [protocol-relative URL], `options` [array of `{name, position, values[]}`], `url` (`/products/<handle>`), `media` [array], `requires_selling_plan`, `selling_plan_groups` [].

Variant: `id`, `title`, `option1/2/3` (null when unused), `sku` (null), `requires_shipping`, `taxable`, `featured_image` (null), `available` [bool], `name` (product + variant title), `public_title` (variant title, **null** for the "Default Title" variant), `options` [array of values], `price` [int minor units], `weight` [int grams], `compare_at_price` [int|null], `inventory_management` ("shopify"|null), `barcode`, `quantity_rule {min,max,increment}`, `quantity_price_breaks []`, `requires_selling_plan`, `selling_plan_allocations []`.

`media[]`: `{id, position, media_type ("image"), alt, src, width, height, aspect_ratio, preview_image {src,width,height,aspect_ratio}}`.

`?variant=<id>` has no visible effect on the body. A product with a single default variant: variant `title`/`option1` = `"Default Title"` and the option is `{name:"Title", values:["Default Title"]}`. 404: empty body, `content-length: 0`, `content-type: text/javascript` [#47].

### `GET /products/<handle>.json`
Admin-REST-like shape wrapped as `{"product": {...}}`, `application/json`. **Prices are decimal strings** (`"699.95"`), `compare_at_price` is `""` (empty string) when absent, `tags` is a **comma-separated string**, variants carry `product_id`, `position`, `grams`, `weight` (number), `weight_unit` ("lb"), `fulfillment_service`, `inventory_management`, `image_id`, `price_currency`, `compare_at_price_currency`, timestamps; `options[]` have `id`,`product_id`,`name`,`position`,`values`; `images[]` have `id`,`product_id`,`position`,`alt`,`width`,`height`,`src` (absolute https URL), `variant_ids`, timestamps; `image` is the first image. `body_html` instead of `description`; `product_type`; `template_suffix`; `published_scope: "web"`. 404: empty body.

### `GET /collections/all/products.json` (and `/collections/<handle>/products.json`, `/products.json`)
`{"products":[ ... ]}` in the same shape as `<handle>.json` but **without the wrapper per product**, simplified variants (`available` instead of inventory fields; `price` decimal string; `grams`; `position`; `product_id`; timestamps). Query params: `limit` and `page` (1-based). Without `limit`, 23 products came back on one page for `/collections/all/products.json` (store has about 23 products); `limit=2&page=2` and `/products.json?limit=2` each returned 2. Maximum limit untested. Only published/visible products appear.

### `GET /collections.json`
`{"collections":[{id,title,handle,description (null),published_at,updated_at,image (null),products_count}]}`; includes automated and manual collections.

## 8. Search / recommendations

### `GET /search/suggest.json?q=<text>&resources[type]=product[,collection,page,article][&resources[limit]=n]`
`200 application/json`. `{"resources":{"results":{"products":[...]}}}`. With `resources[type]=product,collection,page,article` the `results` object had keys `products`, `collections`, `pages`, `articles` (empty arrays when nothing matched); a request for only `product` returned only the `products` key. Items under non-product keys were not observed (no matches). Product objects: `available`, `body` (HTML-ish text, truncated), `compare_at_price_max/min` (decimal strings, `"0.00"`), `handle`, `id`, `image` (absolute URL), `price`, `price_max`, `price_min` (decimal strings), `tags` [array], `title`, `type`, `url` (**contains tracking params** `?_pos=1&_psq=<q>&_psid=<n>`), `variants` [array, `[]` here], `vendor`, `featured_image {alt,aspect_ratio,height,url,width}`. `resources[limit]=3` returned 3 products; with no limit the product list had 10 entries.

`GET /search/suggest?q=snow&section_id=predictive-search` returns an HTML fragment (`<div id="shopify-section-predictive-search" ...>`), `text/html`, used by the theme's predictive search; `section_id` selects the section rendered.

### `GET /search.json?q=<text>`
Returned **HTML** (full search results page) with `content-type: application/json` [#53]; i.e. the `.json` suffix is not a real JSON search endpoint on this store. Conformance should not implement a JSON search there.

### `GET /recommendations/products.json?product_id=<id>&limit=<n>[&intent=related|complementary]`
`200`: `{"products":[ <product in .js shape (minor units)> ... ], "intent":"related"}`. Each `url` carries a tracking param (`?pr_prod_strat=collect`). `/recommendations/products?product_id=..&section_id=..` (no `.json`) renders an HTML section for the theme (200 in the browser capture where `section_id` was a real section; 404 when called with an unknown section id [#56]).

## 9. Section Rendering API (generic)

`GET <any-page-path>?sections=header,footer` returns `application/json`: `{"header":"<html>","footer":"<html>"}` (one key per requested section id), regardless of the page type [#34, #35]. Also available as POST body/query on the cart mutations (above). Section HTML starts with the wrapper `<div id="shopify-section-<id>" class="shopify-section ...">`. Section ids are the theme's section file names or, for sections in groups, the section instance ids.

`?section_id=<id>` on a product URL: used by the theme for variant switching, answering with only that section's HTML (not captured at body level; unknown section id gave 404 on `/products/x?section_id=main`).

## 10. Cookies involved (names and roles only; values never recorded)

| Cookie | Role |
|---|---|
| `cart` | Identifies the cart (token); set when a cart is created. Not HttpOnly, ~3 months. |
| `cart_currency` | Presentment currency of the cart; ~2 weeks. |
| `localization` | Selected country/language context; 1 year. |
| `_shopify_essential` | Essential session cookie (HttpOnly, secure). |
| `_shopify_analytics`, `_shopify_marketing` | Analytics / marketing identifiers (HttpOnly, secure). |
| `_shop_app_essential` | Shop-app related (set on a third-party `.shop.app` domain). |
| password-gate cookie | Set after a successful `POST /password`; its name was not retained in the scrubbed capture. Required for all storefront access while the password page is on. |
| `keep_alive`, `_cmp_a`, `cart_sig`, `cart_ts`, `checkout`-related | Seen in classic Shopify; **not** observed in these captures. |

## 11. Error catalogue (observed)

| Request | Status | Body |
|---|---|---|
| `add.js` variant sold out (JSON `items`) | 422 | `{"status":422,"message":"The product 'The Out of Stock Snowboard' is already sold out.","description":<same>}` [#61] |
| `add.js` quantity above stock, cart empty | 422 | `{"status":422,"message":"Only 10 items were added to your cart due to availability.",...}` **and the cart did get 10 units** (partial add despite 422) [#74/#75] |
| `add.js` quantity that would exceed stock given what is already in the cart | 422 | same "Only N items were added..." text; cart ends at the stock limit [#78/#79] |
| `add.js` adding when the cart already holds the maximum | 422 | `{"status":422,"message":"The maximum quantity of this item is already in your cart.",...}` (also returned for `quantity: 0` and `quantity: -1` in that state) |
| `add.js` unknown variant id (`1`) or non-numeric id | 422 | `{"status":422,"message":"Cart Error","description":"Cannot find variant"}` |
| `add.js` empty JSON body `{}` | 400 | `{"status":"bad_request","message":"Parameter Missing or Invalid","description":"Required parameter missing or invalid: items"}` |
| `add.js` `items=garbage` (form) | 400 | `{"status":"bad_request","message":"must be a collection of items: items","description":<same>}` |
| `change.js` invalid `line` | 422 | `{"status":"unprocessable_entity","message":"line parameter is invalid.",...}` |
| `change.js` quantity above stock | 422 | `{"status":422,"message":"Only 10 items were added to your cart due to availability.",...}` |
| `update.js` unknown variant | 422 | `{"status":422,"message":"Cart Error","description":"Cannot find variant"}` |
| `GET /products/x.js` or `.json` unknown | 404 | empty body |
| Any path, rate-limited | 429 | HTML interstitial |

Quirk, unresolved: the sold-out variant (`available:false` in `.js`) first returned the 422 above for `{"items":[...]}`, but about an hour later the same variant was **accepted** (`200`, line added, quantity merged to 2 on a second add) for both `{"id":...}` JSON and form-encoded adds [#69, #70]. Most likely the store inventory changed between captures; a conformance suite should set stock explicitly rather than reuse a fixed fixture. The "Only 1000000 items were added" variant of the stock message also appeared once after a prior oversized add, suggesting the stock-limit message can echo odd numbers when the cart is already over the limit.

## 12. Conformance test candidates

1. `GET /cart.js` on a fresh session returns the full empty-cart shape with every key of section 1 (including `items_subtotal_price`, `cart_level_discount_applications`, `discount_codes`) and a token matching `^[A-Za-z0-9]{24}\?key=[0-9a-f]{32}$`.
2. `POST /cart/add.js` with `{"items":[{"id","quantity"}]}` returns `{"items":[line]}`; with top-level `{"id","quantity"}` returns the bare line; with form encoding returns the bare line. Line has every field in section 1 and `quantity` equals the resulting line total.
3. Adding the same variant twice merges (qty adds); adding with differing `properties` creates a second line with a different `key` tail.
4. `key` matches `^\d+:[0-9a-f]{32}$`, stable for identical variant+properties.
5. `item_count` is the sum of quantities; `total_price`, `original_total_price`, `items_subtotal_price`, `total_discount` arithmetic holds in minor units.
6. `change.js` by `line` (1-based), by `key`, and form-encoded; `items_added`/`items_removed` hold the delta quantity; quantity 0 removes the line.
7. `change.js` with out-of-range line gives 422 with `status:"unprocessable_entity"`.
8. `update.js` accepts array and object `updates`; array shorter/longer than lines behaviour; `0` removes.
9. `update.js` note + attributes: attributes merge, empty-string value deletes the key, note `""` clears.
10. `update.js` does not enforce inventory; `change.js` and `add.js` do.
11. `update.js`/`add.js` unknown variant gives 422 "Cannot find variant"; `add.js` `{}` gives 400 with `status:"bad_request"`.
12. Out of stock variant: 422, message includes the product title and "already sold out".
13. Over-stock add: 422 "Only N items were added to your cart due to availability." and the cart ends with N units (partial add).
14. `sections` in body (JSON and form) and in query returns `sections.{id}` HTML wrappers starting with `<div id="shopify-section-{id}"`; `GET /?sections=a,b` returns a JSON object of exactly those keys.
15. `clear.js` empties lines but keeps the cart `token`, `note` and `attributes`; GET is also accepted.
16. `/products/<h>.js` price fields are integer minor units; `/products/<h>.json` are decimal strings, `tags` string vs array; 404 has empty body.
17. `/collections/all/products.json` pagination with `limit` and `page`.
18. `/search/suggest.json` returns only the requested `resources[type]` keys; product `url` includes `_pos`, `_psq`, `_psid`.
19. `/recommendations/products.json` returns `{products, intent}` and excludes the source product.
20. Content types: success bodies from `/cart*.js` parse as JSON regardless of media type (clients must not require `application/json`).
