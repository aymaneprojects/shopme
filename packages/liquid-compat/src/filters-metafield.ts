import type { Liquid } from 'liquidjs';
import { escapeHtml } from './runtime';

/** A metafield as the storefront exposes it: `{ type, value, list }` (value typed). */
interface Mf { type?: string; value?: unknown; list?: boolean }
const isMf = (v: unknown): v is Mf => !!v && typeof v === 'object' && 'type' in (v as object);

const text = (type: string, v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map((x) => text(type.replace(/^list\./, ''), x)).join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (type === 'money') return `${(Number(o.amount) / 100).toFixed(2)} ${String(o.currency_code ?? '')}`.trim();
    if (type === 'rating') return `${String(o.value)} / ${String(o.scale_max)}`;
    if ('unit' in o && 'value' in o) return `${String(o.value)} ${String(o.unit).toLowerCase()}`;
    return String(o.title ?? o.handle ?? o.alt ?? JSON.stringify(o));
  }
  if (type === 'rich_text_field') return String(v).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return String(v);
};

/** `metafield_text`: the value as plain text (lists comma separated, rich text stripped, multi-line text with `<br>`). */
export function metafieldText(mf: unknown): string {
  if (!isMf(mf)) return mf === null || mf === undefined ? '' : escapeHtml(String(mf));
  const type = mf.type ?? 'single_line_text_field';
  const out = escapeHtml(text(type, mf.value));
  return type.endsWith('multi_line_text_field') ? out.replace(/\r?\n/g, '<br>') : out;
}

const item = (type: string, v: unknown): string => {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  switch (type) {
    case 'url': return `<a href="${escapeHtml(String(v))}" class="metafield-url">${escapeHtml(String(v))}</a>`;
    case 'color': return `<span class="metafield-color" style="color:${escapeHtml(String(v))}">${escapeHtml(String(v))}</span>`;
    case 'rich_text_field': return `<div class="metafield-rich_text_field">${String(v)}</div>`;
    case 'boolean': return `<span class="metafield-boolean">${String(v)}</span>`;
    case 'date': return `<time datetime="${escapeHtml(String(v))}" class="metafield-date">${escapeHtml(String(v))}</time>`;
    case 'date_time': return `<time datetime="${escapeHtml(String(v))}" class="metafield-date_time">${escapeHtml(String(v))}</time>`;
    case 'file_reference': return o.src ? `<img src="${escapeHtml(String(o.src))}" alt="${escapeHtml(String(o.alt ?? ''))}" class="metafield-file_reference" loading="lazy">` : '';
    case 'product_reference': case 'collection_reference': case 'page_reference':
      return o.url ? `<a href="${escapeHtml(String(o.url))}" class="metafield-${type}">${escapeHtml(String(o.title ?? ''))}</a>` : '';
    case 'json': return `<span class="metafield-json">${escapeHtml(JSON.stringify(v))}</span>`;
    default: return `<span class="metafield-${type}">${escapeHtml(text(type, v)).replace(/\r?\n/g, type === 'multi_line_text_field' ? '<br>' : '\n')}</span>`;
  }
};

/** `metafield_tag`: HTML for the value, one element per type (`<span class="metafield-<type>">`, `<a>`, `<time>`, `<img>`, lists as `<ul>`). */
export function metafieldTag(mf: unknown): string {
  if (!isMf(mf)) return mf === null || mf === undefined ? '' : escapeHtml(String(mf));
  const type = mf.type ?? 'single_line_text_field';
  if (mf.value === null || mf.value === undefined) return '';
  if (type.startsWith('list.') && Array.isArray(mf.value)) {
    const base = type.slice(5);
    return `<ul class="metafield-${type.replace('.', '_')}">${mf.value.map((v) => `<li>${item(base, v)}</li>`).join('')}</ul>`;
  }
  return item(type, mf.value);
}

export function registerMetafieldFilters(l: Liquid): void {
  l.registerFilter('metafield_text', (v: unknown) => metafieldText(v));
  l.registerFilter('metafield_tag', (v: unknown) => metafieldTag(v));
}
