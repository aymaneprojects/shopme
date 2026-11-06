# @shopme/server

The one ShopMe process (Fastify): Admin GraphQL API, admin auth REST endpoints, admin SPA hosting (`/admin`), uploads
(`/files`), and mount points for the storefront, checkout and webhooks.

```bash
pnpm dev      # tsx watch, embedded PGlite in ./data unless DATABASE_URL is set
pnpm build    # tsup -> dist/ (workspace packages bundled, npm deps external)
pnpm start    # node dist/main.js
pnpm test
```

Programmatic use (CLI, tests, desktop shell):

```ts
import { startServer } from '@shopme/server';
const { url, close } = await startServer({ port: 0, dataDir: '/path/to/data' });
```

Paths (migrations, admin build, default theme) are resolved relative to the package, never `process.cwd()`;
override with the `paths` option or `MIGRATIONS_DIR`, `ADMIN_DIST_DIR`, `THEME_DEFAULT_DIR`, `THEMES_DIR`, `THEME_PREVIEWS_DIR`.
See [docs/dev/foundation.md](../../docs/dev/foundation.md).
