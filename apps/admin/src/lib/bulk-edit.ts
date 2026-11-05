import { parseDecimal, toDecimalString } from '../format';

/** One row of the bulk editor grid: a variant with the values as loaded. */
export interface BulkVariant {
  productId: string; variantId: string; inventoryItemId: string; tracked: boolean; stocked: boolean;
  sku: string; price: string; compareAtPrice: string; cost: string; quantity: string;
}
export type BulkField = 'sku' | 'price' | 'compareAtPrice' | 'cost' | 'quantity';
export const BULK_FIELDS: BulkField[] = ['sku', 'price', 'compareAtPrice', 'cost', 'quantity'];
/** Edits per variant id: only the fields that changed. */
export type BulkEdits = Record<string, Partial<Record<BulkField, string>>>;

export function isValid(field: BulkField, value: string): boolean {
  if (field === 'sku') return true;
  if (field === 'quantity') return /^\d+$/.test(value.trim());
  const n = parseDecimal(value);
  return field === 'price' ? n !== null && n >= 0 : value.trim() === '' || (n !== null && n >= 0);
}

/** Drop edits equal to the loaded value, so "dirty" means really changed. */
export function setEdit(edits: BulkEdits, rows: BulkVariant[], variantId: string, field: BulkField, value: string): BulkEdits {
  const row = rows.find((r) => r.variantId === variantId);
  const next = { ...edits, [variantId]: { ...edits[variantId], [field]: value } };
  if (row && row[field] === value) delete next[variantId]![field];
  if (!Object.keys(next[variantId]!).length) delete next[variantId];
  return next;
}

export const invalidCount = (edits: BulkEdits) => Object.values(edits).reduce((n, e) => n + (Object.entries(e) as Array<[BulkField, string]>).filter(([f, v]) => !isValid(f, v)).length, 0);

export interface BulkPlan {
  /** `productVariantsBulkUpdate` calls: variants per product. */
  variants: Array<{ productId: string; variants: Array<Record<string, unknown>> }>;
  /** `inventorySetQuantities` entries (available quantity at the chosen location). */
  quantities: Array<{ inventoryItemId: string; locationId: string; quantity: number }>;
}

/** Turn grid edits into API calls. Price and compare-at prices are normalised to two decimals; an empty compare-at price clears it. */
export function planBulk(rows: BulkVariant[], edits: BulkEdits, locationId: string): BulkPlan {
  const byProduct = new Map<string, Array<Record<string, unknown>>>();
  const quantities: BulkPlan['quantities'] = [];
  for (const [variantId, e] of Object.entries(edits)) {
    const row = rows.find((r) => r.variantId === variantId);
    if (!row) continue;
    const input: Record<string, unknown> = { id: variantId };
    if (e.price !== undefined) input.price = toDecimalString(parseDecimal(e.price)) ?? '0.00';
    if (e.compareAtPrice !== undefined) input.compareAtPrice = toDecimalString(parseDecimal(e.compareAtPrice));
    const item: Record<string, unknown> = {};
    if (e.sku !== undefined) item.sku = e.sku.trim() || null;
    if (e.cost !== undefined) item.cost = toDecimalString(parseDecimal(e.cost));
    if (Object.keys(item).length) input.inventoryItem = item;
    if (Object.keys(input).length > 1) byProduct.set(row.productId, [...(byProduct.get(row.productId) ?? []), input]);
    if (e.quantity !== undefined && row.tracked && row.stocked) quantities.push({ inventoryItemId: row.inventoryItemId, locationId, quantity: Number(e.quantity.trim()) });
  }
  return { variants: [...byProduct].map(([productId, variants]) => ({ productId, variants })), quantities };
}
