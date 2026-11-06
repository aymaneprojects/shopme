#!/usr/bin/env tsx
import { createDb, createLocalStorage, getPrimaryShop, getShopByHandle, loadConfig, runMigrations, scopedStorage, setupStore } from '@shopme/core';
import { ShopifyClient, DEFAULT_API_VERSION, type ShopifyAuth } from './shopify-client';
import { importFromShopify, PHASES, type Phase } from './shopify-import';

const USAGE = `Usage: pnpm --filter @shopme/migrate shopify -- --shop <domain> (--token <t> | --client-id <id> --client-secret <secret>) [options]

  --shop <domain>          my-store or my-store.myshopify.com
  --token <t>              Admin API access token (or env SHOPIFY_ACCESS_TOKEN)
  --client-id/--client-secret   client-credentials grant (or env SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET)
  --only a,b               phases: ${PHASES.join(', ')}  (default: all but theme)
  --theme-settings         also copy the live theme's config/settings_data.json
  --data-dir <dir>         ShopMe data dir (default ./data, or env DATA_DIR); --database-url <url> for PostgreSQL
  --owner-email/--owner-password   create the store first when this data dir has none
  --store <handle>         multi-store installation: the store to import into (default: the first store)
  --verbose                print progress lines when not on a terminal
  --api-version <v>        default ${DEFAULT_API_VERSION}`;

function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--') || a === '--') continue;
    const [k, inline] = a.slice(2).split('=', 2) as [string, string | undefined];
    const next = argv[i + 1];
    if (inline !== undefined) out[k] = inline;
    else if (next && !next.startsWith('--')) { out[k] = next; i++; } else out[k] = true;
  }
  return out;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const env = process.env;
  const shop = (a['shop'] as string) || env.SHOPIFY_SHOP;
  const token = (a['token'] as string) || env.SHOPIFY_ACCESS_TOKEN;
  const clientId = (a['client-id'] as string) || env.SHOPIFY_CLIENT_ID;
  const clientSecret = (a['client-secret'] as string) || env.SHOPIFY_CLIENT_SECRET;
  if (!shop || (!token && !(clientId && clientSecret)) || a['help']) { console.error(USAGE); process.exit(a['help'] ? 0 : 2); }
  const auth: ShopifyAuth = token ? { token } : { clientId: clientId!, clientSecret: clientSecret! };
  const only = typeof a['only'] === 'string' ? (a['only'].split(',').map((s) => s.trim()) as Phase[]) : undefined;
  if (only?.some((p) => !PHASES.includes(p))) { console.error(`Unknown phase. Valid: ${PHASES.join(', ')}`); process.exit(2); }

  const config = loadConfig({ ...env, ...(a['data-dir'] ? { DATA_DIR: String(a['data-dir']) } : {}), ...(a['database-url'] ? { DATABASE_URL: String(a['database-url']) } : {}), SESSION_SECRET: env.SESSION_SECRET ?? 'x'.repeat(40) });
  const handle = await createDb({ databaseUrl: config.databaseUrl, dataDir: config.dataDir });
  try {
    await runMigrations(handle);
    const client = new ShopifyClient({ shop, auth, apiVersion: (a['api-version'] as string) || DEFAULT_API_VERSION, onThrottle: (ms) => process.stderr.write(`  (rate limit: waiting ${ms}ms)\n`) });
    const wanted = typeof a['store'] === 'string' ? a['store'] : null;
    let store = wanted ? await getShopByHandle(handle.db, wanted) : await getPrimaryShop(handle.db);
    if (wanted && !store) { console.error(`No store with the handle "${wanted}" in this installation.`); process.exit(2); }
    if (!store) {
      if (!a['owner-email'] || !a['owner-password']) { console.error('No store in this data directory yet: pass --owner-email and --owner-password to create it (or complete setup in the admin first).'); process.exit(2); }
      const info = (await client.query<{ shop: { name: string; currencyCode: string } }>('{ shop { name currencyCode } }', {}, 5)).shop;
      store = (await setupStore(handle.db, { shopName: info.name, email: String(a['owner-email']), password: String(a['owner-password']), currency: info.currencyCode, country: 'US', locale: 'en' })).shop;
    }
    let last = '';
    const summary = await importFromShopify({
      db: handle.db, shopId: store.id, storage: scopedStorage(createLocalStorage(config.storageDir), store.storagePrefix), client, only: a['theme-settings'] ? [...(only ?? PHASES.filter((p) => p !== 'theme')), 'theme'] : only,
      onProgress: (e) => {
        const line = `${e.phase}: ${e.processed}${e.total ? `/${e.total}` : ''}`;
        if (line !== last && process.stderr.isTTY) process.stderr.write(`\r${line}      `);
        else if (line !== last && a['verbose']) process.stderr.write(`${line}\n`);
        last = line;
      },
    });
    if (process.stderr.isTTY) process.stderr.write('\n');
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = Object.values(summary.phases).some((p) => p.failed) ? 1 : 0;
  } finally {
    await handle.close();
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
