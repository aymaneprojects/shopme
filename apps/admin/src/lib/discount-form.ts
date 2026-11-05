// Code-discount form model: validation, API input mapping and a plain-language summary.
import { parseDecimal } from '../format';
import type { Key } from '../i18n';

export type DiscountKind = 'order' | 'product' | 'shipping' | 'bxgy';
export type DiscountMethod = 'code' | 'automatic';
export interface Ref { id: string; title: string }
/** Buy X get Y: what the customer buys, what they get, and the effect on what they get. */
export interface BxgyForm {
  buyQty: string; buyAppliesTo: 'collections' | 'products'; buyCollections: Ref[]; buyProducts: Ref[];
  getQty: string; getAppliesTo: 'collections' | 'products'; getCollections: Ref[]; getProducts: Ref[];
  getEffect: 'free' | 'percentage'; getPercent: string; hasUsesLimit: boolean; usesLimit: string;
}
export interface DiscountForm {
  kind: DiscountKind; method: DiscountMethod; title: string; bxgy: BxgyForm; code: string;
  valueType: 'percentage' | 'fixed'; value: string;
  appliesTo: 'all' | 'collections' | 'products'; collections: Ref[]; products: Ref[];
  hasMaxShipping: boolean; maxShipping: string;
  minType: 'none' | 'subtotal' | 'quantity'; minValue: string;
  limitTotal: boolean; usageLimit: string; oncePerCustomer: boolean;
  startsAt: string; hasEnd: boolean; endsAt: string;
  combines: { productDiscounts: boolean; orderDiscounts: boolean; shippingDiscounts: boolean };
}
export type DiscountErrors = Partial<Record<'code' | 'title' | 'value' | 'targets' | 'maxShipping' | 'minValue' | 'usageLimit' | 'endsAt' | 'buyQty' | 'buyTargets' | 'getQty' | 'getTargets' | 'getPercent' | 'usesLimit', Key>>;

/** Local `datetime-local` value (YYYY-MM-DDTHH:mm). */
export const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

export const blankBxgy = (): BxgyForm => ({
  buyQty: '1', buyAppliesTo: 'products', buyCollections: [], buyProducts: [], getQty: '1', getAppliesTo: 'products', getCollections: [], getProducts: [], getEffect: 'free', getPercent: '', hasUsesLimit: false, usesLimit: '',
});

export const blankDiscount = (kind: DiscountKind, method: DiscountMethod = 'code'): DiscountForm => ({
  kind, method, title: '', bxgy: blankBxgy(), code: '', valueType: 'percentage', value: '', appliesTo: kind === 'product' ? 'collections' : 'all', collections: [], products: [],
  hasMaxShipping: false, maxShipping: '', minType: 'none', minValue: '', limitTotal: false, usageLimit: '', oncePerCustomer: false,
  startsAt: nowLocal(), hasEnd: false, endsAt: '', combines: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: false },
});

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Random uppercase code without ambiguous characters. */
export function generateCode(len = 10, random: () => number = Math.random) {
  return Array.from({ length: len }, () => ALPHABET[Math.floor(random() * ALPHABET.length)]).join('');
}

export function validateDiscount(f: DiscountForm): DiscountErrors {
  const e: DiscountErrors = {};
  const code = f.code.trim();
  if (f.method === 'automatic') { if (!f.title.trim()) e.title = 'discount.err.titleRequired'; }
  else if (!code) e.code = 'discount.err.codeRequired';
  else if (/\s/.test(code)) e.code = 'discount.err.codeSpaces';
  if (f.kind === 'bxgy') {
    const b = f.bxgy;
    const n = parseDecimal(b.buyQty); const g = parseDecimal(b.getQty);
    if (n === null || n < 1 || !Number.isInteger(n)) e.buyQty = 'discount.err.quantity';
    if (g === null || g < 1 || !Number.isInteger(g)) e.getQty = 'discount.err.quantity';
    if (!(b.buyAppliesTo === 'collections' ? b.buyCollections : b.buyProducts).length) e.buyTargets = 'discount.err.targets';
    if (!(b.getAppliesTo === 'collections' ? b.getCollections : b.getProducts).length) e.getTargets = 'discount.err.targets';
    if (b.getEffect === 'percentage') { const v = parseDecimal(b.getPercent); if (v === null || v <= 0 || v > 100) e.getPercent = 'discount.err.percentMax'; }
    if (b.hasUsesLimit) { const u = parseDecimal(b.usesLimit); if (u === null || u < 1 || !Number.isInteger(u)) e.usesLimit = 'discount.err.usageLimit'; }
  } else if (f.kind !== 'shipping') {
    const v = parseDecimal(f.value);
    if (v === null || v <= 0) e.value = 'discount.err.valuePositive';
    else if (f.valueType === 'percentage' && v > 100) e.value = 'discount.err.percentMax';
    if (f.appliesTo === 'collections' && !f.collections.length) e.targets = 'discount.err.targets';
    if (f.appliesTo === 'products' && !f.products.length) e.targets = 'discount.err.targets';
  } else if (f.hasMaxShipping) {
    const m = parseDecimal(f.maxShipping);
    if (m === null || m < 0) e.maxShipping = 'discount.err.maxShipping';
  }
  if (f.minType !== 'none') {
    const m = parseDecimal(f.minValue);
    if (m === null || m <= 0) e.minValue = 'discount.err.minValue';
    else if (f.minType === 'quantity' && !Number.isInteger(m)) e.minValue = 'discount.err.minValue';
  }
  if (f.limitTotal && f.method === 'code') {
    const n = parseDecimal(f.usageLimit);
    if (n === null || n < 1 || !Number.isInteger(n)) e.usageLimit = 'discount.err.usageLimit';
  }
  if (f.hasEnd) {
    if (!f.endsAt || (f.startsAt && new Date(f.endsAt) <= new Date(f.startsAt))) e.endsAt = 'discount.err.endAfterStart';
  }
  return e;
}

const iso = (local: string) => new Date(local).toISOString();
const money = (s: string) => (parseDecimal(s) ?? 0).toFixed(2);

/** Shared fields of DiscountCodeBasicInput / DiscountCodeFreeShippingInput. `prev` lets an update remove deselected targets. */
export function toDiscountInput(f: DiscountForm, prev?: { collections: string[]; products: string[] }) {
  const code = f.method === 'code';
  const common = {
    title: code ? f.code.trim() : f.title.trim(), ...(code && { code: f.code.trim() }),
    startsAt: iso(f.startsAt || nowLocal()), endsAt: f.hasEnd && f.endsAt ? iso(f.endsAt) : null,
    ...(code && { usageLimit: f.limitTotal ? Number(f.usageLimit) : null, appliesOncePerCustomer: f.oncePerCustomer }),
    combinesWith: { ...f.combines },
    ...(f.kind !== 'bxgy' && f.minType === 'subtotal' && { minimumRequirement: { subtotal: { greaterThanOrEqualToSubtotal: money(f.minValue) } } }),
    ...(f.kind !== 'bxgy' && f.minType === 'quantity' && { minimumRequirement: { quantity: { greaterThanOrEqualToQuantity: String(Number(f.minValue)) } } }),
  };
  if (f.kind === 'bxgy') {
    const b = f.bxgy;
    const items = (as: 'collections' | 'products', cols: Ref[], prods: Ref[]) => (as === 'collections' ? { collections: { add: cols.map((c) => c.id) } } : { products: { productsToAdd: prods.map((p) => p.id) } });
    const uses = b.hasUsesLimit ? Number(b.usesLimit) : null;
    return {
      ...common, usesPerOrderLimit: code ? uses : uses === null ? null : String(uses),
      customerBuys: { value: { quantity: String(Number(b.buyQty)) }, items: items(b.buyAppliesTo, b.buyCollections, b.buyProducts) },
      customerGets: { value: { discountOnQuantity: { quantity: String(Number(b.getQty)), effect: { percentage: b.getEffect === 'free' ? 1 : (parseDecimal(b.getPercent) ?? 0) / 100 } } }, items: items(b.getAppliesTo, b.getCollections, b.getProducts) },
    };
  }
  if (f.kind === 'shipping') {
    return { ...common, destination: { all: true }, ...(f.hasMaxShipping && { maximumShippingPrice: money(f.maxShipping) }) };
  }
  const value = f.valueType === 'percentage'
    ? { percentage: (parseDecimal(f.value) ?? 0) / 100 }
    : { discountAmount: { amount: money(f.value), appliesOnEachItem: f.kind === 'product' } };
  const ids = (r: Ref[]) => r.map((x) => x.id);
  const diff = (now: string[], before: string[] = []) => ({ add: now.filter((i) => !before.includes(i)), remove: before.filter((i) => !now.includes(i)) });
  const items = f.appliesTo === 'all' ? { all: true }
    : f.appliesTo === 'collections' ? { collections: diff(ids(f.collections), prev?.collections) }
      : (() => { const d = diff(ids(f.products), prev?.products); return { products: { productsToAdd: d.add, productsToRemove: d.remove } }; })();
  return { ...common, customerGets: { value, items } };
}

interface ItemsShape { __typename: string; collections?: { nodes: Ref[] }; products?: { nodes: Ref[] } }
interface NodeShape {
  __typename: string; title: string; startsAt: string; endsAt: string | null; usageLimit?: number | null; appliesOncePerCustomer?: boolean;
  codes?: { nodes: Array<{ code: string }> };
  usesPerOrderCode?: number | null; usesPerOrderAuto?: string | null;
  customerBuys?: { value: { quantity?: string | number }; items: ItemsShape };
  combinesWith: { productDiscounts: boolean; orderDiscounts: boolean; shippingDiscounts: boolean };
  maximumShippingPrice?: { amount: string } | null;
  minimumRequirement?: { __typename: string; greaterThanOrEqualToSubtotal?: { amount: string }; greaterThanOrEqualToQuantity?: string | number } | null;
  customerGets?: {
    value: { __typename: string; percentage?: number; amount?: { amount: string }; appliesOnEachItem?: boolean; quantity?: { quantity: string | number }; effect?: { __typename: string; percentage?: number; amount?: { amount: string } } };
    items: ItemsShape;
  };
}
const toLocal = (iso: string) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

export function fromDiscountNode(d: NodeShape): DiscountForm {
  const shipping = /FreeShipping$/.test(d.__typename);
  const bxgy = /Bxgy$/.test(d.__typename);
  const f = blankDiscount(shipping ? 'shipping' : bxgy ? 'bxgy' : 'order', d.__typename.startsWith('DiscountAutomatic') ? 'automatic' : 'code');
  f.title = d.title;
  f.code = d.codes?.nodes[0]?.code ?? d.title;
  f.startsAt = toLocal(d.startsAt);
  if (d.endsAt) { f.hasEnd = true; f.endsAt = toLocal(d.endsAt); }
  f.limitTotal = d.usageLimit != null; f.usageLimit = d.usageLimit != null ? String(d.usageLimit) : '';
  f.oncePerCustomer = !!d.appliesOncePerCustomer; f.combines = { ...d.combinesWith };
  if (bxgy) {
    const b = f.bxgy;
    const uses = d.usesPerOrderCode ?? (d.usesPerOrderAuto != null ? Number(d.usesPerOrderAuto) : null);
    b.hasUsesLimit = uses != null; b.usesLimit = uses != null ? String(uses) : '';
    b.buyQty = String(d.customerBuys?.value.quantity ?? 1); b.getQty = String(d.customerGets?.value.quantity?.quantity ?? 1);
    const eff = d.customerGets?.value.effect;
    if (eff?.percentage != null && eff.percentage < 1) { b.getEffect = 'percentage'; b.getPercent = String(Math.round(eff.percentage * 10000) / 100); }
    const side = (it: ItemsShape | undefined) => (it?.collections ? { as: 'collections' as const, cols: it.collections.nodes, prods: [] as Ref[] } : { as: 'products' as const, cols: [] as Ref[], prods: it?.products?.nodes ?? [] });
    const buys = side(d.customerBuys?.items); const gets = side(d.customerGets?.items);
    Object.assign(b, { buyAppliesTo: buys.as, buyCollections: buys.cols, buyProducts: buys.prods, getAppliesTo: gets.as, getCollections: gets.cols, getProducts: gets.prods });
    return f;
  }
  const m = d.minimumRequirement;
  if (m?.greaterThanOrEqualToSubtotal) { f.minType = 'subtotal'; f.minValue = m.greaterThanOrEqualToSubtotal.amount; }
  else if (m?.greaterThanOrEqualToQuantity != null) { f.minType = 'quantity'; f.minValue = String(m.greaterThanOrEqualToQuantity); }
  if (shipping) {
    if (d.maximumShippingPrice) { f.hasMaxShipping = true; f.maxShipping = d.maximumShippingPrice.amount; }
    return f;
  }
  const g = d.customerGets;
  if (g?.value.percentage != null) { f.valueType = 'percentage'; f.value = String(Math.round(g.value.percentage * 10000) / 100); }
  else if (g?.value.amount) { f.valueType = 'fixed'; f.value = g.value.amount.amount; }
  if (g?.items.collections) { f.kind = 'product'; f.appliesTo = 'collections'; f.collections = g.items.collections.nodes; }
  else if (g?.items.products) { f.kind = 'product'; f.appliesTo = 'products'; f.products = g.items.products.nodes; }
  return f;
}

/** Plain-language summary lines for the right-hand card. */
export function summarizeDiscount(f: DiscountForm, t: (k: Key, v?: Record<string, string | number>) => string, fmt: (n: number) => string): string[] {
  const out: string[] = [];
  if (f.method === 'automatic') out.push(f.title.trim() ? t('discount.sum.auto', { title: f.title.trim() }) : t('discount.sum.noTitle'));
  else out.push(f.code.trim() ? t('discount.sum.code', { code: f.code.trim() }) : t('discount.sum.noCode'));
  const v = parseDecimal(f.value);
  if (f.kind === 'bxgy') {
    const b = f.bxgy;
    out.push(t(b.getEffect === 'free' ? 'discount.sum.bxgyFree' : 'discount.sum.bxgyPercent', { buy: b.buyQty || '?', get: b.getQty || '?', percent: b.getPercent || '?' }));
    if (b.hasUsesLimit && b.usesLimit) out.push(t('discount.sum.usesPerOrder', { n: b.usesLimit }));
  } else if (f.kind === 'shipping') out.push(t('discount.sum.freeShipping'));
  else if (v) {
    const amount = f.valueType === 'percentage' ? `${v}%` : fmt(v);
    const scope = f.appliesTo === 'all' ? t('discount.sum.order') : f.appliesTo === 'collections' ? t('discount.sum.collections', { n: f.collections.length }) : t('discount.sum.products', { n: f.products.length });
    out.push(t('discount.sum.value', { amount, scope }));
  }
  const m = parseDecimal(f.minValue);
  if (f.kind !== 'bxgy') out.push(f.minType === 'subtotal' && m ? t('discount.sum.minSubtotal', { amount: fmt(m) }) : f.minType === 'quantity' && m ? t('discount.sum.minQty', { n: m }) : t('discount.sum.noMin'));
  if (f.method === 'code' && f.limitTotal && f.usageLimit) out.push(t('discount.sum.limit', { n: f.usageLimit }));
  if (f.method === 'code' && f.oncePerCustomer) out.push(t('discount.sum.once'));
  out.push(f.hasEnd && f.endsAt ? t('discount.sum.dates', { from: f.startsAt.replace('T', ' '), to: f.endsAt.replace('T', ' ') }) : t('discount.sum.from', { from: f.startsAt.replace('T', ' ') }));
  return out;
}
