import { randomBytes } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import { and, asc, count, eq, getTableColumns, getTableName, inArray, is, isNotNull, sql } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../db/schema';
import { platformAccounts, platformSettings, sessions, shopDomains, shopLocales, shops, shopSecrets, staffUsers } from '../db/schema';
import type { Db, Executor } from '../db/client';
import type { StripeAdmin } from '@shopme/payments';
import { errR, okR, type Result } from './catalog/common';
import { decryptSecret, encryptSecret } from './two-factor';
import { handleOf, type Shop } from './shops';

// ---- account stores --------------------------------------------------------------------------------------------------------

export interface AccountStore { id: number; name: string; handle: string; status: string; role: string; primaryDomain: string | null; currency: string; testMode: boolean }

/** "Test" badge: the store takes no live payments (its own Stripe keys, else the installation's, are test keys or missing). */
export const isTestMode = (ownPublishableKey: string | null | undefined, envPublishableKey: string | undefined) => {
  const k = ownPublishableKey || envPublishableKey;
  return !k || !k.startsWith('pk_live_');
};

/** Stores where the account is an active staff member, oldest first. */
export async function listAccountStores(db: Executor, accountId: number, envPublishableKey?: string): Promise<AccountStore[]> {
  const rows = await db.select({ shop: shops, role: staffUsers.role, pk: shopSecrets.stripePublishableKey }).from(staffUsers)
    .innerJoin(shops, eq(shops.id, staffUsers.shopId)).leftJoin(shopSecrets, eq(shopSecrets.shopId, shops.id))
    .where(and(eq(staffUsers.accountId, accountId), eq(staffUsers.active, true))).orderBy(asc(shops.id));
  return rows.map((r) => ({ id: r.shop.id, name: r.shop.name, handle: handleOf(r.shop), status: r.shop.status, role: r.role, primaryDomain: r.shop.primaryDomain, currency: r.shop.currency, testMode: isTestMode(r.pk, envPublishableKey) }));
}

export interface PlatformStore { id: number; name: string; handle: string; status: string; ownerEmail: string | null; primaryDomain: string | null; createdAt: Date; staffCount: number }

/** Every store of the installation (platform owner). */
export async function listAllStores(db: Executor): Promise<PlatformStore[]> {
  const rows = await db.select({
    shop: shops,
    // Qualified on purpose: an unqualified "id" inside the subquery would be the staff row's own id.
    ownerEmail: sql<string | null>`(select su.email from staff_users su where su.shop_id = "shops"."id" and su.role = 'owner' order by su.id limit 1)`,
    staffCount: sql<number>`(select count(*)::int from staff_users su where su.shop_id = "shops"."id" and su.active)`,
  }).from(shops).orderBy(asc(shops.id));
  return rows.map((r) => ({ id: r.shop.id, name: r.shop.name, handle: handleOf(r.shop), status: r.shop.status, ownerEmail: r.ownerEmail, primaryDomain: r.shop.primaryDomain, createdAt: r.shop.createdAt, staffCount: r.staffCount }));
}

export async function getShopByHandle(db: Executor, handle: string): Promise<Shop | null> {
  const [s] = await db.select().from(shops).where(eq(shops.handle, handle.toLowerCase())).limit(1);
  return s ?? null;
}

export const accountCount = async (db: Executor) => (await db.select({ n: count() }).from(platformAccounts))[0]?.n ?? 0;

// ---- platform settings ------------------------------------------------------------------------------------------------------

export interface PlatformConfig {
  /** Who may create stores: only the platform owner, or every signed-in account. */ storeCreation: 'OWNER' | 'EVERYONE';
  /** Footer links of the sign-in screens (https URLs). Unset: the ShopMe docs for help, no terms or privacy link. */
  helpUrl?: string; termsUrl?: string; privacyUrl?: string;
}
const DEFAULT_PLATFORM: PlatformConfig = { storeCreation: 'OWNER' };

export async function getPlatformConfig(db: Executor): Promise<PlatformConfig> {
  const [r] = await db.select().from(platformSettings).where(eq(platformSettings.key, 'config'));
  return { ...DEFAULT_PLATFORM, ...((r?.value as Partial<PlatformConfig> | undefined) ?? {}) };
}

export async function updatePlatformConfig(db: Executor, input: Partial<PlatformConfig>): Promise<PlatformConfig> {
  const next = { ...(await getPlatformConfig(db)), ...input };
  if (next.storeCreation !== 'OWNER' && next.storeCreation !== 'EVERYONE') next.storeCreation = 'OWNER';
  for (const k of ['helpUrl', 'termsUrl', 'privacyUrl'] as const) if (next[k] != null && !/^https?:\/\/\S+$/i.test(next[k]!)) delete next[k];
  await db.insert(platformSettings).values({ key: 'config', value: next }).onConflictDoUpdate({ target: platformSettings.key, set: { value: next, updatedAt: new Date() } });
  return next;
}

export const canCreateStores = async (db: Executor, account: { platformOwner: boolean }) => account.platformOwner || (await getPlatformConfig(db)).storeCreation === 'EVERYONE';

// ---- domains ----------------------------------------------------------------------------------------------------------------

export type ShopDomain = typeof shopDomains.$inferSelect;
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Lower-cased host without scheme, port, path or trailing dot; null when it is not a host name. */
export function normalizeHost(input: string): string | null {
  const h = input.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');
  return HOST_RE.test(h) ? h : null;
}

/** TXT record name that proves control of `host`. */
export const verificationRecord = (host: string) => `_shopme-verify.${host}`;

export async function listShopDomains(db: Executor, shopId: number): Promise<ShopDomain[]> {
  return db.select().from(shopDomains).where(eq(shopDomains.shopId, shopId)).orderBy(asc(shopDomains.id));
}

/** Add a custom domain (unverified). Hosts under the platform base domain, the admin host, and hosts of other stores are refused. */
export async function addShopDomain(db: Executor, shopId: number, input: string, reserved: { baseDomain: string; adminHosts: string[] }): Promise<Result<ShopDomain>> {
  const host = normalizeHost(input);
  if (!host) return errR(['host'], 'Enter a domain such as shop.example.com', 'INVALID');
  const base = reserved.baseDomain.toLowerCase();
  if (host === base || host.endsWith(`.${base}`) || reserved.adminHosts.includes(host)) return errR(['host'], 'This domain belongs to the platform', 'RESERVED');
  const [taken] = await db.select({ shopId: shopDomains.shopId }).from(shopDomains).where(eq(shopDomains.host, host));
  if (taken) return errR(['host'], taken.shopId === shopId ? 'This domain is already added' : 'This domain is used by another store', 'TAKEN');
  const [row] = await db.insert(shopDomains).values({ shopId, host, verificationToken: randomBytes(16).toString('hex') }).returning();
  return okR(row!);
}

/**
 * Setup of a server installed for one domain: the first store's storefront is served on the install domain itself, so the domain is
 * recorded as its verified primary domain (it needs no TXT check: the installer proved control of it).
 */
export async function recordInstallDomain(db: Executor, shopId: number, host: string): Promise<void> {
  const h = host.toLowerCase();
  await db.insert(shopDomains).values({ shopId, host: h, verificationToken: randomBytes(16).toString('hex'), verifiedAt: new Date() }).onConflictDoNothing();
  await db.update(shops).set({ primaryDomain: h }).where(eq(shops.id, shopId));
}

export type TxtResolver = (name: string) => Promise<string[][]>;

/** Check the TXT record and mark the domain verified. `force` (platform owner) skips the DNS check. */
export async function verifyShopDomain(db: Executor, shopId: number, id: number, opts: { resolver?: TxtResolver; force?: boolean } = {}): Promise<Result<ShopDomain>> {
  const [d] = await db.select().from(shopDomains).where(and(eq(shopDomains.shopId, shopId), eq(shopDomains.id, id)));
  if (!d) return errR(['id'], 'Domain not found', 'NOT_FOUND');
  if (d.verifiedAt) return okR(d);
  if (!opts.force) {
    let records: string[][] = [];
    try { records = await (opts.resolver ?? resolveTxt)(verificationRecord(d.host)); } catch { records = []; }
    const expected = `shopme-verify=${d.verificationToken}`;
    if (!records.some((r) => r.join('').trim() === expected)) return errR(['id'], `The TXT record ${verificationRecord(d.host)} = ${expected} was not found yet`, 'NOT_VERIFIED');
  }
  const [row] = await db.update(shopDomains).set({ verifiedAt: new Date() }).where(eq(shopDomains.id, d.id)).returning();
  return okR(row!);
}

/** Remove a domain; it stops being the primary or a language domain of the store. */
export async function removeShopDomain(db: Executor, shopId: number, id: number): Promise<Result<number>> {
  const [d] = await db.delete(shopDomains).where(and(eq(shopDomains.shopId, shopId), eq(shopDomains.id, id))).returning();
  if (!d) return errR(['id'], 'Domain not found', 'NOT_FOUND');
  await db.update(shops).set({ primaryDomain: null }).where(and(eq(shops.id, shopId), eq(shops.primaryDomain, d.host)));
  await db.update(shopLocales).set({ domain: null }).where(and(eq(shopLocales.shopId, shopId), eq(shopLocales.domain, d.host)));
  return okR(d.id);
}

/** Make a verified domain the primary one (null: the platform host); other hosts of the store redirect to it. */
export async function setPrimaryShopDomain(db: Executor, shopId: number, id: number | null): Promise<Result<string | null>> {
  if (id == null) { await db.update(shops).set({ primaryDomain: null }).where(eq(shops.id, shopId)); return okR(null); }
  const [d] = await db.select().from(shopDomains).where(and(eq(shopDomains.shopId, shopId), eq(shopDomains.id, id)));
  if (!d) return errR(['id'], 'Domain not found', 'NOT_FOUND');
  if (!d.verifiedAt) return errR(['id'], 'Verify the domain before making it primary', 'NOT_VERIFIED');
  await db.update(shops).set({ primaryDomain: d.host }).where(eq(shops.id, shopId));
  return okR(d.host);
}

/** True when `host` is a verified domain of the store. */
export async function isVerifiedShopDomain(db: Executor, shopId: number, host: string): Promise<boolean> {
  return (await db.select({ id: shopDomains.id }).from(shopDomains).where(and(eq(shopDomains.shopId, shopId), eq(shopDomains.host, host.toLowerCase()), isNotNull(shopDomains.verifiedAt)))).length > 0;
}

/** Every host that serves a store: verified custom domains and language domains, keyed by host. */
export async function storeHosts(db: Executor): Promise<{ host: string; shopId: number }[]> {
  const domains = await db.select({ host: shopDomains.host, shopId: shopDomains.shopId }).from(shopDomains).where(isNotNull(shopDomains.verifiedAt));
  return domains;
}

// ---- per-store payment credentials ------------------------------------------------------------------------------------------

export interface StripeKeys { publishableKey?: string; secretKey?: string; webhookSecret?: string }
export interface StripeStatus { configured: boolean; publishableKey: string | null; secretKeyLast4: string | null; webhookSecretSet: boolean; testMode: boolean; /** The webhook endpoint was created in Stripe by ShopMe. */ webhookAutoCreated: boolean }

/** The store's own Stripe keys (decrypted), or null when it uses the installation default. */
export async function getShopStripeKeys(db: Executor, shopId: number, key: string): Promise<StripeKeys | null> {
  const [r] = await db.select().from(shopSecrets).where(eq(shopSecrets.shopId, shopId));
  if (!r?.stripeSecretKey || !r.stripePublishableKey || !r.stripeWebhookSecret) return null;
  const secretKey = decryptSecret(r.stripeSecretKey, key);
  const webhookSecret = decryptSecret(r.stripeWebhookSecret, key);
  return secretKey && webhookSecret ? { publishableKey: r.stripePublishableKey, secretKey, webhookSecret } : null;
}

export async function shopStripeStatus(db: Executor, shopId: number, key: string): Promise<StripeStatus> {
  const k = await getShopStripeKeys(db, shopId, key);
  const [r] = await db.select({ endpoint: shopSecrets.stripeWebhookEndpointId }).from(shopSecrets).where(eq(shopSecrets.shopId, shopId));
  return { configured: !!k, publishableKey: k?.publishableKey ?? null, secretKeyLast4: k?.secretKey ? k.secretKey.slice(-4) : null, webhookSecretSet: !!k?.webhookSecret, testMode: !k || !!k.secretKey?.startsWith('sk_test_'), webhookAutoCreated: !!k && !!r?.endpoint };
}

/** What saving keys needs from Stripe and from the server: validating the key, registering the webhook endpoint and the wallet domains. */
export interface StripeSetup {
  /** Stripe account client for a secret key. Without it keys are only format-checked and the webhook secret must be given. */
  admin?: (secretKey: string) => StripeAdmin;
  /** Public URL of the store's webhook endpoint. */
  webhookUrl?: string;
  /** Hosts of the store (primary domain, platform host, verified domains) to register for wallets. */
  domains?: string[];
}

/** Stripe cannot deliver events to a private address; auto-registration is only attempted for a public https URL. */
export function isPublicHttpsUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    const local = h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.startsWith('[') || /^(127|10|0)\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
    return u.protocol === 'https:' && !local && h.includes('.');
  } catch { return false; }
}

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Save the store's Stripe keys, or clear them with `null` (the store falls back to the installation keys). The secret key is checked with a
 * real call to Stripe. Without a webhook signing secret the endpoint is created through the Stripe API (public https URL only) and its
 * secret stored encrypted next to its id; an endpoint ShopMe created earlier is deleted when the keys are replaced or removed. Registering
 * the store's domains for wallets is best effort and never blocks.
 */
export async function setShopStripeKeys(db: Executor, shopId: number, keys: StripeKeys | null, key: string, setup: StripeSetup = {}): Promise<Result<StripeStatus>> {
  const [old] = await db.select().from(shopSecrets).where(eq(shopSecrets.shopId, shopId));
  const dropOldEndpoint = async () => {
    const oldSecret = old?.stripeSecretKey ? decryptSecret(old.stripeSecretKey, key) : null;
    if (old?.stripeWebhookEndpointId && oldSecret && setup.admin) { try { await setup.admin(oldSecret).deleteWebhookEndpoint(old.stripeWebhookEndpointId); } catch { /* already gone or key revoked */ } }
  };
  if (keys === null) {
    await dropOldEndpoint();
    await db.update(shopSecrets).set({ stripePublishableKey: null, stripeSecretKey: null, stripeWebhookSecret: null, stripeWebhookEndpointId: null, updatedAt: new Date() }).where(eq(shopSecrets.shopId, shopId));
    return okR(await shopStripeStatus(db, shopId, key));
  }
  const pk = keys.publishableKey?.trim() ?? '';
  const sk = keys.secretKey?.trim() ?? '';
  const wh = keys.webhookSecret?.trim() ?? '';
  if (!/^pk_(test|live)_[A-Za-z0-9]+$/.test(pk)) return errR(['publishableKey'], 'The publishable key starts with pk_test_ or pk_live_', 'INVALID');
  if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(sk)) return errR(['secretKey'], 'The secret key starts with sk_test_, sk_live_ or rk_', 'INVALID');
  if (wh && !/^whsec_[A-Za-z0-9]+$/.test(wh)) return errR(['webhookSecret'], 'The webhook signing secret starts with whsec_', 'INVALID');
  if (pk.includes('_test_') !== sk.includes('_test_')) return errR(['secretKey'], 'Use test keys or live keys for both', 'MISMATCH');
  const admin = setup.admin?.(sk);
  if (admin) {
    try { await admin.verifyAccount(); } catch (e) { return errR(['secretKey'], `Stripe did not accept this secret key: ${msgOf(e)}`, 'INVALID'); }
  }
  let secret = wh;
  let endpointId: string | null = null;
  if (!wh) {
    const manual = 'Create a webhook endpoint in the Stripe Dashboard and paste its signing secret (whsec_...)';
    if (!admin || !isPublicHttpsUrl(setup.webhookUrl)) return errR(['webhookSecret'], `The webhook endpoint cannot be created automatically: this server is not reachable from Stripe over https (${setup.webhookUrl ?? 'unknown URL'}). ${manual}.`, 'WEBHOOK_SECRET_REQUIRED');
    try { const e = await admin.createWebhookEndpoint(setup.webhookUrl!); secret = e.secret; endpointId = e.id; }
    catch (e) { return errR(['webhookSecret'], `Stripe could not create the webhook endpoint (${msgOf(e)}). ${manual}.`, 'WEBHOOK_SECRET_REQUIRED'); }
  }
  // Wallets (Apple Pay, Google Pay) need the domain registered with Stripe; best effort.
  if (admin) for (const d of new Set(setup.domains ?? [])) {
    if (!isPublicHttpsUrl(`https://${d}`)) continue;
    try { await admin.registerDomain(d); } catch { /* already registered or not verifiable yet: never blocks saving */ }
  }
  await dropOldEndpoint();
  const values = { stripePublishableKey: pk, stripeSecretKey: encryptSecret(sk, key), stripeWebhookSecret: encryptSecret(secret, key), stripeWebhookEndpointId: endpointId, updatedAt: new Date() };
  await db.insert(shopSecrets).values({ shopId, ...values }).onConflictDoUpdate({ target: shopSecrets.shopId, set: values });
  return okR(await shopStripeStatus(db, shopId, key));
}

// ---- deletion ---------------------------------------------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Every table with a `shop_id` column, children before parents (deletion order). */
function shopTablesChildrenFirst(): { name: string; table: any; shopCol: string }[] {
  const all = Object.values(schema as Record<string, unknown>).filter((v): v is PgTable => is(v, PgTable))
    .map((table) => ({ name: getTableName(table), table: table as any, shopCol: Object.entries(getTableColumns(table)).find(([, c]) => (c as { name: string }).name === 'shop_id')?.[0] }))
    .filter((t): t is { name: string; table: any; shopCol: string } => !!t.shopCol && t.name !== 'shops');
  const names = new Set(all.map((t) => t.name));
  const deps = new Map(all.map((t) => [t.name, getTableConfig(t.table).foreignKeys.map((f) => getTableName(f.reference().foreignTable)).filter((n) => names.has(n) && n !== t.name)]));
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (n: string) => { if (seen.has(n)) return; seen.add(n); deps.get(n)!.forEach(visit); order.push(n); };
  all.map((t) => t.name).sort().forEach(visit);
  return order.reverse().map((n) => all.find((t) => t.name === n)!);
}

/**
 * Delete a store and every row that belongs to it (platform owner, multi-store mode). Staff sessions that were opened in it stay
 * signed in (they point at no store until the account picks another). Returns the storage keys of its files (the caller deletes
 * them, or its whole folder) or null when the store does not exist.
 */
export async function deleteStoreData(db: Db, shopId: number): Promise<{ shop: Shop; keys: string[] } | null> {
  const [shop] = await db.select().from(shops).where(eq(shops.id, shopId));
  if (!shop) return null;
  const keys = [
    ...(await db.select({ k: schema.files.storageKey }).from(schema.files).where(eq(schema.files.shopId, shopId))).map((r) => r.k),
    ...(await db.select({ k: schema.themeFiles.storageKey }).from(schema.themeFiles).where(eq(schema.themeFiles.shopId, shopId))).map((r) => r.k),
  ].filter((k): k is string => typeof k === 'string' && !!k);
  await db.transaction(async (tx) => {
    const memberIds = (await tx.select({ id: staffUsers.id }).from(staffUsers).where(eq(staffUsers.shopId, shopId))).map((r) => r.id);
    if (memberIds.length) await tx.update(sessions).set({ shopId: null, staffUserId: null }).where(and(eq(sessions.kind, 'staff'), inArray(sessions.staffUserId, memberIds)));
    await tx.delete(sessions).where(and(eq(sessions.kind, 'customer'), eq(sessions.shopId, shopId)));
    for (const t of shopTablesChildrenFirst()) await tx.delete(t.table).where(eq(t.table[t.shopCol], shopId));
    await tx.delete(shops).where(eq(shops.id, shopId));
  });
  return { shop, keys };
}
