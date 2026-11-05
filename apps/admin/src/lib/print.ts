export type PrintDoc = 'order' | 'packing';

export interface PrintableOrder {
  name: string; createdAt: string; email: string | null;
  lines: Array<{ title: string; variantTitle: string | null; sku: string | null; quantity: number; unitPrice: string; total: string }>;
  totals: Array<[string, string]>;
  shipping: string[]; billing: string[];
}
export interface PrintLabels {
  order: string; packing: string; date: string; item: string; sku: string; quantity: string; price: string; total: string; shipTo: string; billTo: string; blocked: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const block = (title: string, lines: string[]) => `<div><h3>${esc(title)}</h3>${lines.map((l) => `<div>${esc(l)}</div>`).join('') || '&nbsp;'}</div>`;

/** Self-contained HTML of the chosen documents (one page each), ready to print. */
export function printHtml(o: PrintableOrder, docs: PrintDoc[], l: PrintLabels, lang: string): string {
  const page = (doc: PrintDoc) => {
    const packing = doc === 'packing';
    const rows = o.lines.map((x) => `<tr><td>${esc(x.title)}${x.variantTitle ? `<div class="m">${esc(x.variantTitle)}</div>` : ''}</td><td>${esc(x.sku ?? '')}</td><td class="r">${x.quantity}</td>${packing ? '' : `<td class="r">${esc(x.unitPrice)}</td><td class="r">${esc(x.total)}</td>`}</tr>`).join('');
    const totals = packing ? '' : `<table class="t">${o.totals.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${esc(v)}</td></tr>`).join('')}</table>`;
    return `<section><h1>${esc(packing ? l.packing : l.order)} ${esc(o.name)}</h1><p class="m">${esc(l.date)}: ${esc(new Intl.DateTimeFormat(lang, { dateStyle: 'long', timeStyle: 'short' }).format(new Date(o.createdAt)))}${o.email ? ` · ${esc(o.email)}` : ''}</p>
<div class="g">${block(l.shipTo, o.shipping)}${packing ? '' : block(l.billTo, o.billing)}</div>
<table><thead><tr><th>${esc(l.item)}</th><th>${esc(l.sku)}</th><th class="r">${esc(l.quantity)}</th>${packing ? '' : `<th class="r">${esc(l.price)}</th><th class="r">${esc(l.total)}</th>`}</tr></thead><tbody>${rows}</tbody></table>${totals}</section>`;
  };
  return `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8"><title>${esc(o.name)}</title><style>
body{font:13px/1.5 system-ui,sans-serif;color:#111;margin:0}section{padding:32px;page-break-after:always}section:last-child{page-break-after:auto}
h1{font-size:20px;margin:0 0 4px}h3{font-size:12px;margin:0 0 4px;text-transform:uppercase;color:#555}.m{color:#666}.g{display:flex;gap:48px;margin:20px 0}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #ddd}.r{text-align:right}.t{width:280px;margin:16px 0 0 auto}.t td{border:0;padding:2px 8px}
</style></head><body>${docs.map(page).join('')}</body></html>`;
}

/** Print through a hidden frame so no popup is needed. Returns false when printing could not start. */
export function printDocuments(html: string): boolean {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const win = frame.contentWindow;
  if (!win) { frame.remove(); return false; }
  win.document.open(); win.document.write(html); win.document.close();
  win.addEventListener('afterprint', () => frame.remove());
  setTimeout(() => { win.focus(); win.print(); setTimeout(() => frame.remove(), 60_000); }, 50);
  return true;
}
