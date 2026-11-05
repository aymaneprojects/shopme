# Platform: analytics, staff security, headers, store transfer, languages

Migration `0004_wave7c_platform`: tables `visits`, `staff_two_factor`, `shop_locales`, `translations`.
Core services in `packages/core/src/services/`: `analytics/reports`, `analytics/visits`, `two-factor`, `locales`, `translations`,
`store-export`, `backups`. Server: `security.ts`, `locale-cache.ts`, `admin/{two-factor,report,backup}-routes.ts`,
`admin/graphql/modules/{analytics,locales}.ts`, `storefront/{visits,locale}.ts`.

## Analytics reports

`shopmeReport(name, from, to, groupBy)` (scope `read_reports`, part of the "orders" permission area). `from`/`to` are `YYYY-MM-DD`
days in the shop time zone, inclusive; `groupBy` is `DAY | WEEK | MONTH` for the time reports. Names: `SALES_OVER_TIME`,
`ORDERS_OVER_TIME`, `AVERAGE_ORDER_VALUE`, `SALES_BY_PRODUCT`, `SALES_BY_VARIANT`, `SALES_BY_VENDOR`, `RETURNING_CUSTOMER_RATE`,
`TOP_CUSTOMERS`, `DISCOUNT_USAGE`, `TAXES`, `INVENTORY_SNAPSHOT` (ignores the range), `SESSIONS` (sessions, page views, orders,
conversion). The result is generic: `columns { key label type }` (`text|date|int|money|percent`), `rows` (JSON, money in minor units),
`totals`. Orders counted: not cancelled, not test, `processed_at` in range. CSV: `GET /admin/api/reports/<NAME>.csv?from&to&groupBy`.
The admin page is `/admin/analytics/:name` (date presets or custom range, comparison with the previous period or year, SVG chart).

Visit tracking (storefront scope, `storefront/visits.ts`): one `visits` row per successful HTML GET, with the anonymous id of the
`shopme_vid` cookie (httpOnly, 30 minutes, sliding). No IP, user agent or user id is stored. Bots, prefetches, `sections=` calls,
Do-Not-Track and Global Privacy Control are skipped. With the cookie banner on (`shopmeCookieBanner`), only visitors whose
`cookie_consent` cookie is `accepted|all|analytics|true|1` are counted. Rows older than 400 days are purged daily.

## Staff 2FA and sessions

TOTP is implemented with `node:crypto` (RFC 6238, SHA-1, 6 digits, one step of drift); the QR code is `qrcode` (server only).
The secret is stored AES-256-GCM encrypted (key derived from `SESSION_SECRET`); recovery codes are stored as SHA-256 hashes and
consumed on use. REST (cookie sessions only):

- `POST /admin/api/auth/login` returns `{ twoFactorRequired: true, challenge }` (a 5-minute HMAC-signed token, no session yet)
  when the member has 2FA; `POST /admin/api/auth/login/2fa { challenge, code }` (TOTP or recovery code, rate limited) creates the session.
- `GET /admin/api/auth/security`, `POST /auth/2fa/setup | enable | disable | recovery-codes`, `PUT /auth/security { require2fa }`
  (owner/admin), `DELETE /auth/sessions/:id`, `POST /auth/sessions/revoke-others`.
- `shops.settings.security.require2fa`: members who have not enrolled keep a session but with no scopes (every API call is denied);
  `GET /auth/me` returns `twoFactorSetupRequired` and the admin shows only the Security screen.
- Login alert: notification key `staff_login_alert` is mailed when a sign-in comes from an IP and user agent without an active session
  (not for a member's first login).

## Headers and caching

`security.ts` runs on every response. All: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Strict-Transport-Security` only with `HSTS=true` and an https `APP_URL`. Admin (`/admin*`): strict CSP (`script-src 'self'`,
`frame-ancestors 'none'`, `connect-src 'self'`, ...) and `X-Frame-Options: DENY`. Storefront: `X-Frame-Options: SAMEORIGIN`, an enforced
`frame-ancestors 'self'` CSP and a report-only CSP (reports are logged by `POST /csp-report`). `/files/*` keeps its sandbox CSP.
Cacheable text responses (GET/HEAD, 200, not `no-store`) get a weak ETag unless the route set one, and `If-None-Match` answers 304.
Storefront HTML is `no-cache` (revalidated with the ETag); theme assets with `?v=` stay `immutable` for a year.

## Store export, import, backups

`.shopme` is a zip: `manifest.json` (`format`, `formatVersion`, `schemaVersion` = applied migrations, `appVersion`, table counts),
`data/<table>.json` per table (every table with a `shop_id` except `staff_users`, `staff_two_factor`, `sessions`, `api_tokens`,
`customer_tokens`, `jobs`, `webhook_deliveries`, `visits`), `data/shop.json`, and `uploads/<storage key>` for every file and theme binary.
Tables are written and restored in foreign-key order, computed from the Drizzle schema, so new tables are included automatically.

Import replaces the store in one transaction (rows of the importing shop are deleted, the archive rows inserted with their ids, shop
ids remapped, sequences reset); the local owner, sessions and API tokens stay. It refuses archives with another format, a newer
`formatVersion`, or a newer `schemaVersion` than the running database. Importing the same file twice gives the same state.
When the store already has products, orders or customers, the request must carry `confirm=replace` (a multipart field before the file).

REST (scope `write_shop`): `POST /admin/api/store/export` -> 202 `{ job }`, `GET /admin/api/store/jobs/:id`,
`GET /admin/api/store/export/:jobId/download`; `POST /admin/api/store/import` (multipart); `GET|POST /admin/api/store/backups`,
`PUT /admin/api/store/backups/settings { enabled, intervalHours, keep }`, `GET|DELETE /admin/api/store/backups/:name`.
Automatic backups go to `DATA_DIR/backups/backup-<timestamp>.shopme` (on by default: daily, keep 7; checked hourly and once 90 s after
start); on-demand exports are `export-*.shopme` and are deleted after an hour. The desktop app's "Export my store..." and
"Import a store..." menu items call `RunningServer.exportStore/importStore` (no HTTP session needed). To move from the desktop app to
a server: export, install the server, create the owner, import (Settings, Backup and transfer).

## Languages and translations

`shopLocales`, `shopLocaleEnable | Update(published) | Disable`, `translatableResources(resourceType)`, `translatableResource`,
`translationsRegister`, `translationsRemove` follow Shopify's shapes. Resource types: `PRODUCT`, `COLLECTION`, `PAGE`, `ARTICLE`,
`MENU`, `LINK` (menu items), `ONLINE_STORE_THEME` (the main theme's default locale file, flattened to `a.b.c` keys). Fields:
`title`, `body_html`, `product_type`, `meta_title`, `meta_description`, `summary_html`. Registering needs the current
`translatableContentDigest`; a translation whose source changed reports `outdated: true` (and is still served). Scopes
`read|write_locales` (settings area) and `read|write_translations` (online store area).

Storefront: when a non-primary locale is published, URLs `/fr`, `/fr/products/x` are served (`LocaleCache.rewrite` strips the prefix
before routing and remembers the locale per request). The page is rendered with translated content, the theme's `locales/fr.json`
overlaid with the merchant's theme-string translations, `request.locale`, `localization` (`available_languages[].url` is the same
page in each language), `routes.*` and every root-relative `href`/`action` in the HTML prefixed. `POST /localization`
(`language_code`, `return_to`) redirects to the page in that language. Aurora renders `hreflang` links and a footer selector.

Not translated on the storefront yet: blog articles, policies, sitemap hreflang, checkout pages. Client-side URLs built in JS
(Ajax cart calls) stay unprefixed.
