import { and, eq, inArray } from 'drizzle-orm';
import { collections, media, metaobjectReferences, metaobjects, pages, productVariants, products } from '../../db/schema';
import type { Executor } from '../../db/client';

/** GID type names accepted per reference field type. */
export const REFERENCE_GID_TYPES: Record<string, string[]> = {
  product_reference: ['Product'], variant_reference: ['ProductVariant'], collection_reference: ['Collection'], page_reference: ['Page', 'OnlineStorePage'],
  file_reference: ['MediaImage', 'GenericFile', 'Video', 'File'], metaobject_reference: ['Metaobject'], mixed_reference: ['Metaobject'], customer_reference: ['Customer'],
};

export const baseType = (type: string) => (type.startsWith('list.') ? type.slice(5) : type);
export const isListType = (type: string) => type.startsWith('list.');
export const isReferenceType = (type: string) => baseType(type) in REFERENCE_GID_TYPES;
export const isMetaobjectRefType = (type: string) => baseType(type) === 'metaobject_reference' || baseType(type) === 'mixed_reference';

/** Items of a stored value as plain strings (a list is a JSON array, everything else one item). */
export function itemsOf(type: string, value: string): string[] | null {
  if (!isListType(type)) return [value];
  try {
    const a = JSON.parse(value) as unknown;
    if (!Array.isArray(a)) return null;
    return a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
  } catch { return null; }
}

const lastId = (gid: string) => { const m = /\/(\d+)$/.exec(gid); return m ? Number(m[1]) : NaN; };

/** Definition ids a reference field is pinned to (`metaobject_definition_id`, `metaobject_definition_ids`). */
export function pinnedDefinitionIds(validations: { name: string; value: string }[]): number[] {
  const ids: number[] = [];
  const take = (s: string) => { const m = /(\d+)$/.exec(s.trim()); if (m) ids.push(Number(m[1])); };
  for (const v of validations) {
    if (v.name === 'metaobject_definition_id') take(v.value);
    if (v.name === 'metaobject_definition_ids') { try { for (const x of JSON.parse(v.value) as string[]) take(String(x)); } catch { take(v.value); } }
  }
  return ids;
}

/** Entry ids a value of a metaobject/mixed reference type points at. */
export function metaobjectTargets(type: string, value: string): number[] {
  if (!isMetaobjectRefType(type)) return [];
  return (itemsOf(type, value) ?? []).map(lastId).filter(Number.isSafeInteger);
}

/** Check that every referenced record exists (and, for metaobject references, belongs to a pinned definition). Returns a message or null. */
export async function checkReferenceTargets(db: Executor, shopId: number, type: string, value: string, validations: { name: string; value: string }[] = []): Promise<string | null> {
  const base = baseType(type);
  if (!(base in REFERENCE_GID_TYPES) || base === 'customer_reference') return null;
  const ids = [...new Set((itemsOf(type, value) ?? []).map(lastId).filter(Number.isSafeInteger))];
  if (!ids.length) return null;
  if (base === 'metaobject_reference' || base === 'mixed_reference') {
    const rows = await db.select({ id: metaobjects.id, definitionId: metaobjects.definitionId }).from(metaobjects).where(and(eq(metaobjects.shopId, shopId), inArray(metaobjects.id, ids)));
    if (rows.length !== ids.length) return 'Value references a record that does not exist.';
    const pins = pinnedDefinitionIds(validations);
    if (pins.length && rows.some((r) => !pins.includes(r.definitionId))) return 'Value references an entry of a definition that is not allowed for this field.';
    return null;
  }
  const table = { product_reference: products, variant_reference: productVariants, collection_reference: collections, page_reference: pages, file_reference: media }[base] as typeof products | undefined;
  if (!table) return null;
  const rows = await db.select({ id: table.id }).from(table).where(and(eq(table.shopId, shopId), inArray(table.id, ids)));
  if (rows.length !== ids.length) return 'Value references a record that does not exist.';
  return null;
}

/** Replace the reverse-index rows of one source (an entry or a metafield) with the given targets per field key. */
export async function syncReferences(db: Executor, shopId: number, sourceKind: 'METAOBJECT' | 'METAFIELD', sourceId: number, fields: { fieldKey: string; targetIds: number[] }[]): Promise<void> {
  await db.delete(metaobjectReferences).where(and(eq(metaobjectReferences.shopId, shopId), eq(metaobjectReferences.sourceKind, sourceKind), eq(metaobjectReferences.sourceId, sourceId)));
  const wanted = fields.flatMap((f) => [...new Set(f.targetIds)].map((targetId) => ({ fieldKey: f.fieldKey, targetId })));
  if (!wanted.length) return;
  const live = new Set((await db.select({ id: metaobjects.id }).from(metaobjects).where(and(eq(metaobjects.shopId, shopId), inArray(metaobjects.id, wanted.map((w) => w.targetId))))).map((r) => r.id));
  const rows = wanted.filter((w) => live.has(w.targetId)).map((w) => ({ shopId, sourceKind, sourceId, fieldKey: w.fieldKey, targetId: w.targetId }));
  if (rows.length) await db.insert(metaobjectReferences).values(rows);
}

/** Drop the reverse-index rows of metafields that were removed. */
export async function dropMetafieldReferences(db: Executor, shopId: number, metafieldIds: number[]): Promise<void> {
  if (!metafieldIds.length) return;
  await db.delete(metaobjectReferences).where(and(eq(metaobjectReferences.shopId, shopId), eq(metaobjectReferences.sourceKind, 'METAFIELD'), inArray(metaobjectReferences.sourceId, metafieldIds)));
}
