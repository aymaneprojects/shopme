# Shoppen

**The simplicity of Shopify, the freedom of open source. Migrate your store in one click.**

Shoppen is an open-source e-commerce platform that runs Shopify-format Liquid themes, exposes a compatible
subset of Shopify's Admin and Storefront APIs, and will ship a one-click "migrate from Shopify" tool.

> **Status: pre-alpha.** Nothing here is usable yet. See the [ROADMAP](ROADMAP.md). Francais : [README.fr.md](README.fr.md).

## Architecture

- TypeScript monorepo (pnpm workspaces + Turborepo)
- PostgreSQL with row-level security (RLS) for multi-tenancy
- Redis + BullMQ for background jobs
- GraphQL API with GraphQL Yoga + Pothos
- Next.js admin
- LiquidJS-based theme engine
- Payment adapters for Stripe, Mollie and PayPal, using hosted card fields

## Repository layout

| Path | Role |
| --- | --- |
| `apps/api` | Admin + Storefront GraphQL API |
| `apps/admin` | Back-office UI |
| `apps/storefront` | Liquid theme renderer |
| `apps/checkout` | Checkout |
| `apps/worker` | Background jobs |
| `packages/core` | Domain logic |
| `packages/liquid-compat` | Liquid compatibility layer |
| `packages/shopify-compat` | GID mapping, API shapes |
| `packages/payments` | Payment adapters |
| `packages/theme-default` | Default theme (MIT) |
| `packages/sdk` | Client SDK (MIT) |
| `packages/cli` | CLI |
| `packages/migrate` | Migration tooling |
| `packages/ui` | Components and design tokens (MIT) |
| `scripts/re` | Reverse-engineering scripts for your own dev store |
| `docs/legal` | Clean-room policy |

## Quickstart

_Coming soon._ For now: `corepack enable && pnpm install && pnpm typecheck`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [clean-room policy](docs/legal/clean-room.md).

## License

The core is licensed under **AGPL-3.0** (see [LICENSE](LICENSE)). `packages/theme-default`, `packages/sdk` and
`packages/ui` are licensed under **MIT** (each has its own `LICENSE`).

## Disclaimer

Shoppen is **not affiliated with, endorsed by, or sponsored by Shopify Inc.** "Shopify" is a trademark of its
owner and is mentioned only to describe compatibility with Shopify-format themes and APIs.
