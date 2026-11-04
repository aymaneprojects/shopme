// Generates icon.png (1024), icon.ico and icon.icns from build/icon.svg. Run: pnpm --filter @shopme/desktop icons
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import png2icons from 'png2icons';

const build = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'build');
const png = await sharp(readFileSync(path.join(build, 'icon.svg')), { density: 384 }).resize(1024, 1024).png().toBuffer();
writeFileSync(path.join(build, 'icon.png'), png);
const ico = png2icons.createICO(png, png2icons.BICUBIC, 0, false, true);
const icns = png2icons.createICNS(png, png2icons.BICUBIC, 0);
if (!ico || !icns) throw new Error('icon conversion failed');
writeFileSync(path.join(build, 'icon.ico'), ico);
writeFileSync(path.join(build, 'icon.icns'), icns);
console.log('icons written to', build);
