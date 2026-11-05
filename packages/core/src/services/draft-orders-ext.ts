import { randomUUID, createHash } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { draftOrders, type DraftAddress } from '../db/schema';
import type { Db, Executor } from '../db/client';
import { errR, normalizeTags, okR, type Result } from './catalog/common';
import { addEvent } from './events';
import { randomToken } from './crypto';
import { nextSequence } from './sequences';
import type { Shop } from './shops';
import { createDraftOrder, draftSearch, getDraftOrder, type DraftInput, type DraftOrder } from './draft-orders';
import { getOrderSummary } from './orders/create';

/** `draftOrderDuplicate`: same lines, customer, addresses, discount and tags as a fresh OPEN draft with a new name and invoice token. */
export async function duplicateDraftOrder(db: Db, shop: Shop, id: number, staffId?: number | null): Promise<Result<DraftOrder>> {
  const cur = await getDraftOrder(db, shop.id, id);
  if (!cur) return errR(['id'], 'Draft order does not exist', 'NOT_FOUND');
  const uuids = new Map(cur.lines.map((l) => [l.uuid, randomUUID()]));
  const row = await db.transaction(async (tx) => {
    const n = await nextSequence(tx, shop.id, 'draft_order', 1);
    const { id: _id, name: _n, token: _t, createdAt: _c, updatedAt: _u, ...rest } = cur;
    const [r] = await tx.insert(draftOrders).values({
      ...rest, name: `#D${n}`, token: randomToken(24), status: 'OPEN', invoiceSentAt: null, completedAt: null, orderId: null,
      lines: cur.lines.map((l) => ({ ...l, uuid: uuids.get(l.uuid)! })),
      calc: cur.calc ? { ...cur.calc, lines: cur.calc.lines.map((l) => ({ ...l, uuid: uuids.get(l.uuid) ?? l.uuid })) } : null,
    }).returning();
    await addEvent(tx, shop.id, { subjectType: 'draft_order', subjectId: r!.id, verb: 'draft_orders/create', message: `Draft order ${r!.name} was duplicated from ${cur.name}`, authorStaffUserId: staffId });
    return r!;
  });
  return okR(row);
}

const ADDRESS_KEYS = ['firstName', 'lastName', 'company', 'address1', 'address2', 'city', 'province', 'provinceCode', 'zip', 'country', 'countryCode', 'phone'] as const;

/** `draftOrderCreateFromOrder`: a new draft with the lines (current quantities), customer, addresses, note and tags of an order. */
export async function createDraftFromOrder(db: Db, shop: Shop, orderId: number, staffId?: number | null): Promise<Result<DraftOrder>> {
  const o = await getOrderSummary(db, shop.id, orderId);
  if (!o) return errR(['orderId'], 'Order does not exist', 'NOT_FOUND');
  const lines = o.lines.filter((l) => l.currentQuantity > 0);
  if (!lines.length) return errR(['orderId'], 'The order has no remaining line items', 'INVALID');
  const address = (a: typeof o.shippingAddress): DraftAddress | null => (a ? Object.fromEntries(ADDRESS_KEYS.map((k) => [k, (a as Record<string, unknown>)[k] as string | null ?? null])) : null);
  const input: DraftInput = {
    email: o.order.email, phone: o.order.phone, note: o.order.note, tags: o.order.tags, customerId: o.order.customerId, taxExempt: false,
    shippingAddress: address(o.shippingAddress), billingAddress: address(o.billingAddress),
    lines: lines.map((l) => ({
      // A product that was deleted since becomes a custom item at the price paid.
      variantId: l.variantId, title: l.title, originalUnitPrice: l.unitPrice, quantity: l.currentQuantity, sku: l.sku, taxable: l.taxable, requiresShipping: l.requiresShipping, grams: l.weightGrams, properties: l.properties,
    })),
  };
  const first = await createDraftOrder(db, shop, input, staffId);
  if (first.ok || !lines.some((l) => l.variantId)) return first;
  // Variants that no longer exist: retry with every line as a custom item.
  return createDraftOrder(db, shop, { ...input, lines: input.lines!.map((l) => ({ ...l, variantId: null })) }, staffId);
}

/** Add or remove tags of one draft. */
export async function changeDraftTags(db: Executor, shopId: number, id: number, mode: 'add' | 'remove', tags: string[]): Promise<Result<DraftOrder>> {
  const cur = await getDraftOrder(db, shopId, id);
  if (!cur) return errR(['id'], 'Draft order does not exist', 'NOT_FOUND');
  const wanted = normalizeTags(tags);
  const next = mode === 'add' ? normalizeTags([...cur.tags, ...wanted]) : cur.tags.filter((t) => !wanted.some((w) => w.toLowerCase() === t.toLowerCase()));
  const [row] = await db.update(draftOrders).set({ tags: next, updatedAt: new Date() }).where(eq(draftOrders.id, id)).returning();
  await addEvent(db, shopId, { subjectType: 'draft_order', subjectId: id, verb: 'draft_orders/update', message: `Draft order ${cur.name} tags were ${mode === 'add' ? 'added' : 'removed'}` });
  return okR(row!);
}

/** Ids of drafts in `ids` (when given) matching the search `query` (when given), ascending. */
export async function matchingDraftIds(db: Executor, shopId: number, o: { ids?: number[]; query?: string | null }): Promise<number[]> {
  const rows = await db.select({ id: draftOrders.id }).from(draftOrders)
    .where(and(eq(draftOrders.shopId, shopId), o.ids ? inArray(draftOrders.id, o.ids) : undefined, draftSearch(o.query))).orderBy(asc(draftOrders.id));
  return rows.map((r) => r.id);
}

export interface DraftTag { id: number; title: string; handle: string }
const tagHandle = (t: string) => t.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
/** Tags have no table: the id is a stable 48 bit hash of the lower-cased title. */
const tagId = (t: string) => Number.parseInt(createHash('sha1').update(t.toLowerCase()).digest('hex').slice(0, 12), 16);

export async function listDraftTags(db: Executor, shopId: number): Promise<DraftTag[]> {
  const rows = await db.execute(sql`select distinct t as tag from draft_orders d, unnest(d.tags) t where d.shop_id = ${shopId} order by 1`);
  const list = (rows as { rows?: { tag: string }[] }).rows ?? (rows as unknown as { tag: string }[]);
  const seen = new Map<string, DraftTag>();
  for (const r of list) if (!seen.has(r.tag.toLowerCase())) seen.set(r.tag.toLowerCase(), { id: tagId(r.tag), title: r.tag, handle: tagHandle(r.tag) });
  return [...seen.values()];
}
export const getDraftTag = async (db: Executor, shopId: number, id: number) => (await listDraftTags(db, shopId)).find((t) => t.id === id) ?? null;
