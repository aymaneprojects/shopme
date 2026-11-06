#!/usr/bin/env node
// Converts the source photos of a theme's demo catalogue to WebP in packages/themes/<handle>/demo/images/.
//
//   node scripts/theme-kit/demo-images.mjs [handle...] [--from <dir>]
//
// <dir>/<handle>/ holds <handle>-hero.jpg (2400x1350), <handle>-ambiance.jpg (1600x2000) and <handle>-produit-01..06.jpg (2048x2048).
// Products become 1200 px squares, the hero 2000 px wide, the ambiance photo 1200x1500. Quality starts at 80 and drops by steps
// until the file is at most 150 KB, to keep the repository lean. The photos are provided by the ShopMe project (CC0).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sharp = createRequire(path.join(ROOT, 'apps/server/package.json'))('sharp');
const args = process.argv.slice(2);
const fromAt = args.indexOf('--from');
const from = fromAt >= 0 ? path.resolve(args.splice(fromAt, 2)[1]) : '/home/user/theme-images';
const handles = args.length ? args : ['sillage', 'foyer', 'maroquin'];
const LIMIT = 150 * 1024;

async function toWebp(input, resize) {
  let out;
  for (let quality = 80; quality >= 40; quality -= 5) {
    out = await sharp(input).rotate().resize(resize).webp({ quality, effort: 6 }).toBuffer();
    if (out.length <= LIMIT) break;
  }
  return out;
}

for (const handle of handles) {
  const src = path.join(from, handle);
  const dest = path.join(ROOT, 'packages/themes', handle, 'demo/images');
  mkdirSync(dest, { recursive: true });
  const jobs = [
    [`${handle}-hero.jpg`, 'hero.webp', { width: 2000 }],
    [`${handle}-ambiance.jpg`, 'ambiance.webp', { width: 1200, height: 1500, fit: 'cover' }],
    ...[1, 2, 3, 4, 5, 6].map((n) => [`${handle}-produit-0${n}.jpg`, `produit-0${n}.webp`, { width: 1200, height: 1200, fit: 'cover' }]),
  ];
  for (const [file, name, resize] of jobs) {
    const input = path.join(src, file);
    if (!existsSync(input)) { console.error(`missing ${input}`); process.exitCode = 1; continue; }
    const out = await toWebp(readFileSync(input), resize);
    writeFileSync(path.join(dest, name), out);
    console.log(`${handle}/${name}  ${(out.length / 1024).toFixed(0)} KB`);
  }
}
