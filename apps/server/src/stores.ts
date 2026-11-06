import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {} from '@fastify/cookie'; // request.cookies / unsignCookie types
import { and, eq, isNotNull } from 'drizzle-orm';
import { handleOf, resolveAccountSession, schema as s, scopedStorage, SHOP_FOLDER, staffInShop, type AppConfig, type Db, type Storage } from '@shopme/core';

/** What the server keeps in memory about each store (multi-store host routing, file folders, links). */
export interface StoreInfo {
  id: number;
  handle: string;
  name: string;
  status: string;
  storagePrefix: string | null;
  /** Custom primary domain (other hosts of the store redirect to it). */
  primaryDomain: string | null;
  /** Hosts of the store's languages (never redirected to the primary domain). */
  localeHosts: string[];
}

/** Origin the buyer is on: APP_URL (single-store), or the request's own store host (multi-store; host routing vetted it). */
export function requestOrigin(ctx: { config: AppConfig }, req: FastifyRequest): string {
  if (!ctx.config.multiStore || !req.headers.host) return ctx.config.appUrl.replace(/\/$/, '');
  return `${new URL(ctx.config.appUrl).protocol}//${req.headers.host}`;
}

/** `Example.COM:3000` -> `example.com`. */
export const hostnameOf = (host: string | undefined) => (host ?? '').trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');

const ADMIN_STORE_RE = /^\/admin\/store\/([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?)(?=\/|$|\?)/;

/**
 * Directory of the installation's stores, kept in memory so routing (which runs before handlers, partly synchronously) can map a
 * request host to its store. Refreshed at start, after every change made through this process, and every 30 seconds (other
 * processes sharing the database).
 */
export class StoreRegistry {
  private byId = new Map<number, StoreInfo>();
  private byHost = new Map<string, number>();
  private byHandle = new Map<string, number>();
  private misses = new Map<string, number>();
  private adminHandle = new WeakMap<IncomingMessage, string>();
  private root: Storage;
  private scoped = new Map<string, Storage>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private config: AppConfig, root: Storage) { this.root = root; }

  get multi() { return this.config.multiStore; }

  async refresh(db: Db): Promise<void> {
    const rows = await db.select({ id: s.shops.id, handle: s.shops.handle, name: s.shops.name, status: s.shops.status, storagePrefix: s.shops.storagePrefix, primaryDomain: s.shops.primaryDomain }).from(s.shops);
    const domains = await db.select({ host: s.shopDomains.host, shopId: s.shopDomains.shopId }).from(s.shopDomains).where(isNotNull(s.shopDomains.verifiedAt));
    const locales = await db.select({ host: s.shopLocales.domain, shopId: s.shopLocales.shopId }).from(s.shopLocales).where(and(isNotNull(s.shopLocales.domain), eq(s.shopLocales.published, true)));
    const verified = new Map(domains.map((d) => [d.host.toLowerCase(), d.shopId]));
    const byId = new Map<number, StoreInfo>();
    const byHost = new Map<string, number>();
    const byHandle = new Map<string, number>();
    // A host serves a store when it is a verified domain of it. A store that predates multi-store mode (files at the storage root)
    // keeps the primary and language domains it had as a single store, unless another store verified them.
    const owns = (shopId: number, legacy: boolean, host: string) => verified.get(host) === shopId || (legacy && !verified.has(host));
    for (const r of rows) {
      const handle = handleOf(r);
      const legacy = r.storagePrefix == null;
      const primary = r.primaryDomain && owns(r.id, legacy, r.primaryDomain.toLowerCase()) ? r.primaryDomain.toLowerCase() : null;
      const localeHosts = locales.filter((l) => l.shopId === r.id && l.host && owns(r.id, legacy, l.host.toLowerCase())).map((l) => l.host!.toLowerCase());
      byId.set(r.id, { id: r.id, handle, name: r.name, status: r.status, storagePrefix: r.storagePrefix, primaryDomain: primary, localeHosts });
      byHandle.set(handle, r.id);
      byHost.set(this.platformHost(handle), r.id);
      if (primary) byHost.set(primary, r.id);
      for (const h of localeHosts) byHost.set(h, r.id);
    }
    for (const [host, shopId] of verified) if (byId.has(shopId)) byHost.set(host, shopId);
    for (const h of this.config.adminHosts) byHost.delete(h);
    this.byId = byId; this.byHost = byHost; this.byHandle = byHandle; this.misses.clear();
  }

  /** Keep the directory fresh when several processes share the database (multi-store mode only). */
  startAutoRefresh(db: Db, log: { warn(o: unknown, m?: string): void }): () => void {
    if (!this.multi || this.timer) return () => {};
    this.timer = setInterval(() => { this.refresh(db).catch((err) => log.warn({ err }, 'store directory refresh failed')); }, 30_000);
    this.timer.unref?.();
    return () => { if (this.timer) clearInterval(this.timer); this.timer = null; };
  }

  info(id: number): StoreInfo | undefined { return this.byId.get(id); }
  all(): StoreInfo[] { return [...this.byId.values()]; }
  idForHandle(handle: string): number | null { return this.byHandle.get(handle.toLowerCase()) ?? null; }
  isAdminHost(host: string | undefined): boolean { return this.config.adminHosts.includes(hostnameOf(host)); }
  /** Store of a host from memory only (synchronous: URL rewriting). */
  idForHostSync(host: string | undefined): number | null { return this.byHost.get(hostnameOf(host)) ?? null; }

  /** Store of a host; on a miss, looks the database up once (a store created by another process) before giving up for a while. */
  async idForHost(db: Db, host: string | undefined): Promise<number | null> {
    const h = hostnameOf(host);
    const hit = this.byHost.get(h);
    if (hit != null) return hit;
    const missed = this.misses.get(h);
    if (missed && Date.now() - missed < 5_000) return null;
    await this.refresh(db);
    const again = this.byHost.get(h);
    if (again == null) {
      if (this.misses.size > 5_000) this.misses.clear();
      this.misses.set(h, Date.now());
    }
    return again ?? null;
  }

  private scheme() { return new URL(this.config.appUrl).protocol; }
  private portSuffix() { const p = new URL(this.config.appUrl).port; return p ? `:${p}` : ''; }
  platformHost(handle: string) { return `${handle}.${this.config.storeBaseDomain}`; }

  /** Permanent origin of a store (`<scheme>//<handle>.<base>[:port]`). */
  platformOrigin(id: number): string {
    const info = this.byId.get(id);
    return `${this.scheme()}//${this.platformHost(info?.handle ?? `store-${id}`)}${this.portSuffix()}`;
  }

  /**
   * Base of the store's storefront links (the `appUrl` the services expect; they switch to the primary domain themselves).
   * Single-store mode: APP_URL, exactly as before.
   */
  storefrontBase(id: number): string { return this.multi ? this.platformOrigin(id) : this.config.appUrl; }

  /** Where buyers see the store: its primary domain, else the platform host (multi-store); APP_URL (single-store). */
  publicOrigin(id: number): string {
    if (!this.multi) return this.config.appUrl;
    const primary = this.byId.get(id)?.primaryDomain;
    return primary ? `${this.scheme()}//${primary}${this.portSuffix()}` : this.platformOrigin(id);
  }

  /** The store's uploads (its own folder in the multi-store layout, the storage root otherwise). */
  storageFor(id: number): Storage {
    const prefix = this.byId.get(id)?.storagePrefix ?? null;
    const key = prefix ?? '';
    let st = this.scoped.get(key);
    if (!st) { st = scopedStorage(this.root, prefix); this.scoped.set(key, st); }
    return st;
  }

  /**
   * Base folder of the store's backups and exports (`<dir>/backups`): DATA_DIR in single-store mode and for a store that predates
   * multi-store mode, `DATA_DIR/stores/<id>` for every other store, so no store can list or download another's archives.
   */
  dataDirFor(id: number): string {
    if (!this.multi) return this.config.dataDir;
    const info = this.byId.get(id);
    return info && info.storagePrefix == null ? this.config.dataDir : path.join(this.config.dataDir, 'stores', String(id));
  }

  /** Multi-store: `/admin/store/<handle>/rest` -> `/admin/rest`, remembering the handle for the request. */
  rewriteAdmin(req: IncomingMessage, url: string): string {
    if (!this.multi || !url.startsWith('/admin/store/')) return url;
    const m = ADMIN_STORE_RE.exec(url);
    if (!m) return url;
    this.adminHandle.set(req, m[1]!);
    const rest = url.slice(m[0].length);
    return `/admin${rest === '' || rest[0] === '?' ? `/${rest}` : rest}`;
  }

  /** Handle named by the admin URL of this request (multi-store), if any. */
  adminHandleOf(req: IncomingMessage): string | undefined { return this.adminHandle.get(req); }
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Multi-store: store of the request host (storefront, or admin on the store's own domain). */
    hostShopId?: number | null;
    /** Multi-store: a theme preview of a store served on the admin host to one of its staff members (scripts disabled). */
    staffPreview?: boolean;
  }
}

/**
 * Multi-store theme previews run on the admin host (the theme editor reads the preview's document), so no store-authored script
 * may run there: it would act with the viewer's session on every store of the account. The page renders without scripts, cannot
 * post forms and cannot frame anything.
 */
export const PREVIEW_CSP = [
  "default-src 'self' data: blob: https:", "script-src 'none'", "style-src 'self' 'unsafe-inline' https:", "img-src 'self' data: blob: https:", "font-src 'self' data: https:",
  "connect-src 'none'", "media-src 'self' https:", "object-src 'none'", "frame-src 'none'", "worker-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'self'",
].join('; ');

const PREVIEW_ASSET_RE = /^\/cdn\/shop\/t\/(\d+)\//;
/** Theme named by a preview URL: `?preview_theme_id=<id>` or a theme asset path. */
function previewThemeId(url: URL): number | null {
  const q = Number(url.searchParams.get('preview_theme_id'));
  if (Number.isSafeInteger(q) && q > 0) return q;
  const m = PREVIEW_ASSET_RE.exec(url.pathname);
  return m ? Number(m[1]) : null;
}

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const NEUTRAL = {
  notFound: { en: ['Store not found', 'There is no store at this address.'], fr: ['Boutique introuvable', 'Aucune boutique ne se trouve à cette adresse.'] },
  unavailable: { en: ['Store unavailable', 'This store is not available right now. Please come back later.'], fr: ['Boutique indisponible', 'Cette boutique n’est pas disponible pour le moment. Revenez plus tard.'] },
} as const;

/** A page that names no store and loads nothing (unknown host, suspended store). */
export function neutralPage(req: FastifyRequest, reply: FastifyReply, kind: keyof typeof NEUTRAL, status: number) {
  const lang = /^fr\b/i.test(req.headers['accept-language'] ?? '') ? 'fr' : 'en';
  const [title, text] = NEUTRAL[kind][lang];
  return reply.code(status).header('cache-control', 'no-store').header('x-robots-tag', 'noindex').type('text/html; charset=utf-8').send(
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>`
    + '<style>body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f6f7;color:#1f2124}main{max-width:28rem;padding:2rem;text-align:center}h1{font-size:1.4rem;margin:0 0 .5rem}p{color:#5c5f62;line-height:1.5;margin:0}@media (prefers-color-scheme:dark){body{background:#161718;color:#e3e3e3}p{color:#a5a7aa}}</style>'
    + `</head><body><main><h1>${esc(title)}</h1><p>${esc(text)}</p></main></body></html>`);
}

/** Paths every host answers, whatever store it belongs to. */
const PLATFORM_PATHS = ['/healthz', '/__shopme/'];
const isAdminPath = (p: string) => p === '/admin' || p.startsWith('/admin/');
const NO_PRIMARY_REDIRECT = (p: string) => isAdminPath(p) || p.startsWith('/webhooks/') || p.startsWith('/files/') || p.startsWith('/.well-known/') || p.startsWith('/checkout-assets/');

/**
 * Multi-store host routing (first hook of every request):
 *   - the platform admin host serves `/admin`, `/webhooks/*` and `/files/*`; `/` redirects to the admin; anything else is a neutral 404;
 *   - a store host (permanent `<handle>.<base>`, verified custom or language domain) serves that store; GET requests on a host other
 *     than the custom primary domain (or a language domain) redirect to the same path on the primary domain;
 *   - a suspended store answers a neutral "unavailable" page (its admin stays reachable, read-only);
 *   - an unknown host answers a neutral 404.
 */
export function installHostRouting(app: FastifyInstance) {
  const { stores, db } = app.ctx;
  if (!stores.multi) return;
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0]!;
    if (PLATFORM_PATHS.some((p) => path === p || path.startsWith(p))) return;
    const host = req.headers.host;
    if (stores.isAdminHost(host)) {
      req.hostShopId = null;
      if (isAdminPath(path) || path.startsWith('/webhooks/') || path.startsWith('/files/')) return;
      const preview = await staffPreviewShop(req);
      if (preview != null) { req.hostShopId = preview; req.staffPreview = true; return; }
      if (path === '/' && (req.method === 'GET' || req.method === 'HEAD')) return reply.redirect('/admin/', 302);
      return neutralPage(req, reply, 'notFound', 404);
    }
    const shopId = await stores.idForHost(db, host);
    if (shopId == null) return neutralPage(req, reply, 'notFound', 404);
    req.hostShopId = shopId;
    const info = stores.info(shopId)!;
    if (info.status === 'SUSPENDED' && !isAdminPath(path) && !path.startsWith('/webhooks/')) return neutralPage(req, reply, 'unavailable', 503);
    const h = hostnameOf(host);
    if (info.primaryDomain && h !== info.primaryDomain && !info.localeHosts.includes(h) && (req.method === 'GET' || req.method === 'HEAD') && !NO_PRIMARY_REDIRECT(path)) {
      return reply.redirect(`${stores.publicOrigin(shopId)}${req.url.startsWith('/') ? req.url : '/'}`, 301);
    }
  });

  // Staff previews on the admin host: no store script runs there, nothing is cached or indexed.
  app.addHook('onSend', async (req, reply) => {
    if (!req.staffPreview) return;
    reply.header('content-security-policy', PREVIEW_CSP).header('x-robots-tag', 'noindex');
    if (!req.url.startsWith('/cdn/')) reply.header('cache-control', 'private, no-store');
  });

  /**
   * Admin host, not an admin path: a theme preview when the URL (or, for the page's own subresources and calls, the same-host
   * Referer) names a theme, and the signed-in account is staff of the store that owns it.
   */
  async function staffPreviewShop(req: FastifyRequest): Promise<number | null> {
    const here = `http://${req.headers.host}`;
    let themeId = previewThemeId(new URL(req.url, here));
    const ref = req.headers.referer;
    if (themeId == null && typeof ref === 'string') {
      try { const u = new URL(ref); if (u.host === req.headers.host) themeId = previewThemeId(u); } catch { /* not a URL */ }
    }
    if (themeId == null) return null;
    const [theme] = await db.select({ shopId: s.themes.shopId }).from(s.themes).where(eq(s.themes.id, themeId)).limit(1);
    if (!theme) return null;
    const raw = req.cookies.shopme_session;
    const un = raw ? req.unsignCookie(raw) : null;
    const sess = un?.valid && un.value ? await resolveAccountSession(db, un.value) : null;
    return sess && (await staffInShop(db, sess.account.id, theme.shopId)) ? theme.shopId : null;
  }

  // Uploaded files: on a store host only that store's files; on the admin host only files of a store the session's account works in.
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/files/')) return;
    const key = decodeURIComponent(req.url.split('?')[0]!.slice('/files/'.length));
    const m = new RegExp(`^${SHOP_FOLDER}/(\\d+)/`).exec(key);
    const owner = m ? Number(m[1]) : null;
    const allowed = async (shopId: number) => (owner != null ? owner === shopId : (stores.info(shopId)?.storagePrefix ?? null) === null);
    if (req.hostShopId != null) {
      if (!(await allowed(req.hostShopId))) return reply.code(404).send({ error: 'Not found' });
      return;
    }
    // Admin host: the signed-in account must be staff of the store that owns the file.
    const raw = req.cookies.shopme_session;
    const un = raw ? req.unsignCookie(raw) : null;
    const sess = un?.valid && un.value ? await resolveAccountSession(db, un.value) : null;
    const target = owner ?? stores.all().find((x) => x.storagePrefix == null)?.id ?? null;
    if (!sess || target == null || !(await staffInShop(db, sess.account.id, target))) return reply.code(404).send({ error: 'Not found' });
  });
}

/** Caddy on-demand TLS: `GET /__shopme/tls-ask?domain=<host>` answers 200 only for hosts that serve a store or the admin. */
export function registerTlsAsk(app: FastifyInstance) {
  const { stores, db } = app.ctx;
  app.get('/__shopme/tls-ask', async (req, reply) => {
    const domain = (req.query as { domain?: string }).domain;
    if (!domain || typeof domain !== 'string') return reply.code(400).send({ error: 'domain is required' });
    if (stores.isAdminHost(domain)) return { ok: true };
    if (!stores.multi) return reply.code(404).send({ error: 'Unknown host' });
    return (await stores.idForHost(db, domain)) != null ? { ok: true } : reply.code(404).send({ error: 'Unknown host' });
  });
}
