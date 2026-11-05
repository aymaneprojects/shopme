import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { carts, checkoutMeta, customers, shops } from '../db/schema';
import type { Executor } from '../db/client';
import type { Mailer } from '../mail';
import { moneyOf, notificationEnabled, sendNotification, shopUrl } from '../mail/notifications';
import { buildSearch, dateCompare, idTerm, likeCi } from './catalog/search';
import { loadCheckout, type CheckoutView } from './checkout';
import type { Shop } from './shops';

/** Merchant settings (stored in `shops.settings.abandonedCheckouts`). Recovery emails are opt-in. */
export interface AbandonedSettings { enabled: boolean; delayHours: number }
export const ABANDONED_DELAYS = [1, 6, 10, 24] as const;

export function abandonedSettingsOf(shop: Pick<Shop, 'settings'>): AbandonedSettings {
  const v = ((shop.settings as Record<string, unknown>).abandonedCheckouts ?? {}) as Partial<AbandonedSettings>;
  return { enabled: v.enabled === true, delayHours: (ABANDONED_DELAYS as readonly number[]).includes(Number(v.delayHours)) ? Number(v.delayHours) : 10 };
}

export async function updateAbandonedSettings(db: Executor, shop: Shop, i: Partial<AbandonedSettings>): Promise<AbandonedSettings | { error: string }> {
  const cur = abandonedSettingsOf(shop);
  const next = { enabled: i.enabled ?? cur.enabled, delayHours: i.delayHours ?? cur.delayHours };
  if (!(ABANDONED_DELAYS as readonly number[]).includes(next.delayHours)) return { error: `Delay must be one of ${ABANDONED_DELAYS.join(', ')} hours` };
  await db.update(shops).set({ settings: { ...shop.settings, abandonedCheckouts: next }, updatedAt: new Date() }).where(eq(shops.id, shop.id));
  return next;
}

export type AbandonedRow = typeof carts.$inferSelect & { recoveryEmailCount: number; recoverySentAt: Date | null };

/** Carts with an email and items that were not completed and have been idle for `idleMs`. */
const open = (shopId: number, idleMs: number, now: Date) => and(
  eq(carts.shopId, shopId), isNull(carts.completedAt), sql`${carts.email} is not null`, sql`${carts.updatedAt} < ${new Date(now.getTime() - idleMs).toISOString()}::timestamptz`,
  sql`exists (select 1 from cart_lines l where l.cart_id = ${carts.id})`,
);

const search = (q: string | null | undefined) => buildSearch(q, {
  fields: {
    email: (_o, v) => likeCi(carts.email, v, true), id: (_o, v) => idTerm(carts.id, v), checkout_id: (_o, v) => idTerm(carts.id, v),
    status: (_o, v) => (v.toLowerCase() === 'recovery_email_sent' ? sql`exists (select 1 from checkout_meta m where m.cart_id = ${carts.id} and m.recovery_email_count > 0)` : null),
    created_at: (op, v) => dateCompare(carts.createdAt, op, v), updated_at: (op, v) => dateCompare(carts.updatedAt, op, v),
  },
  text: (v) => sql`(${carts.email} ilike ${`%${v}%`} or ${carts.token} = ${v})`,
});

export type AbandonedSortKey = 'CREATED_AT' | 'CUSTOMER_NAME' | 'ID' | 'RELEVANCE' | 'TOTAL_PRICE' | 'CHECKOUT_ID';

export async function findAbandonedCheckouts(db: Executor, shop: Shop, o: { query?: string | null; sortKey?: AbandonedSortKey; reverse?: boolean; offset: number; limit: number; idleMs?: number; now?: Date }): Promise<AbandonedRow[]> {
  const idle = o.idleMs ?? abandonedSettingsOf(shop).delayHours * 3_600_000;
  const col = o.sortKey === 'CREATED_AT' ? carts.createdAt : o.sortKey === 'CUSTOMER_NAME' ? carts.email : carts.id;
  const dir = o.reverse ? desc : asc;
  const rows = await db.select({ cart: carts, count: checkoutMeta.recoveryEmailCount, sent: checkoutMeta.recoverySentAt }).from(carts).leftJoin(checkoutMeta, eq(checkoutMeta.cartId, carts.id))
    .where(and(open(shop.id, idle, o.now ?? new Date()), search(o.query))).orderBy(dir(col), dir(carts.id)).limit(o.limit).offset(o.offset);
  return rows.map((r) => ({ ...r.cart, recoveryEmailCount: r.count ?? 0, recoverySentAt: r.sent }));
}

export async function countAbandonedCheckouts(db: Executor, shop: Shop, query?: string | null, limit = 10000, idleMs?: number, now = new Date()): Promise<{ count: number; precision: 'EXACT' | 'AT_LEAST' }> {
  const rows = await db.select({ id: carts.id }).from(carts).where(and(open(shop.id, idleMs ?? abandonedSettingsOf(shop).delayHours * 3_600_000, now), search(query))).limit(limit + 1);
  return rows.length > limit ? { count: limit, precision: 'AT_LEAST' } : { count: rows.length, precision: 'EXACT' };
}

/** One abandoned checkout by cart id (any cart with an email that was not completed; idle time is not re-checked). */
export async function getAbandonedCheckout(db: Executor, shopId: number, id: number): Promise<AbandonedRow | null> {
  const [r] = await db.select({ cart: carts, count: checkoutMeta.recoveryEmailCount, sent: checkoutMeta.recoverySentAt }).from(carts).leftJoin(checkoutMeta, eq(checkoutMeta.cartId, carts.id))
    .where(and(eq(carts.shopId, shopId), eq(carts.id, id), sql`${carts.email} is not null`)).limit(1);
  return r ? { ...r.cart, recoveryEmailCount: r.count ?? 0, recoverySentAt: r.sent } : null;
}

/** The checkout page of an abandoned cart, priced like at checkout. */
export const abandonedView = (db: Executor, shop: Shop, cart: Pick<AbandonedRow, 'token'>): Promise<CheckoutView | null> => loadCheckout(db, shop, cart.token);

/** Link that restores the cart in the buyer's browser and opens the checkout. */
export const recoveryUrl = (shop: Shop, appUrl: string, token: string): string => `${shopUrl(shop, appUrl)}/checkouts/${token}/recover`;

/** Send the recovery email of one cart (manually, or from the sweep) and record it. Returns false when the cart cannot be emailed. */
export async function sendRecoveryEmail(db: Executor, mailer: Mailer, shop: Shop, appUrl: string, cart: AbandonedRow): Promise<boolean> {
  if (!cart.email || cart.completedAt) return false;
  const view = await abandonedView(db, shop, cart);
  if (!view || !view.lines.length) return false;
  const [customer] = await db.select({ firstName: customers.firstName }).from(customers).where(and(eq(customers.shopId, shop.id), eq(customers.email, cart.email.toLowerCase()))).limit(1);
  const money = (n: number) => moneyOf(shop, n, cart.currency);
  await sendNotification(db, mailer, shop, appUrl, 'abandoned_checkout', cart.email, {
    checkout: {
      customer_first_name: customer?.firstName ?? view.address?.firstName ?? null, subtotal: money(view.pricing.subtotal - view.pricing.lines.reduce((n, l) => n + l.discount, 0)),
      line_items: view.lines.map((l) => ({ title: [l.product.title, l.hasOnlyDefaultVariant ? '' : l.variantTitle].filter(Boolean).join(' - '), quantity: l.quantity, total: money(l.price * l.quantity) })),
      recovery_url: recoveryUrl(shop, appUrl, cart.token),
    },
  }, { force: true });
  await db.insert(checkoutMeta).values({ cartId: cart.id, shopId: shop.id, recoveryEmailCount: 1, recoverySentAt: new Date() })
    .onConflictDoUpdate({ target: checkoutMeta.cartId, set: { recoveryEmailCount: sql`${checkoutMeta.recoveryEmailCount} + 1`, recoverySentAt: new Date() } });
  return true;
}

/**
 * The scheduled job: when automatic recovery is on, email every abandoned checkout idle for the configured delay that has not been
 * emailed yet (at most `limit` per run). Returns how many emails went out.
 */
export async function recoverAbandonedCheckouts(db: Executor, mailer: Mailer, shop: Shop, appUrl: string, o: { now?: Date; limit?: number } = {}): Promise<number> {
  const settings = abandonedSettingsOf(shop);
  if (!settings.enabled || !notificationEnabled(shop, 'abandoned_checkout')) return 0;
  const rows = await findAbandonedCheckouts(db, shop, { offset: 0, limit: 500, now: o.now });
  let sent = 0;
  for (const r of rows) {
    if (r.recoveryEmailCount > 0) continue;
    if (sent >= (o.limit ?? 50)) break;
    if (await sendRecoveryEmail(db, mailer, shop, appUrl, r)) sent++;
  }
  return sent;
}
