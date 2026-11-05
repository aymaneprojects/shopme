import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, setupAndLogin, type TestApp } from '../../../src/test-utils';
import { makeGql, makeGqlOk } from '../helpers';

const ERR = 'userErrors { field message code elementKey elementIndex }';

describe('metaobjects: definitions, entries, references', () => {
  let t: TestApp;
  let gql: ReturnType<typeof makeGql>;
  let g: ReturnType<typeof makeGqlOk>;
  beforeAll(async () => {
    t = await createTestApp();
    const cookie = await setupAndLogin(t.app);
    gql = makeGql(t.app, cookie);
    g = makeGqlOk(gql);
  }, 120_000);
  afterAll(async () => { await t.close(); });

  let authorDef = '';
  let faqDef = '';
  let authorId = '';

  const createDef = (definition: Record<string, unknown>) => g(`mutation($d: MetaobjectDefinitionCreateInput!) { metaobjectDefinitionCreate(definition: $d) { metaobjectDefinition { id type name displayNameKey metaobjectsCount
    fieldDefinitions { key name required type { name } validations { name value } } capabilities { publishable { enabled } translatable { enabled } renderable { enabled } onlineStore { enabled data { urlHandle } } } access { admin storefront customerAccount } } ${ERR} } }`, { d: definition }).then((r) => r.metaobjectDefinitionCreate);

  it('creates a definition with typed fields, validations and capabilities', async () => {
    const r = await createDef({
      type: 'author', name: 'Author', displayNameKey: 'name',
      fieldDefinitions: [
        { key: 'name', name: 'Name', type: 'single_line_text_field', required: true, validations: [{ name: 'max', value: '20' }] },
        { key: 'age', name: 'Age', type: 'number_integer', validations: [{ name: 'min', value: '0' }, { name: 'max', value: '120' }] },
        { key: 'role', name: 'Role', type: 'single_line_text_field', validations: [{ name: 'choices', value: '["writer","editor"]' }] },
        { key: 'tags', name: 'Tags', type: 'list.single_line_text_field' },
        { key: 'active', name: 'Active', type: 'boolean' },
        { key: 'color', name: 'Color', type: 'color' },
      ],
    });
    expect(r.userErrors).toEqual([]);
    authorDef = r.metaobjectDefinition.id;
    expect(r.metaobjectDefinition).toMatchObject({ type: 'author', name: 'Author', displayNameKey: 'name', metaobjectsCount: 0 });
    expect(r.metaobjectDefinition.fieldDefinitions).toHaveLength(6);
    expect(r.metaobjectDefinition.capabilities).toMatchObject({ publishable: { enabled: true }, translatable: { enabled: true }, onlineStore: { enabled: false } });
    expect(r.metaobjectDefinition.access).toMatchObject({ admin: 'PUBLIC_READ_WRITE', storefront: 'PUBLIC_READ', customerAccount: 'NONE' });

    const faq = await createDef({
      type: 'faq', name: 'FAQ', capabilities: { publishable: { enabled: true } },
      fieldDefinitions: [
        { key: 'question', name: 'Question', type: 'single_line_text_field', required: true },
        { key: 'answer', name: 'Answer', type: 'multi_line_text_field' },
        { key: 'author', name: 'Author', type: 'metaobject_reference', validations: [{ name: 'metaobject_definition_id', value: authorDef }] },
        { key: 'authors', name: 'Authors', type: 'list.metaobject_reference', validations: [{ name: 'metaobject_definition_id', value: authorDef }] },
        { key: 'product', name: 'Product', type: 'product_reference' },
      ],
    });
    expect(faq.userErrors).toEqual([]);
    faqDef = faq.metaobjectDefinition.id;
  });

  it('rejects bad definitions with codes and element info', async () => {
    expect((await createDef({ type: 'author', name: 'Dup' })).userErrors[0]).toMatchObject({ code: 'TAKEN' });
    expect((await createDef({ type: 'a b', name: 'x' })).userErrors[0]).toMatchObject({ code: 'INVALID' });
    expect((await createDef({ type: 'ab' })).userErrors[0]).toMatchObject({ code: 'TOO_SHORT' });
    const dupField = await createDef({ type: 'dupes', fieldDefinitions: [{ key: 'one', type: 'boolean' }, { key: 'one', type: 'boolean' }] });
    expect(dupField.userErrors[0]).toMatchObject({ code: 'DUPLICATE_FIELD_INPUT', elementKey: 'one', elementIndex: 1 });
    expect((await createDef({ type: 'badtype', fieldDefinitions: [{ key: 'x1', type: 'nope' }] })).userErrors[0]).toMatchObject({ code: 'INVALID_TYPE', elementKey: 'x1' });
    expect((await createDef({ type: 'badval', fieldDefinitions: [{ key: 'x1', type: 'boolean', validations: [{ name: 'regex', value: 'a' }] }] })).userErrors[0]).toMatchObject({ code: 'INVALID_OPTION' });
    expect((await createDef({ type: 'baddisplay', displayNameKey: 'zz', fieldDefinitions: [{ key: 'x1', type: 'boolean' }] })).userErrors[0]).toMatchObject({ code: 'DISPLAY_NAME_CONFLICT' });
    expect((await createDef({ type: 'nourl', capabilities: { onlineStore: { enabled: true } } })).userErrors[0]).toMatchObject({ code: 'URL_HANDLE_BLANK' });
  });

  const create = (metaobject: Record<string, unknown>) => g(`mutation($m: MetaobjectCreateInput!) { metaobjectCreate(metaobject: $m) { metaobject { id handle displayName type capabilities { publishable { status } }
    fields { key type value jsonValue } } ${ERR} } }`, { m: metaobject }).then((r) => r.metaobjectCreate);

  it('validates entry values by field type and definition rules', async () => {
    expect((await create({ type: 'nope', fields: [] })).userErrors[0]).toMatchObject({ code: 'UNDEFINED_OBJECT_TYPE' });
    expect((await create({ type: 'author', fields: [] })).userErrors[0]).toMatchObject({ code: 'OBJECT_FIELD_REQUIRED', elementKey: 'name' });
    expect((await create({ type: 'author', fields: [{ key: 'zzz', value: 'x' }, { key: 'name', value: 'A' }] })).userErrors[0]).toMatchObject({ code: 'UNDEFINED_OBJECT_FIELD', elementKey: 'zzz', elementIndex: 0 });
    expect((await create({ type: 'author', fields: [{ key: 'name', value: 'A' }, { key: 'name', value: 'B' }] })).userErrors[0]).toMatchObject({ code: 'DUPLICATE_FIELD_INPUT' });
    expect((await create({ type: 'author', fields: [{ key: 'name', value: 'A very very long author name here' }] })).userErrors[0]).toMatchObject({ code: 'INVALID_VALUE', elementKey: 'name' });
    expect((await create({ type: 'author', fields: [{ key: 'name', value: 'A' }, { key: 'age', value: '200' }] })).userErrors[0]).toMatchObject({ code: 'INVALID_VALUE', elementKey: 'age' });
    expect((await create({ type: 'author', fields: [{ key: 'name', value: 'A' }, { key: 'age', value: 'abc' }] })).userErrors[0]).toMatchObject({ code: 'INVALID_VALUE' });
    expect((await create({ type: 'author', fields: [{ key: 'name', value: 'A' }, { key: 'role', value: 'pilot' }] })).userErrors[0]).toMatchObject({ code: 'INVALID_VALUE', elementKey: 'role' });
    expect((await create({ type: 'author', fields: [{ key: 'name', value: 'A' }, { key: 'color', value: 'red' }] })).userErrors[0]).toMatchObject({ code: 'INVALID_VALUE' });
    expect((await create({ type: 'author', fields: [{ key: 'name', value: 'A' }, { key: 'active', value: 'yes' }] })).userErrors[0]).toMatchObject({ code: 'INVALID_VALUE' });
    expect((await create({ type: 'author', fields: [{ key: 'name', value: 'A' }, { key: 'tags', value: 'notjson' }] })).userErrors[0]).toMatchObject({ code: 'INVALID_VALUE' });
    expect((await create({ type: 'author', handle: 'Bad Handle!', fields: [{ key: 'name', value: 'A' }] })).userErrors[0]).toMatchObject({ code: 'INVALID' });
    expect((await create({ type: 'author', fields: [{ key: 'name', value: 'A' }], values: { name: 'B' } })).userErrors[0]).toMatchObject({ code: 'INVALID' });
  });

  it('creates entries with derived handles, display names and typed values', async () => {
    const a = await create({ type: 'author', fields: [{ key: 'name', value: 'Ada Lovelace' }, { key: 'age', value: '36' }, { key: 'tags', value: '["math","poetry"]' }, { key: 'active', value: 'true' }], capabilities: { publishable: { status: 'DRAFT' } } });
    expect(a.userErrors).toEqual([]);
    authorId = a.metaobject.id;
    expect(a.metaobject).toMatchObject({ handle: 'ada-lovelace', displayName: 'Ada Lovelace', type: 'author', capabilities: { publishable: { status: 'DRAFT' } } });
    const byKey = Object.fromEntries(a.metaobject.fields.map((f: { key: string }) => [f.key, f]));
    expect(byKey.age.jsonValue).toBe(36);
    expect(byKey.active.jsonValue).toBe(true);
    expect(byKey.tags.jsonValue).toEqual(['math', 'poetry']);
    expect(byKey.role.value).toBeNull();
    const b = await create({ type: 'author', values: { name: 'Ada Lovelace', age: 40 } });
    expect(b.userErrors).toEqual([]);
    expect(b.metaobject.handle).toBe('ada-lovelace-1');
    expect((await create({ type: 'author', handle: 'ada-lovelace', fields: [{ key: 'name', value: 'X' }] })).userErrors[0]).toMatchObject({ code: 'TAKEN' });
  });

  it('updates fields (merging), handle and status, and upserts by handle', async () => {
    const u = await g(`mutation($id: ID!, $m: MetaobjectUpdateInput!) { metaobjectUpdate(id: $id, metaobject: $m) { metaobject { handle displayName values capabilities { publishable { status } } } ${ERR} } }`,
      { id: authorId, m: { handle: 'ada', fields: [{ key: 'role', value: 'writer' }], capabilities: { publishable: { status: 'ACTIVE' } } } });
    expect(u.metaobjectUpdate.userErrors).toEqual([]);
    expect(u.metaobjectUpdate.metaobject).toMatchObject({ handle: 'ada', displayName: 'Ada Lovelace', capabilities: { publishable: { status: 'ACTIVE' } } });
    expect(u.metaobjectUpdate.metaobject.values).toMatchObject({ name: 'Ada Lovelace', role: 'writer', age: '36' });
    // clearing a required field is refused, clearing an optional one removes it
    const bad = await g(`mutation($id: ID!, $m: MetaobjectUpdateInput!) { metaobjectUpdate(id: $id, metaobject: $m) { metaobject { id } ${ERR} } }`, { id: authorId, m: { fields: [{ key: 'name', value: '' }] } });
    expect(bad.metaobjectUpdate.userErrors[0]).toMatchObject({ code: 'OBJECT_FIELD_REQUIRED' });

    const up = (m: unknown) => g(`mutation($h: MetaobjectHandleInput!, $m: MetaobjectUpsertInput) { metaobjectUpsert(handle: $h, metaobject: $m) { metaobject { id handle values } ${ERR} } }`, { h: { type: 'author', handle: 'grace' }, m }).then((r) => r.metaobjectUpsert);
    const c = await up({ fields: [{ key: 'name', value: 'Grace Hopper' }] });
    expect(c.userErrors).toEqual([]);
    expect(c.metaobject.handle).toBe('grace');
    const again = await up({ fields: [{ key: 'age', value: '85' }] });
    expect(again.metaobject.id).toBe(c.metaobject.id);
    expect(again.metaobject.values).toEqual({ name: 'Grace Hopper', age: '85' });

    const q = await g(`{ metaobjectByHandle(handle: { type: "author", handle: "ada" }) { id displayName } metaobjects(type: "author", first: 10, sortKey: "display_name") { nodes { handle } } metaobjectDefinitionByType(type: "author") { metaobjectsCount } }`);
    expect(q.metaobjectByHandle.displayName).toBe('Ada Lovelace');
    expect(q.metaobjects.nodes.map((n: { handle: string }) => n.handle)).toEqual(['ada', 'ada-lovelace-1', 'grace']);
    expect(q.metaobjectDefinitionByType.metaobjectsCount).toBe(3);
  });

  it('supports the search syntax', async () => {
    const find = async (query: string) => (await g(`query($q: String) { metaobjects(type: "author", first: 10, query: $q) { nodes { handle } } }`, { q: query })).metaobjects.nodes.map((n: { handle: string }) => n.handle).sort();
    expect(await find('grace')).toEqual(['grace']);
    expect(await find('handle:ada')).toEqual(['ada']);
    expect(await find('display_name:lovelace')).toEqual(['ada', 'ada-lovelace-1']);
    expect(await find('fields.age:>38')).toEqual(['ada-lovelace-1', 'grace']);
    expect(await find('fields.role:writer')).toEqual(['ada']);
    expect(await find('status:draft')).toEqual(['ada-lovelace-1', 'grace'].filter(() => false));
  });

  it('references: validates targets, resolves them, lists referencedBy, cleans up on delete', async () => {
    const mk = (fields: unknown[]) => create({ type: 'faq', fields });
    expect((await mk([{ key: 'question', value: 'Q?' }, { key: 'author', value: 'gid://shopify/Metaobject/99999' }])).userErrors[0]).toMatchObject({ code: 'INVALID_VALUE', elementKey: 'author' });
    expect((await mk([{ key: 'question', value: 'Q?' }, { key: 'author', value: 'gid://shopify/Product/1' }])).userErrors[0]).toMatchObject({ code: 'INVALID_VALUE' });
    const faq = await mk([{ key: 'question', value: 'Who wrote it?' }, { key: 'author', value: authorId }, { key: 'authors', value: JSON.stringify([authorId]) }]);
    expect(faq.userErrors).toEqual([]);
    const read = await g(`query($id: ID!) { metaobject(id: $id) { field(key: "author") { reference { ... on Metaobject { handle displayName } } } f2: field(key: "authors") { references(first: 5) { nodes { ... on Metaobject { handle } } } } } }`, { id: faq.metaobject.id });
    expect(read.metaobject.field.reference).toMatchObject({ handle: 'ada', displayName: 'Ada Lovelace' });
    expect(read.metaobject.f2.references.nodes).toEqual([{ handle: 'ada' }]);

    // an entry of another definition cannot be referenced through a pinned field
    const other = (await create({ type: 'faq', fields: [{ key: 'question', value: 'Other' }] })).metaobject.id;
    expect((await mk([{ key: 'question', value: 'Q?' }, { key: 'author', value: other }])).userErrors[0]).toMatchObject({ code: 'INVALID_VALUE' });

    // a product metafield referencing an entry
    const p = await g(`mutation { productCreate(product: { title: "Pen" }) { product { id } } }`);
    const pid = p.productCreate.product.id;
    await g(`mutation { metafieldDefinitionCreate(definition: { ownerType: PRODUCT, namespace: "custom", key: "writer", name: "Writer", type: "metaobject_reference", validations: [{ name: "metaobject_definition_id", value: "${authorDef}" }] }) { createdDefinition { id } userErrors { message } } }`);
    const set = await g(`mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { metafields { id type reference { ... on Metaobject { handle } } } userErrors { message code } } }`, { m: [{ ownerId: pid, namespace: 'custom', key: 'writer', type: 'metaobject_reference', value: authorId }] });
    expect(set.metafieldsSet.userErrors).toEqual([]);
    expect(set.metafieldsSet.metafields[0].reference).toEqual({ handle: 'ada' });
    const wrong = await g(`mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { message code } } }`, { m: [{ ownerId: pid, namespace: 'custom', key: 'writer', type: 'metaobject_reference', value: 'gid://shopify/Metaobject/424242' }] });
    expect(wrong.metafieldsSet.userErrors[0].code).toBe('INVALID_VALUE');

    const rel = await g(`query($id: ID!) { metaobject(id: $id) { referencedBy(first: 10) { nodes { key namespace referencer { __typename ... on Metaobject { handle } ... on Product { title } } } } } }`, { id: authorId });
    const nodes = rel.metaobject.referencedBy.nodes as { key: string; referencer: { __typename: string } }[];
    expect(nodes.map((n) => n.referencer.__typename).sort()).toEqual(['Metaobject', 'Metaobject', 'Product']);

    // deleting the entry empties the references (the optional fields) and the metafield
    const del = await g(`mutation($id: ID!) { metaobjectDelete(id: $id) { deletedId ${ERR} } }`, { id: authorId });
    expect(del.metaobjectDelete.userErrors).toEqual([]);
    const after = await g(`query($id: ID!, $p: ID!) { metaobject(id: $id) { values } product(id: $p) { metafield(namespace: "custom", key: "writer") { value } } }`, { id: faq.metaobject.id, p: pid });
    expect(after.metaobject.values).toEqual({ question: 'Who wrote it?' });
    expect(after.product.metafield).toBeNull();
  });

  it('refuses to delete an entry used by a required field, and a pinned definition', async () => {
    // make `author` required on faq via a definition update, then reference a new author
    const au = (await create({ type: 'author', fields: [{ key: 'name', value: 'Linus' }] })).metaobject.id;
    const upd = await g(`mutation($id: ID!, $d: MetaobjectDefinitionUpdateInput!) { metaobjectDefinitionUpdate(id: $id, definition: $d) { metaobjectDefinition { fieldDefinitions { key required } } ${ERR} } }`,
      { id: faqDef, d: { fieldDefinitions: [{ update: { key: 'author', required: true } }] } });
    expect(upd.metaobjectDefinitionUpdate.userErrors).toEqual([]);
    expect(upd.metaobjectDefinitionUpdate.metaobjectDefinition.fieldDefinitions.find((f: { key: string }) => f.key === 'author').required).toBe(true);
    await create({ type: 'faq', fields: [{ key: 'question', value: 'Kernel?' }, { key: 'author', value: au }] });
    expect((await g(`mutation($id: ID!) { metaobjectDelete(id: $id) { deletedId ${ERR} } }`, { id: au })).metaobjectDelete.userErrors[0]).toMatchObject({ code: 'REFERENCE_EXISTS_ERROR' });
    expect((await g(`mutation($id: ID!) { metaobjectDefinitionDelete(id: $id) { deletedId ${ERR} } }`, { id: authorDef })).metaobjectDefinitionDelete.userErrors[0]).toMatchObject({ code: 'REFERENCE_EXISTS_ERROR' });
  });

  it('updates definitions: field create/update/delete, immutable keys, reorder', async () => {
    const ops = (d: unknown) => g(`mutation($id: ID!, $d: MetaobjectDefinitionUpdateInput!) { metaobjectDefinitionUpdate(id: $id, definition: $d) { metaobjectDefinition { name fieldDefinitions { key name } displayNameKey } ${ERR} } }`, { id: faqDef, d }).then((r) => r.metaobjectDefinitionUpdate);
    const a = await ops({ name: 'FAQs', fieldDefinitions: [{ create: { key: 'extra', type: 'boolean', name: 'Extra' } }, { delete: { key: 'product' } }, { update: { key: 'answer', name: 'Reply' } }] });
    expect(a.userErrors).toEqual([]);
    expect(a.metaobjectDefinition.name).toBe('FAQs');
    expect(a.metaobjectDefinition.fieldDefinitions.map((f: { key: string }) => f.key)).toEqual(['question', 'answer', 'author', 'authors', 'extra']);
    expect(a.metaobjectDefinition.fieldDefinitions[1].name).toBe('Reply');
    expect((await ops({ fieldDefinitions: [{ create: { key: 'extra', type: 'boolean' } }] })).userErrors[0]).toMatchObject({ code: 'OBJECT_FIELD_TAKEN' });
    expect((await ops({ fieldDefinitions: [{ update: { key: 'nope', name: 'x' } }] })).userErrors[0]).toMatchObject({ code: 'UNDEFINED_OBJECT_FIELD' });
    const r = await ops({ resetFieldOrder: true, fieldDefinitions: [{ update: { key: 'extra', name: 'Extra' } }] });
    expect(r.metaobjectDefinition.fieldDefinitions.map((f: { key: string }) => f.key)).toEqual(['extra', 'answer', 'author', 'authors', 'question']);
    const dn = await ops({ displayNameKey: 'question' });
    expect(dn.metaobjectDefinition.displayNameKey).toBe('question');
  });

  it('bulk deletes by ids and by type, and deletes definitions with their entries', async () => {
    const ids: string[] = [];
    for (const n of ['One', 'Two', 'Three']) ids.push((await create({ type: 'author', fields: [{ key: 'name', value: n }] })).metaobject.id);
    const del = await g(`mutation($w: MetaobjectBulkDeleteWhereCondition!) { metaobjectBulkDelete(where: $w) { job { id done } ${ERR} } }`, { w: { ids: ids.slice(0, 2) } });
    expect(del.metaobjectBulkDelete.userErrors).toEqual([]);
    expect(del.metaobjectBulkDelete.job.done).toBe(true);
    expect((await g(`{ metaobjects(type: "author", first: 50, query: "name") { nodes { handle } } }`)).metaobjects.nodes.map((n: { handle: string }) => n.handle)).not.toContain('one');
    expect((await g(`mutation($w: MetaobjectBulkDeleteWhereCondition!) { metaobjectBulkDelete(where: $w) { job { id } ${ERR} } }`, { w: { type: 'nope' } })).metaobjectBulkDelete.userErrors[0]).toMatchObject({ code: 'UNDEFINED_OBJECT_TYPE' });
    expect((await g(`mutation($w: MetaobjectBulkDeleteWhereCondition!) { metaobjectBulkDelete(where: $w) { job { id } ${ERR} } }`, { w: { type: 'faq' } })).metaobjectBulkDelete.userErrors).toEqual([]);
    const gone = await g(`mutation($id: ID!) { metaobjectDefinitionDelete(id: $id) { deletedId ${ERR} } }`, { id: faqDef });
    expect(gone.metaobjectDefinitionDelete.userErrors).toEqual([]);
    expect((await g(`{ metaobjectDefinitions(first: 10) { nodes { type } } }`)).metaobjectDefinitions.nodes.map((n: { type: string }) => n.type)).toEqual(['author']);
    const sum = await g(`{ shopmeMetaobjectsSummary { activeCount draftCount totalCount webPageCount recent { displayName } } }`);
    expect(sum.shopmeMetaobjectsSummary.totalCount).toBeGreaterThan(0);
  });

  it('online store capability: url handle rules and redirects on handle change', async () => {
    const ok = await createDef({ type: 'recipe', name: 'Recipe', displayNameKey: 'title', fieldDefinitions: [{ key: 'title', type: 'single_line_text_field', required: true }], capabilities: { onlineStore: { enabled: true, data: { urlHandle: 'recipes', createRedirects: true } } } });
    expect(ok.userErrors).toEqual([]);
    expect(ok.metaobjectDefinition.capabilities).toMatchObject({ renderable: { enabled: true }, onlineStore: { enabled: true, data: { urlHandle: 'recipes' } } });
    expect((await createDef({ type: 'recipe2', capabilities: { onlineStore: { enabled: true, data: { urlHandle: 'recipes' } } } })).userErrors[0]).toMatchObject({ code: 'URL_HANDLE_TAKEN' });
    expect((await createDef({ type: 'recipe3', capabilities: { onlineStore: { enabled: true, data: { urlHandle: 'Bad Handle' } } } })).userErrors[0]).toMatchObject({ code: 'URL_HANDLE_INVALID' });
    const e = await create({ type: 'recipe', handle: 'soup', fields: [{ key: 'title', value: 'Soup' }] });
    const mv = await g(`mutation($id: ID!) { metaobjectUpdate(id: $id, metaobject: { handle: "broth", redirectNewHandle: true }) { metaobject { handle } ${ERR} } }`, { id: e.metaobject.id });
    expect(mv.metaobjectUpdate.userErrors).toEqual([]);
    const red = await g(`{ urlRedirects(first: 10) { nodes { path target } } }`);
    expect(red.urlRedirects.nodes).toContainEqual({ path: '/pages/recipes/soup', target: '/pages/recipes/broth' });
    // entries of definitions without the capability reject its data
    expect((await create({ type: 'author', fields: [{ key: 'name', value: 'Z' }], capabilities: { onlineStore: { templateSuffix: 'x' } } })).userErrors[0]).toMatchObject({ code: 'CAPABILITY_NOT_ENABLED' });
  });
});
