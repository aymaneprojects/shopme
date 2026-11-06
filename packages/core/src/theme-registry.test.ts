import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, createLocalStorage, runMigrations, schema, setupStore, type DbHandle, type Storage } from './index';
import {
  bundledThemeDescription, discoverBundledThemes, findBundledTheme, installBundledTheme, installStartingTheme, readThemePreview, themePreviewFiles, type ThemeRoots,
} from './services/theme-registry';
import { readThemeDir, seedDefaultsFor } from './services/theme-install';
import { readThemeReleaseNotes, themeUpdateStatus, updateThemeToBundled } from './services/theme-update';

const auroraDir = fileURLToPath(new URL('../../theme-default', import.meta.url));
const fixtureThemes = fileURLToPath(new URL('../test-fixtures/themes', import.meta.url));

/** A themes folder with the fixture theme, a folder that is not a theme, a broken one and a previews folder (the fixture's own). */
function themesFolder(): { themesDir: string; roots: ThemeRoots } {
  const themesDir = mkdtempSync(path.join(tmpdir(), 'shopme-themes-'));
  cpSync(fixtureThemes, themesDir, { recursive: true });
  mkdirSync(path.join(themesDir, 'notes'));
  writeFileSync(path.join(themesDir, 'notes', 'todo.txt'), 'not a theme');
  mkdirSync(path.join(themesDir, 'broken', 'config'), { recursive: true });
  writeFileSync(path.join(themesDir, 'broken', 'config', 'settings_schema.json'), '{ not json');
  // the fixture folder ships both previews of Fixture Tea; keep only the desktop one, to cover a missing image
  rmSync(path.join(themesDir, 'previews', 'fixture-tea-mobile.webp'));
  writeFileSync(path.join(themesDir, 'previews', 'fixture-tea-desktop.webp'), 'webp');
  // a "previews" folder must never be taken for a theme, even with a valid schema in it
  mkdirSync(path.join(themesDir, 'previews', 'config'));
  cpSync(path.join(themesDir, 'fixture-tea', 'config', 'settings_schema.json'), path.join(themesDir, 'previews', 'config', 'settings_schema.json'));
  return { themesDir, roots: { defaultDir: auroraDir, themesDir } };
}

/** Rewrite a file and move its mtime forward (package files are cached by mtime). */
function rewrite(file: string, f: (text: string) => string) {
  writeFileSync(file, f(readFileSync(file, 'utf8')));
  const t = new Date(Date.now() + 5_000 + Math.floor(Math.random() * 1_000));
  utimesSync(file, t, t);
}

describe('bundled theme registry', () => {
  const { themesDir, roots } = themesFolder();

  it('discovers Aurora first, then each theme folder with a valid settings schema', () => {
    const found = discoverBundledThemes(roots);
    expect(found.map((t) => t.handle)).toEqual(['aurora', 'fixture-tea']);
    expect(found[0]).toMatchObject({ handle: 'aurora', name: 'Aurora', author: 'ShopMe contributors', dir: auroraDir, seedLocales: ['fr'] });
    expect(found[0]!.tags).toEqual(expect.arrayContaining(['General']));
    expect(found[0]!.description.length).toBeGreaterThan(20);
    expect(found[1]).toMatchObject({
      handle: 'fixture-tea', name: 'Fixture Tea', version: '1.0.0', author: 'ShopMe contributors', description: 'A tiny theme used by the tests.',
      tags: ['Food', 'Test'], seedLocales: ['fr'],
    });
  });

  it('works without a themes folder', () => {
    expect(discoverBundledThemes({ defaultDir: auroraDir, themesDir: path.join(themesDir, 'nope') }).map((t) => t.handle)).toEqual(['aurora']);
    expect(discoverBundledThemes({ defaultDir: auroraDir }).map((t) => t.handle)).toEqual(['aurora']);
    expect(discoverBundledThemes({ defaultDir: path.join(themesDir, 'nope') })).toEqual([]);
  });

  it('finds a theme by handle and refuses anything that is not a theme folder', () => {
    expect(findBundledTheme(roots, 'fixture-tea')?.name).toBe('Fixture Tea');
    expect(findBundledTheme(roots, 'aurora')?.dir).toBe(auroraDir);
    for (const h of ['broken', 'notes', 'previews', 'nope', '..', '../theme-default', 'Fixture-Tea', '']) expect(findBundledTheme(roots, h), h).toBeNull();
  });

  it('describes a theme in the requested language, English as the fallback', () => {
    const t = findBundledTheme(roots, 'fixture-tea')!;
    expect(bundledThemeDescription(t, 'fr')).toBe('Un tout petit thème utilisé par les tests.');
    expect(bundledThemeDescription(t, 'fr-FR')).toBe('Un tout petit thème utilisé par les tests.');
    expect(bundledThemeDescription(t, 'de')).toBe('A tiny theme used by the tests.');
    expect(bundledThemeDescription(t, undefined)).toBe('A tiny theme used by the tests.');
  });

  it('finds the preview images and only serves preview file names', () => {
    expect(themePreviewFiles(roots, 'fixture-tea')).toEqual({ desktop: 'fixture-tea-desktop.webp', mobile: null });
    expect(themePreviewFiles(roots, 'aurora')).toEqual({ desktop: null, mobile: null });
    expect(themePreviewFiles({ defaultDir: auroraDir }, 'aurora')).toEqual({ desktop: null, mobile: null });
    expect(readThemePreview(roots, 'fixture-tea-desktop.webp')?.toString()).toBe('webp');
    for (const f of ['fixture-tea-mobile.webp', '../fixture-tea/LICENSE', '..%2Ffoo-desktop.webp', 'fixture-tea-desktop.png', 'x/../fixture-tea-desktop.webp']) expect(readThemePreview(roots, f), f).toBeNull();
  });

  it('the installer ignores the previews folder and anything outside the theme directories', () => {
    const files = readThemeDir(path.join(themesDir, 'fixture-tea')).map((f) => f.path);
    expect(files).toEqual(expect.arrayContaining(['layout/theme.liquid', 'templates/index.json', 'config/settings_schema.json']));
    expect(files.some((f) => f.includes('previews') || f === 'changelog.json' || f === 'LICENSE')).toBe(false);
    expect(readThemeDir(themesDir)).toEqual([]);
  });

  it('gives seed texts only in languages a theme has them for', () => {
    const tea = path.join(themesDir, 'fixture-tea');
    expect(seedDefaultsFor(tea, 'fr')['Shop the teas']).toBe('Voir les thés');
    expect(seedDefaultsFor(tea, 'fr-CA')['Shop the teas']).toBe('Voir les thés');
    expect(seedDefaultsFor(tea, 'en')).toEqual({});
    expect(seedDefaultsFor(tea, 'de')).toEqual({});
    expect(seedDefaultsFor(tea, undefined)).toEqual({});
    expect(seedDefaultsFor(path.join(themesDir, 'broken'), 'fr')).toEqual({});
    expect(seedDefaultsFor(tea, '../x')).toEqual({});
  });
});

describe('installing and updating a bundled theme (PGlite in memory)', () => {
  let h: DbHandle;
  let storage: Storage;
  let enShop: number;
  const setLocale = (locale: string) => h.db.update(schema.shops).set({ locale }).where(eq(schema.shops.id, enShop));
  const { themesDir, roots } = themesFolder();
  const textOf = async (themeId: number, p: string) =>
    (await h.db.select({ body: schema.themeFiles.body }).from(schema.themeFiles).where(and(eq(schema.themeFiles.themeId, themeId), eq(schema.themeFiles.path, p))))[0]?.body;

  beforeAll(async () => {
    h = await createDb({ memory: true });
    await runMigrations(h);
    storage = createLocalStorage(mkdtempSync(path.join(tmpdir(), 'shopme-theme-registry-')));
    ({ shop: { id: enShop } } = await setupStore(h.db, { shopName: 'En', email: 'en@b.com', password: 'password123', currency: 'eur', country: 'fr', locale: 'en' }));
  }, 60_000);
  afterAll(async () => { await h.close(); });

  it('adds the theme to the library as an unpublished theme and records its origin', async () => {
    const info = findBundledTheme(roots, 'fixture-tea')!;
    const theme = await installBundledTheme(h.db, storage, enShop, info);
    expect(theme).toMatchObject({ name: 'Fixture Tea', role: 'UNPUBLISHED', originTheme: 'fixture-tea', originVersion: '1.0.0', processing: false });
    const files = await h.db.select().from(schema.themeFiles).where(eq(schema.themeFiles.themeId, theme.id));
    expect(files.map((f) => f.path).sort()).toEqual(readThemeDir(info.dir).map((f) => f.path).sort());
    expect(Object.keys(theme.originChecksums!).sort()).toEqual(files.map((f) => f.path).sort());
    expect(await textOf(theme.id, 'templates/index.json')).toContain('"heading": "Fresh tea, delivered"');
    const [main] = await h.db.select().from(schema.themes).where(and(eq(schema.themes.shopId, enShop), eq(schema.themes.role, 'MAIN')));
    expect(main?.id).not.toBe(theme.id); // nothing was published
  });

  it('applies the theme’s French seed texts for a French shop, and none for a theme without any', async () => {
    await setLocale('fr');
    const theme = await installBundledTheme(h.db, storage, enShop, findBundledTheme(roots, 'fixture-tea')!);
    expect(await textOf(theme.id, 'templates/index.json')).toContain('"heading": "Du thé frais, livré chez vous"');
    expect(await textOf(theme.id, 'sections/hero.liquid')).toContain('"default": "Petites quantités, infusées lentement."');
    // a theme with no French seed map is installed as authored
    const bare = path.join(themesDir, 'bare');
    cpSync(path.join(themesDir, 'fixture-tea'), bare, { recursive: true });
    writeFileSync(path.join(bare, 'locales', 'fr.json'), '{ "general": { "shop": "Boutique" } }');
    rewrite(path.join(bare, 'config', 'settings_schema.json'), (t) => t.replace('Fixture Tea', 'Bare'));
    const info = findBundledTheme(roots, 'bare')!;
    expect(info.seedLocales).toEqual([]);
    const t2 = await installBundledTheme(h.db, storage, enShop, info);
    await setLocale('en');
    expect(t2.name).toBe('Bare');
    expect(await textOf(t2.id, 'templates/index.json')).toContain('"heading": "Fresh tea, delivered"');
  });

  it('installs a theme as the published theme of a new store', async () => {
    const fresh = await createDb({ memory: true });
    await runMigrations(fresh);
    const { shop } = await setupStore(fresh.db, { shopName: 'New', email: 'new@b.com', password: 'password123', currency: 'eur', country: 'fr', locale: 'fr' });
    const info = findBundledTheme(roots, 'fixture-tea')!;
    expect(await installStartingTheme(fresh.db, storage, shop.id, info)).toBe(true);
    const list = await fresh.db.select().from(schema.themes).where(eq(schema.themes.shopId, shop.id));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Fixture Tea', role: 'MAIN', originTheme: 'fixture-tea', originVersion: '1.0.0' });
    const [idx] = await fresh.db.select({ body: schema.themeFiles.body }).from(schema.themeFiles).where(and(eq(schema.themeFiles.themeId, list[0]!.id), eq(schema.themeFiles.path, 'templates/index.json')));
    expect(idx!.body).toContain('Du thé frais');
    expect(await installStartingTheme(fresh.db, storage, shop.id, info)).toBe(false); // already has files
    await fresh.close();
  });

  it('offers an update for a theme that is not Aurora, and creates the new version with the merchant’s settings', async () => {
    const [theme] = await h.db.select().from(schema.themes).where(and(eq(schema.themes.shopId, enShop), eq(schema.themes.originTheme, 'fixture-tea')));
    const id = theme!.id;
    expect(themeUpdateStatus(theme!, findBundledTheme(roots, 'fixture-tea'))).toEqual({ name: 'Fixture Tea', installedVersion: '1.0.0', bundledVersion: '1.0.0', updateAvailable: false });
    // an Aurora theme is not "from" this theme
    expect(themeUpdateStatus({ originTheme: 'aurora', originVersion: '1.0.0' }, findBundledTheme(roots, 'fixture-tea'))).toBeNull();

    // The merchant customizes the theme.
    await h.db.update(schema.themeFiles).set({ body: JSON.stringify({ current: { color_accent: '#115e59' }, presets: {} }), checksum: 'edited', sizeBytes: 10 })
      .where(and(eq(schema.themeFiles.themeId, id), eq(schema.themeFiles.path, 'config/settings_data.json')));

    // ShopMe ships Fixture Tea 1.1.0.
    const dir = path.join(themesDir, 'fixture-tea');
    rewrite(path.join(dir, 'config', 'settings_schema.json'), (t) => t.replace('"theme_version": "1.0.0"', '"theme_version": "1.1.0"'));
    rewrite(path.join(dir, 'sections', 'hero.liquid'), (t) => t.replace('<section class="hero">', '<section class="hero hero--v2">'));
    rewrite(path.join(dir, 'changelog.json'), (t) => t.replace('"versions": [', '"versions": [{ "version": "1.1.0", "date": "2026-12-01", "notes": { "en": ["A bolder hero."], "fr": ["Un bandeau plus audacieux."] } },'));

    const status = themeUpdateStatus(theme!, findBundledTheme(roots, 'fixture-tea'));
    expect(status).toEqual({ name: 'Fixture Tea', installedVersion: '1.0.0', bundledVersion: '1.1.0', updateAvailable: true });
    const info = findBundledTheme(roots, 'fixture-tea')!;
    expect(readThemeReleaseNotes(info.dir, 'fr', { after: '1.0.0', upTo: '1.1.0' })).toEqual([{ version: '1.1.0', date: '2026-12-01', notes: ['Un bandeau plus audacieux.'] }]);

    const r = await updateThemeToBundled(h.db, storage, enShop, id, roots);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ fromVersion: '1.0.0', toVersion: '1.1.0' });
    expect(r.value.theme).toMatchObject({ name: 'Fixture Tea 1.1.0', role: 'UNPUBLISHED', originTheme: 'fixture-tea', originVersion: '1.1.0' });
    expect(await textOf(r.value.theme.id, 'sections/hero.liquid')).toContain('hero--v2');
    expect(JSON.parse((await textOf(r.value.theme.id, 'config/settings_data.json'))!).current.color_accent).toBe('#115e59');
    // the original theme is untouched, and the new one is up to date
    expect((await textOf(id, 'sections/hero.liquid'))).not.toContain('hero--v2');
    expect(themeUpdateStatus(r.value.theme, findBundledTheme(roots, 'fixture-tea'))!.updateAvailable).toBe(false);

    const again = await updateThemeToBundled(h.db, storage, enShop, r.value.theme.id, roots);
    expect(again).toMatchObject({ ok: false, errors: [{ code: 'UP_TO_DATE' }] });
  });

  it('refuses to update a theme that did not come from a bundled theme, or whose bundled theme is gone', async () => {
    const aurora = await installBundledTheme(h.db, storage, enShop, findBundledTheme(roots, 'aurora')!);
    expect(aurora).toMatchObject({ name: 'Aurora', originTheme: 'aurora' });
    // Aurora's own update still resolves through the registry (it is at the shipped version here)
    expect(await updateThemeToBundled(h.db, storage, enShop, aurora.id, roots)).toMatchObject({ ok: false, errors: [{ code: 'UP_TO_DATE' }] });
    const [orphan] = await h.db.insert(schema.themes).values({ shopId: enShop, name: 'Gone', role: 'UNPUBLISHED', originTheme: 'removed-theme', originVersion: '1.0.0' }).returning();
    expect(await updateThemeToBundled(h.db, storage, enShop, orphan!.id, roots)).toMatchObject({ ok: false, errors: [{ code: 'BUNDLE_UNAVAILABLE' }] });
    const [plain] = await h.db.insert(schema.themes).values({ shopId: enShop, name: 'Uploaded', role: 'UNPUBLISHED' }).returning();
    expect(await updateThemeToBundled(h.db, storage, enShop, plain!.id, roots)).toMatchObject({ ok: false, errors: [{ code: 'NOT_BUNDLED_THEME' }] });
  });
});
