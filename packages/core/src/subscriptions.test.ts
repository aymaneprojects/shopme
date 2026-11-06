import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addInterval, addItems, adjustedPrice, allocationPrice, changeLine, createDb, createLocalStorage, createSellingPlanGroup, deliveriesPerBilling, frequencyLabel, getOrCreateCart, groupsForProducts, groupsForVariants,
  liquidPriceAdjustments, listSellingPlans, loadCartView, policyForCycle, priceCheckout, runMigrations, schema as s, seedDemo, updateSellingPlanGroup, changeGroupResources,
  type DbHandle, type PricingDiscount, type PricingLine,
} from './index';

describe('selling plan arithmetic', () => {
  it('counts deliveries per billing and picks the pricing policy of a cycle', () => {
    expect(deliveriesPerBilling({ interval: 'WEEK', intervalCount: 2 }, { interval: 'WEEK', intervalCount: 2 })).toBe(1);
    expect(deliveriesPerBilling({ interval: 'MONTH', intervalCount: 3 }, { interval: 'MONTH', intervalCount: 1 })).toBe(3);
    expect(deliveriesPerBilling({ interval: 'MONTH', intervalCount: 1 }, { interval: 'WEEK', intervalCount: 1 })).toBe(4);
    const policies = [{ adjustmentType: 'PERCENTAGE' as const, adjustmentValue: 10, afterCycle: 0 }, { adjustmentType: 'PERCENTAGE' as const, adjustmentValue: 20, afterCycle: 3 }];
    expect(policyForCycle(policies, 1)?.adjustmentValue).toBe(10);
    expect(policyForCycle(policies, 3)?.adjustmentValue).toBe(10);
    expect(policyForCycle(policies, 4)?.adjustmentValue).toBe(20);
    expect(policyForCycle([{ adjustmentType: 'PRICE', adjustmentValue: 900, afterCycle: 2 }], 1)).toBeNull();
  });
  it('adjusts prices by percentage, amount off or fixed price, never below zero', () => {
    expect(adjustedPrice(1450, { adjustmentType: 'PERCENTAGE', adjustmentValue: 10, afterCycle: 0 })).toBe(1305);
    expect(adjustedPrice(999, { adjustmentType: 'PERCENTAGE', adjustmentValue: 12.5, afterCycle: 0 })).toBe(874);
    expect(adjustedPrice(1000, { adjustmentType: 'FIXED_AMOUNT', adjustmentValue: 1500, afterCycle: 0 })).toBe(0);
    expect(adjustedPrice(1000, { adjustmentType: 'PRICE', adjustmentValue: 800, afterCycle: 0 }, (n) => n * 2)).toBe(1600);
    const plan = { billingPolicy: { interval: 'MONTH' as const, intervalCount: 3, minCycles: null, maxCycles: null }, deliveryPolicy: { interval: 'MONTH' as const, intervalCount: 1 }, pricingPolicies: [{ adjustmentType: 'PERCENTAGE' as const, adjustmentValue: 10, afterCycle: 0 }] };
    expect(allocationPrice(1000, plan)).toEqual({ price: 2700, compareAtPrice: 3000, perDeliveryPrice: 900, deliveries: 3, priceAdjustments: [{ position: 1, price: 2700 }] });
    expect(liquidPriceAdjustments([{ adjustmentType: 'PRICE', adjustmentValue: 800, afterCycle: 2 }, { adjustmentType: 'PERCENTAGE', adjustmentValue: 10, afterCycle: 0 }]))
      .toEqual([{ position: 1, order_count: 2, value_type: 'percentage', value: 10 }, { position: 2, order_count: null, value_type: 'price', value: 800 }]);
  });
  it('steps billing dates and clamps month ends', () => {
    expect(addInterval(new Date('2026-01-31T10:00:00Z'), 'MONTH', 1).toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addInterval(new Date('2028-02-29T00:00:00Z'), 'YEAR', 1).toISOString()).toBe('2029-02-28T00:00:00.000Z');
    // A contract of the 31st goes back to the 31st after a short month instead of drifting to the 28th for good.
    expect(addInterval(new Date('2026-02-28T10:00:00Z'), 'MONTH', 1, 31).toISOString()).toBe('2026-03-31T10:00:00.000Z');
    expect(addInterval(new Date('2026-03-31T10:00:00Z'), 'MONTH', 1, 31).toISOString()).toBe('2026-04-30T10:00:00.000Z');
    expect(addInterval(new Date('2026-02-15T10:00:00Z'), 'MONTH', 1, 31).toISOString()).toBe('2026-03-15T10:00:00.000Z');
    expect(addInterval(new Date('2026-11-05T00:00:00Z'), 'WEEK', 2).toISOString()).toBe('2026-11-19T00:00:00.000Z');
    expect(frequencyLabel('en', { interval: 'WEEK', intervalCount: 2 })).toBe('every 2 weeks');
    expect(frequencyLabel('fr', { interval: 'WEEK', intervalCount: 2 })).toBe('toutes les 2 semaines');
    expect(frequencyLabel('fr', { interval: 'MONTH', intervalCount: 1 })).toBe('chaque mois');
  });
});

describe('discount purchase type', () => {
  const line = (id: number, subscription: boolean): PricingLine => ({ id, unitPrice: 1000, quantity: 1, taxable: false, requiresShipping: true, grams: 0, productId: id, collectionIds: [], subscription });
  const disc = (purchaseType: PricingDiscount['purchaseType']): PricingDiscount => ({ id: 1, code: 'X', title: 'X', valueType: 'PERCENTAGE', value: 1000, target: 'ORDER', appliesTo: {}, purchaseType });
  const run = (d: PricingDiscount) => priceCheckout({ lines: [line(1, false), line(2, true)], discounts: [d], shipping: null, taxRates: [], taxesIncluded: false, country: null, province: null }).lines.map((l) => l.discount);
  it('applies to one-time lines, subscription lines or both', () => {
    expect(run(disc({ oneTime: true, subscription: false }))).toEqual([100, 0]);
    expect(run(disc({ oneTime: false, subscription: true }))).toEqual([0, 100]);
    expect(run(disc({ oneTime: true, subscription: true }))).toEqual([100, 100]);
    expect(run(disc(undefined))).toEqual([100, 100]);
  });
});

describe('selling plan groups and the cart', () => {
  let h: DbHandle;
  let shopId: number;
  let coffee: number;
  let variant: number;
  beforeAll(async () => {
    h = await createDb({ memory: true });
    await runMigrations(h);
    const { shop } = await seedDemo(h.db, createLocalStorage(mkdtempSync(path.join(tmpdir(), 'sub-core-'))));
    shopId = shop.id;
    const [p] = await h.db.select().from(s.products).where(eq(s.products.handle, 'highland-morning-coffee-beans'));
    coffee = p!.id;
    variant = (await h.db.select().from(s.productVariants).where(eq(s.productVariants.sku, 'HMC-250-WB')))[0]!.id;
  }, 120_000);
  afterAll(async () => { await h.close(); });

  it('seeds the coffee with a 2 and 4 week plan at 10% off', async () => {
    const groups = (await groupsForProducts(h.db, shopId, [coffee])).get(coffee)!;
    expect(groups).toHaveLength(1);
    const plans = await listSellingPlans(h.db, shopId, [groups[0]!.groupId]);
    expect(plans.map((p) => p.name)).toEqual(['Delivery every 2 weeks, save 10%', 'Delivery every 4 weeks, save 10%']);
    expect((await groupsForVariants(h.db, shopId, [variant])).get(variant)).toEqual([groups[0]!.groupId]);
  });

  it('validates plans and keeps group membership', async () => {
    const bad = await createSellingPlanGroup(h.db, shopId, { name: 'Bad', plansToCreate: [{ name: 'x', billingPolicy: { interval: 'WEEK', intervalCount: 0, minCycles: null, maxCycles: null }, deliveryPolicy: { interval: 'WEEK', intervalCount: 1 } }] });
    expect(bad.ok).toBe(false);
    const noName = await createSellingPlanGroup(h.db, shopId, { name: ' ' });
    expect(!noName.ok && noName.errors[0]!.code).toBe('BLANK');
    const r = await createSellingPlanGroup(h.db, shopId, { name: 'Monthly box', plansToCreate: [{ name: 'Monthly', billingPolicy: { interval: 'MONTH', intervalCount: 1, minCycles: 2, maxCycles: 12 }, deliveryPolicy: { interval: 'MONTH', intervalCount: 1 } }] }, { variantIds: [variant] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await groupsForVariants(h.db, shopId, [variant])).get(variant)).toHaveLength(2);
    const [plan] = await listSellingPlans(h.db, shopId, [r.value.id]);
    const u = await updateSellingPlanGroup(h.db, shopId, r.value.id, { plansToDelete: [plan!.id], plansToCreate: [{ name: 'Every 2 months', billingPolicy: { interval: 'MONTH', intervalCount: 2, minCycles: null, maxCycles: null }, deliveryPolicy: { interval: 'MONTH', intervalCount: 2 } }] });
    expect(u.ok && u.value.deletedPlanIds).toEqual([plan!.id]);
    expect((await listSellingPlans(h.db, shopId, [r.value.id])).map((p) => p.name)).toEqual(['Every 2 months']);
    expect((await changeGroupResources(h.db, shopId, r.value.id, 'remove', 'variants', [variant])).ok).toBe(true);
    expect((await groupsForVariants(h.db, shopId, [variant])).get(variant)).toHaveLength(1);
  });

  it('prices cart lines with a plan and keeps them apart from one-time lines', async () => {
    const groupId = (await groupsForProducts(h.db, shopId, [coffee])).get(coffee)![0]!.groupId;
    const [twoWeeks] = await listSellingPlans(h.db, shopId, [groupId]);
    const cart = await getOrCreateCart(h.db, shopId, 'EUR');
    const added = await addItems(h.db, shopId, cart.id, [{ id: variant, quantity: 1, sellingPlan: twoWeeks!.id }, { id: variant, quantity: 1 }]);
    expect(added.error).toBeUndefined();
    const lines = (await loadCartView(h.db, shopId, cart.id))!.lines;
    expect(lines).toHaveLength(2);
    const sub = lines.find((l) => l.sellingPlan)!;
    expect(sub).toMatchObject({ price: 1305, compareAtPrice: 1450, sellingPlanId: twoWeeks!.id });
    expect(sub.sellingPlan).toMatchObject({ name: 'Delivery every 2 weeks, save 10%', perDeliveryPrice: 1305, shopBasePrice: 1450, deliveries: 1 });
    expect(lines.find((l) => !l.sellingPlan)!.price).toBe(1450);
    expect((await addItems(h.db, shopId, cart.id, [{ id: variant, sellingPlan: 999999 }])).error?.description).toBe('Cannot find selling plan');

    // Switching the subscription line to one-time merges it with the existing one-time line.
    const changed = await changeLine(h.db, shopId, cart.id, { id: sub.key, selling_plan: '' });
    expect(changed.error).toBeUndefined();
    expect(changed.cart.lines).toHaveLength(1);
    expect(changed.cart.lines[0]).toMatchObject({ quantity: 2, price: 1450, sellingPlan: null });
  });

  it('requires a plan for products sold only as a subscription', async () => {
    await h.db.update(s.products).set({ requiresSellingPlan: true }).where(eq(s.products.id, coffee));
    const cart = await getOrCreateCart(h.db, shopId, 'EUR');
    expect((await addItems(h.db, shopId, cart.id, [{ id: variant }])).error?.message).toMatch(/only be bought with a purchase option/);
    await h.db.update(s.products).set({ requiresSellingPlan: false }).where(eq(s.products.id, coffee));
  });
});
