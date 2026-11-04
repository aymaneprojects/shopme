#!/usr/bin/env node
/**
 * Regenerates `fixtures/admin-*.shape.json` from the private reverse-engineering captures
 * (full SDL + recorded sample responses). Only field PATHS and GraphQL TYPES are written; no values, no descriptions.
 *
 *   node apps/server/test/conformance/gen-shapes.mjs [path/to/shoppen-re/raw]
 *
 * The captures are private and never committed. The generated fixtures are committed, so the conformance tests
 * run without the private directory.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raw = process.argv[2] ?? process.env.SHOPPEN_RE_RAW ?? '/home/user/shoppen-re/raw';
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

function write(name, rootType, root, nodes) {
  const out = new Map();
  walk(nodes, rootType, '', out);
  const fields = [...out].map(([p, type]) => ({ path: p, type })).sort((a, b) => a.path.localeCompare(b.path));
  writeFileSync(path.join(outDir, `admin-${name}.shape.json`), `${JSON.stringify({ root, rootType, fields }, null, 2)}\n`);
  console.log(`admin-${name}.shape.json: ${fields.length} paths`);
}

const sample = (n) => JSON.parse(readFileSync(path.join(raw, `samples/${n}.json`), 'utf8'));
write('products', 'Product', 'products', sample('products'));
write('collections', 'Collection', 'collections', sample('collections').data.collections.nodes);
write('locations', 'Location', 'locations', sample('shop').data.locations.nodes);
