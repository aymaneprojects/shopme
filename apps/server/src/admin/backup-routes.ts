import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import multipart from '@fastify/multipart';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import {
  backupsDir, createJob, getBackupSettings, getJob, importStore, isBackupName, JobReporter, listBackups, randomToken, schema, setBackupSettings, writeBackup, type ExportManifest,
} from '@shopme/core';
import { authenticate } from '../plugins/auth';
import type { AuthInfo } from '../context';

const MAX_IMPORT_BYTES = 2 * 1024 * 1024 * 1024;
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');

interface ExportJob { jobId: number; shopId: number; name: string }
interface ImportJob { jobId: number; shopId: number; file: string }

async function authed(req: FastifyRequest, reply: FastifyReply): Promise<AuthInfo | null> {
  const auth = await authenticate(req);
  if (!auth) { reply.code(401).send({ error: 'Not authenticated' }); return null; }
  if (!auth.scopes.includes('*') && !auth.scopes.includes('write_shop')) { reply.code(403).send({ error: 'Access denied. Required access: write_shop' }); return null; }
  return auth;
}

const view = (j: NonNullable<Awaited<ReturnType<typeof getJob>>>) => ({ id: j.id, type: j.type, status: j.status, done: j.done, result: j.result, error: j.error, createdAt: j.createdAt, finishedAt: j.finishedAt });

/**
 * Store export/import and backups (scope `write_shop`: the archive holds everything):
 *   POST   /admin/api/store/export                  -> 202 { job }  (job.result.details.file when done)
 *   GET    /admin/api/store/export/:jobId/download  -> the .shopme file
 *   POST   /admin/api/store/import                  multipart "file" (+ "confirm"=replace when the store is not empty) -> 202 { job }
 *   GET    /admin/api/store/backups                 -> { settings, backups }      PUT .../backups/settings
 *   POST   /admin/api/store/backups                 -> 202 { job }  (back up now)  GET|DELETE .../backups/:name
 * Jobs are polled at GET /admin/api/jobs/:id.
 */
export function registerBackupRoutes(app: FastifyInstance) {
  const { db, storage, queue, config } = app.ctx;
  const dir = backupsDir(config.dataDir);

  queue.register<ExportJob>('store.export', async (j) => {
    const rep = new JobReporter(db, j.jobId);
    try {
      const m: ExportManifest = await writeBackup(db, storage, j.shopId, config.dataDir, j.name, app.ctx.appVersion, (d, t) => void rep.progress(d, t, 'export'));
      rep.result.details = { file: j.name, bytes: (await stat(path.join(dir, j.name))).size, tables: m.tables, files: m.files };
      await rep.finish();
    } catch (e) { await rep.finish(e instanceof Error ? e.message : 'Export failed'); }
  });
  queue.register<ImportJob>('store.import', async (j) => {
    const rep = new JobReporter(db, j.jobId);
    try {
      const r = await importStore(db, storage, j.shopId, j.file, { progress: (d, t) => void rep.progress(d, t, 'import') });
      if (!r.ok) { await rep.finish(r.error); return; }
      rep.count('created', Object.values(r.value.tables).reduce((a, b) => a + b, 0));
      rep.result.details = { tables: r.value.tables, files: r.value.files, exportedWith: r.value.manifest.appVersion, exportedAt: r.value.manifest.createdAt };
      await app.ctx.locales.refresh(db);
      await rep.finish();
    } catch (e) { await rep.finish(e instanceof Error ? e.message : 'Import failed'); }
    finally { await rm(j.file, { force: true }); }
  });

  const startExport = async (auth: AuthInfo, prefix: 'export' | 'backup') => {
    const jobId = await createJob(db, auth.shopId, `store.${prefix === 'export' ? 'export' : 'backup'}`);
    const name = prefix === 'export' ? `export-${jobId}-${randomToken(4)}.shopme` : `backup-${stamp()}.shopme`;
    queue.enqueue<ExportJob>('store.export', { jobId, shopId: auth.shopId, name }, { maxAttempts: 1 });
    return jobId;
  };

  const download = async (reply: FastifyReply, name: string) => {
    if (!isBackupName(name)) return reply.code(404).send({ error: 'Not found' });
    const file = path.join(dir, name);
    const st = await stat(file).catch(() => null);
    if (!st) return reply.code(404).send({ error: 'Not found' });
    return reply.type('application/zip').header('content-length', st.size).header('content-disposition', `attachment; filename="${name.replace(/^export-\d+-[A-Za-z0-9_-]+/, 'shopme-store')}"`).header('cache-control', 'no-store').send(createReadStream(file));
  };

  app.post('/admin/api/store/export', async (req, reply) => {
    const auth = await authed(req, reply);
    if (!auth) return;
    return reply.code(202).send({ job: { id: await startExport(auth, 'export') } });
  });

  app.get('/admin/api/store/export/:jobId/download', async (req, reply) => {
    const auth = await authed(req, reply);
    if (!auth) return;
    const job = await getJob(db, auth.shopId, Number((req.params as { jobId: string }).jobId));
    const file = (job?.result as { details?: { file?: string } } | null)?.details?.file;
    if (!job || job.status !== 'COMPLETED' || !file) return reply.code(404).send({ error: 'Export not ready' });
    return download(reply, file);
  });

  app.get('/admin/api/store/backups', async (req, reply) => {
    const auth = await authed(req, reply);
    if (!auth) return;
    return { settings: await getBackupSettings(db, auth.shopId), directory: dir, backups: (await listBackups(config.dataDir)).filter((b) => b.automatic) };
  });
  app.put('/admin/api/store/backups/settings', async (req, reply) => {
    const auth = await authed(req, reply);
    if (!auth) return;
    const b = (req.body ?? {}) as { enabled?: unknown; intervalHours?: unknown; keep?: unknown };
    return { settings: await setBackupSettings(db, auth.shopId, { enabled: typeof b.enabled === 'boolean' ? b.enabled : undefined, intervalHours: Number(b.intervalHours) || undefined, keep: Number(b.keep) || undefined }) };
  });
  app.post('/admin/api/store/backups', async (req, reply) => {
    const auth = await authed(req, reply);
    if (!auth) return;
    return reply.code(202).send({ job: { id: await startExport(auth, 'backup') } });
  });
  app.get('/admin/api/store/backups/:name', async (req, reply) => {
    const auth = await authed(req, reply);
    if (!auth) return;
    return download(reply, (req.params as { name: string }).name);
  });
  app.delete('/admin/api/store/backups/:name', async (req, reply) => {
    const auth = await authed(req, reply);
    if (!auth) return;
    const name = (req.params as { name: string }).name;
    if (!isBackupName(name)) return reply.code(404).send({ error: 'Not found' });
    await rm(path.join(dir, name), { force: true });
    return { ok: true };
  });

  app.register(async (scope) => {
    await scope.register(multipart, { limits: { fileSize: MAX_IMPORT_BYTES, files: 1, fields: 4 } });
    scope.post('/admin/api/store/import', async (req, reply) => {
      const auth = await authed(req, reply);
      if (!auth) return;
      const part = await req.file();
      if (!part) return reply.code(400).send({ error: 'No file uploaded (multipart field "file")' });
      const tmp = path.join(config.dataDir, 'tmp');
      await mkdir(tmp, { recursive: true });
      const file = path.join(tmp, `import-${randomToken(8)}.shopme`);
      await pipeline(part.file, createWriteStream(file));
      if (part.file.truncated) { await rm(file, { force: true }); return reply.code(413).send({ error: 'File too large' }); }
      const confirm = (part.fields.confirm as { value?: unknown } | undefined)?.value;
      const counts = await Promise.all([schema.products, schema.orders, schema.customers].map(async (t) => (await db.select({ n: sql<number>`count(*)::int` }).from(t).where(eq(t.shopId, auth.shopId)))[0]!.n));
      if (counts.some((n) => n > 0) && confirm !== 'replace') {
        await rm(file, { force: true });
        return reply.code(409).send({ error: 'This store already has products, orders or customers. Importing replaces them: send confirm=replace to continue.', needsConfirm: true });
      }
      const jobId = await createJob(db, auth.shopId, 'store.import');
      queue.enqueue<ImportJob>('store.import', { jobId, shopId: auth.shopId, file }, { maxAttempts: 1 });
      return reply.code(202).send({ job: { id: jobId } });
    });
  });

  app.get('/admin/api/store/jobs/:id', async (req, reply) => {
    const auth = await authed(req, reply);
    if (!auth) return;
    const job = await getJob(db, auth.shopId, Number((req.params as { id: string }).id));
    return job ? { job: view(job) } : reply.code(404).send({ error: 'Job not found' });
  });
}
