# @shopme/migrate

Import a Shopify store into ShopMe through the Admin GraphQL API.

```bash
# access token
pnpm --filter @shopme/migrate shopify -- --shop my-store --token shpat_xxx --data-dir ./data
# or a client id/secret (client-credentials grant); env SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET also work
pnpm --filter @shopme/migrate shopify -- --shop my-store --client-id ID --client-secret SECRET
```

Options: `--only products,collections,...` (phases: locations, products, inventory, collections, customers, orders, pages, blogs, menus,
redirects, policies, theme), `--theme-settings`, `--data-dir`, `--database-url`, `--owner-email/--owner-password` (creates the store when
the data dir has none), `--verbose`. The server exposes the same thing as `POST /admin/api/migrate/shopify` (a job) + `GET /admin/api/jobs/:id`.

- Needs the read scopes of what you import (`read_products`, `read_inventory`, `read_locations`, `read_customers`, `read_orders`, `read_content`,
  `read_online_store_navigation`, `read_legal_policies`, `read_themes`). A phase whose scope is missing is skipped with a warning.
- Idempotent: source ids are kept in `import_mappings`; re-runs update products, collections, customers, pages, menus, and skip orders already imported.
- Orders are historical rows (names like `#1042` kept, no emails, no stock movement). Without `read_all_orders` Shopify only returns the last 60 days.
- Requests are throttled by query cost (leaky bucket) and retried on `THROTTLED`.
- Not imported: metafields, discounts, gift cards, transactions/fulfillments of orders, theme code (only `config/settings_data.json` with `--theme-settings`).
