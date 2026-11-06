import { cpSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseId } from '@shopme/shopify-compat';
import { schema } from '@shopme/core';
import { createTestApp, setupAndLogin, SETUP_BODY, type TestApp } from './test-utils';

const fixtureThemes = fileURLToPath(new URL('../../../packages/core/test-fixtures/themes', import.meta.url));

/** A themes folder (the fixture theme plus a previews folder with one image) for a test app to serve. */
function themesFolder() {
  const themesDir = mkdtempSync(path.join(tmpdir(), 'shopme-bundled-themes-'));
  cpSync(fixtureThemes, themesDir, { recursive: true });
  mkdirSync(path.join(themesDir, 'previews'), { recursive: true });
  writeFileSync(path.join(themesDir, 'previews', 'fixture-tea-desktop.webp'), 'RIFF....WEBPVP8 ');
  writeFileSync(path.join(themesDir, 'previews', 'fixture-tea-mobile.webp'), 'RIFF....WEBPVP8 ');
  return themesDir;
}
const rewrite = (file: string, f: (text: string) => string) => {
  writeFileSync(file, f(readFileSync(file, 'utf8')));
  const t = new Date(Date.now() + 5_000 + Math.floor(Math.random() * 1_000));
  utimesSync(file, t, t);
};

describe('bundled themes: gallery, install and updates (Admin GraphQL)', () => {
  let t: TestApp;
  let cookie: string;
  const themesDir = themesFolder();
  const g = async (query: string, variables?: Record<string, unknown>) => {
    const r = await t.app.inject({ method: 'POST', url: '/admin/api/2026-10/graphql.json', cookies: { shopme_session: cookie }, payload: { query, variables } });
    const j = r.json();
    if (j.errors) throw new Error(JSON.stringify(j.errors));
    return j.data;
  };
  const INSTALL = `mutation($h: String!) { shopmeThemeInstallBundled(handle: $h) {
    theme { id name role shopmeBundledTheme { handle name installedVersion bundledVersion updateAvailable } } userErrors { field message code } } }`;
  const fileBody = async (gid: string, filename: string) =>
    (await g(`query($id: ID!, $f: [String!]) { theme(id: $id) { files(filenames: $f) { nodes { body { ... on OnlineStoreThemeFileBodyText { content } } } } } }`, { id: gid, f: [filename] })).theme.files.nodes[0]?.body.content as string;

  beforeAll(async () => {
    t = await createTestApp({}, { paths: { themesDir } });
    cookie = await setupAndLogin(t.app);
  }, 60_000);
  afterAll(async () => { await t.close(); });

  it('lists Aurora and the bundled themes with their metadata and preview URLs', async () => {
    const r = await g('{ shopmeBundledThemes { handle name version author description tags previews { desktop mobile } } }');
    expect(r.shopmeBundledThemes.map((x: { handle: string }) => x.handle)).toEqual(['aurora', 'fixture-tea']);
    const [aurora, tea] = r.shopmeBundledThemes;
    expect(aurora).toMatchObject({ handle: 'aurora', name: 'Aurora', author: 'ShopMe contributors', previews: { desktop: null, mobile: null } });
    expect(aurora.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(tea).toEqual({
      handle: 'fixture-tea', name: 'Fixture Tea', version: '1.0.0', author: 'ShopMe contributors', description: 'A tiny theme used by the tests.', tags: ['Food', 'Test'],
      previews: { desktop: '/admin/api/theme-previews/fixture-tea-desktop.webp', mobile: '/admin/api/theme-previews/fixture-tea-mobile.webp' },
    });
    const fr = await g('{ shopmeBundledThemes(locale: "fr") { handle description } }');
    expect(fr.shopmeBundledThemes[1]).toEqual({ handle: 'fixture-tea', description: 'Un tout petit thème utilisé par les tests.' });
    expect(fr.shopmeBundledThemes[0].description).toContain('boutique');
  });

  it('lists the pages a theme has a template for and its changelog (theme store details)', async () => {
    const r = await g('{ shopmeBundledThemes(locale: "fr") { handle templates changelog { version date notes } } }');
    const aurora = r.shopmeBundledThemes.find((x: { handle: string }) => x.handle === 'aurora');
    expect(aurora.templates).toEqual(expect.arrayContaining(['index', 'product', 'customers/login', 'customers/account', 'customers/order', 'customers/addresses']));
    expect([...aurora.templates].sort()).toEqual(aurora.templates); // stable order
    const versions = aurora.changelog.map((v: { version: string }) => v.version.split('.').map(Number));
    expect(versions[0]).toEqual([...versions].sort((a: number[], b: number[]) => b[0]! - a[0]! || b[1]! - a[1]! || b[2]! - a[2]!)[0]); // newest first
    expect(aurora.changelog.length).toBeGreaterThan(1);
    expect(aurora.changelog[0].notes.join(' ')).toMatch(/[a-zé]/);
    const tea = r.shopmeBundledThemes.find((x: { handle: string }) => x.handle === 'fixture-tea');
    expect(tea.templates).toContain('index');
    expect(Array.isArray(tea.changelog)).toBe(true);
  });

  it('serves the previews to signed-in admins only', async () => {
    const url = '/admin/api/theme-previews/fixture-tea-desktop.webp';
    const ok = await t.app.inject({ url, cookies: { shopme_session: cookie } });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/webp');
    expect(ok.headers['cache-control']).toContain('private');
    expect(ok.rawPayload.toString()).toContain('WEBP');
    expect((await t.app.inject({ url })).statusCode).toBe(401);
    expect((await t.app.inject({ url: '/admin/api/bundled-themes' })).statusCode).toBe(401);
    for (const bad of ['/admin/api/theme-previews/nope-desktop.webp', '/admin/api/theme-previews/..%2F..%2Fpackage.json', '/admin/api/theme-previews/fixture-tea-desktop.png', '/admin/api/theme-previews/LICENSE']) {
      expect((await t.app.inject({ url: bad, cookies: { shopme_session: cookie } })).statusCode, bad).toBe(404);
    }
    const list = await t.app.inject({ url: '/admin/api/bundled-themes?locale=fr', cookies: { shopme_session: cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json().themes.map((x: { handle: string; description: string }) => x.handle)).toEqual(['aurora', 'fixture-tea']);
  });

  it('adds a theme to the library, unpublished, with its origin', async () => {
    const r = (await g(INSTALL, { h: 'fixture-tea' })).shopmeThemeInstallBundled;
    expect(r.userErrors).toEqual([]);
    expect(r.theme).toMatchObject({ name: 'Fixture Tea', role: 'UNPUBLISHED', shopmeBundledTheme: { handle: 'fixture-tea', name: 'Fixture Tea', installedVersion: '1.0.0', bundledVersion: '1.0.0', updateAvailable: false } });
    const [row] = await t.dbHandle.db.select().from(schema.themes).where(eq(schema.themes.id, parseId(r.theme.id, 'OnlineStoreTheme')!));
    expect(row).toMatchObject({ originTheme: 'fixture-tea', originVersion: '1.0.0', role: 'UNPUBLISHED' });
    expect(Object.keys(row!.originChecksums!)).toContain('layout/theme.liquid');
    expect(await fileBody(r.theme.id, 'templates/index.json')).toContain('"heading": "Fresh tea, delivered"');
    const main = (await g('{ themes(first: 5, roles: [MAIN]) { nodes { name } } }')).themes.nodes;
    expect(main.map((n: { name: string }) => n.name)).not.toContain('Fixture Tea');
  });

  it('answers NOT_FOUND for a handle that is not a bundled theme', async () => {
    for (const h of ['nope', '../theme-default', 'previews', '']) {
      const r = (await g(INSTALL, { h })).shopmeThemeInstallBundled;
      expect(r.theme, h).toBeNull();
      expect(r.userErrors, h).toEqual([{ field: ['handle'], message: 'No bundled theme has this handle', code: 'NOT_FOUND' }]);
    }
  });

  it('applies French seed texts when the shop language is French', async () => {
    await t.dbHandle.db.update(schema.shops).set({ locale: 'fr' });
    const r = (await g(INSTALL, { h: 'fixture-tea' })).shopmeThemeInstallBundled;
    expect(await fileBody(r.theme.id, 'templates/index.json')).toContain('"heading": "Du thé frais, livré chez vous"');
    expect(await fileBody(r.theme.id, 'sections/hero.liquid')).toContain('"default": "Petites quantités, infusées lentement."');
    await t.dbHandle.db.update(schema.shops).set({ locale: 'en' });
  });

  it('detects an update for a bundled theme that is not Aurora, and updates it', async () => {
    const dir = path.join(themesDir, 'fixture-tea');
    rewrite(path.join(dir, 'config', 'settings_schema.json'), (x) => x.replace('"theme_version": "1.0.0"', '"theme_version": "1.1.0"'));
    rewrite(path.join(dir, 'changelog.json'), (x) => x.replace('"versions": [', '"versions": [{ "version": "1.1.0", "date": "2026-12-01", "notes": { "en": ["A bolder hero."], "fr": ["Un bandeau plus audacieux."] } },'));
    const list = (await g('{ themes(first: 20) { nodes { id name shopmeBundledTheme { handle installedVersion bundledVersion updateAvailable } } } }')).themes.nodes as { id: string; name: string; shopmeBundledTheme: { handle: string; updateAvailable: boolean } | null }[];
    const tea = list.find((x) => x.name === 'Fixture Tea')!;
    expect(tea.shopmeBundledTheme).toEqual({ handle: 'fixture-tea', installedVersion: '1.0.0', bundledVersion: '1.1.0', updateAvailable: true });
    // Aurora (installed with the store) is still current
    expect(list.find((x) => x.shopmeBundledTheme?.handle === 'aurora')?.shopmeBundledTheme?.updateAvailable).toBe(false);
    const notes = await g('query($id: ID!) { theme(id: $id) { shopmeBundledTheme { releaseNotes(locale: "fr") { version notes } } } }', { id: tea.id });
    expect(notes.theme.shopmeBundledTheme.releaseNotes).toEqual([{ version: '1.1.0', notes: ['Un bandeau plus audacieux.'] }]);
    const up = (await g(`mutation($id: ID!) { shopmeThemeUpdateToBundled(id: $id) { theme { name role shopmeBundledTheme { handle installedVersion updateAvailable } } previousVersion version userErrors { code } } }`, { id: tea.id })).shopmeThemeUpdateToBundled;
    expect(up).toEqual({ theme: { name: 'Fixture Tea 1.1.0', role: 'UNPUBLISHED', shopmeBundledTheme: { handle: 'fixture-tea', installedVersion: '1.1.0', updateAvailable: false } }, previousVersion: '1.0.0', version: '1.1.0', userErrors: [] });
  });
});

describe('starting theme of the first store', () => {
  let t: TestApp;
  const themesDir = themesFolder();
  // The first-store wizard is not signed in yet: it may list the themes and load their previews, and nobody else may once the store exists.
  beforeAll(async () => { t = await createTestApp({}, { paths: { themesDir } }); }, 60_000);
  afterAll(async () => { await t.close(); });

  it('lists the themes and serves previews before the store is set up, and refuses an unknown theme', async () => {
    const list = await t.app.inject({ url: '/admin/api/bundled-themes?locale=fr' });
    expect(list.statusCode).toBe(200);
    expect(list.json().themes.map((x: { handle: string }) => x.handle)).toEqual(['aurora', 'fixture-tea']);
    expect((await t.app.inject({ url: '/admin/api/theme-previews/fixture-tea-mobile.webp' })).statusCode).toBe(200);
    const bad = await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: { ...SETUP_BODY, theme: 'no-such-theme' } });
    expect(bad.statusCode).toBe(422);
    expect((await t.app.inject({ url: '/admin/api/setup/status' })).json()).toEqual({ needsSetup: true });
  });

  it('installs and publishes the chosen theme instead of Aurora', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: { ...SETUP_BODY, locale: 'fr', theme: 'fixture-tea' } });
    expect(res.statusCode, res.body).toBe(201);
    const themes = await t.dbHandle.db.select().from(schema.themes);
    expect(themes).toHaveLength(1);
    expect(themes[0]).toMatchObject({ name: 'Fixture Tea', role: 'MAIN', originTheme: 'fixture-tea', originVersion: '1.0.0' });
    const [idx] = await t.dbHandle.db.select({ body: schema.themeFiles.body }).from(schema.themeFiles).where(and(eq(schema.themeFiles.themeId, themes[0]!.id), eq(schema.themeFiles.path, 'templates/index.json')));
    expect(idx!.body).toContain('Du thé frais, livré chez vous');
    // signed out again: the lists need a session now
    expect((await t.app.inject({ url: '/admin/api/bundled-themes' })).statusCode).toBe(401);
    expect((await t.app.inject({ url: '/admin/api/theme-previews/fixture-tea-mobile.webp' })).statusCode).toBe(401);
  });
});

describe('starting theme without a choice', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp({}, { paths: { themesDir: themesFolder() } }); }, 60_000);
  afterAll(async () => { await t.close(); });

  it('publishes Aurora', async () => {
    await setupAndLogin(t.app);
    const themes = await t.dbHandle.db.select().from(schema.themes);
    expect(themes).toHaveLength(1);
    expect(themes[0]).toMatchObject({ name: 'Aurora', role: 'MAIN', originTheme: 'aurora' });
    const aurora = await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: { ...SETUP_BODY, theme: 'aurora' } });
    expect(aurora.statusCode).toBe(409); // already set up (multi-store runs: also 409)
  });
});

describe('starting theme of a new store (multi-store)', () => {
  let t: TestApp;
  let cookie: string;
  const host = { host: 'localhost' };
  beforeAll(async () => {
    t = await createTestApp({ MULTI_STORE: 'true' }, { paths: { themesDir: themesFolder() } });
    const res = await t.app.inject({ method: 'POST', url: '/admin/api/setup', headers: host, payload: SETUP_BODY });
    expect(res.statusCode, res.body).toBe(201);
    cookie = res.cookies.find((c) => c.name === 'shopme_session')!.value;
  }, 60_000);
  afterAll(async () => { await t.close(); });

  const create = (payload: Record<string, unknown>) => t.app.inject({ method: 'POST', url: '/admin/api/account/stores', headers: host, cookies: { shopme_session: cookie }, payload: { currency: 'EUR', country: 'FR', locale: 'en', ...payload } });

  it('lists the themes for a signed-in account', async () => {
    const r = await t.app.inject({ url: '/admin/api/bundled-themes', headers: host, cookies: { shopme_session: cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json().themes.map((x: { handle: string }) => x.handle)).toEqual(['aurora', 'fixture-tea']);
    expect((await t.app.inject({ url: '/admin/api/bundled-themes', headers: host })).statusCode).toBe(401);
  });

  it('creates the store with the chosen theme published, Aurora by default, and refuses an unknown theme', async () => {
    const tea = await create({ shopName: 'Tea Shop', handle: 'tea-shop', theme: 'fixture-tea' });
    expect(tea.statusCode, tea.body).toBe(201);
    const plain = await create({ shopName: 'Plain Shop', handle: 'plain-shop' });
    expect(plain.statusCode, plain.body).toBe(201);
    const bad = await create({ shopName: 'Bad Shop', handle: 'bad-shop', theme: 'nope' });
    expect(bad.statusCode).toBe(422);
    const mainOf = async (shopId: number) => (await t.dbHandle.db.select().from(schema.themes).where(and(eq(schema.themes.shopId, shopId), eq(schema.themes.role, 'MAIN'))))[0];
    expect(await mainOf(tea.json().store.id)).toMatchObject({ name: 'Fixture Tea', originTheme: 'fixture-tea' });
    expect(await mainOf(plain.json().store.id)).toMatchObject({ name: 'Aurora', originTheme: 'aurora' });
    expect(t.app.ctx.stores.idForHandle('bad-shop')).toBeFalsy();
  });
});
