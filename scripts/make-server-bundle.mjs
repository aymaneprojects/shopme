#!/usr/bin/env node
// Builds the prebuilt server bundle from an already built tree:
//   shopme-server-<version>[-<arch>].tar.gz  (+ .sha256)
//
//   node scripts/make-server-bundle.mjs [--version 1.2.3] [--arch x64|arm64] [--out dist-bundle]
//
// Layout (it mirrors what the Dockerfile copies into /app, so paths resolve without configuration):
//   app/apps/server/{dist,node_modules,package.json}   server bundle and its production dependencies
//   app/apps/admin/dist                                admin SPA
//   app/packages/{core/drizzle,theme-default,themes}   migrations and bundled themes
//   templates/                                         compose, Caddy and nginx templates
//   shopme-install.sh, README.md, VERSION
//
// Run `pnpm turbo run build --filter=@shopme/server --filter=@shopme/admin` first. Native dependencies (sharp, argon2)
// are platform specific: build the bundle on the CPU architecture it is meant for.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync, readdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const o = { version: '', arch: '', out: path.join(root, 'dist-bundle') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (!v) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--version') o.version = next();
    else if (a === '--arch') o.arch = next();
    else if (a === '--out') o.out = path.resolve(next());
    else if (a === '-h' || a === '--help') {
      console.log('Usage: node scripts/make-server-bundle.mjs [--version x.y.z] [--arch x64|arm64] [--out dir]');
      process.exit(0);
    } else throw new Error(`Unknown option ${a}`);
  }
  return o;
}

const opts = parseArgs(process.argv.slice(2));
const version = (opts.version || JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version).replace(/^v/, '');
if (!/^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.]+)?$/.test(version)) throw new Error(`Invalid version "${version}"`);
if (opts.arch && !/^(x64|arm64)$/.test(opts.arch)) throw new Error('--arch must be x64 or arm64');

const need = (rel, hint) => {
  if (!existsSync(path.join(root, rel))) throw new Error(`${rel} is missing. ${hint}`);
};
need('apps/server/dist/main.js', 'Build first: pnpm turbo run build --filter=@shopme/server --filter=@shopme/admin');
need('packages/core/drizzle', 'The database migrations folder is missing.');

const stage = mkdtempSync(path.join(tmpdir(), 'shopme-bundle-'));
try {
  const app = path.join(stage, 'bundle', 'app');
  mkdirSync(path.join(app, 'apps/server'), { recursive: true });

  // Production dependencies of the server only (workspace packages are bundled into dist), like the Dockerfile.
  const deploy = path.join(stage, 'deploy');
  console.log('Installing production dependencies...');
  execFileSync('pnpm', ['--filter', '@shopme/server', '--prod', 'deploy', deploy], { cwd: root, stdio: 'inherit' });

  const copy = (from, to) => cpSync(from, to, { recursive: true, verbatimSymlinks: true });
  copy(path.join(deploy, 'node_modules'), path.join(app, 'apps/server/node_modules'));
  copyFileSync(path.join(deploy, 'package.json'), path.join(app, 'apps/server/package.json'));
  copy(path.join(root, 'apps/server/dist'), path.join(app, 'apps/server/dist'));
  copy(path.join(root, 'packages/core/drizzle'), path.join(app, 'packages/core/drizzle'));
  // Optional pieces, present once built: the admin SPA, the default theme and the themes folder.
  const skip = (src) => !/(^|[\\/])(node_modules|\.turbo)([\\/]|$)/.test(src);
  for (const d of ['apps/admin/dist', 'packages/theme-default', 'packages/themes']) {
    if (existsSync(path.join(root, d))) cpSync(path.join(root, d), path.join(app, d), { recursive: true, verbatimSymlinks: true, filter: skip });
    else console.warn(`warning: ${d} not found, left out`);
  }

  const bundle = path.join(stage, 'bundle');
  const templates = path.join(bundle, 'templates');
  mkdirSync(templates);
  for (const f of readdirSync(path.join(root, 'deploy/server'))) {
    if (f === 'README.md') copyFileSync(path.join(root, 'deploy/server', f), path.join(bundle, f));
    else copyFileSync(path.join(root, 'deploy/server', f), path.join(templates, f));
  }
  copyFileSync(path.join(root, 'shopme-install.sh'), path.join(bundle, 'shopme-install.sh'));
  chmodSync(path.join(bundle, 'shopme-install.sh'), 0o755);
  writeFileSync(path.join(bundle, 'VERSION'), `${version}\n`);

  mkdirSync(opts.out, { recursive: true });
  const name = `shopme-server-${version}${opts.arch ? `-${opts.arch}` : ''}.tar.gz`;
  const file = path.join(opts.out, name);
  rmSync(file, { force: true });
  const entries = readdirSync(bundle).sort();
  execFileSync('tar', ['--owner=0', '--group=0', '--numeric-owner', '-czf', file, '-C', bundle, ...entries], { stdio: 'inherit' });
  const sha = createHash('sha256').update(readFileSync(file)).digest('hex');
  writeFileSync(`${file}.sha256`, `${sha}  ${name}\n`);
  console.log(`Bundle: ${file}\nsha256: ${sha}`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
