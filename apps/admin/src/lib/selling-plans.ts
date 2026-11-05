// Purchase options of the product page: form model of selling plan groups, mapping to the Admin API and the save steps.
import { mutate } from '../api';
import { parseDecimal } from '../format';
import { SELLING_PLAN_GROUP_ADD_PRODUCTS, SELLING_PLAN_GROUP_CREATE, SELLING_PLAN_GROUP_REMOVE_PRODUCTS, SELLING_PLAN_GROUP_UPDATE } from '../graphql';
import type { Key } from '../i18n';

export type PlanInterval = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';
export const PLAN_INTERVALS: PlanInterval[] = ['WEEK', 'MONTH', 'DAY', 'YEAR'];
export type PlanDiscountType = 'NONE' | 'PERCENTAGE' | 'FIXED_AMOUNT';

/** One delivery frequency of a plan group (one selling plan). */
export interface PlanDraft { key: string; id: string | null; interval: PlanInterval; intervalCount: string; discountType: PlanDiscountType; discountValue: string; maxCycles: number | null }
/** A selling plan group as edited on the product page; `id` null until it is created with the product. */
export interface PlanGroupDraft { key: string; id: string | null; name: string; merchantCode: string; productsCount: number; plans: PlanDraft[] }
export interface PurchaseOptionsForm { groups: PlanGroupDraft[]; requiresSellingPlan: boolean }

/** Shape of a selling plan group in the Admin API queries (see graphql/subscriptions.ts). */
export interface ApiSellingPlanGroup {
  id: string; name: string; merchantCode: string; options: string[]; summary: string | null; productsCount: { count: number } | null;
  sellingPlans: { nodes: Array<{
    id: string; name: string; options: string[]; position: number | null;
    billingPolicy: { interval?: PlanInterval; intervalCount?: number; maxCycles?: number | null };
    deliveryPolicy: { interval?: PlanInterval; intervalCount?: number };
    pricingPolicies: Array<{ __typename: string; adjustmentType?: string; adjustmentValue?: { __typename: string; percentage?: number; amount?: string }; afterCycle?: number | null }>;
  }> };
}

let seq = 0;
export const newKey = () => `new-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export const blankPlan = (interval: PlanInterval = 'WEEK', count = '2', discount = '10'): PlanDraft => ({ key: newKey(), id: null, interval, intervalCount: count, discountType: discount ? 'PERCENTAGE' : 'NONE', discountValue: discount, maxCycles: null });
export const blankGroup = (name: string): PlanGroupDraft => ({ key: newKey(), id: null, name, merchantCode: '', productsCount: 0, plans: [blankPlan('WEEK', '2'), blankPlan('WEEK', '4')] });

export function groupFromApi(g: ApiSellingPlanGroup): PlanGroupDraft {
  return {
    key: g.id, id: g.id, name: g.name, merchantCode: g.merchantCode, productsCount: g.productsCount?.count ?? 0,
    plans: g.sellingPlans.nodes.map((p) => {
      const first = p.pricingPolicies.find((x) => !x.afterCycle) ?? p.pricingPolicies[0];
      const type: PlanDiscountType = !first ? 'NONE' : first.adjustmentType === 'PERCENTAGE' ? 'PERCENTAGE' : first.adjustmentType === 'FIXED_AMOUNT' ? 'FIXED_AMOUNT' : 'NONE';
      const value = type === 'PERCENTAGE' ? String(first?.adjustmentValue?.percentage ?? '') : type === 'FIXED_AMOUNT' ? first?.adjustmentValue?.amount ?? '' : '';
      return { key: p.id, id: p.id, interval: p.billingPolicy.interval ?? 'MONTH', intervalCount: String(p.billingPolicy.intervalCount ?? 1), discountType: type, discountValue: value, maxCycles: p.billingPolicy.maxCycles ?? null };
    }),
  };
}

export const purchaseOptionsFromApi = (groups: ApiSellingPlanGroup[], requiresSellingPlan: boolean): PurchaseOptionsForm => ({ groups: groups.map(groupFromApi), requiresSellingPlan });

type T = (k: Key, v?: Record<string, string | number>) => string;

/** "Delivery every 2 weeks" in the admin language. */
export const planFrequency = (t: T, p: Pick<PlanDraft, 'interval' | 'intervalCount'>) => t(`sub.freq.${p.interval}` as Key, { n: Number(p.intervalCount) || 1 });
/** "10% off" / "€2.00 off", or null without a discount. */
export function planDiscount(t: T, p: Pick<PlanDraft, 'discountType' | 'discountValue'>, money: (n: number) => string): string | null {
  const v = parseDecimal(p.discountValue);
  if (p.discountType === 'NONE' || v === null || v <= 0) return null;
  return p.discountType === 'PERCENTAGE' ? t('sub.plan.percentOff', { v: String(v) }) : t('sub.plan.amountOff', { v: money(v) });
}
/** Plan name shown to customers: "Delivery every 2 weeks, save 10%". */
export function planName(t: T, p: PlanDraft, money: (n: number) => string): string {
  const freq = planFrequency(t, p);
  const v = parseDecimal(p.discountValue);
  if (p.discountType === 'NONE' || v === null || v <= 0) return freq;
  return t('sub.plan.nameSave', { name: freq, value: p.discountType === 'PERCENTAGE' ? t('sub.plan.percent', { v: String(v) }) : money(v) });
}

export type PlanErrors = { name?: Key; plans?: Key; rows: Record<string, Key> };
export function validateGroup(g: PlanGroupDraft): PlanErrors {
  const e: PlanErrors = { rows: {} };
  if (!g.name.trim()) e.name = 'sub.plan.errName';
  if (!g.plans.length) e.plans = 'sub.plan.errNone';
  for (const p of g.plans) {
    const n = Number(p.intervalCount);
    if (!Number.isInteger(n) || n < 1 || n > 365) { e.rows[p.key] = 'sub.plan.errInterval'; continue; }
    if (p.discountType !== 'NONE') {
      const v = parseDecimal(p.discountValue);
      if (v === null || v <= 0 || (p.discountType === 'PERCENTAGE' && v > 100)) e.rows[p.key] = 'sub.plan.errDiscount';
    }
  }
  return e;
}
export const hasErrors = (e: PlanErrors) => !!e.name || !!e.plans || Object.keys(e.rows).length > 0;

/** `SellingPlanInput` of one frequency: billed and delivered at the same interval, with an optional discount from the first order. */
export function planInput(t: T, p: PlanDraft, position: number, money: (n: number) => string, withId: boolean) {
  const n = Math.trunc(Number(p.intervalCount));
  const v = parseDecimal(p.discountValue);
  const pricing = p.discountType === 'NONE' || v === null || v <= 0 ? []
    : [{ fixed: { adjustmentType: p.discountType, adjustmentValue: p.discountType === 'PERCENTAGE' ? { percentage: v } : { fixedValue: v.toFixed(2) } } }];
  return {
    ...(withId && p.id ? { id: p.id } : {}),
    name: planName(t, p, money), options: [t(`sub.optionValue.${p.interval}` as Key, { n })], position, category: 'SUBSCRIPTION',
    billingPolicy: { recurring: { interval: p.interval, intervalCount: n, maxCycles: p.maxCycles } }, deliveryPolicy: { recurring: { interval: p.interval, intervalCount: n } },
    pricingPolicies: pricing,
  };
}

const groupInput = (t: T, g: PlanGroupDraft, money: (n: number) => string, before?: PlanGroupDraft) => {
  const base = { name: g.name.trim(), merchantCode: g.merchantCode.trim() || g.name.trim(), options: [t('sub.plan.optionName')] };
  if (!before) return { ...base, sellingPlansToCreate: g.plans.map((p, i) => planInput(t, p, i + 1, money, false)) };
  return {
    ...base,
    sellingPlansToCreate: g.plans.map((p, i) => [p, i] as const).filter(([p]) => !p.id).map(([p, i]) => planInput(t, p, i + 1, money, false)),
    sellingPlansToUpdate: g.plans.map((p, i) => [p, i] as const).filter(([p]) => p.id).map(([p, i]) => planInput(t, p, i + 1, money, true)),
    sellingPlansToDelete: before.plans.filter((b) => b.id && !g.plans.some((p) => p.id === b.id)).map((b) => b.id!),
  };
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const comparable = (g: PlanGroupDraft) => ({ name: g.name.trim(), plans: g.plans.map((p) => ({ id: p.id, i: p.interval, c: p.intervalCount, d: p.discountType, v: p.discountValue })) });

/** The API calls that bring a product's purchase options from `before` to `after` (new groups are created with the product attached). */
export function purchaseOptionChanges(productId: string, before: PurchaseOptionsForm, after: PurchaseOptionsForm, t: T, money: (n: number) => string) {
  const calls: Array<{ doc: string; vars: Record<string, unknown>; root: string }> = [];
  for (const g of after.groups) {
    const prev = before.groups.find((b) => b.id && b.id === g.id);
    if (!g.id) calls.push({ doc: SELLING_PLAN_GROUP_CREATE, vars: { input: groupInput(t, g, money), resources: { productIds: [productId] } }, root: 'sellingPlanGroupCreate' });
    else {
      if (!prev) calls.push({ doc: SELLING_PLAN_GROUP_ADD_PRODUCTS, vars: { id: g.id, productIds: [productId] }, root: 'sellingPlanGroupAddProducts' });
      const original = prev ?? g;
      if (prev && !same(comparable(prev), comparable(g))) calls.push({ doc: SELLING_PLAN_GROUP_UPDATE, vars: { id: g.id, input: groupInput(t, g, money, original) }, root: 'sellingPlanGroupUpdate' });
    }
  }
  for (const b of before.groups) if (b.id && !after.groups.some((g) => g.id === b.id)) calls.push({ doc: SELLING_PLAN_GROUP_REMOVE_PRODUCTS, vars: { id: b.id, productIds: [productId] }, root: 'sellingPlanGroupRemoveProducts' });
  return calls;
}

/** Run the purchase option changes of a saved product. */
export async function savePurchaseOptions(productId: string, before: PurchaseOptionsForm, after: PurchaseOptionsForm, t: T, money: (n: number) => string): Promise<void> {
  for (const c of purchaseOptionChanges(productId, before, after, t, money)) await mutate(c.doc, c.vars, c.root);
}
