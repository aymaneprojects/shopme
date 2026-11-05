import { allocationPrice, getSellingPlanGroups, groupsForProducts, liquidPriceAdjustments, listSellingPlans, schema as s, type Db, type SellingPlan, type SellingPlanGroup } from '@shopme/core';
import type { VariantObject } from './types';

/** Liquid purchase options: `product.selling_plan_groups`, `variant.selling_plan_allocations` and the selected plan. Money is minor units of the page currency. */

type ProductRow = typeof s.products.$inferSelect;
interface GroupLink { group: SellingPlanGroup; plans: SellingPlan[]; variantIds: number[] | 'all' }

export interface SellingPlanData {
  variantFields(p: ProductRow, variantId: number, price: number, selectedPlanId?: number): { selling_plan_allocations: unknown[]; requires_selling_plan: boolean; selected_selling_plan_allocation: unknown | null };
  productFields(p: ProductRow, variants: VariantObject[], current: VariantObject | null, selectedPlanId?: number): {
    requires_selling_plan: boolean; selling_plan_groups: unknown[]; selected_selling_plan: unknown | null; selected_or_first_available_selling_plan_allocation: unknown | null;
  };
}

export function sellingPlanLiquid(plan: SellingPlan, group: SellingPlanGroup, selected: boolean) {
  return {
    id: plan.id, name: plan.name, description: plan.description ?? '', group_id: String(group.id),
    options: plan.options.map((value, i) => ({ name: group.options[i] ?? group.options[0] ?? '', position: i + 1, value })),
    recurring_deliveries: true, fixed_selling_plan: false, selected, checkout_charge: { value_type: 'percentage', value: 100 },
    price_adjustments: liquidPriceAdjustments(plan.pricingPolicies),
    /** ShopMe: billing and delivery schedule, for themes that show "every 2 weeks". */
    billing_interval: plan.billingPolicy.interval.toLowerCase(), billing_interval_count: plan.billingPolicy.intervalCount,
    delivery_interval: plan.deliveryPolicy.interval.toLowerCase(), delivery_interval_count: plan.deliveryPolicy.intervalCount,
  };
}

/** Load every purchase option of the products once; the returned helpers build the Liquid fields per product and variant. */
export async function loadSellingPlans(db: Db, shopId: number, productIds: number[], convert?: (shopMinor: number) => number): Promise<SellingPlanData> {
  const links = await groupsForProducts(db, shopId, productIds);
  const groupIds = [...new Set([...links.values()].flatMap((l) => l.map((x) => x.groupId)))];
  const [groups, plans] = await Promise.all([getSellingPlanGroups(db, shopId, groupIds), listSellingPlans(db, shopId, groupIds)]);
  const byProduct = new Map<number, GroupLink[]>();
  for (const [productId, list] of links) {
    byProduct.set(productId, list.flatMap((l) => {
      const group = groups.find((g) => g.id === l.groupId);
      const ps = plans.filter((x) => x.groupId === l.groupId);
      return group && ps.length ? [{ group, plans: ps, variantIds: l.variantIds }] : [];
    }));
  }
  const covers = (l: GroupLink, variantId: number) => l.variantIds === 'all' || l.variantIds.includes(variantId);
  const allocation = (plan: SellingPlan, group: SellingPlanGroup, price: number, selected: boolean) => {
    const a = allocationPrice(price, plan, convert);
    return {
      price: a.price, compare_at_price: a.compareAtPrice, per_delivery_price: a.perDeliveryPrice, price_adjustments: a.priceAdjustments, unit_price: null,
      checkout_charge_amount: a.price, remaining_balance_charge_amount: 0, selling_plan: sellingPlanLiquid(plan, group, selected), selling_plan_group_id: String(group.id),
      selling_plan_id: plan.id,
    };
  };
  const selectedIn = (list: GroupLink[], id?: number) => (id ? list.flatMap((l) => l.plans.map((p) => ({ p, g: l.group }))).find((x) => x.p.id === id) ?? null : null);

  return {
    variantFields(p, variantId, price, selectedPlanId) {
      const list = (byProduct.get(p.id) ?? []).filter((l) => covers(l, variantId));
      const allocations = list.flatMap((l) => l.plans.map((plan) => allocation(plan, l.group, price, plan.id === selectedPlanId)));
      return {
        selling_plan_allocations: allocations, requires_selling_plan: p.requiresSellingPlan && allocations.length > 0,
        selected_selling_plan_allocation: structuredClone(allocations.find((a) => a.selling_plan_id === selectedPlanId) ?? null),
      };
    },
    productFields(p, _variants, current, selectedPlanId) {
      const list = byProduct.get(p.id) ?? [];
      const sel = selectedIn(list, selectedPlanId);
      const groupsOut = list.map((l) => {
        const isSel = !!sel && sel.g.id === l.group.id;
        return {
          id: String(l.group.id), name: l.group.name, app_id: l.group.appId, selling_plan_selected: isSel,
          options: l.group.options.map((name, i) => ({ name, position: i + 1, values: [...new Set(l.plans.map((x) => x.options[i] ?? x.name))], selected_value: isSel ? sel!.p.options[i] ?? null : null })),
          selling_plans: l.plans.map((plan) => sellingPlanLiquid(plan, l.group, plan.id === sel?.p.id)),
        };
      });
      const currentAllocations = (current?.selling_plan_allocations ?? []) as { selling_plan_id: number }[];
      return {
        requires_selling_plan: p.requiresSellingPlan && list.length > 0, selling_plan_groups: groupsOut,
        selected_selling_plan: sel ? sellingPlanLiquid(sel.p, sel.g, true) : null,
        // Copies: `| json` drops objects it already printed (the same allocation is in the variant's list).
        selected_or_first_available_selling_plan_allocation: structuredClone(currentAllocations.find((a) => a.selling_plan_id === sel?.p.id) ?? currentAllocations[0] ?? null),
      };
    },
  };
}
