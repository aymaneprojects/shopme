import { describe, expect, it } from 'vitest';
import { formatBytes, groupFiles, isTextFile, languageOf, newFilePath, renamedPath, starterContent } from './theme-files';

describe('theme file tree', () => {
  const paths = ['templates/index.json', 'layout/theme.liquid', 'sections/hero.liquid', 'sections/footer.liquid', 'assets/aurora.css', 'assets/font-inter.woff2', 'snippets/icon.liquid', 'config/settings_data.json'];

  it('groups files by directory in the order of the theme, files sorted', () => {
    const g = groupFiles(paths);
    expect(g.map((x) => x.dir)).toEqual(['layout', 'templates', 'sections', 'blocks', 'snippets', 'assets', 'config', 'locales']);
    expect(g.find((x) => x.dir === 'sections')!.files).toEqual(['sections/footer.liquid', 'sections/hero.liquid']);
  });

  it('narrows the tree by a search text and drops empty directories', () => {
    expect(groupFiles(paths, 'HERO')).toEqual([{ dir: 'sections', files: ['sections/hero.liquid'] }]);
    expect(groupFiles(paths, 'nope')).toEqual([]);
  });

  it('tells text files from binary assets and picks a language', () => {
    expect(isTextFile('assets/aurora.css')).toBe(true);
    expect(isTextFile('assets/font-inter.woff2')).toBe(false);
    expect([languageOf('a.liquid'), languageOf('a.json'), languageOf('a.css'), languageOf('a.js'), languageOf('a.svg'), languageOf('a.txt')]).toEqual(['liquid', 'json', 'css', 'js', 'html', 'text']);
  });
});

describe('new file names', () => {
  it('adds the usual extension of the directory and refuses clashes', () => {
    expect(newFilePath('sections', 'banner', [])).toEqual({ ok: true, path: 'sections/banner.liquid' });
    expect(newFilePath('templates', 'page.faq', [])).toEqual({ ok: true, path: 'templates/page.faq.json' });
    expect(newFilePath('assets', 'theme.js', [])).toEqual({ ok: true, path: 'assets/theme.js' });
    expect(newFilePath('sections', 'hero', ['sections/hero.liquid'])).toEqual({ ok: false, error: 'exists' });
  });

  it('refuses bad directories, names and types', () => {
    expect(newFilePath('src', 'a', [])).toEqual({ ok: false, error: 'dir' });
    expect(newFilePath('sections', '../x', [])).toEqual({ ok: false, error: 'name' });
    expect(newFilePath('sections', 'a b', [])).toEqual({ ok: false, error: 'name' });
    expect(newFilePath('sections', '', [])).toEqual({ ok: false, error: 'name' });
    expect(newFilePath('assets', 'photo.png', [])).toEqual({ ok: false, error: 'ext' });
  });

  it('renames within the directory and keeps the type', () => {
    expect(renamedPath('snippets/icon.liquid', 'glyph', ['snippets/icon.liquid'])).toEqual({ ok: true, path: 'snippets/glyph.liquid' });
    expect(renamedPath('snippets/icon.liquid', 'icon.json', [])).toEqual({ ok: false, error: 'ext' });
    expect(renamedPath('snippets/icon.liquid', 'price', ['snippets/icon.liquid', 'snippets/price.liquid'])).toEqual({ ok: false, error: 'exists' });
    expect(renamedPath('snippets/icon.liquid', 'icon', ['snippets/icon.liquid'])).toEqual({ ok: true, path: 'snippets/icon.liquid' });
  });
});

describe('starter content', () => {
  it('gives a section a schema with a preset so it can be added from the picker', () => {
    const s = starterContent('sections/my-banner.liquid');
    expect(s).toContain('{% schema %}');
    expect(s).toContain('"presets": [{ "name": "My banner" }]');
    const schema = /\{% schema %\}([\s\S]*?)\{% endschema %\}/.exec(s)![1]!;
    expect(() => JSON.parse(schema)).not.toThrow();
  });

  it('gives valid JSON for JSON files and a block schema for blocks', () => {
    expect(JSON.parse(starterContent('templates/page.faq.json'))).toEqual({ sections: {}, order: [] });
    expect(JSON.parse(starterContent('config/extra.json'))).toEqual({});
    const b = starterContent('blocks/note.liquid');
    expect(JSON.parse(/\{% schema %\}([\s\S]*?)\{% endschema %\}/.exec(b)![1]!).name).toBe('Note');
  });

  it('formats sizes', () => {
    expect([formatBytes(10), formatBytes(2048), formatBytes(3 * 1024 * 1024)]).toEqual(['10 B', '2.0 KB', '3.0 MB']);
  });
});
