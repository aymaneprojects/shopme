# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project will follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) from 1.0 onward. Before 1.0, minor versions may include breaking changes.

## [0.1.0] - unreleased

### Added

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
