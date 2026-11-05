import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { shops } from '../db/schema';
import type { Db, Executor } from '../db/client';
import { exportStore, type ExportManifest } from './store-export';
import type { Storage } from './storage';

export interface BackupSettings { enabled: boolean; intervalHours: number; keep: number }
export const DEFAULT_BACKUP_SETTINGS: BackupSettings = { enabled: true, intervalHours: 24, keep: 7 };
export const BACKUP_EXT = '.shopme';

export const backupsDir = (dataDir: string) => path.join(dataDir, 'backups');
const stamp = (d: Date) => d.toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
/** `backup-<ts>.shopme` are automatic, `export-<id>.shopme` are on-demand downloads (kept for an hour). */
const NAME_RE = /^(backup-\d{4}-\d{2}-\d{2}T[\d-]+Z|export-[A-Za-z0-9_-]+)\.shopme$/;
export const isBackupName = (n: string) => NAME_RE.test(n);

export async function getBackupSettings(db: Executor, shopId: number): Promise<BackupSettings> {
  const [s] = await db.select({ settings: shops.settings }).from(shops).where(eq(shops.id, shopId));
  return { ...DEFAULT_BACKUP_SETTINGS, ...((s?.settings as { backup?: Partial<BackupSettings> } | undefined)?.backup ?? {}) };
}
export async function setBackupSettings(db: Executor, shopId: number, patch: Partial<BackupSettings>): Promise<BackupSettings> {
  const cur = await getBackupSettings(db, shopId);
  const next: BackupSettings = {
    enabled: patch.enabled ?? cur.enabled,
    intervalHours: Math.min(24 * 30, Math.max(1, Math.round(patch.intervalHours ?? cur.intervalHours))),
    keep: Math.min(60, Math.max(1, Math.round(patch.keep ?? cur.keep))),
  };
  const [s] = await db.select({ settings: shops.settings }).from(shops).where(eq(shops.id, shopId));
  await db.update(shops).set({ settings: { ...(s?.settings ?? {}), backup: next } }).where(eq(shops.id, shopId));
  return next;
}

export interface BackupFile { name: string; bytes: number; createdAt: Date; automatic: boolean }
export async function listBackups(dataDir: string): Promise<BackupFile[]> {
  const dir = backupsDir(dataDir);
  const names = (await readdir(dir).catch(() => [] as string[])).filter(isBackupName);
  const rows = await Promise.all(names.map(async (name) => { const st = await stat(path.join(dir, name)); return { name, bytes: st.size, createdAt: st.mtime, automatic: name.startsWith('backup-') }; }));
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** Write an export atomically (`.part` then rename) into the backups directory. */
export async function writeBackup(db: Db, storage: Storage, shopId: number, dataDir: string, name: string, appVersion: string, progress?: (d: number, t: number) => void): Promise<ExportManifest> {
  const dir = backupsDir(dataDir);
  await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `${name}.part`);
  try {
    const m = await exportStore(db, storage, shopId, tmp, { appVersion, progress });
    await rename(tmp, path.join(dir, name));
    return m;
  } catch (e) { await rm(tmp, { force: true }); throw e; }
}

/** Keep the newest `keep` automatic backups; drop on-demand exports older than an hour. */
export async function pruneBackups(dataDir: string, keep: number): Promise<number> {
  const all = await listBackups(dataDir);
  const old = [...all.filter((b) => b.automatic).slice(keep), ...all.filter((b) => !b.automatic && Date.now() - b.createdAt.getTime() > 3600_000)];
  for (const b of old) await rm(path.join(backupsDir(dataDir), b.name), { force: true });
  return old.length;
}

/** Run one automatic backup when enabled and the newest one is older than the interval. Returns the file name or null. */
export async function runScheduledBackup(db: Db, storage: Storage, shopId: number, dataDir: string, appVersion: string, now = new Date()): Promise<string | null> {
  const s = await getBackupSettings(db, shopId);
  if (!s.enabled) return null;
  const last = (await listBackups(dataDir)).find((b) => b.automatic);
  if (last && now.getTime() - last.createdAt.getTime() < s.intervalHours * 3600_000 - 60_000) return null;
  const name = `backup-${stamp(now)}${BACKUP_EXT}`;
  await writeBackup(db, storage, shopId, dataDir, name, appVersion);
  await pruneBackups(dataDir, s.keep);
  return name;
}
