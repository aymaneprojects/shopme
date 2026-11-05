# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project will follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) from 1.0 onward. Before 1.0, minor versions may include breaking changes.

## [Unreleased]

### Added

- Delivery profiles: a general profile plus custom profiles with assigned products, location groups (the locations an item ships from), zones (countries, regions or rest of world) and rates with price, weight or order price conditions, free-shipping thresholds and an active switch. Settings, Shipping and delivery has the profile list, the profile editor and an add/edit rate dialog with several rates per name. Admin API: `deliveryProfile(s)`, `deliveryProfileCreate/Update/Remove`, `locationsAvailableForDeliveryProfilesConnection`.
- Checkout picks rates per delivery profile (cart lines grouped by profile, weight and subtotal of each group, province zone before country before rest of world) and combines them: options with the same name add up, no shared name gives the cheapest of each profile, a profile without a rate blocks shipping. Cheapest first.
- Local pickup per location (pickup time, instructions) offered at checkout with the location address when the items are in stock there, with "Mark as ready for pickup" and "Mark as picked up" on the order page (the latter fulfills the order). Admin API: `locationLocalPickupEnable/Disable`, `Location.localPickupSettingsV2`, `Order.shopmeDelivery`.
- Local delivery per location by postal code prefixes with delivery price, minimum order, free-over amount and delivery information (`shopmeLocationLocalDeliveryUpdate`).
- Packages: box, envelope, soft package and flat-rate presets with dimensions and weight, one shop default (`shippingPackageUpdate/Delete/MakeDefault`, `shopmeShippingPackageCreate`).
- `POST /cart/shipping_rates.json` (and GET) returns the rates, local delivery and pickup options for the cart and a destination.
- Rich-text editor toolbar: block format (paragraph, headings, quote), bold, italic, underline, text color, alignment, lists, indent, link, image (from Files or upload), YouTube/Vimeo embed, table, clear formatting and a Show HTML toggle, used for products, collections, pages and articles.
- Rich text is sanitized on the server for products, collections, pages and articles: tables, alignment, safe inline styles and YouTube/Vimeo iframes are kept; scripts, event handlers, other iframes and unsafe URLs are removed.
- Pages and blog posts: theme template select (alternate templates of the live theme), scheduled publishing with a visibility date and time, and SEO title and description with an editable search engine listing preview (`seo` field on `Page` and `Article`).
- Files: folders (create, rename, move files, delete empty folders), size and References columns (products, collections, blog posts, theme settings), download and copy links of the selection from the "..." menu.
- Product shipping fields: package dimensions (length, width, height and unit), country/region of origin and HS code per variant, next to the physical product toggle and weight (the weight already feeds weight-based shipping rates).
- Variants table: search, option filters, select all with bulk edit of prices and quantities and bulk delete, "Add variant" for a new option value combination, and a per-variant menu (edit option values, duplicate, delete). Deleted combinations are no longer regenerated.
- Saved views on the Products, Orders, Customers and Inventory lists: save the search, filters and sort as a tab shared by all staff, rename, duplicate, delete and save changes (Admin API `savedSearchCreate`/`Update`/`Delete` and `*SavedSearches`).
- Inventory bulk actions: edit available or on hand quantities, stop tracking and track quantity for the selected rows, plus a tracked/not tracked filter.
- Gift card products: "Add gift card product" creates a product flagged as gift card (no shipping, denominations); the order page lists the gift cards issued when it is paid.
- Products metrics strip over 30 days: average sell-through rate, days of stock remaining and ABC analysis by revenue (`shopmeProductMetrics`).
- Bulk actions: products (add or remove tags, add to or remove from collections), orders (mark as paid, mark as fulfilled, add or remove tags) and customers (remove tags); Duplicate product dialog with title, media and status.
- Theme editor: click-to-select in the preview (hover outline with the element's name, mini toolbar to move, duplicate, hide and delete, insert handles between sections), with an Inspector toggle; editor attributes are rendered only in the signed-in preview, never on the live storefront.
- Theme editor: live preview that follows unsaved changes (debounced, scroll position kept), also for themes that are not live.
- Theme editor: section and block settings panel with back/close and a "..." menu, section menu in the tree (copy, paste, duplicate, rename, hide, add before/after, remove) and keyboard shortcuts.
- Theme editor: one undo/redo history shared by sections and theme settings, and theme settings grouped with search.
- Theme editor: "Add section" picker with categories, search and a live preview on hover; desktop, tablet, mobile and full-screen preview modes.
- Settings, Checkout: contact method (email, or email or phone), optional or required customer accounts, name, company, address line 2 and phone rules, marketing opt-in checkbox (hidden, shown, pre-checked), tipping with presets, and order notes. The storefront checkout shows and validates exactly these fields on the server.
- Notifications can be switched on or off one by one (order confirmation, shipping, refund, cancellation, abandoned checkout, gift card), and the "New order" email goes to a list of staff recipients.
- Return rules (Settings, Policies): return window, return shipping cost (free, flat fee, customer pays), restocking fee and final sale products or collections. They are enforced when a return is created, copied onto it, and listed on the refund policy page.
- Discounts can be limited to customer segments or specific customers (enforced at checkout from the buyer's email), show an Eligibility column in the list, and carry tags with a tag filter.
- Admin shell: collapsible sidebar (remembered per browser), a notifications bell with an activity feed (new orders, low stock, failed webhook deliveries, backup results) and "Mark all as read", search with type filters and recent searches, and an account menu at the bottom of the sidebar.
- Timeline on the order and customer pages: staff comment box (plain text, authors can delete their own comments) and system events grouped by day (order created, paid, fulfilled, refunded, edited, address changes, emails sent; customer created, order placed). New `CommentEvent`/`events` fields on `Customer`, `customerTimelineCommentCreate` and `timelineCommentDelete` mutations.
- Fulfillment actions: "..." menu per fulfillment (edit tracking and notification, cancel fulfillment which puts the items back to unfulfilled and re-commits the stock), "Mark as on hold" / "Release hold" with a reason (`fulfillmentOrderHold`, `fulfillmentOrderReleaseHold`, `fulfillmentCancel`); a held order shows ON_HOLD and cannot be fulfilled.
- Billing address editing on the order page (`orderUpdate` accepts `billingAddress`).
- Refunds credit gift cards back: the gateway share is refunded first, the rest goes onto the gift cards that paid the order; the refund page and the timeline show it.
- Orders export honours the current filter or selection (`/admin/api/export/orders.csv?query=&ids=`); new draft orders export (`draft_orders.csv`).
- Abandoned checkouts: status filter (open / recovered) with `status:recovered` search.
- Order "More actions": duplicate (as a draft order), view status page, print order page, packing slips or both; "Create shipping labels" bulk action explaining that no carrier is connected and offering manual tracking; "Request customer data" JSON download on the customer page.
- The demo store now ships real product, collection, home page, blog and About page photos (CC0, see `packages/core/assets/demo/README.md`).
- Illustrated empty states in the admin (products, orders, customers, discounts, collections, analytics).
- `pnpm screenshots` regenerates the README screenshots from a fresh demo store.
- Desktop: Mac installers are named `mac-apple-silicon` and `mac-intel`, and the app warns when the Intel build runs on an Apple Silicon Mac (Rosetta, much slower).
- Admin, closer to the Shopify admin layout (button by button review of 75 reference screens):
  - Pill-shaped buttons, labelled "More actions" menus with icons, a centered save bar, compact confirm dialogs and a variant picker.
  - Orders: refund page, order edit summary, draft order layout, previous/next navigation, shipping address editing.
  - Catalog: column choosers, "View as", preview and share, product and collection navigation, collection duplicate, stock counts import, discount export.
  - Theme editor: publish button, redo, section duplicate and delete, section search.
  - Customers: customer segments with a conditions builder and live counts, customer page actions, gift card layout.
  - Online store: pages, blog posts, menus (list and editor), files and preferences pages with bulk actions.
  - Analytics: overview page, reports list, report auto-refresh.
  - Settings: dedicated settings navigation, narrower pages with section descriptions, users table, notifications overview and template preview with test send, policies list, locations table, custom data by resource, domains and languages tables.

### Changed

- Existing shipping zones and rates move into the general profile with the same ids when the database is migrated, so carts and orders keep pointing at the right rate; the `shippingZones` and `shippingRate*` Admin API fields keep working as a view of the general profile. Shipping options at checkout are now listed cheapest first.

### Fixed

- Creating or editing a customer from the admin failed because the email marketing consent field was rejected by the API.
- `pnpm seed` now fills the default main and footer menus, which the setup step creates empty.
- Aurora: the newsletter form in the footer no longer overflows the screen on phones.
- Aurora: the footer stays at the bottom of the window on short pages (login, cart, 404).
- New stores start with Home and Catalog links in the main menu and a Search link in the footer menu, instead of empty menus.

## [0.1.0] - 2026-11-05

First public release (early alpha).

### Added

**Setup and platform**

- First-run setup wizard that creates the shop and the owner account.
- Zero-setup local mode with embedded PostgreSQL (PGlite) under `./data`; Docker image and Docker Compose setup with PostgreSQL 17; install guides for VPS deployment with Caddy.
- Staff accounts with roles (owner, admin, staff), per-area permissions, invitations by link, and a Team page.
- Staff two-step verification (TOTP, QR code, recovery codes), per-shop enforcement, a sign-in challenge step, an active sessions list with revoke, and a sign-in alert email.
- Security headers on the storefront and the admin (frame protection, nosniff, referrer policy, strict admin CSP, report-only storefront CSP, optional HSTS with `HSTS=true`), and ETag / 304 responses for storefront HTML and assets.
- Admin interface in English and French, a dark navy theme with a light and dark switch, the Geist font, and a Ctrl/⌘+K command palette.
- Desktop apps (beta): Windows `.exe`, macOS `.dmg` and Linux `.AppImage`, built by GitHub Actions for each release and unsigned; "Export my store..." and "Import a store..." menu items.
- Store export and import (`.shopme` archive with every table, uploaded files and themes), a Backup and transfer page, and scheduled automatic backups with retention.

**Catalog**

- Products, variants and options, media, product types, vendors and tags, metafields with definitions (typed editors on products, variants, collections, customers and orders), and a bulk editor.
- Manual and smart-rule collections, with an Atom feed at `/collections/:handle.atom`.
- Multi-location inventory: a locations page, activation and deactivation, priority allocation, and a ship-from location.
- Product editor with variant images, unit price, category, duplicate, preview, and product set and status changes.
- CSV import and export for products, customers, inventory and orders.
- Shopify migration importer (`packages/migrate`, through the Admin API), with a page in the admin.
- Admin GraphQL: `productSet`, `productChangeStatus`, `publications`, `publishablePublish/Unpublish`, `customerAddress*`, `files`, `fileUpdate/Delete`, `stagedUploadsCreate`, `locationsCount`, `taxonomy`, and more fields on `Product`, `ProductVariant`, `Order`, `Customer` and `Shop`.
- Admin GraphQL: `extensions.cost` with a throttle status.

**Themes and online store**

- Liquid theme engine for Shopify-format themes, with the Aurora default theme (MIT) and a schema-driven theme settings editor with preview.
- Theme upload and library in the admin (zip upload, create, duplicate, delete, rename, file copy and delete).
- Section-level theme editor: add, remove and reorder sections and blocks, switch templates, and undo.
- Pages, navigation menus, and blogs and articles: Admin GraphQL `blog(s)`, `article(s)`, `articleTags`, and create, update and delete mutations; storefront `/blogs/:blog`, tagged blogs, articles, and `/blogs/:blog.atom`; `blog` and `article` Liquid objects; Aurora blog and article templates.
- URL redirects: Admin GraphQL `urlRedirect(s)` and mutations; the storefront answers stored redirects with 301 before the 404, and changing a product, collection, page, blog or article handle creates a redirect.
- Policies with an editor (refund, privacy, terms, shipping), served at `/policies/:handle`, and a cookie banner.
- Contact form (`POST /contact`, emails the shop owner) and newsletter sign-up (`form 'customer'`, marketing consent plus the `newsletter` tag), with `form.errors` and `form.posted_successfully?`.
- Languages and translations: `shopLocales`, `translatableResources`, `translationsRegister/Remove` and related operations; storefront locale prefixes (`/fr`), `POST /localization`, the `localization` Liquid object, hreflang, an Aurora language selector, a Languages settings page and a side-by-side translation editor.
- Image resizing for `/files/*` (width, height, crop, format including WebP and AVIF) with a disk cache.

**Search and storefront**

- Storefront routes for products, collections, search and pages, and the Ajax Cart API.
- Search upgrade: full-text ranking, `type` and `options[prefix]`, typo tolerance, pages and articles, predictive `queries`, and an Aurora dropdown.
- `/search.json`, `/meta.json`, `x-robots-tag`, canonical and hreflang tags, and Product JSON-LD.
- `/sitemap.xml` as an index of child sitemaps (products, collections, pages, blogs), and `/robots.txt` listing the private areas.
- Customer accounts: register, login, logout, password reset by email, account activation for guest customers, order history and order pages, and an address book. Classic `customers/*` templates and `customer` forms, the `customer` Liquid object, and Aurora templates in English and French. Checkout starts with the signed-in customer's email and default address.
- Visit tracking that respects the cookie banner and Do Not Track.

**Checkout and payments**

- One-page checkout with discount codes, gift cards, shipping zones and rates, and tax rates.
- Payments: Stripe (PaymentIntents and signed webhooks), bank transfer, and cash on delivery.
- Cart-level discounts: `/discount/:code`, discounts in `/cart.js` and every Ajax cart response, and Liquid `cart.discount_applications`.
- Automatic discounts and buy X get Y (BXGY), with combination rules; the admin discount type chooser (amount off products, buy X get Y, amount off order, free shipping) and a code or automatic method.

**Orders and customers**

- Orders: list and detail views, fulfillments with tracking, refunds, cancellation, restock, archive, and an order timeline.
- Order editing (`orderEdit*` mutations and an edit page) and returns (`returnCreate`, `returnRequest`, approval and close), with restock on close.
- Draft orders: create, edit, calculate, complete, and send an invoice link that opens a checkout or a payment-pending order.
- Abandoned checkouts: a list in the admin, optional recovery emails after 1 to 24 hours, and a recovery link that restores the cart.
- Gift cards: issue on purchase (including recipient and scheduled notifications), balance and transactions, redemption at checkout, a public gift card page, and an admin page.
- Customer records, customer data export (`/admin/api/customers/:id/export.json`), and discount management.
- Outbound webhooks: subscriptions for Shopify-style topics, JSON payloads, HMAC-SHA256 signatures with a rotatable secret, retries with backoff, and a delivery log.
- Notification templates editor (English and French) for order, shipping, refund, cancellation, draft invoice, contact, staff invitation and login alert emails, with sender settings.

**Analytics**

- Twelve reports (sales over time, orders over time, average order value, sales by product, variant and vendor, returning customer rate, top customers, discount usage, taxes, inventory snapshot, and sessions and conversion) with a date range, a comparison picker, SVG charts, and CSV export.
- `shopmeReport` in the Admin API.

**Admin API and developer tools**

- Shopify-shaped Admin GraphQL subset, with ShopMe-specific settings operations, and documentation under `docs/`.
- Clean-room specifications and developer notes under `docs/`.
- End-to-end test suite (`pnpm e2e`): a 29-step merchant and shopper journey in a real browser, run in CI.
- English and French READMEs, roadmap, coverage report, contribution guide and security policy.
