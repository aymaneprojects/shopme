import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { frenchSeedDefaults, localizeSeedTexts, readThemeDir } from './services/theme-install';

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
