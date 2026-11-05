import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import { inventoryItems, inventoryLevels, locations, productVariants, products } from '../../db/schema';
import type { Db } from '../../db/client';
import { defaultLocationId, getProductByHandle, getSelectedOptions, listVariants, setQuantities } from '../catalog';
import { csvLine } from '../csv';
import { lowerKeys, type CsvRow, type ImportEnv, type Reporter } from './common';

export const INVENTORY_COLUMNS = ['Handle', 'Title', 'Option1 Name', 'Option1 Value', 'Option2 Name', 'Option2 Value', 'Option3 Name', 'Option3 Value', 'SKU', 'Location', 'Available', 'On hand'];

/** Set stock levels. A row identifies a variant by SKU, or by Handle + option values; Location defaults to the first one. */
export async function importInventory(env: ImportEnv, rows: AsyncIterable<CsvRow>, rep: Reporter): Promise<void> {
  const { db, shopId } = env;
  const locs = await db.select().from(locations).where(and(eq(locations.shopId, shopId), eq(locations.isActive, true)));
  const defLoc = await defaultLocationId(db, shopId);
  let n = 0;
  for await (const { line, row } of rows) {
    n++;
    const r = lowerKeys(row);
    const fail = (m: string) => { rep.error(m, line); rep.count('failed'); };
    try {
      let variantId: number | undefined;
      if (r['sku']) {
        const found = await db.select({ id: productVariants.id }).from(productVariants).where(and(eq(productVariants.shopId, shopId), eq(productVariants.sku, r['sku'])));
        if (found.length > 1) { fail(`SKU "${r['sku']}" matches ${found.length} variants`); continue; }
        variantId = found[0]?.id;
      } else if (r['handle']) {
        const p = await getProductByHandle(db, shopId, r['handle']);
        if (p) {
          const vs = await listVariants(db, shopId, { productId: p.id, offset: 0, limit: 2048 });
          const sel = await getSelectedOptions(db, shopId, vs.map((v) => v.id));
          const want = [1, 2, 3].map((i) => r[`option${i} value`] ?? '').filter(Boolean).join('\u0001').toLowerCase();
          variantId = vs.find((v) => (vs.length === 1 && !want) || (sel.get(v.id) ?? []).map((s) => s.value).join('\u0001').toLowerCase() === want)?.id;
        }
      } else { fail('SKU or Handle is required'); continue; }
      if (!variantId) { fail(`No matching variant for ${r['sku'] ? `SKU "${r['sku']}"` : `handle "${r['handle']}"`}`); continue; }

      const loc = r['location'] ? locs.find((l) => l.name.toLowerCase() === r['location']!.toLowerCase())?.id : defLoc;
      if (!loc) { fail(r['location'] ? `Unknown location "${r['location']}"` : 'No location configured'); continue; }
      const name = r['available'] !== undefined && r['available'] !== '' ? 'available' : r['on hand'] ? 'on_hand' : null;
      const raw = name === 'available' ? r['available']! : r['on hand'];
      const qty = Number(raw);
      if (!name || !Number.isInteger(qty) || qty < 0) { fail(`Available / On hand must be a non-negative integer (got "${raw ?? ''}")`); continue; }
      const [item] = await db.select({ id: inventoryItems.id }).from(inventoryItems).where(eq(inventoryItems.variantId, variantId));
      if (!item) { fail('Variant has no inventory item'); continue; }
      if (env.dryRun) { rep.count('updated'); continue; }
      const res = await setQuantities(db, shopId, { name, reason: 'correction', referenceDocumentUri: 'shopme://csv-import', quantities: [{ inventoryItemId: item.id, locationId: loc, quantity: qty }] });
      if (res.ok) { rep.count('updated'); await db.update(inventoryItems).set({ tracked: true }).where(eq(inventoryItems.id, item.id)); }
      else fail(res.errors[0]?.message ?? 'Could not set quantity');
    } catch (e) { fail(e instanceof Error ? e.message : String(e)); }
    await rep.progress(n, null, 'inventory');
  }
}

/** One row per variant and active location. */
export async function* exportInventory(db: Db, shopId: number): AsyncGenerator<string> {
  yield csvLine(INVENTORY_COLUMNS);
  const locs = new Map((await db.select().from(locations).where(eq(locations.shopId, shopId))).map((l) => [l.id, l.name]));
  let after = 0;
  for (;;) {
    const batch = await db.select().from(products).where(and(eq(products.shopId, shopId), gt(products.id, after))).orderBy(asc(products.id)).limit(100);
    if (!batch.length) return;
    after = batch.at(-1)!.id;
    const variants = await db.select().from(productVariants).where(inArray(productVariants.productId, batch.map((p) => p.id))).orderBy(asc(productVariants.productId), asc(productVariants.position));
    const ids = variants.map((v) => v.id);
    const [sel, items] = await Promise.all([getSelectedOptions(db, shopId, ids), ids.length ? db.select().from(inventoryItems).where(inArray(inventoryItems.variantId, ids)) : []]);
    const levels = items.length ? await db.select().from(inventoryLevels).where(and(inArray(inventoryLevels.inventoryItemId, items.map((i) => i.id)), eq(inventoryLevels.isActive, true))).orderBy(asc(inventoryLevels.id)) : [];
    const productOf = new Map(batch.map((p) => [p.id, p]));
    for (const v of variants) {
      const item = items.find((i) => i.variantId === v.id);
      const p = productOf.get(v.productId)!;
      const o = sel.get(v.id) ?? [];
      const cells = [0, 1, 2].flatMap((n) => [o[n]?.name ?? '', o[n]?.value ?? '']);
      const ls = item ? levels.filter((l) => l.inventoryItemId === item.id) : [];
      for (const l of ls.length ? ls : [null]) yield csvLine([p.handle, p.title, ...cells, item?.sku ?? v.sku ?? '', l ? locs.get(l.locationId) ?? '' : '', l?.available ?? '', l?.onHand ?? '']);
    }
  }
}
