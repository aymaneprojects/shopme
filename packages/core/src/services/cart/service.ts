import { createHash, randomBytes } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db, Executor } from '../../db/client';
import * as s from '../../db/schema';
import { isIdentity, priceVariants, resolveMarketContext, toPresentment, type MarketContext } from '../markets/context';
import { productReachableOnStorefront } from '../catalog/publications';
import { groupsForVariants } from '../subscriptions/plans';
import { allocationPrice } from '../subscriptions/pricing';

// ---------------------------------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------------------------------

export interface CartLineView {
  lineId: number;
  key: string;
  variantId: number;
  productId: number;
  quantity: number;
  properties: Record<string, string>;
  position: number;
  variantTitle: string;
  /** Option name/value pairs of the variant (empty for the default-only variant). */
  options: { name: string; value: string }[];
  hasOnlyDefaultVariant: boolean;
  sku: string;
  /** Unit price in minor units of the cart currency (the buyer's presentment currency). */
  price: number;
  /** Compare-at price in the cart currency, when it is above `price`. */
  compareAtPrice: number | null;
  /** Unit price in shop money (what the variant is listed at before market pricing). */
  shopPrice: number;
  taxable: boolean;
  requiresShipping: boolean;
  grams: number;
  product: { title: string; handle: string; vendor: string; productType: string; descriptionHtml: string; isGiftCard: boolean; requiresSellingPlan: boolean };
  image: { url: string; alt: string | null; width: number | null; height: number | null } | null;
  /** Purchase option stored on the line (null: one-time purchase). */
  sellingPlanId: number | null;
  /** The plan and its prices when it is still offered for the variant; `price` above is then the plan price. */
  sellingPlan: CartSellingPlan | null;
}

/** A line's purchase option with its prices in the cart currency (`selling_plan_allocation` in Liquid and the Ajax API). */
export interface CartSellingPlan {
  id: number; name: string; description: string | null; options: string[];
  groupId: number; groupName: string; groupOptions: string[]; appId: string | null;
  billingPolicy: s.PlanBillingPolicy; deliveryPolicy: s.PlanDeliveryPolicy; pricingPolicies: s.PlanPricingPolicy[];
  /** Charged per billing at checkout, the one-time price of the same deliveries, the price per delivery and per pricing policy. */
  price: number; compareAtPrice: number; perDeliveryPrice: number; priceAdjustments: { position: number; price: number }[];
  deliveries: number;
  /** One-time price per delivery in shop money: renewals price later cycles from it. */
  shopBasePrice: number;
}

export interface CartView {
  id: number;
  token: string;
  note: string | null;
  attributes: Record<string, string>;
  /** Presentment currency: prices, discounts, shipping and the order are in this currency. */
  currency: string;
  /** Country the cart is priced for (null: the shop default) and the market it resolved to. */
  countryCode: string | null;
  marketId: number | null;
  /** Shop currency and the rate behind `currency` (1 when equal). */
  shopCurrency: string;
  rate: number;
  discountCodes: string[];
  /** Display order: newest line first. */
  lines: CartLineView[];
}

/** Error in the shape of the Ajax API: `status` is a number, or a slug for `change.js` 422s and 400s. */
export interface CartError { httpStatus: 400 | 422; status: number | string; message: string; description: string }

const cannotFindVariant = (): CartError => ({ httpStatus: 422, status: 422, message: 'Cart Error', description: 'Cannot find variant' });
const err = (httpStatus: 400 | 422, status: number | string, message: string): CartError => ({ httpStatus, status, message, description: message });

export interface LineDelta { line: CartLineView; delta: number }
export interface CartResult { cart: CartView; error?: CartError }
export interface AddResult extends CartResult { added: CartLineView[] }
export interface ChangeResult extends CartResult { deltas: LineDelta[] }

const hex32 = (v: string) => createHash('md5').update(v).digest('hex');

export const newCartToken = (): string => {
  const alnum = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(24);
  return Array.from(bytes, (b) => alnum[b % alnum.length]).join('');
};

/** Cart token as shown to clients: `<token>?key=<32 hex>`. */
export const cartTokenWithKey = (token: string): string => `${token}?key=${hex32(`shopme-cart:${token}`)}`;

/** Line key: `<variant id>:<32 hex>`, a digest of the line customisation (properties and purchase option), stable across carts. */
export function lineKey(variantId: number, properties: Record<string, string>, sellingPlanId?: number | null): string {
  const canon = Object.keys(properties).sort().map((k) => [k, properties[k]]);
  return `${variantId}:${hex32(`${variantId}|${JSON.stringify(canon)}${sellingPlanId ? `|plan:${sellingPlanId}` : ''}`)}`;
}

function cleanProperties(p: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    for (const [k, v] of Object.entries(p)) if (v !== null && v !== undefined && String(v) !== '') out[k] = String(v);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Variant lookup and stock
// ---------------------------------------------------------------------------------------------------------------------

interface VariantInfo { id: number; productTitle: string; /** Infinity when not tracked or oversell allowed. */ limit: number; requiresSellingPlan: boolean }

/** Sellable variants (active products) by id with their stock limit. */
async function variantInfos(db: Executor, shopId: number, ids: number[]): Promise<Map<number, VariantInfo>> {
  const out = new Map<number, VariantInfo>();
  if (!ids.length) return out;
  const rows = await db.select({
    id: s.productVariants.id, policy: s.productVariants.inventoryPolicy, productTitle: s.products.title, itemId: s.inventoryItems.id, tracked: s.inventoryItems.tracked, requiresSellingPlan: s.products.requiresSellingPlan,
  }).from(s.productVariants)
    .innerJoin(s.products, eq(s.products.id, s.productVariants.productId))
    .leftJoin(s.inventoryItems, eq(s.inventoryItems.variantId, s.productVariants.id))
    .where(and(eq(s.productVariants.shopId, shopId), inArray(s.productVariants.id, ids), productReachableOnStorefront));
  const itemIds = rows.flatMap((r) => (r.itemId ? [r.itemId] : []));
  const stock = new Map<number, number>();
  if (itemIds.length) {
    const lv = await db.select({ itemId: s.inventoryLevels.inventoryItemId, n: sql<number>`coalesce(sum(${s.inventoryLevels.available}), 0)::int` })
      .from(s.inventoryLevels).where(and(inArray(s.inventoryLevels.inventoryItemId, itemIds), eq(s.inventoryLevels.isActive, true))).groupBy(s.inventoryLevels.inventoryItemId);
    for (const l of lv) stock.set(l.itemId, l.n);
  }
  for (const r of rows) {
    const unlimited = r.policy === 'CONTINUE' || !r.itemId || r.tracked === false;
    out.set(r.id, { id: r.id, productTitle: r.productTitle, limit: unlimited ? Infinity : Math.max(0, stock.get(r.itemId!) ?? 0), requiresSellingPlan: r.requiresSellingPlan });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------------------------------------------------

const GRAMS: Record<string, number> = { GRAMS: 1, KILOGRAMS: 1000, POUNDS: 453.59237, OUNCES: 28.349523125 };

export async function loadCartView(db: Executor, shopId: number, cartId: number): Promise<CartView | null> {
  const [cart] = await db.select().from(s.carts).where(and(eq(s.carts.id, cartId), eq(s.carts.shopId, shopId))).limit(1);
  if (!cart) return null;
  const rows = await db.select().from(s.cartLines).where(eq(s.cartLines.cartId, cartId)).orderBy(desc(s.cartLines.position), desc(s.cartLines.id));
  const variantIds = [...new Set(rows.map((r) => r.variantId))];
  const lines: CartLineView[] = [];
  if (variantIds.length) {
    const vs = await db.select({ v: s.productVariants, p: s.products, i: s.inventoryItems }).from(s.productVariants)
      .innerJoin(s.products, eq(s.products.id, s.productVariants.productId))
      .leftJoin(s.inventoryItems, eq(s.inventoryItems.variantId, s.productVariants.id))
      .where(inArray(s.productVariants.id, variantIds));
    const productIds = [...new Set(vs.map((x) => x.p.id))];
    const [optRows, mediaRows, variantCounts] = await Promise.all([
      db.select({ variantId: s.variantOptionValues.variantId, name: s.productOptions.name, value: s.productOptionValues.name, pos: s.productOptions.position })
        .from(s.variantOptionValues)
        .innerJoin(s.productOptions, eq(s.productOptions.id, s.variantOptionValues.optionId))
        .innerJoin(s.productOptionValues, eq(s.productOptionValues.id, s.variantOptionValues.optionValueId))
        .where(inArray(s.variantOptionValues.variantId, variantIds)).orderBy(asc(s.productOptions.position)),
      db.select({ productId: s.productMedia.productId, position: s.productMedia.position, m: s.media }).from(s.productMedia)
        .innerJoin(s.media, eq(s.media.id, s.productMedia.mediaId)).where(inArray(s.productMedia.productId, productIds)).orderBy(asc(s.productMedia.position)),
      db.select({ productId: s.productVariants.productId, n: sql<number>`count(*)::int` }).from(s.productVariants).where(inArray(s.productVariants.productId, productIds)).groupBy(s.productVariants.productId),
    ]);
    const byVariant = new Map(vs.map((x) => [x.v.id, x]));
    const counts = new Map(variantCounts.map((c) => [c.productId, c.n]));
    for (const r of rows) {
      const x = byVariant.get(r.variantId);
      if (!x) continue;
      const own = x.v.mediaId ? mediaRows.find((m) => m.m.id === x.v.mediaId)?.m : undefined;
      const first = mediaRows.find((m) => m.productId === x.p.id)?.m;
      const img = own ?? first;
      const unit = GRAMS[x.i?.weightUnit ?? 'GRAMS'] ?? 1;
      const options = optRows.filter((o) => o.variantId === r.variantId).map((o) => ({ name: o.name, value: o.value }));
      lines.push({
        lineId: r.id, key: lineKey(r.variantId, r.properties, r.sellingPlanId), variantId: r.variantId, productId: x.p.id, quantity: r.quantity, properties: r.properties, position: r.position,
        variantTitle: x.v.title, options, hasOnlyDefaultVariant: (counts.get(x.p.id) ?? 1) === 1 && options.length === 0, sku: x.v.sku ?? '',
        price: x.v.price, compareAtPrice: x.v.compareAtPrice && x.v.compareAtPrice > x.v.price ? x.v.compareAtPrice : null, shopPrice: x.v.price, taxable: x.v.taxable, requiresShipping: x.i?.requiresShipping ?? true, grams: Math.round((x.i?.weightValue ?? 0) * unit),
        product: { title: x.p.title, handle: x.p.handle, vendor: x.p.vendor, productType: x.p.productType, descriptionHtml: x.p.descriptionHtml, isGiftCard: x.p.isGiftCard, requiresSellingPlan: x.p.requiresSellingPlan },
        image: img?.url ? { url: img.url, alt: img.alt, width: img.width, height: img.height } : null,
        sellingPlanId: r.sellingPlanId ?? null, sellingPlan: null,
      });
    }
  }
  const view: CartView = { id: cart.id, token: cart.token, note: cart.note, attributes: cart.attributes, currency: cart.currency, countryCode: cart.countryCode, marketId: cart.marketId, shopCurrency: cart.currency, rate: 1, discountCodes: cart.discountCodes, lines };
  if (cart.countryCode) await applyMarketPricing(db, shopId, cart, view);
  await applySellingPlans(db, shopId, view);
  return view;
}

/** Price the lines bought with a purchase option. A plan no longer offered for the variant leaves the line at its one-time price. */
async function applySellingPlans(db: Executor, shopId: number, view: CartView): Promise<void> {
  const withPlan = view.lines.filter((l) => l.sellingPlanId);
  if (!withPlan.length) return;
  const rows = await db.select({ p: s.sellingPlans, g: s.sellingPlanGroups }).from(s.sellingPlans).innerJoin(s.sellingPlanGroups, eq(s.sellingPlanGroups.id, s.sellingPlans.groupId))
    .where(and(eq(s.sellingPlans.shopId, shopId), inArray(s.sellingPlans.id, [...new Set(withPlan.map((l) => l.sellingPlanId!))])));
  const allowed = await groupsForVariants(db, shopId, [...new Set(withPlan.map((l) => l.variantId))]);
  const convert = (shopMinor: number) => toPresentment(view, shopMinor);
  for (const l of withPlan) {
    const x = rows.find((r) => r.p.id === l.sellingPlanId);
    if (!x || !(allowed.get(l.variantId) ?? []).includes(x.g.id)) continue;
    const a = allocationPrice(l.price, x.p, convert);
    const inShop = allocationPrice(l.shopPrice, x.p);
    l.sellingPlan = {
      id: x.p.id, name: x.p.name, description: x.p.description, options: x.p.options, groupId: x.g.id, groupName: x.g.name, groupOptions: x.g.options, appId: x.g.appId,
      billingPolicy: x.p.billingPolicy, deliveryPolicy: x.p.deliveryPolicy, pricingPolicies: x.p.pricingPolicies,
      price: a.price, compareAtPrice: a.compareAtPrice, perDeliveryPrice: a.perDeliveryPrice, priceAdjustments: a.priceAdjustments, deliveries: a.deliveries, shopBasePrice: l.shopPrice,
    };
    l.compareAtPrice = a.compareAtPrice > a.price ? a.compareAtPrice : null;
    l.price = a.price;
    l.shopPrice = inShop.price;
  }
}

/** Re-price the lines of a cart bound to a country: the buyer's market decides currency, adjustment and fixed prices. Persists a changed currency. */
async function applyMarketPricing(db: Executor, shopId: number, cart: typeof s.carts.$inferSelect, view: CartView): Promise<void> {
  const [shop] = await db.select({ id: s.shops.id, currency: s.shops.currency, country: s.shops.country }).from(s.shops).where(eq(s.shops.id, shopId)).limit(1);
  if (!shop) return;
  const ctx = await resolveMarketContext(db, shop, cart.countryCode);
  view.shopCurrency = shop.currency; view.currency = ctx.currency; view.rate = ctx.rate; view.marketId = ctx.marketId;
  if (!isIdentity(ctx) && view.lines.length) {
    const priced = await priceVariants(db, shopId, ctx, view.lines.map((l) => ({ id: l.variantId, price: l.shopPrice, compareAt: l.compareAtPrice })));
    for (const l of view.lines) { const p = priced.get(l.variantId); if (p) { l.price = p.price; l.compareAtPrice = p.compareAt; } }
  }
  if (ctx.currency !== cart.currency || ctx.marketId !== cart.marketId) await db.update(s.carts).set({ currency: ctx.currency, marketId: ctx.marketId }).where(eq(s.carts.id, cart.id));
}

/** Bind a cart to a buyer context (country, market, currency). Prices follow on the next load. */
export async function setCartContext(db: Executor, shopId: number, cartId: number, ctx: Pick<MarketContext, 'countryCode' | 'marketId' | 'currency'> | null, shopCurrency: string): Promise<void> {
  await db.update(s.carts).set(ctx ? { countryCode: ctx.countryCode, marketId: ctx.marketId, currency: ctx.currency } : { countryCode: null, marketId: null, currency: shopCurrency })
    .where(and(eq(s.carts.id, cartId), eq(s.carts.shopId, shopId)));
}

export async function getCartByToken(db: Executor, shopId: number, token: string): Promise<CartView | null> {
  const [c] = await db.select({ id: s.carts.id, completedAt: s.carts.completedAt }).from(s.carts).where(and(eq(s.carts.shopId, shopId), eq(s.carts.token, token))).limit(1);
  if (!c || c.completedAt) return null;
  return loadCartView(db, shopId, c.id);
}

export async function createCart(db: Executor, shopId: number, currency: string, ctx?: Pick<MarketContext, 'countryCode' | 'marketId'> | null): Promise<CartView> {
  const [c] = await db.insert(s.carts).values({ shopId, token: newCartToken(), currency, countryCode: ctx?.countryCode ?? null, marketId: ctx?.marketId ?? null }).returning();
  return (await loadCartView(db, shopId, c!.id))!;
}

/** The cart for `token`, or a fresh one (also when the token is unknown or the cart was completed). */
export async function getOrCreateCart(db: Executor, shopId: number, currency: string, token?: string | null, ctx?: Pick<MarketContext, 'countryCode' | 'marketId'> | null): Promise<CartView> {
  if (token) { const c = await getCartByToken(db, shopId, token); if (c) return c; }
  return createCart(db, shopId, currency, ctx);
}

// ---------------------------------------------------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------------------------------------------------

const toInt = (v: unknown, fallback: number): number => {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

const touch = (db: Executor, cartId: number) => db.update(s.carts).set({ updatedAt: new Date() }).where(eq(s.carts.id, cartId));

export interface AddItemInput { id: unknown; quantity?: unknown; properties?: unknown; /** `selling_plan`: purchase option id (empty: one-time purchase). */ sellingPlan?: unknown }

const planIdOf = (v: unknown): number | null | 'invalid' => {
  if (v === undefined || v === null || v === '' || v === 'null') return null;
  const tail = String(v).split('/').pop()!;
  return /^\d+$/.test(tail) && Number(tail) > 0 ? Number(tail) : 'invalid';
};
const cannotFindPlan = (): CartError => ({ httpStatus: 422, status: 422, message: 'Cart Error', description: 'Cannot find selling plan' });
const planRequired = (title: string): CartError => err(422, 422, `The product '${title}' can only be bought with a purchase option (subscription).`);

/** The purchase option is offered for the variant (or none is wanted and none is required). */
async function checkPlan(db: Executor, shopId: number, info: VariantInfo, planId: number | null | 'invalid'): Promise<CartError | null> {
  if (planId === 'invalid') return cannotFindPlan();
  if (planId === null) return info.requiresSellingPlan ? planRequired(info.productTitle) : null;
  const [plan] = await db.select({ groupId: s.sellingPlans.groupId }).from(s.sellingPlans).where(and(eq(s.sellingPlans.shopId, shopId), eq(s.sellingPlans.id, planId))).limit(1);
  if (!plan || !((await groupsForVariants(db, shopId, [info.id])).get(info.id) ?? []).includes(plan.groupId)) return cannotFindPlan();
  return null;
}

/** `add.js` semantics: enforces stock, adds up to the available amount and reports the shortfall as an error. */
export async function addItems(db: Db, shopId: number, cartId: number, items: AddItemInput[]): Promise<AddResult> {
  return db.transaction(async (tx) => {
    let cart = (await loadCartView(tx, shopId, cartId))!;
    const ids = items.map((i) => (/^\d+$/.test(String(i.id)) ? Number(i.id) : NaN));
    const infos = await variantInfos(tx, shopId, ids.filter(Number.isFinite));
    if (ids.some((id) => !infos.has(id))) return { cart, added: [], error: cannotFindVariant() };

    let error: CartError | undefined;
    const touched: { variantId: number; key: string }[] = [];
    let maxPos = cart.lines.reduce((m, l) => Math.max(m, l.position), 0);
    for (const [idx, item] of items.entries()) {
      const info = infos.get(ids[idx]!)!;
      const qty = toInt(item.quantity, 1);
      const props = cleanProperties(item.properties);
      const planId = planIdOf(item.sellingPlan);
      const planError = await checkPlan(tx, shopId, info, planId);
      if (planError) { error ??= planError; continue; }
      const sellingPlanId = planId === 'invalid' ? null : planId;
      const key = lineKey(info.id, props, sellingPlanId);
      const current = cart.lines.filter((l) => l.variantId === info.id).reduce((n, l) => n + l.quantity, 0);
      if (qty <= 0) {
        if (current >= info.limit) error ??= err(422, 422, 'The maximum quantity of this item is already in your cart.');
        continue;
      }
      if (info.limit <= 0 && current === 0) { error ??= err(422, 422, `The product '${info.productTitle}' is already sold out.`); continue; }
      if (current >= info.limit) { error ??= err(422, 422, 'The maximum quantity of this item is already in your cart.'); continue; }
      const add = Math.min(qty, info.limit - current);
      if (add < qty) error ??= err(422, 422, `Only ${info.limit} items were added to your cart due to availability.`);
      const existing = cart.lines.find((l) => l.key === key);
      if (existing) await tx.update(s.cartLines).set({ quantity: existing.quantity + add }).where(eq(s.cartLines.id, existing.lineId));
      else {
        await tx.insert(s.cartLines).values({ shopId, cartId, variantId: info.id, quantity: add, properties: props, position: ++maxPos, sellingPlanId });
      }
      touched.push({ variantId: info.id, key });
      cart = (await loadCartView(tx, shopId, cartId))!;
    }
    await touch(tx, cartId);
    return { cart, added: touched.map((t) => cart.lines.find((l) => l.key === t.key)!).filter(Boolean), error };
  });
}

export interface ChangeInput { line?: unknown; id?: unknown; quantity?: unknown; properties?: unknown; /** Present (even empty) to change the purchase option: an id, or empty/null for a one-time purchase. */ selling_plan?: unknown }

/** `change.js`: one line (by 1-based `line`, line `key`, or every line of a variant id). Enforces stock. */
export async function changeLine(db: Db, shopId: number, cartId: number, input: ChangeInput): Promise<ChangeResult> {
  return db.transaction(async (tx) => {
    const cart = (await loadCartView(tx, shopId, cartId))!;
    let targets: CartLineView[] = [];
    if (input.line !== undefined && input.line !== null && input.line !== '') {
      const n = toInt(input.line, 0);
      const l = cart.lines[n - 1];
      if (l) targets = [l];
    } else if (input.id !== undefined && input.id !== null) {
      const id = String(input.id);
      targets = id.includes(':') ? cart.lines.filter((l) => l.key === id) : cart.lines.filter((l) => String(l.variantId) === id);
    }
    if (!targets.length) return { cart, deltas: [], error: err(422, 'unprocessable_entity', 'line parameter is invalid.') };

    const deltas: LineDelta[] = [];
    const hasQty = input.quantity !== undefined && input.quantity !== null && input.quantity !== '';
    const qty = hasQty ? Math.max(0, toInt(input.quantity, 0)) : undefined;
    if (qty !== undefined) {
      const infos = await variantInfos(tx, shopId, [...new Set(targets.map((t) => t.variantId))]);
      for (const t of targets) {
        const info = infos.get(t.variantId);
        const others = cart.lines.filter((l) => l.variantId === t.variantId && !targets.includes(l)).reduce((n, l) => n + l.quantity, 0);
        if (info && qty > 0 && others + qty > info.limit && qty > t.quantity) return { cart, deltas: [], error: err(422, 422, `Only ${info.limit} items were added to your cart due to availability.`) };
      }
    }
    const planChange = Object.prototype.hasOwnProperty.call(input, 'selling_plan');
    const planId = planChange ? planIdOf(input.selling_plan) : undefined;
    if (planChange) {
      const infos = await variantInfos(tx, shopId, [...new Set(targets.map((t) => t.variantId))]);
      for (const t of targets) {
        const info = infos.get(t.variantId);
        const e = info ? await checkPlan(tx, shopId, info, planId!) : cannotFindVariant();
        if (e && (qty === undefined || qty > 0)) return { cart, deltas: [], error: e };
      }
    }
    for (const t of targets) {
      const props = input.properties !== undefined ? cleanProperties(input.properties) : undefined;
      const newQty = qty ?? t.quantity;
      if (newQty === 0) await tx.delete(s.cartLines).where(eq(s.cartLines.id, t.lineId));
      else await tx.update(s.cartLines).set({ quantity: newQty, ...(props ? { properties: props } : {}), ...(planChange && planId !== 'invalid' ? { sellingPlanId: planId } : {}) }).where(eq(s.cartLines.id, t.lineId));
      if (newQty !== t.quantity) deltas.push({ line: t, delta: newQty - t.quantity });
    }
    await mergeDuplicateLines(tx, cartId);
    await touch(tx, cartId);
    const after = (await loadCartView(tx, shopId, cartId))!;
    return { cart: after, deltas: deltas.map((d) => ({ ...d, line: after.lines.find((l) => l.lineId === d.line.lineId) ?? d.line })) };
  });
}

/** Lines that end up with the same variant and properties collapse into one (the first one wins). */
async function mergeDuplicateLines(tx: Executor, cartId: number): Promise<void> {
  const rows = await tx.select().from(s.cartLines).where(eq(s.cartLines.cartId, cartId)).orderBy(asc(s.cartLines.position));
  const seen = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const k = lineKey(r.variantId, r.properties, r.sellingPlanId);
    const first = seen.get(k);
    if (!first) { seen.set(k, r); continue; }
    await tx.update(s.cartLines).set({ quantity: first.quantity + r.quantity }).where(eq(s.cartLines.id, first.id));
    first.quantity += r.quantity;
    await tx.delete(s.cartLines).where(eq(s.cartLines.id, r.id));
  }
}

export interface UpdateInput { updates?: unknown; note?: unknown; attributes?: unknown; discount?: unknown }
export interface UpdateResult extends CartResult { added: { variantId: number; quantity: number }[] }

/** `update.js`: bulk quantities (array by position or object by variant id / line key), note, attributes. Ignores stock. */
export async function updateCart(db: Db, shopId: number, cartId: number, input: UpdateInput): Promise<UpdateResult> {
  return db.transaction(async (tx) => {
    const cart = (await loadCartView(tx, shopId, cartId))!;
    const added: UpdateResult['added'] = [];
    const wanted: { line?: CartLineView; variantId?: number; qty: number }[] = [];
    const u = input.updates;
    if (Array.isArray(u)) {
      u.forEach((q, i) => { const l = cart.lines[i]; if (l) wanted.push({ line: l, qty: Math.max(0, toInt(q, l.quantity)) }); });
    } else if (u && typeof u === 'object') {
      const keys = Object.keys(u as object);
      const newIds = keys.filter((k) => !k.includes(':') && !cart.lines.some((l) => String(l.variantId) === k));
      const infos = await variantInfos(tx, shopId, newIds.filter((k) => /^\d+$/.test(k)).map(Number));
      if (newIds.some((k) => !infos.has(Number(k)))) return { cart, added, error: cannotFindVariant() };
      for (const k of keys) {
        const qty = Math.max(0, toInt((u as Record<string, unknown>)[k], 0));
        const lines = k.includes(':') ? cart.lines.filter((l) => l.key === k) : cart.lines.filter((l) => String(l.variantId) === k);
        if (lines.length) for (const l of lines) wanted.push({ line: l, qty });
        else if (!k.includes(':')) wanted.push({ variantId: Number(k), qty });
        else return { cart, added, error: cannotFindVariant() };
      }
    }
    let maxPos = cart.lines.reduce((m, l) => Math.max(m, l.position), 0);
    for (const w of wanted) {
      if (w.line) {
        if (w.qty === 0) await tx.delete(s.cartLines).where(eq(s.cartLines.id, w.line.lineId));
        else await tx.update(s.cartLines).set({ quantity: w.qty }).where(eq(s.cartLines.id, w.line.lineId));
        if (w.qty > w.line.quantity) added.push({ variantId: w.line.variantId, quantity: w.qty - w.line.quantity });
      } else if (w.qty > 0) {
        await tx.insert(s.cartLines).values({ shopId, cartId, variantId: w.variantId!, quantity: w.qty, properties: {}, position: ++maxPos });
        added.push({ variantId: w.variantId!, quantity: w.qty });
      }
    }
    const patch: Partial<typeof s.carts.$inferInsert> = { updatedAt: new Date() };
    if (typeof input.note === 'string') patch.note = input.note;
    if (input.attributes && typeof input.attributes === 'object') {
      const attrs = { ...cart.attributes };
      for (const [k, v] of Object.entries(input.attributes as Record<string, unknown>)) {
        if (v === '' || v === null || v === undefined) delete attrs[k]; else attrs[k] = String(v);
      }
      patch.attributes = attrs;
    }
    if (typeof input.discount === 'string') patch.discountCodes = input.discount.split(',').map((c) => c.trim()).filter(Boolean);
    await tx.update(s.carts).set(patch).where(eq(s.carts.id, cartId));
    return { cart: (await loadCartView(tx, shopId, cartId))!, added };
  });
}

/** `clear.js`: removes lines only; the token, note and attributes are kept. */
export async function clearCart(db: Db, shopId: number, cartId: number): Promise<CartView> {
  await db.delete(s.cartLines).where(and(eq(s.cartLines.cartId, cartId), eq(s.cartLines.shopId, shopId)));
  await touch(db, cartId);
  return (await loadCartView(db, shopId, cartId))!;
}

export const cartBadRequest = (message: string, description = message): CartError => ({ httpStatus: 400, status: 'bad_request', message, description });
