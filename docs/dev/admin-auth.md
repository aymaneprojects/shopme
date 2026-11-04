# Admin authentication contract (REST)

Implemented in `apps/server/src/admin/auth-routes.ts`. This is the contract for the admin SPA (and any client).
All bodies and responses are JSON. Mutating requests must come from the same origin (see "CSRF").

| Method and path | Body | Success | Errors |
| --- | --- | --- | --- |
| `GET /admin/api/setup/status` | none | `200 { needsSetup: boolean }` | |
| `POST /admin/api/setup` | `{ shopName, email, password, currency, country, locale, timezone?, firstName?, lastName? }` | `201 { user, shop }` and a session cookie (the owner is logged in) | `422 { error, issues[] }` invalid input (password min 8, `currency` ISO 4217, `country` ISO 3166 alpha-2); `409` already set up |
| `POST /admin/api/auth/login` | `{ email, password }` | `200 { user, shop }` and a session cookie | `401` bad credentials; `422`; `429` + `Retry-After` after 10 failures per IP or per email in 15 minutes |
| `POST /admin/api/auth/logout` | none | `200 { ok: true }`, cookie cleared | |
| `GET /admin/api/auth/me` | none | `200 { user, shop }` | `401 { error }` when not logged in |
| `POST /admin/api/files` | multipart, field `file` | `201 { file: { id, filename, url, mimeType, byteSize } }` | `401`, `413` (max 25 MB) |

Shapes (numeric ids):

```ts
user = { id, shopId, email, firstName, lastName, role: 'owner' | 'admin' | 'staff' }
shop = { id, name, email, currency, country, locale, timezone, weightUnit, moneyFormat, moneyWithCurrencyFormat, taxesIncluded, primaryDomain }
```

## Session

- Cookie `shopme_session`: random token, signed with `SESSION_SECRET`, `HttpOnly`, `SameSite=Lax`, `Secure` when `APP_URL`
  is https, path `/`, 14 days. The database stores only the SHA-256 of the token (`sessions` table); logout deletes the row.
- The SPA should call `/admin/api/setup/status` first (show the wizard if `needsSetup`), then `/admin/api/auth/me`
  (401 means show the login page). Send requests with `credentials: 'same-origin'`.

## CSRF

`SameSite=Lax` plus an Origin check: `POST/PUT/PATCH/DELETE` under `/admin/api/` that carry an `Origin` header are
rejected (`403`) unless it matches the request host, `APP_URL`, or an entry of `TRUSTED_ORIGINS` (use that for a Vite dev
server, e.g. `http://localhost:5173`). Requests authenticated with `X-Shopify-Access-Token` are exempt.

## Admin GraphQL authentication

`POST /admin/api/<version>/graphql.json` accepts either the session cookie or the header
`X-Shopify-Access-Token: <token>`. Tokens are rows of `api_tokens` (create with `createApiToken` from `@shopme/core`; only a hash
is stored, scopes like `read_products`). Missing or invalid credentials: `401 { errors }`. Insufficient scope: GraphQL error
with `extensions.code = "ACCESS_DENIED"`. See [admin-graphql.md](admin-graphql.md).
