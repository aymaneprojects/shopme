import { resolve4, resolveCname, resolveTxt as resolveTxtDefault } from 'node:dns/promises';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  addShopDomain, availableHandle, canCreateStores, createStore, deleteStoreData, getPlatformConfig, getShop, handleOf, handleProblem, listAccountStores, listAllStores, listShopDomains, removeShopDomain,
  RESERVED_HANDLES, setPrimaryShopDomain, setSessionShop, setShopStripeKeys, setStoreStatus, shopStripeStatus, SetupError, SHOP_FOLDER, slugifyHandle, updatePlatformConfig, verificationRecord, verifyShopDomain, type Account, type TxtResolver,
} from '@shopme/core';
import { accountOf, authenticate, sessionToken } from '../plugins/auth';
import { applyStartingTheme, startingThemeExists } from './starting-theme';

let txtResolver: TxtResolver | undefined;
/** Tests: answer TXT lookups without DNS. */
export const setTxtResolver = (r: TxtResolver | undefined) => { txtResolver = r; };

/** DNS answers the domain check needs; tests replace them. */
export interface DnsLookups { cname: (name: string) => Promise<string[]>; a: (name: string) => Promise<string[]> }
let dnsLookups: DnsLookups = { cname: resolveCname, a: resolve4 };
export const setDnsLookups = (d: DnsLookups | undefined) => { dnsLookups = d ?? { cname: resolveCname, a: resolve4 }; };
const HOST_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const bare = (v: string) => v.trim().toLowerCase().replace(/\.$/, '');
const settle = async <T,>(p: Promise<T[]>): Promise<T[]> => { try { return await p; } catch { return []; } };

const createBody = z.object({
  shopName: z.string().trim().min(1).max(120),
  handle: z.string().trim().toLowerCase().max(40).optional(),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/),
  country: z.string().trim().regex(/^[A-Za-z]{2}$/),
  locale: z.string().trim().min(2).max(20).default('en'),
  timezone: z.string().trim().min(1).max(64).optional(),
  /** Handle of the bundled theme the store starts with (default: Aurora). */
  theme: z.string().trim().toLowerCase().max(40).optional(),
});
const idParam = (req: FastifyRequest) => { const n = Number((req.params as { id: string }).id); return Number.isSafeInteger(n) && n > 0 ? n : null; };

/**
 * Multi-store endpoints (404 in single-store mode):
 *   account   GET /admin/api/account/stores, GET /admin/api/account/stores/handle?name=&handle=, POST /admin/api/account/stores
 *   platform  GET /admin/api/platform/stores, POST /admin/api/platform/stores/:id/(suspend|resume), DELETE /admin/api/platform/stores/:id {confirm},
 *             GET|PUT /admin/api/platform/settings, POST /admin/api/platform/stores/:id/domains/:domainId/verify (skip the DNS check)
 *   store     GET|POST /admin/api/store/domains, POST /admin/api/store/domains/:id/verify, DELETE /admin/api/store/domains/:id, PUT /admin/api/store/domains/primary
 * Both modes: GET|PUT|DELETE /admin/api/store/payments/stripe (the store's own Stripe keys; the STRIPE_* env stays the default).
 */
export function registerStoresRoutes(app: FastifyInstance) {
  const { db, config, stores } = app.ctx;
  const multi = config.multiStore;

  async function account(req: FastifyRequest, reply: FastifyReply): Promise<Account | null> {
    if (!multi) { reply.code(404).send({ error: 'Not found' }); return null; }
    const s = await accountOf(req);
    if (!s) { reply.code(401).send({ error: 'Not authenticated' }); return null; }
    return s.account;
  }
  async function owner(req: FastifyRequest, reply: FastifyReply): Promise<Account | null> {
    const a = await account(req, reply);
    if (a && !a.platformOwner) { reply.code(403).send({ error: 'Only the platform owner can do this' }); return null; }
    return a;
  }
  /** A signed-in staff member of the request's store with the settings permission. */
  async function settingsMember(req: FastifyRequest, reply: FastifyReply, write: boolean): Promise<number | null> {
    const auth = await authenticate(req);
    if (!auth) { reply.code(req.authDenied ? 403 : 401).send({ error: req.authDenied ? 'You do not have access to this store' : 'Not authenticated' }); return null; }
    const ok = auth.scopes.includes('*') || auth.scopes.includes('write_shop') || (!write && auth.scopes.includes('read_shop'));
    if (!ok) { reply.code(403).send({ error: `Access denied. Required access: ${write ? 'write_shop' : 'read_shop'}` }); return null; }
    return auth.shopId;
  }
  const storeView = (shopId: number) => ({ host: stores.info(shopId) ? stores.platformHost(stores.info(shopId)!.handle) : null, url: stores.publicOrigin(shopId), adminPath: `/admin/store/${stores.info(shopId)?.handle ?? ''}/` });

  // ---- account ----
  app.get('/admin/api/account/stores', async (req, reply) => {
    const a = await account(req, reply);
    if (!a) return;
    const list = await listAccountStores(db, a.id, config.stripe.publishableKey);
    return { stores: list.map((x) => ({ ...x, ...storeView(x.id) })), canCreateStores: await canCreateStores(db, a) };
  });

  app.get('/admin/api/account/stores/handle', async (req, reply) => {
    const a = await account(req, reply);
    if (!a) return;
    const q = req.query as { name?: string; handle?: string };
    const handle = q.handle?.trim().toLowerCase() || (q.name?.trim() ? await availableHandle(db, q.name) : '');
    if (!handle) return { handle: '', available: false, problem: null, code: null, host: null };
    const invalid = handleProblem(handle);
    const taken = !invalid && stores.idForHandle(handle) != null;
    const problem = invalid ?? (taken ? 'This handle is already used by another store' : null);
    const code = invalid ? (RESERVED_HANDLES.has(handle) ? 'RESERVED' : 'INVALID') : taken ? 'TAKEN' : null;
    return { handle, suggested: q.name ? slugifyHandle(q.name) : null, available: !problem, problem, code, host: stores.platformHost(handle) };
  });

  app.post('/admin/api/account/stores', async (req, reply) => {
    const a = await account(req, reply);
    if (!a) return;
    if (!(await canCreateStores(db, a))) return reply.code(403).send({ error: 'Only the platform owner can create stores on this installation' });
    const body = createBody.safeParse(req.body);
    if (!body.success) return reply.code(422).send({ error: 'Invalid input', issues: body.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) });
    try {
      if (body.data.theme && !startingThemeExists(app, body.data.theme)) return reply.code(422).send({ error: 'Unknown theme', issues: [{ field: 'theme', message: 'Unknown theme' }] });
      const { theme: startingTheme, ...fields } = body.data;
      const { shop, owner: member } = await createStore(db, a, { ...fields, handle: fields.handle || undefined });
      await stores.refresh(db);
      await app.ctx.locales.refresh(db);
      await applyStartingTheme(app, shop.id, startingTheme);
      const token = sessionToken(req);
      if (token) await setSessionShop(db, token, shop.id, member.id);
      return reply.code(201).send({ store: { id: shop.id, name: shop.name, handle: handleOf(shop), ...storeView(shop.id) } });
    } catch (e) {
      if (e instanceof SetupError) return reply.code(422).send({ error: e.message, issues: [{ field: 'handle', message: e.message }] });
      throw e;
    }
  });

  // ---- platform owner ----
  app.get('/admin/api/platform/stores', async (req, reply) => {
    if (!(await owner(req, reply))) return;
    return { stores: (await listAllStores(db)).map((x) => ({ ...x, ...storeView(x.id) })), settings: await getPlatformConfig(db) };
  });

  const setStatus = (status: 'ACTIVE' | 'SUSPENDED') => async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await owner(req, reply))) return;
    const id = idParam(req);
    const shop = id ? await setStoreStatus(db, id, status) : null;
    if (!shop) return reply.code(404).send({ error: 'Store not found' });
    await stores.refresh(db);
    return { store: { id: shop.id, handle: handleOf(shop), status: shop.status } };
  };
  app.post('/admin/api/platform/stores/:id/suspend', setStatus('SUSPENDED'));
  app.post('/admin/api/platform/stores/:id/resume', setStatus('ACTIVE'));

  app.delete('/admin/api/platform/stores/:id', async (req, reply) => {
    if (!(await owner(req, reply))) return;
    const id = idParam(req);
    const shop = id ? await getShop(db, id) : null;
    if (!shop) return reply.code(404).send({ error: 'Store not found' });
    const confirm = (req.body as { confirm?: unknown } | undefined)?.confirm;
    if (confirm !== handleOf(shop)) return reply.code(422).send({ error: 'Type the store handle to confirm the deletion' });
    const storage = app.ctx.storageFor(shop.id);
    const r = await deleteStoreData(db, shop.id);
    if (!r) return reply.code(404).send({ error: 'Store not found' });
    // Files: the store's own folder, or (a store from the single-store layout) each of its keys.
    if (shop.storagePrefix && shop.storagePrefix === `${SHOP_FOLDER}/${shop.id}`) await rm(path.join(config.storageDir, SHOP_FOLDER, String(shop.id)), { recursive: true, force: true });
    else for (const k of r.keys) await storage.delete(k).catch(() => undefined);
    await stores.refresh(db);
    await app.ctx.locales.refresh(db);
    return { deletedStoreId: shop.id };
  });

  app.get('/admin/api/platform/settings', async (req, reply) => {
    if (!(await owner(req, reply))) return;
    return { settings: await getPlatformConfig(db) };
  });
  app.put('/admin/api/platform/settings', async (req, reply) => {
    if (!(await owner(req, reply))) return;
    const url = z.string().trim().max(500).optional();
    const body = z.object({ storeCreation: z.enum(['OWNER', 'EVERYONE']).optional(), helpUrl: url, termsUrl: url, privacyUrl: url }).safeParse(req.body);
    if (!body.success) return reply.code(422).send({ error: 'storeCreation must be OWNER or EVERYONE' });
    return { settings: await updatePlatformConfig(db, body.data) };
  });

  app.post('/admin/api/platform/stores/:id/domains/:domainId/verify', async (req, reply) => {
    if (!(await owner(req, reply))) return;
    const id = idParam(req);
    const domainId = Number((req.params as { domainId: string }).domainId);
    const r = id ? await verifyShopDomain(db, id, domainId, { force: true }) : null;
    if (!r?.ok) return reply.code(404).send({ error: r?.errors[0]?.message ?? 'Domain not found' });
    await stores.refresh(db);
    return { domain: r.value };
  });

  // ---- store domains ----
  const domainView = (shopId: number) => async () => {
    const info = stores.info(shopId);
    const list = await listShopDomains(db, shopId);
    const primary = info?.primaryDomain ?? null;
    return {
      platformHost: info ? stores.platformHost(info.handle) : null, primaryDomain: primary, url: stores.publicOrigin(shopId),
      domains: list.map((d) => ({ id: d.id, host: d.host, verified: !!d.verifiedAt, primary: d.host === primary, verificationRecord: verificationRecord(d.host), verificationValue: `shopme-verify=${d.verificationToken}`, createdAt: d.createdAt })),
    };
  };
  const multiOnly = (reply: FastifyReply) => { if (!multi) { reply.code(404).send({ error: 'Not found' }); return false; } return true; };

  app.get('/admin/api/store/domains', async (req, reply) => {
    if (!multiOnly(reply)) return;
    const shopId = await settingsMember(req, reply, false);
    if (shopId == null) return;
    return domainView(shopId)();
  });
  /**
   * Both modes: what DNS says about a domain compared with what it must say: the routing record (CNAME to the store's address, or an
   * A record for a bare domain) and, in multi-store mode, the TXT ownership record. Read-only; nothing is changed.
   */
  app.get('/admin/api/store/domain-dns', async (req, reply) => {
    const shopId = await settingsMember(req, reply, false);
    if (shopId == null) return;
    const host = bare(String((req.query as { host?: unknown }).host ?? ''));
    if (!HOST_RE.test(host)) return reply.code(422).send({ error: 'Enter a valid domain, such as shop.example.com' });
    const info = stores.info(shopId);
    const target = multi && info ? stores.platformHost(info.handle) : new URL(app.ctx.config.appUrl).host.replace(/:\d+$/, '');
    const records: Array<{ id: string; type: string; name: string; value: string; current: string[]; ok: boolean }> = [];
    const subdomain = host.split('.').length > 2;
    if (subdomain) {
      const current = (await settle(dnsLookups.cname(host))).map(bare);
      records.push({ id: 'routing', type: 'CNAME', name: host, value: target, current, ok: current.includes(bare(target)) });
    } else {
      const want = await settle(dnsLookups.a(target));
      const current = await settle(dnsLookups.a(host));
      records.push({ id: 'routing', type: 'A', name: host, value: want[0] ?? target, current, ok: current.length > 0 && current.some((x) => want.includes(x)) });
    }
    if (multi) {
      const row = (await listShopDomains(db, shopId)).find((d) => d.host === host);
      if (row) {
        const name = verificationRecord(host);
        const value = `shopme-verify=${row.verificationToken}`;
        let txt: string[][] = [];
        try { txt = await (txtResolver ?? resolveTxtDefault)(name); } catch { txt = []; }
        const current = txt.map((r) => r.join(''));
        records.push({ id: 'verify', type: 'TXT', name, value, current, ok: !!row.verifiedAt || current.some((x) => x.trim() === value) });
      }
    }
    return { host, target, records, propagated: records.every((r) => r.ok) };
  });

  app.post('/admin/api/store/domains', async (req, reply) => {
    if (!multiOnly(reply)) return;
    const shopId = await settingsMember(req, reply, true);
    if (shopId == null) return;
    const host = (req.body as { host?: unknown } | undefined)?.host;
    const r = await addShopDomain(db, shopId, typeof host === 'string' ? host : '', { baseDomain: config.storeBaseDomain, adminHosts: config.adminHosts });
    if (!r.ok) return reply.code(422).send({ error: r.errors[0]!.message, issues: r.errors });
    return reply.code(201).send(await domainView(shopId)());
  });
  app.post('/admin/api/store/domains/:id/verify', async (req, reply) => {
    if (!multiOnly(reply)) return;
    const shopId = await settingsMember(req, reply, true);
    if (shopId == null) return;
    const r = await verifyShopDomain(db, shopId, idParam(req) ?? 0, { resolver: txtResolver });
    if (!r.ok) return reply.code(r.errors[0]!.code === 'NOT_FOUND' ? 404 : 422).send({ error: r.errors[0]!.message, issues: r.errors });
    await stores.refresh(db);
    return domainView(shopId)();
  });
  app.delete('/admin/api/store/domains/:id', async (req, reply) => {
    if (!multiOnly(reply)) return;
    const shopId = await settingsMember(req, reply, true);
    if (shopId == null) return;
    const r = await removeShopDomain(db, shopId, idParam(req) ?? 0);
    if (!r.ok) return reply.code(404).send({ error: r.errors[0]!.message });
    await stores.refresh(db);
    await app.ctx.locales.refresh(db);
    return domainView(shopId)();
  });
  app.put('/admin/api/store/domains/primary', async (req, reply) => {
    if (!multiOnly(reply)) return;
    const shopId = await settingsMember(req, reply, true);
    if (shopId == null) return;
    const id = (req.body as { id?: unknown } | undefined)?.id;
    const r = await setPrimaryShopDomain(db, shopId, typeof id === 'number' ? id : null);
    if (!r.ok) return reply.code(r.errors[0]!.code === 'NOT_FOUND' ? 404 : 422).send({ error: r.errors[0]!.message });
    await stores.refresh(db);
    return domainView(shopId)();
  });

  // ---- home page thumbnail (multi-store: the storefront lives on the store's own host, not on the admin's) ----
  app.get('/admin/api/store/home-preview', async (req, reply) => {
    if (!multiOnly(reply)) return;
    const auth = await authenticate(req);
    if (!auth) return reply.code(req.authDenied ? 403 : 401).send({ error: req.authDenied ? 'You do not have access to this store' : 'Not authenticated' });
    const info = stores.info(auth.shopId);
    if (!info) return reply.code(404).send({ error: 'Store not found' });
    const page = await app.inject({ method: 'GET', url: '/', headers: { host: stores.platformHost(info.handle), 'accept-language': String(req.headers['accept-language'] ?? '') } });
    // Root-relative links point at the store's permanent host (the admin CSP allows its styles, images and fonts).
    const origin = stores.platformOrigin(auth.shopId);
    const html = page.statusCode === 200 ? page.body
      .replace(/(\s(?:src|href|poster)=["'])\/(?!\/)/g, `$1${origin}/`)
      .replace(/(\ssrcset=["'])([^"']*)/g, (_m, a: string, v: string) => a + v.replace(/(^|,\s*)\/(?!\/)/g, `$1${origin}/`))
      .replace(/url\((["']?)\/(?!\/)/g, `url($1${origin}/`) : '';
    return reply.type('text/html; charset=utf-8').header('cache-control', 'private, no-store').send(html);
  });

  // ---- the store's own Stripe keys (both modes) ----
  const webhookUrl = (shopId: number) => (multi ? `${config.appUrl}/webhooks/stripe/${stores.info(shopId)?.handle ?? ''}` : `${config.appUrl}/webhooks/stripe`);
  const stripeView = async (shopId: number) => ({ ...(await shopStripeStatus(db, shopId, config.sessionSecret)), webhookUrl: webhookUrl(shopId), installationDefault: !!(config.stripe.secretKey && config.stripe.publishableKey && config.stripe.webhookSecret) });
  app.get('/admin/api/store/payments/stripe', async (req, reply) => {
    const shopId = await settingsMember(req, reply, false);
    if (shopId == null) return;
    return stripeView(shopId);
  });
  app.put('/admin/api/store/payments/stripe', async (req, reply) => {
    const shopId = await settingsMember(req, reply, true);
    if (shopId == null) return;
    const b = (req.body ?? {}) as { publishableKey?: unknown; secretKey?: unknown; webhookSecret?: unknown };
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
    // Hosts the store is served from, to register for wallets (Apple Pay, Google Pay).
    const domains = [...new Set([stores.publicOrigin(shopId), multi ? stores.platformOrigin(shopId) : config.appUrl, ...(await listShopDomains(db, shopId)).filter((d) => d.verifiedAt).map((d) => `https://${d.host}`)].map((o) => new URL(o).hostname))];
    const r = await setShopStripeKeys(db, shopId, { publishableKey: str(b.publishableKey), secretKey: str(b.secretKey), webhookSecret: str(b.webhookSecret) }, config.sessionSecret, { admin: (k) => app.checkoutPayments.admin(k), webhookUrl: webhookUrl(shopId), domains });
    if (!r.ok) return reply.code(422).send({ error: r.errors[0]!.message, issues: r.errors });
    return stripeView(shopId);
  });
  app.delete('/admin/api/store/payments/stripe', async (req, reply) => {
    const shopId = await settingsMember(req, reply, true);
    if (shopId == null) return;
    await setShopStripeKeys(db, shopId, null, config.sessionSecret, { admin: (k) => app.checkoutPayments.admin(k) });
    return stripeView(shopId);
  });
}
