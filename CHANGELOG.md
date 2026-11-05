# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project will follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) from 1.0 onward. Before 1.0, minor versions may include breaking changes.

## [Unreleased]

### Added

- Customer accounts on the storefront: register, login, logout, password reset by email, account activation for guest customers, order history and order pages, address book. Classic `customers/*` templates and `customer` forms; the `customer` Liquid object; Aurora templates in English and French. Checkout starts with the signed-in customer's email and default address.
- Blogs and articles: Admin GraphQL `blog(s)`, `blogsCount`, `article(s)`, `articleTags` and `blogCreate/Update/Delete`, `articleCreate/Update/Delete`; storefront `/blogs/:blog`, `/blogs/:blog/tagged/:tag`, `/blogs/:blog/:article`, Atom feed `/blogs/:blog.atom`; `blog`, `article`, `blogs` and `articles` Liquid objects; Aurora blog and article templates.
- Contact form (`POST /contact`, emails the shop owner) and newsletter sign-up (`form 'customer'`, marketing consent plus the `newsletter` tag), with `form.errors` and `form.posted_successfully?`.
- URL redirects: Admin GraphQL `urlRedirect(s)`, `urlRedirectsCount`, `urlRedirectCreate/Update/Delete`; the storefront answers stored redirects with 301 before the 404; changing a product, collection, page, blog or article handle creates a redirect.
- Cart-level discounts: `/discount/:code`, discounts in `/cart.js` and every Ajax cart response (`total_discount`, `cart_level_discount_applications`, line `discounts` and `line_level_discount_allocations`), Liquid `cart.discount_applications`.
- `/sitemap.xml` is now an index of child sitemaps (products, collections, pages, blogs); `/robots.txt` lists the private areas.
- Migration `wave6a_accounts` (`customer_tokens`, `blogs.comment_policy`).

## [0.1.0] - 2026-11-04

### Added

- End-to-end test suite (`pnpm e2e`): 29-step merchant and shopper journey in a real browser, run in CI.
- Desktop apps (beta): Windows `.exe`, macOS `.dmg`, Linux `.AppImage`, built by GitHub Actions for each release.
- First-run setup wizard that creates the shop and the owner account.
- Catalog: products, variants and options, media, manual and smart-rule collections, single-location inventory, metafields, product types, vendors and tags.
- Liquid theme engine for Shopify-format themes, with the Aurora default theme (MIT) and a schema-driven theme settings editor with preview.
- Storefront routes for products, collections, search and pages, and the Ajax Cart API.
- One-page checkout with discount codes, shipping zones and rates, and tax rates.
- Payments: Stripe (PaymentIntents and signed webhooks), bank transfer and cash on delivery.
- Orders: list and detail views, fulfillments with tracking, refunds, cancellation, restock and order timeline.
- Customer records and discount management.
- Online store content: pages and menus.
- Admin dashboard in English and French.
- Shopify-shaped Admin GraphQL API subset, with ShopMe-specific settings operations.
- Zero-setup local mode with embedded PostgreSQL (PGlite) under `./data`.
- Docker image and Docker Compose setup with PostgreSQL 17, plus install guides for VPS deployment with Caddy.
- Clean-room specifications and developer notes under `docs/`.
- English and French READMEs, roadmap, contribution guide and security policy.
