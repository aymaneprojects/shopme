import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, createLocalStorage, runMigrations, schema, setupStore, upsertThemeFiles, type DbHandle, type Storage } from './index';
import {
  compareVersions, detectThemeOrigins, planThemeUpdate, readKnownChecksums, readThemeReleaseNotes, themeUpdateStatus, updateThemeToBundled,
  type CurrentThemeFile,
} from './services/theme-update';
import { ensureDefaultTheme, readBundledTheme, readThemeDir } from './services/theme-install';

const themeDir = fileURLToPath(new URL('../../theme-default', import.meta.url));
const md5 = (s: string | Buffer) => createHash('md5').update(s).digest('hex');
const pretty = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

describe('bundled theme version', () => {
  it('compares versions numerically', () => {
    expect(compareVersions('1.1.0', '1.2.0')).toBe(-1);
    expect(compareVersions('1.10.0', '1.9.3')).toBe(1);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1);
  });

  it('reads the name and version of the bundled theme, and its release notes in English and French', () => {
    const b = readBundledTheme(themeDir)!;
    expect(b).toMatchObject({ handle: 'aurora', name: 'Aurora' });
    expect(compareVersions(b.version, '1.2.0')).toBeGreaterThanOrEqual(0);
    const en = readThemeReleaseNotes(themeDir, 'en', { after: '1.1.0', upTo: b.version });
    expect(en[0]!.version).toBe(b.version);
    expect(en.some((v) => v.version === '1.1.0')).toBe(false);
    expect(en.find((v) => v.version === '1.2.0')!.notes.join(' ')).toMatch(/focal point/);
    const fr = readThemeReleaseNotes(themeDir, 'fr-FR', { after: '1.1.0' });
    expect(fr.find((v) => v.version === '1.2.0')!.notes.join(' ')).toMatch(/point focal/);
    // every version of the theme has notes in both languages
    const log = JSON.parse(readFileSync(path.join(themeDir, 'changelog.json'), 'utf8')) as { versions: { version: string; notes: { en: string[]; fr: string[] } }[] };
    expect(log.versions.map((v) => v.version)).toContain(b.version);
    for (const v of log.versions) { expect(v.notes.en.length, v.version).toBeGreaterThan(0); expect(v.notes.fr.length, v.version).toBe(v.notes.en.length); }
  });

  it('offers an update only for themes installed from an older version of the bundled theme', () => {
    const b = { handle: 'aurora', name: 'Aurora', version: '1.2.0' };
    expect(themeUpdateStatus({ originTheme: 'aurora', originVersion: '1.1.0' }, b)).toEqual({ name: 'Aurora', installedVersion: '1.1.0', bundledVersion: '1.2.0', updateAvailable: true });
    expect(themeUpdateStatus({ originTheme: 'aurora', originVersion: '1.2.0' }, b)!.updateAvailable).toBe(false);
    expect(themeUpdateStatus({ originTheme: 'aurora', originVersion: '1.3.0' }, b)!.updateAvailable).toBe(false);
    expect(themeUpdateStatus({ originTheme: null, originVersion: null }, b)).toBeNull();
    expect(themeUpdateStatus({ originTheme: 'other', originVersion: '1.0.0' }, b)).toBeNull();
    expect(themeUpdateStatus({ originTheme: 'aurora', originVersion: '1.0.0' }, null)).toBeNull();
  });

  it('lists the checksums of the files the theme has shipped', () => {
    const known = readKnownChecksums(themeDir);
    expect(known['layout/theme.liquid']!.length).toBeGreaterThan(1);
    expect(known['config/settings_schema.json']!.every((c) => /^[0-9a-f]{32}$/.test(c))).toBe(true);
  });
});

describe('update plan', () => {
  const section = (name: string, blocks: string[] = []) => `<div></div>\n{% schema %}\n${JSON.stringify({ name, blocks: blocks.map((type) => ({ type })) })}\n{% endschema %}\n`;
  const bundle = [
    { path: 'config/settings_schema.json', contentType: 'application/json', body: JSON.stringify([{ name: 'theme_info', theme_name: 'T', theme_version: '2.0.0' }, { name: 'Colors', settings: [{ id: 'color_primary', type: 'color' }, { id: 'color_new', type: 'color', default: '#000' }] }]) },
    { path: 'config/settings_data.json', contentType: 'application/json', body: pretty({ current: { color_primary: '#111111', color_new: '#222222' }, presets: { T: {} } }) },
    { path: 'sections/hero.liquid', contentType: 'text/x-liquid', body: section('Hero') },
    { path: 'sections/list.liquid', contentType: 'text/x-liquid', body: section('List', ['item', '@theme']) },
    { path: 'blocks/text.liquid', contentType: 'text/x-liquid', body: section('Text') },
    { path: 'snippets/card.liquid', contentType: 'text/x-liquid', body: 'card v2' },
    { path: 'templates/index.json', contentType: 'application/json', body: pretty({ sections: { hero: { type: 'hero', settings: {} } }, order: ['hero'] }) },
    { path: 'templates/page.json', contentType: 'application/json', body: pretty({ sections: { hero: { type: 'hero', settings: { v: 2 } } }, order: ['hero'] }) },
    { path: 'locales/en.default.json', contentType: 'application/json', body: pretty({ a: { title: 'Title v2', button: 'Buy', added: 'New string' } }) },
  ];
  const original: Record<string, string> = {
    'config/settings_data.json': pretty({ current: { color_primary: '#111111', old_toggle: true } }),
    'snippets/card.liquid': 'card v1',
    'snippets/old.liquid': 'old',
    'sections/gone.liquid': section('Gone'),
    'templates/index.json': pretty({ sections: { hero: { type: 'hero', settings: {} } }, order: ['hero'] }),
    'templates/page.json': pretty({ sections: { hero: { type: 'hero', settings: { v: 1 } } }, order: ['hero'] }),
    'locales/en.default.json': pretty({ a: { title: 'Title v1', button: 'Buy' } }),
    'sections/hero.liquid': section('Hero'),
  };
  const file = (p: string, body: string): CurrentThemeFile => ({ path: p, contentType: p.endsWith('.json') ? 'application/json' : 'text/x-liquid', body, checksum: md5(body), sizeBytes: body.length, storageKey: null });
  const merchant: CurrentThemeFile[] = [
    file('config/settings_data.json', pretty({ current: { color_primary: '#ff0000', old_toggle: false } })),
    file('snippets/card.liquid', 'card v1 with my change'),
    file('snippets/old.liquid', 'old'),
    file('sections/gone.liquid', `${section('Gone')}<!-- mine -->`),
    file('snippets/mine.liquid', 'my snippet'),
    file('templates/index.json', pretty({
      sections: {
        hero: { type: 'hero', settings: { heading: 'Mine' } },
        gone: { type: 'gone', settings: {} },
        list: { type: 'list', settings: {}, blocks: { a: { type: 'item', settings: {} }, b: { type: 'text', settings: {} }, c: { type: 'badge', settings: {} } }, block_order: ['a', 'b', 'c'] },
      },
      order: ['gone', 'hero', 'list'],
    })),
    file('templates/page.json', original['templates/page.json']!),
    file('locales/en.default.json', pretty({ a: { title: 'Title v1', button: 'Add to bag' } })),
    file('sections/hero.liquid', original['sections/hero.liquid']!),
    { path: 'assets/photo.jpg', contentType: 'image/jpeg', body: null, checksum: 'f'.repeat(32), sizeBytes: 10, storageKey: 'uploads/photo.jpg' },
  ];
  const plan = planThemeUpdate({
    current: merchant, bundleText: bundle, bundleBinary: [],
    isBundledPath: (p) => p in original, isPristine: (p, c) => md5(original[p] ?? '') === c, originalText: (p) => original[p],
  });
  const body = (p: string) => plan.files.find((f) => f.path === p)?.body;

  it('keeps the merchant\'s theme settings the new schema still has, with new settings at their new value', () => {
    expect(JSON.parse(body('config/settings_data.json')!)).toEqual({ current: { color_primary: '#ff0000', color_new: '#222222' }, presets: { T: {} } });
    expect(plan.removedSettings).toEqual(['old_toggle']);
  });

  it('carries customized templates over, without the sections and blocks whose type is gone', () => {
    const index = JSON.parse(body('templates/index.json')!);
    expect(index.order).toEqual(['hero', 'list']);
    expect(index.sections.hero.settings.heading).toBe('Mine');
    expect(index.sections.gone).toBeUndefined();
    expect(Object.keys(index.sections.list.blocks)).toEqual(['a', 'b']);
    expect(index.sections.list.block_order).toEqual(['a', 'b']);
    expect(plan.removedReferences).toEqual([
      { filename: 'templates/index.json', kind: 'SECTION', id: 'gone', type: 'gone' },
      { filename: 'templates/index.json', kind: 'BLOCK', id: 'list/c', type: 'badge' },
    ]);
    // an untouched template takes the new version
    expect(JSON.parse(body('templates/page.json')!).sections.hero.settings.v).toBe(2);
  });

  it('reports edited theme files instead of merging them, and keeps the merchant\'s own files', () => {
    expect(body('snippets/card.liquid')).toBe('card v2');
    expect(plan.skipped).toEqual([{ filename: 'sections/gone.liquid', reason: 'REMOVED_IN_NEW_VERSION' }, { filename: 'snippets/card.liquid', reason: 'EDITED' }]);
    expect(body('snippets/mine.liquid')).toBe('my snippet');
    expect(plan.files.find((f) => f.path === 'assets/photo.jpg')).toMatchObject({ body: null, storageKey: 'uploads/photo.jpg', source: 'merchant' });
    // untouched files of the old version that the new one dropped are left out
    expect(body('snippets/old.liquid')).toBeUndefined();
    expect(body('sections/gone.liquid')).toBeUndefined();
    expect(plan.carriedOver).toEqual(['assets/photo.jpg', 'config/settings_data.json', 'locales/en.default.json', 'snippets/mine.liquid', 'templates/index.json']);
  });

  it('lays the merchant\'s locale edits over the new strings', () => {
    expect(JSON.parse(body('locales/en.default.json')!)).toEqual({ a: { title: 'Title v2', button: 'Add to bag', added: 'New string' } });
    // without the installed text, every string that differs from the new version counts as the merchant's
    const blind = planThemeUpdate({ current: merchant, bundleText: bundle, bundleBinary: [], isBundledPath: (p) => p in original, isPristine: (p, c) => md5(original[p] ?? '') === c });
    expect(JSON.parse(blind.files.find((f) => f.path === 'locales/en.default.json')!.body!).a).toEqual({ title: 'Title v1', button: 'Add to bag', added: 'New string' });
  });

  it('records the new version\'s files as the baseline of later edits', () => {
    expect(plan.baseline['snippets/card.liquid']).toBe(md5('card v2'));
    expect(plan.baseline['templates/index.json']).toBe(md5(bundle.find((f) => f.path === 'templates/index.json')!.body));
    expect(plan.baseline['snippets/mine.liquid']).toBeUndefined();
  });
});

describe('updating a theme to the bundled version (PGlite in memory)', () => {
  let h: DbHandle;
  let storage: Storage;
  let shopId: number;
  let oldDir: string;
  beforeAll(async () => {
    h = await createDb({ memory: true });
    await runMigrations(h);
    storage = createLocalStorage(mkdtempSync(path.join(tmpdir(), 'shopme-theme-update-')));
    ({ shop: { id: shopId } } = await setupStore(h.db, { shopName: 'T', email: 'a@b.com', password: 'password123', currency: 'eur', country: 'fr', locale: 'en' }));
    // "Aurora 1.1.0": the current package with an older version number, a section, a block and a setting that the new version dropped, and an older string.
    oldDir = mkdtempSync(path.join(tmpdir(), 'shopme-aurora-old-'));
    cpSync(themeDir, oldDir, { recursive: true, filter: (src) => !/[\\/](node_modules|src)$/.test(src) });
    const schemaPath = path.join(oldDir, 'config', 'settings_schema.json');
    const schemaJson = JSON.parse(readFileSync(schemaPath, 'utf8')) as { name: string; theme_version?: string; settings?: unknown[] }[];
    schemaJson[0]!.theme_version = '1.1.0';
    schemaJson[1]!.settings!.push({ type: 'checkbox', id: 'legacy_toggle', label: 'Legacy', default: false });
    writeFileSync(schemaPath, JSON.stringify(schemaJson, null, 2));
    writeFileSync(path.join(oldDir, 'sections', 'legacy-banner.liquid'), '<div>{{ section.settings.text }}</div>\n{% schema %}\n{ "name": "Legacy banner", "settings": [{ "type": "text", "id": "text", "label": "Text" }] }\n{% endschema %}\n');
    writeFileSync(path.join(oldDir, 'blocks', 'legacy-badge.liquid'), '<span>badge</span>\n{% schema %}\n{ "name": "Badge" }\n{% endschema %}\n');
    const loc = JSON.parse(readFileSync(path.join(oldDir, 'locales', 'en.default.json'), 'utf8')) as { products: Record<string, string> };
    loc.products.sold_out = 'Out of stock';
    writeFileSync(path.join(oldDir, 'locales', 'en.default.json'), JSON.stringify(loc, null, 2));
  }, 60_000);
  afterAll(async () => { await h.close(); });

  const filesOf = (themeId: number) => h.db.select().from(schema.themeFiles).where(eq(schema.themeFiles.themeId, themeId)).orderBy(asc(schema.themeFiles.path));
  const text = async (themeId: number, p: string) => (await h.db.select({ body: schema.themeFiles.body }).from(schema.themeFiles).where(and(eq(schema.themeFiles.themeId, themeId), eq(schema.themeFiles.path, p))))[0]?.body;

  it('records the bundled theme and the checksum of each file at install', async () => {
    expect(await ensureDefaultTheme(h.db, shopId, oldDir, storage)).toBe(true);
    const [main] = await h.db.select().from(schema.themes).where(and(eq(schema.themes.shopId, shopId), eq(schema.themes.role, 'MAIN')));
    expect(main).toMatchObject({ name: 'Aurora', originTheme: 'aurora', originVersion: '1.1.0' });
    const files = await filesOf(main!.id);
    expect(Object.keys(main!.originChecksums!).sort()).toEqual(files.map((f) => f.path).sort());
    expect(main!.originChecksums!['layout/theme.liquid']).toBe(files.find((f) => f.path === 'layout/theme.liquid')!.checksum);
    expect(themeUpdateStatus(main!, readBundledTheme(themeDir))!.updateAvailable).toBe(true);
  });

  it('creates an unpublished copy at the new version with the customizations carried over, and leaves the original untouched', async () => {
    const [main] = await h.db.select().from(schema.themes).where(and(eq(schema.themes.shopId, shopId), eq(schema.themes.role, 'MAIN')));
    const id = main!.id;
    // The merchant's customizations.
    const data = JSON.parse((await text(id, 'config/settings_data.json'))!) as { current: Record<string, unknown> };
    data.current.color_primary = '#7c2d12';
    data.current.legacy_toggle = true;
    const index = JSON.parse((await text(id, 'templates/index.json'))!) as { sections: Record<string, Record<string, unknown>>; order: string[] };
    (index.sections.featured!.settings as Record<string, unknown>).heading = 'Nos bougies';
    index.sections.legacy = { type: 'legacy-banner', settings: { text: 'Old' } };
    index.sections.story_text = { type: 'rich-text', settings: {}, blocks: { h: { type: 'heading', settings: { heading: 'Hello' } }, b: { type: 'legacy-badge', settings: {} } }, block_order: ['h', 'b'] };
    index.order.push('legacy', 'story_text');
    const header = JSON.parse((await text(id, 'sections/header-group.json'))!) as { sections: Record<string, { settings: Record<string, unknown> }> };
    header.sections.announcement!.settings.text = 'Livraison offerte';
    const locale = JSON.parse((await text(id, 'locales/en.default.json'))!) as { products: Record<string, string> };
    locale.products.add_to_cart = 'Add to basket';
    const card = await text(id, 'snippets/product-card.liquid');
    const r1 = await upsertThemeFiles(h.db, shopId, id, [
      { filename: 'config/settings_data.json', body: pretty(data) },
      { filename: 'templates/index.json', body: pretty(index) },
      { filename: 'sections/header-group.json', body: pretty(header) },
      { filename: 'locales/en.default.json', body: pretty(locale) },
      { filename: 'snippets/product-card.liquid', body: `${card}\n<!-- my change -->` },
      { filename: 'sections/legacy-banner.liquid', body: `${await text(id, 'sections/legacy-banner.liquid')}<!-- mine -->` },
      { filename: 'snippets/my-note.liquid', body: '<p>Handmade in Lyon</p>' },
    ]);
    expect(r1.ok).toBe(true);
    await storage.put('uploads/logo-mine.png', Buffer.from('png'));
    await h.db.insert(schema.themeFiles).values({ themeId: id, shopId, path: 'assets/logo-mine.png', contentType: 'image/png', body: null, storageKey: 'uploads/logo-mine.png', checksum: md5('png'), sizeBytes: 3 });
    await h.db.insert(schema.translations).values({ shopId, resourceType: 'ONLINE_STORE_THEME', resourceId: String(id), key: 'products.add_to_cart', locale: 'de', value: 'In den Warenkorb', digest: 'x' });
    const before = (await filesOf(id)).map((f) => [f.path, f.checksum, f.storageKey]);

    const r = await updateThemeToBundled(h.db, storage, shopId, id, themeDir);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const v = r.value;
    const bundled = readBundledTheme(themeDir)!;
    expect(v.theme).toMatchObject({ name: `Aurora ${bundled.version}`, role: 'UNPUBLISHED', processing: false, originTheme: 'aurora', originVersion: bundled.version });
    expect(v.fromVersion).toBe('1.1.0');

    // theme settings: kept, without the setting the new version dropped
    const nd = JSON.parse((await text(v.theme.id, 'config/settings_data.json'))!) as { current: Record<string, unknown> };
    expect(nd.current.color_primary).toBe('#7c2d12');
    expect(nd.current.legacy_toggle).toBeUndefined();
    expect(v.removedSettings).toEqual(['legacy_toggle']);
    // templates and section groups: kept, without the removed section and block types
    const ni = JSON.parse((await text(v.theme.id, 'templates/index.json'))!) as typeof index;
    expect((ni.sections.featured!.settings as Record<string, unknown>).heading).toBe('Nos bougies');
    expect(ni.sections.legacy).toBeUndefined();
    expect(ni.order).not.toContain('legacy');
    expect(Object.keys(ni.sections.story_text!.blocks as object)).toEqual(['h']);
    expect(v.removedReferences).toEqual([
      { filename: 'templates/index.json', kind: 'SECTION', id: 'legacy', type: 'legacy-banner' },
      { filename: 'templates/index.json', kind: 'BLOCK', id: 'story_text/b', type: 'legacy-badge' },
    ]);
    expect((await text(v.theme.id, 'sections/header-group.json'))).toContain('Livraison offerte');
    // locale edits over the new strings: the merchant's string, and the new version's string they did not touch
    const nl = JSON.parse((await text(v.theme.id, 'locales/en.default.json'))!) as typeof locale;
    expect(nl.products.add_to_cart).toBe('Add to basket');
    expect(nl.products.sold_out).toBe('Sold out');
    // code edits are reported and the new version's file is used
    expect(v.skipped).toEqual([{ filename: 'sections/legacy-banner.liquid', reason: 'REMOVED_IN_NEW_VERSION' }, { filename: 'snippets/product-card.liquid', reason: 'EDITED' }]);
    expect(await text(v.theme.id, 'snippets/product-card.liquid')).toBe(readFileSync(path.join(themeDir, 'snippets', 'product-card.liquid'), 'utf8'));
    expect(await text(v.theme.id, 'sections/legacy-banner.liquid')).toBeUndefined();
    // the merchant's own files and uploads
    expect(await text(v.theme.id, 'snippets/my-note.liquid')).toBe('<p>Handmade in Lyon</p>');
    const files = await filesOf(v.theme.id);
    expect(files.find((f) => f.path === 'assets/logo-mine.png')).toMatchObject({ storageKey: 'uploads/logo-mine.png', body: null });
    expect(files.find((f) => f.path === 'assets/font-inter.woff2')!.storageKey).toBeTruthy();
    expect(v.carriedOver).toEqual(expect.arrayContaining(['config/settings_data.json', 'templates/index.json', 'sections/header-group.json', 'locales/en.default.json', 'snippets/my-note.liquid', 'assets/logo-mine.png']));
    // untouched files are the new version's, and the new version's files are the baseline of later edits
    const bundledFiles = readThemeDir(themeDir);
    for (const p of ['templates/customers/account.json', 'sections/main-account.liquid', 'config/settings_schema.json']) expect(await text(v.theme.id, p)).toBe(bundledFiles.find((f) => f.path === p)!.body);
    expect(v.theme.originChecksums!['snippets/product-card.liquid']).toBe(files.find((f) => f.path === 'snippets/product-card.liquid')!.checksum);
    expect(v.theme.originChecksums!['snippets/my-note.liquid']).toBeUndefined();
    // translations of the theme follow the copy
    const tr = await h.db.select().from(schema.translations).where(eq(schema.translations.resourceId, String(v.theme.id)));
    expect(tr.map((x) => [x.key, x.value])).toEqual([['products.add_to_cart', 'In den Warenkorb']]);

    // the original theme is untouched and still live
    expect((await filesOf(id)).map((f) => [f.path, f.checksum, f.storageKey])).toEqual(before);
    const [still] = await h.db.select().from(schema.themes).where(eq(schema.themes.id, id));
    expect(still).toMatchObject({ role: 'MAIN', originVersion: '1.1.0', name: 'Aurora' });

    // the copy is up to date
    const again = await updateThemeToBundled(h.db, storage, shopId, v.theme.id, themeDir);
    expect(again.ok ? null : again.errors[0]!.code).toBe('UP_TO_DATE');
  }, 60_000);

  it('compares themes installed before checksums were recorded with the checksums the theme has shipped', async () => {
    // "1.3.0" whose list of shipped checksums covers the installed files.
    const newDir = mkdtempSync(path.join(tmpdir(), 'shopme-aurora-new-'));
    cpSync(themeDir, newDir, { recursive: true, filter: (src) => !/[\\/](node_modules|src)$/.test(src) });
    const schemaPath = path.join(newDir, 'config', 'settings_schema.json');
    writeFileSync(schemaPath, readFileSync(schemaPath, 'utf8').replace(/"theme_version": "[^"]+"/, '"theme_version": "1.3.0"'));
    const [legacy] = await h.db.insert(schema.themes).values({ shopId, name: 'Old Aurora', role: 'UNPUBLISHED' }).returning();
    const rows = readThemeDir(themeDir).map((f) => ({ themeId: legacy!.id, shopId, path: f.path, contentType: f.contentType, body: f.body, checksum: md5(f.body), sizeBytes: Buffer.byteLength(f.body) }));
    await h.db.insert(schema.themeFiles).values(rows);
    writeFileSync(path.join(newDir, 'checksums.json'), JSON.stringify({ files: Object.fromEntries(rows.map((f) => [f.path, ['0'.repeat(32), f.checksum]])) }));
    // Like migration 0025 for existing themes: recognised as Aurora from its settings schema, without checksums.
    expect(await detectThemeOrigins(h.db, shopId)).toBe(1);
    const [marked] = await h.db.select().from(schema.themes).where(eq(schema.themes.id, legacy!.id));
    expect(marked).toMatchObject({ originTheme: 'aurora', originVersion: readBundledTheme(themeDir)!.version, originChecksums: null });
    await h.db.update(schema.themeFiles).set({ body: 'edited', checksum: md5('edited') }).where(and(eq(schema.themeFiles.themeId, legacy!.id), eq(schema.themeFiles.path, 'snippets/price.liquid')));

    const r = await updateThemeToBundled(h.db, storage, shopId, legacy!.id, newDir);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.value.skipped).toEqual([{ filename: 'snippets/price.liquid', reason: 'EDITED' }]);
    expect(r.value.carriedOver).toEqual([]);
    expect(r.value.theme.name).toBe('Aurora 1.3.0');
  }, 60_000);

  it('refuses themes that do not come from the bundled theme', async () => {
    const [uploaded] = await h.db.insert(schema.themes).values({ shopId, name: 'Imported', role: 'UNPUBLISHED' }).returning();
    const r = await updateThemeToBundled(h.db, storage, shopId, uploaded!.id, themeDir);
    expect(r.ok ? null : r.errors[0]!.code).toBe('NOT_BUNDLED_THEME');
    const missing = await updateThemeToBundled(h.db, storage, shopId, 999_999, themeDir);
    expect(missing.ok ? null : missing.errors[0]!.code).toBe('NOT_FOUND');
    const nowhere = await updateThemeToBundled(h.db, storage, shopId, uploaded!.id, path.join(tmpdir(), 'no-such-theme'));
    expect(nowhere.ok ? null : nowhere.errors[0]!.code).toBe('BUNDLE_UNAVAILABLE');
  });

  it('marks existing Aurora themes in migration 0025', async () => {
    const [t] = await h.db.insert(schema.themes).values({ shopId, name: 'Before', role: 'UNPUBLISHED' }).returning();
    const settingsSchema = readFileSync(path.join(oldDir, 'config', 'settings_schema.json'), 'utf8');
    await h.db.insert(schema.themeFiles).values([
      { themeId: t!.id, shopId, path: 'config/settings_schema.json', contentType: 'application/json', body: settingsSchema, checksum: md5(settingsSchema), sizeBytes: settingsSchema.length },
      { themeId: t!.id, shopId, path: 'assets/aurora.css', contentType: 'text/css', body: 'body{}', checksum: md5('body{}'), sizeBytes: 6 },
    ]);
    const [other] = await h.db.insert(schema.themes).values({ shopId, name: 'Other', role: 'UNPUBLISHED' }).returning();
    await h.db.insert(schema.themeFiles).values({ themeId: other!.id, shopId, path: 'config/settings_schema.json', contentType: 'application/json', body: '[{"name":"theme_info","theme_name":"Harbor","theme_version":"2.0.0"}]', checksum: 'x', sizeBytes: 1 });
    const migration = readFileSync(fileURLToPath(new URL('../drizzle/0025_theme_origin.sql', import.meta.url)), 'utf8');
    const backfill = migration.split('--> statement-breakpoint').map((s) => s.trim()).find((s) => s.startsWith('UPDATE'))!;
    await h.db.execute(sql.raw(backfill));
    const [a] = await h.db.select().from(schema.themes).where(eq(schema.themes.id, t!.id));
    const [b] = await h.db.select().from(schema.themes).where(eq(schema.themes.id, other!.id));
    expect(a).toMatchObject({ originTheme: 'aurora', originVersion: '1.1.0', originChecksums: null });
    expect(b!.originTheme).toBeNull();
  });
});
