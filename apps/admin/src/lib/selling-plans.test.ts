import { describe, expect, it } from 'vitest';
import { translate } from '../i18n';
import type { Key } from '../i18n';
import { blankGroup, blankPlan, groupFromApi, planInput, planName, purchaseOptionChanges, validateGroup, type ApiSellingPlanGroup, type PurchaseOptionsForm } from './selling-plans';

const tEn = (k: Key, v?: Record<string, string | number>) => translate('en', k, v);
const tFr = (k: Key, v?: Record<string, string | number>) => translate('fr', k, v);
const money = (n: number) => `€${n.toFixed(2)}`;

const api: ApiSellingPlanGroup = {
  id: 'gid://shopify/SellingPlanGroup/1', name: 'Subscribe and save', merchantCode: 'coffee', options: ['Delivery frequency'], summary: null, productsCount: { count: 3 },
  sellingPlans: { nodes: [{
    id: 'gid://shopify/SellingPlan/7', name: 'Delivery every 2 weeks, save 10%', options: ['2 weeks'], position: 1,
    billingPolicy: { interval: 'WEEK', intervalCount: 2, maxCycles: null }, deliveryPolicy: { interval: 'WEEK', intervalCount: 2 },
    pricingPolicies: [{ __typename: 'SellingPlanFixedPricingPolicy', adjustmentType: 'PERCENTAGE', adjustmentValue: { __typename: 'SellingPlanPricingPolicyPercentageValue', percentage: 10 } }],
  }] },
};

describe('purchase options form', () => {
  it('names plans in the admin language', () => {
    expect(planName(tEn, blankPlan('WEEK', '2', '10'), money)).toBe('Delivery every 2 weeks, save 10%');
    expect(planName(tFr, blankPlan('WEEK', '2', '10'), money)).toBe('Livraison toutes les 2 semaines, économisez 10 %');
    expect(planName(tEn, { ...blankPlan('MONTH', '1', ''), discountType: 'NONE' }, money)).toBe('Delivery every month');
    expect(planName(tFr, { ...blankPlan('MONTH', '1', '2'), discountType: 'FIXED_AMOUNT' }, money)).toBe('Livraison chaque mois, économisez €2.00');
  });

  it('maps a plan to the API input and reads the API back', () => {
    expect(planInput(tEn, blankPlan('WEEK', '4', '10'), 2, money, false)).toEqual({
      name: 'Delivery every 4 weeks, save 10%', options: ['4 weeks'], position: 2, category: 'SUBSCRIPTION',
      billingPolicy: { recurring: { interval: 'WEEK', intervalCount: 4, maxCycles: null } }, deliveryPolicy: { recurring: { interval: 'WEEK', intervalCount: 4 } },
      pricingPolicies: [{ fixed: { adjustmentType: 'PERCENTAGE', adjustmentValue: { percentage: 10 } } }],
    });
    const g = groupFromApi(api);
    expect(g).toMatchObject({ id: api.id, name: 'Subscribe and save', productsCount: 3 });
    expect(g.plans[0]).toMatchObject({ id: 'gid://shopify/SellingPlan/7', interval: 'WEEK', intervalCount: '2', discountType: 'PERCENTAGE', discountValue: '10' });
  });

  it('validates names, intervals and discounts', () => {
    const g = { ...blankGroup(''), plans: [{ ...blankPlan('WEEK', '0'), key: 'a' }, { ...blankPlan('WEEK', '2', '120'), key: 'b' }] };
    expect(validateGroup(g)).toEqual({ name: 'sub.plan.errName', rows: { a: 'sub.plan.errInterval', b: 'sub.plan.errDiscount' } });
    expect(validateGroup(blankGroup('Coffee club'))).toEqual({ rows: {} });
  });

  it('turns form changes into create, attach, update and detach calls', () => {
    const before: PurchaseOptionsForm = { groups: [groupFromApi(api), { ...groupFromApi(api), id: 'gid://shopify/SellingPlanGroup/2', key: 'g2' }], requiresSellingPlan: false };
    const edited = { ...before.groups[0]!, plans: [{ ...before.groups[0]!.plans[0]!, intervalCount: '3' }, blankPlan('MONTH', '1', '5')] };
    const after: PurchaseOptionsForm = { groups: [edited, blankGroup('New plan'), { ...groupFromApi(api), id: 'gid://shopify/SellingPlanGroup/9', key: 'g9' }], requiresSellingPlan: true };
    const calls = purchaseOptionChanges('gid://shopify/Product/5', before, after, tEn, money);
    expect(calls.map((c) => c.root)).toEqual(['sellingPlanGroupUpdate', 'sellingPlanGroupCreate', 'sellingPlanGroupAddProducts', 'sellingPlanGroupRemoveProducts']);
    const update = calls[0]!.vars.input as { sellingPlansToUpdate: Array<{ id: string; name: string }>; sellingPlansToCreate: unknown[]; sellingPlansToDelete: string[] };
    expect(update.sellingPlansToUpdate).toEqual([expect.objectContaining({ id: 'gid://shopify/SellingPlan/7', name: 'Delivery every 3 weeks, save 10%' })]);
    expect(update.sellingPlansToCreate).toHaveLength(1);
    expect(update.sellingPlansToDelete).toEqual([]);
    expect(calls[1]!.vars).toMatchObject({ resources: { productIds: ['gid://shopify/Product/5'] }, input: { name: 'New plan', options: ['Delivery frequency'] } });
    expect(calls[3]!.vars).toEqual({ id: 'gid://shopify/SellingPlanGroup/2', productIds: ['gid://shopify/Product/5'] });
    expect(purchaseOptionChanges('gid://shopify/Product/5', before, before, tEn, money)).toEqual([]);
  });
});
