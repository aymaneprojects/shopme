import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db, Executor } from '../../db/client';
import * as s from '../../db/schema';
import type { Shop } from '../shops';
import { loadCartView, type CartLineView, type CartView } from '../cart/service';
import { completeDraftFromCheckout } from '../draft-orders';
import { createOrder, type CheckoutAddressInput, type CreateOrderResult } from '../orders/create';
import {
  matchShippingRates, priceCheckout, resolveCombinations, type DiscountApplication, type PricingDiscount, type PricingInput, type PricingLine, type PricingResult, type PricingShippingRate, type PricingTaxRate,
} from '../pricing';
import { discountEligibleFor } from '../discounts/eligibility';
import { allocateGiftCards, getGiftCardByCode, giftCardRejection, normalizeGiftCardCode, type GiftCardRejection } from '../gift-cards';
import { subscribeEmail } from '../privacy/marketing';
import { planStoreCredit, setUseStoreCredit, storeCreditEnabled, NO_STORE_CREDIT, type StoreCreditTender } from '../store-credit';
import { checkoutSettingsOf, isPhone, requiredAddressKeys, stripHiddenAddressFields, tipFor, type CheckoutSettings } from './settings';

export * from './settings';

/** A checkout is the cart row plus the buyer's details (email, address, chosen shipping rate, discount codes). */

export type DiscountRejection = 'not_found' | 'disabled' | 'not_started' | 'expired' | 'usage_limit' | 'minimum_subtotal' | 'minimum_quantity' | 'already_used' | 'not_applicable' | 'not_combinable' | 'not_eligible';

export interface CheckoutView {
  token: string;
  currency: string;
  taxesIncluded: boolean;
  email: string | null;
  address: CheckoutAddressInput | null;
  /** Cart note (shown as the order note when the shop turns "Order notes" on). */
  note: string | null;
  /** Checkout settings in force (fields to show and validate). */
  settings: CheckoutSettings;
  /** Tip added by the buyer (minor units) and the choice behind it. */
  tip: number;
  tipChoice: { percent: number | null; amount: number };
  lines: CartLineView[];
  requiresShipping: boolean;
  shippingOptions: PricingShippingRate[];
  shippingRateId: number | null;
  appliedDiscounts: { code: string | null; title: string }[];
  rejectedCodes: { code: string; reason: DiscountRejection }[];
  /** Gift cards entered by the buyer and what each one pays. */
  giftCards: { id: number; code: string; lastCharacters: string; applied: number; balance: number }[];
  giftCardTotal: number;
  /** Store credit of the signed-in buyer (tender after gift cards): balance, the checkbox and the amount applied. */
  storeCredit: StoreCreditTender;
  /** Total after gift cards and store credit: what the payment method has to collect. */
  amountDue: number;
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
  db: Executor, shopId: number, codes: string[], ctx: { lines: PricingLine[]; email: string | null; now?: Date; shippingPrice?: number },
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

  const exts = rows.length ? await db.select().from(s.discountExtensions).where(inArray(s.discountExtensions.discountId, rows.map((r) => r.d.id))) : [];
  const email = lc(ctx.email);
  for (const { d, code, requested } of rows) {
    const reject = (reason: DiscountRejection) => { if (requested) rejected.push({ code: requested, reason }); };
    const ext = exts.find((e) => e.discountId === d.id);
    const pd: PricingDiscount = {
      id: d.id, code, title: d.title, valueType: d.valueType as PricingDiscount['valueType'], value: d.value, target: d.target as PricingDiscount['target'], appliesTo: d.appliesTo,
      combinesWith: ext?.combinesWith, ...(ext?.bxgy && { bxgy: ext.bxgy }),
    };
    if (d.status === 'DISABLED') { reject('disabled'); continue; }
    if (d.startsAt && d.startsAt > now) { reject('not_started'); continue; }
    if (d.endsAt && d.endsAt < now) { reject('expired'); continue; }
    if (d.usageLimit !== null && d.usageCount >= d.usageLimit) { reject('usage_limit'); continue; }
    if (!(await discountEligibleFor(db, shopId, ext, email))) { reject('not_eligible'); continue; }
    const scope = (sc: { productIds?: number[]; collectionIds?: number[] }) => (l: PricingLine) => !!sc.productIds?.includes(l.productId) || l.collectionIds.some((c) => !!sc.collectionIds?.includes(c));
    const eligible = pd.target === 'SHIPPING' || pd.target === 'ORDER' ? ctx.lines : ctx.lines.filter(scope(pd.bxgy?.buyAppliesTo ?? d.appliesTo));
    if (!eligible.length) { reject('not_applicable'); continue; }
    if (pd.bxgy) {
      const buys = ctx.lines.filter(scope(pd.bxgy.buyAppliesTo)).reduce((a, l) => a + l.quantity, 0);
      const overlap = ctx.lines.some((l) => scope(pd.bxgy!.buyAppliesTo)(l) && scope(pd.bxgy!.getAppliesTo)(l));
      const gets = ctx.lines.filter(scope(pd.bxgy.getAppliesTo)).reduce((a, l) => a + l.quantity, 0);
      if (buys < pd.bxgy.buyQuantity || gets < 1 || (overlap && buys < pd.bxgy.buyQuantity + pd.bxgy.getQuantity)) { reject('not_applicable'); continue; }
    }
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
  const { chosen, dropped } = resolveCombinations(applied, ctx.lines, ctx.shippingPrice ?? 0);
  for (const d of dropped) if (d.code) rejected.push({ code: d.code, reason: 'not_combinable' });
  return { applied: chosen, rejected };
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

export interface CartDiscounts {
  /** Applications visible in the cart (product and order discounts; shipping discounts need an address and show at checkout). */
  applications: DiscountApplication[];
  rejected: { code: string; reason: DiscountRejection }[];
  /** Sum of all applications (line level and cart level). */
  totalDiscount: number;
}

/** Discounts as the cart shows them (Ajax `/cart.js`, Liquid `cart`): same evaluation and allocation as checkout, without address, shipping or tax. */
export async function priceCartDiscounts(db: Executor, shopId: number, cart: CartView, email: string | null = null): Promise<CartDiscounts> {
  if (!cart.lines.length) return { applications: [], rejected: [], totalDiscount: 0 };
  const lines = toPricingLines(cart.lines, await collectionsOf(db, shopId, [...new Set(cart.lines.map((l) => l.productId))]));
  const { applied, rejected } = await evaluateDiscounts(db, shopId, cart.discountCodes, { lines, email });
  const r = priceCheckout({ lines, discounts: applied.filter((d) => d.target !== 'SHIPPING'), shipping: null, taxRates: [], taxesIncluded: false, country: null, province: null });
  const applications = r.discountApplications.filter((a) => a.allocated > 0);
  return { applications, rejected, totalDiscount: applications.reduce((n, a) => n + a.allocated, 0) };
}

/** Everything the checkout page needs, priced. Null when the token is unknown. */
export async function loadCheckout(db: Executor, shop: Shop, token: string, now = new Date(), opts: { customerId?: number | null } = {}): Promise<CheckoutView | null> {
  const row = await cartRowByToken(db, shop.id, token);
  if (!row) return null;
  const cart = (await loadCartView(db, shop.id, row.id))!;
  const address = (row.shippingAddress ?? row.billingAddress ?? null) as CheckoutAddressInput | null;
  const collections = await collectionsOf(db, shop.id, [...new Set(cart.lines.map((l) => l.productId))]);
  const plines = toPricingLines(cart.lines, collections);

  const requiresShipping = cart.lines.some((l) => l.requiresShipping);
  const shippable = plines.filter((l) => l.requiresShipping);
  const options = requiresShipping
    ? await shippingOptionsFor(db, shop.id, { countryCode: address?.countryCode ?? null, provinceCode: address?.provinceCode ?? null }, { subtotal: shippable.reduce((a, l) => a + l.unitPrice * l.quantity, 0), grams: shippable.reduce((a, l) => a + l.grams, 0) })
    : [];
  const chosen = options.find((o) => o.id === row.shippingRateId) ?? options[0] ?? null;
  const { applied, rejected } = await evaluateDiscounts(db, shop.id, cart.discountCodes, { lines: plines, email: row.email, now, shippingPrice: chosen?.price ?? 0 });

  const taxRows = address?.countryCode ? await db.select().from(s.taxRates).where(and(eq(s.taxRates.shopId, shop.id), eq(s.taxRates.active, true), eq(s.taxRates.countryCode, address.countryCode.toUpperCase()))) : [];
  const taxRates: PricingTaxRate[] = taxRows.map((r) => ({ name: r.name, countryCode: r.countryCode, provinceCode: r.provinceCode, rate: r.rate, appliesToShipping: r.appliesToShipping, priority: r.priority }));
  let taxExempt = false;
  if (row.email) { const [c] = await db.select({ t: s.customers.taxExempt }).from(s.customers).where(and(eq(s.customers.shopId, shop.id), eq(s.customers.email, lc(row.email)))).limit(1); taxExempt = !!c?.t; }

  const input: PricingInput = { lines: plines, discounts: applied, shipping: chosen, taxRates, taxesIncluded: shop.taxesIncluded, taxExempt, country: address?.countryCode ?? null, province: address?.provinceCode ?? null };
  const pricing = priceCheckout(input);
  const meta = await metaOf(db, row.id);
  const gift = await giftCardsFor(db, shop.id, meta, cart, pricing, now);
  const settings = checkoutSettingsOf(shop);
  const tipChoice = { percent: meta?.tipPercent ?? null, amount: meta?.tipAmount ?? 0 };
  const tip = settings.tipping.enabled ? tipFor(Math.max(0, pricing.subtotal - pricing.totalDiscounts), tipChoice) : 0;
  const dueAfterGift = pricing.total - gift.total + tip;
  const giftProductTotal = pricing.lines.filter((l) => cart.lines.some((c) => c.lineId === l.id && c.product.isGiftCard)).reduce((n, l) => n + l.total, 0);
  const credit = storeCreditEnabled(shop) && opts.customerId
    ? await planStoreCredit(db, shop, { customerId: opts.customerId, currency: cart.currency, payable: Math.max(0, dueAfterGift - giftProductTotal), use: meta?.useStoreCredit !== false, now })
    : NO_STORE_CREDIT;
  return {
    token, currency: cart.currency, taxesIncluded: shop.taxesIncluded, email: row.email, address, note: row.note, settings, tip, tipChoice, lines: cart.lines, requiresShipping,
    shippingOptions: options, shippingRateId: chosen?.id ?? null,
    appliedDiscounts: applied.map((d) => ({ code: d.code, title: d.title })), rejectedCodes: rejected,
    giftCards: gift.cards, giftCardTotal: gift.total, storeCredit: credit, amountDue: dueAfterGift - credit.applied, stockIssues: await stockIssuesFor(db, shop.id, cart.lines), pricing, completed: !!row.completedAt,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Gift cards (payment method)
// ---------------------------------------------------------------------------------------------------------------------

async function metaOf(db: Executor, cartId: number) {
  const [m] = await db.select().from(s.checkoutMeta).where(eq(s.checkoutMeta.cartId, cartId)).limit(1);
  return m ?? null;
}

/** Cards on the checkout that are still usable, and what each pays. Gift cards cannot pay for gift card products. */
async function giftCardsFor(db: Executor, shopId: number, meta: Awaited<ReturnType<typeof metaOf>>, cart: CartView, pricing: PricingResult, now: Date) {
  const codes = meta?.giftCardCodes ?? [];
  if (!codes.length) return { cards: [] as CheckoutView['giftCards'], total: 0, allocations: [] as { giftCardId: number; amount: number }[] };
  const rows = (await db.select().from(s.giftCards).where(and(eq(s.giftCards.shopId, shopId), inArray(s.giftCards.code, codes)))).filter((c) => !giftCardRejection(c, cart.currency, now));
  rows.sort((a, b) => codes.indexOf(a.code) - codes.indexOf(b.code));
  const giftLines = new Set(cart.lines.filter((l) => l.product.isGiftCard).map((l) => l.lineId));
  const payable = pricing.total - pricing.lines.filter((l) => giftLines.has(l.id)).reduce((n, l) => n + l.total, 0);
  const allocations = allocateGiftCards(rows, payable);
  const cards = rows.map((c) => ({ id: c.id, code: c.code, lastCharacters: c.code.slice(-4), applied: allocations.find((a) => a.giftCardId === c.id)?.amount ?? 0, balance: c.balance }));
  return { cards, total: allocations.reduce((n, a) => n + a.amount, 0), allocations };
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
  addGiftCardCode?: string;
  removeGiftCardCode?: string;
  /** Tip choice: a preset percentage, or a custom amount (minor units). Either clears the other. */
  tipPercent?: number | null;
  tipAmount?: number;
  /** The buyer's "use store credit" checkbox. */
  useStoreCredit?: boolean;
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

export type CheckoutUpdateResult = { ok: true } | { ok: false; error: 'not_found' | 'completed' | 'invalid_email' | DiscountRejection | GiftCardRejection };

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
  if (patch.address !== undefined) {
    const a = stripHiddenAddressFields(patch.address, checkoutSettingsOf(shop));
    set.shippingAddress = a; set.billingAddress = a;
  }
  if (patch.shippingRateId !== undefined) set.shippingRateId = patch.shippingRateId;
  if (patch.removeDiscountCode) set.discountCodes = row.discountCodes.filter((c) => norm(c) !== norm(patch.removeDiscountCode!));
  if (patch.addDiscountCode?.trim()) {
    const code = norm(patch.addDiscountCode);
    const cart = (await loadCartView(db, shop.id, row.id))!;
    const pl = toPricingLines(cart.lines, await collectionsOf(db, shop.id, cart.lines.map((l) => l.productId)));
    // Validate with the codes already on the checkout, so a code that cannot combine with them is refused.
    const r = await evaluateDiscounts(db, shop.id, [...new Set([...(set.discountCodes ?? row.discountCodes), code])], { lines: pl, email: set.email === undefined ? row.email : set.email });
    const bad = r.rejected.find((x) => x.code === code);
    if (bad) return { ok: false, error: bad.reason };
    if (!(set.discountCodes ?? row.discountCodes).some((c) => norm(c) === code)) set.discountCodes = [...(set.discountCodes ?? row.discountCodes), code];
  }
  if (patch.addGiftCardCode?.trim() || patch.removeGiftCardCode) {
    const codes = (await metaOf(db, row.id))?.giftCardCodes ?? [];
    let next = patch.removeGiftCardCode ? codes.filter((c) => c !== normalizeGiftCardCode(patch.removeGiftCardCode!)) : codes;
    if (patch.addGiftCardCode?.trim()) {
      const card = await getGiftCardByCode(db, shop.id, patch.addGiftCardCode);
      const bad = giftCardRejection(card, row.currency);
      if (bad) return { ok: false, error: bad };
      if (!next.includes(card!.code)) next = [...next, card!.code];
    }
    await db.insert(s.checkoutMeta).values({ cartId: row.id, shopId: shop.id, giftCardCodes: next }).onConflictDoUpdate({ target: s.checkoutMeta.cartId, set: { giftCardCodes: next } });
  }
  if (patch.tipPercent !== undefined || patch.tipAmount !== undefined) {
    const settings = checkoutSettingsOf(shop);
    const percent = patch.tipPercent != null && settings.tipping.presets.includes(patch.tipPercent) ? patch.tipPercent : null;
    const amount = percent ? 0 : Math.max(0, Math.min(Math.trunc(patch.tipAmount ?? 0), 100_000_000));
    await db.insert(s.checkoutMeta).values({ cartId: row.id, shopId: shop.id, tipPercent: percent, tipAmount: amount }).onConflictDoUpdate({ target: s.checkoutMeta.cartId, set: { tipPercent: percent, tipAmount: amount } });
  }
  if (patch.useStoreCredit !== undefined) await setUseStoreCredit(db, shop.id, row.id, patch.useStoreCredit);
  if (Object.keys(set).length) await db.update(s.carts).set(set).where(eq(s.carts.id, row.id));
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// Submitting
// ---------------------------------------------------------------------------------------------------------------------

export type CheckoutError =
  | { code: 'not_found' | 'completed' | 'empty' | 'email' | 'contact' | 'shipping_method' | 'payment_method' | 'discount' | 'gift_card' | 'store_credit' }
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
  /** The signed-in customer (store credit is only offered to them). */
  customerId?: number | null;
  /** Double opt-in is on: the marketing checkbox creates a pending subscription (confirmed by email) instead of a subscribed one. */
  doubleOptIn?: boolean;
  /** Starts an online payment for the final total and returns its provider reference (called after validation, before the order exists). */
  startOnlinePayment?: (checkout: CheckoutView) => Promise<string>;
}

export type SubmitResult =
  | { ok: true; orderId: number; orderNumber: number; name: string; total: number; currency: string; paid: boolean; needsOnlinePayment: boolean; paymentId: string | null; email: string; checkout: CheckoutView; marketingConfirmation: { customerId: number; email: string; token: string } | null }
  | { ok: false; errors: CheckoutError[] };


/** Validate everything again (stock, discounts, shipping, address) and create the order. */
export async function submitCheckout(db: Db, shop: Shop, token: string, input: SubmitInput): Promise<SubmitResult> {
  const row = await cartRowByToken(db, shop.id, token);
  if (!row) return { ok: false, errors: [{ code: 'not_found' }] };
  if (row.completedAt) return { ok: false, errors: [{ code: 'completed' }] };
  const view = (await loadCheckout(db, shop, token, new Date(), { customerId: input.customerId }))!;
  const errors: CheckoutError[] = [];
  if (!view.lines.length) return { ok: false, errors: [{ code: 'empty' }] };
  const settings = view.settings;
  const phoneContact = settings.contactMethod === 'email_or_phone' && !row.email && !!view.address?.phone && isPhone(view.address.phone);
  if (!phoneContact && (!row.email || !isEmail(row.email))) errors.push({ code: settings.contactMethod === 'email_or_phone' ? 'contact' : 'email' });
  const missing = requiredAddressKeys(settings).filter((k) => !(view.address as Record<string, string | null | undefined> | null)?.[k]);
  if (missing.length) errors.push({ code: 'address', fields: missing });
  if (view.requiresShipping && !missing.length) {
    const wanted = input.shippingRateId ?? view.shippingRateId;
    if (!view.shippingOptions.some((o) => o.id === wanted)) errors.push({ code: 'shipping_method' });
  }
  if (view.rejectedCodes.length) errors.push({ code: 'discount' });
  if (view.stockIssues.length) errors.push({ code: 'stock', issues: view.stockIssues });
  const free = view.amountDue === 0;
  if (!free && !input.allowedMethods.includes(input.paymentMethod)) errors.push({ code: 'payment_method' });
  if (errors.length) return { ok: false, errors };

  // Honour the rate the buyer picked (it is one of the offered ones); price again if it differs from the default.
  let checkout = view;
  if (view.requiresShipping && input.shippingRateId && input.shippingRateId !== view.shippingRateId) {
    await db.update(s.carts).set({ shippingRateId: input.shippingRateId }).where(eq(s.carts.id, row.id));
    checkout = (await loadCheckout(db, shop, token, new Date(), { customerId: input.customerId }))!;
  }
  const cart = (await loadCartView(db, shop.id, row.id)) as CartView;
  const byId = new Map(cart.lines.map((l) => [l.lineId, l]));
  const online = !free && input.paymentMethod === 'stripe';
  const giftCards = checkout.giftCards.filter((g) => g.applied > 0).map((g) => ({ giftCardId: g.id, amount: g.applied }));
  const credit = checkout.storeCredit.applied > 0 && checkout.storeCredit.accountId ? { accountId: checkout.storeCredit.accountId, amount: checkout.storeCredit.applied } : null;
  const gateway = free ? (giftCards.length ? 'gift_card' : credit ? 'store_credit' : 'free') : input.paymentMethod;
  const paymentId = online && input.startOnlinePayment ? await input.startOnlinePayment(checkout) : null;
  const res: CreateOrderResult = await createOrder(db, shop.id, {
    email: row.email, phone: checkout.address?.phone ?? null, acceptsMarketing: settings.marketing !== 'hidden' && input.acceptsMarketing && !input.doubleOptIn, tip: checkout.tip, currency: cart.currency, taxesIncluded: shop.taxesIncluded,
    lines: checkout.pricing.lines.map((p) => {
      const l = byId.get(p.id)!;
      return {
        id: l.lineId, unitPrice: l.price, quantity: l.quantity, taxable: l.taxable, requiresShipping: l.requiresShipping, grams: l.grams * l.quantity, productId: l.productId, collectionIds: [],
        variantId: l.variantId, title: l.product.title, variantTitle: l.hasOnlyDefaultVariant ? null : l.variantTitle, sku: l.sku || null, vendor: l.product.vendor || null,
        imageUrl: l.image?.url ?? null, isGiftCard: l.product.isGiftCard, properties: l.properties,
      };
    }),
    pricing: checkout.pricing, giftCards, storeCredit: credit,
    shippingAddress: checkout.requiresShipping ? checkout.address : null, billingAddress: checkout.address,
    payment: { gateway, status: free ? 'PAID' : 'PENDING', paymentId },
    cartToken: token, note: settings.orderNotes ? (input.note ?? row.note) : row.note,
  });
  if (!res.ok) {
    if (res.error === 'out_of_stock') return { ok: false, errors: [{ code: 'stock', issues: (await loadCheckout(db, shop, token, new Date(), { customerId: input.customerId }))!.stockIssues }] };
    if (res.error === 'discount_unavailable') return { ok: false, errors: [{ code: 'discount' }] };
    if (res.error === 'gift_card_unavailable') return { ok: false, errors: [{ code: 'gift_card' }] };
    if (res.error === 'store_credit_unavailable') return { ok: false, errors: [{ code: 'store_credit' }] };
    return { ok: false, errors: [{ code: 'completed' }] };
  }
  if (row.draftOrderId) await completeDraftFromCheckout(db, shop.id, row.draftOrderId, res.orderId);
  let marketingConfirmation: { customerId: number; email: string; token: string } | null = null;
  if (input.doubleOptIn && input.acceptsMarketing && settings.marketing !== 'hidden' && row.email) {
    const sub = await subscribeEmail(db, shop.id, { email: row.email, tags: [], doubleOptIn: true });
    if (sub.ok && sub.value.confirmToken) marketingConfirmation = { customerId: sub.value.customer.id, email: row.email, token: sub.value.confirmToken };
  }
  return { ok: true, orderId: res.orderId, orderNumber: res.orderNumber, name: res.name, total: checkout.amountDue, currency: cart.currency, paid: free, needsOnlinePayment: online, paymentId, email: row.email ?? '', checkout, marketingConfirmation };
}
