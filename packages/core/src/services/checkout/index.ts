import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db, Executor } from '../../db/client';
import * as s from '../../db/schema';
import type { Shop } from '../shops';
import { loadCartView, type CartLineView, type CartView } from '../cart/service';
import { createOrder, type CheckoutAddressInput, type CreateOrderResult } from '../orders/create';
import {
  matchShippingRates, priceCheckout, type PricingDiscount, type PricingInput, type PricingLine, type PricingResult, type PricingShippingRate, type PricingTaxRate,
} from '../pricing';

/** A checkout is the cart row plus the buyer's details (email, address, chosen shipping rate, discount codes). */

export type DiscountRejection = 'not_found' | 'disabled' | 'not_started' | 'expired' | 'usage_limit' | 'minimum_subtotal' | 'minimum_quantity' | 'already_used' | 'not_applicable';

export interface CheckoutView {
  token: string;
  currency: string;
  taxesIncluded: boolean;
  email: string | null;
  address: CheckoutAddressInput | null;
  lines: CartLineView[];
  requiresShipping: boolean;
  shippingOptions: PricingShippingRate[];
  shippingRateId: number | null;
  appliedDiscounts: { code: string | null; title: string }[];
  rejectedCodes: { code: string; reason: DiscountRejection }[];
  /** Variants whose stock is below the quantity in the cart. */
  stockIssues: { variantId: number; title: string; available: number }[];
  pricing: PricingResult;
  completed: boolean;
}

const norm = (c: string) => c.trim().toUpperCase();
const lc = (e: string | null | undefined) => (e ?? '').trim().toLowerCase();
export const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

// ---------------------------------------------------------------------------------------------------------------------
// Discounts
// ---------------------------------------------------------------------------------------------------------------------

interface DiscountRow { d: typeof s.discounts.$inferSelect; code: string | null }

/** Validate codes (and apply active automatic discounts) against the cart lines. */
export async function evaluateDiscounts(
  db: Executor, shopId: number, codes: string[], ctx: { lines: PricingLine[]; email: string | null; now?: Date },
): Promise<{ applied: PricingDiscount[]; rejected: { code: string; reason: DiscountRejection }[] }> {
  const now = ctx.now ?? new Date();
  const applied: PricingDiscount[] = [];
  const rejected: { code: string; reason: DiscountRejection }[] = [];
  const rows: (DiscountRow & { requested: string | null })[] = [];
  const wanted = [...new Set(codes.map(norm).filter(Boolean))];
  if (wanted.length) {
    const found = await db.select({ d: s.discounts, code: s.discountCodes.code }).from(s.discountCodes)
      .innerJoin(s.discounts, eq(s.discounts.id, s.discountCodes.discountId)).where(and(eq(s.discountCodes.shopId, shopId), inArray(s.discountCodes.code, wanted)));
    for (const c of wanted) { const f = found.find((x) => x.code === c); if (f) rows.push({ ...f, requested: c }); else rejected.push({ code: c, reason: 'not_found' }); }
  }
  const auto = await db.select().from(s.discounts).where(and(eq(s.discounts.shopId, shopId), eq(s.discounts.kind, 'AUTOMATIC'), eq(s.discounts.status, 'ACTIVE')));
  for (const d of auto) rows.push({ d, code: null, requested: null });

  const email = lc(ctx.email);
  for (const { d, code, requested } of rows) {
    const reject = (reason: DiscountRejection) => { if (requested) rejected.push({ code: requested, reason }); };
    const pd: PricingDiscount = { id: d.id, code, title: d.title, valueType: d.valueType as PricingDiscount['valueType'], value: d.value, target: d.target as PricingDiscount['target'], appliesTo: d.appliesTo };
    if (d.status === 'DISABLED') { reject('disabled'); continue; }
    if (d.startsAt && d.startsAt > now) { reject('not_started'); continue; }
    if (d.endsAt && d.endsAt < now) { reject('expired'); continue; }
    if (d.usageLimit !== null && d.usageCount >= d.usageLimit) { reject('usage_limit'); continue; }
    const eligible = pd.target === 'SHIPPING' || pd.target === 'ORDER' ? ctx.lines : ctx.lines.filter((l) => {
      const { productIds = [], collectionIds = [] } = d.appliesTo;
      return productIds.includes(l.productId) || l.collectionIds.some((c) => collectionIds.includes(c));
    });
    if (!eligible.length) { reject('not_applicable'); continue; }
    if (d.minimumSubtotal !== null && eligible.reduce((a, l) => a + l.unitPrice * l.quantity, 0) < d.minimumSubtotal) { reject('minimum_subtotal'); continue; }
    if (d.minimumQuantity !== null && eligible.reduce((a, l) => a + l.quantity, 0) < d.minimumQuantity) { reject('minimum_quantity'); continue; }
    if (d.oncePerCustomer && email) {
      const [used] = await db.select({ n: sql<number>`count(*)::int` }).from(s.orderDiscountApplications)
        .innerJoin(s.orders, eq(s.orders.id, s.orderDiscountApplications.orderId))
        .where(and(eq(s.orderDiscountApplications.shopId, shopId), eq(s.orderDiscountApplications.discountId, d.id), eq(s.orders.email, email), isNull(s.orders.cancelledAt)));
      if ((used?.n ?? 0) > 0) { reject('already_used'); continue; }
    }
    applied.push(pd);
  }
  return { applied, rejected };
}

// ---------------------------------------------------------------------------------------------------------------------
// Shipping
// ---------------------------------------------------------------------------------------------------------------------

/** Rates the buyer can pick for a destination: the zone listing the country (and province), else the rest-of-world zone. */
export async function shippingOptionsFor(db: Executor, shopId: number, dest: { countryCode: string | null; provinceCode: string | null }, cart: { subtotal: number; grams: number }): Promise<PricingShippingRate[]> {
  if (!dest.countryCode) return [];
  const code = dest.countryCode.toUpperCase();
  const prov = (dest.provinceCode ?? '').toUpperCase();
  const rows = await db.select().from(s.shippingZoneCountries).where(and(eq(s.shippingZoneCountries.shopId, shopId), inArray(s.shippingZoneCountries.countryCode, [code, '*'])));
  const specific = rows.find((r) => r.countryCode === code && (!r.provinceCodes.length || r.provinceCodes.map((p) => p.toUpperCase()).includes(prov)));
  const zone = specific ?? rows.find((r) => r.countryCode === '*');
  if (!zone) return [];
  const rates = await db.select().from(s.shippingRates).where(and(eq(s.shippingRates.zoneId, zone.zoneId), eq(s.shippingRates.active, true)));
  return matchShippingRates(rates, cart);
}

/** Country codes that can be shipped to (`'*'` means any). */
export async function shippableCountries(db: Executor, shopId: number): Promise<string[]> {
  const rows = await db.select({ c: s.shippingZoneCountries.countryCode }).from(s.shippingZoneCountries)
    .innerJoin(s.shippingRates, and(eq(s.shippingRates.zoneId, s.shippingZoneCountries.zoneId), eq(s.shippingRates.active, true))).where(eq(s.shippingZoneCountries.shopId, shopId));
  return [...new Set(rows.map((r) => r.c))];
}

// ---------------------------------------------------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------------------------------------------------

async function stockIssuesFor(db: Executor, shopId: number, lines: CartLineView[]): Promise<CheckoutView['stockIssues']> {
  const ids = [...new Set(lines.map((l) => l.variantId))];
  if (!ids.length) return [];
  const rows = await db.select({ id: s.productVariants.id, policy: s.productVariants.inventoryPolicy, itemId: s.inventoryItems.id, tracked: s.inventoryItems.tracked })
    .from(s.productVariants).leftJoin(s.inventoryItems, eq(s.inventoryItems.variantId, s.productVariants.id))
    .where(and(eq(s.productVariants.shopId, shopId), inArray(s.productVariants.id, ids)));
  const itemIds = rows.flatMap((r) => (r.itemId ? [r.itemId] : []));
  const stock = new Map<number, number>();
  if (itemIds.length) {
    const lv = await db.select({ itemId: s.inventoryLevels.inventoryItemId, n: sql<number>`coalesce(sum(${s.inventoryLevels.available}), 0)::int` })
      .from(s.inventoryLevels).where(and(inArray(s.inventoryLevels.inventoryItemId, itemIds), eq(s.inventoryLevels.isActive, true))).groupBy(s.inventoryLevels.inventoryItemId);
    for (const l of lv) stock.set(l.itemId, l.n);
  }
  const issues: CheckoutView['stockIssues'] = [];
  for (const id of ids) {
    const r = rows.find((x) => x.id === id);
    const want = lines.filter((l) => l.variantId === id).reduce((n, l) => n + l.quantity, 0);
    const title = lines.find((l) => l.variantId === id)!.product.title;
    if (!r) { issues.push({ variantId: id, title, available: 0 }); continue; }
    if (r.policy === 'CONTINUE' || !r.itemId || r.tracked === false) continue;
    const available = Math.max(0, stock.get(r.itemId) ?? 0);
    if (available < want) issues.push({ variantId: id, title, available });
  }
  return issues;
}

// ---------------------------------------------------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------------------------------------------------

const toPricingLines = (lines: CartLineView[], collections: Map<number, number[]>): PricingLine[] => lines.map((l) => ({
  id: l.lineId, unitPrice: l.price, quantity: l.quantity, taxable: l.taxable, requiresShipping: l.requiresShipping, grams: l.grams * l.quantity, productId: l.productId, collectionIds: collections.get(l.productId) ?? [],
}));

async function collectionsOf(db: Executor, shopId: number, productIds: number[]): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>();
  if (!productIds.length) return out;
  const rows = await db.select({ p: s.collectionProducts.productId, c: s.collectionProducts.collectionId }).from(s.collectionProducts)
    .where(and(eq(s.collectionProducts.shopId, shopId), inArray(s.collectionProducts.productId, productIds)));
  for (const r of rows) out.set(r.p, [...(out.get(r.p) ?? []), r.c]);
  return out;
}

async function cartRowByToken(db: Executor, shopId: number, token: string) {
  const [c] = await db.select().from(s.carts).where(and(eq(s.carts.shopId, shopId), eq(s.carts.token, token))).limit(1);
  return c ?? null;
}

/** Everything the checkout page needs, priced. Null when the token is unknown. */
export async function loadCheckout(db: Executor, shop: Shop, token: string, now = new Date()): Promise<CheckoutView | null> {
  const row = await cartRowByToken(db, shop.id, token);
  if (!row) return null;
  const cart = (await loadCartView(db, shop.id, row.id))!;
  const address = (row.shippingAddress ?? row.billingAddress ?? null) as CheckoutAddressInput | null;
  const collections = await collectionsOf(db, shop.id, [...new Set(cart.lines.map((l) => l.productId))]);
  const plines = toPricingLines(cart.lines, collections);
  const { applied, rejected } = await evaluateDiscounts(db, shop.id, cart.discountCodes, { lines: plines, email: row.email, now });

  const requiresShipping = cart.lines.some((l) => l.requiresShipping);
  const shippable = plines.filter((l) => l.requiresShipping);
  const options = requiresShipping
    ? await shippingOptionsFor(db, shop.id, { countryCode: address?.countryCode ?? null, provinceCode: address?.provinceCode ?? null }, { subtotal: shippable.reduce((a, l) => a + l.unitPrice * l.quantity, 0), grams: shippable.reduce((a, l) => a + l.grams, 0) })
    : [];
  const chosen = options.find((o) => o.id === row.shippingRateId) ?? options[0] ?? null;

  const taxRows = address?.countryCode ? await db.select().from(s.taxRates).where(and(eq(s.taxRates.shopId, shop.id), eq(s.taxRates.active, true), eq(s.taxRates.countryCode, address.countryCode.toUpperCase()))) : [];
  const taxRates: PricingTaxRate[] = taxRows.map((r) => ({ name: r.name, countryCode: r.countryCode, provinceCode: r.provinceCode, rate: r.rate, appliesToShipping: r.appliesToShipping, priority: r.priority }));
  let taxExempt = false;
  if (row.email) { const [c] = await db.select({ t: s.customers.taxExempt }).from(s.customers).where(and(eq(s.customers.shopId, shop.id), eq(s.customers.email, lc(row.email)))).limit(1); taxExempt = !!c?.t; }

  const input: PricingInput = { lines: plines, discounts: applied, shipping: chosen, taxRates, taxesIncluded: shop.taxesIncluded, taxExempt, country: address?.countryCode ?? null, province: address?.provinceCode ?? null };
  return {
    token, currency: cart.currency, taxesIncluded: shop.taxesIncluded, email: row.email, address, lines: cart.lines, requiresShipping,
    shippingOptions: options, shippingRateId: chosen?.id ?? null,
    appliedDiscounts: applied.map((d) => ({ code: d.code, title: d.title })), rejectedCodes: rejected,
    stockIssues: await stockIssuesFor(db, shop.id, cart.lines), pricing: priceCheckout(input), completed: !!row.completedAt,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Updating
// ---------------------------------------------------------------------------------------------------------------------

export interface CheckoutPatch {
  email?: string | null;
  address?: CheckoutAddressInput | null;
  shippingRateId?: number | null;
  addDiscountCode?: string;
  removeDiscountCode?: string;
}

const ADDRESS_KEYS = ['firstName', 'lastName', 'company', 'address1', 'address2', 'city', 'province', 'provinceCode', 'zip', 'country', 'countryCode', 'phone'] as const;

export function cleanAddress(a: Record<string, unknown> | null | undefined): CheckoutAddressInput | null {
  if (!a) return null;
  const out: Record<string, string | null> = {};
  for (const k of ADDRESS_KEYS) { const v = a[k]; out[k] = typeof v === 'string' && v.trim() ? v.trim().slice(0, 255) : null; }
  if (out.countryCode) out.countryCode = out.countryCode.toUpperCase();
  if (out.provinceCode) out.provinceCode = out.provinceCode.toUpperCase();
  return out as CheckoutAddressInput;
}

export type CheckoutUpdateResult = { ok: true } | { ok: false; error: 'not_found' | 'completed' | 'invalid_email' | DiscountRejection };

/** Persist what the buyer entered. Discount codes are validated before being stored. */
export async function updateCheckout(db: Db, shop: Shop, token: string, patch: CheckoutPatch): Promise<CheckoutUpdateResult> {
  const row = await cartRowByToken(db, shop.id, token);
  if (!row) return { ok: false, error: 'not_found' };
  if (row.completedAt) return { ok: false, error: 'completed' };
  const set: Partial<typeof s.carts.$inferInsert> = {};
  if (patch.email !== undefined) {
    if (patch.email && !isEmail(patch.email)) return { ok: false, error: 'invalid_email' };
    set.email = patch.email ? lc(patch.email) : null;
  }
  if (patch.address !== undefined) { set.shippingAddress = patch.address; set.billingAddress = patch.address; }
  if (patch.shippingRateId !== undefined) set.shippingRateId = patch.shippingRateId;
  if (patch.removeDiscountCode) set.discountCodes = row.discountCodes.filter((c) => norm(c) !== norm(patch.removeDiscountCode!));
  if (patch.addDiscountCode?.trim()) {
    const code = norm(patch.addDiscountCode);
    const cart = (await loadCartView(db, shop.id, row.id))!;
    const pl = toPricingLines(cart.lines, await collectionsOf(db, shop.id, cart.lines.map((l) => l.productId)));
    const r = await evaluateDiscounts(db, shop.id, [code], { lines: pl, email: set.email === undefined ? row.email : set.email });
    const bad = r.rejected.find((x) => x.code === code);
    if (bad) return { ok: false, error: bad.reason };
    if (!row.discountCodes.some((c) => norm(c) === code)) set.discountCodes = [...row.discountCodes, code];
  }
  if (Object.keys(set).length) await db.update(s.carts).set(set).where(eq(s.carts.id, row.id));
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// Submitting
// ---------------------------------------------------------------------------------------------------------------------

export type CheckoutError =
  | { code: 'not_found' | 'completed' | 'empty' | 'email' | 'shipping_method' | 'payment_method' | 'discount' }
  | { code: 'address'; fields: string[] }
  | { code: 'stock'; issues: CheckoutView['stockIssues'] };

export interface SubmitInput {
  paymentMethod: string;
  /** Methods currently offered (ids). */
  allowedMethods: string[];
  acceptsMarketing?: boolean;
  note?: string | null;
  /** Shipping rate the buyer saw selected; must still be offered. */
  shippingRateId?: number | null;
  /** Starts an online payment for the final total and returns its provider reference (called after validation, before the order exists). */
  startOnlinePayment?: (checkout: CheckoutView) => Promise<string>;
}

export type SubmitResult =
  | { ok: true; orderId: number; orderNumber: number; name: string; total: number; currency: string; paid: boolean; needsOnlinePayment: boolean; paymentId: string | null; email: string; checkout: CheckoutView }
  | { ok: false; errors: CheckoutError[] };

const REQUIRED_ADDRESS = ['firstName', 'lastName', 'address1', 'city', 'zip', 'countryCode'] as const;

/** Validate everything again (stock, discounts, shipping, address) and create the order. */
export async function submitCheckout(db: Db, shop: Shop, token: string, input: SubmitInput): Promise<SubmitResult> {
  const row = await cartRowByToken(db, shop.id, token);
  if (!row) return { ok: false, errors: [{ code: 'not_found' }] };
  if (row.completedAt) return { ok: false, errors: [{ code: 'completed' }] };
  const view = (await loadCheckout(db, shop, token))!;
  const errors: CheckoutError[] = [];
  if (!view.lines.length) return { ok: false, errors: [{ code: 'empty' }] };
  if (!row.email || !isEmail(row.email)) errors.push({ code: 'email' });
  const missing = REQUIRED_ADDRESS.filter((k) => !view.address?.[k]);
  if (missing.length) errors.push({ code: 'address', fields: missing });
  if (view.requiresShipping && !missing.length) {
    const wanted = input.shippingRateId ?? view.shippingRateId;
    if (!view.shippingOptions.some((o) => o.id === wanted)) errors.push({ code: 'shipping_method' });
  }
  if (view.rejectedCodes.length) errors.push({ code: 'discount' });
  if (view.stockIssues.length) errors.push({ code: 'stock', issues: view.stockIssues });
  const free = view.pricing.total === 0;
  if (!free && !input.allowedMethods.includes(input.paymentMethod)) errors.push({ code: 'payment_method' });
  if (errors.length) return { ok: false, errors };

  // Honour the rate the buyer picked (it is one of the offered ones); price again if it differs from the default.
  let checkout = view;
  if (view.requiresShipping && input.shippingRateId && input.shippingRateId !== view.shippingRateId) {
    await db.update(s.carts).set({ shippingRateId: input.shippingRateId }).where(eq(s.carts.id, row.id));
    checkout = (await loadCheckout(db, shop, token))!;
  }
  const cart = (await loadCartView(db, shop.id, row.id)) as CartView;
  const byId = new Map(cart.lines.map((l) => [l.lineId, l]));
  const online = !free && input.paymentMethod === 'stripe';
  const gateway = free ? 'free' : input.paymentMethod;
  const paymentId = online && input.startOnlinePayment ? await input.startOnlinePayment(checkout) : null;
  const res: CreateOrderResult = await createOrder(db, shop.id, {
    email: row.email!, phone: checkout.address?.phone ?? null, acceptsMarketing: input.acceptsMarketing, currency: cart.currency, taxesIncluded: shop.taxesIncluded,
    lines: checkout.pricing.lines.map((p) => {
      const l = byId.get(p.id)!;
      return {
        id: l.lineId, unitPrice: l.price, quantity: l.quantity, taxable: l.taxable, requiresShipping: l.requiresShipping, grams: l.grams * l.quantity, productId: l.productId, collectionIds: [],
        variantId: l.variantId, title: l.product.title, variantTitle: l.hasOnlyDefaultVariant ? null : l.variantTitle, sku: l.sku || null, vendor: l.product.vendor || null,
        imageUrl: l.image?.url ?? null, isGiftCard: l.product.isGiftCard, properties: l.properties,
      };
    }),
    pricing: checkout.pricing,
    shippingAddress: checkout.requiresShipping ? checkout.address : null, billingAddress: checkout.address,
    payment: { gateway, status: free ? 'PAID' : 'PENDING', paymentId },
    cartToken: token, note: input.note ?? row.note,
  });
  if (!res.ok) {
    if (res.error === 'out_of_stock') return { ok: false, errors: [{ code: 'stock', issues: (await loadCheckout(db, shop, token))!.stockIssues }] };
    if (res.error === 'discount_unavailable') return { ok: false, errors: [{ code: 'discount' }] };
    return { ok: false, errors: [{ code: 'completed' }] };
  }
  return { ok: true, orderId: res.orderId, orderNumber: res.orderNumber, name: res.name, total: checkout.pricing.total, currency: cart.currency, paid: free, needsOnlinePayment: online, paymentId, email: row.email!, checkout };
}

/** Checkouts left open for a while (kept as abandoned carts; listed for the merchant, never deleted here). */
export async function listAbandonedCheckouts(db: Executor, shopId: number, olderThanMs = 60 * 60 * 1000, limit = 100) {
  const cutoff = new Date(Date.now() - olderThanMs);
  return db.select().from(s.carts).where(and(eq(s.carts.shopId, shopId), isNull(s.carts.completedAt), sql`${s.carts.email} is not null`, sql`${s.carts.updatedAt} < ${cutoff}`)).orderBy(asc(s.carts.updatedAt)).limit(limit);
}
