import { and, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { backupDestinations, backupRuns, shops } from '../db/schema';
import { decryptSecret, encryptSecret } from '../services/two-factor';
import { clampRetention, type Retention } from './retention';
import { presetById, STORAGE_PRESETS, type StoragePreset } from './presets';
import { EndpointError, validateEndpoint, type S3Target } from './s3';

/** Scope of a destination: a store id, or null for the installation's own (platform) destination. */
export type OffsiteScope = number | null;
const scopeIs = <T extends { shopId: Parameters<typeof eq>[0] }>(t: T, scope: OffsiteScope) => (scope == null ? isNull(t.shopId) : eq(t.shopId, scope));

export type DestinationRow = typeof backupDestinations.$inferSelect;
export type RunRow = typeof backupRuns.$inferSelect;

export async function getDestination(db: Executor, scope: OffsiteScope): Promise<DestinationRow | null> {
  const [r] = await db.select().from(backupDestinations).where(scopeIs(backupDestinations, scope)).limit(1);
  return r ?? null;
}

export type DestinationPatch = Partial<Omit<typeof backupDestinations.$inferInsert, 'id' | 'shopId' | 'createdAt' | 'updatedAt'>>;
export async function saveDestination(db: Executor, scope: OffsiteScope, patch: DestinationPatch): Promise<DestinationRow> {
  const cur = await getDestination(db, scope);
  if (cur) {
    const [r] = await db.update(backupDestinations).set({ ...patch, updatedAt: new Date() }).where(eq(backupDestinations.id, cur.id)).returning();
    return r!;
  }
  const [r] = await db.insert(backupDestinations).values({ shopId: scope, ...patch }).returning();
  return r!;
}

export const deleteDestination = (db: Executor, scope: OffsiteScope) => db.delete(backupDestinations).where(scopeIs(backupDestinations, scope));

/** Everything needed to talk to the bucket, or null when the destination is not fully set up. The secret is decrypted here, in memory only. */
export interface ResolvedDestination { target: S3Target; prefix: string; passphrase: string | null; retention: Retention; enabled: boolean; secrets: string[] }
export function resolveDestination(row: DestinationRow | null, key: string): ResolvedDestination | null {
  if (!row || !row.endpoint || !row.bucket || !row.accessKeyId || !row.secretKeyEnc) return null;
  const secretAccessKey = decryptSecret(row.secretKeyEnc, key);
  if (!secretAccessKey) return null;
  const passphrase = row.passphraseEnc ? decryptSecret(row.passphraseEnc, key) : null;
  return {
    target: { endpoint: row.endpoint, region: row.region, forcePathStyle: row.forcePathStyle, bucket: row.bucket, accessKeyId: row.accessKeyId, secretAccessKey },
    prefix: row.prefix, passphrase, retention: { keepDaily: row.keepDaily, keepWeekly: row.keepWeekly, keepMonthly: row.keepMonthly }, enabled: row.enabled,
    secrets: [secretAccessKey, row.accessKeyId, ...(passphrase ? [passphrase] : [])],
  };
}

// ---- the settings form ----------------------------------------------------------------------------------------------------------

export interface DestinationInput {
  enabled?: boolean; preset?: string | null; endpoint?: string; region?: string; forcePathStyle?: boolean; bucket?: string; prefix?: string; accessKeyId?: string;
  /** Write-only: blank keeps the saved secret. */
  secretAccessKey?: string | null; clearSecret?: boolean;
  /** Write-only: blank keeps the saved passphrase. */
  passphrase?: string | null; clearPassphrase?: boolean;
  keepDaily?: number; keepWeekly?: number; keepMonthly?: number;
}
export interface FieldError { field: string; message: string }

/** What the API returns: the settings and whether the secrets are set, never the secrets. */
export interface DestinationView {
  scope: 'store' | 'platform';
  configured: boolean; enabled: boolean;
  preset: string | null; endpoint: string; region: string; forcePathStyle: boolean; bucket: string; prefix: string; accessKeyId: string;
  secretSet: boolean; passphraseSet: boolean;
  keepDaily: number; keepWeekly: number; keepMonthly: number;
  presets: readonly StoragePreset[];
  allowPrivateEndpoints: boolean;
  /** A database dump is made after each backup (single-store installations with a reachable `pg_dump`, or the platform destination). */
  databaseDump: 'yes' | 'no' | 'not-here';
}

const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const PREFIX_RE = /^[A-Za-z0-9._\-/ ]*$/;
/** `a/b/` or ''. Slashes are trimmed and doubled, so the prefix is always a clean folder path. */
export function normalizePrefix(raw: string): string {
  const parts = raw.split('/').map((p) => p.trim()).filter(Boolean);
  return parts.length ? `${parts.join('/')}/` : '';
}

export function viewOf(row: DestinationRow | null, scope: OffsiteScope, extra: { allowPrivate: boolean; databaseDump: DestinationView['databaseDump'] }): DestinationView {
  const p = row ?? undefined;
  return {
    scope: scope == null ? 'platform' : 'store',
    configured: !!(p && p.endpoint && p.bucket && p.accessKeyId && p.secretKeyEnc), enabled: p?.enabled ?? true,
    preset: p?.preset ?? null, endpoint: p?.endpoint ?? '', region: p?.region ?? '', forcePathStyle: p?.forcePathStyle ?? false,
    bucket: p?.bucket ?? '', prefix: (p?.prefix ?? '').replace(/\/$/, ''), accessKeyId: p?.accessKeyId ?? '',
    secretSet: !!p?.secretKeyEnc, passphraseSet: !!p?.passphraseEnc,
    keepDaily: p?.keepDaily ?? 7, keepWeekly: p?.keepWeekly ?? 4, keepMonthly: p?.keepMonthly ?? 6,
    presets: STORAGE_PRESETS, allowPrivateEndpoints: extra.allowPrivate, databaseDump: extra.databaseDump,
  };
}

/** Validate a form and turn it into a row patch. Secrets are encrypted with `key`. */
export async function patchFromInput(cur: DestinationRow | null, input: DestinationInput, key: string, allowPrivate: boolean, reservedRoots: string[] = []): Promise<{ patch: DestinationPatch } | { errors: FieldError[] }> {
  const errors: FieldError[] = [];
  const patch: DestinationPatch = {};
  if (input.enabled !== undefined) patch.enabled = !!input.enabled;
  if (input.preset !== undefined) {
    if (input.preset && !presetById(input.preset)) errors.push({ field: 'preset', message: 'Choose one of the listed providers' });
    else patch.preset = input.preset || null;
  }
  if (input.endpoint !== undefined) {
    const e = input.endpoint.trim();
    if (e) {
      try { await validateEndpoint(e, allowPrivate); patch.endpoint = e.replace(/\/+$/, ''); } catch (err) { errors.push({ field: 'endpoint', message: (err as EndpointError).message }); }
    } else patch.endpoint = '';
  }
  if (input.region !== undefined) {
    const r = input.region.trim();
    if (r && !/^[A-Za-z0-9._-]{1,40}$/.test(r)) errors.push({ field: 'region', message: 'The region may contain letters, digits, dots and dashes only' });
    else patch.region = r;
  }
  if (input.forcePathStyle !== undefined) patch.forcePathStyle = !!input.forcePathStyle;
  if (input.bucket !== undefined) {
    const b = input.bucket.trim();
    if (b && !BUCKET_RE.test(b)) errors.push({ field: 'bucket', message: 'A bucket name is 3 to 63 lower-case letters, digits, dots or dashes' });
    else patch.bucket = b;
  }
  if (input.prefix !== undefined) {
    const p = input.prefix.trim();
    if (!PREFIX_RE.test(p) || p.split('/').some((s) => s.trim() === '..' || s.trim() === '.') || p.length > 200) errors.push({ field: 'prefix', message: 'The folder may contain letters, digits, spaces, dots, dashes, underscores and slashes only' });
    else {
      const norm = normalizePrefix(p);
      // A store may not write into the platform's own folder (`<prefix>platform/`): its archives would show up as the platform's.
      if (reservedRoots.some((root) => norm.startsWith(root))) errors.push({ field: 'prefix', message: 'This folder is reserved for the platform backups. Choose another one.' });
      else patch.prefix = norm;
    }
  }
  if (input.accessKeyId !== undefined) {
    const k = input.accessKeyId.trim();
    if (k.length > 200 || /\s/.test(k)) errors.push({ field: 'accessKeyId', message: 'The access key must not contain spaces' });
    else patch.accessKeyId = k;
  }
  if (input.clearSecret) patch.secretKeyEnc = null;
  else if (input.secretAccessKey) {
    if (input.secretAccessKey.length > 500 || /\s/.test(input.secretAccessKey)) errors.push({ field: 'secretAccessKey', message: 'The secret must not contain spaces' });
    else patch.secretKeyEnc = encryptSecret(input.secretAccessKey, key);
  }
  if (input.clearPassphrase) patch.passphraseEnc = null;
  else if (input.passphrase) {
    if (input.passphrase.length < 8) errors.push({ field: 'passphrase', message: 'Use at least 8 characters for the passphrase' });
    else if (input.passphrase.length > 200) errors.push({ field: 'passphrase', message: 'The passphrase is too long' });
    else patch.passphraseEnc = encryptSecret(input.passphrase, key);
  }
  if (input.keepDaily !== undefined || input.keepWeekly !== undefined || input.keepMonthly !== undefined) {
    const r = clampRetention({ keepDaily: input.keepDaily ?? cur?.keepDaily, keepWeekly: input.keepWeekly ?? cur?.keepWeekly, keepMonthly: input.keepMonthly ?? cur?.keepMonthly });
    patch.keepDaily = r.keepDaily; patch.keepWeekly = r.keepWeekly; patch.keepMonthly = r.keepMonthly;
  }
  return errors.length ? { errors } : { patch };
}

// ---- runs and health -----------------------------------------------------------------------------------------------------------

export const MAX_ATTEMPTS = 5;
/** Delay before the next try, by number of attempts made so far: 5 min, 15 min, 1 h, 4 h. */
export const BACKOFF_MS = [5 * 60_000, 15 * 60_000, 3600_000, 4 * 3600_000];
export const backoffMs = (attempts: number) => BACKOFF_MS[Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1]!;
const KEEP_RUNS = 100;
/** The banner shows when the newest good off-site backup is older than this. */
export const STALE_MS = 48 * 3600_000;

export async function createRun(db: Executor, v: { shopId: OffsiteScope; subjectShopId: number | null; kind: 'store' | 'database'; trigger: 'scheduled' | 'manual'; sourceName?: string | null; objectKey?: string | null; encrypted?: boolean }): Promise<RunRow> {
  const [r] = await db.insert(backupRuns).values({ shopId: v.shopId, subjectShopId: v.subjectShopId, kind: v.kind, trigger: v.trigger, sourceName: v.sourceName ?? null, objectKey: v.objectKey ?? null, encrypted: v.encrypted ?? false }).returning();
  return r!;
}
export async function updateRun(db: Executor, id: number, patch: Partial<Omit<typeof backupRuns.$inferInsert, 'id'>>): Promise<void> {
  await db.update(backupRuns).set(patch).where(eq(backupRuns.id, id));
}
export async function getRun(db: Executor, id: number): Promise<RunRow | null> {
  const [r] = await db.select().from(backupRuns).where(eq(backupRuns.id, id));
  return r ?? null;
}
export async function recentRuns(db: Executor, scope: OffsiteScope, limit = 30): Promise<Array<RunRow & { subjectName: string | null }>> {
  const rows = await db.select({ run: backupRuns, subjectName: shops.name }).from(backupRuns).leftJoin(shops, eq(shops.id, backupRuns.subjectShopId)).where(scopeIs(backupRuns, scope)).orderBy(desc(backupRuns.id)).limit(limit);
  return rows.map((r) => ({ ...r.run, subjectName: r.subjectName }));
}
export async function pruneRuns(db: Executor, scope: OffsiteScope): Promise<void> {
  const keep = await db.select({ id: backupRuns.id }).from(backupRuns).where(scopeIs(backupRuns, scope)).orderBy(desc(backupRuns.id)).limit(KEEP_RUNS);
  if (keep.length < KEEP_RUNS) return;
  const min = keep[keep.length - 1]!.id;
  await db.delete(backupRuns).where(and(scopeIs(backupRuns, scope), sql`${backupRuns.id} < ${min}`));
}
/** Runs waiting for their next attempt. */
export async function dueRuns(db: Executor, now: Date): Promise<RunRow[]> {
  return db.select().from(backupRuns).where(and(eq(backupRuns.status, 'retry'), lte(backupRuns.nextAttemptAt, now))).orderBy(backupRuns.id).limit(20);
}
/** Rows still marked running long after they started: the process stopped in the middle. They go back to the retry queue. */
export async function recoverStaleRuns(db: Executor, now: Date, olderThanMs = 3 * 3600_000): Promise<number> {
  const stale = await db.select({ id: backupRuns.id }).from(backupRuns).where(and(eq(backupRuns.status, 'running'), lte(backupRuns.startedAt, new Date(now.getTime() - olderThanMs))));
  if (stale.length) await db.update(backupRuns).set({ status: 'retry', nextAttemptAt: now, error: 'Interrupted: the server stopped during the upload' }).where(inArray(backupRuns.id, stale.map((s) => s.id)));
  return stale.length;
}

export type OffsiteAlert =
  | { kind: 'failed'; error: string; at: string; retrying: boolean }
  | { kind: 'stale'; lastOkAt: string | null };

/**
 * The banner condition. The destination must be set up and on. It fires when some upload failed (or is waiting to be retried) and
 * has not been followed by a good one of the same kind for the same store, or when the newest good upload is more than 48 hours old
 * (for a destination older than that).
 */
export function offsiteAlert(dest: Pick<DestinationRow, 'enabled' | 'createdAt' | 'updatedAt'> | null, configured: boolean, runs: RunRow[], now: Date): OffsiteAlert | null {
  if (!dest || !dest.enabled || !configured) return null;
  const newest = [...runs].sort((a, b) => b.id - a.id);
  const slot = (r: RunRow) => `${r.kind}:${r.subjectShopId ?? ''}`;
  const okSlots = new Map<string, number>();
  for (const r of newest) if (r.status === 'ok' && !okSlots.has(slot(r))) okSlots.set(slot(r), r.id);
  const bad = newest.find((r) => (r.status === 'failed' || r.status === 'retry') && r.id > (okSlots.get(slot(r)) ?? 0));
  if (bad) return { kind: 'failed', error: bad.error ?? '', at: (bad.finishedAt ?? bad.startedAt).toISOString(), retrying: bad.status === 'retry' };
  const lastOk = newest.find((r) => r.status === 'ok');
  const lastOkAt = lastOk ? (lastOk.finishedAt ?? lastOk.startedAt) : null;
  const since = lastOkAt ?? dest.updatedAt;
  if (now.getTime() - since.getTime() > STALE_MS) return { kind: 'stale', lastOkAt: lastOkAt?.toISOString() ?? null };
  return null;
}
