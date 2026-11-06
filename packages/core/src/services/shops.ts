import { ensureOnlineStore } from './catalog/publications';
import { ensurePrimaryMarket } from './markets/service';
import { eq, sql } from 'drizzle-orm';
import { defaultMoneyFormats } from '@shopme/shopify-compat';
import { locations, menuItems, menus, platformAccounts, shops, themes } from '../db/schema';
import type { Db, Executor } from '../db/client';
import { createStaffUser, MIN_PASSWORD_LENGTH, type Account } from './auth';
import { addEvent } from './events';

export type Shop = typeof shops.$inferSelect;

export async function needsSetup(db: Executor): Promise<boolean> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(shops);
  return (r?.n ?? 0) === 0;
}

export async function getShop(db: Executor, shopId: number): Promise<Shop | null> {
  const [s] = await db.select().from(shops).where(eq(shops.id, shopId)).limit(1);
  return s ?? null;
}

/** The single store of this installation (lowest id), or null before setup. */
export async function getPrimaryShop(db: Executor): Promise<Shop | null> {
  const [s] = await db.select().from(shops).orderBy(shops.id).limit(1);
  return s ?? null;
}

export interface SetupInput {
  shopName: string;
  email: string;
  password: string;
  currency: string;
  country: string;
  locale: string;
  timezone?: string;
  firstName?: string;
  lastName?: string;
  primaryDomain?: string | null;
  /** Store handle (default: slug of the name, made unique). */
  handle?: string;
  /** Keep the store's uploads in their own folder (`shops/<id>`): multi-store mode. */
  perStoreStorage?: boolean;
  /** The first account of the installation becomes platform owner (multi-store mode). */
  platformOwner?: boolean;
}

export class SetupError extends Error {}

// ---- store handles ------------------------------------------------------------------------------------------------------------

/** Handles that would collide with platform hosts or paths. */
export const RESERVED_HANDLES = new Set(['admin', 'www', 'api', 'app', 'apps', 'mail', 'smtp', 'imap', 'platform', 'store', 'stores', 'shop', 'shops', 'cdn', 'static', 'assets', 'files', 'help', 'support', 'status', 'checkout', 'checkouts', 'account', 'accounts', 'login', 'auth', 'localhost', 'webhooks', 'docs', 'blog']);
const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** `"Boutique Été"` -> `boutique-ete` (at most 40 characters). */
export function slugifyHandle(name: string): string {
  const s = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
  return s || 'store';
}

/** Error message for an unusable handle, or null. */
export function handleProblem(handle: string): string | null {
  if (!HANDLE_RE.test(handle)) return 'Use 1 to 40 lowercase letters, digits or hyphens, starting and ending with a letter or digit';
  if (RESERVED_HANDLES.has(handle)) return 'This handle is reserved';
  return null;
}

const handleTaken = async (db: Executor, handle: string) => (await db.select({ id: shops.id }).from(shops).where(eq(shops.handle, handle)).limit(1)).length > 0;

/** The handle a new store named `name` would get: its slug, or the slug with `-2`, `-3`... when taken or reserved. */
export async function availableHandle(db: Executor, name: string): Promise<string> {
  const root = slugifyHandle(name);
  let candidate = root;
  for (let i = 2; RESERVED_HANDLES.has(candidate) || (await handleTaken(db, candidate)); i++) candidate = `${root.slice(0, 36)}-${i}`;
  return candidate;
}

/** A store's handle (stores created before handles existed fall back to `store-<id>`). */
export const handleOf = (shop: Pick<Shop, 'id' | 'handle'>) => shop.handle ?? `store-${shop.id}`;

// ---- creation -----------------------------------------------------------------------------------------------------------------

type StoreInput = Omit<SetupInput, 'email' | 'password' | 'platformOwner'> & { email: string };
type Owner = { accountId: number; email: string; firstName?: string | null; lastName?: string | null } | { password: string; email: string; firstName?: string; lastName?: string; platformOwner?: boolean };

/** Shop + owner + default location, market, publication, theme row and starter menus, inside `tx`. */
async function insertStore(tx: Executor, input: StoreInput, owner: Owner) {
  const currency = input.currency.toUpperCase();
  const formats = defaultMoneyFormats(currency, input.locale);
  let handle = input.handle?.trim().toLowerCase();
  if (handle) {
    const problem = handleProblem(handle);
    if (problem) throw new SetupError(problem);
    if (await handleTaken(tx, handle)) throw new SetupError('This handle is already used by another store');
  } else handle = await availableHandle(tx, input.shopName);
  const [created] = await tx.insert(shops).values({
    name: input.shopName.trim(), email: input.email.trim().toLowerCase(), currency, country: input.country.toUpperCase(),
    locale: input.locale, timezone: input.timezone ?? 'UTC', primaryDomain: input.primaryDomain ?? null, handle, ...formats,
  }).returning();
  let shop = created!;
  if (input.perStoreStorage) [shop] = (await tx.update(shops).set({ storagePrefix: `shops/${shop.id}` }).where(eq(shops.id, shop.id)).returning()) as [Shop];
  let ownerUser;
  if ('accountId' in owner) {
    ownerUser = await createStaffUser(tx, { shopId: shop.id, email: owner.email, accountId: owner.accountId, firstName: owner.firstName, lastName: owner.lastName, role: 'owner' });
  } else {
    ownerUser = await createStaffUser(tx, { shopId: shop.id, email: owner.email, password: owner.password, firstName: owner.firstName, lastName: owner.lastName, role: 'owner' });
    if (owner.platformOwner) await tx.update(platformAccounts).set({ platformOwner: true }).where(eq(platformAccounts.id, ownerUser.accountId!));
  }
  await tx.insert(locations).values({ shopId: shop.id, name: 'Shop location', countryCode: shop.country });
  // Every shop has one primary market (its own settings) and a currency setting for its currency.
  await ensurePrimaryMarket(tx, { id: shop.id, name: shop.name, currency, country: shop.country });
  await ensureOnlineStore(tx, shop.id);
  // Placeholder row; the storefront agent installs the default theme files into it.
  await tx.insert(themes).values({ shopId: shop.id, name: 'Default', role: 'MAIN' });
  // Default menus (the theme header and footer read these handles); they cannot be deleted later.
  const fr = input.locale.toLowerCase().startsWith('fr');
  const [mainMenu, footerMenu] = await tx.insert(menus).values([
    { shopId: shop.id, handle: 'main-menu', title: fr ? 'Menu principal' : 'Main menu' },
    { shopId: shop.id, handle: 'footer', title: fr ? 'Menu de pied de page' : 'Footer menu' },
  ]).returning();
  // Starter links so a new store has a usable header and footer; the merchant edits them in Navigation.
  await tx.insert(menuItems).values([
    { shopId: shop.id, menuId: mainMenu!.id, position: 0, title: fr ? 'Accueil' : 'Home', linkType: 'FRONTPAGE', url: '/' },
    { shopId: shop.id, menuId: mainMenu!.id, position: 1, title: fr ? 'Catalogue' : 'Catalog', linkType: 'CATALOG', url: '/collections/all' },
    { shopId: shop.id, menuId: footerMenu!.id, position: 0, title: fr ? 'Recherche' : 'Search', linkType: 'SEARCH', url: '/search' },
  ]);
  await addEvent(tx, shop.id, { subjectType: 'shop', subjectId: shop.id, verb: 'shop.created', message: 'Store created', authorStaffUserId: ownerUser.id });
  return { shop, owner: ownerUser };
}

/** First-run setup: shop + owner + default location + default theme row, in one transaction. */
export async function setupStore(db: Db, input: SetupInput) {
  if (input.password.length < MIN_PASSWORD_LENGTH) throw new SetupError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  return db.transaction(async (tx) => {
    // Serialise concurrent setups (advisory lock is released at transaction end).
    await tx.execute(sql`select pg_advisory_xact_lock(7210001)`);
    if (!(await needsSetup(tx))) throw new SetupError('Store is already set up');
    if (input.platformOwner && (await tx.select({ id: platformAccounts.id }).from(platformAccounts).limit(1)).length) throw new SetupError('Store is already set up');
    return insertStore(tx, input, { email: input.email, password: input.password, firstName: input.firstName, lastName: input.lastName, platformOwner: input.platformOwner });
  });
}

export interface CreateStoreInput { shopName: string; handle?: string; currency: string; country: string; locale: string; timezone?: string }

/** Multi-store mode: a new store owned by an existing account (its staff role is `owner`). */
export async function createStore(db: Db, account: Pick<Account, 'id' | 'email' | 'firstName' | 'lastName'>, input: CreateStoreInput) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7210002)`);
    return insertStore(tx, { ...input, email: account.email, perStoreStorage: true }, { accountId: account.id, email: account.email, firstName: account.firstName, lastName: account.lastName });
  });
}

/** Multi-store mode: suspend (storefront unavailable, admin read-only) or resume a store. */
export async function setStoreStatus(db: Executor, shopId: number, status: 'ACTIVE' | 'SUSPENDED'): Promise<Shop | null> {
  const [s] = await db.update(shops).set({ status, updatedAt: new Date() }).where(eq(shops.id, shopId)).returning();
  return s ?? null;
}
