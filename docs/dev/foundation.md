# Foundation: conventions for feature work

## Layout

- `packages/core`: `src/db/schema/*` (Drizzle tables, all MVP tables exist already), `drizzle/` (committed migrations),
  `src/services/*` (domain functions), `config.ts`, `mail.ts`, `queue.ts`, `seed-demo.ts`.
- `packages/shopify-compat`: GIDs, money, userErrors.
- `apps/server`: Fastify app. `src/app.ts` wires everything; mount points: `src/storefront/index.ts`
  (`registerStorefront`), `src/checkout/index.ts` (`registerCheckout`), `src/webhooks/index.ts`, `src/jobs.ts`
  (register background jobs), `src/admin/graphql/modules/` (GraphQL).
- Request-time shared state is `app.ctx` (`AppContext`: config, db, queue, mailer, storage, paths, log). Resolve auth with
  `authenticate(request)` from `plugins/auth`.

## Service function conventions

- Live in `packages/core/src/services/<area>.ts`, exported from `services/index.ts`.
- Signature: `fn(db: Executor, shopId: number, input)`; `Executor` is the db or a transaction. Every query filters by `shopId`.
  Multi-step writes take a `Db` and call `db.transaction(...)`, passing `tx` to helpers.
- Money is integer minor units (cents) in the shop currency. Ids are `number` (bigserial). Timestamps are `Date`.
- Enums are stored as text with CHECK constraints, in the GraphQL enum casing (`ACTIVE`, `DRAFT`, theme role `MAIN`, ...).
  Exceptions: staff `role` (`owner|admin|staff`), address `kind` (`shipping|billing`), event `kind` (`comment|system`).
- Handles: `slugify` and `uniqueHandle` (per-shop unique). Order numbers: `nextOrderNumber` (starts at 1001).
- Timeline: `addEvent` / `listEvents` (`events` table: subject_type, subject_id, kind comment|system, message,
  author_staff_user_id, data). Staff comments are `kind: 'comment'`.
- Validation problems: return data (userErrors at the API edge); throw only for programmer errors.

## Database

- Schema changes: edit `packages/core/src/db/schema/*`, run `pnpm db:generate --name <what>`, commit the SQL in
  `packages/core/drizzle/`. Migrations run automatically at server start for both drivers.
- Driver: `DATABASE_URL` set means PostgreSQL (postgres.js); otherwise embedded PGlite in `DATA_DIR/pglite`
  (single process: stop the server before `pnpm seed`). Write portable SQL (both are PostgreSQL).
- One shop per installation, but keep `shop_id` on every tenant table and in every query.

## Background jobs

`ctx.queue` (`JobQueue`): `register(type, handler)`, `enqueue(type, payload, { delayMs, maxAttempts })`, `every(name, ms, fn)`.
In-process with retry/backoff; the interface is meant to be swappable for a separate worker.

## Uploads

`ctx.storage` (`Storage`: put/open/delete/url, local disk under `STORAGE_DIR`) and `saveUpload()` which also records a
`files` row. Files are served at `/files/*` with a sandboxing CSP.

## Embedding (desktop app)

`startServer({ port?, host?, dataDir?, appUrl?, databaseUrl?, storageDir?, baseDir?, env?, paths?, logger? })` returns
`{ url, port, config, close() }`; `port: 0` picks a free port. Migrations, admin build and theme directories are located
relative to the package (override with `paths` or `MIGRATIONS_DIR`, `ADMIN_DIST_DIR`, `THEME_DEFAULT_DIR`, `THEMES_DIR`, `THEME_PREVIEWS_DIR`), never `process.cwd()`.

## Commands

```bash
pnpm install
pnpm dev                       # server with watch, embedded DB
pnpm turbo run typecheck test build
pnpm --filter @shopme/server test
pnpm --filter @shopme/core test
pnpm e2e                       # builds, starts the production server on a free port with a fresh DB, drives admin + storefront + checkout in Chromium (Playwright)
```

Tests use in-memory PGlite (no PostgreSQL needed, also in CI).

## Deviations from docs/spec/data-model.md

Single store per installation (no RLS, no composite same-tenant FKs); money is integer minor units instead of
`numeric(19,4)`; quantities are columns of `inventory_levels` instead of an `inventory_quantities` table; one `media`
table plus `files` for uploads; orders store amounts in the shop currency with `currency_rate` for presentment; no
`fulfillment_orders` table yet (order lines carry `fulfilled_quantity`).
