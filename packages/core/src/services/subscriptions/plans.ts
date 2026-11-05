import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db, Executor } from '../../db/client';
import {
  PRICING_ADJUSTMENT_TYPES, SELLING_PLAN_CATEGORIES, SELLING_PLAN_INTERVALS, productVariants, products, sellingPlanGroupProducts, sellingPlanGroupVariants, sellingPlanGroups, sellingPlans,
  type PlanBillingPolicy, type PlanDeliveryPolicy, type PlanPricingPolicy,
} from '../../db/schema';
import { buildSearch, idTerm, likeCi } from '../catalog/search';
import { errR, okR, txResult, type Result } from '../catalog/common';
import { addEvent } from '../events';

export type SellingPlanGroup = typeof sellingPlanGroups.$inferSelect;
export type SellingPlan = typeof sellingPlans.$inferSelect;

export interface SellingPlanInput {
  id?: number | null;
  name?: string | null; description?: string | null; options?: string[] | null; position?: number | null; category?: string | null;
  billingPolicy?: PlanBillingPolicy | null; deliveryPolicy?: PlanDeliveryPolicy | null; pricingPolicies?: PlanPricingPolicy[] | null;
}
export interface SellingPlanGroupInput {
  name?: string | null; merchantCode?: string | null; description?: string | null; options?: string[] | null; position?: number | null; appId?: string | null;
  plansToCreate?: SellingPlanInput[] | null; plansToUpdate?: SellingPlanInput[] | null; plansToDelete?: number[] | null;
}

const MAX_PLANS = 31;
const isInterval = (v: unknown): v is PlanBillingPolicy['interval'] => (SELLING_PLAN_INTERVALS as readonly string[]).includes(String(v));
const posInt = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 1;

// ---------------------------------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------------------------------

export async function getSellingPlanGroup(db: Executor, shopId: number, id: number): Promise<SellingPlanGroup | null> {
  const [r] = await db.select().from(sellingPlanGroups).where(and(eq(sellingPlanGroups.shopId, shopId), eq(sellingPlanGroups.id, id))).limit(1);
  return r ?? null;
}

export async function getSellingPlanGroups(db: Executor, shopId: number, ids: number[]): Promise<SellingPlanGroup[]> {
  if (!ids.length) return [];
  return db.select().from(sellingPlanGroups).where(and(eq(sellingPlanGroups.shopId, shopId), inArray(sellingPlanGroups.id, ids)))
    .orderBy(sql`${sellingPlanGroups.position} asc nulls last`, asc(sellingPlanGroups.id));
}

export async function getSellingPlan(db: Executor, shopId: number, id: number): Promise<SellingPlan | null> {
  const [r] = await db.select().from(sellingPlans).where(and(eq(sellingPlans.shopId, shopId), eq(sellingPlans.id, id))).limit(1);
  return r ?? null;
}

/** Plans of the given groups, in display order. */
export async function listSellingPlans(db: Executor, shopId: number, groupIds: number[]): Promise<SellingPlan[]> {
  if (!groupIds.length) return [];
  return db.select().from(sellingPlans).where(and(eq(sellingPlans.shopId, shopId), inArray(sellingPlans.groupId, groupIds)))
    .orderBy(asc(sellingPlans.groupId), sql`${sellingPlans.position} asc nulls last`, asc(sellingPlans.id));
}

const search = (q: string | null | undefined) => buildSearch(q, {
  fields: {
    id: (_o, v) => idTerm(sellingPlanGroups.id, v),
    name: (_o, v) => likeCi(sellingPlanGroups.name, v),
    merchant_code: (_o, v) => likeCi(sellingPlanGroups.merchantCode, v),
    product_id: (_o, v) => (/^\d+$/.test(v.split('/').pop()!) ? sql`exists (select 1 from selling_plan_group_products p where p.group_id = ${sellingPlanGroups.id} and p.product_id = ${Number(v.split('/').pop())})` : null),
  },
  text: (v) => sql`(${likeCi(sellingPlanGroups.name, v)} or ${likeCi(sellingPlanGroups.merchantCode, v)})`,
});

export async function listSellingPlanGroups(db: Executor, shopId: number, o: { query?: string | null; sortKey?: 'ID' | 'NAME' | 'CREATED_AT' | 'UPDATED_AT'; reverse?: boolean; offset: number; limit: number }): Promise<SellingPlanGroup[]> {
  const col = { NAME: sql`lower(${sellingPlanGroups.name})`, CREATED_AT: sellingPlanGroups.createdAt, UPDATED_AT: sellingPlanGroups.updatedAt }[o.sortKey as string] ?? sellingPlanGroups.id;
  const dir = o.reverse ? desc : asc;
  return db.select().from(sellingPlanGroups).where(and(eq(sellingPlanGroups.shopId, shopId), search(o.query))).orderBy(dir(col as never), dir(sellingPlanGroups.id)).limit(o.limit).offset(o.offset);
}

export async function countSellingPlanGroups(db: Executor, shopId: number, query?: string | null): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(sellingPlanGroups).where(and(eq(sellingPlanGroups.shopId, shopId), search(query)));
  return r?.n ?? 0;
}

/** Products directly attached to a group. */
export async function groupProductIds(db: Executor, shopId: number, groupId: number): Promise<number[]> {
  return (await db.select({ id: sellingPlanGroupProducts.productId }).from(sellingPlanGroupProducts)
    .where(and(eq(sellingPlanGroupProducts.shopId, shopId), eq(sellingPlanGroupProducts.groupId, groupId))).orderBy(asc(sellingPlanGroupProducts.productId))).map((r) => r.id);
}

/** Variants directly attached to a group. */
export async function groupVariantIds(db: Executor, shopId: number, groupId: number): Promise<number[]> {
  return (await db.select({ id: sellingPlanGroupVariants.variantId }).from(sellingPlanGroupVariants)
    .where(and(eq(sellingPlanGroupVariants.shopId, shopId), eq(sellingPlanGroupVariants.groupId, groupId))).orderBy(asc(sellingPlanGroupVariants.variantId))).map((r) => r.id);
}

/**
 * Groups of each product: attached to the product itself or to one of its variants. Also returns, per group and product, the
 * variants that offer it (all of them for product-level groups).
 */
export async function groupsForProducts(db: Executor, shopId: number, productIds: number[]): Promise<Map<number, { groupId: number; variantIds: number[] | 'all' }[]>> {
  const out = new Map<number, { groupId: number; variantIds: number[] | 'all' }[]>();
  if (!productIds.length) return out;
  const [direct, viaVariants] = await Promise.all([
    db.select({ groupId: sellingPlanGroupProducts.groupId, productId: sellingPlanGroupProducts.productId }).from(sellingPlanGroupProducts)
      .where(and(eq(sellingPlanGroupProducts.shopId, shopId), inArray(sellingPlanGroupProducts.productId, productIds))),
    db.select({ groupId: sellingPlanGroupVariants.groupId, variantId: sellingPlanGroupVariants.variantId, productId: productVariants.productId }).from(sellingPlanGroupVariants)
      .innerJoin(productVariants, eq(productVariants.id, sellingPlanGroupVariants.variantId))
      .where(and(eq(sellingPlanGroupVariants.shopId, shopId), inArray(productVariants.productId, productIds))),
  ]);
  for (const d of direct) out.set(d.productId, [...(out.get(d.productId) ?? []), { groupId: d.groupId, variantIds: 'all' }]);
  for (const v of viaVariants) {
    const list = out.get(v.productId) ?? [];
    const g = list.find((x) => x.groupId === v.groupId);
    if (!g) list.push({ groupId: v.groupId, variantIds: [v.variantId] });
    else if (g.variantIds !== 'all') g.variantIds.push(v.variantId);
    out.set(v.productId, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.groupId - b.groupId);
  return out;
}

/** Group ids that apply to each variant (through its product or directly). */
export async function groupsForVariants(db: Executor, shopId: number, variantIds: number[]): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>();
  if (!variantIds.length) return out;
  const rows = await db.select({ id: productVariants.id, productId: productVariants.productId }).from(productVariants).where(and(eq(productVariants.shopId, shopId), inArray(productVariants.id, variantIds)));
  const byProduct = await groupsForProducts(db, shopId, [...new Set(rows.map((r) => r.productId))]);
  for (const r of rows) out.set(r.id, (byProduct.get(r.productId) ?? []).filter((g) => g.variantIds === 'all' || g.variantIds.includes(r.id)).map((g) => g.groupId));
  return out;
}

/** The plan when it can be bought with this variant (its group is attached to the variant or its product), else null. */
export async function sellingPlanForVariant(db: Executor, shopId: number, planId: number, variantId: number): Promise<SellingPlan | null> {
  const plan = await getSellingPlan(db, shopId, planId);
  if (!plan) return null;
  const groups = (await groupsForVariants(db, shopId, [variantId])).get(variantId) ?? [];
  return groups.includes(plan.groupId) ? plan : null;
}

/** Products that only sell with a purchase option. */
export async function productsRequiringPlan(db: Executor, shopId: number, productIds: number[]): Promise<Set<number>> {
  if (!productIds.length) return new Set();
  const rows = await db.select({ id: products.id }).from(products).where(and(eq(products.shopId, shopId), inArray(products.id, productIds), eq(products.requiresSellingPlan, true)));
  return new Set(rows.map((r) => r.id));
}

// ---------------------------------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------------------------------

function validatePlan(p: SellingPlanInput, path: string[], creating: boolean): Result<null> {
  if (creating && !p.name?.trim()) return errR([...path, 'name'], "Name can't be blank", 'BLANK');
  if (p.name != null && p.name.trim().length > 255) return errR([...path, 'name'], 'Name is too long (maximum is 255 characters)', 'TOO_LONG');
  if (p.category != null && !(SELLING_PLAN_CATEGORIES as readonly string[]).includes(p.category)) return errR([...path, 'category'], 'Category is invalid', 'INVALID');
  if (creating && !p.billingPolicy) return errR([...path, 'billingPolicy'], 'A billing policy is required', 'BLANK');
  if (creating && !p.deliveryPolicy) return errR([...path, 'deliveryPolicy'], 'A delivery policy is required', 'BLANK');
  const b = p.billingPolicy;
  if (b) {
    if (!isInterval(b.interval)) return errR([...path, 'billingPolicy', 'recurring', 'interval'], 'Interval is invalid', 'INVALID');
    if (!posInt(b.intervalCount) || b.intervalCount > 365) return errR([...path, 'billingPolicy', 'recurring', 'intervalCount'], 'Interval count must be between 1 and 365', 'BILLING_POLICY_INTERVAL_TOO_LARGE');
    if (b.minCycles != null && !posInt(b.minCycles)) return errR([...path, 'billingPolicy', 'recurring', 'minCycles'], 'Minimum cycles must be greater than 0', 'GREATER_THAN');
    if (b.maxCycles != null && !posInt(b.maxCycles)) return errR([...path, 'billingPolicy', 'recurring', 'maxCycles'], 'Maximum cycles must be greater than 0', 'GREATER_THAN');
    if (b.minCycles != null && b.maxCycles != null && b.maxCycles < b.minCycles) return errR([...path, 'billingPolicy', 'recurring', 'maxCycles'], 'Maximum cycles must be greater than or equal to minimum cycles', 'SELLING_PLAN_MAX_CYCLES_MUST_BE_GREATER_THAN_MIN_CYCLES');
  }
  const d = p.deliveryPolicy;
  if (d) {
    if (!isInterval(d.interval)) return errR([...path, 'deliveryPolicy', 'recurring', 'interval'], 'Interval is invalid', 'INVALID');
    if (!posInt(d.intervalCount) || d.intervalCount > 365) return errR([...path, 'deliveryPolicy', 'recurring', 'intervalCount'], 'Interval count must be between 1 and 365', 'DELIVERY_POLICY_INTERVAL_TOO_LARGE');
  }
  const pp = p.pricingPolicies;
  if (pp) {
    if (pp.length > 2) return errR([...path, 'pricingPolicies'], 'A plan can have at most 2 pricing policies', 'SELLING_PLAN_PRICING_POLICIES_LIMIT');
    for (const [i, x] of pp.entries()) {
      const at = [...path, 'pricingPolicies', String(i)];
      if (!(PRICING_ADJUSTMENT_TYPES as readonly string[]).includes(x.adjustmentType)) return errR([...at, 'adjustmentType'], 'Adjustment type is invalid', 'INVALID');
      if (!Number.isFinite(x.adjustmentValue) || x.adjustmentValue < 0) return errR([...at, 'adjustmentValue'], 'Adjustment value must be greater than or equal to 0', 'GREATER_THAN_OR_EQUAL_TO');
      if (x.adjustmentType === 'PERCENTAGE' && x.adjustmentValue > 100) return errR([...at, 'adjustmentValue', 'percentage'], 'Percentage must be between 0 and 100', 'INVALID');
      if (!Number.isInteger(x.afterCycle) || x.afterCycle < 0) return errR([...at, 'afterCycle'], 'After cycle must be 0 or more', 'GREATER_THAN_OR_EQUAL_TO');
    }
    if (pp.length === 2 && pp[0]!.afterCycle === pp[1]!.afterCycle) return errR([...path, 'pricingPolicies'], 'Pricing policies must start at different cycles', 'SELLING_PLAN_DUPLICATE_PRICING_POLICY');
  }
  return okR(null);
}

function validateGroup(i: SellingPlanGroupInput, creating: boolean): Result<null> {
  if (creating && !i.name?.trim()) return errR(['input', 'name'], "Name can't be blank", 'BLANK');
  if (i.name != null && !i.name.trim()) return errR(['input', 'name'], "Name can't be blank", 'BLANK');
  if (i.name && i.name.trim().length > 255) return errR(['input', 'name'], 'Name is too long (maximum is 255 characters)', 'TOO_LONG');
  if (i.merchantCode && i.merchantCode.trim().length > 255) return errR(['input', 'merchantCode'], 'Merchant code is too long (maximum is 255 characters)', 'TOO_LONG');
  for (const [k, p] of (i.plansToCreate ?? []).entries()) { const v = validatePlan(p, ['input', 'sellingPlansToCreate', String(k)], true); if (!v.ok) return v; }
  for (const [k, p] of (i.plansToUpdate ?? []).entries()) {
    if (!p.id) return errR(['input', 'sellingPlansToUpdate', String(k), 'id'], 'Selling plan does not exist', 'SELLING_PLAN_DOES_NOT_EXIST');
    const v = validatePlan(p, ['input', 'sellingPlansToUpdate', String(k)], false); if (!v.ok) return v;
  }
  return okR(null);
}

const cleanList = (xs: string[] | null | undefined) => (xs ?? []).map((x) => x.trim()).filter(Boolean).slice(0, 3);
const planRow = (shopId: number, groupId: number, p: SellingPlanInput, position: number) => ({
  shopId, groupId, name: p.name!.trim(), description: p.description?.trim() || null, options: cleanList(p.options).length ? cleanList(p.options) : [p.name!.trim()], position: p.position ?? position,
  category: p.category ?? 'SUBSCRIPTION', billingPolicy: normBilling(p.billingPolicy!), deliveryPolicy: normDelivery(p.deliveryPolicy!), pricingPolicies: normPricing(p.pricingPolicies ?? []),
});
const normBilling = (b: PlanBillingPolicy): PlanBillingPolicy => ({ interval: b.interval, intervalCount: b.intervalCount, minCycles: b.minCycles ?? null, maxCycles: b.maxCycles ?? null });
const normDelivery = (d: PlanDeliveryPolicy): PlanDeliveryPolicy => ({ interval: d.interval, intervalCount: d.intervalCount });
const normPricing = (pp: PlanPricingPolicy[]): PlanPricingPolicy[] => pp.map((p) => ({ adjustmentType: p.adjustmentType, adjustmentValue: p.adjustmentValue, afterCycle: p.afterCycle ?? 0 })).sort((a, b) => a.afterCycle - b.afterCycle);

// ---------------------------------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------------------------------

async function checkResources(db: Executor, shopId: number, productIds: number[], variantIds: number[], path: string[]): Promise<Result<null>> {
  if (productIds.length) {
    const found = await db.select({ id: products.id }).from(products).where(and(eq(products.shopId, shopId), inArray(products.id, productIds)));
    if (found.length !== new Set(productIds).size) return errR([...path, 'productIds'], 'Product does not exist', 'PRODUCT_DOES_NOT_EXIST');
  }
  if (variantIds.length) {
    const found = await db.select({ id: productVariants.id }).from(productVariants).where(and(eq(productVariants.shopId, shopId), inArray(productVariants.id, variantIds)));
    if (found.length !== new Set(variantIds).size) return errR([...path, 'productVariantIds'], 'Product variant does not exist', 'PRODUCT_VARIANT_DOES_NOT_EXIST');
  }
  return okR(null);
}

async function link(tx: Executor, shopId: number, groupId: number, productIds: number[], variantIds: number[]) {
  if (productIds.length) await tx.insert(sellingPlanGroupProducts).values([...new Set(productIds)].map((productId) => ({ shopId, groupId, productId }))).onConflictDoNothing();
  if (variantIds.length) await tx.insert(sellingPlanGroupVariants).values([...new Set(variantIds)].map((variantId) => ({ shopId, groupId, variantId }))).onConflictDoNothing();
}

export async function createSellingPlanGroup(db: Db, shopId: number, input: SellingPlanGroupInput, resources: { productIds?: number[]; variantIds?: number[] } = {}, staffId?: number | null): Promise<Result<SellingPlanGroup>> {
  const v = validateGroup(input, true);
  if (!v.ok) return v;
  if ((input.plansToCreate ?? []).length > MAX_PLANS) return errR(['input', 'sellingPlansToCreate'], `A group can have at most ${MAX_PLANS} plans`, 'TOO_LONG');
  const r = await checkResources(db, shopId, resources.productIds ?? [], resources.variantIds ?? [], ['resources']);
  if (!r.ok) return r;
  return txResult(db, async (tx) => {
    const plans = input.plansToCreate ?? [];
    const [g] = await tx.insert(sellingPlanGroups).values({
      shopId, name: input.name!.trim(), merchantCode: input.merchantCode?.trim() || input.name!.trim(), description: input.description?.trim() || null,
      options: cleanList(input.options).length ? cleanList(input.options) : ['Delivery every'], position: input.position ?? null, appId: input.appId ?? null,
    }).returning();
    if (plans.length) await tx.insert(sellingPlans).values(plans.map((p, i) => planRow(shopId, g!.id, p, i + 1)));
    await link(tx, shopId, g!.id, resources.productIds ?? [], resources.variantIds ?? []);
    await addEvent(tx, shopId, { subjectType: 'selling_plan_group', subjectId: g!.id, verb: 'selling_plan_groups/create', message: `Purchase option ${g!.name} was created`, authorStaffUserId: staffId });
    return okR(g!);
  });
}

export async function updateSellingPlanGroup(db: Db, shopId: number, id: number, input: SellingPlanGroupInput, staffId?: number | null): Promise<Result<{ group: SellingPlanGroup; deletedPlanIds: number[] }>> {
  const cur = await getSellingPlanGroup(db, shopId, id);
  if (!cur) return errR(['id'], 'Selling plan group does not exist', 'GROUP_DOES_NOT_EXIST');
  const v = validateGroup(input, false);
  if (!v.ok) return v;
  const existing = await listSellingPlans(db, shopId, [id]);
  for (const [k, p] of (input.plansToUpdate ?? []).entries()) if (!existing.some((e) => e.id === p.id)) return errR(['input', 'sellingPlansToUpdate', String(k), 'id'], 'Selling plan does not exist', 'SELLING_PLAN_DOES_NOT_EXIST');
  const deleting = (input.plansToDelete ?? []).filter((x) => existing.some((e) => e.id === x));
  if ((input.plansToDelete ?? []).some((x) => !existing.some((e) => e.id === x))) return errR(['input', 'sellingPlansToDelete'], 'Selling plan does not exist', 'SELLING_PLAN_DOES_NOT_EXIST');
  if (existing.length - deleting.length + (input.plansToCreate ?? []).length > MAX_PLANS) return errR(['input', 'sellingPlansToCreate'], `A group can have at most ${MAX_PLANS} plans`, 'TOO_LONG');
  return txResult(db, async (tx) => {
    const [g] = await tx.update(sellingPlanGroups).set({
      ...(input.name != null && { name: input.name.trim() }), ...(input.merchantCode != null && { merchantCode: input.merchantCode.trim() || cur.merchantCode }),
      ...(input.description !== undefined && { description: input.description?.trim() || null }), ...(input.options && { options: cleanList(input.options) }),
      ...(input.position !== undefined && { position: input.position }), ...(input.appId !== undefined && { appId: input.appId }), updatedAt: new Date(),
    }).where(eq(sellingPlanGroups.id, id)).returning();
    if (deleting.length) await tx.delete(sellingPlans).where(and(eq(sellingPlans.groupId, id), inArray(sellingPlans.id, deleting)));
    for (const p of input.plansToUpdate ?? []) {
      const e = existing.find((x) => x.id === p.id)!;
      await tx.update(sellingPlans).set({
        ...(p.name != null && { name: p.name.trim() }), ...(p.description !== undefined && { description: p.description?.trim() || null }), ...(p.options && { options: cleanList(p.options) }),
        ...(p.position !== undefined && p.position !== null && { position: p.position }), ...(p.category && { category: p.category }),
        ...(p.billingPolicy && { billingPolicy: normBilling({ ...e.billingPolicy, ...p.billingPolicy }) }), ...(p.deliveryPolicy && { deliveryPolicy: normDelivery({ ...e.deliveryPolicy, ...p.deliveryPolicy }) }),
        ...(p.pricingPolicies && { pricingPolicies: normPricing(p.pricingPolicies) }),
      }).where(eq(sellingPlans.id, e.id));
    }
    const start = existing.length - deleting.length;
    if (input.plansToCreate?.length) await tx.insert(sellingPlans).values(input.plansToCreate.map((p, i) => planRow(shopId, id, p, start + i + 1)));
    await addEvent(tx, shopId, { subjectType: 'selling_plan_group', subjectId: id, verb: 'selling_plan_groups/update', message: `Purchase option ${g!.name} was updated`, authorStaffUserId: staffId });
    return okR({ group: g!, deletedPlanIds: deleting });
  });
}

export async function deleteSellingPlanGroup(db: Db, shopId: number, id: number): Promise<Result<number>> {
  if (!(await getSellingPlanGroup(db, shopId, id))) return errR(['id'], 'Selling plan group does not exist', 'GROUP_DOES_NOT_EXIST');
  await db.delete(sellingPlanGroups).where(and(eq(sellingPlanGroups.shopId, shopId), eq(sellingPlanGroups.id, id)));
  await addEvent(db, shopId, { subjectType: 'selling_plan_group', subjectId: id, verb: 'selling_plan_groups/delete', message: 'Purchase option was deleted' });
  return okR(id);
}

/** Attach or detach products / variants. Returns the ids that were in the request (detach) or the group (attach). */
export async function changeGroupResources(db: Db, shopId: number, id: number, op: 'add' | 'remove', kind: 'products' | 'variants', ids: number[]): Promise<Result<{ group: SellingPlanGroup; ids: number[] }>> {
  const g = await getSellingPlanGroup(db, shopId, id);
  if (!g) return errR(['id'], 'Selling plan group does not exist', 'GROUP_DOES_NOT_EXIST');
  if (!ids.length) return errR([kind === 'products' ? 'productIds' : 'productVariantIds'], 'At least one id is required', 'BLANK');
  if (op === 'add') {
    const r = await checkResources(db, shopId, kind === 'products' ? ids : [], kind === 'variants' ? ids : [], []);
    if (!r.ok) return r;
    await link(db, shopId, id, kind === 'products' ? ids : [], kind === 'variants' ? ids : []);
  } else if (kind === 'products') await db.delete(sellingPlanGroupProducts).where(and(eq(sellingPlanGroupProducts.groupId, id), inArray(sellingPlanGroupProducts.productId, ids)));
  else await db.delete(sellingPlanGroupVariants).where(and(eq(sellingPlanGroupVariants.groupId, id), inArray(sellingPlanGroupVariants.variantId, ids)));
  await db.update(sellingPlanGroups).set({ updatedAt: new Date() }).where(eq(sellingPlanGroups.id, id));
  return okR({ group: (await getSellingPlanGroup(db, shopId, id))!, ids });
}
