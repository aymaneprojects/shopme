import { createHash, randomUUID } from 'node:crypto';
import { cartTokenWithKey, type CartDiscounts, type CartLineView, type CartView, type DiscountApplication, type LineDelta } from '@shopme/core';
import { currencyExponent, formatMoney } from '@shopme/shopify-compat';

const plainText = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
const decimal = (cents: number, cur: string) => cents / 10 ** currencyExponent(cur);

function imageObject(line: CartLineView) {
  const i = line.image;
  return i ? { url: i.url, alt: i.alt ?? '', width: i.width, height: i.height, aspect_ratio: i.width && i.height ? i.width / i.height : 1 } : null;
}

const uuidOf = (seed: string) => { const h = createHash('md5').update(seed).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`; };

/** A discount application in the Ajax / Liquid shape; `allocated` is the share for one line, or the whole amount for cart-level entries. */
export function discountApplication(a: DiscountApplication, cart: { token: string; currency: string }, allocated: number) {
  const order = a.target === 'ORDER';
  return {
    type: a.code ? 'discount_code' : 'automatic', key: uuidOf(`${cart.token}:${a.discountId}`), title: a.code ?? a.title, description: a.code ?? a.title,
    value: (a.valueType === 'PERCENTAGE' ? a.value / 100 : decimal(a.value, cart.currency)).toFixed(1), created_at: new Date().toISOString(),
    value_type: a.valueType === 'PERCENTAGE' ? 'percentage' : 'fixed_amount', allocation_method: order || a.valueType === 'FIXED_AMOUNT' ? 'across' : 'each', target_selection: order ? 'all' : 'entitled', target_type: 'line_item',
    total_allocated_amount: allocated,
  };
}

/** Per line: line-level allocations (product discounts). Order-level discounts are reported on the cart, not on lines. */
function lineAllocations(cart: Pick<CartView, 'token' | 'currency'>, d: CartDiscounts | null, lineId: number) {
  return (d?.applications ?? []).filter((a) => a.target === 'PRODUCTS').flatMap((a) => {
    const share = a.lineAllocations.find((x) => x.lineId === lineId)?.amount ?? 0;
    return share > 0 ? [{ amount: share, discount_application: discountApplication(a, cart, a.allocated) }] : [];
  });
}

/** One line in the Ajax Cart API shape (all money in minor units). `discounts` come from the cart pricing; without them the line is undiscounted. */
export function ajaxLine(line: CartLineView, currency: string, d: CartDiscounts | null = null, token = '') {
  const title = line.hasOnlyDefaultVariant ? line.product.title : `${line.product.title} - ${line.variantTitle}`;
  const lineTotal = line.price * line.quantity;
  const allocations = lineAllocations({ token, currency }, d, line.lineId);
  const off = allocations.reduce((n, a) => n + a.amount, 0);
  const finalLine = lineTotal - off;
  const finalUnit = line.quantity ? Math.round(finalLine / line.quantity) : line.price;
  const img = imageObject(line);
  return {
    id: line.variantId, properties: line.properties, quantity: line.quantity, variant_id: line.variantId, key: line.key,
    title, product_title: line.product.title, variant_title: line.hasOnlyDefaultVariant ? null : line.variantTitle,
    price: line.price, original_price: line.price, discounted_price: finalUnit, line_price: finalLine, original_line_price: lineTotal,
    presentment_price: decimal(line.price, currency), total_discount: off, discounts: allocations.map((a) => ({ amount: a.amount, title: a.discount_application.title })), sku: line.sku, grams: line.grams, vendor: line.product.vendor,
    taxable: line.taxable, product_id: line.productId, product_has_only_default_variant: line.hasOnlyDefaultVariant, gift_card: line.product.isGiftCard,
    final_price: finalUnit, final_line_price: finalLine, url: `/products/${line.product.handle}?variant=${line.variantId}`,
    featured_image: img, image: img?.url ?? null, handle: line.product.handle, requires_shipping: line.requiresShipping, product_type: line.product.productType,
    untranslated_product_title: line.product.title, product_description: plainText(line.product.descriptionHtml), untranslated_variant_title: line.hasOnlyDefaultVariant ? null : line.variantTitle,
    variant_options: line.options.length ? line.options.map((o) => o.value) : [line.variantTitle], options_with_values: line.options,
    line_level_discount_allocations: allocations, line_level_total_discount: off,
  };
}

/** Cart-level applications (order discounts) with their total allocated amount. */
export function cartLevelApplications(cart: Pick<CartView, 'token' | 'currency'>, d: CartDiscounts | null) {
  return (d?.applications ?? []).filter((a) => a.target === 'ORDER').map((a) => discountApplication(a, cart, a.allocated));
}

/** The cart object returned by `GET /cart.js` and embedded in mutation responses. */
export function ajaxCart(cart: CartView, d: CartDiscounts | null = null) {
  const items = cart.lines.map((l) => ajaxLine(l, cart.currency, d, cart.token));
  const subtotal = items.reduce((n, i) => n + i.final_line_price, 0);
  const original = items.reduce((n, i) => n + i.original_line_price, 0);
  const cartLevel = cartLevelApplications(cart, d);
  const total = subtotal - cartLevel.reduce((n, a) => n + a.total_allocated_amount, 0);
  const rejected = new Set((d?.rejected ?? []).map((r) => r.code));
  return {
    token: cartTokenWithKey(cart.token), note: cart.note ?? '', attributes: cart.attributes,
    original_total_price: original, total_price: total, total_discount: original - total, total_weight: cart.lines.reduce((n, l) => n + l.grams * l.quantity, 0),
    item_count: cart.lines.reduce((n, l) => n + l.quantity, 0), items, requires_shipping: cart.lines.some((l) => l.requiresShipping), currency: cart.currency,
    items_subtotal_price: subtotal, cart_level_discount_applications: cartLevel, discount_codes: cart.discountCodes.map((code) => ({ code, applicable: !rejected.has(code.trim().toUpperCase()) })),
  };
}

/** `items_added` / `items_removed` entry of `change.js`. */
export function changeEntry(d: LineDelta, currency: string) {
  const l = d.line;
  const a = ajaxLine(l, currency);
  return {
    product_id: l.productId, variant_id: l.variantId, id: randomUUID(), image: a.image, price: formatMoney(l.price, currency), presentment_price: a.presentment_price,
    quantity: Math.abs(d.delta), title: a.title, product_title: a.title, variant_title: a.variant_title, vendor: l.product.vendor, product_type: l.product.productType, sku: l.sku,
    url: a.url, untranslated_product_title: a.untranslated_product_title, untranslated_variant_title: a.untranslated_variant_title, view_key: l.key,
  };
}
