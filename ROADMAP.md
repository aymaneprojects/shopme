# Roadmap

ShopMe is in early alpha: v0.1.0 is the first pre-release. Phases are goals, not promises. Checked items are in the
v0.1.0 code; partially done items are split so the open part stays visible.

## Phase 0 - Interface study & spec
- [x] Study public docs and our own dev store (clean-room, see `docs/legal/clean-room.md`)
- [x] Write specs in our own words (`docs/spec/`)
- [x] Record request/response pairs from our own dev store (kept private)
- [ ] Build the conformance test suite (ShopMe responses vs recorded shapes)

## Phase 0.5 - Foundation
- [x] Single-container architecture: one Fastify process (`apps/server`) + PostgreSQL; embedded PGlite for zero-setup local runs
- [x] Complete MVP database schema (Drizzle migrations), single store per installation (`shop_id` kept for a future ShopMe Cloud)
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
- [ ] Webhooks with HMAC signatures (inbound Stripe webhook is verified; outbound merchant webhooks are not built)
- [ ] OAuth apps
- [ ] **Done when:** the conformance suite is green

## Phase 3 - Advanced commerce
- [x] Discounts (codes)
- [x] Shipping zones and rates
- [x] Tax rates (basic, per zone)
- [ ] EU VAT / OSS
- [ ] Multi-currency
- [ ] Multi-language storefront (the admin is already EN/FR)
- [ ] Gift cards
- [x] Refunds
- [ ] Returns
- [ ] Multi-location inventory
- [ ] French carriers (Colissimo, Mondial Relay)

## Phase 4 - Ecosystem
- [x] Theme settings editor (schema-driven, with preview)
- [ ] Visual theme editor beyond settings (section layout editing)
- [x] Metafields
- [ ] Metaobjects
- [ ] App platform
- [ ] CLI: theme dev / push (`packages/cli` is a placeholder)
- [ ] One-click migration from Shopify (`packages/migrate` is a placeholder)

## Phase 5 - Production
- [ ] Performance
- [ ] Security hardening
- [ ] GDPR tooling
- [ ] Observability
- [ ] Helm charts (Docker Compose already available)
- [ ] One-click deploy templates
- [ ] Desktop apps: Windows `.exe` and macOS `.dmg` (Electron + embedded server + PGlite), built by GitHub Actions
- [ ] Export / import a whole store (e.g. build it in the desktop app, then move it to a server)
- [ ] Documentation site (the docs are in the repository under `docs/`)

## Later
- [ ] "ShopMe Cloud": a hosted offer
