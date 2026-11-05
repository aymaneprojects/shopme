# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project will follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) from 1.0 onward. Before 1.0, minor versions may include breaking changes.

## [Unreleased]

### Added

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
