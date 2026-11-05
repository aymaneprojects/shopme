import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseId } from '@shopme/shopify-compat';
import { schema } from '@shopme/core';
import { createTestApp, setupAndLogin, type TestApp } from './test-utils';

const themeDir = fileURLToPath(new URL('../../../packages/theme-default', import.meta.url));
const bundledVersion = (JSON.parse(readFileSync(path.join(themeDir, 'config', 'settings_schema.json'), 'utf8')) as { theme_version?: string }[])[0]!.theme_version!;

describe('updates of the bundled theme (Admin GraphQL)', () => {
  let t: TestApp;
  let cookie: string;
  let mainGid: string;
  const g = async (query: string, variables?: Record<string, unknown>) => {
    const r = await t.app.inject({ method: 'POST', url: '/admin/api/2026-10/graphql.json', cookies: { shopme_session: cookie }, payload: { query, variables } });
    const j = r.json();
    if (j.errors) throw new Error(JSON.stringify(j.errors));
    return j.data;
  };
  const STATUS = '{ name installedVersion bundledVersion updateAvailable }';
  const UPDATE = `mutation($id: ID!) { shopmeThemeUpdateToBundled(id: $id) {
    theme { id name role shopmeBundledTheme ${STATUS} } previousVersion version carriedOverFiles
    skippedFiles { filename reason } removedReferences { filename kind id type } removedSettings userErrors { field message code } } }`;
  const fileBody = async (gid: string, filename: string) => (await g(`query($id: ID!, $f: [String!]) { theme(id: $id) { files(filenames: $f) { nodes { body { ... on OnlineStoreThemeFileBodyText { content } } } } } }`, { id: gid, f: [filename] })).theme.files.nodes[0]?.body.content;

  beforeAll(async () => {
    t = await createTestApp();
    cookie = await setupAndLogin(t.app);
    mainGid = (await g('{ themes(first: 5, roles: [MAIN]) { nodes { id } } }')).themes.nodes[0].id;
  }, 60_000);
  afterAll(async () => { await t.close(); });

  it('knows the theme set up with the store is the current Aurora', async () => {
    const r = await g(`query($id: ID!) { theme(id: $id) { shopmeBundledTheme ${STATUS} } }`, { id: mainGid });
    expect(r.theme.shopmeBundledTheme).toEqual({ name: 'Aurora', installedVersion: bundledVersion, bundledVersion, updateAvailable: false });
  });

  it('offers the update with release notes when the installed version is older', async () => {
    await t.dbHandle.db.update(schema.themes).set({ originVersion: '1.1.0' }).where(eq(schema.themes.id, parseId(mainGid, 'OnlineStoreTheme')!));
    const r = await g(`query($id: ID!) { themes(first: 5) { nodes { id shopmeBundledTheme ${STATUS} } }
      theme(id: $id) { shopmeBundledTheme { releaseNotes(locale: "fr") { version date notes } en: releaseNotes { version notes } } } }`, { id: mainGid });
    expect(r.themes.nodes[0].shopmeBundledTheme).toEqual({ name: 'Aurora', installedVersion: '1.1.0', bundledVersion, updateAvailable: true });
    const fr = r.theme.shopmeBundledTheme.releaseNotes;
    expect(fr[0].version).toBe(bundledVersion);
    expect(fr.map((v: { version: string }) => v.version)).not.toContain('1.1.0');
    expect(fr.find((v: { version: string }) => v.version === '1.2.0').notes.join(' ')).toContain('point focal');
    expect(r.theme.shopmeBundledTheme.en.find((v: { version: string }) => v.version === '1.2.0').notes.join(' ')).toContain('focal point');
  });

  it('creates an unpublished copy, carries the settings over and lists the edited files; the live theme is untouched', async () => {
    const data = JSON.parse(await fileBody(mainGid, 'config/settings_data.json')) as { current: Record<string, unknown> };
    data.current.color_primary = '#7c2d12';
    data.current.no_longer_a_setting = 1;
    const card = `${await fileBody(mainGid, 'snippets/product-card.liquid')}\n<!-- my change -->`;
    const up = await g(`mutation($id: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) { themeFilesUpsert(themeId: $id, files: $files) { userErrors { message } } }`, {
      id: mainGid, files: [
        { filename: 'config/settings_data.json', body: { type: 'TEXT', value: JSON.stringify(data, null, 2) } },
        { filename: 'snippets/product-card.liquid', body: { type: 'TEXT', value: card } },
      ],
    });
    expect(up.themeFilesUpsert.userErrors).toEqual([]);

    const r = (await g(UPDATE, { id: mainGid })).shopmeThemeUpdateToBundled;
    expect(r.userErrors).toEqual([]);
    expect(r.theme).toMatchObject({ name: `Aurora ${bundledVersion}`, role: 'UNPUBLISHED', shopmeBundledTheme: { installedVersion: bundledVersion, updateAvailable: false } });
    expect(r.previousVersion).toBe('1.1.0');
    expect(r.version).toBe(bundledVersion);
    expect(r.carriedOverFiles).toEqual(['config/settings_data.json']);
    expect(r.skippedFiles).toEqual([{ filename: 'snippets/product-card.liquid', reason: 'EDITED' }]);
    expect(r.removedSettings).toEqual(['no_longer_a_setting']);
    expect(r.removedReferences).toEqual([]);
    expect(JSON.parse(await fileBody(r.theme.id, 'config/settings_data.json')).current.color_primary).toBe('#7c2d12');
    expect(await fileBody(r.theme.id, 'snippets/product-card.liquid')).toBe(readFileSync(path.join(themeDir, 'snippets', 'product-card.liquid'), 'utf8'));

    // the live theme keeps its edits, its role and its version
    expect(await fileBody(mainGid, 'snippets/product-card.liquid')).toBe(card);
    const live = await g(`query($id: ID!) { theme(id: $id) { role shopmeBundledTheme { installedVersion updateAvailable } } }`, { id: mainGid });
    expect(live.theme).toEqual({ role: 'MAIN', shopmeBundledTheme: { installedVersion: '1.1.0', updateAvailable: true } });
    // the storefront still renders the live theme
    expect((await t.app.inject({ method: 'GET', url: '/' })).statusCode).toBe(200);

    // nothing more to update on the copy; unknown and uploaded themes are refused
    expect((await g(UPDATE, { id: r.theme.id })).shopmeThemeUpdateToBundled.userErrors[0]).toMatchObject({ code: 'UP_TO_DATE', field: ['id'] });
    expect((await g(UPDATE, { id: 'gid://shopify/OnlineStoreTheme/999999' })).shopmeThemeUpdateToBundled).toMatchObject({ theme: null, userErrors: [{ code: 'NOT_FOUND' }] });
    const [imported] = await t.dbHandle.db.insert(schema.themes).values({ shopId: 1, name: 'Imported', role: 'UNPUBLISHED' }).returning();
    expect((await g(UPDATE, { id: `gid://shopify/OnlineStoreTheme/${imported!.id}` })).shopmeThemeUpdateToBundled.userErrors[0].code).toBe('NOT_BUNDLED_THEME');
    expect((await g(`query($id: ID!) { theme(id: $id) { shopmeBundledTheme { name } } }`, { id: `gid://shopify/OnlineStoreTheme/${imported!.id}` })).theme.shopmeBundledTheme).toBeNull();
  }, 60_000);
});
