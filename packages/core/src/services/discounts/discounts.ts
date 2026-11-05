import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { discountCodes, discountExtensions, discounts, type BxgyConfig } from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { buildSearch, compare, dateCompare, idTerm, likeCi } from '../catalog/search';
import { errR, okR, txResult, type Result } from '../catalog/common';
import { addEvent } from '../events';

export type Discount = typeof discounts.$inferSelect;
export type DiscountCode = typeof discountCodes.$inferSelect;
export type DiscountExt = typeof discountExtensions.$inferSelect;
export type DiscountKind = 'CODE' | 'AUTOMATIC';
/** A discount: the row plus its redeem codes (code discounts have exactly one, automatic ones none) and its extension (subtype, combinations, BXGY). */
export type CodeDiscount = Discount & { codes: DiscountCode[]; ext: DiscountExt };
export type DiscountStatus = 'ACTIVE' | 'EXPIRED' | 'SCHEDULED';

/** Status as the API shows it: a deactivated discount reads EXPIRED, otherwise the dates decide. */
export function effectiveStatus(d: Pick<Discount, 'status' | 'startsAt' | 'endsAt'>, now = new Date()): DiscountStatus {
  if (d.status === 'DISABLED') return 'EXPIRED';
  if (d.startsAt && d.startsAt > now) return 'SCHEDULED';
  if (d.endsAt && d.endsAt < now) return 'EXPIRED';
  return 'ACTIVE';
}

async function withCodes(db: Executor, rows: Discount[]): Promise<CodeDiscount[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [codes, exts] = await Promise.all([
    db.select().from(discountCodes).where(inArray(discountCodes.discountId, ids)).orderBy(asc(discountCodes.id)),
    db.select().from(discountExtensions).where(inArray(discountExtensions.discountId, ids)),
  ]);
  return rows.map((r) => ({
    ...r, codes: codes.filter((c) => c.discountId === r.id),
    ext: exts.find((e) => e.discountId === r.id) ?? { discountId: r.id, shopId: r.shopId, subtype: r.target === 'SHIPPING' ? 'FREE_SHIPPING' : 'BASIC', combinesWith: { product: false, order: false, shipping: false }, bxgy: null },
  }));
}

/** One discount by id; `kind` null accepts both code and automatic discounts. */
export async function getCodeDiscount(db: Executor, shopId: number, id: number, kind: DiscountKind | null = 'CODE'): Promise<CodeDiscount | null> {
  const rows = await db.select().from(discounts).where(and(eq(discounts.shopId, shopId), eq(discounts.id, id), kind ? eq(discounts.kind, kind) : undefined)).limit(1);
  return (await withCodes(db, rows))[0] ?? null;
}

export async function getCodeDiscountByCode(db: Executor, shopId: number, code: string): Promise<CodeDiscount | null> {
  const [c] = await db.select().from(discountCodes).where(and(eq(discountCodes.shopId, shopId), eq(discountCodes.code, code.trim().toUpperCase())));
  return c ? getCodeDiscount(db, shopId, c.discountId) : null;
}

const search = (q: string | null | undefined) => buildSearch(q, {
  fields: {
    title: (_o, v) => likeCi(discounts.title, v),
    code: (_o, v) => sql`exists (select 1 from discount_codes c where c.discount_id = ${discounts.id} and c.code ilike ${v.replace(/\*/g, '%')})`,
    id: (_o, v) => idTerm(discounts.id, v),
    method: (_o, v) => sql`${discounts.kind} = ${v.toUpperCase()}`,
    status: (_o, v) => {
      const now = new Date().toISOString();
      switch (v.toLowerCase()) {
        case 'active': return sql`(${discounts.status} <> 'DISABLED' and (${discounts.startsAt} is null or ${discounts.startsAt} <= ${now}::timestamptz) and (${discounts.endsAt} is null or ${discounts.endsAt} >= ${now}::timestamptz))`;
        case 'scheduled': return sql`(${discounts.status} <> 'DISABLED' and ${discounts.startsAt} > ${now}::timestamptz)`;
        case 'expired': return sql`(${discounts.status} = 'DISABLED' or ${discounts.endsAt} < ${now}::timestamptz)`;
        default: return null;
      }
    },
    type: (_o, v) => {
      const t = v.toLowerCase();
      return t === 'free_shipping' ? sql`${discounts.target} = 'SHIPPING'` : t === 'percentage' ? sql`${discounts.valueType} = 'PERCENTAGE' and ${discounts.target} <> 'SHIPPING'`
        : t === 'fixed_amount' ? sql`${discounts.valueType} = 'FIXED_AMOUNT'` : null;
    },
    times_used: (op, v) => (Number.isFinite(Number(v)) ? compare(discounts.usageCount, op, Number(v)) : null),
    starts_at: (op, v) => dateCompare(discounts.startsAt, op, v),
    ends_at: (op, v) => dateCompare(discounts.endsAt, op, v),
    created_at: (op, v) => dateCompare(discounts.createdAt, op, v),
  },
  text: (v) => sql`(${likeCi(discounts.title, v)} or exists (select 1 from discount_codes c where c.discount_id = ${discounts.id} and c.code ilike ${`%${v}%`}))`,
});

export type DiscountSortKey = 'CREATED_AT' | 'ENDS_AT' | 'ID' | 'RELEVANCE' | 'STARTS_AT' | 'TITLE' | 'UPDATED_AT';

export async function listCodeDiscounts(db: Executor, shopId: number, o: { query?: string | null; sortKey?: DiscountSortKey; reverse?: boolean; offset: number; limit: number; kind?: DiscountKind | null }): Promise<CodeDiscount[]> {
  const col = { CREATED_AT: discounts.createdAt, ENDS_AT: discounts.endsAt, STARTS_AT: discounts.startsAt, TITLE: sql`lower(${discounts.title})`, UPDATED_AT: discounts.updatedAt }[o.sortKey as string] ?? discounts.id;
  const dir = o.reverse ? desc : asc;
  const rows = await db.select().from(discounts).where(and(eq(discounts.shopId, shopId), o.kind === null ? undefined : eq(discounts.kind, o.kind ?? 'CODE'), search(o.query))).orderBy(dir(col), dir(discounts.id)).limit(o.limit).offset(o.offset);
  return withCodes(db, rows);
}

export async function countCodeDiscounts(db: Executor, shopId: number, query?: string | null, limit = 10000, kind: DiscountKind | null = 'CODE'): Promise<{ count: number; precision: 'EXACT' | 'AT_LEAST' }> {
  const rows = await db.select({ id: discounts.id }).from(discounts).where(and(eq(discounts.shopId, shopId), kind ? eq(discounts.kind, kind) : undefined, search(query))).limit(limit + 1);
  return rows.length > limit ? { count: limit, precision: 'AT_LEAST' } : { count: rows.length, precision: 'EXACT' };
}

/** Normalised input of both code discount flavours (the API layer converts decimals and percentages to minor units / basis points). */
export interface CodeDiscountInput {
  title?: string | null;
  code?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  usageLimit?: number | null;
  oncePerCustomer?: boolean | null;
  valueType?: 'PERCENTAGE' | 'FIXED_AMOUNT';
  /** basis points for PERCENTAGE (10% = 1000), minor units for FIXED_AMOUNT */
  value?: number;
  target?: 'ORDER' | 'PRODUCTS' | 'SHIPPING';
  appliesTo?: { productIds?: number[]; collectionIds?: number[] };
  minimumSubtotal?: number | null;
  minimumQuantity?: number | null;
  /** AUTOMATIC discounts have no code and apply to every matching cart. Defaults to CODE. */
  kind?: DiscountKind;
  subtype?: 'BASIC' | 'FREE_SHIPPING' | 'BXGY';
  combinesWith?: { product?: boolean; order?: boolean; shipping?: boolean };
  /** Buy X get Y (subtype BXGY): the get effect is `valueType`/`value`. */
  bxgy?: BxgyConfig;
}

/** Field prefix for error paths (e.g. `basicCodeDiscount`). */
function validate(i: CodeDiscountInput, creating: boolean): Result<null> {
  const automatic = i.kind === 'AUTOMATIC';
  if (creating && !automatic && !i.code?.trim()) return errR(['code'], "Code can't be blank", 'BLANK');
  if (creating && automatic && !i.title?.trim()) return errR(['title'], "Title can't be blank", 'BLANK');
  if (i.bxgy) {
    const b = i.bxgy;
    if (!(b.buyQuantity >= 1)) return errR(['customerBuys', 'value', 'quantity'], 'Quantity must be greater than 0', 'GREATER_THAN');
    if (!(b.getQuantity >= 1)) return errR(['customerGets', 'value', 'discountOnQuantity', 'quantity'], 'Quantity must be greater than 0', 'GREATER_THAN');
    const empty = (s: BxgyConfig['buyAppliesTo']) => !(s.productIds?.length || s.collectionIds?.length);
    if (empty(b.buyAppliesTo)) return errR(['customerBuys', 'items'], 'Select at least one product or collection', 'APPLIES_ON_NOTHING');
    if (empty(b.getAppliesTo)) return errR(['customerGets', 'items'], 'Select at least one product or collection', 'APPLIES_ON_NOTHING');
    if (b.usesPerOrder != null && b.usesPerOrder < 1) return errR(['usesPerOrderLimit'], 'Must be greater than 0', 'GREATER_THAN');
  }
  if (i.code !== undefined && i.code !== null && /\s{2,}|[\r\n]/.test(i.code)) return errR(['code'], 'Code is invalid', 'INVALID');
  if (i.code && i.code.trim().length > 255) return errR(['code'], 'Code is too long (maximum is 255 characters)', 'TOO_LONG');
  if (i.title !== undefined && i.title !== null && !i.title.trim() && !i.code) return errR(['title'], "Title can't be blank", 'BLANK');
  if (i.startsAt && i.endsAt && i.endsAt <= i.startsAt) return errR(['endsAt'], 'Ends at needs to be after starts at', 'END_DATE_BEFORE_START_DATE');
  if (i.valueType === 'PERCENTAGE' && i.target !== 'SHIPPING' && (i.value == null || i.value <= 0 || i.value > 10000)) return errR(['customerGets', 'value', 'percentage'], 'Value must be between 0 and 1', 'VALUE_OUTSIDE_RANGE');
  if (i.valueType === 'FIXED_AMOUNT' && (i.value == null || i.value <= 0)) return errR(['customerGets', 'value', 'discountAmount', 'amount'], 'Value must be greater than 0', 'GREATER_THAN');
  if (i.minimumSubtotal != null && i.minimumQuantity != null) return errR(['minimumRequirement'], 'Minimum subtotal and minimum quantity cannot both be set', 'MINIMUM_SUBTOTAL_AND_QUANTITY_RANGE_BOTH_PRESENT');
  if (i.minimumSubtotal != null && i.minimumSubtotal < 0) return errR(['minimumRequirement', 'subtotal', 'greaterThanOrEqualToSubtotal'], 'Must be greater than or equal to 0', 'GREATER_THAN_OR_EQUAL_TO');
  if (i.usageLimit != null && i.usageLimit < 1) return errR(['usageLimit'], 'Usage limit must be greater than 0', 'GREATER_THAN');
  if (i.target === 'PRODUCTS' && !i.bxgy && !(i.appliesTo?.productIds?.length || i.appliesTo?.collectionIds?.length)) return errR(['customerGets', 'items'], 'Select at least one product or collection', 'APPLIES_ON_NOTHING');
  return okR(null);
}

export async function createCodeDiscount(db: Db, shopId: number, i: CodeDiscountInput, staffId?: number | null): Promise<Result<CodeDiscount>> {
  const v = validate(i, true);
  if (!v.ok) return v;
  const automatic = i.kind === 'AUTOMATIC';
  const code = automatic ? null : i.code!.trim().toUpperCase();
  if (code && (await db.select({ id: discountCodes.id }).from(discountCodes).where(and(eq(discountCodes.shopId, shopId), eq(discountCodes.code, code)))).length) return errR(['code'], 'Discount code must be unique. Please try a different code.', 'TAKEN');
  return txResult(db, async (tx) => {
    const [d] = await tx.insert(discounts).values({
      shopId, title: i.title?.trim() || i.code!.trim(), kind: automatic ? 'AUTOMATIC' : 'CODE', status: 'ACTIVE', valueType: i.valueType ?? 'PERCENTAGE', value: i.value ?? 0, target: i.target ?? 'ORDER',
      appliesTo: i.bxgy ? i.bxgy.buyAppliesTo : i.appliesTo ?? {}, minimumSubtotal: i.minimumSubtotal ?? null, minimumQuantity: i.minimumQuantity ?? null, usageLimit: i.usageLimit ?? null,
      oncePerCustomer: !!i.oncePerCustomer, startsAt: i.startsAt ?? new Date(), endsAt: i.endsAt ?? null,
    }).returning();
    if (code) await tx.insert(discountCodes).values({ shopId, discountId: d!.id, code });
    await tx.insert(discountExtensions).values({
      discountId: d!.id, shopId, subtype: i.subtype ?? (i.bxgy ? 'BXGY' : i.target === 'SHIPPING' ? 'FREE_SHIPPING' : 'BASIC'),
      combinesWith: { product: !!i.combinesWith?.product, order: !!i.combinesWith?.order, shipping: !!i.combinesWith?.shipping }, bxgy: i.bxgy ?? null,
    });
    await addEvent(tx, shopId, { subjectType: 'discount', subjectId: d!.id, verb: 'discounts/create', message: `Discount ${code ?? d!.title} was created`, authorStaffUserId: staffId });
    return okR((await getCodeDiscount(tx, shopId, d!.id, null))!);
  });
}

export async function updateCodeDiscount(db: Db, shopId: number, id: number, i: CodeDiscountInput, staffId?: number | null): Promise<Result<CodeDiscount>> {
  const cur = await getCodeDiscount(db, shopId, id, i.kind ?? 'CODE');
  if (!cur) return errR(['id'], 'Discount does not exist', 'INVALID');
  const merged = { ...i, startsAt: i.startsAt ?? cur.startsAt, endsAt: i.endsAt === undefined ? cur.endsAt : i.endsAt };
  const v = validate({ ...merged, valueType: i.valueType ?? cur.valueType as 'PERCENTAGE', value: i.value ?? cur.value, target: i.target ?? cur.target as 'ORDER', bxgy: i.bxgy ?? cur.ext.bxgy ?? undefined }, false);
  if (!v.ok) return v;
  const code = i.code?.trim().toUpperCase();
  if (code && code !== cur.codes[0]?.code) {
    if ((await db.select({ id: discountCodes.id }).from(discountCodes).where(and(eq(discountCodes.shopId, shopId), eq(discountCodes.code, code)))).length) return errR(['code'], 'Discount code must be unique. Please try a different code.', 'TAKEN');
  }
  return txResult(db, async (tx) => {
    await tx.update(discounts).set({
      ...(i.title?.trim() && { title: i.title.trim() }), ...(i.valueType && { valueType: i.valueType }), ...(i.value != null && { value: i.value }), ...(i.target && { target: i.target }),
      ...(i.bxgy ? { appliesTo: i.bxgy.buyAppliesTo } : i.appliesTo && { appliesTo: i.appliesTo }), ...(i.minimumSubtotal !== undefined && { minimumSubtotal: i.minimumSubtotal }), ...(i.minimumQuantity !== undefined && { minimumQuantity: i.minimumQuantity }),
      ...(i.usageLimit !== undefined && { usageLimit: i.usageLimit }), ...(i.oncePerCustomer != null && { oncePerCustomer: i.oncePerCustomer }),
      ...(i.startsAt && { startsAt: i.startsAt }), ...(i.endsAt !== undefined && { endsAt: i.endsAt }), updatedAt: new Date(),
    }).where(eq(discounts.id, id));
    if (code && cur.codes[0] && code !== cur.codes[0].code) await tx.update(discountCodes).set({ code }).where(eq(discountCodes.id, cur.codes[0].id));
    if (i.combinesWith || i.bxgy) {
      const combinesWith = { product: !!i.combinesWith?.product, order: !!i.combinesWith?.order, shipping: !!i.combinesWith?.shipping };
      await tx.insert(discountExtensions).values({ discountId: id, shopId, subtype: cur.ext.subtype, combinesWith: i.combinesWith ? combinesWith : cur.ext.combinesWith, bxgy: i.bxgy ?? cur.ext.bxgy })
        .onConflictDoUpdate({ target: discountExtensions.discountId, set: { ...(i.combinesWith && { combinesWith }), ...(i.bxgy && { bxgy: i.bxgy }) } });
    }
    await addEvent(tx, shopId, { subjectType: 'discount', subjectId: id, verb: 'discounts/update', message: 'Discount was updated', authorStaffUserId: staffId });
    return okR((await getCodeDiscount(tx, shopId, id, null))!);
  });
}

export async function setDiscountActive(db: Db, shopId: number, id: number, active: boolean): Promise<Result<CodeDiscount>> {
  if (!(await getCodeDiscount(db, shopId, id, null))) return errR(['id'], 'Discount does not exist', 'INVALID');
  await db.update(discounts).set({ status: active ? 'ACTIVE' : 'DISABLED', updatedAt: new Date() }).where(eq(discounts.id, id));
  await addEvent(db, shopId, { subjectType: 'discount', subjectId: id, verb: active ? 'discounts/activate' : 'discounts/deactivate', message: active ? 'Discount was activated' : 'Discount was deactivated' });
  return okR((await getCodeDiscount(db, shopId, id, null))!);
}

export async function deleteCodeDiscount(db: Db, shopId: number, id: number): Promise<Result<number>> {
  if (!(await getCodeDiscount(db, shopId, id, null))) return errR(['id'], 'Discount does not exist', 'INVALID');
  await db.delete(discounts).where(eq(discounts.id, id));
  return okR(id);
}
