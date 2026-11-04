// End-to-end runner: builds, starts the production server on a free port with a fresh PGlite DATA_DIR, runs the
// Playwright scenario, stops the server.   pnpm e2e            (E2E_SKIP_BUILD=1 to skip the build)
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScenario } from './scenario.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!process.env.E2E_SKIP_BUILD) {
  const build = spawnSync('pnpm', ['build'], { cwd: root, stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });

const port = await freePort();
const dataDir = mkdtempSync(path.join(tmpdir(), 'shopme-e2e-'));
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn('node', ['apps/server/dist/main.js'], {
  cwd: root,
  env: { ...process.env, NODE_ENV: 'production', PORT: String(port), HOST: '127.0.0.1', APP_URL: baseUrl, DATA_DIR: dataDir, SESSION_SECRET: 'e'.repeat(40), LOG_LEVEL: 'warn' },
  stdio: ['ignore', 'inherit', 'inherit'],
});
let serverExited = false;
server.on('exit', () => {
  serverExited = true;
});

let code = 0;
try {
  for (let i = 0; ; i++) {
    if (serverExited) throw new Error('server exited during startup');
    try {
      if ((await fetch(`${baseUrl}/admin/`)).ok) break;
    } catch {
      /* not up yet */
    }
    if (i > 150) throw new Error('server did not start in time');
    await new Promise((r) => setTimeout(r, 200));
  }
  await runScenario({ baseUrl, root });
  console.log('\nE2E PASSED');
} catch (err) {
  console.error('\nE2E FAILED:', err instanceof Error ? err.stack : err);
  code = 1;
} finally {
  server.kill('SIGTERM');
  await new Promise((r) => (serverExited ? r() : server.on('exit', r)));
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(code);
