import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readThemeDir, THEME_DIRS } from '@shopme/core';
import { describe, expect, it } from 'vitest';

/**
 * The theme kit (scripts/theme-kit): the committed themes are exactly what it generates, it is deterministic, it refuses
 * options it cannot honor, and the demo catalogue of each theme stays out of the installed files.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../../..');
const kit = (await import(pathToFileURL(path.join(ROOT, 'scripts/theme-kit/build.mjs')).href)) as {
  compose: (o: unknown) => Promise<Map<string, string | Buffer>>;
  loadOptions: (handle: string) => Promise<Record<string, any>>;
  listThemes: () => string[];
  diffTheme: (handle: string) => Promise<string[]>;
  validate: (o: unknown) => unknown;
};
const HANDLES = kit.listThemes();
const themeDir = (handle: string) => path.join(ROOT, 'packages/themes', handle);

describe('theme kit', () => {
  it('lists the themes built with it', () => {
    expect(HANDLES).toEqual(['foyer', 'maroquin', 'serre', 'sillage', 'sommet', 'vitrine']);
  });

  it.each(HANDLES)('%s: the committed folder is what the kit generates (run node scripts/theme-kit/build.mjs)', async (handle) => {
    expect(await kit.diffTheme(handle)).toEqual([]);
  });

  it.each(HANDLES)('%s: generating twice gives the same bytes', async (handle) => {
    const options = await kit.loadOptions(handle);
    const a = await kit.compose(options);
    const b = await kit.compose(options);
    expect([...a.keys()]).toEqual([...b.keys()]);
    for (const [file, body] of a) expect(Buffer.from(body).equals(Buffer.from(b.get(file)!)), file).toBe(true);
  });

  it('gives the three themes different headers, cards, product pages and home pages', async () => {
    const all = await Promise.all(HANDLES.map((h) => kit.loadOptions(h)));
    // there are only three headers and three product pages: what must differ is the combination of header, card, product page and collection layout
    expect(new Set(all.map((o) => [o.header.layout, o.card.style, o.product.layout, o.collection.layout].join('/'))).size).toBe(all.length);
    expect(new Set(all.map((o) => JSON.stringify(o.home.map((s: { type: string }) => s.type)))).size).toBe(all.length);
    expect(new Set(all.map((o) => o.colors.accent)).size).toBe(all.length);
    expect(new Set(all.map((o) => o.fonts.heading + o.fonts.body)).size).toBe(all.length);
  });

  it('refuses options it cannot honor', async () => {
    const base = await kit.loadOptions('sillage');
    expect(() => kit.validate({ ...base, header: { layout: 'wide' } })).toThrow(/header\.layout/);
    expect(() => kit.validate({ ...base, fonts: { ...base.fonts, heading: 'comic-sans' } })).toThrow(/fonts\.heading/);
    expect(() => kit.validate({ ...base, sections: ['no-such-section'] })).toThrow(/unknown extra section/);
    expect(() => kit.validate({ ...base, handle: 'Not A Handle' })).toThrow(/handle/);
    const clash = { ...base, home: [{ id: 'hero', type: 'hero', settings: { heading: { en: 'Join the list of everyone', fr: 'Rejoignez la liste de tous' }, text: { en: 'Free returns within 30 days of delivery', fr: 'Retours gratuits sous 30 jours' } } }] };
    await expect(kit.compose(clash)).rejects.toThrow(/reword it/);
  });

  it.each(HANDLES)('%s: ships at least two sections of its own trade and the kit features', async (handle) => {
    const options = await kit.loadOptions(handle);
    expect(options.sections.length).toBeGreaterThanOrEqual(2);
    const files = readThemeDir(themeDir(handle)).map((f) => f.path);
    for (const id of options.sections) expect(files).toContain(`sections/${id}.liquid`);
    for (const file of ['sections/countdown.liquid', 'snippets/age-gate.liquid', 'snippets/back-to-top.liquid', 'snippets/breadcrumbs.liquid', 'snippets/swatch-style.liquid', 'snippets/product-gallery.liquid']) expect(files, file).toContain(file);
    const schema = JSON.parse(readFileSync(path.join(themeDir(handle), 'config/settings_schema.json'), 'utf8')) as Array<Record<string, any>>;
    expect(schema[0]).toMatchObject({ theme_name: options.name, shopme_catalog_size: options.info.catalogSize });
    expect(schema[0]!.shopme_industries.length).toBeGreaterThan(0);
    expect(schema[0]!.shopme_features).toEqual(expect.arrayContaining(['infinite-scroll', 'age-verification', 'countdown-timer', 'back-to-top', 'breadcrumbs', 'stock-counter', 'colour-swatches', 'sticky-header']));
    const ids = schema.flatMap((g) => (g.settings ?? []).map((s: { id?: string }) => s.id));
    for (const id of ['age_gate_enabled', 'show_back_to_top', 'show_breadcrumbs', 'stock_counter']) expect(ids).toContain(id);
  });

  it.each(HANDLES)('%s: its demo catalogue and photos are complete, lean and never installed', (handle) => {
    const demo = path.join(themeDir(handle), 'demo');
    const catalog = JSON.parse(readFileSync(path.join(demo, 'catalog.json'), 'utf8'));
    expect(catalog.storeName.length).toBeGreaterThan(2);
    expect(catalog.products.length).toBe(6);
    expect(catalog.collections.length).toBeGreaterThan(1);
    expect(catalog.menu.length).toBeGreaterThan(2);
    for (const p of catalog.products) {
      for (const text of [p.title, p.description]) { expect(typeof text.en).toBe('string'); expect(typeof text.fr).toBe('string'); expect(text.fr).not.toBe(text.en); }
      expect(p.price).toBeGreaterThan(0);
      expect(existsSync(path.join(demo, 'images', p.image)), p.image).toBe(true);
    }
    expect(Object.keys(catalog.homepage.en).length).toBeGreaterThan(3);
    expect(Object.keys(catalog.homepage.fr)).toEqual(Object.keys(catalog.homepage.en));
    const images = readdirSync(path.join(demo, 'images'));
    expect(images.sort()).toEqual(['ambiance.webp', 'hero.webp', ...[1, 2, 3, 4, 5, 6].map((n) => `produit-0${n}.webp`)].sort());
    for (const f of images) expect(statSync(path.join(demo, 'images', f)).size, f).toBeLessThanOrEqual(165 * 1024);
    expect(readFileSync(path.join(demo, 'README.md'), 'utf8')).toMatch(/provided by the ShopMe project and are free to use \(CC0\)/);
    // the installer reads only the theme folders
    expect((THEME_DIRS as readonly string[]).includes('demo')).toBe(false);
    expect(readThemeDir(themeDir(handle)).some((f) => f.path.startsWith('demo/'))).toBe(false);
  });
});
