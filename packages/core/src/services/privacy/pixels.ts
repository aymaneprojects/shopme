import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { pixels, storefrontEvents } from '../../db/schema';
import type { Executor } from '../../db/client';
import { errR, okR, type Result } from '../catalog/common';

/** Customer events: custom pixels (merchant-pasted code run in a sandboxed frame) and the first-party event stream. */
export type PixelRow = typeof pixels.$inferSelect;
export const PIXEL_CODE_MAX = 256 * 1024;
export const PIXEL_CONSENT_CATEGORIES = ['analytics', 'marketing', 'preferences'] as const;
export const STANDARD_EVENTS = [
  'page_viewed', 'product_viewed', 'collection_viewed', 'search_submitted', 'product_added_to_cart', 'product_removed_from_cart', 'cart_viewed',
  'checkout_started', 'checkout_contact_info_submitted', 'checkout_address_info_submitted', 'checkout_shipping_info_submitted', 'payment_info_submitted', 'checkout_completed',
] as const;
export const EVENT_RETENTION_DAYS = 90;

export interface PixelInput { name?: string | null; code?: string | null; requiredConsent?: string[] | null; respectSaleOptOut?: boolean | null; domEvents?: boolean | null }

function check(i: PixelInput, creating: boolean): Result<null> {
  if (creating && !i.name?.trim()) return errR(['name'], "Name can't be blank", 'BLANK');
  if (i.name != null && i.name.trim().length > 100) return errR(['name'], 'Name is too long', 'TOO_LONG');
  if (i.code != null && Buffer.byteLength(i.code, 'utf8') > PIXEL_CODE_MAX) return errR(['code'], 'The pixel code is larger than 256 KB', 'TOO_BIG');
  if (i.requiredConsent?.some((c) => !(PIXEL_CONSENT_CATEGORIES as readonly string[]).includes(c))) return errR(['requiredConsent'], 'Consent category is not valid', 'INCLUSION');
  return okR(null);
}

export const listPixels = (db: Executor, shopId: number): Promise<PixelRow[]> => db.select().from(pixels).where(eq(pixels.shopId, shopId)).orderBy(asc(pixels.id));
export async function getPixel(db: Executor, shopId: number, id: number): Promise<PixelRow | null> {
  const [r] = await db.select().from(pixels).where(and(eq(pixels.shopId, shopId), eq(pixels.id, id))).limit(1);
  return r ?? null;
}

export async function createPixel(db: Executor, shopId: number, i: PixelInput): Promise<Result<PixelRow>> {
  const v = check(i, true);
  if (!v.ok) return v;
  const [row] = await db.insert(pixels).values({
    shopId, kind: 'CUSTOM', name: i.name!.trim(), code: i.code ?? '', requiredConsent: [...new Set(i.requiredConsent ?? [])], respectSaleOptOut: i.respectSaleOptOut ?? true, domEvents: !!i.domEvents,
  }).returning();
  return okR(row!);
}

export async function updatePixel(db: Executor, shopId: number, id: number, i: PixelInput): Promise<Result<PixelRow>> {
  if (!(await getPixel(db, shopId, id))) return errR(['id'], 'Pixel does not exist', 'NOT_FOUND');
  const v = check(i, false);
  if (!v.ok) return v;
  const [row] = await db.update(pixels).set({
    ...(i.name != null && { name: i.name.trim() || 'Pixel' }), ...(i.code != null && { code: i.code }), ...(i.requiredConsent != null && { requiredConsent: [...new Set(i.requiredConsent)] }),
    ...(i.respectSaleOptOut != null && { respectSaleOptOut: i.respectSaleOptOut }), ...(i.domEvents != null && { domEvents: i.domEvents }), updatedAt: new Date(),
  }).where(and(eq(pixels.shopId, shopId), eq(pixels.id, id))).returning();
  return okR(row!);
}

export async function setPixelConnected(db: Executor, shopId: number, id: number, connected: boolean): Promise<Result<PixelRow>> {
  const cur = await getPixel(db, shopId, id);
  if (!cur) return errR(['id'], 'Pixel does not exist', 'NOT_FOUND');
  if (connected && !cur.code?.trim()) return errR(['code'], 'Add the pixel code before connecting it', 'BLANK');
  const [row] = await db.update(pixels).set({ connected, updatedAt: new Date() }).where(eq(pixels.id, id)).returning();
  return okR(row!);
}

export async function deletePixel(db: Executor, shopId: number, id: number): Promise<boolean> {
  return (await db.delete(pixels).where(and(eq(pixels.shopId, shopId), eq(pixels.id, id))).returning({ id: pixels.id })).length > 0;
}

/** Pixels the storefront loads (connected ones). The code itself is only served by the sandbox document, never inlined in pages. */
export const connectedPixels = (db: Executor, shopId: number): Promise<PixelRow[]> =>
  db.select().from(pixels).where(and(eq(pixels.shopId, shopId), eq(pixels.connected, true), eq(pixels.kind, 'CUSTOM'))).orderBy(asc(pixels.id));

// --- first-party event stream ---------------------------------------------------------------------------------------------

export interface IncomingEvent { id?: string; name: string; clientId?: string | null; timestamp?: string | number; data?: unknown; context?: unknown }
const clip = (v: unknown, max: number): Record<string, unknown> | null => {
  if (!v || typeof v !== 'object') return null;
  const s = JSON.stringify(v);
  return s.length <= max ? (JSON.parse(s) as Record<string, unknown>) : null;
};

/** Store a batch of events (the caller has already checked analytics consent). Duplicate event ids are ignored. Returns how many were kept. */
export async function recordStorefrontEvents(db: Executor, shopId: number, events: IncomingEvent[], opts: { customerId?: number | null; now?: Date } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const rows = events.slice(0, 100).flatMap((e) => {
    if (!e || typeof e.name !== 'string' || !(STANDARD_EVENTS as readonly string[]).includes(e.name)) return [];
    const at = new Date(e.timestamp ?? now);
    const occurredAt = Number.isNaN(at.getTime()) || at.getTime() > now.getTime() + 60_000 || at.getTime() < now.getTime() - 24 * 3600 * 1000 ? now : at;
    return [{
      shopId, eventId: typeof e.id === 'string' ? e.id.slice(0, 64) : null, name: e.name, clientId: typeof e.clientId === 'string' ? e.clientId.slice(0, 64) : null,
      customerId: opts.customerId ?? null, data: clip(e.data, 8000), context: clip(e.context, 4000), occurredAt,
    }];
  });
  if (!rows.length) return 0;
  const done = await db.insert(storefrontEvents).values(rows).onConflictDoNothing().returning({ id: storefrontEvents.id });
  return done.length;
}

export async function purgeStorefrontEvents(db: Executor, now = new Date()): Promise<void> {
  await db.delete(storefrontEvents).where(lt(storefrontEvents.occurredAt, new Date(now.getTime() - EVENT_RETENTION_DAYS * 24 * 3600 * 1000)));
}

/** Event counts per name over the last `days` days (admin summary and the conversion funnel). */
export async function storefrontEventCounts(db: Executor, shopId: number, days = 7, now = new Date()): Promise<{ name: string; count: number }[]> {
  const since = new Date(now.getTime() - days * 24 * 3600 * 1000);
  const rows = await db.select({ name: storefrontEvents.name, count: sql<number>`count(*)::int` }).from(storefrontEvents)
    .where(and(eq(storefrontEvents.shopId, shopId), gte(storefrontEvents.occurredAt, since))).groupBy(storefrontEvents.name).orderBy(desc(sql`count(*)`));
  return rows;
}

// --- web pixels (app pixels): the Admin API stores their settings; the extension runtime that executes them is not built yet ---------------------

export const getAppPixel = async (db: Executor, shopId: number): Promise<PixelRow | null> => {
  const [r] = await db.select().from(pixels).where(and(eq(pixels.shopId, shopId), eq(pixels.kind, 'APP'))).limit(1);
  return r ?? null;
};
export async function createAppPixel(db: Executor, shopId: number, settings: Record<string, unknown>): Promise<Result<PixelRow>> {
  if (await getAppPixel(db, shopId)) return errR(['webPixel'], 'A web pixel already exists for this app', 'TAKEN');
  if (JSON.stringify(settings).length > 20_000) return errR(['webPixel', 'settings'], 'The settings are too large', 'INVALID_SETTINGS');
  const [row] = await db.insert(pixels).values({ shopId, kind: 'APP', name: 'Web pixel', code: null, settings, connected: true, requiredConsent: [] }).returning();
  return okR(row!);
}
export async function updateAppPixel(db: Executor, shopId: number, id: number, settings: Record<string, unknown>): Promise<Result<PixelRow>> {
  const cur = await getPixel(db, shopId, id);
  if (!cur || cur.kind !== 'APP') return errR(['id'], 'Web pixel does not exist', 'NOT_FOUND');
  if (JSON.stringify(settings).length > 20_000) return errR(['webPixel', 'settings'], 'The settings are too large', 'INVALID_SETTINGS');
  const [row] = await db.update(pixels).set({ settings, updatedAt: new Date() }).where(eq(pixels.id, id)).returning();
  return okR(row!);
}
