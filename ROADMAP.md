# Roadmap

ShopMe is pre-alpha. Phases are goals, not promises.

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
- [ ] Products, variants, collections
- [ ] Inventory (single location)
- [ ] Customers
- [ ] Cart
- [ ] Stripe checkout
- [ ] Orders
- [ ] Basic admin
- [ ] Default theme
- [ ] **Done when:** one product can be sold end-to-end

## Phase 2 - Compatibility
- [ ] Liquid Online Store 2.0 themes
- [ ] Ajax Cart API
- [ ] Storefront and Admin GraphQL subsets
- [ ] Webhooks with HMAC signatures
- [ ] OAuth apps
- [ ] **Done when:** the conformance suite is green

## Phase 3 - Advanced commerce
- [ ] Discounts
- [ ] EU VAT / OSS
- [ ] Shipping zones
- [ ] Multi-currency
- [ ] Multi-language
- [ ] Gift cards
- [ ] Refunds and returns
- [ ] Multi-location inventory
- [ ] French carriers (Colissimo, Mondial Relay)

## Phase 4 - Ecosystem
- [ ] Visual theme editor
- [ ] Metafields and metaobjects
- [ ] App platform
- [ ] CLI: theme dev / push
- [ ] One-click migration from Shopify

## Phase 5 - Production
- [ ] Performance
- [ ] Security hardening
- [ ] GDPR tooling
- [ ] Observability
- [ ] Helm charts (Docker Compose already available)
- [ ] One-click deploy templates
- [ ] Desktop apps: Windows `.exe` and macOS `.dmg` (Electron + embedded server + PGlite), built by GitHub Actions
- [ ] Export / import a whole store (e.g. build it in the desktop app, then move it to a server)
- [ ] Documentation site

## Later
- [ ] "ShopMe Cloud": a hosted offer
