import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config';
import { createDb } from './db/client';
import { runMigrations } from './db/migrate';
import { seedDemo } from './seed-demo';
import { createLocalStorage } from './services/storage';

/** `pnpm seed`: insert demo data. Stop the server first when using embedded PGlite (single-process). */
async function main() {
  const base = process.env.INIT_CWD ?? process.cwd();
  for (const f of [path.join(base, '.env')]) if (existsSync(f)) process.loadEnvFile(f);
  const config = loadConfig();
  const handle = await createDb({ databaseUrl: config.databaseUrl, dataDir: config.dataDir });
  try {
    await runMigrations(handle);
    const r = await seedDemo(handle.db, createLocalStorage(config.storageDir), { adminPassword: process.env.SEED_ADMIN_PASSWORD });
    console.log(`Seeded demo data into shop "${r.shop.name}".`);
    if (r.adminPassword) console.log(`Admin login: ${r.adminEmail} / ${r.adminPassword}  (change it after first login)`);
  } finally {
    await handle.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
