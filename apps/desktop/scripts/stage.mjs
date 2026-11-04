// Builds apps/desktop/stage: the bundled main process (server included) plus the few runtime packages
// that cannot be bundled (PGlite ships WASM files, argon2 ships .node binaries). electron-builder packages
// `stage` as the app directory.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(root, '..', '..');
const stage = path.join(root, 'stage');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const serverPkg = JSON.parse(readFileSync(path.join(repo, 'apps/server/package.json'), 'utf8'));

const ARGON2 = serverPkg.dependencies['@node-rs/argon2'];
const PGLITE = serverPkg.dependencies['@electric-sql/pglite'];
// Each installer must carry its OS's binary whichever OS builds it (macOS ships x64 and arm64 builds),
// so all supported targets are fetched explicitly instead of relying on pnpm's host-only optional deps.
const ARGON2_BINARIES = ['win32-x64-msvc', 'darwin-x64', 'darwin-arm64', 'linux-x64-gnu'].map((t) => `@node-rs/argon2-${t}@${ARGON2}`);

if (!existsSync(path.join(repo, 'apps/admin/dist/index.html'))) {
  throw new Error('apps/admin/dist is missing: run "pnpm turbo run build" first');
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

await build({
  entryPoints: [path.join(root, 'src/main.ts')],
  outfile: path.join(stage, 'main.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external: ['electron', '@electric-sql/pglite', '@node-rs/argon2', 'pino-pretty'],
  // Bundled CommonJS dependencies (fastify, pino, ...) use require() and __dirname.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; import { fileURLToPath as __fu } from 'node:url'; import __p from 'node:path'; const require = __cr(import.meta.url); const __filename = __fu(import.meta.url); const __dirname = __p.dirname(__filename);",
  },
  logLevel: 'info',
});

writeFileSync(
  path.join(stage, 'package.json'),
  JSON.stringify(
    {
      name: 'shopme-desktop',
      productName: 'ShopMe',
      version: pkg.version,
      description: pkg.description,
      author: pkg.author,
      homepage: pkg.homepage,
      license: pkg.license,
      main: 'main.mjs',
      dependencies: { '@node-rs/argon2': ARGON2, '@electric-sql/pglite': PGLITE },
    },
    null,
    2,
  ),
);

// --force lets npm install the foreign-platform packages; no install scripts are needed (prebuilt binaries only).
execFileSync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['install', '--omit=dev', '--force', '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund', ...ARGON2_BINARIES],
  { cwd: stage, stdio: 'inherit', shell: process.platform === 'win32' },
);

// Files the server locates through startServer({ paths }) (see src/main.ts).
const res = path.join(stage, 'resources');
cpSync(path.join(repo, 'apps/admin/dist'), path.join(res, 'admin'), { recursive: true });
cpSync(path.join(repo, 'packages/core/drizzle'), path.join(res, 'migrations'), { recursive: true });
cpSync(path.join(repo, 'packages/theme-default'), path.join(res, 'theme'), {
  recursive: true,
  filter: (src) => !/[\\/](node_modules|src|tsconfig\.json)$/.test(src),
});
cpSync(path.join(root, 'build', 'icon.png'), path.join(res, 'icon.png'));
console.log('staged', stage);
