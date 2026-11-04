# @shopme/admin

Back-office SPA for merchants (Vite + React). Placeholder: the admin SPA is built in a later wave.

## Contract with the server

- `pnpm --filter @shopme/admin build` must output a static site to `apps/admin/dist` (with `index.html`).
- `apps/server` serves that directory at `/admin/*` with SPA fallback (assets must be built with `base: '/admin/'`).
  If `dist` does not exist the server shows an "admin not built" page.
- The SPA talks to the server through the REST auth endpoints and the Admin GraphQL API, see
  [docs/dev/admin-auth.md](../../docs/dev/admin-auth.md) and [docs/dev/admin-graphql.md](../../docs/dev/admin-graphql.md).
- In development, run the Vite dev server with a proxy for `/admin/api` and `/files` to the server and set
  `TRUSTED_ORIGINS=http://localhost:5173` on the server so cookie-authenticated POSTs pass the origin check.
