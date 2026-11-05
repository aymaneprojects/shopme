import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { currencyExponent } from '@shopme/shopify-compat';
import type { Db } from '../../db/client';
import { saveUpload, MAX_UPLOAD_BYTES } from '../uploads';
import type { Storage } from '../storage';
import { isPrivateAddress } from '../net-guard';

/** What importers need from a job: counters, row errors and progress. `JobReporter` implements it. */
export interface Reporter {
  count(k: 'created' | 'updated' | 'skipped' | 'failed', n?: number): void;
  error(message: string, row?: number): void;
  progress(processed: number, total?: number | null, phase?: string): Promise<void>;
}

export type ImageFetcher = (url: string) => Promise<{ data: Buffer; mimeType?: string } | null>;

export interface ImportEnv {
  db: Db;
  shopId: number;
  storage: Storage;
  /** Validate and count only; nothing is written. */
  dryRun: boolean;
  /** Override how image URLs are downloaded (tests). Default: {@link fetchImageSafely}. */
  fetchImage?: ImageFetcher;
}

export type CsvRow = { line: number; row: Record<string, string> };

/** Lower-case the keys of a row so columns match case-insensitively ("Variant SKU" / "variant sku"). */
export function lowerKeys(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) out[k.toLowerCase()] = typeof v === 'string' ? v.trim() : '';
  return out;
}

export function parseBool(v: string | undefined): boolean | undefined {
  const s = v?.trim().toLowerCase();
  if (!s) return undefined;
  if (['true', 'yes', 'y', '1'].includes(s)) return true;
  if (['false', 'no', 'n', '0'].includes(s)) return false;
  return undefined;
}

export const splitTags = (v: string | undefined): string[] => (v ?? '').split(',').map((t) => t.trim()).filter(Boolean);

/** Download a URL over http(s). Refuses private/loopback addresses (SSRF), follows up to 3 redirects, `maxBytes` and 20s max. */
export async function fetchSafely(url: string, maxBytes = MAX_UPLOAD_BYTES): Promise<{ data: Buffer; mimeType?: string } | null> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(current);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const addrs = isIP(u.hostname) ? [{ address: u.hostname }] : await lookup(u.hostname, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) return null;
    const res = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { current = new URL(res.headers.get('location')!, u).toString(); continue; }
    if (!res.ok) return null;
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > maxBytes) return null;
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > maxBytes) return null;
    return { data, mimeType: res.headers.get('content-type')?.split(';')[0]?.trim() };
  }
  return null;
}

export const fetchImageSafely: ImageFetcher = (url) => fetchSafely(url);

export const urlFilename = (src: string): string => {
  try { return decodeURIComponent(path.basename(new URL(src).pathname)) || 'image'; } catch { return 'image'; }
};

/** Download `src` into storage. Returns the local `/files/...` URL, or null when it cannot be fetched or is not an image. */
export async function importImage(env: ImportEnv, src: string, alt?: string | null): Promise<string | null> {
  let got: Awaited<ReturnType<ImageFetcher>> = null;
  try { got = await (env.fetchImage ?? fetchImageSafely)(src); } catch { return null; }
  if (!got) return null;
  const filename = urlFilename(src);
  const mime = got.mimeType && got.mimeType.startsWith('image/') ? got.mimeType : /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(filename) ? undefined : null;
  if (mime === null) return null;
  return (await saveUpload(env.db, env.storage, env.shopId, { filename, data: got.data, mimeType: got.mimeType, alt: alt ?? undefined })).url;
}

/** Minor units -> fixed-decimals string ("19.90"), as in Shopify exports. */
export const decimal = (minor: number, currency: string): string => { const e = currencyExponent(currency); return (minor / 10 ** e).toFixed(e); };
