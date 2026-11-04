# @shopme/core

Database (Drizzle schema + committed migrations in `drizzle/`), domain services, config, mail, in-process job queue.

- `pnpm --filter @shopme/core db:generate --name <name>`: generate a migration after changing `src/db/schema/*`
- `pnpm seed`: demo data (stop the server first when using embedded PGlite)
- Conventions: [docs/dev/foundation.md](../../docs/dev/foundation.md)
