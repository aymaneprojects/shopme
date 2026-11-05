import { createHash, createHmac } from 'node:crypto';
import type { Liquid } from 'liquidjs';
import { renderMoneyFormat } from '@shopme/shopify-compat';
import { registerColorFilters } from './filters-color';
import { attrs, escapeHtml, rtOf, splitArgs, type Runtime } from './runtime';
import { lookupKey, parseFont } from './theme';

interface FilterThis { context: { globals: Record<string, unknown>; getSync(path: string[]): unknown }; liquid: Liquid }
type F = (this: FilterThis, v: any, ...a: any[]) => unknown;

const num = (v: unknown): number => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '')); return Number.isFinite(n) ? n : 0; };
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export const handleize = (s: unknown): string =>
  str(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function formatMoney(rt: Runtime, v: unknown, kind: 'plain' | 'currency' | 'amount' | 'trim'): string {
  const cents = Math.round(num(v));
  if (kind === 'amount') return renderMoneyFormat('{{amount}}', cents, rt.money.currency);
  if (kind === 'currency') return renderMoneyFormat(rt.money.withCurrency, cents, rt.money.currency);
  const out = renderMoneyFormat(rt.money.format, cents, rt.money.currency);
  return kind === 'trim' ? out.replace(/([.,])00(?!\d)/, '') : out;
}

/** Set (or add) query parameters on a URL string that may already have a query. */
function withParams(url: string, params: Record<string, unknown>): string {
  const parts = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  if (!parts.length) return url;
  return url + (url.includes('?') ? '&' : '?') + parts.join('&');
}

const queryNumber = (url: string, key: string): number | undefined => {
  const m = new RegExp(`[?&]${key}=(\\d+)`).exec(url);
  return m ? Number(m[1]) : undefined;
};

const imageSrc = (v: any): string => (typeof v === 'string' ? v : v?.src ?? v?.url ?? v?.preview_image?.src ?? '');

function imageUrl(v: any, named: Record<string, unknown>): string {
  const src = imageSrc(v);
  if (!src) return '';
  const w = named.width !== undefined ? Math.round(num(named.width)) : undefined;
  let h = named.height !== undefined ? Math.round(num(named.height)) : undefined;
  const ratio = typeof v === 'object' && v ? num(v.aspect_ratio) : 0;
  if (w && !h && ratio) h = Math.round(w / ratio);
  return withParams(src, { width: w, height: h, crop: named.crop, format: named.format, pad_color: named.pad_color });
}

function translate(this: FilterThis, key: string, ...args: unknown[]): string {
  const rt = rtOf(this.context);
  const { named } = splitArgs(args);
  const trees = [rt.theme.localeFile(rt.locale), rt.theme.localeFile(rt.defaultLocale)];
  let val: unknown;
  for (const t of trees) { val = lookupKey(t, str(key)); if (val !== undefined) break; }
  if (val === undefined) return `translation missing: ${rt.locale}.${key}`;
  if (val && typeof val === 'object') {
    const count = named.count;
    const cat = count === undefined ? 'other' : new Intl.PluralRules(rt.locale.replace('_', '-')).select(num(count));
    const o = val as Record<string, string>;
    val = (count !== undefined && num(count) === 0 && o.zero) || o[cat] || o.other || '';
  }
  return str(val).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k: string) => (k in named ? str(named[k]) : m));
}

function jsonSafe(v: unknown): string {
  const seen = new WeakSet<object>();
  const s = JSON.stringify(v ?? null, (_k, val) => {
    if (typeof val === 'bigint') return Number(val);
    if (val && typeof val === 'object') { if (seen.has(val)) return undefined; seen.add(val); }
    return val;
  });
  return (s ?? 'null').replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

const PLACEHOLDERS = ['image', 'product-1', 'product-2', 'product-3', 'product-4', 'collection-1', 'collection-2', 'lifestyle-1', 'lifestyle-2'];

function placeholderSvg(name: string, cls: string): string {
  const hue = (Math.max(0, PLACEHOLDERS.indexOf(name)) * 37 + 215) % 360;
  return `<svg class="${escapeHtml(cls ? `placeholder-svg ${cls}` : 'placeholder-svg')}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 525 525" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true"><rect width="525" height="525" fill="hsl(${hue} 14% 90%)"/><g fill="none" stroke="hsl(${hue} 14% 62%)" stroke-width="8"><rect x="150" y="170" width="225" height="185" rx="10"/><circle cx="215" cy="230" r="18"/><path d="M160 340l70-70 45 45 40-40 50 50"/></g></svg>`;
}

function formatDate(this: FilterThis, v: unknown, fmt: unknown): string {
  const date = this.liquid.filters['date'] as unknown as (this: FilterThis, v: unknown, f: string) => string;
  return date.call(this, v, str(fmt));
}

function paginationHtml(p: any, named: Record<string, unknown>): string {
  if (!p || !Array.isArray(p.parts)) return '';
  let out = '';
  if (p.previous) out += `<span class="prev"><a href="${escapeHtml(p.previous.url)}" title="">${named.previous ?? '&laquo; Previous'}</a></span> `;
  for (const part of p.parts) {
    if (part.is_link) out += `<span class="page"><a href="${escapeHtml(part.url)}" title="">${escapeHtml(part.title)}</a></span> `;
    else if (part.title === String(p.current_page)) out += `<span class="page current">${escapeHtml(part.title)}</span> `;
    else out += `<span class="deco">${escapeHtml(part.title)}</span> `;
  }
  if (p.next) out += `<span class="next"><a href="${escapeHtml(p.next.url)}" title="">${named.next ?? 'Next &raquo;'}</a></span>`;
  return out.trim();
}

export function registerFilters(l: Liquid): void {
  const reg = (name: string, fn: F) => l.registerFilter(name, fn as never);

  // --- translation / urls / assets
  reg('t', translate as F);
  reg('translate', translate as F);
  reg('asset_url', function (v) { return rtOf(this.context).assetUrl(str(v)); });
  reg('file_url', function (v) { return rtOf(this.context).fileUrl(str(v)); });
  reg('global_asset_url', (v) => `/cdn/shopme/${str(v)}`);
  reg('shopify_asset_url', (v) => `/cdn/shopme/${str(v)}`);
  reg('inline_asset_content', function (v) { return rtOf(this.context).theme.read(`assets/${str(v)}`) ?? ''; });
  reg('stylesheet_tag', function (v, ...a) { const { named } = splitArgs(a); return `<link href="${escapeHtml(v)}" rel="stylesheet" type="text/css" media="${escapeHtml(named.media ?? 'all')}"${named.preload ? ' data-preload' : ''}>`; });
  reg('script_tag', (v) => `<script src="${escapeHtml(v)}"></script>`);
  reg('preload_tag', (v, ...a) => { const { named } = splitArgs(a); return `<link rel="preload" href="${escapeHtml(v)}"${attrs({ as: named.as, type: named.type, crossorigin: named.crossorigin })}>`; });
  reg('link_to', (v, ...a) => { const { pos, named } = splitArgs(a); return `<a href="${escapeHtml(pos[0] ?? '')}"${attrs({ title: named.title ?? pos[1], class: named.class, id: named.id })}>${str(v)}</a>`; });
  reg('url_for_type', (v) => `/collections/types?q=${encodeURIComponent(str(v))}`);
  reg('url_for_vendor', (v) => `/collections/vendors?q=${encodeURIComponent(str(v))}`);
  reg('link_to_type', (v) => `<a href="/collections/types?q=${encodeURIComponent(str(v))}" title="${escapeHtml(v)}">${escapeHtml(v)}</a>`);
  reg('link_to_vendor', (v) => `<a href="/collections/vendors?q=${encodeURIComponent(str(v))}" title="${escapeHtml(v)}">${escapeHtml(v)}</a>`);
  reg('link_to_tag', function (v, tag) { const c = this.context.getSync(['collection']) as any; const base = c?.url ?? '/collections/all'; return `<a href="${base}/${handleize(tag ?? v)}" title="${escapeHtml(v)}">${str(v)}</a>`; });
  reg('within', (v, c: any) => (c?.handle ? str(v).replace(/^\/products\//, `/collections/${c.handle}/products/`) : v));
  reg('highlight', (v, term) => (term ? str(v).replace(new RegExp(str(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => `<strong class="highlight">${m}</strong>`) : v));
  reg('highlight_active_tag', function (v, ...a) { const { named } = splitArgs(a); const tags = (this.context.getSync(['current_tags']) as string[]) ?? []; return tags.includes(str(v)) ? `<span class="active">${escapeHtml(v)}</span>` : `<a href="${named.href ?? '#'}">${escapeHtml(v)}</a>`; });
  reg('customer_login_link', (v) => `<a href="/account/login" id="customer_login_link">${str(v)}</a>`);
  reg('customer_logout_link', (v) => `<a href="/account/logout" id="customer_logout_link">${str(v)}</a>`);
  reg('customer_register_link', (v) => `<a href="/account/register" id="customer_register_link">${str(v)}</a>`);
  reg('default_pagination', (v, ...a) => paginationHtml(v, splitArgs(a).named));
  reg('default_errors', (v: any) => {
    const m = (v as { messages?: Record<string, string> } | null)?.messages;
    const list: string[] = Array.isArray(v) ? (m ? Object.values(m) : v) : [];
    return list.length ? `<div class="errors"><ul>${list.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul></div>` : '';
  });

  // --- money
  reg('money', function (v) { return formatMoney(rtOf(this.context), v, 'plain'); });
  reg('money_with_currency', function (v) { return formatMoney(rtOf(this.context), v, 'currency'); });
  reg('money_without_currency', function (v) { return formatMoney(rtOf(this.context), v, 'amount'); });
  reg('money_without_trailing_zeros', function (v) { return formatMoney(rtOf(this.context), v, 'trim'); });

  // --- images and media
  reg('image_url', (v, ...a) => imageUrl(v, splitArgs(a).named));
  // Legacy size strings: "300x200", "300x", "x200", "master" (no resize) and the named sizes. `scale: 2` doubles both sides.
  const NAMED_SIZES: Record<string, number> = { pico: 16, icon: 32, thumb: 50, small: 100, compact: 160, medium: 240, large: 480, grande: 600, original: 1024 };
  const legacyUrl = (v: unknown, size: unknown, rest: unknown[]) => {
    const src = imageSrc(v);
    const { named } = splitArgs(rest);
    const s = str(size).toLowerCase();
    const m = /^(\d*)x(\d*)$/.exec(s);
    const scale = named.scale ? num(named.scale) || 1 : 1;
    const dim = (x: string | number | undefined) => (x ? Math.round(Number(x) * scale) : undefined);
    const w = m ? dim(m[1]) : s in NAMED_SIZES ? dim(NAMED_SIZES[s]) : undefined;
    const h = m ? dim(m[2]) : s in NAMED_SIZES ? dim(NAMED_SIZES[s]) : undefined;
    return withParams(src, { width: w, height: h, crop: named.crop, format: named.format, pad_color: named.pad_color });
  };
  reg('img_url', (v, size?: unknown, ...rest) => legacyUrl(v, size, rest));
  for (const n of ['product_img_url', 'collection_img_url', 'article_img_url', 'file_img_url']) reg(n, (v, size?: unknown, ...rest) => legacyUrl(v, size, rest));
  const tag = (v: any, a: unknown[]) => {
    const { named } = splitArgs(a);
    const src = imageSrc(v);
    if (!src) return '';
    const { widths, sizes, width, height, alt, loading, class: cls, ...rest } = named;
    const w = width !== undefined ? num(width) : queryNumber(src, 'width') ?? (typeof v === 'object' ? v?.width : undefined);
    const hgt = height !== undefined ? num(height) : queryNumber(src, 'height') ?? (typeof v === 'object' && w && v?.aspect_ratio ? Math.round(num(w) / num(v.aspect_ratio)) : undefined);
    let srcset: string | undefined;
    if (widths) {
      const [path0 = '', query0 = ''] = src.split('?');
      const keep = query0.split('&').filter((x) => x && !/^(width|height)=/.test(x));
      const base = keep.length ? `${path0}?${keep.join('&')}` : path0;
      // Cropped/padded variants keep their aspect ratio at every width.
      const sw = queryNumber(src, 'width'); const sh = queryNumber(src, 'height');
      srcset = str(widths).split(',').map((x) => x.trim()).filter(Boolean).map((x) => `${withParams(base, { width: x, height: sw && sh && /[?&](crop|pad_color)=/.test(src) ? Math.round((Number(x) * sh) / sw) : undefined })} ${x}w`).join(', ');
    }
    const dataAttrs: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(rest)) dataAttrs[k.replace(/_/g, '-')] = val;
    return `<img${attrs({ src, alt: alt ?? (typeof v === 'object' ? v?.alt ?? '' : ''), class: cls, srcset, sizes, width: w, height: hgt, loading, ...dataAttrs })}>`;
  };
  reg('image_tag', (v, ...a) => tag(v, a));
  reg('img_tag', (v, alt?: unknown, cls?: unknown) => tag(v, [['alt', alt ?? ''], ['class', cls]]));
  reg('placeholder_svg_tag', (v, cls?: unknown) => placeholderSvg(str(v), str(cls)));
  reg('video_tag', (v: any, ...a) => {
    const { named } = splitArgs(a);
    const sources = (v?.sources ?? []) as { url: string; mime_type?: string }[];
    return `<video${attrs({ controls: named.controls, autoplay: named.autoplay, loop: named.loop, muted: named.muted, playsinline: true, class: named.class, poster: v?.preview_image?.src, preload: named.preload })}>${sources.map((s) => `<source src="${escapeHtml(s.url)}" type="${escapeHtml(s.mime_type ?? 'video/mp4')}">`).join('')}</video>`;
  });
  reg('external_video_url', (v: any, ...a) => {
    const { named } = splitArgs(a);
    const host = str(v?.host); const id = str(v?.external_id);
    const base = host === 'youtube' ? `https://www.youtube.com/embed/${id}` : `https://player.vimeo.com/video/${id}`;
    return withParams(base, { autoplay: named.autoplay ? 1 : undefined, loop: named.loop ? 1 : undefined, mute: named.muted ? 1 : undefined });
  });
  reg('external_video_tag', function (v: any, ...a) {
    const url = (l.filters['external_video_url'] as unknown as F).call(this, v, ...a);
    return `<iframe${attrs({ src: url, class: splitArgs(a).named.class, allow: 'autoplay; encrypted-media', allowfullscreen: true, frameborder: 0, title: v?.alt ?? '' })}></iframe>`;
  });
  reg('media_tag', function (v: any, ...a) {
    const t = v?.media_type;
    const f = t === 'video' ? 'video_tag' : t === 'external_video' ? 'external_video_tag' : t === 'model' ? 'model_viewer_tag' : 'image_tag';
    return (l.filters[f] as unknown as F).call(this, v, ...a);
  });
  reg('model_viewer_tag', (v: any) => `<model-viewer src="${escapeHtml(v?.sources?.[0]?.url ?? '')}" camera-controls></model-viewer>`);

  // --- fonts (system and locally available faces only)
  reg('font_face', function (v: any, ...a) {
    const f = typeof v === 'string' ? parseFont(v) : v;
    if (!f || f.system) return '';
    const { named } = splitArgs(a);
    return `@font-face { font-family: "${f.family}"; font-weight: ${f.weight}; font-style: ${f.style}; font-display: ${named.font_display ?? 'swap'}; src: local("${f.family}"); }`;
  });
  reg('font_url', () => '');
  reg('font_modify', (v: any, prop, value) => {
    const f = typeof v === 'string' ? parseFont(v) : { ...v };
    if (!f) return v;
    if (prop === 'weight') {
      const s = str(value);
      f.weight = s === 'normal' ? 400 : s === 'bold' ? 700 : /^[+-]/.test(s) ? f.weight + num(s) : s === 'lighter' ? f.weight - 100 : s === 'bolder' ? f.weight + 100 : num(s);
    } else if (prop === 'style') f.style = str(value);
    return f;
  });

  // --- text and encoding
  reg('handleize', (v) => handleize(v));
  reg('handle', (v) => handleize(v));
  reg('json', (v) => jsonSafe(v));
  reg('md5', (v) => createHash('md5').update(str(v)).digest('hex'));
  reg('sha1', (v) => createHash('sha1').update(str(v)).digest('hex'));
  reg('hmac_sha1', (v, k) => createHmac('sha1', str(k)).update(str(v)).digest('hex'));
  reg('base64_url_safe_encode', (v) => Buffer.from(str(v)).toString('base64url'));
  reg('base64_url_safe_decode', (v) => Buffer.from(str(v), 'base64url').toString());
  reg('camelize', (v) => str(v).replace(/[-_\s]+(.)?/g, (_m, c: string) => (c ? c.toUpperCase() : '')).replace(/^./, (c) => c.toLowerCase()));
  reg('pluralize', (v, one, many) => (num(v) === 1 ? one : many));
  reg('weight_with_unit', function (v) { const shop = this.context.getSync(['shop']) as any; const unit = str(shop?.weight_unit ?? 'kg'); const g = num(v); const val = unit === 'g' ? g : unit === 'lb' ? g / 453.592 : unit === 'oz' ? g / 28.3495 : g / 1000; return `${val.toFixed(1)} ${unit}`; });
  reg('time_tag', function (v, ...a) {
    const { pos, named } = splitArgs(a);
    const iso = (() => { const d = v === 'now' || v === 'today' ? new Date() : new Date(str(v)); return Number.isNaN(+d) ? '' : d.toISOString(); })();
    const fmt = pos[0] ?? '%B %d, %Y';
    return `<time${attrs({ datetime: named.datetime ?? iso })}>${formatDate.call(this, v, fmt)}</time>`;
  });
  reg('format_code', (v) => str(v).replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 '));
  reg('format_address', (v: any) => {
    if (!v) return '';
    const lines = [[v.first_name, v.last_name].filter(Boolean).join(' '), v.company, v.address1, v.address2, [v.zip, v.city].filter(Boolean).join(' '), v.province_code ? `${v.province_code}` : '', v.country, v.phone].filter(Boolean);
    return `<p>${lines.map(escapeHtml).join('<br>')}</p>`;
  });

  // --- cart helpers
  reg('item_count_for_variant', (cart: any, id) => ((cart?.items ?? []) as any[]).filter((i) => String(i.variant_id) === str(id)).reduce((n, i) => n + num(i.quantity), 0));
  reg('line_items_for', (cart: any, v: any) => ((cart?.items ?? []) as any[]).filter((i) => (v?.variants ? String(i.product_id) === str(v.id) : String(i.variant_id) === str(v?.id))));

  // --- structured data and widgets
  reg('structured_data', function (v: any) {
    if (!v || typeof v !== 'object') return '{}';
    const shop = this.context.getSync(['shop']) as any;
    const money = (c: unknown) => (num(c) / 100).toFixed(2);
    const variants = (v.variants ?? []) as any[];
    return jsonSafe({
      '@context': 'http://schema.org/', '@type': 'Product', name: v.title, url: v.url, description: str(v.description).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      image: v.featured_image ? [imageSrc(v.featured_image)] : undefined, brand: v.vendor ? { '@type': 'Brand', name: v.vendor } : undefined,
      offers: variants.map((x) => ({ '@type': 'Offer', sku: x.sku || undefined, price: money(x.price), priceCurrency: shop?.currency, availability: x.available ? 'http://schema.org/InStock' : 'http://schema.org/OutOfStock', url: x.url })),
    });
  });
  for (const n of ['payment_terms', 'payment_button', 'login_button', 'metafield_tag', 'standard_event_data']) reg(n, () => '');
  reg('applicable_disclosures', () => []);
  reg('unit_price_with_measurement', () => '');
  reg('payment_type_svg_tag', (v) => `<svg class="icon icon--full-color" viewBox="0 0 38 24" role="img" aria-label="${escapeHtml(v)}" xmlns="http://www.w3.org/2000/svg"><rect width="36" height="22" x="1" y="1" rx="3" fill="#fff" stroke="#999"/><text x="19" y="15" font-size="6" text-anchor="middle" fill="#333">${escapeHtml(str(v).slice(0, 8))}</text></svg>`);
  reg('payment_type_img_url', (v) => `/cdn/shopme/payment-${handleize(v)}.svg`);

  registerColorFilters(l);
}
