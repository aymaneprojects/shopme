# Admin UX inventory (functional spec)

Status: draft for v0.1 planning. Audience: admin SPA developers.

This document lists the screens, fields, actions, states and flows the ShopMe admin needs. It describes functionality
only, in our own words. Visual design (dark-blue primary `#1E40AF`, our component library, our icons) is defined
elsewhere and is not derived from any other product. French UI labels appear in parentheses only where a short field
label helps map a field; all strings in ShopMe are ours and go through i18n.

Conventions:

- "MVP (v0.1)" = ships in the first release. "Later" = planned, not in v0.1.
- Type names (`Product`, `ProductVariant`, ...) refer to `docs/spec/admin-api-mvp.md` section 3; tables
  (`products`, `product_variants`, ...) refer to `docs/spec/data-model.md` section 5.
- Where a screen needs data the MVP Admin API does not expose (discounts, shipping zones, taxes config, theme editing,
  staff users), the "Backing data" line says **internal admin endpoint needed** and names a proposed table. The SPA talks
  to the GraphQL Admin API for everything covered by `admin-api-mvp.md` and to an internal REST/JSON "admin-internal"
  namespace for the rest.
- 39 reference screens were reviewed; coverage is listed at the end.

---

## 1. Global shell

### 1.1 Layout

- Persistent left navigation (collapsible), top bar inside the content area per page (back arrow, breadcrumb, page
  actions), content area scrolls independently.
- Settings is a separate "mode": entering it replaces the main nav with a settings nav plus a "back to admin" control.
- The theme editor is a full-screen mode with its own top bar (no main nav).
- Persistent help/assistant widget is **not** in scope.

### 1.2 Navigation items

| Item | Sub-items | v0.1 | Rationale |
|---|---|---|---|
| Home (Accueil) | | MVP | Landing + setup checklist |
| Orders (Commandes) | Drafts (Brouillons), Shipping labels (Étiquettes d'expédition), Abandoned checkouts (Paniers abandonnés) | MVP: Orders only; sub-items Later | Drafts need draft-order API (P2); labels and carts depend on checkout/carriers |
| Products (Produits) | Collections, Inventory (Stock), Purchase orders (Bons de commande), Transfers, Gift cards (Cartes-cadeaux) | MVP: Products, Collections, Inventory; rest Later | Purchase orders/transfers need multi-location supply flows; gift cards are a separate domain |
| Customers (Clients) | Segments, Companies (Entreprises) | MVP: Customers only | Segments need a query-language engine; B2B out of scope |
| Marketing/Growth (Croissance) | | Later | Needs email/campaign subsystem |
| Discounts (Réductions) | | MVP (basic) | Core merchandising; see section 14 |
| Content (Contenu) | pages, blogs, menus, files | Later (v0.2: pages + menus because the theme reads them) | Tables exist (`pages`, `menus`) but no editor needed for first sale |
| Markets (Marchés) | | Later | Single market/currency in MVP |
| Finance (Finances) | payouts, balance | Later | Depends on payment provider |
| Analytics (Analyses de données) | reports | Later | Needs event pipeline; Home shows minimal stats instead |
| Sales channels (Canaux de vente) | Online store (Boutique en ligne): Themes, Pages, Navigation, Preferences | MVP: Online store > Themes only | Single channel in MVP |
| Apps (Applications) | installed app entries | Later | No app platform in v0.1 |
| Settings (Paramètres) | see 1.6 | MVP subset | |

The nav item list is data-driven (config array: `id`, `labelKey`, `route`, `icon`, `children`, `badge`, `flag`) so that
Later items can be hidden by a feature flag rather than removed.

Badges: Orders shows a count badge of orders needing action (unfulfilled and open). Computed from `ordersCount` with
the query for unfulfilled orders.

### 1.3 Global search

- Opens from a search box at the top of the nav and from a keyboard shortcut (Ctrl/Cmd + K).
- MVP: command palette with free-text query returning grouped results: products, collections, customers, orders (by
  number), plus nav destinations and settings pages. Debounced; each group limited to about 5 hits with "see all".
- Data: `products(query:)`, `collections(query:)`, `customers(query:)`, `orders(query:)` in parallel (cost-limited).
- Later: recent items, actions ("create product"), saved searches.

### 1.4 Store switcher / account menu

- Bottom of nav: store name, environment badge (e.g. "dev"/"live"), and an account menu: profile, switch store (list of
  shops the staff user belongs to), log out.
- MVP: one store per login, so the switcher shows the current store and the account menu offers profile and log out.
  Multi-store switching: Later (needs `shop_users` membership, multi-tenant RLS already in `data-model.md` section 2).
- Data: `shop` (name, primaryDomain, currencyCode) plus internal `/admin/session` returning the staff user and
  memberships.

### 1.5 Notifications

- Bell icon with unread dot opening a panel (list of events: new order, low stock, failed job).
- MVP: Orders nav badge only, plus toast banners for async `Job` completion (bulk updates, collection recompute).
- Later: notification centre fed from `outbox_events`.

### 1.6 Settings navigation

Settings groups in the settings nav, with v0.1 decision:

| Entry | v0.1 |
|---|---|
| Store details (name, contact email, address, currency, units, time zone) | MVP (see section 16.1) |
| Plan / Billing | Not applicable for self-hosted |
| Users and permissions (Utilisateurs) | MVP minimal: owner + staff list with invite; roles Later |
| Payments (Paiements) | MVP: provider connection + manual methods (16.2) |
| Checkout (Paiement) | Later (checkout customisation) |
| Customer accounts | Later |
| Shipping and delivery | MVP (16.3) |
| Taxes and duties | MVP basic (16.4) |
| Locations (Emplacements) | MVP: list/add/edit locations (needed for inventory) |
| Markets | Later |
| Apps / Sales channels | Later |
| Domains | MVP (16.5) |
| Customer events | Later |
| Notifications (email templates) | MVP: order confirmation + shipping confirmation templates |
| Custom data (metafield/metaobject definitions) | MVP: metafield definitions for products only (see 4.9) |
| Languages | MVP minimal (16.6) |
| Customer privacy | Later |
| Policies | MVP: free-text policy pages (refund, privacy, terms) |

A settings-local search box filters this nav.

### 1.7 Cross-cutting UI patterns (implement once)

- **Resource list** component: tabs/saved views, search + filter bar, sortable columns, column chooser, row selection,
  bulk-action bar, cursor pagination (`pageInfo`), empty state with learn-more link.
- **Resource form** (detail/create): main column of cards, right sidebar of metadata cards, sticky save bar that appears
  when the form is dirty (Save / Discard), unsaved-changes guard on navigation, previous/next record arrows.
- **Rich text editor** (product/collection description): block format dropdown (paragraph, headings), bold, italic,
  underline, text colour, alignment, link, image, video embed, table, bullet/numbered lists, indent/outdent, clear
  formatting, HTML source toggle. Output sanitised HTML stored in `description_html`.
- **Tag input**, **combobox with create-on-the-fly** (type, vendor, collections), **money input** (shop currency), **unit
  input** (weight/dimension with unit select), **toggle**, **segmented control**, **confirm dialog**, **toast**.
- **Activity timeline** with comment composer (staff-only), reused by orders and customers.
- **Right-sidebar status card** reused by product and collection.

---

## 2. Home / Dashboard

Screen: landing page after login.

Content (reference shows):

- Store status line ("ready to sell" style indicator) and a storefront preview thumbnail with a "private/password"
  badge and a "launch store" action.
- Free-text prompt box (assistant). **Not in scope.**
- Shortcut chips for pending work (for example "process orders N").
- Setup guide cards: configure payments, get a custom domain, review store policies.

MVP (v0.1):

- Store status card: storefront published / password-protected, link to storefront, "publish store" toggle.
- Shortcut: "Process N unfulfilled orders" linking to the Orders list with the unfulfilled filter.
- Setup checklist (derived, each links to the right settings page): add a product, add payment provider, connect domain,
  set shipping rates, review policies. Completed items collapse.
- Quick counters for today (orders, sales) using `ordersCount(query: "created_at:>=...")` and sum on the server.

Later: sales/traffic charts, recommendations, assistant, recent activity feed.

Backing data: `shop`, `ordersCount`, `productsCount`, `Location`, internal `/admin/setup-progress` (derives checklist
from existing rows: products exist, `shop_domains` verified, payment provider configured, shipping zones present).
Storefront password flag: `shops.storefront_password_enabled` (propose; add to `shops`).

---

## 3. Products list

Route: `/admin/products`.

Header actions: Import (CSV), Export (CSV), "Add product" (primary). A "view as" action (preview for a market/customer
type) is Later.

Summary strip (period selector, three KPIs: average sell-through rate, products by days of stock remaining, ABC
analysis): **Later**. MVP shows nothing or a simple count.

Toolbar: saved-view selector (default "All"), search input, filter chips, sort menu, column chooser.

- Saved views / tabs: All, Active, Draft, Archived. Custom saved views: Later (needs `savedSearchId`).
- Search: free text over title, SKU, vendor, tag. Maps to `products(query:)`.
- Filters (MVP): status, product type, vendor, tag, collection, inventory state (in stock / out of stock / low),
  sales-channel published yes/no. Later: category taxonomy, gift card, price range, created date, metafield.
- Sort (MVP): title, created, updated, inventory total, product type, vendor (`ProductSortKeys`).

Columns (MVP): row checkbox, thumbnail, Product (title), Status (badge), Inventory (text such as "N in stock for M
variants", red when zero or negative), Product type, Vendor.
Reference also shows Category, Channels count and Catalogs count: Later (single channel, no catalogs).

Row click opens `/admin/products/:id`.

Bulk actions on selection (MVP): set status (active/draft/archived), delete, add/remove tags, add to collection.
Later: bulk edit variants spreadsheet, set metafields, publish/unpublish per channel, duplicate.

Pagination: cursor, page size selector (25/50/100).

States: loading skeleton rows, empty (no products: CTA to add or import), no results (clear filters), error banner.

Backing data: `products(first, after, sortKey, reverse, query)`, `productsCount`, `productTypes`, `productVendors`,
`productTags` (filter options); fields `Product { id title status featuredMedia totalInventory tracksInventory
productType vendor tags }`. `productUpdate` / `productDelete` for bulk (looped, or internal bulk job via `Job`).

---

## 4. Product detail / create

Routes: `/admin/products/new`, `/admin/products/:id`, and variant deep link `/admin/products/:id/variants/:variantId`
(the page shows the variant editor pane selected; the breadcrumb shows product / variant).

Layout: main column (cards) + right sidebar (status, organisation). Header actions on an existing product: Preview
(store preview of the page), Share (copy preview link), "More actions" menu (duplicate, archive, delete), previous/next
product arrows.

### 4.1 Title and description

- Title (required, text). Placeholder when new.
- Description: rich text editor (section 1.7). Stored as sanitised HTML.
- MVP: both. Later: AI draft helpers.

### 4.2 Media

- Gallery at top: first item is the featured image; drag-to-reorder; "+" tile to upload; also supports videos and 3D
  models in the reference.
- MVP: images only (upload, reorder, delete, alt text, assign image to variant). Later: video, 3D, external video.
- Data: `media` (`MediaImage`), `productCreate(media:)`, `productUpdate(media:)`, `productReorderMedia`; upload via
  `stagedUploadsCreate` + `fileCreate` (P2 in the API spec, so the MVP needs a simplified internal multipart upload
  endpoint that returns a media id).

### 4.3 Options and variants editor

Behaviour:

- A product starts with a single implicit default variant, so the pricing/inventory/shipping cards appear directly under
  the description (single-variant layout, see 4.4-4.6).
- An "Add options like size or color" control opens an option editor: option name (with suggestions), value list
  (add/remove/reorder values with enter-to-add), "add another option" (cap 3 options, 2048 variants total in the model
  limits), done/delete option.
- After at least one option exists, the page switches to **variant layout**: an option summary bar (chips per option
  with first few values and a "+N" overflow, "+" to add an option) above a two-pane variant editor.
  - Left pane: variant list with select-all checkbox, "N variants" count, search box, filter/group-by menu (group by
    option), "+" to add variant manually; each row shows thumbnail, variant title, price and total available.
  - Right pane: editor for the selected variant: image, title, "all channels" availability pill, overflow menu (delete),
    then price, inventory, shipping groups, variant metafields (4.4 to 4.8).
  - Multi-select in the left pane enables bulk editing the same fields (price, compare-at, cost, SKU, inventory, weight)
    for selected variants.
- Changing options regenerates the Cartesian product of values: new combinations are created with default price copied
  from the first variant; removed values prompt a confirmation listing variants that will be deleted.
- Disabling/removing the last option collapses back to the single default variant (keeps the first variant's data).

MVP: full behaviour above except grouped variant filters beyond group-by-option, and bulk spreadsheet editing. Later:
variant-specific images in bulk, reorder variants by drag, "unlisted" variants.

Data: `productOptionsCreate`, `productOptionUpdate`, `productOptionsDelete`, `productVariantsBulkCreate`,
`productVariantsBulkUpdate`, `productVariantsBulkDelete`; types `ProductOption`, `ProductOptionValue`, `ProductVariant`,
`SelectedOption`; tables `product_options`, `product_option_values`, `product_variants`, `variant_option_values`.
The SPA should compute the variant diff client-side and send one `productVariantsBulkCreate`/`Update` per save; use
`productSet` (P1) as a single-call alternative for "save the whole tree".

### 4.4 Pricing (per variant; single-variant layout shows it inline)

| Field | Notes | v0.1 |
|---|---|---|
| Price (Prix) | money, required, >= 0 | MVP |
| Compare-at price (Prix avant réduction) | revealed by an "add" chip; must be higher than price to show as a sale | MVP |
| Cost per item (Coût par article) | revealed by chip; not shown to customers; drives margin/profit display | MVP |
| Unit price (Prix unitaire) | measure-based price (per 100 ml etc.): total quantity and base measure | Later |
| Charge tax (Facturer la taxe) | toggle, default on; maps to `taxable` | MVP |

The margin and profit (price - cost) are shown read-only once cost is set (MVP, simple arithmetic).
Data: `ProductVariant.price`, `compareAtPrice`, `taxable`; `InventoryItem.unitCost`; tables `product_variants`
(`price`, `compare_at_price`, `taxable`), `inventory_items` (`cost`).

### 4.5 Inventory (per variant)

- "Track quantity" toggle (default on), maps to `InventoryItem.tracked`.
- When tracking is on, a quantity table lists each active location with an editable quantity (new product) or, for an
  existing variant, per-location block: location name with edit (choose which locations stock this item), a quantity
  input with a unit selector for the editable state ("Available"), and read-only "Committed" and "Unavailable" counts;
  a history icon opens the adjustment history (reason log) (history: Later).
- Chips to reveal: SKU, Barcode (ISBN/UPC/GTIN).
- "Continue selling when out of stock" toggle, maps to `inventoryPolicy` DENY (off) / CONTINUE (on).
- Editing the existing quantity uses `inventoryAdjustQuantities`/`inventorySetQuantities` with a reason; create-time
  quantities go into the initial inventory levels.

MVP: all of the above except history, "on hand" named-quantity unit selector (only "available" editable) and
"incoming".
Data: `InventoryItem { sku tracked }`, `InventoryLevel { quantities(names) }`, `Location`, `ProductVariant {
inventoryPolicy barcode }`; mutations `inventoryItemUpdate`, `inventorySetQuantities`, `inventoryActivate`,
`inventoryDeactivate`; tables `inventory_items`, `inventory_levels`, `inventory_quantities`, `locations`.

### 4.6 Shipping (per variant)

- "This is a physical product" toggle (maps to `requiresShipping`; off hides the rest and the order line later shows
  "no shipping required").
- Product weight (value + unit: kg, g, lb, oz).
- Package dimensions L x W x H with unit (cm, in, ...). **Later** (no carrier rates in MVP).
- Package selector ("shop default package" or a saved package): **Later**.
- Chips: Country/region of origin, HS code (customs), "shipped to" markets note: HS code and origin are MVP-optional
  free fields stored on the inventory item (cheap to keep, needed for customs later); the rest Later.

Data: `InventoryItem { requiresShipping measurement.weight countryCodeOfOrigin harmonizedSystemCode }` (see
`InventoryItemMeasurement`, `Weight`); tables `inventory_items` (`weight_value`, `weight_unit`, `requires_shipping`).

### 4.7 Purchase options (selling plans)

An empty "add purchase option" area (subscriptions). **Later** (selling plans are out of scope in the API spec).

### 4.8 Variant metafields and product metafields

- Variant metafields card ("pinned" definitions only, with an "Add" action).
- Product metafields card lists pinned metafield definitions as label + value editor (type-aware: number with unit,
  text, etc.), a "show all" expander, and links to add an unpinned/ad hoc metafield.
- MVP: product metafield card with definitions of types single-line text, multi-line text, integer, decimal,
  measurement (value + unit), boolean, date, URL, JSON; set via `metafieldsSet`. Variant metafields: Later.
- Data: `Metafield`, `metafieldDefinitions(ownerType: PRODUCT)`, `metafieldsSet`; tables `metafields` (and a
  `metafield_definitions` table to add).

### 4.9 Search engine listing (SEO)

- Preview card showing how the page may appear in a search result: page title, description, URL path, thumbnail.
- Edit mode (pencil): page title (defaults to product title, with a character counter), meta description (counter),
  URL handle (editable slug with uniqueness check), "create URL redirect when handle changes" checkbox.
- On a new product the card shows a hint until a title exists.
- MVP: full. Data: `Product.seo { title description }`, `Product.handle`, `url_redirects` (redirect rows created by the
  server on handle change); columns `products.seo_title`, `seo_description`.

### 4.10 Right sidebar: status and organisation

| Control | Behaviour | v0.1 |
|---|---|---|
| Status | dropdown: Active, Draft (and Archived; Unlisted is Later); badge colour per state | MVP |
| Publishing | where the product is available (sales channels list with checkboxes; "N channels"); in MVP a single "Online store" checkbox that sets/clears `publishedAt`; also scheduled publishing date Later | MVP (single channel) |
| Catalogs/markets | count of catalogs including the product | Later |
| Category (Catégorie) | taxonomy picker | Later (free `productType` in MVP) |
| Product type (Type) | combobox, create-on-the-fly, suggestions from `productTypes` | MVP |
| Vendor (Fournisseur) | combobox, create-on-the-fly, suggestions from `productVendors` | MVP |
| Theme template (Modèle de thème) | select among product templates of the main theme (default or alternates, from `templates/product.*.json`) | MVP (needs `theme_files` listing) |
| Collections | chips + add control: multi-select dialog of manual collections (automated collections are shown read-only, not selectable) | MVP |
| Tags (Balises) | tag input with suggestions from `productTags` | MVP |

Data: `Product { status publishedAt productType vendor tags templateSuffix collections }`; `productUpdate`;
`collectionAddProductsV2`/`collectionRemoveProducts`; `tagsAdd`/`tagsRemove` for bulk. Tables `products`,
`collection_products`, `product_tags` (see section 5.8 of data model).

### 4.11 Create-specific behaviour

- Same page, no sidebar arrows; "Save" creates the product and redirects to `/admin/products/:id`.
- Required to save: title. Price defaults 0.00. Default status Active in the reference; ShopMe default: **Draft** unless
  the user picks Active (safer).
- Quantity table lists all active locations with 0 defaults.

### 4.12 Form states

Dirty state with sticky Save/Discard; saving spinner; validation errors from `userErrors` mapped by `field` path to
inputs; conflict banner when `updatedAt` changed under the user (optimistic concurrency, MVP-simple).

---

## 5. Collections list

Route: `/admin/collections`. Header action: "Add collection".

- Tabs/views: All, plus (Later) saved views. Search/filter: text search over title; type filter manual/automated (MVP).
- Columns: checkbox, image, Title, Products (count), Conditions (human-readable summary of the rules for automated
  collections, blank for manual), Sales channels count (Later; hide in MVP).
- Row click -> `/admin/collections/:id`. Bulk: delete (MVP), publish/unpublish (Later).
- Data: `collections(query)`, `collectionsCount`, `Collection { id title image productsCount ruleSet }`.

## 6. Collection create / edit

Routes: `/admin/collections/new`, `/admin/collections/:id`.

Main column:

- Image upload (square tile), Title (required), description (rich text).
- Header line chips: sales channel availability ("N channels") and theme template picker (default or alternate
  `templates/collection.*.json`). MVP: template picker and a single published toggle.
- "Products in the collection" card with count: view toggle grid/list, filter by status, columns-per-row control (grid),
  sort selector (most relevant, manual, best selling, price asc/desc, alphabetical, newest/oldest). The sort selector
  maps to `CollectionSortOrder`; manual order enables drag-reorder (`collectionReorderProducts`).
  Reference default filter shows all statuses (active, draft, unpublished, archived).
- Manual collection: "Add products" opens a searchable product picker; per-row remove action.
- Right sidebar: collection type selector (products vs other types), hidden for Later types; action menu (duplicate,
  preview, delete) in the header.

### 6.1 Collection type: manual vs automated

A collection is **manual** or **automated** (set at creation by whether conditions are used; switching is limited:
adding conditions converts to automated, removing all conditions to manual - after confirmation). The right card shows
the conditions builder:

- "Products must match: all conditions / any condition" selector (AND/OR) = `ruleSet.appliedDisjunctively`.
- Each rule = field select + relation select + value input, with remove; "Add another condition".
- Fields and operators (aligned with `admin-api-mvp.md` section 3.1):

| Field | Allowed operators | Value input |
|---|---|---|
| Product tag (TAG) | is equal to, is not equal to, is set, is not set (Later) | text |
| Product title (TITLE) | equals, not equals, starts with, ends with, contains, does not contain | text |
| Product type (TYPE) | equals, not equals, starts with, ends with, contains, does not contain | text/combobox |
| Product vendor (VENDOR) | same as type | text/combobox |
| Price (VARIANT_PRICE) | equals, not equals, greater than, less than | money |
| Compare-at price (VARIANT_COMPARE_AT_PRICE) | equals, not equals, greater than, less than, is set, is not set | money |
| Weight (VARIANT_WEIGHT) | equals, not equals, greater than, less than | number + unit |
| Inventory stock (VARIANT_INVENTORY) | equals, not equals, greater than, less than | integer |
| Variant title (VARIANT_TITLE) | text relations | text |
| Price is reduced (IS_PRICE_REDUCED) | is true / is false (Later: could be a relation `equals`) | boolean |

MVP supports those ten. Later: category taxonomy, product/variant metafield conditions. The exact valid-operator matrix
must follow what the data-model rule engine accepts (open item in the API spec); the SPA should read the matrix from a
constant shared with the API package, not hardcode it twice.

- Live preview: after changing rules the products card refreshes (debounced) to show the matched products and count.
- Membership recompute is asynchronous (outbox event), so a "recomputing" state is possible after saving large catalogs.

Data: `collectionCreate`, `collectionUpdate` (with `ruleSet`, `sortOrder`, `templateSuffix`, `image`, `seo`),
`collectionDelete`, `collectionAddProductsV2`, `collectionRemoveProducts`, `collectionReorderProducts`; types
`Collection`, `CollectionRuleSet`, `CollectionRule`; tables `collections`, `collection_rules`, `collection_products`.
Collection SEO card (same as 4.9) is MVP.

---

## 7. Inventory

Route: `/admin/inventory`.

- Header: title, **location selector** (one location at a time; MVP also an "all locations" aggregate), actions: Export,
  Import (CSV), and "Inventory counts"/stock take (Later).
- Toolbar: saved views (All), search and filter (by SKU, product title, vendor, type, tag; inventory state), column
  chooser.
- Columns: checkbox, thumbnail, Product + variant label (chip), SKU ("no SKU" placeholder), Unavailable, Committed,
  Available (editable inline), On hand (editable), Incoming (Later).
- Inline editing: edit Available (and On hand) cell; save issues one batched `inventoryAdjustQuantities` /
  `inventorySetQuantities` with reason "correction" (selectable reason: Later). Bulk selection to change many rows is
  Later.
- Header tooltips explain each quantity state (our own help texts).
- Sort by product, SKU, quantities. Variants with tracking off are hidden or shown as "not tracked".

MVP: location selector, search/filter, inline Available edit, Export/Import CSV (import can slip to v0.2), sort.
Later: on-hand editing, incoming/transfers/purchase orders, adjustment history, counts.

Data: `inventoryItems(query)`, `InventoryItem`, `InventoryLevel { quantities(names:["available","committed",
"on_hand","incoming"]) location }`, `locations`; mutations as 4.5. Tables `inventory_items`, `inventory_levels`,
`inventory_quantities`.

---

## 8. Orders list

Route: `/admin/orders`.

- Header: location filter ("all locations" default), actions: Export, "Create order" (draft order: Later).
- KPI strip with period selector (orders, items ordered, returns, fulfilled orders, delivered orders): MVP shows orders
  count and sales for the period; the rest Later.
- Saved views/tabs: All, Unfulfilled, Unpaid, Open, Closed (MVP, fixed). Custom saved views Later.
- Search: free text over order number, customer name/email, product title, SKU. `orders(query:)`.
- Filters (MVP): payment status, fulfillment status, order status (open/closed/cancelled), date range, customer, tag,
  channel (Later), delivery method (Later), location (Later), risk level (Later), returns status (Later).
- Sort: date, order number, customer, total, payment status, fulfillment status, items (`OrderSortKeys`).

Columns (MVP): checkbox, Order (#number, with a warning marker when attention is needed, e.g. test order or address
problem), Date (relative today / date), Customer, Channel (Later), Total, Payment status, Fulfillment status, Items
(count), Delivery status (Later), Delivery method (Later), Tags (optional column), "Fulfill by" date (Later).

Status badges:

- Payment: pending, authorized, partially paid, paid, partially refunded, refunded, voided, expired
  (`OrderDisplayFinancialStatus`).
- Fulfillment: unfulfilled, partially fulfilled, fulfilled, scheduled, on hold, restocked, no shipping required
  (`OrderDisplayFulfillmentStatus`); an "open/closed" lifecycle attribute is separate.

Bulk actions (MVP): mark as fulfilled? (no: needs per-order review) -> MVP: add/remove tags, archive (close), cancel
(with the cancel dialog). Later: print packing slips, capture payment, bulk fulfil, delete drafts.

Data: `orders`, `ordersCount`, `Order { name createdAt customer displayFinancialStatus displayFulfillmentStatus
totalPriceSet currentSubtotalLineItemsQuantity tags test closed cancelledAt }`; tables `orders`, `order_line_items`.

---

## 9. Order detail

Route: `/admin/orders/:id`. Header: back arrow, order number with payment and fulfillment badges, date and channel line,
buttons: **Refund**, **Edit** (Later), "More actions" menu, previous/next order arrows.

More actions menu (MVP): print order/packing slip (Later), duplicate (Later), archive/unarchive (`orderClose`/`orderOpen`),
cancel order (`orderCancel` dialog with reason, restock toggle, notify customer, staff note, refund method), view
customer's order history link. Test-order banner when `order.test` is true.

Main column cards (top to bottom):

1. **Fulfillment card(s)**: one card per fulfillment group. Unfulfilled card: heading with state, location chip,
   shipping-method line or "no shipping required", list of line items (thumbnail, product, variant chip, SKU, unit
   price x quantity, line total), primary button **Mark as fulfilled** (with a split menu: mark fulfilled / create
   shipping label (Later)). Fulfilling opens a dialog: items and quantities to fulfil, tracking company and number
   (optional), notify-customer checkbox. Fulfilled card shows tracking info, status, and actions (edit tracking,
   cancel fulfillment).
2. **Payment summary card**: payment-state heading; rows: subtotal (item count), discounts, shipping, taxes
   (itemised), total, paid/outstanding, refunded, net. Buttons: Collect payment / Mark as paid (when pending),
   Capture (when authorised), Refund (when paid). Data from `OrderTransaction` list.
3. **Timeline**: comment composer (staff-only note, with emoji/mention/attachment affordances: MVP supports plain text and
   image attachment Later) and a chronological event list: confirmation email sent (with "view email"), payment
   events, order created, fulfillment events, refunds, comments, edits. Comments can be edited and deleted by author.

Right sidebar cards:

- Notes (single free-text note, edit inline) - `orderUpdate(note)`.
- Sales channel info (channel name) - MVP shows "online store"/"admin".
- Customer: name link to customer page, order count, email, phone; overflow menu: edit contact info, remove customer.
- Shipping address and Billing address: formatted blocks with edit, address-validation warning marker when the address
  is incomplete (MVP: basic required-field validation only).
- Conversion summary, Order risk/fraud analysis: Later.
- Tags: tag input - `tagsAdd`/`tagsRemove`.
- Additional details (custom attributes, PO number): Later.

MVP actions: view, add comment, mark as fulfilled (+ tracking), refund (full or by line item with restock and shipping
refund options, reason note, notify customer), cancel, archive, edit tags/notes/shipping address/email.
Later: order editing (add/remove items), returns, exchanges, shipping labels, print, resend email (MVP-lite: resend
confirmation), payment capture flows beyond authorise/capture, fraud analysis, draft orders.

Data: `order(id)` with `lineItems`, `fulfillments`, `transactions`, `refunds`, `shippingAddress`,
`billingAddress`, `customer`, `taxLines`, `shippingLines`, `events` (timeline: **needs an `events` connection or internal
`order_events` table**; the API spec lists no `Order.events`, so add table `order_events` and an internal timeline
endpoint). Mutations `orderUpdate`, `orderClose`, `orderOpen`, `orderCancel`, `orderMarkAsPaid`, `orderCapture`,
`refundCreate`, `fulfillmentCreate`, `fulfillmentCancel`, `fulfillmentTrackingInfoUpdate`. Tables `orders`,
`order_line_items`, `order_transactions`, `fulfillments`, `fulfillment_orders` (minimal), `refunds`, `refund_line_items`,
`order_tax_lines`, `order_shipping_lines`.

---

## 10. Customers list

Route: `/admin/customers`. Header: Export, Import, "Add customer".

- Segment bar: free-text "describe your segment" query box with a dropdown: **Later** (segmentation language/AI).
  MVP: fixed saved filters (All, Subscribed to email, Has orders, No orders, Repeat customers - computed from
  columns).
- Search box (name, email, phone). Filter (MVP): email subscription state, location (country), order count range,
  amount spent range, tag.
- Columns: checkbox, Customer name (with a note-present icon when a note exists), Email subscription state badge,
  Location (city, country), Orders (count), Amount spent. Column chooser Later.
- Sort: name, location, last order, orders, amount spent (`CustomerSortKeys`).
- Bulk: add/remove tags, export selected, delete (restricted if orders exist), send email Later.

Data: `customers(query)`, `customersCount`, `Customer { displayName defaultEmailAddress defaultAddress
numberOfOrders amountSpent note tags emailMarketingState }`; table `customers`, `addresses`.

## 11. Customer detail

Route: `/admin/customers/:id`. Header: name, "More actions" (delete, merge Later, send invite Later), previous/next.

Main column:

- Stats row: amount spent, orders, customer since (relative duration), plus a group/segment cell (Later).
- Last placed order card: test banner when applicable, order number link, badges, date/channel, total, line items;
  actions "View all orders" (links to orders list filtered by customer) and "Create order" (Later).
- Timeline with staff comment composer and events (emails sent, orders created, customer created).

Right sidebar:

- Contact info: email (copy action), notification language, last-login indicator; overflow to edit contact.
- Default address (formatted) with "Manage addresses" (add/edit/delete/set default).
- Email marketing subscription state (and SMS: Later) with edit.
- Tax details: tax-exempt toggle (collect tax / do not collect) - MVP toggle; exemptions list Later.
- Store credit: Later.
- Tags: tag input.
- Notes: free text with edit.

Create/edit customer form (modal or page `/admin/customers/new`): first name, last name, language, email, phone,
email-marketing consent checkbox, address (country, name, company, address lines, city, region, postal code, phone),
tax-exempt checkbox, note, tags.

MVP: all the above except SMS, store credit, merge, and customer groups. Data: `customerCreate`, `customerUpdate`,
`customerDelete`, `customerAddress*` mutations, `tagsAdd/Remove`, `orders(query:"customer_id:...")`; tables `customers`,
`addresses`, plus `customer_events` (propose) for the timeline.

---

## 12. Discounts list

Route: `/admin/discounts`. Header: Export, "Create discount".

- Views: All, Active, Scheduled, Expired (MVP). Search by title/code.
- Columns: checkbox, Title/code with a one-line summary (value, scope, minimum), Status badge (active, scheduled,
  expired), Method (code or automatic), Eligibility (all customers / segment), Type (see 13), Combines-with icons
  (products, orders, shipping), Used (count).
- Bulk: activate, deactivate, delete.

**Not in `admin-api-mvp.md`** (discounts are explicitly out of scope there): requires internal endpoint set
`/admin-internal/discounts` and tables `discounts`, `discount_codes`, `discount_targets` (propose in `data-model.md` in a
follow-up).

MVP: list + search + status views. Later: segment eligibility, bulk ops, export.

## 13. Discount type chooser

A modal opened by "Create discount" with four types, each with a one-line description:

| Type | Behaviour | v0.1 |
|---|---|---|
| Amount off products | percentage or fixed amount off selected products/collections | MVP |
| Buy X get Y | buy quantity/amount of X, get quantity of Y at a percentage off or free | Later |
| Amount off order | percentage or fixed amount off the whole order subtotal | MVP |
| Free shipping | shipping cost removed (all or selected rates/countries, optional max rate) | MVP |

## 14. Discount form

Route: `/admin/discounts/new?type=...` and `/admin/discounts/:id`.

Layout: main column of cards, right summary card that restates the discount in plain language as the form changes
(type, who, where, minimum, limits, combinability, start date).

Cards (MVP unless marked):

1. **Method**: segmented control **Discount code** / **Automatic discount**. Code: text input (unique, case
   insensitive) with "Generate random code"; helper noting customers type it at checkout. Automatic: a title shown on
   the cart (title field replaces code).
2. **Value** (for amount-off types): value type selector (percentage / fixed amount) + number input; "Applies to"
   selector: specific collections / specific products / (order discount: whole order); product/collection picker with
   search and browse; purchase type: one-time purchase / subscription / both (subscription: Later).
   - Free shipping: country scope (all countries / selected countries), exclude shipping rates over an amount
     (checkbox + amount).
3. **Eligibility** (customer eligibility): all customers / specific customer segments / specific customers. MVP: all
   customers + specific customers; segments Later.
4. **Minimum purchase requirements**: none / minimum purchase amount / minimum quantity of items.
5. **Maximum discount uses**: checkbox limit total uses (number); checkbox limit one use per customer.
   (Code discounts only for the per-customer limit.)
6. **Combinations**: checkboxes for which other discount classes it may combine with (product discounts, order
   discounts, shipping discounts). Default: none. Later: only MVP flag per class stored.
7. **Active dates**: start date and time (time zone shown), optional end date toggle. Statuses derive from dates and an
   active flag.
8. **Sales channel access** (right sidebar): checkbox limiting promotion to selected channels. Later.
9. **Tags**: Later.

Actions: Save (creates and returns to detail), Deactivate/Activate, Delete, Duplicate (Later).
Validation: code unique per shop; value > 0; percentage <= 100; end after start.

Pricing engine implication: discount evaluation must run identically in cart, checkout and admin order totals, so the
rule shape (target, value, minimum, combinations, limits, window) is the contract between this form and the storefront
spec (`ajax-cart-api.md` and the future checkout spec).

---

## 15. Online store theme editor

Entry: Online store > Themes shows the live theme and a library; "Customize" opens `/admin/themes/:id/editor`.
Theme library: MVP shows installed themes, role badge (live / unpublished), actions: Customize, Publish, Duplicate,
Delete, Upload theme (zip, per `docs/spec/theme-format.md`). Edit code and theme store: Later.

### 15.1 Editor frame

- **Top bar** left: exit button, three mode buttons: *Sections* (page structure), *Theme settings*, *Apps* (Later).
  Centre: theme name with a state badge (draft/live), page selector (home, product, collection, cart, page, blog,
  search, 404, etc.; each template is a JSON file in the theme). Right: inspect/select-mode toggle (click an element in
  the preview to select its section/block), desktop/mobile preview toggle, undo/redo, overflow menu (reset, preview in
  a new tab, share preview link, language), **Publish** and **Save** buttons (Save disabled until changes).
- **Left panel** changes with mode.
- **Preview canvas** is an iframe rendering the storefront with the draft settings (our renderer in preview mode with
  a signed token); hover outlines sections; click selects.
- **Right panel** appears for the selected section or block.

### 15.2 Sections mode (tree)

- Page name heading, then grouped lists: **Header group**, **Template** (page sections, the main area), **Footer
  group**. Groups come from the theme's section groups; each group has "Add section".
- Each section row: expand/collapse arrow, drag handle, name (with the primary text appended for blocks), eye
  (hide/show) and delete on hover; selected row highlighted; children listing the section's blocks with an "Add block"
  entry; blocks can be nested (container blocks) and reordered by drag.
- Floating toolbar over the selected element: duplicate, hide, delete (AI "ask for changes" omitted).
- Static/"fixed" sections (e.g. header, footer) cannot be deleted or moved outside their group but can be hidden when
  allowed.

### 15.3 Add-section picker

A popover opened from any "Add section":

- Search box; tabs: Sections and Apps (Apps: Later).
- A "generate" entry (AI): out of scope.
- Categories (collapsible), each listing section presets by name; example categories seen: banners (hero variants,
  slideshow variants, large logo, split showcase), collections (collection links, collection lists in grid, carousel,
  bento, editorial layouts), forms (contact form, newsletter signup), layout (custom Liquid, custom section, divider),
  storytelling (blog post carousel, ...), plus product-related, text/media, and footer-type categories.
- Category and name come from each section's schema `presets` and `category`; thumbnail/preview pane to the right
  shows the preset preview image from the theme (`presets[].preview` or generated).
- Choosing a preset inserts it after the current position with its default blocks and settings.
- Filtering respects section schema `enabled_on` / `disabled_on` and the group (header-group-only sections do not appear
  in the template list).

### 15.4 Section settings panel

Rendered from the section schema. Setting input types the panel must support (MVP set):

text, textarea, rich text (inline formatting), image picker (with upload, library, choose from files), video, link
(URL, page, product, collection picker, "open in new tab" toggle), select/dropdown, segmented control (short option
lists), radio, checkbox/toggle, range slider with numeric box and unit (px), number, colour picker (palette swatches +
custom), colour scheme picker, font picker, collection/product/blog pickers, menu (link list) picker, header/paragraph
(static labels), and metafield-binding "connect dynamic source" icon on supported fields.

Observed grouping on a hero-type section: media 1 and media 2 (type image/video + picker), mobile media options
(stack media, show different media on mobile), section link (URL + new tab), layout (direction vertical/horizontal,
alignment, heights), appearance (colour scheme, background, overlay), spacing (padding top/bottom). Dividers/headers
come from schema `header` entries. Panel title shows section name with overflow menu (duplicate, hide, delete) and a
close button.

### 15.5 Block settings panel

Opened by clicking a block row or element. Example "heading" block groups: text content (inline rich text with font
preset menu, bold, italic, link, lists), layout (width: fit/fill; max width: narrow/normal/none), typography (text
preset select such as heading level styles, with a pointer to theme settings), appearance (text colour, background
toggle), spacing (top/bottom/left/right padding sliders with numeric box in px), and a "Delete block" action at the
bottom. Blocks may be static (fixed, cannot delete).

### 15.6 Theme settings mode

Accordion list (one open at a time optional) from `config/settings_schema.json` groups; groups seen: Logo and favicon,
Colour palette, Typography, Page (layout widths), Animations, Badges, Buttons, Cart, Drawers, Icons, Input fields,
Pop-ups and modals, Prices, Product cards, Search, Swatches, and more.

- **Colour palette**: a row of swatches (base colours) with "+" to add a colour; click opens colour picker; the palette
  feeds colour scheme definitions. MVP: edit a fixed set of palette colours and schemes; add/remove: Later if schema
  supports lists.
- **Typography**: colour (default text colour), **fonts** (body, subheading, heading, accent; each a font picker from a
  font library with search), **text presets** (paragraph, headings 1-6 and others: size, weight, line-height, case,
  letter-spacing; sizes scale responsively), font size selects (e.g. numeric px).
- Other groups follow the same pattern; render generically from schema.

All values persist in `config/settings_data.json` (draft copy per theme; see `data-model.md` 5.9).

### 15.7 Preview and publishing

- Desktop and mobile frames (mobile frame narrow width, also tablet optional); preview updates live on every change
  (postMessage to the iframe or re-render via section rendering endpoint, section-level re-render preferred).
- Undo/redo stack per editing session; Save writes the draft to `theme_files` (template JSON and `settings_data.json`);
  Publish promotes the theme to role MAIN (`themes.role`).
- Unsaved-changes guard on exit.

MVP: sections tree with add/remove/reorder/hide, add-section picker with categories and search, section and block
settings panels for the supported input types, theme settings groups (colours, typography, plus whatever the loaded
theme declares), desktop/mobile preview, undo/redo, Save/Publish. Later: Apps mode, AI generation, inspect-mode
refinements, custom template creation, multi-language editing, per-page A/B preview, code editor, theme store.

Data (internal, not GraphQL MVP): `GET/PUT /admin-internal/themes/:id/files/:path`, `GET /admin-internal/themes/:id/
editor-model` (parsed schemas + current settings, cached by `theme_files.checksum`), `POST .../publish`; tables `themes`,
`theme_files`; pickers use `products`, `collections`, `menus`, `pages`, `media` queries. Section schemas are defined by
`theme-format.md`.

---

## 16. Settings screens

### 16.1 Store details (general)

Fields (MVP): store name, store contact email, sender email, legal business name, store address (country, address
lines, city, region, postal code, phone), currency (display currency; single currency in MVP), unit system and default
weight unit, time zone, order id prefix/suffix (for order numbers), checkout language. Data: `Shop`, `ShopAddress`,
`CurrencyFormats`; table `shops`. Updates via internal `PUT /admin-internal/shop`.

### 16.2 Payments

Structure (functional):

- Banner area for environment state, e.g. "test mode" when the connected provider is in test mode.
- **Primary provider** card: provider name, status (active/needs setup), "complete setup" action, accepted payment
  methods preview. ShopMe: pluggable provider interface (Stripe first); MVP shows a provider list with Connect and
  Test-mode toggle.
- **Test gateway** row available in dev stores (a fake provider that approves test cards): MVP includes a built-in
  "manual/test" provider.
- **Other payment methods** (third-party/alternative providers) with "add method": Later.
- **Manual payment methods** (bank transfer, cash on delivery, custom): add/edit/delete with name, additional details
  text, payment instructions shown after checkout: MVP.
- **Payment configuration** links: capture method (automatic at order / at fulfilment / manual), payment customisations,
  gift card expiry, wallet passes: capture method MVP; others Later.

Data: internal `/admin-internal/payment-providers`, `/payment-methods`; tables `payment_providers`,
`payment_methods` (propose). Order `OrderTransaction` rows are written by the provider adapter.

### 16.3 Shipping and delivery

Sections:

- **Shipping zones and rates** ("shipping options"): list of zones (name, countries/regions) each with rates. In the
  reference a market-oriented table shows a market and its option chips. ShopMe MVP uses classic **zones**:
  - Zone: name, countries (and optional regions), rate list.
  - Rate: name, type (flat price / weight-based / price-based), price, optional min/max condition, free-shipping
    threshold, estimated delivery text.
  - Default fallback ("rest of world") zone: optional.
  - Per-location shipping origin (Later: location-based rates).
- Estimated delivery dates: automated vs custom text (Later).
- Shipping labels / carriers (calculated carrier rates): Later.
- Packages: saved box sizes with dimensions and weight (default package): Later.
- Professional shipping accounts: Later.
- **Order routing** (location priority rules for allocating orders): Later (MVP: default location).
- Additional delivery methods: local delivery (radius/postal-code zones, fee, minimum order) Later; store pickup
  (enable per location, pickup instructions, expected pickup time) Later.
- **Documents** (packing slip, pick list, invoice templates, "create document"): Later; MVP provides a fixed packing
  slip print layout.
- Delivery customisations (hide/rename/reorder options at checkout): Later.
- Custom order fulfilment services (email notify a third-party): Later.

Data: internal `/admin-internal/shipping-zones`, `/shipping-rates`; tables `shipping_zones`, `shipping_zone_countries`,
`shipping_rates` (propose). Orders store the chosen rate in `order_shipping_lines`.

### 16.4 Taxes and duties

MVP:

- Tax calculation mode: manual tax rates per country/region (table: region, rate %, collect on/off, shipping taxed
  toggle, tax name). Automated tax service (third-party): Later.
- Tax regions list (countries where tax is collected) with per-region settings and "add region".
- Toggles: prices include tax (maps to `taxes_included`, see `shops.taxes_included`), charge tax on shipping
  (`tax_shipping`), charge VAT on digital goods (EU): Later.
- Per-product taxable flag is on the variant (4.4); customer tax-exempt flag on the customer (11).
- Customs information (country of origin, HS codes defaults): shows how many variants have values with a manage link
  (bulk set): Later; MVP stores fields only.
- Duties and import taxes collected at checkout (DDP): Later.
- Tax reports: Later.

Data: internal `/admin-internal/tax-regions`; `shops.taxes_included`, `shops.tax_shipping`; table `tax_rates`
(propose).

### 16.5 Domains

- Table: domain, status badge (connected, pending verification, error), "primary" marker, row actions: set primary,
  remove, redirect to primary toggle.
- Actions: **Connect existing domain** (enter hostname, then the screen shows required DNS records (A/CNAME) and a
  "verify" button, SSL provisioning status), **Transfer domain** / **Buy domain**: out of scope for self-hosting (Later or
  never).
- The platform default subdomain exists and cannot be removed.
- Data: `Shop.primaryDomain`, `Domain`; table `shop_domains` (add verification state columns `verified_at`,
  `ssl_status`); internal `POST /admin-internal/domains`, `POST /admin-internal/domains/:id/verify`.

### 16.6 Languages

- Table: language, status (published / unpublished), domains using it, row menu (set default, publish/unpublish,
  change domain mapping, delete), "Add language" button, recommendation banner (dismissible) suggesting a language based
  on markets, and an apps recommendation block.
- MVP: show the default language only, with locale chooser at store-details level. Multi-language storefront and
  translation editor: Later (translations are out of scope in the API spec).
- Data: `Shop` locale; later tables `shop_locales`, `translations`.

### 16.7 Other settings pages (brief)

Locations: list with name, address, fulfils-online-orders toggle, inventory activation; add/edit/deactivate (MVP; API
`locationAdd`/`locationEdit`). Users: list, invite by email, remove (MVP minimal). Notifications: editable email
templates for order confirmation, shipping confirmation, refund (MVP: subject + body with variables). Policies: text
areas for refund/privacy/terms/shipping policy with rich text (MVP). Custom data: metafield definitions
(namespace, key, name, type, pinned toggle, owner type) (MVP for PRODUCT).

---

## 17. MVP vs Later summary

| Area | MVP (v0.1) | Later | Rationale |
|---|---|---|---|
| Shell | nav, search, account menu, toasts | multi-store, notification centre, saved searches | one store per instance first |
| Dashboard | status, setup checklist, counters | charts, recommendations | needs analytics pipeline |
| Products | list, full editor w/ variants, SEO, metafields, bulk status/tag | taxonomy, bundles, subscriptions, 3D/video, unit price, bulk grid | covers first sale |
| Collections | manual + automated (10 rule fields) | metafield/taxonomy rules, channels | matches API spec 3.1 |
| Inventory | per-location available edit, search, CSV | transfers, POs, counts, history | multi-location basics only |
| Orders | list, detail, fulfil, refund, cancel, notes, tags, timeline | edit order, returns, drafts, labels, fraud | order edit/returns out of API MVP |
| Customers | list, detail, create/edit, tags, notes, consent | segments, merge, store credit, B2B | |
| Discounts | code/automatic; product, order, free shipping | buy-X-get-Y, segments, bulk | not in API MVP; internal API |
| Settings | store details, payments, shipping zones, taxes, domains, locations, users, notifications, policies, metafield defs | markets, checkout customisation, languages, privacy | |
| Theme editor | tree, picker, settings panels, theme settings, preview, publish | apps, AI, code editor | core self-host differentiator |

---

## 18. Admin SPA page map for v0.1

Data column: GraphQL = Admin GraphQL API (`admin-api-mvp.md`); INT = internal admin endpoint (not in the MVP API spec).

| Route | Page | Main components | Data needed |
|---|---|---|---|
| `/admin/login` | Sign in | login form, reset password | INT `/admin/session` |
| `/admin` | Home | status card, setup checklist, shortcut chips, counters | `shop`, `ordersCount`, `productsCount`; INT setup-progress |
| `/admin/products` | Products list | ResourceList, tabs by status, filter bar, bulk bar, column chooser | `products`, `productsCount`, `productTypes`, `productVendors`, `productTags`; `productUpdate`, `productDelete` |
| `/admin/products/new` | Create product | ProductForm (title, rich text, media, option editor, price/inventory/shipping cards, SEO, metafields), status sidebar | `productCreate`, `productVariantsBulkCreate`, `inventorySetQuantities`, `locations`, `metafieldDefinitions`, upload INT |
| `/admin/products/:id` | Product detail | same as create + variant pane, activity of save | `product`, `productUpdate`, `productOption*`, `productVariantsBulk*`, `inventory*`, `metafieldsSet`, `collections` |
| `/admin/products/:id/variants/:variantId` | Product detail, variant selected | same page with variant pane focus | `productVariant` |
| `/admin/collections` | Collections list | ResourceList (title, product count, conditions summary) | `collections`, `collectionsCount`, `collectionDelete` |
| `/admin/collections/new` | Create collection | CollectionForm, RuleBuilder, product picker | `collectionCreate`, `products` (preview) |
| `/admin/collections/:id` | Collection detail | CollectionForm, RuleBuilder, product grid/list with sort and reorder | `collection`, `collectionUpdate`, `collectionAddProductsV2`, `collectionRemoveProducts`, `collectionReorderProducts` |
| `/admin/inventory` | Inventory | location select, editable quantity table, filter bar | `inventoryItems`, `locations`, `inventorySetQuantities`/`inventoryAdjustQuantities` |
| `/admin/orders` | Orders list | KPI strip, tabs, filter bar, table, bulk bar | `orders`, `ordersCount`, `orderUpdate`/`orderClose`/`orderCancel` |
| `/admin/orders/:id` | Order detail | FulfillmentCard, PaymentSummary, Timeline+composer, CustomerCard, AddressCards, NotesCard, TagsCard, RefundDialog, FulfillDialog, CancelDialog | `order`, `fulfillmentCreate`, `fulfillmentCancel`, `fulfillmentTrackingInfoUpdate`, `refundCreate`, `orderMarkAsPaid`, `orderCapture`, `orderCancel`, `orderUpdate`, `tagsAdd/Remove`; INT order events |
| `/admin/customers` | Customers list | ResourceList, filter bar, bulk bar | `customers`, `customersCount` |
| `/admin/customers/new` | Create customer | CustomerForm | `customerCreate` |
| `/admin/customers/:id` | Customer detail | StatsRow, LastOrderCard, Timeline, ContactCard, AddressCard, ConsentCard, TaxCard, TagsCard, NotesCard | `customer`, `orders(query)`, `customerUpdate`, `customerAddress*`, `tagsAdd/Remove`; INT customer events |
| `/admin/discounts` | Discounts list | ResourceList (status, method, type, used) | INT discounts |
| `/admin/discounts/new` | Create discount | TypeChooserModal then DiscountForm (method, value, eligibility, minimums, limits, combinations, dates, summary card) | INT discounts, `collections`, `products`, `customers` for pickers |
| `/admin/discounts/:id` | Edit discount | DiscountForm + activate/deactivate | INT discounts |
| `/admin/themes` | Themes library | theme cards, publish, duplicate, upload | INT themes; `themes` table |
| `/admin/themes/:id/editor` | Theme editor | EditorTopBar, SectionTree, AddSectionPopover, SettingsPanel, ThemeSettingsAccordion, PreviewFrame (desktop/mobile), undo/redo | INT editor-model, theme files; `products`/`collections`/`menus`/`pages`/media pickers |
| `/admin/settings` | Settings index (with settings nav and search) | SettingsNav, SettingsSearch | none |
| `/admin/settings/general` | Store details | form | `shop`; INT shop update |
| `/admin/settings/payments` | Payments | provider cards, manual methods list, capture setting | INT payment-providers/methods |
| `/admin/settings/shipping` | Shipping and delivery | zone list, rate editor | INT shipping-zones/rates |
| `/admin/settings/taxes` | Taxes | region rate table, toggles | INT tax-regions; `shop` flags |
| `/admin/settings/locations` | Locations | list, add/edit dialog | `locations`, `locationAdd`, `locationEdit` |
| `/admin/settings/domains` | Domains | domain table, connect flow with DNS instructions | INT domains; `shop.primaryDomain` |
| `/admin/settings/languages` | Languages (minimal) | default language table | `shop` |
| `/admin/settings/notifications` | Notification templates | template list + editor | INT templates |
| `/admin/settings/policies` | Policies | rich text areas | INT policies |
| `/admin/settings/metafields` | Custom data (definitions) | definitions list/editor | `metafieldDefinitions`; INT create definition |
| `/admin/settings/users` | Users | staff list, invite | INT users |

Route notes: all routes are client-side (SPA) under a shared `/admin` base; unknown ids render a not-found page;
list pages persist filter and sort in the query string so views are shareable.

---

## 19. Review coverage and gaps

All 39 reference screens were readable and informed this document: dashboard (1), products list and search (2-3),
product detail with variants, inventory, shipping, metafields, SEO (4-6), product creation (7-9), collections list,
automated conditions, creation (10-12), inventory (13), orders list and detail with timeline (14-16), customers list and
detail (17-18), discounts list, type chooser, form (19-22), payments (23-24), shipping (25-26), taxes (27-28), domains
(29), languages (30), theme editor overview, add-section picker (two categories), section and block settings, theme
settings list, palette, typography, mobile preview (31-39).

Open items to settle before implementation:

1. Discounts, shipping zones, taxes, payment providers, users, theme editor are absent from `admin-api-mvp.md`;
   decide REST vs GraphQL for the internal admin namespace and add the proposed tables to `data-model.md`.
2. `Order.events` / timeline is not in the API spec; add `order_events` and `customer_events` tables.
3. Exact rule-operator validity matrix for smart collections must be confirmed (see API spec 3.1).
4. Media upload path: API spec marks `stagedUploadsCreate` and `fileCreate` P2; the admin needs a simple upload at v0.1.
5. Default product status on creation (Draft recommended, differs from the reference).
