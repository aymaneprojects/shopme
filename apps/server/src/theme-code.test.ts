import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lintThemeFile } from './theme-lint';
import { createTestApp, setupAndLogin, type TestApp } from './test-utils';

describe('theme file syntax check', () => {
  it('accepts valid Liquid and JSON and the sections shipped with the theme', () => {
    expect(lintThemeFile('snippets/a.liquid', '{% if x %}<p>{{ x | escape }}</p>{% endif %}')).toEqual([]);
    expect(lintThemeFile('config/a.json', '/* banner */ { "a": 1 }')).toEqual([]);
    expect(lintThemeFile('assets/a.css', 'body {')).toEqual([]);
  });

  it('reports the position of a Liquid syntax error', () => {
    const d = lintThemeFile('snippets/a.liquid', '<p>ok</p>\n{% if x %}\n<p>unclosed</p>');
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ filename: 'snippets/a.liquid', severity: 'error' });
    expect(d[0]!.line).toBeGreaterThanOrEqual(2);
  });

  it('warns, without blocking, about a tag the engine does not know', () => {
    const d = lintThemeFile('snippets/a.liquid', '{% frobnicate x %}');
    expect(d.map((x) => x.severity)).toEqual(['warning']);
  });

  it('reports invalid JSON and an invalid section schema with their line', () => {
    expect(lintThemeFile('config/a.json', '{\n  "a": 1,\n}')[0]).toMatchObject({ severity: 'error', line: 3 });
    const s = lintThemeFile('sections/x.liquid', '<p>x</p>\n{% schema %}\n{ "name": }\n{% endschema %}');
    expect(s[0]).toMatchObject({ severity: 'error', line: 3 });
    expect(s[0]!.message).toContain('{% schema %}');
  });
});

describe('theme code editor API', () => {
  let t: TestApp;
  let cookie: string;
  let themeGid: string;
  const g = async (query: string) => {
    const r = await t.app.inject({ method: 'POST', url: '/admin/api/2026-10/graphql.json', cookies: { shopme_session: cookie }, payload: { query } });
    const j = r.json();
    if (j.errors) throw new Error(JSON.stringify(j.errors));
    return j.data;
  };
  const save = (filename: string, value: string) => g(`mutation { themeFilesUpsert(themeId: "${themeGid}", files: [{ filename: ${JSON.stringify(filename)}, body: { type: TEXT, value: ${JSON.stringify(value)} } }]) { upsertedThemeFiles { filename } userErrors { message filename code } } }`);
  beforeAll(async () => {
    t = await createTestApp();
    cookie = await setupAndLogin(t.app);
    themeGid = (await g('{ themes(first: 5, roles: [MAIN]) { nodes { id } } }')).themes.nodes[0].id;
  }, 60_000);
  afterAll(async () => { await t.close(); });

  it('lints files without saving them', async () => {
    const r = await g(`{ themeFilesLint(files: [{ filename: "snippets/x.liquid", body: "{% if a %}" }, { filename: "snippets/y.liquid", body: "fine" }]) { filename line column severity message } }`);
    expect(r.themeFilesLint).toHaveLength(1);
    expect(r.themeFilesLint[0]).toMatchObject({ filename: 'snippets/x.liquid', severity: 'ERROR' });
  });

  it('refuses to save Liquid with a syntax error and names the file', async () => {
    const r = await save('snippets/broken.liquid', '<p>\n{% if a %}\n</p>');
    expect(r.themeFilesUpsert.upsertedThemeFiles).toBeNull();
    expect(r.themeFilesUpsert.userErrors[0]).toMatchObject({ filename: 'snippets/broken.liquid', code: 'INVALID' });
    expect(r.themeFilesUpsert.userErrors[0].message).toContain('line');
  });

  it('keeps earlier versions of a file, lists them and brings one back', async () => {
    await save('snippets/hist.liquid', 'one');
    await save('snippets/hist.liquid', 'two');
    await save('snippets/hist.liquid', 'two');
    await save('snippets/hist.liquid', 'three');
    const list = (await g(`{ themeFileVersions(themeId: "${themeGid}", filename: "snippets/hist.liquid") { id filename size createdAt } }`)).themeFileVersions;
    expect(list).toHaveLength(2); // "one" and "two"; the current text is not a version, and saving the same text twice adds nothing
    const bodies = await Promise.all(list.map(async (v: { id: string }) => (await g(`{ themeFileVersion(id: "${v.id}") { body } }`)).themeFileVersion.body));
    expect(bodies).toEqual(['two', 'one']);
    await save('snippets/hist.liquid', bodies[1]);
    const now = (await g(`{ theme(id: "${themeGid}") { files(filenames: ["snippets/hist.liquid"]) { nodes { body { ... on OnlineStoreThemeFileBodyText { content } } } } } }`)).theme.files.nodes[0].body.content;
    expect(now).toBe('one');
    expect((await g(`{ themeFileVersions(themeId: "${themeGid}", filename: "snippets/hist.liquid") { id } }`)).themeFileVersions).toHaveLength(3);
  });

  it('keeps a deleted file so it can be brought back', async () => {
    await save('snippets/gone.liquid', 'bye');
    await g(`mutation { themeFilesDelete(themeId: "${themeGid}", files: ["snippets/gone.liquid"]) { deletedThemeFiles { filename } } }`);
    expect((await g(`{ themeFilesWithHistory(themeId: "${themeGid}") }`)).themeFilesWithHistory).toContain('snippets/gone.liquid');
    const [v] = (await g(`{ themeFileVersions(themeId: "${themeGid}", filename: "snippets/gone.liquid") { id } }`)).themeFileVersions;
    expect((await g(`{ themeFileVersion(id: "${v.id}") { body } }`)).themeFileVersion.body).toBe('bye');
  });
});
