# Admin GraphQL: how to add a module

Code lives in `apps/server/src/admin/graphql/`:

```
builder.ts        Pothos SchemaBuilder + Query/Mutation roots (do not create another builder)
context.ts        GraphQLContext { app, db, shopId, auth, request }, requireScope()
schema.ts         builder.toSchema() after importing ./modules
route.ts          POST /admin/api/:version/graphql.json (any YYYY-MM or "unstable"; same schema for all)
types/            shared building blocks: scalars, node, connection, errors, money
modules/index.ts  THE registry: one side-effect import per module
modules/<name>.ts one file per feature (shop.ts is the worked example)
```

## Adding a module

1. Create `modules/products.ts`. Import `builder` and register types and root fields:
   `builder.queryFields((t) => ({ products: t.field({ ... }) }))`, `builder.mutationFields(...)`.
2. Add `import './products';` to `modules/index.ts` (the only shared file; keep one line per module).
3. Services do the work, resolvers only adapt: `(_root, args, ctx) => listProducts(ctx.db, ctx.shopId, ...)`.
4. When you add the first real mutation, delete the deprecated `shopmePlaceholder` mutation in `builder.ts`.

## Building blocks

- **Node / GIDs**: implement with `interfaces: [Node]`; `id` is inherited and resolves to `gid://shopify/<TypeName>/<db id>`.
  Register `registerNode('Product', (ctx, id) => getProduct(ctx.db, ctx.shopId, id))` so `node`/`nodes` work. Loaders must
  filter by `ctx.shopId`. Use `legacyId` for `legacyResourceId`. Parse incoming ids with `parseId(value, 'Product')`
  from `@shopme/shopify-compat` (lenient: GID or number; returns null on mismatch, then return a `userError`).
- **Connections**: `const ProductConnection = defineConnection('Product', ProductRef)` creates `ProductConnection` and
  `ProductEdge` (`edges`, `nodes`, `pageInfo`). Fields use `args: ConnectionArgs` (first/after/last/before/reverse) and
  `resolve: (_, args, ctx) => paginate(args, { fetch: ({offset, limit}) => ..., total: () => ... })`. Max page 250,
  one of `first`/`last` is required, cursors are opaque. Apply `args.reverse` in your query yourself. Add `sortKey` and
  `query` args per field.
- **Mutations and userErrors**: `definePayload<{ product: Product | null }>('ProductCreatePayload', (t) => ({ product: ... }))`
  appends `userErrors: [UserError!]!`. Return `ok({ product })` or `failed(userError(['input','title'], 'Title can't be blank'), ['product'])`
  from `@shopme/shopify-compat`. Validation problems are userErrors (HTTP 200), never thrown.
- **Money**: store integer minor units; expose with `moneyBag(minor, currency)` (`MoneyBag`), `moneyV2(...)`, or the `Money` /
  `Decimal` scalars via `formatMoney` / `formatDecimal`. `DateTime` accepts `Date` or ISO string.
- **Scopes**: call `requireScope(ctx, 'read_products')` (staff sessions hold every scope; `write_x` satisfies `read_x`).
- `extensions.cost` is a stub (`cost.ts`).

## Testing a module

Use `createTestApp()` and `setupAndLogin()` from `apps/server/src/test-utils.ts` (in-memory PGlite) and `app.inject`.
