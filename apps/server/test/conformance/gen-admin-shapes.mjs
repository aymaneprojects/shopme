#!/usr/bin/env node
/**
 * Regenerates `fixtures/admin-*.shape.json` from the private reverse-engineering captures
 * (full SDL + recorded sample responses). Only field PATHS and GraphQL TYPES are written; no values, no descriptions.
 *
 *   node apps/server/test/conformance/gen-admin-shapes.mjs [path/to/shopme-re/raw]
 *
 * The captures are private and never committed. The generated fixtures are committed, so the conformance tests
 * run without the private directory.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raw = process.argv[2] ?? process.env.SHOPME_RE_RAW ?? `${process.env.HOME}/shopme-re/raw`;
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
mkdirSync(outDir, { recursive: true });

/* ---- minimal SDL reader: type name -> field name -> type string (descriptions and args dropped) ---- */
const sdl = readFileSync(path.join(raw, 'admin-2026-10/schema.graphql'), 'utf8')
  .replace(/"""[\s\S]*?"""/g, '')
  .replace(/^[ \t]*"(?:[^"\\]|\\.)*"[ \t]*\n/gm, '')
  .replace(/\n[ \t]*(?=\n)/g, '');
const flat = sdl.replace(/\(\n(?: {4}[^\n]*\n)+ {2}\)/g, '');
const types = new Map();
for (const m of flat.matchAll(/^(?:type|interface) (\w+)[^{\n]*\{\n([\s\S]*?)\n\}/gm)) {
  const fields = new Map();
  for (const line of m[2].split('\n')) {
    const f = /^ {2}(\w+)(?:\(.*?\))?: (\S+)/.exec(line);
    if (f) fields.set(f[1], f[2]);
  }
  types.set(m[1], fields);
}
const named = (t) => t.replace(/[[\]!]/g, '');

/* ---- walk a sample value and record path -> SDL type ---- */
function walk(value, typeName, prefix, out) {
  const items = Array.isArray(value) ? value : [value];
  const merged = {};
  for (const it of items) if (it && typeof it === 'object' && !Array.isArray(it)) for (const [k, v] of Object.entries(it)) {
    const cur = merged[k];
    merged[k] = cur === undefined || cur === null ? v : cur;
    if (Array.isArray(v) && Array.isArray(cur)) merged[k] = [...cur, ...v];
  }
  const fields = types.get(typeName);
  if (!fields) return;
  for (const [key, v] of Object.entries(merged)) {
    // Media is an interface; fields of its image implementation appear in samples through fragments.
    const t = fields.get(key) ?? (typeName === 'Media' ? types.get('MediaImage')?.get(key) : undefined);
    if (!t) { console.warn(`skip ${typeName}.${key}: not in SDL`); continue; }
    const p = prefix ? `${prefix}.${key}` : key;
    out.set(p, t);
    if (v && typeof v === 'object') walk(v, named(t), Array.isArray(v) ? `${p}[]` : p, out);
  }
}

/** Paths that ShopMe implements beyond what the recorded samples happened to select (commonly used fields of the SDL). Types come from the SDL. */
function addExtra(out, rootType, paths) {
  for (const path of paths) {
    let cur = rootType;
    const segs = [];
    for (const key of path.split('.')) {
      const t = types.get(cur)?.get(key);
      if (!t) { console.warn(`extra path ${rootType}.${path}: ${cur}.${key} is not in the SDL`); break; }
      segs.push(key);
      out.set(segs.join('.'), t);
      if (t.startsWith('[')) segs[segs.length - 1] = `${key}[]`;
      cur = named(t);
    }
  }
}

const EXTRA = {
  products: [
    'priceRange.minVariantPrice.amount', 'priceRange.minVariantPrice.currencyCode', 'priceRange.maxVariantPrice.amount', 'compareAtPriceRange', 'totalVariants', 'onlineStorePreviewUrl',
    'category', 'requiresSellingPlan', 'giftCardTemplateSuffix', 'hasVariantsThatRequiresComponents', 'availablePublicationsCount.count', 'resourcePublicationsCount.count',
    'publishedOnCurrentPublication', 'variants.nodes.unitPriceMeasurement', 'variants.nodes.showUnitPrice', 'variants.nodes.taxCode', 'variants.nodes.requiresComponents',
    'variants.nodes.sellableOnlineQuantity', 'variants.nodes.inventoryItem.locationsCount.count', 'variants.nodes.inventoryItem.duplicateSkuCount', 'variants.nodes.inventoryItem.trackedEditable.locked',
  ],
  collections: ['publishedOnCurrentPublication', 'availablePublicationsCount.count', 'resourcePublicationsCount.count'],
  locations: ['isPrimary', 'activatable', 'deactivatable', 'deletable', 'deactivatedAt', 'hasUnfulfilledOrders'],
  orders: [
    'totalPrice', 'subtotalPrice', 'totalTax', 'totalShippingPrice', 'totalDiscounts', 'totalRefunded', 'totalReceived', 'netPayment', 'totalCapturable', 'totalTipReceived', 'cartDiscountAmount',
    'cartDiscountAmountSet.shopMoney.amount', 'currentCartDiscountAmountSet.shopMoney.amount', 'totalCapturableSet.shopMoney.amount', 'totalTipReceivedSet.shopMoney.amount',
    'totalRefundedShippingSet.shopMoney.amount', 'confirmationNumber', 'customerLocale', 'customerAcceptsMarketing', 'merchantEditable', 'edited', 'canNotifyCustomer', 'poNumber',
    'checkoutToken', 'sourceIdentifier', 'returnStatus', 'statusPageUrl',
  ],
  customers: ['lastOrder', 'statistics.predictedSpendTier', 'statistics.rfmGroup', 'emailMarketingConsent', 'smsMarketingConsent', 'canDelete', 'lifetimeDuration', 'unsubscribeUrl'],
  shop: [
    'contactEmail', 'shopAddress.address1', 'shopAddress.countryCodeV2', 'billingAddress.city', 'currencySettings.nodes.currencyCode', 'currencySettings.nodes.currencyName', 'currencySettings.nodes.enabled',
    'enabledPresentmentCurrencies', 'plan.displayName', 'plan.partnerDevelopment', 'plan.shopifyPlus', 'setupRequired', 'checkoutApiSupported', 'timezoneAbbreviation', 'timezoneOffset',
    'timezoneOffsetMinutes', 'orderNumberFormatPrefix', 'orderNumberFormatSuffix', 'taxShipping', 'shipsToCountries', 'features.storefront', 'unitSystem', 'currencyCode', 'ianaTimezone',
    'primaryDomain.url', 'myshopifyDomain', 'weightUnit', 'taxesIncluded',
  ],
};

function write(name, rootType, root, nodes) {
  const out = new Map();
  walk(nodes, rootType, '', out);
  addExtra(out, rootType, EXTRA[name] ?? []);
  const fields = [...out].map(([p, type]) => ({ path: p, type })).sort((a, b) => a.path.localeCompare(b.path));
  writeFileSync(path.join(outDir, `admin-${name}.shape.json`), `${JSON.stringify({ root, rootType, fields }, null, 2)}\n`);
  console.log(`admin-${name}.shape.json: ${fields.length} paths`);
}

const sample = (n) => JSON.parse(readFileSync(path.join(raw, `samples/${n}.json`), 'utf8'));
write('products', 'Product', 'products', sample('products'));
write('collections', 'Collection', 'collections', sample('collections').data.collections.nodes);
write('locations', 'Location', 'locations', sample('shop').data.locations.nodes);
write('orders', 'Order', 'orders', sample('orders').data.orders.nodes);
write('customers', 'Customer', 'customers', sample('customers').data.customers.nodes);
write('shop', 'Shop', 'shop', {});
