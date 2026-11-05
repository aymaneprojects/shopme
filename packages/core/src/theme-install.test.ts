import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, createLocalStorage, deleteThemeFiles, listThemeFileVersions, runMigrations, schema, setupStore, upsertThemeFiles, getThemeFileVersion, type DbHandle } from './index';
import { ensureDefaultTheme, frenchSeedDefaults, localizeSeedTexts, readThemeBinaries, readThemeDir } from './services/theme-install';

const themeDir = fileURLToPath(new URL('../../theme-default', import.meta.url));

describe('French seed texts of the default theme', () => {
  it('translates the announcement, section headings and schema defaults', () => {
    const fr = frenchSeedDefaults(themeDir);
    expect(Object.keys(fr).length).toBeGreaterThan(5);
    const out = localizeSeedTexts(readThemeDir(themeDir), fr);
    const body = (p: string) => out.find((f) => f.path === p)!.body;
    expect(body('sections/header-group.json')).toContain('"text": "Livraison offerte dès 50 €"');
    expect(body('templates/index.json')).toContain('"heading": "Produits phares"');
    expect(body('sections/hero.liquid')).toContain('"default": "Découvrez les nouveautés"');
    expect(body('blocks/button.liquid')).toContain('"default": "Acheter maintenant"');
    // nothing English that the map covers is left in the files that carry seed text
    for (const f of out.filter((x) => !x.path.startsWith('locales/'))) for (const en of Object.keys(fr)) expect(f.body.includes(JSON.stringify(en)), `${f.path}: ${en}`).toBe(false);
    expect(body('locales/fr.json')).toContain('"Shop now": "Acheter maintenant"');
  });

  it('leaves files alone when there is no French map', () => {
    const files = readThemeDir(themeDir);
    expect(localizeSeedTexts(files, {})).toEqual(files);
  });
});

describe('theme binaries and file history (PGlite in memory)', () => {
  let h: DbHandle;
  beforeAll(async () => { h = await createDb({ memory: true }); await runMigrations(h); }, 60_000);
  afterAll(async () => { await h.close(); });

  it('reads the fonts of the default theme as binary assets', () => {
    const names = readThemeBinaries(themeDir).map((b) => b.path);
    expect(names).toContain('assets/font-inter.woff2');
    expect(names.every((n) => n.startsWith('assets/'))).toBe(true);
  });

  it('installs the default theme with its fonts in object storage, and keeps versions of a file', async () => {
    const { shop } = await setupStore(h.db, { shopName: 'T', email: 'a@b.com', password: 'password123', currency: 'eur', country: 'fr', locale: 'en' });
    const storage = createLocalStorage(mkdtempSync(path.join(tmpdir(), 'shopme-theme-')));
    expect(await ensureDefaultTheme(h.db, shop.id, themeDir, storage)).toBe(true);
    const [main] = await h.db.select().from(schema.themes).where(eq(schema.themes.role, 'MAIN'));
    const [font] = await h.db.select().from(schema.themeFiles).where(and(eq(schema.themeFiles.themeId, main!.id), eq(schema.themeFiles.path, 'assets/font-inter.woff2')));
    expect(font).toMatchObject({ contentType: 'font/woff2', body: null });
    expect(font!.storageKey).toBeTruthy();

    // each change keeps the text it replaces; saving the same text again keeps nothing
    await upsertThemeFiles(h.db, shop.id, main!.id, [{ filename: 'snippets/note.liquid', body: 'one' }]);
    await upsertThemeFiles(h.db, shop.id, main!.id, [{ filename: 'snippets/note.liquid', body: 'two' }]);
    await upsertThemeFiles(h.db, shop.id, main!.id, [{ filename: 'snippets/note.liquid', body: 'two' }]);
    await upsertThemeFiles(h.db, shop.id, main!.id, [{ filename: 'snippets/note.liquid', body: 'three' }]);
    const versions = await listThemeFileVersions(h.db, shop.id, main!.id, 'snippets/note.liquid');
    expect(versions).toHaveLength(2);
    expect((await getThemeFileVersion(h.db, shop.id, versions[0]!.id))!.body).toBe('two');
    expect(versions[0]!.body).toBeUndefined();

    // only the 30 most recent versions are kept, and a deleted text file leaves its last text
    for (let i = 0; i < 35; i++) await upsertThemeFiles(h.db, shop.id, main!.id, [{ filename: 'snippets/many.liquid', body: `v${i}` }]);
    expect(await listThemeFileVersions(h.db, shop.id, main!.id, 'snippets/many.liquid')).toHaveLength(30);
    await deleteThemeFiles(h.db, storage, shop.id, main!.id, ['snippets/note.liquid']);
    const after = await listThemeFileVersions(h.db, shop.id, main!.id, 'snippets/note.liquid');
    expect((await getThemeFileVersion(h.db, shop.id, after[0]!.id))!.body).toBe('three');
  }, 60_000);
});
