import { eq } from 'drizzle-orm';
import { getPrimaryShop, schema as s, seedDemo } from '@shopme/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, SETUP_BODY, type TestApp } from '../../../src/test-utils';
import { makeGql } from '../helpers';

let t: TestApp;
let gql: ReturnType<typeof makeGql>;
let themeGid = '';
const get = (url: string) => t.app.inject({ url });
const g = async (q: string, v: Record<string, unknown> = {}) => {
  const r = await gql(q, v);
  expect(r.errors, JSON.stringify(r.errors)).toBeUndefined();
  return r.data;
};
const put = async (files: Record<string, string>) => {
  const d = await g(`mutation($f: [OnlineStoreThemeFilesUpsertFileInput!]!) { themeFilesUpsert(themeId: "${themeGid}", files: $f) { userErrors { message } } }`,
    { f: Object.entries(files).map(([filename, value]) => ({ filename, body: { type: 'TEXT', value } })) });
  expect(d.themeFilesUpsert.userErrors).toEqual([]);
};
const entry = async (type: string, handle: string, fields: Record<string, string>, status?: string) => {
  const d = await g(`mutation($m: MetaobjectCreateInput!) { metaobjectCreate(metaobject: $m) { metaobject { id } userErrors { field message code } } }`,
    { m: { type, handle, fields: Object.entries(fields).map(([key, value]) => ({ key, value })), ...(status && { capabilities: { publishable: { status } } }) } });
  expect(d.metaobjectCreate.userErrors).toEqual([]);
  return d.metaobjectCreate.metaobject.id as string;
};

beforeAll(async () => {
  t = await createTestApp();
  const setup = await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: SETUP_BODY });
  gql = makeGql(t.app, setup.cookies.find((c) => c.name === 'shopme_session')!.value);
  await seedDemo(t.dbHandle.db, t.app.ctx.storage);
  const shopId = (await getPrimaryShop(t.dbHandle.db))!.id;
  const [theme] = await t.dbHandle.db.select().from(s.themes).where(eq(s.themes.role, 'MAIN'));
  themeGid = `gid://shopify/OnlineStoreTheme/${theme!.id}`;
  await t.dbHandle.db.insert(s.pages).values({ shopId, handle: 'mo', title: 'MO', publishedAt: new Date(), templateSuffix: 'mo' });
}, 90_000);
afterAll(async () => { await t.close(); });

describe('metaobjects in Liquid, theme settings and published pages', () => {
  let teamId = '';
  it('reads entries by handle and as a list, with typed field values', async () => {
    const def = (type: string, fields: unknown[], capabilities?: unknown, extra: Record<string, unknown> = {}) => g(`mutation($d: MetaobjectDefinitionCreateInput!) { metaobjectDefinitionCreate(definition: $d) { metaobjectDefinition { id } userErrors { message code } } }`, { d: { type, name: type, fieldDefinitions: fields, capabilities, ...extra } })
      .then((d) => { expect(d.metaobjectDefinitionCreate.userErrors).toEqual([]); return d.metaobjectDefinitionCreate.metaobjectDefinition.id as string; });
    const memberDef = await def('member', [
      { key: 'name', type: 'single_line_text_field', required: true }, { key: 'years', type: 'number_integer' }, { key: 'lead', type: 'boolean' },
      { key: 'skills', type: 'list.single_line_text_field' }, { key: 'bio', type: 'rich_text_field' }, { key: 'color', type: 'color' },
    ]);
    await def('team', [
      { key: 'title', type: 'single_line_text_field', required: true }, { key: 'members', type: 'list.metaobject_reference', validations: [{ name: 'metaobject_definition_id', value: memberDef }] },
      { key: 'chief', type: 'metaobject_reference', validations: [{ name: 'metaobject_definition_id', value: memberDef }] }, { key: 'featured', type: 'product_reference' },
    ]);
    const ada = await entry('member', 'ada', { name: 'Ada', years: '12', lead: 'true', skills: '["math","code"]', color: '#ff0000', bio: JSON.stringify({ type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Hello <b>' }] }] }) });
    const bob = await entry('member', 'bob', { name: 'Bob', years: '3' });
    const draft = await entry('member', 'carl', { name: 'Carl' }, 'DRAFT');
    const prod = (await g(`{ products(first: 1) { nodes { id title } } }`)).products.nodes[0];
    teamId = await entry('team', 'core', { title: 'Core team', members: JSON.stringify([ada, bob, draft]), chief: ada, featured: prod.id });
    await entry('team', 'loop-a', { title: 'Loop A', chief: ada });

    await put({ 'templates/page.mo.liquid': [
      '<p id=a>{{ metaobjects.member.ada.name }}|{{ metaobjects.member.ada.name.value }}|{{ metaobjects.member.ada.years.value | plus: 1 }}|{{ metaobjects.member.ada.lead.value }}|{{ metaobjects.member.ada.skills.value | join: "+" }}|{{ metaobjects.member.ada.color.value }}</p>',
      '<p id=b>{{ metaobjects.member.ada.system.handle }}|{{ metaobjects.member.ada.system.type }}|{{ metaobjects.member.ada.system.id }}|{{ metaobjects.member.ada.type }}</p>',
      '<p id=c>{% for m in metaobjects.member.values %}{{ m.name }},{% endfor %}|{{ metaobjects.member.values.size }}|{{ shop.metaobjects.member.bob.name }}</p>',
      '<p id=d>{% assign t = metaobjects.team.core %}{{ t.title }}|{% for m in t.members.value %}{{ m.name }},{% endfor %}|{{ t.chief.value.name }}|{{ t.chief.value.years.value }}|{{ t.featured.value.title }}</p>',
      '<p id=e>{{ metaobjects.member.carl.name }}|{{ metaobjects.member.nope.name }}|{{ metaobjects.nope.x.name }}|{% if metaobjects.member.carl %}yes{% else %}no{% endif %}</p>',
      '<p id=f>{{ metaobjects.member.ada.bio | metafield_tag }}|{{ metaobjects.member.ada.skills | metafield_text }}</p>',
    ].join('\n') });
    const html = (await get('/pages/mo')).body;
    expect(html).toContain('<p id=a>Ada|Ada|13|true|math+code|#ff0000</p>');
    expect(html).toContain('<p id=b>ada|member|gid://shopify/Metaobject/');
    expect(html).toMatch(/<p id=c>Ada,Bob,\|2\|Bob<\/p>/);
    expect(html).toContain(`<p id=d>Core team|Ada,Bob,|Ada|12|${prod.title}</p>`);
    expect(html).toContain('<p id=e>|||no</p>');
    expect(html).toContain('<p id=f><div class="metafield-rich_text_field"><p>Hello &lt;b&gt;</p></div>|math, code</p>');
  });

  it('stops expanding cyclic references at depth 5', async () => {
    const d = await g(`mutation($d: MetaobjectDefinitionCreateInput!) { metaobjectDefinitionCreate(definition: $d) { metaobjectDefinition { id } userErrors { message } } }`,
      { d: { type: 'node', name: 'Node', fieldDefinitions: [{ key: 'label', type: 'single_line_text_field' }, { key: 'next', type: 'metaobject_reference' }] } });
    expect(d.metaobjectDefinitionCreate.userErrors).toEqual([]);
    const a = await entry('node', 'a', { label: 'A' });
    const b = await entry('node', 'b', { label: 'B', next: a });
    await g(`mutation($id: ID!, $v: String!) { metaobjectUpdate(id: $id, metaobject: { fields: [{ key: "next", value: $v }] }) { userErrors { message } } }`, { id: a, v: b });
    await put({ 'templates/page.mo.liquid': '<p id=z>{% assign n = metaobjects.node.a %}{% for i in (1..8) %}{% if n %}{{ n.label }}{% assign n = n.next.value %}{% endif %}{% endfor %}</p>' });
    const body = (await get('/pages/mo')).body;
    const out = /<p id=z>([^<]*)<\/p>/.exec(body)![1]!;
    expect(out.length).toBeGreaterThanOrEqual(3);
    expect(out.length).toBeLessThanOrEqual(6);
  });

  it('metaobject and metaobject_list theme settings resolve to entries', async () => {
    await put({
      'config/settings_schema.json': JSON.stringify([{ name: 'theme_info', theme_name: 'T', theme_version: '1' }, { name: 'Team', settings: [
        { type: 'metaobject', id: 'chief', label: 'Chief', metaobject_type: 'member' }, { type: 'metaobject_list', id: 'crew', label: 'Crew', metaobject_type: 'member' }] }]),
      'config/settings_data.json': JSON.stringify({ current: { chief: 'shopify://metaobjects/member/ada', crew: ['shopify://metaobjects/member/bob', 'member/ada', 'shopify://metaobjects/member/gone'] } }),
      'templates/page.mo.liquid': '<p id=s>{{ settings.chief.name }}|{% for m in settings.crew %}{{ m.name.value }},{% endfor %}|{{ settings.crew.size }}</p>',
    });
    expect((await get('/pages/mo')).body).toContain('<p id=s>Ada|Bob,Ada,|2</p>');
  });

  it('storefront access NONE hides a definition', async () => {
    const id = (await g(`{ metaobjectDefinitionByType(type: "member") { id } }`)).metaobjectDefinitionByType.id;
    await g(`mutation($id: ID!) { metaobjectDefinitionUpdate(id: $id, definition: { access: { storefront: NONE } }) { userErrors { message } } }`, { id });
    await put({ 'templates/page.mo.liquid': '<p id=h>{{ metaobjects.member.ada.name }}|{{ metaobjects.member.values.size }}|{{ metaobjects.team.core.title }}|{{ metaobjects.team.core.chief.value.name }}</p>' });
    expect((await get('/pages/mo')).body).toContain('<p id=h>||Core team|</p>');
    await g(`mutation($id: ID!) { metaobjectDefinitionUpdate(id: $id, definition: { access: { storefront: PUBLIC_READ } }) { userErrors { message } } }`, { id });
  });

  it('metafields of reference types read as entries on products and the shop', async () => {
    const prod = (await g(`{ products(first: 1) { nodes { id handle } } }`)).products.nodes[0];
    await g(`mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { message } } }`, { m: [
      { ownerId: prod.id, namespace: 'custom', key: 'lead', type: 'metaobject_reference', value: teamId },
      { ownerId: prod.id, namespace: 'custom', key: 'leads', type: 'list.metaobject_reference', value: JSON.stringify([teamId]) },
    ] });
    await put({ 'templates/page.mo.liquid': `<p id=m>{{ all_products['${prod.handle}'].metafields.custom.lead.value.title }}|{{ all_products['${prod.handle}'].metafields.custom.leads.value.first.title }}|{{ all_products['${prod.handle}'].metafields.custom.lead.value.system.handle }}</p>` });
    expect((await get('/pages/mo')).body).toContain('<p id=m>Core team|Core team|core</p>');
  });

  it('published entries render at /pages/<urlHandle>/<handle> with their template, 404 otherwise', async () => {
    const d = await g(`mutation($d: MetaobjectDefinitionCreateInput!) { metaobjectDefinitionCreate(definition: $d) { metaobjectDefinition { id } userErrors { message code } } }`, {
      d: { type: 'recipe', name: 'Recipe', displayNameKey: 'title', fieldDefinitions: [{ key: 'title', type: 'single_line_text_field', required: true }, { key: 'summary', type: 'multi_line_text_field' }, { key: 'meta', type: 'single_line_text_field' }],
        capabilities: { onlineStore: { enabled: true, data: { urlHandle: 'recipes' } }, renderable: { enabled: true, data: { metaTitleKey: 'meta', metaDescriptionKey: 'summary' } } } } });
    expect(d.metaobjectDefinitionCreate.userErrors).toEqual([]);
    await entry('recipe', 'soup', { title: 'Soup', summary: 'Warm and tasty', meta: 'Best soup' });
    await entry('recipe', 'secret', { title: 'Secret' }, 'DRAFT');
    expect((await get('/pages/recipes/soup')).statusCode).toBe(404); // no template yet
    await put({ 'templates/metaobject/recipe.liquid': '<h1 id=r>{{ metaobject.title }}|{{ metaobject.system.url }}|{{ page_title }}</h1><meta name="description" content="{{ page_description }}">' });
    const ok = await get('/pages/recipes/soup');
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toContain('<h1 id=r>Soup|/pages/recipes/soup|Best soup');
    expect(ok.body).toContain('content="Warm and tasty"');
    expect((await get('/pages/recipes/secret')).statusCode).toBe(404);
    expect((await get('/pages/recipes/nope')).statusCode).toBe(404);
    expect((await get('/pages/other/soup')).statusCode).toBe(404);
    expect((await get('/pages/recipes/soup/extra')).statusCode).toBe(404);
    await put({ 'templates/metaobject/recipe.alt.liquid': '<h1 id=r>ALT {{ metaobject.title }}</h1>' });
    await g(`mutation { metaobjectUpdate(id: "${(await g(`{ metaobjectByHandle(handle: { type: "recipe", handle: "soup" }) { id } }`)).metaobjectByHandle.id}", metaobject: { capabilities: { onlineStore: { templateSuffix: "alt" } } }) { userErrors { message } } }`);
    expect((await get('/pages/recipes/soup')).body).toContain('ALT Soup');
    const map = (await get('/sitemap.xml')).body;
    expect(map).toContain('sitemap_metaobjects_1.xml');
    const sm = (await get('/sitemap_metaobjects_1.xml')).body;
    expect(sm).toContain('/pages/recipes/soup');
    expect(sm).not.toContain('secret');
  });
  it('translates entry text fields per locale and flags outdated digests', async () => {
    await g(`mutation { shopLocaleEnable(locale: "fr") { userErrors { message } } }`);
    await g(`mutation { shopLocaleUpdate(locale: "fr", shopLocale: { published: true }) { userErrors { message } } }`);
    const id = (await g(`{ metaobjectByHandle(handle: { type: "recipe", handle: "soup" }) { id } }`)).metaobjectByHandle.id;
    await put({ 'templates/metaobject/recipe.alt.liquid': '<h1 id=r>{{ metaobject.title }}|{{ metaobject.summary }}</h1>' });
    const res = (await g(`query($id: ID!) { translatableResource(resourceId: $id) { translatableContent { key value digest } } }`, { id })).translatableResource.translatableContent as { key: string; digest: string }[];
    expect(res.map((c) => c.key).sort()).toEqual(['meta', 'summary', 'title']);
    const reg = await g(`mutation($id: ID!, $d: String!) { translationsRegister(resourceId: $id, translations: [{ locale: "fr", key: "title", value: "Soupe", translatableContentDigest: $d }]) { translations { key outdated } userErrors { message code } } }`,
      { id, d: res.find((c) => c.key === 'title')!.digest });
    expect(reg.translationsRegister.userErrors).toEqual([]);
    const fr = await t.app.inject({ url: '/fr/pages/recipes/soup', headers: { 'user-agent': 'Googlebot' } });
    expect(fr.body).toContain('<h1 id=r>Soupe|Warm and tasty</h1>');
    expect((await get('/pages/recipes/soup')).body).toContain('<h1 id=r>Soup|Warm and tasty</h1>');
    await g(`mutation($id: ID!) { metaobjectUpdate(id: $id, metaobject: { fields: [{ key: "title", value: "Soup v2" }] }) { userErrors { message } } }`, { id });
    const after = (await g(`query($id: ID!) { translatableResource(resourceId: $id) { translations(locale: "fr") { key outdated } } }`, { id })).translatableResource.translations;
    expect(after).toEqual([{ key: 'title', outdated: true }]);
  });
});
