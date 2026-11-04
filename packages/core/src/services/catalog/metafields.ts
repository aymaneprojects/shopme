import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { UserError } from '@shopme/shopify-compat';
import { collections, customers, locations, metafields, orders, productVariants, products, shops } from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { emit, txResult, type Result } from './common';

export type Metafield = typeof metafields.$inferSelect;
export const DEFAULT_NAMESPACE = 'custom';

const OWNER_TABLES = {
  PRODUCT: products, PRODUCTVARIANT: productVariants, COLLECTION: collections, LOCATION: locations, SHOP: shops, CUSTOMER: customers, ORDER: orders,
} as const;
/** GID type name -> metafield owner type. */
export const OWNER_TYPE_BY_GID: Record<string, keyof typeof OWNER_TABLES> = {
  Product: 'PRODUCT', ProductVariant: 'PRODUCTVARIANT', Collection: 'COLLECTION', Location: 'LOCATION', Shop: 'SHOP', Customer: 'CUSTOMER', Order: 'ORDER',
};

const BASE_TYPES = [
  'single_line_text_field', 'multi_line_text_field', 'rich_text_field', 'number_integer', 'number_decimal', 'boolean', 'json', 'date', 'date_time', 'color', 'url',
  'weight', 'volume', 'dimension', 'money', 'rating', 'id', 'product_reference', 'variant_reference', 'collection_reference', 'file_reference', 'page_reference',
  'customer_reference', 'metaobject_reference', 'mixed_reference',
];

export const digest = (m: Pick<Metafield, 'type' | 'value'>) => createHash('sha256').update(`${m.type}\n${m.value}`).digest('hex').slice(0, 32);

/** Returns an error message when `value` does not fit `type`, else null. */
export function validateMetafieldValue(type: string, value: string): string | null {
  const base = type.startsWith('list.') ? type.slice(5) : type;
  if (!BASE_TYPES.includes(base)) return `Type '${type}' is not a valid metafield type.`;
  if (type.startsWith('list.')) {
    try { if (!Array.isArray(JSON.parse(value))) return 'Value must be a JSON array.'; } catch { return 'Value must be a JSON array.'; }
    return null;
  }
  if (base === 'number_integer' && !/^-?\d+$/.test(value)) return 'Value must be an integer.';
  if (base === 'number_decimal' && !Number.isFinite(Number(value))) return 'Value must be a decimal number.';
  if (base === 'boolean' && value !== 'true' && value !== 'false') return 'Value must be true or false.';
  if (base === 'color' && !/^#[0-9a-fA-F]{6}$/.test(value)) return 'Value must be a hex color like #ff0000.';
  if (base === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Value must be a date (YYYY-MM-DD).';
  if (base === 'date_time' && Number.isNaN(Date.parse(value))) return 'Value must be an ISO 8601 date time.';
  if (base === 'url' && !/^(https?:\/\/|mailto:|tel:|\/)/.test(value)) return 'Value must be a URL.';
  if (['json', 'weight', 'volume', 'dimension', 'money', 'rating'].includes(base)) { try { JSON.parse(value); } catch { return 'Value must be valid JSON.'; } }
  return null;
}

/** Typed value as exposed by `jsonValue`. */
export function jsonValue(m: Pick<Metafield, 'type' | 'value'>): unknown {
  const base = m.type.startsWith('list.') ? 'json' : m.type;
  try {
    if (base === 'number_integer') return Number(m.value);
    if (base === 'boolean') return m.value === 'true';
    if (['json', 'weight', 'volume', 'dimension', 'money', 'rating'].includes(base)) return JSON.parse(m.value);
  } catch { /* fall through */ }
  return m.value;
}

export interface MetafieldSetInput { ownerType: string; ownerId: number; namespace?: string | null; key: string; value: string; type?: string | null; compareDigest?: string | null }

async function ownerExists(db: Executor, shopId: number, ownerType: string, ownerId: number): Promise<boolean> {
  const t = OWNER_TABLES[ownerType as keyof typeof OWNER_TABLES] as typeof products | undefined;
  if (!t) return false;
  const where = ownerType === 'SHOP' ? eq(t.id, ownerId) : and(eq(t.shopId, shopId), eq(t.id, ownerId));
  const [r] = await db.select({ id: t.id }).from(t).where(where);
  return !!r;
}

/** Create or update metafields by (owner, namespace, key). All or nothing. Errors carry `field: ['metafields', index, ...]`. */
export async function setMetafields(db: Db, shopId: number, inputs: MetafieldSetInput[]): Promise<Result<Metafield[]>> {
  return txResult(db, (tx) => setMetafieldsTx(tx, shopId, inputs));
}

export async function setMetafieldsTx(tx: Executor, shopId: number, inputs: MetafieldSetInput[], fieldRoot = 'metafields'): Promise<Result<Metafield[]>> {
  const errors: UserError[] = [];
  const out: Metafield[] = [];
  if (inputs.length > 25) return { ok: false, errors: [{ field: [fieldRoot], message: 'Exceeded the maximum of 25 metafields per request.', code: 'INVALID' }] };
  for (const [i, m] of inputs.entries()) {
    const at = (f: string) => [fieldRoot, String(i), f];
    const namespace = (m.namespace ?? DEFAULT_NAMESPACE).trim();
    if (!/^[A-Za-z0-9_-]{3,255}$/.test(namespace)) { errors.push({ field: at('namespace'), message: 'Namespace is invalid (3-255 letters, digits, - and _).', code: 'INVALID' }); continue; }
    if (!/^[A-Za-z0-9_-]{2,64}$/.test(m.key)) { errors.push({ field: at('key'), message: 'Key is invalid (2-64 letters, digits, - and _).', code: 'INVALID' }); continue; }
    if (!(await ownerExists(tx, shopId, m.ownerType, m.ownerId))) { errors.push({ field: at('ownerId'), message: 'Owner does not exist.', code: 'INVALID' }); continue; }
    const [cur] = await tx.select().from(metafields).where(and(eq(metafields.shopId, shopId), eq(metafields.ownerType, m.ownerType), eq(metafields.ownerId, m.ownerId), eq(metafields.namespace, namespace), eq(metafields.key, m.key)));
    const type = m.type || cur?.type;
    if (!type) { errors.push({ field: at('type'), message: 'Type must be specified.', code: 'INVALID_TYPE' }); continue; }
    const bad = validateMetafieldValue(type, m.value);
    if (bad) { errors.push({ field: at('value'), message: bad, code: bad.startsWith('Type') ? 'INVALID_TYPE' : 'INVALID_VALUE' }); continue; }
    if (m.compareDigest && cur && m.compareDigest !== digest(cur)) { errors.push({ field: at('compareDigest'), message: 'The resource has been modified since the digest was computed.', code: 'STALE_OBJECT' }); continue; }
    const [row] = cur
      ? await tx.update(metafields).set({ type, value: m.value }).where(eq(metafields.id, cur.id)).returning()
      : await tx.insert(metafields).values({ shopId, ownerType: m.ownerType, ownerId: m.ownerId, namespace, key: m.key, type, value: m.value }).returning();
    out.push(row!);
  }
  if (errors.length) return { ok: false, errors };
  for (const m of out) await emit(tx, shopId, 'metafield', m.id, 'metafields/update', { ownerType: m.ownerType, ownerId: m.ownerId });
  return { ok: true, value: out };
}

export async function getMetafield(db: Executor, shopId: number, ownerType: string, ownerId: number, namespace: string | null | undefined, key: string): Promise<Metafield | null> {
  const [r] = await db.select().from(metafields).where(and(eq(metafields.shopId, shopId), eq(metafields.ownerType, ownerType), eq(metafields.ownerId, ownerId), eq(metafields.namespace, namespace ?? DEFAULT_NAMESPACE), eq(metafields.key, key)));
  return r ?? null;
}

export async function getMetafieldById(db: Executor, shopId: number, id: number): Promise<Metafield | null> {
  const [r] = await db.select().from(metafields).where(and(eq(metafields.shopId, shopId), eq(metafields.id, id)));
  return r ?? null;
}

export function listMetafields(db: Executor, shopId: number, ownerType: string, ownerId: number, o: { namespace?: string | null; keys?: string[] | null; reverse?: boolean; offset: number; limit: number }): Promise<Metafield[]> {
  return db.select().from(metafields).where(and(
    eq(metafields.shopId, shopId), eq(metafields.ownerType, ownerType), eq(metafields.ownerId, ownerId),
    o.namespace ? eq(metafields.namespace, o.namespace) : undefined,
    o.keys?.length ? inArray(metafields.key, o.keys) : undefined,
  )).orderBy(o.reverse ? desc(metafields.id) : asc(metafields.id)).limit(o.limit).offset(o.offset);
}

/** Remove all metafields of deleted owners. */
export async function deleteMetafieldsFor(db: Executor, shopId: number, ownerType: string, ownerIds: number[]): Promise<void> {
  if (!ownerIds.length) return;
  await db.delete(metafields).where(and(eq(metafields.shopId, shopId), eq(metafields.ownerType, ownerType), inArray(metafields.ownerId, ownerIds)));
}
