# Liquid compatibility inventory

Status: draft, generated from analysis of two Online Store 2.0 themes (see Method). Written in our own words; names of
tags, filters and objects are listed for interoperability only.

Goal: tell the `packages/liquid-compat` implementer (a) which Liquid features real themes need, (b) which of them
LiquidJS already provides (standard Liquid, MIT) and (c) which are Shopify-specific extensions we must build ourselves,
in priority order.

## Method and limits

Corpus: 395 `.liquid` files, 282 from the theme called Horizon (a block-based theme, version 4.4.0) and
113 from a generated-data theme ("test-data-main", section-based, no `blocks/` directory). The corpus is small and
both themes come from the same vendor; treat counts as a guide to relative importance, not as an exhaustive feature list.

How counts were produced (throwaway Node script, not shipped):

1. A tokenizer splits each file into `{% ... %}` tags and `{{ ... }}` outputs. The body of `schema`, `doc`,
   `comment`, `raw`, `stylesheet` and `javascript` blocks is skipped. Inside a `{% liquid %}` tag every line is treated
   as one tag, and `comment` regions inside it are skipped.
2. **Tags**: first word of each tag. Closing tags (`end...`) are not counted separately.
3. **Filters**: after splitting each expression on `|` outside string literals, the identifier right after each pipe.
   Filters used in tag arguments (`assign`, `if`, `for`, `render` arguments, ...) are included.
4. **Objects**: the first identifier of each variable path (strings stripped), minus names the same file defines itself
   (`assign`, `capture`, loop variables, `as` aliases). Remaining names were then intersected with a list of known
   platform object names. Names that are really snippet parameters (e.g. a product card receiving a variable called
   `card_product`) cannot be told apart from globals automatically, so only the known list is reported. Property counts
   cover the **first** property after the root only, and miss accesses made through local aliases
   (`assign p = product`, snippet params), so real use of drops such as `product` is higher than shown.
5. **Priority** is computed by reachability, then reviewed by hand:
   - **P0**: used by a file reachable from the layout and the `index`, `collection`, `product` and `cart` templates
     (and alternates of them). Reachability follows JSON template section/block types, section groups
     (`{% sections %}`), static `{% render %}` snippet names and static `{% content_for 'block', type: ... %}`.
     243 of 395 files fall in this set.
   - **P1**: not P0, but used by files reachable from other templates (page, blog, article, search, 404, list-collections,
     customer account templates, password, gift card) or by merchant-addable sections/blocks (those with presets, and
     all files in `blocks/`).
   - **P2**: not observed in either theme; listed from public documentation in the last section; implement on demand.
   - Manual overrides: `predictive_search` raised to P1 (it is fetched by theme JavaScript via section rendering, which
     the static reachability walk cannot see).
6. Limits: dynamic names (8 `render`/`content_for` calls with computed names) are not followed; code inside
   `{% javascript %}`/`<script>` is not Liquid-analysed; a feature used once in a P0 file is P0 even if it is a minor
   enhancement (see the stub-able list below). Neither theme uses `include`, `tablerow`, `decrement`, `raw`,
   `ifchanged`, or `render ... for/with`.

Headline numbers: 29 distinct tag names (incl. sub-tags `else`, `elsif`, `when`) with 9682 uses;
91 distinct filters with 4464 uses (47 provided by LiquidJS, 44 Shopify-specific;
**37 Shopify-specific filters are P0**, 7 are P1); 36 distinct global objects. Whitespace control
markers (`{%-`, `-%}`, `{{-`, `-}}`) occur ~8,000 times, so exact whitespace-trim semantics matter for output parity.

"Standard" below means the name exists in the LiquidJS 10.x built-in tag/filter registry. A few standard names still
differ in details from the platform behavior (see "Semantic differences").

## Tags

| Tag | Uses | Files | Class | Prio | Notes |
|---|---:|---:|---|---|---|
| `if` | 2925 | 270 | standard | P0 | conditional (with elsif/else) |
| `assign` | 2451 | 222 | standard | P0 | variable assignment |
| `render` | 921 | 240 | standard | P0 | include a snippet with isolated scope (static name in all but a handful of sites) |
| `else` | 478 | - | standard | P0 |  |
| `when` | 370 | 57 | standard | P0 | (part of case) |
| `liquid` | 360 | 191 | standard | P0 | multi-statement tag; one tag per line |
| `#` | 275 | 65 | standard | P0 | inline comment |
| `for` | 262 | 109 | standard | P0 | loop; forloop object, limit/offset/reversed |
| `elsif` | 209 | 91 | standard | P0 | (part of if) |
| `capture` | 205 | 105 | standard | P0 | capture rendered output into a variable |
| `schema` | 177 | 177 | **Shopify** | P0 | JSON metadata block: parsed by the theme loader, emits nothing |
| `doc` | 154 | 154 | **Shopify** | P0 | documentation block for snippets/blocks, emits nothing |
| `stylesheet` | 154 | 154 | **Shopify** | P0 | CSS collected per rendered file, emitted once |
| `unless` | 150 | 85 | standard | P0 | inverted conditional |
| `echo` | 136 | 26 | standard | P0 | output expression inside a liquid tag |
| `comment` | 120 | 69 | standard | P0 | block comment |
| `content_for` | 102 | 59 | **Shopify** | P0 | renders child blocks ('blocks') or one fixed block ('block', type, id) |
| `case` | 77 | 57 | standard | P0 | switch (with when/else) |
| `style` | 66 | 63 | **Shopify** | P0 | inline style element whose body is Liquid-evaluated |
| `form` | 36 | 26 | **Shopify** | P0 | emits a form element plus hidden inputs and defines the form object |
| `paginate` | 17 | 16 | **Shopify** | P0 | splits an array into pages and defines the paginate object |
| `break` | 16 | 12 | standard | P0 | loop control |
| `increment` | 6 | 1 | standard | P0 | named counter |
| `sections` | 4 | 2 | **Shopify** | P0 | render a section group (JSON) by name |
| `section` | 3 | 2 | **Shopify** | P1 | render a section by file name |
| `continue` | 3 | 3 | standard | P0 | loop control |
| `javascript` | 2 | 2 | **Shopify** | P0 | JS collected per rendered file |
| `layout` | 2 | 2 | **Shopify** (name clash) | P1 | selects layout; the Shopify form is the keyword none |
| `cycle` | 1 | 1 | standard | P1 | alternating values |

Summary: 10 Shopify-specific tags are used (`schema`, `doc`, `stylesheet`, `javascript`, `style`, `form`,
`paginate`, `section`, `sections`, `content_for`) plus one name clash (`layout`). All are P0 except `section`
(single-section include, used by password layouts only) and `layout none` (gift card template).

Notes for implementers:

- `schema`, `doc`: parse-time only. The loader should extract and keep them; the renderer must emit nothing.
- `stylesheet` / `javascript`: content is hoisted per rendered file; render each distinct file's block once per page.
- `style`: render the body (it is Liquid) and wrap it in a style element.
- `content_for 'blocks'` renders the children listed in the JSON template/section group for the current section or block
  (in `block_order`); `content_for 'block', type:, id:` renders one fixed child. Both establish the `block` object and
  pass a parent context readable as `closest.<resource>`. Extra keyword args are forwarded to the child (and show up as
  `closest.*`).
- `form` types seen: product (8 uses), localization (9), customer, customer_address, customer_login, create_customer,
  guest_login, recover_customer_password, reset_customer_password, activate_customer_password, contact, new_comment,
  storefront_password, cart. Cart and product forms are P0; the rest P1.
- `paginate` is used with collection products (page sizes 4 to 24, sometimes read from a section setting), search results,
  blog articles, article comments, customer orders/addresses, collections and product variants.
- `render`: every use has a static snippet name except a few; no `for`/`with` forms. Scope is isolated: only keyword
  arguments plus global objects are visible inside the snippet. In LiquidJS this means a custom file resolver (lookup in
  `snippets/<name>.liquid`) and checking that global objects stay reachable.
- `layout`: LiquidJS ships a layout tag with different (inheritance) semantics. Override it: the only needed behavior is
  `{% layout none %}` meaning "render the template without the theme layout".
- Not in LiquidJS but part of the platform language: `ifchanged` (unused by the corpus).

## Filters, Shopify-specific (to implement)

Sorted by priority then use. Behavior notes are our summary of intended output, to be confirmed against our own dev store
before implementation.

| Filter | Uses | Files | Prio | Notes |
|---|---:|---:|---|---|
| `t` | 1085 | 144 | P0 | translate a key from the locale files; named args interpolate; `count` selects plural form |
| `asset_url` | 296 | 82 | P0 | URL of a file in `assets/` |
| `image_url` | 193 | 68 | P0 | URL for an image resource; width/height/crop/format args |
| `stylesheet_tag` | 126 | 47 | P0 | link element for a stylesheet URL |
| `inline_asset_content` | 111 | 46 | P0 | inline the raw text of an asset (used for SVG icons) |
| `money` | 97 | 19 | P0 | format using the shop money format |
| `image_tag` | 76 | 42 | P0 | img element from an image URL (loading, class, sizes, widths, alt ...) |
| `placeholder_svg_tag` | 32 | 23 | P0 | placeholder illustration by name |
| `font_face` | 31 | 4 | P0 | emit @font-face CSS for a font_picker value |
| `money_with_currency` | 29 | 16 | P0 | format using the with-currency format |
| `money_without_currency` | 29 | 4 | P0 | amount only, formatted number |
| `font_modify` | 21 | 4 | P0 | derive a font variant (weight/style) |
| `color_brightness` | 15 | 8 | P0 | perceived brightness of a color |
| `font_url` | 10 | 4 | P0 | URL of the font file |
| `video_tag` | 9 | 5 | P0 | video element from a media object |
| `item_count_for_variant` | 8 | 7 | P0 | quantity of a variant in the cart |
| `external_video_url` | 7 | 3 | P0 | embed URL with player params |
| `format_address` | 6 | 5 | P0 | address as formatted HTML |
| `standard_event_data` | 6 | 6 | P0 | analytics event payload for a resource |
| `external_video_tag` | 6 | 3 | P0 | iframe embed for hosted video |
| `payment_terms` | 4 | 4 | P0 | installments/terms widget for a product form |
| `structured_data` | 4 | 4 | P0 | JSON-LD for product or article |
| `media_tag` | 4 | 2 | P0 | dispatch to the right tag by media type |
| `payment_button` | 2 | 2 | P0 | accelerated checkout buttons for a product form |
| `applicable_disclosures` | 2 | 2 | P0 | filter a metafield value list to applicable disclosures |
| `metafield_tag` | 2 | 2 | P0 | render a metafield value as HTML by type |
| `login_button` | 2 | 2 | P0 | sign-in widget (e.g. follow shop) |
| `link_to` | 2 | 2 | P0 | anchor element |
| `payment_type_svg_tag` | 2 | 2 | P0 | payment icon svg |
| `handleize` | 2 | 2 | P0 | turn a string into a URL handle |
| `color_contrast` | 2 | 2 | P0 | contrast ratio between two colors |
| `color_modify` | 2 | 2 | P0 | set a color channel |
| `color_lighten` | 2 | 1 | P0 | lighten a color |
| `color_darken` | 2 | 1 | P0 | darken a color |
| `md5` | 1 | 1 | P0 | MD5 hex digest |
| `model_viewer_tag` | 1 | 1 | P0 | 3D model element |
| `preload_tag` | 1 | 1 | P0 | link rel=preload element |
| `time_tag` | 10 | 6 | P1 | time element |
| `shopify_asset_url` | 5 | 2 | P1 | URL of a platform-hosted shared asset |
| `line_items_for` | 3 | 1 | P1 | cart lines for a product or variant |
| `money_without_trailing_zeros` | 2 | 2 | P1 | drops .00 |
| `format_code` | 2 | 2 | P1 | group a gift card code into chunks |
| `default_pagination` | 1 | 1 | P1 | HTML pagination links from the paginate object |
| `default_errors` | 1 | 1 | P1 | HTML list of form errors |

Implementation hints:

- Absolutely core (renders the page frame and every card): `t`, `asset_url`, `image_url`, `image_tag`, `stylesheet_tag`,
  `inline_asset_content`, the `money*` family, `placeholder_svg_tag`, `font_face`/`font_url`/`font_modify`, `color_*`.
- Argument conventions worth fixing early: `image_url: width:, height:, crop:, format:`; `image_tag: loading:, class:, sizes:,
  widths:, alt:, width:, height:`; `t: <named interpolation args>, count:` (many distinct interpolation names appear, e.g. count, link, quantity, index, terms, price, title).
- Can be shipped as a minimal stub at first (low use, advanced widgets): `payment_terms`, `payment_button`,
  `applicable_disclosures`, `login_button`, `standard_event_data`, `model_viewer_tag`, `preload_tag`, `metafield_tag`.
- `json` exists in LiquidJS but must serialize platform objects (drops) the way themes expect; see differences below.

## Filters, standard (provided by LiquidJS)

| Filter | Uses | Files | Prio |
|---|---:|---:|---|
| `append` | 392 | 81 | P0 |
| `escape` | 266 | 74 | P0 |
| `default` | 264 | 95 | P0 |
| `replace` | 218 | 25 | P0 |
| `divided_by` | 182 | 51 | P0 |
| `times` | 157 | 62 | P0 |
| `plus` | 101 | 38 | P0 |
| `round` | 75 | 38 | P0 |
| `json` | 64 | 13 | P0 |
| `split` | 61 | 36 | P0 |
| `strip` | 54 | 30 | P0 |
| `where` | 44 | 15 | P0 |
| `minus` | 42 | 25 | P0 |
| `strip_html` | 35 | 21 | P0 |
| `capitalize` | 29 | 15 | P0 |
| `modulo` | 27 | 18 | P0 |
| `map` | 21 | 12 | P0 |
| `prepend` | 17 | 10 | P0 |
| `last` | 14 | 10 | P0 |
| `first` | 14 | 12 | P0 |
| `strip_newlines` | 13 | 9 | P0 |
| `ceil` | 11 | 8 | P0 |
| `at_most` | 10 | 6 | P0 |
| `size` | 10 | 8 | P0 |
| `compact` | 8 | 8 | P0 |
| `truncatewords` | 7 | 3 | P0 |
| `slice` | 7 | 6 | P0 |
| `date` | 6 | 5 | P0 |
| `floor` | 6 | 6 | P0 |
| `find_index` | 5 | 5 | P0 |
| `sort` | 5 | 3 | P0 |
| `truncate` | 5 | 3 | P0 |
| `reject` | 4 | 4 | P0 |
| `concat` | 4 | 3 | P0 |
| `uniq` | 4 | 4 | P0 |
| `at_least` | 4 | 4 | P0 |
| `abs` | 4 | 4 | P0 |
| `remove` | 3 | 3 | P0 |
| `sum` | 3 | 1 | P1 |
| `join` | 3 | 3 | P0 |
| `downcase` | 2 | 2 | P0 |
| `find` | 2 | 2 | P0 |
| `upcase` | 2 | 2 | P0 |
| `newline_to_br` | 2 | 2 | P0 |
| `has` | 1 | 1 | P0 |
| `sort_natural` | 1 | 1 | P0 |
| `reverse` | 1 | 1 | P1 |

## Global objects

Class for all rows: **Shopify data model** (not part of Liquid itself) except `forloop`, which is a language object.
"Files" counts files where the name is used and not locally defined.

| Object | Uses | Files | Prio | Most used properties (first level) |
|---|---:|---:|---|---|
| `section` | 1875 | 130 | P0 | `settings`, `id`, `blocks`, `index`, `shopify_attributes` |
| `settings` | 1104 | 102 | P0 | `page_width`, `type_body_font`, `logo`, `type_header_font`, `card_style`, `colors_text`, `transition_to_main_product` |
| `block` | 520 | 115 | P0 | `settings`, `id`, `shopify_attributes`, `blocks` |
| `form` | 251 | 23 | P0 | `errors`, `id`, `posted_successfully`, `email`, `name`, `phone`, `body` |
| `forloop` | 195 | 54 | P0 | `index`, `index0`, `first`, `last`, `length` |
| `product` | 128 | 25 | P0 | `selected_or_first_available_variant`, `id`, `title`, `has_only_default_variant`, `media`, `variants`, `url` |
| `shop` | 115 | 31 | P0 | `name`, `shipping_policy`, `customer_accounts_enabled`, `password_message`, `taxes_included`, `policies`, `features` |
| `cart` | 104 | 23 | P0 | `item_count`, `taxes_included`, `currency`, `empty`, `duties_included`, `total_price`, `items` |
| `closest` | 88 | 46 | P0 | `product`, `collection`, `blog`, `article` |
| `request` | 75 | 37 | P0 | `design_mode`, `page_type`, `visual_preview_mode`, `locale`, `origin` |
| `routes` | 55 | 26 | P0 | `cart_url`, `search_url`, `root_url`, `account_login_url`, `all_products_collection_url`, `product_recommendations_url`, `account_url` |
| `search` | 54 | 7 | P0 | `terms`, `results_count`, `results`, `performed`, `filters`, `products_count`, `default_sort_by` |
| `paginate` | 52 | 14 | P0 | `previous`, `next`, `pages`, `current_page`, `parts` |
| `collection` | 48 | 6 | P0 | `image`, `products`, `products_count`, `url`, `title`, `results_count`, `all_products_count` |
| `localization` | 48 | 10 | P0 | `country`, `available_countries`, `available_languages`, `language` |
| `customer` | 29 | 9 | P0 | `orders`, `name`, `email`, `phone`, `default_address`, `addresses`, `addresses_count` |
| `recommendations` | 22 | 4 | P0 | `products`, `performed`, `products_count` |
| `template` | 17 | 7 | P0 | `name` |
| `collections` | 17 | 14 | P0 | `all`, `size` |
| `page_image` | 10 | 2 | P0 | `width`, `height` |
| `page` | 7 | 5 | P0 | `url`, `content`, `title` |
| `content_for_header` | 6 | 6 | P0 | required: platform-injected head markup |
| `canonical_url` | 5 | 5 | P0 | canonical URL |
| `page_description` | 5 | 3 | P0 |  |
| `content_for_layout` | 4 | 4 | P0 | required: rendered template body |
| `page_title` | 4 | 2 | P0 |  |
| `current_page` | 4 | 2 | P0 | page number |
| `powered_by_link` | 2 | 2 | P0 |  |
| `additional_checkout_buttons` | 2 | 2 | P0 |  |
| `content_for_additional_checkout_buttons` | 2 | 2 | P0 |  |
| `current_tags` | 2 | 2 | P0 | tag filters |
| `article` | 118 | 11 | P1 | `image`, `url`, `comments_count`, `content`, `author`, `excerpt`, `title` |
| `predictive_search` | 77 | 2 | P1 | `resources`, `performed`, `terms` |
| `gift_card` | 22 | 2 | P1 | `balance`, `pass_url`, `code`, `enabled`, `expired`, `expires_on`, `qr_identifier` |
| `order` | 21 | 1 | P1 | `name`, `cart_level_discount_applications`, `total_duties`, `total_refunded_amount`, `cancelled`, `cancel_reason_label`, `line_items` |
| `blog` | 16 | 6 | P1 | `moderated`, `comments_enabled`, `articles`, `title`, `url` |

Notes:

- `section`, `block`, `closest` and `form`/`paginate` are contextual: they exist only inside a section render, a
  block render, a block with a parent resource, and between the opening and closing of their tags respectively.
- `closest` is how a nested block reaches the nearest enclosing product, collection, blog or article without prop drilling.
- `settings` is read from the active `settings_data.json` preset; colors, fonts, images and links arrive as typed values
  (see `theme-format.md`).
- `request.design_mode` and `request.visual_preview_mode` should evaluate to false outside an editor.
- Property usage is dominated by editor wiring (`settings`, `id`, `shopify_attributes`) followed by product/media data.

Other frequently read property names across all objects and local aliases (name-only counts, a rough guide to which drop
fields themes expect):

| Property name | Uses |
|---|---:|
| `selected_or_first_available_variant` | 115 |
| `shopify_attributes` | 142 |
| `featured_media` | 55 |
| `preview_image` | 61 |
| `media_type` | 55 |
| `aspect_ratio` | 68 |
| `quantity_rule` | 44 |
| `metafields` | 37 |
| `featured_image` | 43 |
| `available` | 42 |
| `final_price` | 10 |
| `original_price` | 16 |
| `final_line_price` | 10 |
| `original_line_price` | 13 |
| `selling_plan_allocation` | 12 |
| `unit_price_measurement` | 12 |
| `compare_at_price` | 11 |
| `options_with_values` | 10 |
| `items` | 6 |
| `item_count` | 16 |
| `cart_level_discount_applications` | 9 |
| `url_to_remove` | 15 |
| `active_values` | 18 |
| `shipping_policy` | 39 |
| `taxes_included` | 18 |
| `design_mode` | 19 |
| `page_type` | 16 |
| `quantity_price_breaks` | 15 |
| `properties` | 10 |
| `iso_code` | 29 |
| `available_countries` | 14 |
| `available_languages` | 9 |

Observed property names also include, for products and variants: `title`, `handle`, `url`, `price`, `compare_at_price`,
`available`, `options_with_values`, `featured_image`, `featured_media`, `media`, `variants`, `metafields`, `barcode`,
`selling_plan_allocation`; for cart lines: `final_price`, `original_price`, `final_line_price`, `original_line_price`,
`properties`, `unit_price_measurement`, `quantity_rule`, `url_to_remove`; for collections/search: `products_count`,
`all_products_count`, `default_sort_by`, `sort_options`, `filters`, `results_count`, `terms`, `performed`; for
localization: `available_countries`, `available_languages`, `country`, `language`, `iso_code`. Money-typed drop fields
are integers in the smallest currency unit and are formatted only through the `money*` filters (to be confirmed in the
storefront conformance captures).

## Semantic differences to watch (standard names, platform behavior)

These are known areas where matching a Ruby-based reference implementation requires care in LiquidJS; verify each with
conformance fixtures from our own store before relying on them:

- Truthiness and `blank`/`empty` comparisons; `default` with `allow_false: true`.
- `date` with the literal `'now'` and strftime-style formats; time zone of the shop.
- `escape`, `strip_html`, `truncate*` handling of entities and Unicode.
- `json` on drops/hashes; `size` on drops and strings.
- Whitespace trimming of `{%-` / `-%}` inside `{% liquid %}` and around raw blocks.
- `render` isolation and parameter passing; `for` limits/offset with `continue`; `forloop` fields.
- Output of `nil` inside `capture`, array joining when printing arrays, and number formatting (float vs integer division
  in `divided_by`, rounding in `round`/`times`; used heavily for aspect-ratio math).
- Error mode: the platform renders an inline error message for most Liquid errors instead of failing the page.

## P2: not observed in the corpus (public-documentation list; implement on demand)

- Tags: `include` (legacy), `tablerow`, `decrement`, `raw`, `ifchanged`, `render ... for/with`.
- Filters (Shopify-specific): the older asset/URL helpers (`img_url`, `img_tag`, `script_tag`, `product_img_url`,
  `collection_img_url`, `article_img_url`, `file_url`, `file_img_url`, `global_asset_url`), listing helpers
  (`link_to_tag`, `link_to_type`, `link_to_vendor`, `url_for_type`, `url_for_vendor`, `highlight`,
  `highlight_active_tag`, `within`, `weight_with_unit`), customer links (`customer_login_link`,
  `customer_logout_link`, `customer_register_link`), remaining colour helpers (`color_to_rgb`, `color_to_hsl`,
  `color_to_hex`, `color_saturate`, `color_desaturate`, `color_mix`, `color_extract`, `color_difference`),
  hashing/encoding (`sha1`, `sha256`, `hmac_sha1`, `hmac_sha256`, `base64_encode`, `base64_decode`,
  `base64_url_safe_encode`, `base64_url_safe_decode`), text helpers (`camelize`, `pluralize`),
  `metafield_text`, `payment_type_img_url`, `translate` (alias of `t`).
- Objects: `linklists`, `pages`, `blogs`, `articles`, `all_products`, `images`, `metaobjects`, `theme`,
  `shop_locale`, `scripts`, `customer_address`, `discount`, `policy`, `robots`, `country_option_tags`,
  `content_for_index`, `handle`, `current_tags` variants, `app`.
