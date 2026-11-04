import { randomUUID } from 'node:crypto';
import { cartTokenWithKey, type CartLineView, type CartView, type LineDelta } from '@shopme/core';
import { currencyExponent, formatMoney } from '@shopme/shopify-compat';

const plainText = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
const decimal = (cents: number, cur: string) => cents / 10 ** currencyExponent(cur);

function imageObject(line: CartLineView) {
  const i = line.image;
  return i ? { url: i.url, alt: i.alt ?? '', width: i.width, height: i.height, aspect_ratio: i.width && i.height ? i.width / i.height : 1 } : null;
}

/** One line in the Ajax Cart API shape (all money in minor units; no discounts are applied by the storefront). */
export function ajaxLine(line: CartLineView, currency: string) {
  const title = line.hasOnlyDefaultVariant ? line.product.title : `${line.product.title} - ${line.variantTitle}`;
  const lineTotal = line.price * line.quantity;
  const img = imageObject(line);
  return {
    id: line.variantId, properties: line.properties, quantity: line.quantity, variant_id: line.variantId, key: line.key,
    title, product_title: line.product.title, variant_title: line.hasOnlyDefaultVariant ? null : line.variantTitle,
    price: line.price, original_price: line.price, discounted_price: line.price, line_price: lineTotal, original_line_price: lineTotal,
    presentment_price: decimal(line.price, currency), total_discount: 0, discounts: [] as unknown[], sku: line.sku, grams: line.grams, vendor: line.product.vendor,
    taxable: line.taxable, product_id: line.productId, product_has_only_default_variant: line.hasOnlyDefaultVariant, gift_card: line.product.isGiftCard,
    final_price: line.price, final_line_price: lineTotal, url: `/products/${line.product.handle}?variant=${line.variantId}`,
    featured_image: img, image: img?.url ?? null, handle: line.product.handle, requires_shipping: line.requiresShipping, product_type: line.product.productType,
    untranslated_product_title: line.product.title, product_description: plainText(line.product.descriptionHtml), untranslated_variant_title: line.hasOnlyDefaultVariant ? null : line.variantTitle,
    variant_options: line.options.length ? line.options.map((o) => o.value) : [line.variantTitle], options_with_values: line.options,
    line_level_discount_allocations: [] as unknown[], line_level_total_discount: 0,
  };
}

/** The cart object returned by `GET /cart.js` and embedded in mutation responses. */
export function ajaxCart(cart: CartView) {
  const items = cart.lines.map((l) => ajaxLine(l, cart.currency));
  const total = items.reduce((n, i) => n + i.final_line_price, 0);
  return {
    token: cartTokenWithKey(cart.token), note: cart.note ?? '', attributes: cart.attributes,
    original_total_price: total, total_price: total, total_discount: 0, total_weight: cart.lines.reduce((n, l) => n + l.grams * l.quantity, 0),
    item_count: cart.lines.reduce((n, l) => n + l.quantity, 0), items, requires_shipping: cart.lines.some((l) => l.requiresShipping), currency: cart.currency,
    items_subtotal_price: total, cart_level_discount_applications: [] as unknown[], discount_codes: cart.discountCodes.map((code) => ({ code, applicable: true })),
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
