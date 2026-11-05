import { createHash } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { assertSafeKey } from '@shopme/core';

/** Largest output side in pixels. Requests above it are clamped. */
export const MAX_DIMENSION = 5000;
const MAX_INPUT_PIXELS = 100_000_000;
const CACHE_LIMIT_BYTES = 1024 * 1024 * 1024;
const CROPS = ['center', 'top', 'bottom', 'left', 'right'] as const;
const FORMATS = { jpg: 'jpeg', jpeg: 'jpeg', pjpg: 'jpeg', png: 'png', webp: 'webp', avif: 'avif' } as const;
const MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' } as const;
const RASTER = /\.(png|jpe?g|webp|avif|tiff?)$/i;

export interface ResizeParams { width?: number; height?: number; crop?: (typeof CROPS)[number]; format?: keyof typeof FORMATS; padColor?: string }

/** Params honored on `/files/*` (same names as the reference `image_url` filter). `null` when the request is not a resize. */
export function parseResizeParams(q: Record<string, unknown>): ResizeParams | null {
  const one = (k: string) => (typeof q[k] === 'string' ? (q[k] as string) : undefined);
  const dim = (v: string | undefined) => { const n = v && /^\d{1,5}$/.test(v) ? Number(v) : undefined; return n ? Math.min(n, MAX_DIMENSION) : undefined; };
  const p: ResizeParams = { width: dim(one('width')), height: dim(one('height')) };
  const crop = one('crop')?.toLowerCase(); if (crop && (CROPS as readonly string[]).includes(crop)) p.crop = crop as ResizeParams['crop'];
  const format = one('format')?.toLowerCase(); if (format && format in FORMATS) p.format = format as ResizeParams['format'];
  const pad = one('pad_color')?.replace(/^#/, ''); if (pad && /^([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(pad)) p.padColor = `#${pad.toLowerCase()}`;
  if (!p.width && !p.height && !p.format) return null;
  return p;
}

type Sharp = typeof import('sharp').default;
let sharpLoad: Promise<Sharp | null> | undefined;
/** sharp ships native binaries; when it cannot load (unsupported platform, stripped bundle) resizing is off and originals are served. */
export function loadSharp(): Promise<Sharp | null> {
  sharpLoad ??= import('sharp').then((m) => m.default).catch(() => null);
  return sharpLoad;
}

const GRAVITY = { center: 'centre', top: 'north', bottom: 'south', left: 'west', right: 'east' } as const;

/** Resize/convert one image. Never enlarges. With both sides: `crop` fills the box, `pad_color` letterboxes, otherwise the image fits inside it. */
export async function transformImage(sharp: Sharp, input: Buffer, p: ResizeParams, sourceExt: string): Promise<{ data: Buffer; contentType: string; ext: string } | null> {
  const fmt = p.format ? FORMATS[p.format] : /^\.?jpe?g$/i.test(sourceExt) ? 'jpeg' : /^\.?png$/i.test(sourceExt) ? 'png' : /^\.?avif$/i.test(sourceExt) ? 'avif' : 'webp';
  let img = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'none' }).rotate();
  if (p.width || p.height) {
    const both = !!(p.width && p.height);
    img = img.resize({
      width: p.width, height: p.height, withoutEnlargement: !(both && (p.crop || p.padColor)),
      fit: both ? (p.padColor ? 'contain' : p.crop ? 'cover' : 'inside') : 'inside',
      position: GRAVITY[p.crop ?? 'center'], background: p.padColor ?? '#00000000',
    });
  }
  if (fmt === 'jpeg') img = img.flatten({ background: p.padColor ?? '#ffffff' }).jpeg({ quality: 82, progressive: p.format === 'pjpg', mozjpeg: true });
  else if (fmt === 'png') img = img.png({ compressionLevel: 9 });
  else if (fmt === 'avif') img = img.avif({ quality: 55, effort: 3 });
  else img = img.webp({ quality: 80 });
  const data = await img.toBuffer();
  return { data, contentType: MIME[fmt], ext: fmt === 'jpeg' ? 'jpg' : fmt };
}

const inflight = new Map<string, Promise<{ file: string; contentType: string } | null>>();
let active = 0;
const waiters: (() => void)[] = [];
const MAX_PARALLEL = 4;
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  while (active >= MAX_PARALLEL) await new Promise<void>((r) => waiters.push(r));
  active++;
  try { return await fn(); } finally { active--; waiters.shift()?.(); }
}

/** Delete the oldest cached variants until the cache is under its size limit. */
export async function purgeImageCache(dir: string, limit = CACHE_LIMIT_BYTES): Promise<void> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const infos = (await Promise.all(names.map(async (n) => { const s = await stat(path.join(dir, n)).catch(() => null); return s ? { n, size: s.size, t: s.mtimeMs } : null; }))).filter((x): x is NonNullable<typeof x> => !!x);
  let total = infos.reduce((a, b) => a + b.size, 0);
  for (const f of infos.sort((a, b) => a.t - b.t)) {
    if (total <= limit) break;
    await rm(path.join(dir, f.n), { force: true }); total -= f.size;
  }
}

/**
 * `GET /files/<key>?width=&height=&crop=&format=&pad_color=` on top of the static file route: resizes with sharp, caches the result
 * under DATA_DIR/cache/images and answers with immutable cache headers. Requests it cannot serve (sharp missing, SVG/GIF without a
 * format, unreadable input) fall through to the original file.
 */
export function registerImageResizing(app: FastifyInstance, scope: FastifyInstance) {
  const { storage, config, queue } = app.ctx;
  const cacheDir = path.join(config.dataDir, 'cache', 'images');
  queue.every('purge-image-cache', 60 * 60 * 1000, () => purgeImageCache(cacheDir));

  scope.addHook('onRequest', async (req, reply) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return;
    const [rawPath, qs] = req.url.split('?');
    if (!qs || !rawPath!.startsWith('/files/')) return;
    const params = parseResizeParams(req.query as Record<string, unknown>);
    if (!params) return;
    let key: string;
    try { key = decodeURIComponent(rawPath!.slice('/files/'.length)); assertSafeKey(key); } catch { return; }
    const ext = path.extname(key);
    if (!RASTER.test(ext) && !(params.format && /\.(gif|webp)$/i.test(ext))) return;
    const sharp = await loadSharp();
    if (!sharp) return;

    const norm = JSON.stringify([key, params.width, params.height, params.crop, params.format, params.padColor]);
    const id = createHash('sha1').update(norm).digest('hex');
    let job = inflight.get(id);
    if (!job) {
      job = (async () => {
        for (const e of ['jpg', 'png', 'webp', 'avif']) {
          const hit = path.join(cacheDir, `${id}.${e}`);
          if (await stat(hit).then(() => true, () => false)) return { file: hit, contentType: MIME[e === 'jpg' ? 'jpeg' : (e as 'png')] };
        }
        const stream = await storage.open(key);
        if (!stream) return null;
        const chunks: Buffer[] = [];
        for await (const c of stream) chunks.push(Buffer.from(c as Buffer));
        const out = await slot(() => transformImage(sharp, Buffer.concat(chunks), params, ext));
        if (!out) return null;
        await mkdir(cacheDir, { recursive: true });
        const file = path.join(cacheDir, `${id}.${out.ext}`);
        await writeFile(`${file}.tmp`, out.data);
        await rename(`${file}.tmp`, file);
        return { file, contentType: out.contentType };
      })().catch(() => null).finally(() => { inflight.delete(id); });
      inflight.set(id, job);
    }
    const res = await job;
    if (!res) return; // fall through to the original
    reply.header('content-type', res.contentType).header('cache-control', 'public, max-age=31536000, immutable').header('etag', `"${id}"`)
      .header('x-content-type-options', 'nosniff').header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    if (req.headers['if-none-match'] === `"${id}"`) return reply.code(304).send();
    return reply.send(await readFile(res.file));
  });
}
