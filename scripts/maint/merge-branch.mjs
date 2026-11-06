#!/usr/bin/env node
// Merges a branch (or commit) into the current branch and resolves the conflicts that come back every time:
//   - list-style files (CHANGELOG.md, docs/dev/*.md, .env.example, i18n en.ts/fr.ts, server module index): both sides kept;
//   - apps/admin/src/graphql/index.ts: imports, the `operations` spread object and `export *` lines unioned;
//   - Drizzle migrations: our journal and snapshots kept, the branch's single new migration regenerated at the next
//     number (its INSERT/UPDATE/DELETE/SELECT backfills appended) and journal timestamps kept increasing.
// Anything else in conflict is left for a human and the script exits with code 2.
//
//   node scripts/maint/merge-branch.mjs <branch> [-m "message"] [--commit] [--verify]
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DRIZZLE = 'packages/core/drizzle';
const args = process.argv.slice(2);
const branch = args.find((a) => !a.startsWith('-') && args[args.indexOf(a) - 1] !== '-m');
const mIdx = args.indexOf('-m');
const message = mIdx >= 0 ? args[mIdx + 1] : `Merge ${branch}`;
if (!branch) { console.error('usage: merge-branch.mjs <branch> [-m message] [--commit] [--verify]'); process.exit(64); }

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
const gitOk = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' }).status === 0;
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const write = (f, s) => writeFileSync(path.join(ROOT, f), s);
const CONFLICT = /<<<<<<< [^\n]*\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>> [^\n]*\n/g;
const resolve = (f, fn) => write(f, read(f).replace(CONFLICT, (_, ours, theirs) => fn(ours, theirs)));

if (git('status', '--porcelain', '--untracked-files=no')) { console.error('working tree not clean'); process.exit(1); }
const ourMigrations = new Set(git('ls-tree', '--name-only', 'HEAD', `${DRIZZLE}/`).split('\n').filter((f) => f.endsWith('.sql')));
const added = git('diff', '--name-only', '--diff-filter=A', `HEAD...${branch}`, '--', `${DRIZZLE}/*.sql`).split('\n').filter(Boolean);
const user = ['-c', `user.name=${git('config', 'user.name')}`, '-c', `user.email=${git('config', 'user.email')}`];
const mergedClean = spawnSync('git', [...user, 'merge', '--no-ff', '--no-commit', branch], { cwd: ROOT, encoding: 'utf8' }).status === 0;
const conflicted = git('diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean);
const left = [];

const unionList = (o, t) => o + t;
const unionOps = (o, t) => {
  if (!/export const operations/.test(o)) return o + t;
  const lines = (s) => s.split('\n').filter((l) => l.startsWith('import'));
  const spreads = (s) => (s.match(/\{ (.*) \};/)?.[1] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const ops = [...new Set([...spreads(o), ...spreads(t)])];
  const header = o.split('\n').filter((l) => !l.startsWith('import') && !l.startsWith('export const operations')).join('\n');
  return [...new Set([...lines(o), ...lines(t)])].join('\n') + '\n' + header.replace(/\n+$/, '\n') + `export const operations: Record<string, string> = { ${ops.join(', ')} };\n`;
};

for (const f of conflicted) {
  if (f.startsWith(`${DRIZZLE}/meta/`)) { git('checkout', '--ours', '--', f); git('add', f); continue; }
  if (/(^|\/)(CHANGELOG\.md|\.env\.example)$/.test(f) || /^docs\/dev\/.*\.md$/.test(f) || /apps\/admin\/src\/i18n\/(en|fr)\.ts$/.test(f) || /graphql\/modules\/index\.ts$/.test(f)) {
    resolve(f, unionList); git('add', f); continue;
  }
  if (f === 'apps/admin/src/graphql/index.ts') { resolve(f, unionOps); git('add', f); continue; }
  left.push(f);
}

// Migrations: the branch added SQL files whose numbers may collide with ours.
const collisions = added.filter((f) => !ourMigrations.has(f) && [...ourMigrations].some((o) => path.basename(o).slice(0, 4) === path.basename(f).slice(0, 4)));
if (collisions.length > 1) left.push(`${collisions.length} colliding migrations (${collisions.join(', ')}): renumber by hand`);
if (collisions.length === 1) {
  const f = collisions[0];
  const original = read(f);
  git('rm', '-q', '--cached', f); rmSync(path.join(ROOT, f));
  const snap = `${DRIZZLE}/meta/${path.basename(f).slice(0, 4)}_snapshot.json`;
  if (!ourMigrations.size || !existsSync(path.join(ROOT, snap))) left.push(`missing our snapshot ${snap}`);
  const gen = spawnSync('pnpm', ['--filter', '@shopme/core', 'db:generate'], { cwd: ROOT, encoding: 'utf8' });
  const fresh = git('ls-files', '--others', '--exclude-standard', `${DRIZZLE}/`).split('\n').find((x) => x.endsWith('.sql'));
  if (gen.status !== 0 || !fresh) left.push(`could not regenerate ${f}`);
  else {
    const backfills = original.split('--> statement-breakpoint').map((s) => s.trim()).filter((s) => /^(--[^\n]*\n)*\s*(INSERT|UPDATE|DELETE|SELECT|WITH)\b/i.test(s));
    let sql = read(fresh).trimEnd();
    if (backfills.length) sql += '--> statement-breakpoint\n' + backfills.join('--> statement-breakpoint\n') + '\n';
    const target = `${DRIZZLE}/${path.basename(fresh).slice(0, 5)}${path.basename(f).slice(5)}`;
    write(fresh, sql); renameSync(path.join(ROOT, fresh), path.join(ROOT, target));
    const journal = JSON.parse(read(`${DRIZZLE}/meta/_journal.json`));
    const last = journal.entries.at(-1); last.tag = path.basename(target, '.sql');
    write(`${DRIZZLE}/meta/_journal.json`, JSON.stringify(journal, null, 2));
    console.log(`migration ${path.basename(f)} -> ${path.basename(target)} (${backfills.length} backfill statement(s) kept)`);
  }
}
// Journal timestamps must keep increasing, or the migrator skips the later entries on existing databases.
const jf = `${DRIZZLE}/meta/_journal.json`;
if (existsSync(path.join(ROOT, jf))) {
  const j = JSON.parse(read(jf)); let fixed = 0;
  for (let i = 1; i < j.entries.length; i++) if (j.entries[i].when <= j.entries[i - 1].when) { j.entries[i].when = j.entries[i - 1].when + 1000; fixed++; }
  if (fixed) { write(jf, JSON.stringify(j, null, 2)); console.log(`journal: ${fixed} timestamp(s) made increasing`); }
}
gitOk('add', '-A', DRIZZLE);

if (left.length) { console.error(`left for a human:\n  ${left.join('\n  ')}`); process.exit(2); }
console.log(mergedClean ? 'merged cleanly' : `resolved: ${conflicted.join(', ')}`);
if (args.includes('--verify')) {
  const v = spawnSync('bash', [path.join(ROOT, 'scripts/maint/verify.sh')], { cwd: ROOT, stdio: 'inherit' });
  if (v.status !== 0) { console.error('checks failed: not committing'); process.exit(3); }
}
if (args.includes('--commit')) { git(...user, 'commit', '-q', '-m', message); console.log(`committed ${git('rev-parse', '--short', 'HEAD')}`); }
