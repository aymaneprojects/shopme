import { eq, sql } from 'drizzle-orm';
import { defaultMoneyFormats } from '@shopme/shopify-compat';
import { locations, menus, shops, themes } from '../db/schema';
import type { Db, Executor } from '../db/client';
import { createStaffUser, MIN_PASSWORD_LENGTH } from './auth';
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
}

export class SetupError extends Error {}

/** First-run setup: shop + owner + default location + default theme row, in one transaction. */
export async function setupStore(db: Db, input: SetupInput) {
  if (input.password.length < MIN_PASSWORD_LENGTH) throw new SetupError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  return db.transaction(async (tx) => {
    // Serialise concurrent setups (advisory lock is released at transaction end).
    await tx.execute(sql`select pg_advisory_xact_lock(7210001)`);
    if (!(await needsSetup(tx))) throw new SetupError('Store is already set up');
    const currency = input.currency.toUpperCase();
    const formats = defaultMoneyFormats(currency, input.locale);
    const [shop] = await tx.insert(shops).values({
      name: input.shopName.trim(), email: input.email.trim().toLowerCase(), currency, country: input.country.toUpperCase(),
      locale: input.locale, timezone: input.timezone ?? 'UTC', primaryDomain: input.primaryDomain ?? null, ...formats,
    }).returning();
    const owner = await createStaffUser(tx, { shopId: shop!.id, email: input.email, password: input.password, firstName: input.firstName, lastName: input.lastName, role: 'owner' });
    await tx.insert(locations).values({ shopId: shop!.id, name: 'Shop location', countryCode: shop!.country });
    // Placeholder row; the storefront agent installs the default theme files into it.
    await tx.insert(themes).values({ shopId: shop!.id, name: 'Default', role: 'MAIN' });
    // Default menus (the theme header and footer read these handles); they cannot be deleted later.
    const fr = input.locale.toLowerCase().startsWith('fr');
    await tx.insert(menus).values([
      { shopId: shop!.id, handle: 'main-menu', title: fr ? 'Menu principal' : 'Main menu' },
      { shopId: shop!.id, handle: 'footer', title: fr ? 'Menu de pied de page' : 'Footer menu' },
    ]);
    await addEvent(tx, shop!.id, { subjectType: 'shop', subjectId: shop!.id, verb: 'shop.created', message: 'Store created', authorStaffUserId: owner.id });
    return { shop: shop!, owner };
  });
}
