import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { S3Client } from '@aws-sdk/client-s3';
import type { AppConfig } from '../config';
import type { Db } from '../db/client';
import { shops } from '../db/schema';
import { recordBackupResult } from '../services/activity';
import { decryptSecret } from '../services/two-factor';
import { backupsDir } from '../services/backups';
import { exportStore } from '../services/store-export';
import type { Storage } from '../services/storage';
import { createDecryptor, createEncryptor } from './crypto';
import { applyRetention, type Retention } from './retention';
import { deleteObject, describeS3Error, getStream, listObjects, makeClient, putStream, testConnection, type ConnectionResult, type S3Target } from './s3';
import {
  backoffMs, createRun, deleteDestination, dueRuns, getDestination, getRun, MAX_ATTEMPTS, offsiteAlert, patchFromInput, pruneRuns, recentRuns, recoverStaleRuns, resolveDestination, saveDestination, updateRun, viewOf,
  type DestinationInput, type DestinationView, type FieldError, type OffsiteAlert, type OffsiteScope, type ResolvedDestination, type RunRow,
} from './store';

export interface OffsiteDeps {
  db: Db;
  config: AppConfig;
  storageFor(shopId: number): Storage;
  dataDirFor(shopId: number): string;
  appVersion: string;
  /** Only redacted, secret-free text is ever passed here. */
  log?: { warn(msg: string): void };
  now?: () => Date;
  /** Tests: a client for the target (the default builds the guarded SDK client). */
  clientFor?: (t: S3Target) => S3Client;
}

export const stamp = (d: Date) => d.toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
const NAME_RE = /^(backup|db)-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.(shopme|dump)(\.enc)?$/;
export interface ParsedName { kind: 'store' | 'database'; at: Date; encrypted: boolean }
/** Timestamp, kind and encryption of an object name we wrote; null for anything else (those are never touched). */
export function parseObjectName(name: string): ParsedName | null {
  const m = NAME_RE.exec(name);
  if (!m) return null;
  const at = new Date(`${m[2]}T${m[3]}:${m[4]}:${m[5]}Z`);
  if (Number.isNaN(at.getTime())) return null;
  if ((m[1] === 'backup') !== (m[6] === 'shopme')) return null;
  return { kind: m[1] === 'backup' ? 'store' : 'database', at, encrypted: !!m[7] };
}

export interface RemoteBackup { key: string; name: string; kind: 'store' | 'database'; createdAt: string; bytes: number; encrypted: boolean; subjectShopId: number | null }

const redact = (text: string, secrets: string[]) => secrets.filter((s) => s.length >= 4).reduce((t, s) => t.split(s).join('***'), text);

export class OffsiteBackups {
  private busy = new Set<string>();
  private dumpCheck: { at: number; ok: boolean } | null = null;
  constructor(private deps: OffsiteDeps) {}

  private get now() { return this.deps.now?.() ?? new Date(); }
  private get key() { return this.deps.config.sessionSecret; }
  private get allowPrivate() { return this.deps.config.backupAllowPrivateEndpoints; }
  private client(t: S3Target) { return this.deps.clientFor ? this.deps.clientFor(t) : makeClient(t, this.allowPrivate); }

  // ---- settings ----

  async view(scope: OffsiteScope): Promise<DestinationView> {
    const dump = scope == null ? ((await this.dumpAvailable()) ? 'yes' : 'no') : this.deps.config.multiStore ? 'not-here' : (await this.dumpAvailable()) ? 'yes' : 'no';
    return viewOf(await getDestination(this.deps.db, scope), scope, { allowPrivate: this.allowPrivate, databaseDump: dump });
  }

  async update(scope: OffsiteScope, input: DestinationInput): Promise<{ view: DestinationView } | { errors: FieldError[] }> {
    const cur = await getDestination(this.deps.db, scope);
    const r = await patchFromInput(cur, input, this.key, this.allowPrivate);
    if ('errors' in r) return r;
    await saveDestination(this.deps.db, scope, r.patch);
    return { view: await this.view(scope) };
  }

  async remove(scope: OffsiteScope): Promise<void> { await deleteDestination(this.deps.db, scope); }

  /** Test the saved settings, or the form's values over them (a blank secret keeps the saved one). Nothing is saved. */
  async test(scope: OffsiteScope, input: DestinationInput = {}): Promise<ConnectionResult | { errors: FieldError[] }> {
    const cur = await getDestination(this.deps.db, scope);
    const r = await patchFromInput(cur, input, this.key, this.allowPrivate);
    if ('errors' in r) return r;
    const p = r.patch;
    const secretEnc = p.secretKeyEnc !== undefined ? p.secretKeyEnc : cur?.secretKeyEnc ?? null;
    const secretAccessKey = secretEnc ? decryptSecret(secretEnc, this.key) ?? '' : '';
    const t: S3Target = { endpoint: p.endpoint ?? cur?.endpoint ?? '', region: p.region ?? cur?.region ?? '', forcePathStyle: p.forcePathStyle ?? cur?.forcePathStyle ?? false, bucket: p.bucket ?? cur?.bucket ?? '', accessKeyId: p.accessKeyId ?? cur?.accessKeyId ?? '', secretAccessKey };
    const secrets = [secretAccessKey, t.accessKeyId];
    const res = await testConnection(t, rootOf(scope, p.prefix ?? cur?.prefix ?? ''), this.allowPrivate, this.deps.clientFor ? { client: this.deps.clientFor(t) } : {});
    return { ...res, steps: res.steps.map((s) => (s.error ? { ...s, error: redact(s.error, secrets) } : s)), ...(res.error ? { error: redact(res.error, secrets) } : {}) };
  }

  async history(scope: OffsiteScope) { return recentRuns(this.deps.db, scope); }

  /** The banner condition for a scope (null when everything is fine or nothing is set up). */
  async alert(scope: OffsiteScope): Promise<OffsiteAlert | null> {
    const row = await getDestination(this.deps.db, scope);
    const configured = !!resolveDestination(row, this.key);
    return offsiteAlert(row, configured, await recentRuns(this.deps.db, scope, 50), this.now);
  }

  // ---- database dump ----

  private pgDump() { return this.deps.config.pgDumpPath ?? 'pg_dump'; }
  /** True when the installation uses PostgreSQL and a `pg_dump` can be run from here (checked at most every 5 minutes). */
  async dumpAvailable(): Promise<boolean> {
    if (!this.deps.config.databaseUrl) return false;
    if (this.dumpCheck && Date.now() - this.dumpCheck.at < 300_000) return this.dumpCheck.ok;
    const ok = await new Promise<boolean>((resolve) => {
      try { const p = spawn(this.pgDump(), ['--version'], { stdio: 'ignore' }); p.on('error', () => resolve(false)); p.on('close', (c) => resolve(c === 0)); } catch { resolve(false); }
    });
    this.dumpCheck = { at: Date.now(), ok };
    return ok;
  }

  /** `pg_dump` in custom format, streamed. The password goes through the environment, not the command line. */
  private dumpStream(): Readable {
    const u = new URL(this.deps.config.databaseUrl!);
    const env: NodeJS.ProcessEnv = { ...process.env, PGHOST: decodeURIComponent(u.hostname), PGPORT: u.port || '5432', PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, '')) };
    const child = spawn(this.pgDump(), ['--format=custom', '--no-owner'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = new PassThrough();
    let err = '';
    child.stderr.on('data', (c: Buffer) => { if (err.length < 2000) err += c.toString(); });
    child.stdout.pipe(out, { end: false });
    child.on('error', (e) => out.destroy(new Error(`pg_dump could not be started: ${e.message}`)));
    // The stream only ends once the process exited well: an upload never completes on a half-written dump.
    child.on('close', (code) => { if (code === 0) out.end(); else out.destroy(new Error(`pg_dump failed (exit ${code}): ${err.trim().split('\n').slice(-2).join(' ')}`)); });
    return out;
  }

  // ---- running ----

  /** The local scheduled backup `sourceName` of a store is done: send it (and, on a single-store installation, a database dump). */
  async afterScheduledBackup(shopId: number, sourceName: string, trigger: 'scheduled' | 'manual' = 'scheduled'): Promise<RunRow[]> {
    const dest = resolveDestination(await getDestination(this.deps.db, shopId), this.key);
    if (!dest || !dest.enabled) return [];
    const runs = [await this.perform({ shopId, subjectShopId: shopId, kind: 'store', trigger, sourceName }, dest)];
    if (!this.deps.config.multiStore && (await this.dumpAvailable())) runs.push(await this.perform({ shopId, subjectShopId: null, kind: 'database', trigger }, dest));
    return runs;
  }

  /** The platform destination: one archive per store plus the database dump. */
  async runPlatform(trigger: 'scheduled' | 'manual' = 'scheduled'): Promise<RunRow[]> {
    const dest = resolveDestination(await getDestination(this.deps.db, null), this.key);
    if (!dest || !dest.enabled) return [];
    const all = await this.deps.db.select({ id: shops.id }).from(shops).orderBy(shops.id);
    const runs: RunRow[] = [];
    for (const s of all) runs.push(await this.perform({ shopId: null, subjectShopId: s.id, kind: 'store', trigger }, dest));
    if (await this.dumpAvailable()) runs.push(await this.perform({ shopId: null, subjectShopId: null, kind: 'database', trigger }, dest));
    return runs;
  }

  /** Retry what is due, free interrupted runs, and start the daily platform backup when it is time. Called every minute. */
  async sweep(): Promise<void> {
    const now = this.now;
    await recoverStaleRuns(this.deps.db, now);
    for (const run of await dueRuns(this.deps.db, now)) {
      const dest = resolveDestination(await getDestination(this.deps.db, run.shopId), this.key);
      if (!dest || !dest.enabled) { await updateRun(this.deps.db, run.id, { status: 'failed', finishedAt: now, nextAttemptAt: null, error: 'The off-site destination is off or incomplete' }); continue; }
      await this.attempt(run, dest);
    }
    const plat = resolveDestination(await getDestination(this.deps.db, null), this.key);
    if (plat?.enabled) {
      const last = (await recentRuns(this.deps.db, null, 1))[0];
      if (!last || now.getTime() - last.startedAt.getTime() >= 24 * 3600_000 - 60_000) await this.runPlatform('scheduled');
    }
  }

  /** Create the run row (its object key is fixed now, so retries overwrite the same object) and make the first attempt. */
  private async perform(v: { shopId: OffsiteScope; subjectShopId: number | null; kind: 'store' | 'database'; trigger: 'scheduled' | 'manual'; sourceName?: string }, dest: ResolvedDestination): Promise<RunRow> {
    const at = this.now;
    const name = v.kind === 'database' ? `db-${stamp(at)}.dump` : (v.sourceName ?? `backup-${stamp(at)}.shopme`);
    const objectKey = `${folderOf(v.shopId, v.kind, v.subjectShopId, dest.prefix)}${name}${dest.passphrase ? '.enc' : ''}`;
    const run = await createRun(this.deps.db, { shopId: v.shopId, subjectShopId: v.subjectShopId, kind: v.kind, trigger: v.trigger, sourceName: v.sourceName ?? null, objectKey, encrypted: !!dest.passphrase });
    await this.attempt(run, dest);
    return (await getRun(this.deps.db, run.id)) ?? run;
  }

  /** One attempt of a run: build the stream, upload, apply retention. A failure schedules the next try, with backoff, up to five. */
  private async attempt(run: RunRow, dest: ResolvedDestination): Promise<void> {
    const lock = `run:${run.id}`;
    if (this.busy.has(lock)) return;
    this.busy.add(lock);
    const { db } = this.deps;
    const attempts = run.attempts + 1;
    await updateRun(db, run.id, { status: 'running', attempts, error: null });
    let tmp: string | null = null;
    const client = this.client(dest.target);
    try {
      const key = run.objectKey!;
      let source: Readable;
      if (run.kind === 'database') source = this.dumpStream();
      else {
        const subject = run.subjectShopId!;
        const kept = run.sourceName ? path.join(backupsDir(this.deps.dataDirFor(subject)), run.sourceName) : null;
        if (kept && (await stat(kept).catch(() => null))) source = createReadStream(kept);
        else {
          // No local copy (platform backups, or it was pruned): write the archive to a temporary file, then stream it.
          const dir = path.join(this.deps.dataDirFor(subject), 'tmp');
          await mkdir(dir, { recursive: true });
          tmp = path.join(dir, `offsite-${run.id}-${attempts}.shopme`);
          await exportStore(this.deps.db, this.deps.storageFor(subject), subject, tmp, { appVersion: this.deps.appVersion });
          source = createReadStream(tmp);
        }
      }
      const body = dest.passphrase ? source.pipe(await createEncryptor(dest.passphrase)) : source;
      source.on('error', (e) => body.destroy(e));
      const bytes = await putStream(client, dest.target.bucket, key, body);
      let warning: string | null = null;
      try { await this.applyRetention(client, run.shopId, dest, key); } catch (e) { warning = `Uploaded, but old backups could not be removed: ${redact(describeS3Error(e), dest.secrets)}`; }
      await updateRun(db, run.id, { status: 'ok', bytes, finishedAt: this.now, nextAttemptAt: null, error: warning });
    } catch (e) {
      const msg = redact(describeS3Error(e), dest.secrets).slice(0, 400);
      const final = attempts >= MAX_ATTEMPTS;
      await updateRun(db, run.id, { status: final ? 'failed' : 'retry', error: msg, finishedAt: this.now, nextAttemptAt: final ? null : new Date(this.now.getTime() + backoffMs(attempts)) });
      this.deps.log?.warn(`Off-site backup ${final ? 'failed' : 'will be retried'}: ${msg}`);
      if (final && run.shopId != null) await recordBackupResult(db, run.shopId, { ok: false, error: `Off-site backup: ${msg}` }).catch(() => undefined);
    } finally {
      client.destroy();
      if (tmp) await rm(tmp, { force: true });
      this.busy.delete(lock);
      await pruneRuns(db, run.shopId).catch(() => undefined);
    }
  }

  /** Apply the retention schedule to every folder under the scope's root; only objects named like our own are ever removed. */
  private async applyRetention(client: S3Client, scope: OffsiteScope, dest: ResolvedDestination, justUploaded: string): Promise<number> {
    const objects = await listObjects(client, dest.target.bucket, rootOf(scope, dest.prefix));
    const groups = new Map<string, Array<{ key: string; at: Date }>>();
    for (const o of objects) {
      const dir = o.key.slice(0, o.key.lastIndexOf('/') + 1);
      const parsed = parseObjectName(o.key.slice(dir.length));
      if (!parsed) continue;
      const g = groups.get(dir) ?? [];
      g.push({ key: o.key, at: parsed.at });
      groups.set(dir, g);
    }
    let removed = 0;
    for (const items of groups.values()) {
      for (const it of applyRetention(items, dest.retention as Retention).remove) {
        if (it.key === justUploaded) continue; // never remove what this run just wrote, even when two backups share a second
        await deleteObject(client, dest.target.bucket, it.key); removed++; }
    }
    return removed;
  }

  // ---- listing, download, restore ----

  private async withDest<T>(scope: OffsiteScope, fn: (client: S3Client, dest: ResolvedDestination) => Promise<T>): Promise<T> {
    const dest = resolveDestination(await getDestination(this.deps.db, scope), this.key);
    if (!dest) throw new Error('The off-site destination is not set up');
    const client = this.client(dest.target);
    try { return await fn(client, dest); } catch (e) { throw new Error(redact(describeS3Error(e), dest.secrets), { cause: e }); } finally { client.destroy(); }
  }

  /** The backups in the bucket for this scope, newest first. A store only ever sees its own folder. */
  async list(scope: OffsiteScope): Promise<RemoteBackup[]> {
    return this.withDest(scope, async (client, dest) => {
      const root = rootOf(scope, dest.prefix);
      const out: RemoteBackup[] = [];
      for (const o of await listObjects(client, dest.target.bucket, root)) {
        const name = o.key.slice(o.key.lastIndexOf('/') + 1);
        const p = parseObjectName(name);
        if (!p) continue;
        const sub = /\/archives\/shop-(\d+)\/[^/]+$/.exec(o.key);
        out.push({ key: o.key, name, kind: p.kind, createdAt: p.at.toISOString(), bytes: o.size, encrypted: p.encrypted, subjectShopId: sub ? Number(sub[1]) : scope });
      }
      return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  }

  private checkKey(scope: OffsiteScope, dest: ResolvedDestination, key: string): ParsedName {
    const name = key.slice(key.lastIndexOf('/') + 1);
    const p = parseObjectName(name);
    if (!p || !key.startsWith(rootOf(scope, dest.prefix)) || key.split('/').includes('..')) throw new Error('This backup does not belong to this destination');
    return p;
  }

  /** A readable stream of the backup, decrypted when it was encrypted. Close it when done. */
  async open(scope: OffsiteScope, key: string): Promise<{ stream: Readable; filename: string; kind: 'store' | 'database'; size: number | null }> {
    const dest = resolveDestination(await getDestination(this.deps.db, scope), this.key);
    if (!dest) throw new Error('The off-site destination is not set up');
    const parsed = this.checkKey(scope, dest, key);
    if (parsed.encrypted && !dest.passphrase) throw new Error('This backup is encrypted and no passphrase is saved');
    const client = this.client(dest.target);
    try {
      const { body, size } = await getStream(client, dest.target.bucket, key);
      const stream = parsed.encrypted ? body.pipe(createDecryptor(dest.passphrase!)) : body;
      body.on('error', (e) => stream.destroy(e));
      stream.on('close', () => client.destroy());
      return { stream, filename: key.slice(key.lastIndexOf('/') + 1).replace(/\.enc$/, ''), kind: parsed.kind, size: parsed.encrypted ? null : size };
    } catch (e) { client.destroy(); throw new Error(redact(describeS3Error(e), dest.secrets), { cause: e }); }
  }

  /** Download a store archive to `file` (decrypted), ready for the regular import. */
  async fetchToFile(scope: OffsiteScope, key: string, file: string): Promise<void> {
    const o = await this.open(scope, key);
    if (o.kind !== 'store') { o.stream.destroy(); throw new Error('Only store archives can be restored from here'); }
    await mkdir(path.dirname(file), { recursive: true });
    try { await pipeline(o.stream, createWriteStream(file)); } catch (e) { await rm(file, { force: true }); throw e; }
  }

  async run(id: number) { return getRun(this.deps.db, id); }
}

// ---- object layout -------------------------------------------------------------------------------------------------------------
// store:     <prefix>shop-<id>/archives/backup-<ts>.shopme[.enc]      <prefix>shop-<id>/database/db-<ts>.dump[.enc]
// platform:  <prefix>platform/archives/shop-<id>/backup-<ts>...       <prefix>platform/database/db-<ts>...

export const rootOf = (scope: OffsiteScope, prefix: string) => (scope == null ? `${prefix}platform/` : `${prefix}shop-${scope}/`);
export function folderOf(scope: OffsiteScope, kind: 'store' | 'database', subject: number | null, prefix: string): string {
  const root = rootOf(scope, prefix);
  if (kind === 'database') return `${root}database/`;
  return scope == null ? `${root}archives/shop-${subject}/` : `${root}archives/`;
}
