// Code-discount form model: validation, API input mapping and a plain-language summary.
import { parseDecimal } from '../format';
import type { Key } from '../i18n';

export type DiscountKind = 'order' | 'product' | 'shipping';
export interface Ref { id: string; title: string }
export interface DiscountForm {
  kind: DiscountKind; code: string;
  valueType: 'percentage' | 'fixed'; value: string;
  appliesTo: 'all' | 'collections' | 'products'; collections: Ref[]; products: Ref[];
  hasMaxShipping: boolean; maxShipping: string;
  minType: 'none' | 'subtotal' | 'quantity'; minValue: string;
  limitTotal: boolean; usageLimit: string; oncePerCustomer: boolean;
  startsAt: string; hasEnd: boolean; endsAt: string;
  combines: { productDiscounts: boolean; orderDiscounts: boolean; shippingDiscounts: boolean };
}
export type DiscountErrors = Partial<Record<'code' | 'value' | 'targets' | 'maxShipping' | 'minValue' | 'usageLimit' | 'endsAt', Key>>;

/** Local `datetime-local` value (YYYY-MM-DDTHH:mm). */
export const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

export const blankDiscount = (kind: DiscountKind): DiscountForm => ({
  kind, code: '', valueType: 'percentage', value: '', appliesTo: kind === 'product' ? 'collections' : 'all', collections: [], products: [],
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
  if (!code) e.code = 'discount.err.codeRequired';
  else if (/\s/.test(code)) e.code = 'discount.err.codeSpaces';
  if (f.kind !== 'shipping') {
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
  if (f.limitTotal) {
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
  const common = {
    title: f.code.trim(), code: f.code.trim(),
    startsAt: iso(f.startsAt || nowLocal()), endsAt: f.hasEnd && f.endsAt ? iso(f.endsAt) : null,
    usageLimit: f.limitTotal ? Number(f.usageLimit) : null, appliesOncePerCustomer: f.oncePerCustomer,
    combinesWith: { ...f.combines },
    customerSelection: { all: true },
    ...(f.minType === 'subtotal' && { minimumRequirement: { subtotal: { greaterThanOrEqualToSubtotal: money(f.minValue) } } }),
    ...(f.minType === 'quantity' && { minimumRequirement: { quantity: { greaterThanOrEqualToQuantity: String(Number(f.minValue)) } } }),
  };
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

interface NodeShape {
  __typename: string; title: string; startsAt: string; endsAt: string | null; usageLimit: number | null; appliesOncePerCustomer: boolean;
  codes: { nodes: Array<{ code: string }> };
  combinesWith: { productDiscounts: boolean; orderDiscounts: boolean; shippingDiscounts: boolean };
  maximumShippingPrice?: { amount: string } | null;
  minimumRequirement?: { __typename: string; greaterThanOrEqualToSubtotal?: { amount: string }; greaterThanOrEqualToQuantity?: string | number } | null;
  customerGets?: {
    value: { __typename: string; percentage?: number; amount?: { amount: string }; appliesOnEachItem?: boolean };
    items: { __typename: string; collections?: { nodes: Ref[] }; products?: { nodes: Ref[] } };
  };
}
const toLocal = (iso: string) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

export function fromDiscountNode(d: NodeShape): DiscountForm {
  const shipping = d.__typename === 'DiscountCodeFreeShipping';
  const f = blankDiscount(shipping ? 'shipping' : 'order');
  f.code = d.codes.nodes[0]?.code ?? d.title;
  f.startsAt = toLocal(d.startsAt);
  if (d.endsAt) { f.hasEnd = true; f.endsAt = toLocal(d.endsAt); }
  f.limitTotal = d.usageLimit != null; f.usageLimit = d.usageLimit != null ? String(d.usageLimit) : '';
  f.oncePerCustomer = d.appliesOncePerCustomer; f.combines = { ...d.combinesWith };
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
  out.push(f.code.trim() ? t('discount.sum.code', { code: f.code.trim() }) : t('discount.sum.noCode'));
  const v = parseDecimal(f.value);
  if (f.kind === 'shipping') out.push(t('discount.sum.freeShipping'));
  else if (v) {
    const amount = f.valueType === 'percentage' ? `${v}%` : fmt(v);
    const scope = f.appliesTo === 'all' ? t('discount.sum.order') : f.appliesTo === 'collections' ? t('discount.sum.collections', { n: f.collections.length }) : t('discount.sum.products', { n: f.products.length });
    out.push(t('discount.sum.value', { amount, scope }));
  }
  const m = parseDecimal(f.minValue);
  out.push(f.minType === 'subtotal' && m ? t('discount.sum.minSubtotal', { amount: fmt(m) }) : f.minType === 'quantity' && m ? t('discount.sum.minQty', { n: m }) : t('discount.sum.noMin'));
  if (f.limitTotal && f.usageLimit) out.push(t('discount.sum.limit', { n: f.usageLimit }));
  if (f.oncePerCustomer) out.push(t('discount.sum.once'));
  out.push(f.hasEnd && f.endsAt ? t('discount.sum.dates', { from: f.startsAt.replace('T', ' '), to: f.endsAt.replace('T', ' ') }) : t('discount.sum.from', { from: f.startsAt.replace('T', ' ') }));
  return out;
}
