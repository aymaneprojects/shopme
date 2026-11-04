# ShopMe

**The simplicity of Shopify, the freedom of open source. Migrate your store in one click.**

ShopMe is an open-source e-commerce platform that runs Shopify-format Liquid themes, exposes a compatible
subset of Shopify's Admin and Storefront APIs, and will ship a one-click "migrate from Shopify" tool.

> **Status: pre-alpha.** The foundation (server, database, auth) runs; features are being built. See the [ROADMAP](ROADMAP.md). Français : [README.fr.md](README.fr.md).

## Architecture

ShopMe is **one container**: a single Node.js process plus PostgreSQL (or an embedded database for local use).
Redis is not required for the MVP; background jobs run in-process behind a small queue interface.

- TypeScript monorepo (pnpm workspaces + Turborepo)
- `apps/server`: one Fastify process serving the Admin GraphQL API, admin auth endpoints, the admin SPA at `/admin`,
  the storefront (Liquid renderer), the Ajax cart API, checkout and webhooks
- PostgreSQL via Drizzle ORM (embedded PGlite when `DATABASE_URL` is not set, so `pnpm dev` needs no setup)
- One shop per installation; tables keep a `shop_id` so a multi-tenant "ShopMe Cloud" stays possible
- GraphQL API with GraphQL Yoga + Pothos (Shopify-shaped Admin API subset)
- React admin SPA (Vite), built into `apps/admin/dist` and served by the server
- LiquidJS-based theme engine, Shopify-format themes
- Payment adapters for Stripe, Mollie and PayPal, using hosted card fields

## Repository layout

| Path | Role |
| --- | --- |
| `apps/server` | The one process: Admin API, auth, admin SPA hosting, storefront, cart, checkout, webhooks |
| `apps/admin` | Back-office SPA (Vite + React), served by the server at `/admin` |
| `packages/core` | Database (Drizzle schema, migrations), domain services, config |
| `packages/shopify-compat` | GID helpers, money formatting, `userErrors` helpers |
| `packages/liquid-compat` | Liquid compatibility layer |
| `packages/payments` | Payment adapters |
| `packages/theme-default` | Default theme (MIT) |
| `packages/sdk` | Client SDK (MIT) |
| `packages/cli` | CLI |
| `packages/migrate` | Migration tooling |
| `packages/ui` | Components and design tokens (MIT) |
| `scripts/re` | Reverse-engineering scripts for your own dev store |
| `docs/` | Specs (`spec/`), developer notes (`dev/`), install guides (`install/`), clean-room policy (`legal/`) |

## Quickstart

```bash
corepack enable
pnpm install
pnpm dev          # http://localhost:3000/admin opens the setup wizard
```

No database to install: without `DATABASE_URL`, ShopMe stores data in an embedded PostgreSQL (PGlite) under `./data`.
Optional demo data: stop the server, run `pnpm seed`. Docker, VPS and backup instructions: [docs/install](docs/install/README.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [clean-room policy](docs/legal/clean-room.md).

## License

The core is licensed under **AGPL-3.0** (see [LICENSE](LICENSE)). `packages/theme-default`, `packages/sdk` and
`packages/ui` are licensed under **MIT** (each has its own `LICENSE`).

## Disclaimer

ShopMe is **not affiliated with, endorsed by, or sponsored by Shopify Inc.** "Shopify" is a trademark of its
owner and is mentioned only to describe compatibility with Shopify-format themes and APIs.
