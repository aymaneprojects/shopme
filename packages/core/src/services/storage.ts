import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { randomToken } from './crypto';

/** Object storage abstraction. Local disk today; an S3 implementation can be added behind it. */
export interface Storage {
  put(key: string, data: Buffer): Promise<void>;
  open(key: string): Promise<Readable | null>;
  delete(key: string): Promise<void>;
  /** Public URL path/URL for a key. */
  url(key: string): string;
}

const SAFE_KEY = /^[A-Za-z0-9._\-\/]+$/;

export function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.split('/').some((p) => p === '..' || p === '.' || p === '') ) throw new Error(`Unsafe storage key: ${key}`);
}

export function createLocalStorage(root: string, publicBase = '/files'): Storage {
  const abs = (key: string) => {
    assertSafeKey(key);
    const p = path.join(root, key);
    if (!p.startsWith(path.resolve(root) + path.sep)) throw new Error('Path escapes storage root');
    return p;
  };
  return {
    async put(key, data) {
      const p = abs(key);
      await mkdir(path.dirname(p), { recursive: true });
      await writeFile(p, data);
    },
    async open(key) {
      const p = abs(key);
      return (await stat(p).catch(() => null)) ? createReadStream(p) : null;
    },
    async delete(key) { await rm(abs(key), { force: true }); },
    url: (key) => `${publicBase}/${key.split('/').map(encodeURIComponent).join('/')}`,
  };
}

/** Make a safe, unique storage key from a user-supplied filename: `2026/11/<random>-<name>`. */
export function makeStorageKey(filename: string, now = new Date()): string {
  const ext = path.extname(filename).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10);
  const base = path.basename(filename, path.extname(filename)).normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file';
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${now.getUTCFullYear()}/${mm}/${randomToken(6)}-${base}${ext}`;
}

/** Folder that holds the stores' own upload folders (`shops/<id>/...`) inside the storage root. */
export const SHOP_FOLDER = 'shops';

/**
 * One store's view of the storage root. With a prefix (multi-store layout) every key lives under `<prefix>/` and URLs carry it;
 * without one (single-store layout) keys stay at the root and keys inside `shops/` are refused, so no store reaches another's folder.
 */
export function scopedStorage(root: Storage, prefix: string | null): Storage {
  const full = (key: string) => {
    assertSafeKey(key);
    if (prefix) return `${prefix}/${key}`;
    if (key === SHOP_FOLDER || key.startsWith(`${SHOP_FOLDER}/`)) throw new Error(`Unsafe storage key: ${key}`);
    return key;
  };
  return {
    put: (key, data) => root.put(full(key), data),
    open: (key) => root.open(full(key)),
    delete: (key) => root.delete(full(key)),
    url: (key) => root.url(full(key)),
  };
}
