import { and, eq, inArray } from 'drizzle-orm';
import { schema as s, type Db } from '@shopme/core';

/** `resource.metafields.<namespace>.<key>`: an object with `value` (typed), `type`, `namespace`, `key`; printing it prints the value as text. */
export interface MetafieldObject { id: number; namespace: string; key: string; type: string; value: unknown; list: boolean; toString(): string; toJSON(): unknown }
export type MetafieldsObject = Record<string, Record<string, MetafieldObject>>;

const TEXT_TYPES = new Set(['single_line_text_field', 'multi_line_text_field', 'url', 'color', 'date', 'date_time', 'id']);

type RichNode = { type?: string; value?: string; children?: RichNode[]; level?: number; listType?: string; url?: string; title?: string; bold?: boolean; italic?: boolean };
const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Shopify's rich text JSON (`{"type":"root","children":[...]}`) as HTML; anything else is passed through as HTML. */
export function richTextHtml(raw: string): string {
  let root: RichNode;
  try { root = JSON.parse(raw) as RichNode; } catch { return raw; }
  if (!root || root.type !== 'root') return raw;
  const inline = (n: RichNode): string => {
    if (n.type === 'text') { let t = esc(n.value ?? ''); if (n.bold) t = `<strong>${t}</strong>`; if (n.italic) t = `<em>${t}</em>`; return t; }
    if (n.type === 'link') return `<a href="${esc(n.url ?? '')}"${n.title ? ` title="${esc(n.title)}"` : ''}>${(n.children ?? []).map(inline).join('')}</a>`;
    return (n.children ?? []).map(inline).join('');
  };
  const block = (n: RichNode): string => {
    if (n.type === 'heading') return `<h${n.level ?? 1}>${(n.children ?? []).map(inline).join('')}</h${n.level ?? 1}>`;
    if (n.type === 'list') { const tag = n.listType === 'ordered' ? 'ol' : 'ul'; return `<${tag}>${(n.children ?? []).map((li) => `<li>${(li.children ?? []).map(inline).join('')}</li>`).join('')}</${tag}>`; }
    return `<p>${(n.children ?? []).map(inline).join('')}</p>`;
  };
  return (root.children ?? []).map(block).join('');
}

type Resolver = (type: string, value: string) => unknown;

function scalar(type: string, value: string, resolve: Resolver): unknown {
  try {
    switch (type) {
      case 'number_integer': return Number(value);
      case 'number_decimal': return Number(value);
      case 'boolean': return value === 'true';
      case 'json': return JSON.parse(value);
      case 'rich_text_field': return richTextHtml(value);
      case 'money': { const m = JSON.parse(value) as { amount: string; currency_code: string }; return { amount: Number(m.amount) * 100, currency_code: m.currency_code, currency: m.currency_code }; }
      case 'weight': case 'volume': case 'dimension': return JSON.parse(value);
      case 'rating': { const r = JSON.parse(value) as { value: string; scale_min: string; scale_max: string }; return { value: Number(r.value), scale_min: Number(r.scale_min), scale_max: Number(r.scale_max) }; }
      default: return TEXT_TYPES.has(type) ? value : resolve(type, value);
    }
  } catch { return value; }
}

/** Plain text of a metafield value for printing. */
export function metafieldText(type: string, value: unknown, raw: string): string {
  const base = type.startsWith('list.') ? type.slice(5) : type;
  if (type.startsWith('list.') && Array.isArray(value)) return (value as unknown[]).map((v) => (typeof v === 'object' && v ? ((v as { title?: string; name?: string }).title ?? (v as { name?: string }).name ?? JSON.stringify(v)) : String(v))).join(', ');
  if (base === 'rich_text_field') return String(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (base === 'money' && value && typeof value === 'object') { const m = value as { amount: number; currency_code: string }; return `${(m.amount / 100).toFixed(2)} ${m.currency_code}`; }
  if (base === 'rating' && value && typeof value === 'object') { const r = value as { value: number; scale_max: number }; return `${r.value} / ${r.scale_max}`; }
  if (['weight', 'volume', 'dimension'].includes(base) && value && typeof value === 'object') { const m = value as { value: number; unit: string }; return `${m.value} ${m.unit}`; }
  if (value && typeof value === 'object') { const o = value as { title?: string; handle?: string }; return o.title ?? o.handle ?? raw; }
  return value == null ? '' : String(value);
}

const lastId = (gid: string) => Number(gid.split('/').pop());

/** Metafields of many owners at once: `owner id -> namespace -> key -> metafield`. References (product, collection, page, file) are resolved to light objects. */
export async function loadMetafields(db: Db, shopId: number, ownerType: string, ownerIds: number[]): Promise<Map<number, MetafieldsObject>> {
  const out = new Map<number, MetafieldsObject>();
  if (!ownerIds.length) return out;
  const rows = await db.select().from(s.metafields).where(and(eq(s.metafields.shopId, shopId), eq(s.metafields.ownerType, ownerType), inArray(s.metafields.ownerId, ownerIds)));
  if (!rows.length) return out;
  // Collect referenced ids per kind, resolve in one query each.
  const refs: Record<string, Set<number>> = { product: new Set(), collection: new Set(), page: new Set(), file: new Set(), variant: new Set() };
  const kindOf = (t: string) => ({ product_reference: 'product', collection_reference: 'collection', page_reference: 'page', file_reference: 'file', variant_reference: 'variant' } as Record<string, string>)[t];
  for (const r of rows) {
    const base = r.type.startsWith('list.') ? r.type.slice(5) : r.type;
    const kind = kindOf(base);
    if (!kind) continue;
    const vals = r.type.startsWith('list.') ? (() => { try { return JSON.parse(r.value) as string[]; } catch { return []; } })() : [r.value];
    for (const v of vals) if (typeof v === 'string' && Number.isFinite(lastId(v))) refs[kind]!.add(lastId(v));
  }
  const lookup: Record<string, Map<number, unknown>> = { product: new Map(), collection: new Map(), page: new Map(), file: new Map(), variant: new Map() };
  const [ps, cs, pgs, fs, vs] = await Promise.all([
    refs.product!.size ? db.select({ id: s.products.id, handle: s.products.handle, title: s.products.title }).from(s.products).where(and(eq(s.products.shopId, shopId), inArray(s.products.id, [...refs.product!]))) : [],
    refs.collection!.size ? db.select({ id: s.collections.id, handle: s.collections.handle, title: s.collections.title }).from(s.collections).where(and(eq(s.collections.shopId, shopId), inArray(s.collections.id, [...refs.collection!]))) : [],
    refs.page!.size ? db.select({ id: s.pages.id, handle: s.pages.handle, title: s.pages.title }).from(s.pages).where(and(eq(s.pages.shopId, shopId), inArray(s.pages.id, [...refs.page!]))) : [],
    refs.file!.size ? db.select().from(s.media).where(and(eq(s.media.shopId, shopId), inArray(s.media.id, [...refs.file!]))) : [],
    refs.variant!.size ? db.select({ id: s.productVariants.id, title: s.productVariants.title, sku: s.productVariants.sku }).from(s.productVariants).where(and(eq(s.productVariants.shopId, shopId), inArray(s.productVariants.id, [...refs.variant!]))) : [],
  ]);
  for (const p of ps) lookup.product!.set(p.id, { id: p.id, handle: p.handle, title: p.title, url: `/products/${p.handle}` });
  for (const c of cs) lookup.collection!.set(c.id, { id: c.id, handle: c.handle, title: c.title, url: `/collections/${c.handle}` });
  for (const p of pgs) lookup.page!.set(p.id, { id: p.id, handle: p.handle, title: p.title, url: `/pages/${p.handle}` });
  for (const m of fs) lookup.file!.set(m.id, { id: m.id, alt: m.alt, src: m.url, url: m.url, width: m.width, height: m.height, media_type: m.type.toLowerCase(), preview_image: { src: m.url, alt: m.alt, width: m.width, height: m.height } });
  for (const v of vs) lookup.variant!.set(v.id, { id: v.id, title: v.title, sku: v.sku });
  const resolve = (base: string) => (_t: string, value: string) => lookup[kindOf(base) ?? '']?.get(lastId(value)) ?? null;
  for (const r of rows) {
    const list = r.type.startsWith('list.');
    const base = list ? r.type.slice(5) : r.type;
    let value: unknown;
    if (list) { try { value = (JSON.parse(r.value) as unknown[]).map((v) => scalar(base, typeof v === 'string' ? v : JSON.stringify(v), resolve(base))); } catch { value = []; } }
    else value = scalar(base, r.value, resolve(base));
    const text = metafieldText(r.type, value, r.value);
    const mf: MetafieldObject = { id: r.id, namespace: r.namespace, key: r.key, type: r.type, value, list, toString: () => text, toJSON: () => value };
    const owner = out.get(r.ownerId) ?? {};
    (owner[r.namespace] ??= {})[r.key] = mf;
    out.set(r.ownerId, owner);
  }
  return out;
}
