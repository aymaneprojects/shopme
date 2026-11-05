import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemo } from '@shopme/core';
import { createTestApp, SETUP_BODY, type TestApp } from '../../../src/test-utils';
import { makeGql } from '../helpers';

let t: TestApp;
let gql: ReturnType<typeof makeGql>;
const ok = async (query: string, variables: Record<string, unknown> = {}) => {
  const r = await gql(query, variables);
  expect(r.errors, JSON.stringify(r.errors)).toBeUndefined();
  return r.data;
};
const title = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1];

beforeAll(async () => {
  t = await createTestApp();
  const setup = await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: SETUP_BODY });
  gql = makeGql(t.app, setup.cookies.find((c) => c.name === 'shopme_session')!.value);
  await seedDemo(t.dbHandle.db, t.app.ctx.storage);
}, 90_000);
afterAll(async () => { await t.close(); });

describe('saved views on pages and posts', () => {
  it('stores a view for each of them', async () => {
    const page = (await ok(`mutation { savedSearchCreate(input: { resourceType: PAGE, name: "Hidden pages", query: "published_status:unpublished", params: "tab=unpublished" }) { savedSearch { id name resourceType } userErrors { message } } }`)).savedSearchCreate;
    expect(page.userErrors).toEqual([]);
    expect(page.savedSearch.resourceType).toBe('PAGE');
    await ok(`mutation { savedSearchCreate(input: { resourceType: ARTICLE, name: "Drafts", query: "published_status:unpublished" }) { savedSearch { id } userErrors { message } } }`);
    expect((await ok(`{ pageSavedSearches(first: 10) { nodes { name params } } articleSavedSearches(first: 10) { nodes { name } } productSavedSearches(first: 10) { nodes { name } } }`))).toEqual({
      pageSavedSearches: { nodes: [{ name: 'Hidden pages', params: 'tab=unpublished' }] }, articleSavedSearches: { nodes: [{ name: 'Drafts' }] }, productSavedSearches: { nodes: [] },
    });
  });
});

describe('customer account menu', () => {
  it('exists by default and cannot be deleted', async () => {
    const menus = (await ok(`{ menus(first: 20) { nodes { id handle isDefault items { title url } } } }`)).menus.nodes;
    const m = menus.find((x: { handle: string }) => x.handle === 'customer-account-main-menu');
    expect(m).toMatchObject({ isDefault: true, items: [{ title: 'Orders', url: '/account' }] });
    expect(menus.filter((x: { handle: string }) => x.handle === 'customer-account-main-menu')).toHaveLength(1);
    const del = (await ok(`mutation($id: ID!) { menuDelete(id: $id) { userErrors { message } } }`, { id: m.id })).menuDelete;
    expect(del.userErrors[0].message).toMatch(/Default menus cannot be deleted/);
  });
});

describe('metaobject external id', () => {
  it('sets, updates and enforces uniqueness of the external id', async () => {
    await ok(`mutation { metaobjectDefinitionCreate(definition: { type: "store_logo", name: "Store logo", fieldDefinitions: [{ key: "label", name: "Label", type: "single_line_text_field" }] }) { metaobjectDefinition { id } userErrors { message } } }`);
    const a = (await ok(`mutation { metaobjectCreate(metaobject: { type: "store_logo", shopmeExternalId: "ERP-1", fields: [{ key: "label", value: "A" }] }) { metaobject { id shopmeExternalId } userErrors { message } } }`)).metaobjectCreate;
    expect(a.metaobject.shopmeExternalId).toBe('ERP-1');
    const dup = (await ok(`mutation { metaobjectCreate(metaobject: { type: "store_logo", shopmeExternalId: "ERP-1", fields: [{ key: "label", value: "B" }] }) { metaobject { id } userErrors { message } } }`)).metaobjectCreate;
    expect(dup.metaobject).toBeNull();
    expect(dup.userErrors[0].message).toMatch(/already been taken/);
    const up = (await ok(`mutation($id: ID!) { metaobjectUpdate(id: $id, metaobject: { shopmeExternalId: "ERP-2" }) { metaobject { shopmeExternalId } userErrors { message } } }`, { id: a.metaobject.id })).metaobjectUpdate;
    expect(up.metaobject.shopmeExternalId).toBe('ERP-2');
    const clear = (await ok(`mutation($id: ID!) { metaobjectUpdate(id: $id, metaobject: { shopmeExternalId: "" }) { metaobject { shopmeExternalId } } }`, { id: a.metaobject.id })).metaobjectUpdate;
    expect(clear.metaobject.shopmeExternalId).toBeNull();
  });
});

describe('store preferences', () => {
  it('saves the home page title, the social sharing image and B2B-only access, and the storefront uses them', async () => {
    const r = (await ok(`mutation { shopmeShopUpdate(input: { homepageTitle: "Fresh coffee, roasted weekly", socialSharingImage: "https://cdn.example.com/share.jpg" }) { shop { id } userErrors { message } } }`)).shopmeShopUpdate;
    expect(r.userErrors).toEqual([]);
    const prefs = (await ok(`{ shop { shopmeStorefront { homepageTitle socialSharingImage b2bOnly } } }`)).shop.shopmeStorefront;
    expect(prefs).toEqual({ homepageTitle: 'Fresh coffee, roasted weekly', socialSharingImage: 'https://cdn.example.com/share.jpg', b2bOnly: false });
    const bad = (await ok(`mutation { shopmeShopUpdate(input: { socialSharingImage: "javascript:alert(1)" }) { userErrors { message } } }`)).shopmeShopUpdate;
    expect(bad.userErrors[0].message).toMatch(/must be a URL/);

    const home = await t.app.inject({ url: '/' });
    expect(title(home.body)).toBe('Fresh coffee, roasted weekly');
    expect(home.body).toContain('<meta property="og:image" content="https://cdn.example.com/share.jpg">');
    expect(title((await t.app.inject({ url: '/collections' })).body)).toMatch(/^Collections - /);
  });

  it('keeps the store behind a company login when B2B-only access is on', async () => {
    await ok(`mutation { shopmeShopUpdate(input: { b2bOnly: true }) { userErrors { message } } }`);
    const anon = await t.app.inject({ url: '/collections' });
    expect(anon.statusCode).toBe(302);
    expect(anon.headers.location).toBe('/account/login');
    expect((await t.app.inject({ url: '/account/login' })).statusCode).not.toBe(302);
    await ok(`mutation { shopmeShopUpdate(input: { b2bOnly: false }) { userErrors { message } } }`);
    expect((await t.app.inject({ url: '/collections' })).statusCode).toBe(200);
  });
});
