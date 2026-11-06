# Roadmap

ShopMe is in early alpha: v0.1.0 is the first pre-release. Phases are goals, not promises. Checked items are in the
v0.1.0 code; partially done items are split so the open part stays visible.

## Phase 0 - Interface study & spec
- [x] Study public documentation and write our own specs (clean-room, see `docs/legal/clean-room.md`)
- [x] Write specs in our own words (`docs/spec/`)
- [ ] Build the conformance test suite (ShopMe responses vs recorded shapes)

## Phase 0.5 - Foundation
- [x] Single-container architecture: one Fastify process (`apps/server`) + PostgreSQL; embedded PGlite for zero-setup local runs
- [x] Complete MVP database schema (Drizzle migrations), single store per installation (`shop_id` on every table; several stores with the multi-store mode)
- [x] Staff auth (sessions, API tokens), Admin GraphQL scaffolding, uploads, in-process job queue
- [x] Docker image + Compose, install guides

## Phase 1 - MVP core
- [x] Products, variants, collections
- [x] Inventory (single location)
- [x] Customers
- [x] Cart
- [x] Stripe checkout (bank transfer and cash on delivery also available)
- [x] Orders
- [x] Basic admin (EN/FR)
- [x] Default theme (Aurora)
- [x] **Done when:** one product can be sold end-to-end (covered by the checkout tests)

## Phase 2 - Compatibility
- [x] Liquid Online Store 2.0 themes (Aurora and the subset of the format it uses; third-party theme coverage not verified)
- [x] Ajax Cart API
- [x] Admin GraphQL subset
- [ ] Storefront GraphQL subset
- [x] Webhooks with HMAC signatures (outbound merchant webhooks with retries, and the inbound Stripe webhook)
- [ ] OAuth apps
- [ ] **Done when:** the conformance suite is green

## Phase 3 - Advanced commerce
- [x] Discounts (codes, cart-level, automatic, buy X get Y)
- [x] Shipping zones and rates
- [x] Tax rates (basic, per zone)
- [ ] EU VAT / OSS
- [ ] Multi-currency
- [x] Multi-language storefront (`/fr` URLs, translations; the admin is EN/FR)
- [x] Gift cards
- [x] Subscriptions and purchase options (selling plans, contracts, automatic renewals, customer self-service)
- [x] Refunds
- [x] Returns
- [ ] Exchanges
- [x] Multi-location inventory
- [ ] Inventory transfers between locations
- [ ] French carriers (Colissimo, Mondial Relay)

## Phase 4 - Ecosystem
- [x] Theme settings editor (schema-driven, with preview)
- [x] Visual theme editor beyond settings (section layout editing)
- [x] Metafields
- [x] Metaobjects (definitions, entries, references, Liquid, online store pages; standard definitions, market localizations and app-owned definitions are later)
- [ ] App platform
- [ ] CLI: theme dev / push (`packages/cli` is a placeholder)
- [x] One-click migration from Shopify (importer in `packages/migrate`, also started from the admin)

## Phase 5 - Production
- [ ] Performance
- [ ] Security hardening
- [ ] GDPR tooling
- [ ] Observability
- [ ] Helm charts (Docker Compose already available)
- [ ] One-click deploy templates
- [x] Desktop apps: Windows `.exe`, macOS `.dmg` and Linux `.AppImage` (beta; Electron + embedded server + PGlite), built by GitHub Actions
- [x] Export / import a whole store (e.g. build it in the desktop app, then move it to a server)
- [ ] Documentation site (the docs are in the repository under `docs/`)
- [x] Multi-store mode (`MULTI_STORE=true`): accounts reaching several stores, store switcher and "Create a store", stores resolved by host with their own domains, a platform owner area (suspend, resume, delete), per-store Stripe keys, sender, files and backups, and an isolation test suite
- [ ] Multi-store: per-store quotas, one database or storage bucket per store, a public sign-up page

## Later
- [ ] "ShopMe Cloud": a hosted offer (builds on the multi-store mode)
