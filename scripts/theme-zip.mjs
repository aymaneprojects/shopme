// Writes an uploadable zip (Online Store > Themes > Upload zip) for each bundled theme: the theme files only (layout,
// templates, sections, blocks, snippets, config, locales and assets), without LICENSE, changelog, checksums or previews.
//
//   node scripts/theme-zip.mjs [handle...] [--out <dir>]     (no handle: every bundled theme; --out defaults to ./theme-zips)
//
// Writes <out>/<handle>-<version>.zip. Files of a type the theme installer does not read are left out, as it would ignore them.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { zipSync } = createRequire(path.join(root, 'packages/core/package.json'))('fflate');

const DIRS = ['layout', 'templates', 'sections', 'blocks', 'snippets', 'config', 'locales', 'assets'];
const TEXT = new Set(['.liquid', '.json', '.css', '.js', '.mjs', '.svg', '.txt', '.html']);
const BINARY = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp4', '.webm', '.mp3']);

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outDir = path.resolve(outIndex >= 0 ? (args.splice(outIndex, 2)[1] ?? '') : 'theme-zips');
const wanted = args;

/** The bundled themes: Aurora, then each folder of packages/themes with a settings schema. */
function bundled() {
  const list = [['aurora', path.join(root, 'packages/theme-default')]];
  const dir = process.env.THEMES_DIR ? path.resolve(process.env.THEMES_DIR) : path.join(root, 'packages/themes');
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).sort()) {
      if (name === 'previews' || name.startsWith('.') || name === 'node_modules') continue;
      if (existsSync(path.join(dir, name, 'config', 'settings_schema.json'))) list.push([name, path.join(dir, name)]);
    }
  }
  return list;
}

function themeInfo(dir) {
  const text = readFileSync(path.join(dir, 'config', 'settings_schema.json'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  return JSON.parse(text).find((g) => g?.name === 'theme_info') ?? {};
}

function collect(dir) {
  const files = {};
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const full = path.join(d, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      const rel = path.relative(dir, full).split(path.sep).join('/');
      const ext = path.extname(rel).toLowerCase();
      if (TEXT.has(ext) || (rel.startsWith('assets/') && BINARY.has(ext))) files[rel] = readFileSync(full);
    }
  };
  for (const d of DIRS) if (existsSync(path.join(dir, d))) walk(path.join(dir, d));
  return files;
}

const all = bundled();
for (const h of wanted) if (!all.some(([handle]) => handle === h)) { console.error(`unknown theme: ${h} (bundled: ${all.map(([handle]) => handle).join(', ')})`); process.exit(1); }
mkdirSync(outDir, { recursive: true });
for (const [handle, dir] of all) {
  if (wanted.length && !wanted.includes(handle)) continue;
  const files = collect(dir);
  const file = path.join(outDir, `${handle}-${themeInfo(dir).theme_version ?? '0.0.0'}.zip`);
  writeFileSync(file, zipSync(files, { level: 6 }));
  console.log(`${path.relative(process.cwd(), file)}  ${Object.keys(files).length} files`);
}
