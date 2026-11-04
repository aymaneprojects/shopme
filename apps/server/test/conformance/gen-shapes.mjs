// Derives value-free shape fixtures (field paths + JSON types + status) from the private Ajax recordings.
// Usage: node gen-shapes.mjs [recordingsDir]   (default /home/user/shoppen-re/raw/storefront/ajax)
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = process.argv[2] ?? '/home/user/shoppen-re/raw/storefront/ajax';
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
if (!existsSync(src)) { console.error(`no recordings at ${src}`); process.exit(1); }

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);

function walk(v, prefix, acc) {
  const t = typeOf(v);
  if (prefix) acc[prefix] = acc[prefix] && acc[prefix] !== t ? [...new Set([...String(acc[prefix]).split('|'), t])].join('|') : t;
  if (t === 'array') for (const x of v) walk(x, `${prefix}[]`, acc);
  else if (t === 'object') for (const [k, x] of Object.entries(v)) walk(x, prefix ? `${prefix}.${k}` : k, acc);
}

const shapes = {};
for (const f of readdirSync(src).filter((x) => x.endsWith('.json')).sort()) {
  const d = JSON.parse(readFileSync(path.join(src, f), 'utf8'));
  const acc = {};
  const body = d.response?.json;
  if (body && typeof body === 'object') walk(body, '', acc);
  // Section HTML and free text are values; keep only the key of `sections.*`.
  for (const k of Object.keys(acc)) if (k.startsWith('sections.') && k.split('.').length > 2) delete acc[k];
  shapes[f.replace(/\.json$/, '')] = { method: d.request?.method, url: String(d.request?.url ?? '').split('?')[0], status: d.response?.status, shape: acc };
}
writeFileSync(path.join(out, 'ajax-shapes.shape.json'), `${JSON.stringify(shapes, null, 1)}\n`);
console.log(`wrote ${Object.keys(shapes).length} shapes`);
