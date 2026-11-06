import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createJob, JobReporter, randomToken, schema, writeBackup, type RunRow } from '@shopme/core';
import { accountOf, authenticate } from '../plugins/auth';
import type { AuthInfo } from '../context';

const input = z.object({
  enabled: z.boolean().optional(), preset: z.string().max(40).nullable().optional(), endpoint: z.string().max(300).optional(), region: z.string().max(60).optional(),
  forcePathStyle: z.boolean().optional(), bucket: z.string().max(100).optional(), prefix: z.string().max(220).optional(), accessKeyId: z.string().max(220).optional(),
  secretAccessKey: z.string().max(600).nullable().optional(), clearSecret: z.boolean().optional(), passphrase: z.string().max(300).nullable().optional(), clearPassphrase: z.boolean().optional(),
  keepDaily: z.number().int().optional(), keepWeekly: z.number().int().optional(), keepMonthly: z.number().int().optional(),
}).strict();

const runView = (r: RunRow & { subjectName: string | null }) => ({
  id: r.id, kind: r.kind, trigger: r.trigger, status: r.status, attempts: r.attempts, bytes: r.bytes, encrypted: r.encrypted, error: r.error, store: r.subjectName,
  startedAt: r.startedAt, finishedAt: r.finishedAt, nextAttemptAt: r.nextAttemptAt, object: r.objectKey ? r.objectKey.slice(r.objectKey.lastIndexOf('/') + 1) : null,
});

export interface OffsiteHelpers {
  authed(req: FastifyRequest, reply: FastifyReply): Promise<AuthInfo | null>;
  storeHasData(shopId: number): Promise<boolean>;
  runImport(j: { jobId: number; shopId: number; file: string }): Promise<void>;
}

/**
 * Off-site backups (an S3-compatible bucket), per store and for the whole installation. Nothing here ever returns a secret:
 * the access secret and the passphrase are write-only, the views only say whether they are set.
 *   GET|PUT|DELETE  /admin/api/store/backups/offsite            destination + history + banner state / save / remove
 *   POST            .../offsite/test                            write, read and delete a small object (the form's values over the saved ones)
 *   POST            .../offsite/run                             back up now and upload -> 202 { job }
 *   GET             .../offsite/alert                           { alert } for the banner
 *   GET             .../offsite/remote                          backups in the bucket, newest first
 *   GET             .../offsite/download?key=                   a backup, decrypted
 *   POST            .../offsite/restore { key, confirm }        download and import it into this store -> 202 { job }
 * The platform owner has the same under /admin/api/platform/backups/offsite (multi-store: every store and the database, daily).
 */
export function registerOffsiteRoutes(app: FastifyInstance, h: OffsiteHelpers) {
  const { db, queue, config, stores } = app.ctx;
  const off = () => app.ctx.offsite;
  const fail = (reply: FastifyReply, e: unknown, code = 502) => reply.code(code).send({ error: e instanceof Error ? e.message : 'Request failed' });

  // ---- shared handlers, parameterised by scope ----
  const handlers = (scopeOf: (auth: AuthInfo | null) => number | null, guard: (req: FastifyRequest, reply: FastifyReply) => Promise<AuthInfo | null | 'ok'>) => ({
    overview: async (req: FastifyRequest, reply: FastifyReply) => {
      const a = await guard(req, reply); if (!a) return;
      const scope = scopeOf(a === 'ok' ? null : a);
      return { destination: await off().view(scope), history: (await off().history(scope)).map(runView), alert: await off().alert(scope) };
    },
    save: async (req: FastifyRequest, reply: FastifyReply) => {
      const a = await guard(req, reply); if (!a) return;
      const body = input.safeParse(req.body ?? {});
      if (!body.success) return reply.code(400).send({ error: 'Invalid input' });
      const r = await off().update(scopeOf(a === 'ok' ? null : a), body.data);
      if ('errors' in r) return reply.code(422).send({ error: r.errors.map((e) => e.message).join(' · '), errors: r.errors });
      return { destination: r.view };
    },
    remove: async (req: FastifyRequest, reply: FastifyReply) => {
      const a = await guard(req, reply); if (!a) return;
      await off().remove(scopeOf(a === 'ok' ? null : a));
      return { ok: true };
    },
    test: async (req: FastifyRequest, reply: FastifyReply) => {
      const a = await guard(req, reply); if (!a) return;
      const body = input.safeParse(req.body ?? {});
      if (!body.success) return reply.code(400).send({ error: 'Invalid input' });
      const r = await off().test(scopeOf(a === 'ok' ? null : a), body.data);
      if ('errors' in r) return reply.code(422).send({ error: r.errors.map((e) => e.message).join(' · '), errors: r.errors });
      return r;
    },
    alert: async (req: FastifyRequest, reply: FastifyReply) => {
      const a = await guard(req, reply); if (!a) return;
      return { alert: await off().alert(scopeOf(a === 'ok' ? null : a)) };
    },
    remote: async (req: FastifyRequest, reply: FastifyReply) => {
      const a = await guard(req, reply); if (!a) return;
      try {
        const scope = scopeOf(a === 'ok' ? null : a);
        const backups = await off().list(scope);
        if (scope != null) return { backups };
        const names = new Map((await db.select({ id: schema.shops.id, name: schema.shops.name }).from(schema.shops)).map((x) => [x.id, x.name]));
        return { backups: backups.map((b) => ({ ...b, subjectName: b.subjectShopId == null ? null : names.get(b.subjectShopId) ?? null })) };
      } catch (e) { return fail(reply, e); }
    },
    download: async (req: FastifyRequest, reply: FastifyReply) => {
      const a = await guard(req, reply); if (!a) return;
      const key = String((req.query as { key?: string }).key ?? '');
      try {
        const o = await off().open(scopeOf(a === 'ok' ? null : a), key);
        reply.type('application/octet-stream').header('cache-control', 'no-store').header('content-disposition', `attachment; filename="${o.filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
        if (o.size != null) reply.header('content-length', o.size);
        return reply.send(o.stream);
      } catch (e) { return fail(reply, e, 400); }
    },
  });

  // ---- one store ----
  const store = handlers((a) => (a as AuthInfo).shopId, (req, reply) => h.authed(req, reply));
  const base = '/admin/api/store/backups/offsite';
  app.get(base, store.overview);
  app.put(base, store.save);
  app.delete(base, store.remove);
  app.post(`${base}/test`, store.test);
  app.get(`${base}/remote`, store.remote);
  app.get(`${base}/download`, store.download);
  // The banner is read by every staff member who can see the dashboard.
  app.get(`${base}/alert`, async (req, reply) => {
    const auth = await authenticate(req);
    if (!auth) return reply.code(req.authDenied ? 403 : 401).send({ error: req.authDenied ? 'You do not have access to this store' : 'Not authenticated' });
    if (!auth.scopes.includes('*') && !auth.scopes.includes('write_shop') && !auth.scopes.includes('read_shop')) return reply.code(403).send({ error: 'Access denied. Required access: read_shop' });
    return { alert: await off().alert(auth.shopId) };
  });

  queue.register<{ jobId: number; shopId: number }>('store.offsite-backup', async (j) => {
    const rep = new JobReporter(db, j.jobId);
    try {
      const name = `backup-${new Date().toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z')}.shopme`;
      await writeBackup(db, app.ctx.storageFor(j.shopId), j.shopId, stores.dataDirFor(j.shopId), name, app.ctx.appVersion, (d, t) => void rep.progress(d, t, 'export'));
      const runs = await off().afterScheduledBackup(j.shopId, name, 'manual');
      if (!runs.length) { await rep.finish('The off-site destination is off or not set up'); return; }
      const bad = runs.find((r) => r.status !== 'ok');
      await rep.finish(bad ? (bad.error ?? 'The upload failed') : undefined);
    } catch (e) { await rep.finish(e instanceof Error ? e.message : 'Backup failed'); }
  });
  app.post(`${base}/run`, async (req, reply) => {
    const auth = await h.authed(req, reply);
    if (!auth) return;
    const jobId = await createJob(db, auth.shopId, 'store.offsite-backup');
    queue.enqueue('store.offsite-backup', { jobId, shopId: auth.shopId }, { maxAttempts: 1 });
    return reply.code(202).send({ job: { id: jobId } });
  });

  queue.register<{ jobId: number; shopId: number; key: string }>('store.offsite-restore', async (j) => {
    const file = path.join(config.dataDir, 'tmp', `restore-${randomToken(8)}.shopme`);
    try { await off().fetchToFile(j.shopId, j.key, file); } catch (e) {
      await new JobReporter(db, j.jobId).finish(e instanceof Error ? e.message : 'Download failed');
      return;
    }
    await h.runImport({ jobId: j.jobId, shopId: j.shopId, file }); // reads the file, then deletes it
  });
  app.post(`${base}/restore`, async (req, reply) => {
    const auth = await h.authed(req, reply);
    if (!auth) return;
    const body = z.object({ key: z.string().min(1).max(1000), confirm: z.string().optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Choose a backup to restore' });
    if ((await h.storeHasData(auth.shopId)) && body.data.confirm !== 'replace') {
      return reply.code(409).send({ error: 'This store already has products, orders or customers. Restoring replaces them: send confirm=replace to continue.', needsConfirm: true });
    }
    // Fail now, not in the background, when the key is not one of this store's backups.
    try { const all = await off().list(auth.shopId); if (!all.some((b) => b.key === body.data.key && b.kind === 'store')) return reply.code(404).send({ error: 'Backup not found' }); } catch (e) { return fail(reply, e); }
    const jobId = await createJob(db, auth.shopId, 'store.import');
    queue.enqueue('store.offsite-restore', { jobId, shopId: auth.shopId, key: body.data.key }, { maxAttempts: 1 });
    return reply.code(202).send({ job: { id: jobId } });
  });

  // ---- the installation (multi-store: the platform owner) ----
  if (config.multiStore) {
    const guardPlatform = async (req: FastifyRequest, reply: FastifyReply): Promise<'ok' | null> => {
      const s = await accountOf(req);
      if (!s) { reply.code(401).send({ error: 'Not authenticated' }); return null; }
      if (!s.account.platformOwner) { reply.code(403).send({ error: 'Only the platform owner can do this' }); return null; }
      return 'ok';
    };
    const plat = handlers(() => null, guardPlatform);
    const pbase = '/admin/api/platform/backups/offsite';
    app.get(pbase, plat.overview);
    app.put(pbase, plat.save);
    app.delete(pbase, plat.remove);
    app.post(`${pbase}/test`, plat.test);
    app.get(`${pbase}/alert`, plat.alert);
    app.get(`${pbase}/remote`, plat.remote);
    app.get(`${pbase}/download`, plat.download);
    queue.register<{ jobId: number }>('platform.offsite-backup', async () => { await off().runPlatform('manual'); });
    app.post(`${pbase}/run`, async (req, reply) => {
      if (!(await guardPlatform(req, reply))) return;
      queue.enqueue('platform.offsite-backup', {}, { maxAttempts: 1 });
      return reply.code(202).send({ started: true });
    });
  }
}
