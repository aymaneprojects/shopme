import { and, desc, eq, inArray } from 'drizzle-orm';
import { collectionProducts, collections, fulfillments, products, shops } from '../db/schema';
import type { Executor } from '../db/client';
import { errR, okR, type Result } from './catalog/common';
import { renderMoneyFormat } from '@shopme/shopify-compat';
import type { Shop } from './shops';

/**
 * Return rules (Settings > Policies), stored in `shops.settings.returnRules`. They are enforced when a return is created and give
 * the shipping cost and restocking fee a new return starts with. The refund policy page lists them for customers.
 */
export type ReturnShippingCost = 'free' | 'customer_fixed' | 'customer_pays';
export const RETURN_SHIPPING_COSTS: readonly ReturnShippingCost[] = ['free', 'customer_fixed', 'customer_pays'];

export interface ReturnRules {
  /** Days after fulfilment during which items can be returned; null: no limit. */
  windowDays: number | null;
  /** `free`: the store pays; `customer_fixed`: a flat fee is deducted from the refund; `customer_pays`: the customer buys their own label. */
  shippingCost: ReturnShippingCost;
  /** Flat return shipping fee in minor units (used with `customer_fixed`). */
  shippingFee: number;
  /** Share of the returned items' value kept as a restocking fee, in percent (0 to 100, two decimals). */
  restockingFeePercent: number;
  /** Items that cannot be returned. */
  finalSale: { productIds: number[]; collectionIds: number[] };
}

export const DEFAULT_RETURN_RULES: ReturnRules = { windowDays: null, shippingCost: 'free', shippingFee: 0, restockingFeePercent: 0, finalSale: { productIds: [], collectionIds: [] } };

const ids = (v: unknown): number[] => (Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n) && n > 0) : []);

export function returnRulesOf(shop: Pick<Shop, 'settings'>): ReturnRules {
  const r = (((shop.settings as Record<string, unknown>).returnRules ?? {}) as Record<string, any>);
  const d = DEFAULT_RETURN_RULES;
  return {
    windowDays: Number.isInteger(r.windowDays) && r.windowDays > 0 ? r.windowDays : d.windowDays,
    shippingCost: (RETURN_SHIPPING_COSTS as readonly unknown[]).includes(r.shippingCost) ? r.shippingCost : d.shippingCost,
    shippingFee: Number.isInteger(r.shippingFee) && r.shippingFee > 0 ? r.shippingFee : 0,
    restockingFeePercent: typeof r.restockingFeePercent === 'number' && r.restockingFeePercent >= 0 && r.restockingFeePercent <= 100 ? r.restockingFeePercent : 0,
    finalSale: { productIds: ids(r.finalSale?.productIds), collectionIds: ids(r.finalSale?.collectionIds) },
  };
}

export interface ReturnRulesInput {
  windowDays?: number | null; shippingCost?: ReturnShippingCost | null; shippingFee?: number | null; restockingFeePercent?: number | null;
  finalSale?: { productIds?: number[] | null; collectionIds?: number[] | null } | null;
}

export async function updateReturnRules(db: Executor, shop: Shop, input: ReturnRulesInput & { clearWindow?: boolean }): Promise<Result<ReturnRules>> {
  const cur = returnRulesOf(shop);
  if (input.windowDays != null && (!Number.isInteger(input.windowDays) || input.windowDays < 1 || input.windowDays > 3650)) return errR(['windowDays'], 'The return window is a number of days between 1 and 3650', 'INVALID');
  if (input.shippingCost != null && !RETURN_SHIPPING_COSTS.includes(input.shippingCost)) return errR(['shippingCost'], 'Return shipping cost is invalid', 'INVALID');
  if (input.shippingFee != null && (!Number.isInteger(input.shippingFee) || input.shippingFee < 0)) return errR(['shippingFee'], 'The return shipping fee must be zero or more', 'INVALID');
  if (input.restockingFeePercent != null && !(input.restockingFeePercent >= 0 && input.restockingFeePercent <= 100)) return errR(['restockingFeePercent'], 'The restocking fee is a percentage between 0 and 100', 'INVALID');
  const next: ReturnRules = {
    windowDays: input.clearWindow ? null : input.windowDays === undefined ? cur.windowDays : input.windowDays,
    shippingCost: input.shippingCost ?? cur.shippingCost,
    shippingFee: input.shippingFee ?? cur.shippingFee,
    restockingFeePercent: input.restockingFeePercent == null ? cur.restockingFeePercent : Math.round(input.restockingFeePercent * 100) / 100,
    finalSale: { productIds: input.finalSale?.productIds ? [...new Set(input.finalSale.productIds)] : cur.finalSale.productIds, collectionIds: input.finalSale?.collectionIds ? [...new Set(input.finalSale.collectionIds)] : cur.finalSale.collectionIds },
  };
  if (next.shippingCost === 'customer_fixed' && next.shippingFee <= 0) return errR(['shippingFee'], 'Enter the fixed return shipping fee', 'BLANK');
  if (next.shippingCost !== 'customer_fixed') next.shippingFee = next.shippingCost === 'free' ? 0 : next.shippingFee;
  const known = next.finalSale.productIds.length ? await db.select({ id: products.id }).from(products).where(and(eq(products.shopId, shop.id), inArray(products.id, next.finalSale.productIds))) : [];
  if (known.length !== next.finalSale.productIds.length) return errR(['finalSale', 'productIds'], 'A final sale product does not exist', 'INVALID');
  const kc = next.finalSale.collectionIds.length ? await db.select({ id: collections.id }).from(collections).where(and(eq(collections.shopId, shop.id), inArray(collections.id, next.finalSale.collectionIds))) : [];
  if (kc.length !== next.finalSale.collectionIds.length) return errR(['finalSale', 'collectionIds'], 'A final sale collection does not exist', 'INVALID');
  await db.update(shops).set({ settings: { ...shop.settings, returnRules: next }, updatedAt: new Date() }).where(eq(shops.id, shop.id));
  return okR(next);
}

/** Product ids (among `productIds`) that are final sale: listed directly or in a final sale collection. */
export async function finalSaleProductIds(db: Executor, shopId: number, rules: ReturnRules, productIds: number[]): Promise<Set<number>> {
  const out = new Set(productIds.filter((p) => rules.finalSale.productIds.includes(p)));
  if (rules.finalSale.collectionIds.length && productIds.length) {
    const rows = await db.select({ p: collectionProducts.productId }).from(collectionProducts)
      .where(and(eq(collectionProducts.shopId, shopId), inArray(collectionProducts.productId, productIds), inArray(collectionProducts.collectionId, rules.finalSale.collectionIds)));
    for (const r of rows) out.add(r.p);
  }
  return out;
}

/** When the order was handed over: its latest fulfilment, else the moment it was placed. */
export async function returnWindowStart(db: Executor, shopId: number, orderId: number, placedAt: Date): Promise<Date> {
  const [f] = await db.select({ at: fulfillments.createdAt }).from(fulfillments).where(and(eq(fulfillments.shopId, shopId), eq(fulfillments.orderId, orderId))).orderBy(desc(fulfillments.createdAt)).limit(1);
  return f?.at ?? placedAt;
}

/** Customer-facing summary of the rules (HTML, appended to the refund policy page). Empty when nothing is set. */
export async function returnRulesHtml(db: Executor, shop: Shop): Promise<string> {
  const r = returnRulesOf(shop);
  const fr = shop.locale.slice(0, 2).toLowerCase() === 'fr';
  const money = (n: number) => renderMoneyFormat(shop.moneyFormat, n, shop.currency);
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const items: string[] = [];
  if (r.windowDays) items.push(fr ? `Vous disposez de ${r.windowDays} jours après la livraison pour retourner un article.` : `You can return items within ${r.windowDays} days of delivery.`);
  if (r.shippingCost === 'free') { if (items.length || r.restockingFeePercent || r.finalSale.productIds.length || r.finalSale.collectionIds.length) items.push(fr ? 'Les frais de retour sont à notre charge.' : 'Return shipping is free.'); }
  else if (r.shippingCost === 'customer_fixed') items.push(fr ? `Des frais de retour forfaitaires de ${money(r.shippingFee)} sont déduits du remboursement.` : `A flat return shipping fee of ${money(r.shippingFee)} is deducted from your refund.`);
  else items.push(fr ? "Les frais d'expédition du retour sont à votre charge." : 'You pay for return shipping.');
  if (r.restockingFeePercent > 0) items.push(fr ? `Des frais de remise en stock de ${r.restockingFeePercent} % sont retenus sur la valeur des articles retournés.` : `A ${r.restockingFeePercent}% restocking fee is kept from the value of returned items.`);
  const titles: string[] = [];
  if (r.finalSale.productIds.length) for (const p of await db.select({ t: products.title }).from(products).where(and(eq(products.shopId, shop.id), inArray(products.id, r.finalSale.productIds)))) titles.push(p.t);
  if (r.finalSale.collectionIds.length) for (const c of await db.select({ t: collections.title }).from(collections).where(and(eq(collections.shopId, shop.id), inArray(collections.id, r.finalSale.collectionIds)))) titles.push(c.t);
  if (titles.length) items.push(fr ? `Vente définitive, non retournable : ${titles.map(esc).join(', ')}.` : `Final sale, cannot be returned: ${titles.map(esc).join(', ')}.`);
  if (!items.length) return '';
  return `<h2>${fr ? 'Règles de retour' : 'Return rules'}</h2><ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
}
