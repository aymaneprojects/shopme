import { and, asc, eq, inArray } from 'drizzle-orm';
import type { UserError } from '@shopme/shopify-compat';
import { collectionProducts, collections, productOptionValues, productOptions, productVariants, products } from '../../db/schema';
import type { Db } from '../../db/client';
import { emit, okR, txResult, type Result } from './common';
import { getCollection } from './collections';
import { getProduct, getProductOptions, getSelectedOptions } from './products';

const err = (field: string[] | null, message: string, code: string): UserError => ({ field, message, code });
const fail = (...errors: UserError[]): Result<never> => ({ ok: false, errors });

/** Move `item` to 0-based index `to` of `order` (clamped). */
function moveTo<T>(order: T[], item: T, to: number): void {
  order.splice(order.indexOf(item), 1);
  order.splice(Math.max(0, Math.min(to, order.length)), 0, item);
}

/**
 * `collectionReorderProducts`: moves are applied in order, each placing a product at a 0-based position. Only collections sorted
 * manually can be reordered (membership stays untouched).
 */
export async function reorderCollectionProducts(db: Db, shopId: number, collectionId: number, moves: { productId: number | null; newPosition: string }[]): Promise<Result<true>> {
  const c = await getCollection(db, shopId, collectionId);
  if (!c) return fail(err(['id'], 'Collection does not exist', 'COLLECTION_NOT_FOUND'));
  if (c.sortOrder !== 'MANUAL') return fail(err(['id'], 'The collection is not sorted manually', 'MANUALLY_SORTED_COLLECTION'));
  return txResult(db, async (tx) => {
    const rows = await tx.select({ productId: collectionProducts.productId }).from(collectionProducts).where(eq(collectionProducts.collectionId, collectionId)).orderBy(asc(collectionProducts.position), asc(collectionProducts.productId));
    const order = rows.map((r) => r.productId);
    const errors: UserError[] = [];
    for (const [i, m] of moves.entries()) {
      if (m.productId == null || !order.includes(m.productId)) errors.push(err(['moves', String(i), 'id'], 'The product is not in the collection', 'INVALID_MOVE'));
      if (!/^\d+$/.test(m.newPosition)) errors.push(err(['moves', String(i), 'newPosition'], 'Position must be a non-negative integer', 'INVALID_MOVE'));
    }
    if (errors.length) return { ok: false, errors };
    for (const m of moves) moveTo(order, m.productId!, Number(m.newPosition));
    for (const [position, productId] of order.entries()) {
      await tx.update(collectionProducts).set({ position }).where(and(eq(collectionProducts.collectionId, collectionId), eq(collectionProducts.productId, productId)));
    }
    await tx.update(collections).set({ updatedAt: new Date() }).where(eq(collections.id, collectionId));
    await emit(tx, shopId, 'collection', collectionId, 'collections/update', { reordered: true });
    return okR(true as const);
  });
}

/**
 * `productVariantsBulkReorder`: each entry gives the final 1-based position of a variant; the other variants keep their relative
 * order around them.
 */
export async function reorderVariants(db: Db, shopId: number, productId: number, positions: { variantId: number | null; position: number }[]): Promise<Result<true>> {
  if (!(await getProduct(db, shopId, productId))) return fail(err(['productId'], 'Product does not exist', 'PRODUCT_DOES_NOT_EXIST'));
  return txResult(db, async (tx) => {
    const rows = await tx.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.productId, productId)).orderBy(asc(productVariants.position), asc(productVariants.id));
    const all = rows.map((r) => r.id);
    const errors: UserError[] = [];
    const seen = new Set<number>();
    for (const [i, p] of positions.entries()) {
      if (p.variantId == null || !all.includes(p.variantId)) { errors.push(err(['positions', String(i), 'id'], 'Variant does not exist on the product', 'MISSING_VARIANT')); continue; }
      if (seen.has(p.variantId)) errors.push(err(['positions', String(i), 'id'], 'Variant is listed more than once', 'DUPLICATED_VARIANT_ID'));
      seen.add(p.variantId);
      if (!Number.isInteger(p.position) || p.position < 1) errors.push(err(['positions', String(i), 'position'], 'Position must be 1 or more', 'INVALID_POSITION'));
    }
    if (errors.length) return { ok: false, errors };
    const moved = [...positions].sort((a, b) => a.position - b.position);
    const order = all.filter((id) => !seen.has(id));
    for (const p of moved) order.splice(Math.min(p.position - 1, order.length), 0, p.variantId!);
    for (const [i, id] of order.entries()) await tx.update(productVariants).set({ position: i + 1 }).where(eq(productVariants.id, id));
    await tx.update(products).set({ updatedAt: new Date() }).where(eq(products.id, productId));
    await emit(tx, shopId, 'product', productId, 'products/update');
    return okR(true as const);
  });
}

export interface OptionReorder { id?: number | null; name?: string | null; values?: { id?: number | null; name?: string | null }[] | null }

/**
 * `productOptionsReorder`: options (and, per option, values) are identified by id or by name (not both); listed ones come first
 * in the given order, unlisted ones follow. Variant titles are rebuilt from the new option order.
 */
export async function reorderOptions(db: Db, shopId: number, productId: number, inputs: OptionReorder[]): Promise<Result<true>> {
  if (!(await getProduct(db, shopId, productId))) return fail(err(['productId'], 'Product does not exist', 'PRODUCT_DOES_NOT_EXIST'));
  return txResult(db, async (tx) => {
    const opts = await getProductOptions(tx, shopId, productId);
    const errors: UserError[] = [];
    const key = (x: { id?: number | null; name?: string | null }, at: string[], codes: { missing: string; byId: string; byName: string }) => {
      const hasId = x.id != null; const hasName = x.name != null && x.name !== '';
      if (hasId && hasName) { errors.push(err(at, 'Use either ids or names to identify options and values, not both', 'MIXING_ID_AND_NAME_KEYS_IS_NOT_ALLOWED')); return null; }
      if (!hasId && !hasName) { errors.push(err(at, 'An id or a name is required to reorder', codes.missing)); return null; }
      return hasId ? ({ by: 'id', v: x.id } as const) : ({ by: 'name', v: x.name!.trim().toLowerCase() } as const);
    };
    const orderedOpts: typeof opts = [];
    const valueOrders = new Map<number, number[]>();
    const kinds = new Set<string>();
    for (const [i, input] of inputs.entries()) {
      const at = ['options', String(i)];
      const k = key(input, at, { missing: 'NO_KEY_ON_REORDER', byId: '', byName: '' });
      if (!k) continue;
      kinds.add(k.by);
      const opt = opts.find((o) => (k.by === 'id' ? o.id === k.v : o.name.toLowerCase() === k.v));
      if (!opt) { errors.push(err([...at, k.by], k.by === 'id' ? 'Option id does not exist' : 'Option name does not exist', k.by === 'id' ? 'OPTION_ID_DOES_NOT_EXIST' : 'OPTION_NAME_DOES_NOT_EXIST')); continue; }
      if (orderedOpts.includes(opt)) { errors.push(err([...at, k.by], 'Option is listed more than once', 'DUPLICATED_OPTION_NAME')); continue; }
      orderedOpts.push(opt);
      if (input.values?.length) {
        const vOrder: number[] = [];
        for (const [j, v] of input.values.entries()) {
          const vat = [...at, 'values', String(j)];
          const vk = key(v, vat, { missing: 'MISSING_OPTION_VALUE', byId: '', byName: '' });
          if (!vk) continue;
          const val = opt.values.find((x) => (vk.by === 'id' ? x.id === vk.v : x.name.toLowerCase() === vk.v));
          if (!val) { errors.push(err([...vat, vk.by], vk.by === 'id' ? 'Option value id does not exist' : 'Option value name does not exist', vk.by === 'id' ? 'OPTION_VALUE_ID_DOES_NOT_EXIST' : 'OPTION_VALUE_DOES_NOT_EXIST')); continue; }
          if (vOrder.includes(val.id)) { errors.push(err(vat, 'Option value is listed more than once', 'DUPLICATED_OPTION_VALUE')); continue; }
          vOrder.push(val.id);
        }
        valueOrders.set(opt.id, vOrder);
      }
    }
    if (kinds.size > 1) errors.push(err(['options'], 'Use either ids or names to identify options and values, not both', 'MIXING_ID_AND_NAME_KEYS_IS_NOT_ALLOWED'));
    if (errors.length) return { ok: false, errors };

    const finalOpts = [...orderedOpts, ...opts.filter((o) => !orderedOpts.includes(o))];
    for (const [i, o] of finalOpts.entries()) {
      await tx.update(productOptions).set({ position: i + 1 }).where(eq(productOptions.id, o.id));
      const listed = valueOrders.get(o.id) ?? [];
      const finalValues = [...listed, ...o.values.map((v) => v.id).filter((id) => !listed.includes(id))];
      for (const [j, id] of finalValues.entries()) await tx.update(productOptionValues).set({ position: j + 1 }).where(eq(productOptionValues.id, id));
    }
    // Variant titles list the selected values in option order.
    const variants = await tx.select({ id: productVariants.id }).from(productVariants).where(and(eq(productVariants.productId, productId), inArray(productVariants.shopId, [shopId])));
    const selected = await getSelectedOptions(tx, shopId, variants.map((v) => v.id));
    for (const v of variants) {
      const names = (selected.get(v.id) ?? []).map((s) => s.value);
      if (names.length) await tx.update(productVariants).set({ title: names.join(' / ') }).where(eq(productVariants.id, v.id));
    }
    await tx.update(products).set({ updatedAt: new Date() }).where(eq(products.id, productId));
    await emit(tx, shopId, 'product', productId, 'products/update');
    return okR(true as const);
  });
}
