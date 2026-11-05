import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import multipart from '@fastify/multipart';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  buildThemeZip, createJob, createThemeFromZip, exportCustomers, exportInventory, exportOrders, exportProducts, getJob, getTheme, importCustomers, importInventory, importProducts, JobReporter,
  MAX_THEME_ZIP_BYTES, parseCsvObjects, randomToken, type Db, type ImportEnv, type Reporter,
} from '@shopme/core';
import { importFromShopify, PHASES, ShopifyClient, type Phase } from '@shopme/migrate';
import { authenticate } from '../plugins/auth';
import type { AuthInfo } from '../context';

const MAX_CSV_BYTES = 200 * 1024 * 1024;
const IMPORTS = { products: importProducts, customers: importCustomers, inventory: importInventory } as const;
type ImportKind = keyof typeof IMPORTS;
const SCOPE: Record<string, string> = { products: 'products', customers: 'customers', inventory: 'inventory', orders: 'orders' };

const allowed = (a: AuthInfo, scope: string) => a.scopes.includes('*') || a.scopes.includes(scope) || (scope.startsWith('read_') && a.scopes.includes(`write_${scope.slice(5)}`));

interface CsvJob { jobId: number; shopId: number; kind: ImportKind; file: string; dryRun: boolean }
interface MigrateJob { jobId: number; shopId: number; shop: string; auth: ConstructorParameters<typeof ShopifyClient>[0]['auth']; only?: Phase[]; apiVersion?: string }

/** Register the job handlers (`csv.import`, `migrate.shopify`) on the in-process queue. */
export function registerDataJobs(app: FastifyInstance) {
  const { queue, db, storage } = app.ctx;
  queue.register<CsvJob>('csv.import', async (j) => {
    const rep = new JobReporter(db, j.jobId, j.dryRun);
    try {
      const env: ImportEnv = { db, shopId: j.shopId, storage, dryRun: j.dryRun };
      await IMPORTS[j.kind](env, parseCsvObjects(createReadStream(j.file)), rep as Reporter);
      await rep.finish();
    } catch (e) { rep.error(e instanceof Error ? e.message : String(e)); await rep.finish(e instanceof Error ? e.message : 'Import failed'); }
    finally { await rm(j.file, { force: true }); }
  });
  queue.register<MigrateJob>('migrate.shopify', async (j) => {
    const rep = new JobReporter(db, j.jobId);
    try {
      const client = new ShopifyClient({ shop: j.shop, auth: j.auth, apiVersion: j.apiVersion });
      const summary = await importFromShopify({
        db, shopId: j.shopId, storage, client, only: j.only,
        onProgress: async (e) => {
          rep.result.details = { ...rep.result.details, [e.phase]: { created: e.summary.created, updated: e.summary.updated, skipped: e.summary.skipped, failed: e.summary.failed } };
          await rep.progress(e.processed, e.total, e.phase);
        },
      });
      for (const [phase, s] of Object.entries(summary.phases)) {
        rep.result.details = { ...rep.result.details, [phase]: { created: s!.created, updated: s!.updated, skipped: s!.skipped, failed: s!.failed } };
        for (const k of ['created', 'updated', 'skipped', 'failed'] as const) rep.count(k, s![k]);
        for (const m of s!.errors) rep.error(`${phase}: ${m}`);
      }
      for (const w of summary.warnings) rep.error(w);
      await rep.finish();
    } catch (e) { await rep.finish(e instanceof Error ? e.message : 'Migration failed'); }
  });
}

async function authed(req: FastifyRequest, reply: FastifyReply, scope: string): Promise<AuthInfo | null> {
  const auth = await authenticate(req);
  if (!auth) { reply.code(401).send({ error: 'Not authenticated' }); return null; }
  if (!allowed(auth, scope)) { reply.code(403).send({ error: `Access denied. Required access: ${scope}` }); return null; }
  return auth;
}

const publicJob = (j: NonNullable<Awaited<ReturnType<typeof getJob>>>) => ({ id: j.id, type: j.type, status: j.status, done: j.done, result: j.result, error: j.error, createdAt: j.createdAt, finishedAt: j.finishedAt });

/**
 * CSV import/export, theme zip upload/download, Shopify migration and job status:
 *   POST /admin/api/import/:kind[?dryRun=1]    (products | customers | inventory; multipart field "file") -> 202 { job }
 *   GET  /admin/api/export/:kind.csv           (products | customers | inventory | orders)
 *   POST /admin/api/themes/upload              (multipart zip; optional field "name") -> 201 { theme }
 *   GET  /admin/api/themes/:id/download.zip
 *   POST /admin/api/migrate/shopify            { shop, accessToken | clientId+clientSecret, only? } -> 202 { job }
 *   GET  /admin/api/jobs/:id
 */
export function registerDataRoutes(app: FastifyInstance) {
  registerDataJobs(app);
  const { db, config, storage, queue } = app.ctx;

  app.get('/admin/api/jobs/:id', async (req, reply) => {
    const auth = await authed(req, reply, 'read_products');
    if (!auth) return;
    const id = Number((req.params as { id: string }).id);
    const job = Number.isSafeInteger(id) ? await getJob(db, auth.shopId, id) : null;
    return job ? { job: publicJob(job) } : reply.code(404).send({ error: 'Job not found' });
  });

  app.post('/admin/api/migrate/shopify', async (req, reply) => {
    const auth = await authed(req, reply, 'write_products');
    if (!auth) return;
    const b = (req.body ?? {}) as { shop?: string; accessToken?: string; clientId?: string; clientSecret?: string; only?: string[]; apiVersion?: string };
    if (typeof b.shop !== 'string' || !b.shop.trim()) return reply.code(400).send({ error: 'shop is required' });
    if (!b.accessToken && !(b.clientId && b.clientSecret)) return reply.code(400).send({ error: 'accessToken, or clientId and clientSecret, is required' });
    const only = b.only?.length ? (b.only as Phase[]) : undefined;
    if (only?.some((p) => !PHASES.includes(p))) return reply.code(400).send({ error: `only must be a list of: ${PHASES.join(', ')}` });
    const jobId = await createJob(db, auth.shopId, 'migrate.shopify');
    // Credentials live only in the in-memory job payload, never in the database.
    queue.enqueue<MigrateJob>('migrate.shopify', { jobId, shopId: auth.shopId, shop: b.shop, auth: b.accessToken ? { token: b.accessToken } : { clientId: b.clientId!, clientSecret: b.clientSecret! }, only, apiVersion: b.apiVersion }, { maxAttempts: 1 });
    return reply.code(202).send({ job: { id: jobId } });
  });

  // --- multipart routes (scoped so the parser limits do not affect JSON routes)
  app.register(async (scope) => {
    await scope.register(multipart, { limits: { fileSize: Math.max(MAX_CSV_BYTES, MAX_THEME_ZIP_BYTES), files: 1, fields: 5 } });

    scope.post('/admin/api/import/:kind', async (req, reply) => {
      const kind = (req.params as { kind: string }).kind;
      if (!(kind in IMPORTS)) return reply.code(404).send({ error: 'Unknown import type (products, customers, inventory)' });
      const auth = await authed(req, reply, `write_${SCOPE[kind]}`);
      if (!auth) return;
      const part = await req.file({ limits: { fileSize: MAX_CSV_BYTES } });
      if (!part) return reply.code(400).send({ error: 'No file uploaded (multipart field "file")' });
      const dir = path.join(config.dataDir, 'tmp');
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, `import-${randomToken(8)}.csv`);
      await pipeline(part.file, createWriteStream(file));
      if (part.file.truncated) { await rm(file, { force: true }); return reply.code(413).send({ error: 'File too large (maximum is 200MB)' }); }
      const q = (req.query as { dryRun?: string }).dryRun;
      const dryRun = q === '1' || q === 'true';
      const jobId = await createJob(db, auth.shopId, `import.${kind}`, dryRun);
      queue.enqueue<CsvJob>('csv.import', { jobId, shopId: auth.shopId, kind: kind as ImportKind, file, dryRun }, { maxAttempts: 1 });
      return reply.code(202).send({ job: { id: jobId }, dryRun });
    });

    scope.post('/admin/api/themes/upload', async (req, reply) => {
      const auth = await authed(req, reply, 'write_themes');
      if (!auth) return;
      const part = await req.file({ limits: { fileSize: MAX_THEME_ZIP_BYTES } });
      if (!part) return reply.code(400).send({ error: 'No file uploaded (multipart field "file")' });
      const data = await part.toBuffer().catch(() => null);
      if (!data || part.file.truncated) return reply.code(413).send({ error: 'File too large (maximum is 50MB)' });
      const field = part.fields['name'] as { value?: unknown } | undefined;
      const name = typeof field?.value === 'string' && field.value.trim() ? field.value : part.filename.replace(/\.zip$/i, '');
      const r = await createThemeFromZip(db, storage, auth.shopId, data, { name, role: 'UNPUBLISHED' });
      if (!r.ok) return reply.code(422).send({ errors: r.errors });
      const t = r.value.theme;
      return reply.code(201).send({ theme: { id: t.id, name: t.name, role: t.role }, files: r.value.files, ignored: r.value.ignored });
    });
  });

  app.get('/admin/api/themes/:id/download.zip', async (req, reply) => {
    const auth = await authed(req, reply, 'read_themes');
    if (!auth) return;
    const id = Number((req.params as { id: string }).id);
    const theme = Number.isSafeInteger(id) ? await getTheme(db, auth.shopId, id) : null;
    const zip = theme ? await buildThemeZip(db, storage, auth.shopId, theme.id) : null;
    if (!theme || !zip) return reply.code(404).send({ error: 'Theme not found' });
    const safe = theme.name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'theme';
    return reply.type('application/zip').header('content-disposition', `attachment; filename="${safe}.zip"`).send(Buffer.from(zip));
  });

  const EXPORTS: Record<string, (db: Db, shopId: number, baseUrl: string) => AsyncGenerator<string>> = {
    products: (d, s, base) => exportProducts(d, s, base), customers: (d, s) => exportCustomers(d, s), inventory: (d, s) => exportInventory(d, s), orders: (d, s) => exportOrders(d, s),
  };
  app.get('/admin/api/export/:file', async (req, reply) => {
    const m = /^(products|customers|inventory|orders)\.csv$/.exec((req.params as { file: string }).file);
    if (!m) return reply.code(404).send({ error: 'Unknown export (products.csv, customers.csv, inventory.csv, orders.csv)' });
    const auth = await authed(req, reply, `read_${SCOPE[m[1]!]}`);
    if (!auth) return;
    const origin = `${req.protocol}://${req.headers.host ?? new URL(config.appUrl).host}`;
    return reply.type('text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${m[1]}.csv"`).send(Readable.from(EXPORTS[m[1]!]!(db, auth.shopId, origin)));
  });
}
