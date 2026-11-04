# Reverse-engineering scripts

Helpers that study the behavior of a Shopify store so Shoppen can be compatible with it. They read data from
**your own development store** and save it **outside this repository**. Read
[docs/legal/clean-room.md](../../docs/legal/clean-room.md) first.

## Setup

1. Create a free development store (Shopify Partners) that you own.
2. In the Dev Dashboard, create an app with **read-only** scopes (products, customers, orders, themes, locations,
   content) and install it on that store.
3. Copy `.env.example` to `.env` at the repo root and fill in `SHOPIFY_SHOP` (`name` or `name.myshopify.com`),
   `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, and `SHOPIFY_STOREFRONT_PASSWORD` if the storefront is
   password-protected. `.env` is git-ignored.
4. Install tools: bash, curl, jq, node 22, and run `pnpm install` at the repo root.
5. Run everything: `bash scripts/re/run-all.sh`

Use `ENV_FILE=/path/to/file` to load a different env file. `API_VERSION` defaults to `2026-10`.

## Where data goes

`RE_OUT` (default `~/shoppen-re`). The scripts refuse to run if it is inside a git repository. Never copy this data
into the repo. The access token is cached in `$RE_OUT/.token.json` (mode 600) and never printed.

## Scripts

| Script | What it does |
| --- | --- |
| `token.sh` | Gets/refreshes a token |
| `gql.sh <file\|-> [vars]` | Runs a GraphQL query, prints JSON |
| `introspect.sh` | Saves schema introspection and SDL to `raw/admin-<version>/` |
| `fetch-samples.sh` | Saves shop, products, collections, customers, orders to `raw/samples/` |
| `dump-theme.sh [gid\|--all]` | Saves theme files to `raw/theme/<name>/` |
| `run-all.sh` | All of the above, plus `capture-storefront.mjs` when present |

## When you are done

Revoke or rotate the app's client secret in the Dev Dashboard (or uninstall the app), and delete `.env`.
