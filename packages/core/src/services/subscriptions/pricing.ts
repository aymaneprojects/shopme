/**
 * Pure selling plan arithmetic: price per billing cycle, deliveries per billing period and billing dates.
 * Money is integer minor units; percentages are rounded half up on integers (see `roundDiv`).
 */
import type { PlanBillingPolicy, PlanDeliveryPolicy, PlanPricingPolicy, SellingPlanInterval } from '../../db/schema';
import { roundDiv } from '../pricing';

const DAYS: Record<SellingPlanInterval, number> = { DAY: 1, WEEK: 7, MONTH: 30, YEAR: 365 };

/** Deliveries paid by one billing: 1 for pay-per-delivery plans, more for prepaid plans (bill every 3 months, deliver monthly: 3). */
export function deliveriesPerBilling(b: Pick<PlanBillingPolicy, 'interval' | 'intervalCount'>, d: Pick<PlanDeliveryPolicy, 'interval' | 'intervalCount'>): number {
  if (b.interval === d.interval) return Math.max(1, Math.floor(b.intervalCount / Math.max(1, d.intervalCount)));
  return Math.max(1, Math.round((DAYS[b.interval] * b.intervalCount) / (DAYS[d.interval] * Math.max(1, d.intervalCount))));
}

/** Policies in the order they take effect. */
export const sortedPolicies = (policies: PlanPricingPolicy[]): PlanPricingPolicy[] => [...policies].sort((a, b) => a.afterCycle - b.afterCycle);

/** Policy in force for billing cycle `cycle` (1 = the checkout order): the one with the largest `afterCycle` below the cycle. */
export function policyForCycle(policies: PlanPricingPolicy[], cycle: number): PlanPricingPolicy | null {
  let best: PlanPricingPolicy | null = null;
  for (const p of policies) if (p.afterCycle < cycle && (!best || p.afterCycle >= best.afterCycle)) best = p;
  return best;
}

/** Unit price after a policy. `convert` turns shop-money amounts (amount off, fixed price) into the currency of `price`. */
export function adjustedPrice(price: number, policy: PlanPricingPolicy | null, convert: (shopMinor: number) => number = (n) => n): number {
  if (!policy) return price;
  switch (policy.adjustmentType) {
    case 'PERCENTAGE': return Math.max(0, price - roundDiv(price * Math.round(policy.adjustmentValue * 10_000), 1_000_000));
    case 'FIXED_AMOUNT': return Math.max(0, price - convert(policy.adjustmentValue));
    case 'PRICE': return Math.max(0, convert(policy.adjustmentValue));
    default: return price;
  }
}

export interface PlanPricingShape { billingPolicy: PlanBillingPolicy; deliveryPolicy: PlanDeliveryPolicy; pricingPolicies: PlanPricingPolicy[] }

export interface SellingPlanAllocationPrice {
  /** Charged per billing cycle at checkout (per delivery price x deliveries per billing). */
  price: number;
  /** One-time price for the same deliveries. */
  compareAtPrice: number;
  perDeliveryPrice: number;
  deliveries: number;
  /** Price per billing under each pricing policy, in the order they take effect (position starts at 1). */
  priceAdjustments: { position: number; price: number }[];
}

/** What a variant costs with a plan, from its one-time price. */
export function allocationPrice(price: number, plan: PlanPricingShape, convert?: (shopMinor: number) => number): SellingPlanAllocationPrice {
  const n = deliveriesPerBilling(plan.billingPolicy, plan.deliveryPolicy);
  const policies = sortedPolicies(plan.pricingPolicies);
  const perDelivery = adjustedPrice(price, policyForCycle(policies, 1), convert);
  return { price: perDelivery * n, compareAtPrice: price * n, perDeliveryPrice: perDelivery, deliveries: n, priceAdjustments: policies.map((p, i) => ({ position: i + 1, price: adjustedPrice(price, p, convert) * n })) };
}

/** Unit price per billing for a contract line at `cycle`. */
export const contractLinePrice = (basePrice: number, policies: PlanPricingPolicy[], deliveries: number, cycle: number): number => adjustedPrice(basePrice, policyForCycle(policies, cycle)) * Math.max(1, deliveries);

/** `date` plus `count` intervals, in UTC; month and year steps keep the day of month, clamped to the month's length (31 Jan + 1 month = 28/29 Feb). */
export function addInterval(date: Date, interval: SellingPlanInterval, count: number): Date {
  const d = new Date(date.getTime());
  if (interval === 'DAY') { d.setUTCDate(d.getUTCDate() + count); return d; }
  if (interval === 'WEEK') { d.setUTCDate(d.getUTCDate() + 7 * count); return d; }
  const months = interval === 'MONTH' ? count : 12 * count;
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** Liquid `selling_plan.price_adjustments`: how many orders each policy lasts (null for the last one) and its value. */
export function liquidPriceAdjustments(policies: PlanPricingPolicy[]) {
  const sorted = sortedPolicies(policies);
  return sorted.map((p, i) => ({
    position: i + 1, order_count: sorted[i + 1] ? sorted[i + 1]!.afterCycle - p.afterCycle : null,
    value_type: p.adjustmentType === 'PERCENTAGE' ? 'percentage' : p.adjustmentType === 'FIXED_AMOUNT' ? 'fixed_amount' : 'price',
    value: p.adjustmentValue,
  }));
}

const EN_UNITS: Record<SellingPlanInterval, [string, string]> = { DAY: ['day', 'days'], WEEK: ['week', 'weeks'], MONTH: ['month', 'months'], YEAR: ['year', 'years'] };
const FR_EVERY: Record<SellingPlanInterval, [string, string]> = { DAY: ['chaque jour', 'tous les {n} jours'], WEEK: ['chaque semaine', 'toutes les {n} semaines'], MONTH: ['chaque mois', 'tous les {n} mois'], YEAR: ['chaque année', 'tous les {n} ans'] };

/** "every 2 weeks" / "toutes les 2 semaines". */
export function frequencyLabel(lang: string, p: { interval: SellingPlanInterval; intervalCount: number }): string {
  const n = Math.max(1, p.intervalCount);
  if (lang.slice(0, 2).toLowerCase() === 'fr') { const [one, many] = FR_EVERY[p.interval]; return n === 1 ? one : many.replace('{n}', String(n)); }
  const [one, many] = EN_UNITS[p.interval];
  return n === 1 ? `every ${one}` : `every ${n} ${many}`;
}
