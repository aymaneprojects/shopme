import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, setupAndLogin, type TestApp } from '../../../src/test-utils';
import { makeGql, makeGqlOk } from '../helpers';

describe('discount parity: bulk codes, bulk edits, counts and reads', () => {
  let t: TestApp;
  let gql: ReturnType<typeof makeGql>;
  let g: ReturnType<typeof makeGqlOk>;
  let a = '';
  let b = '';
  let auto1 = '';
  let auto2 = '';

  const code = async (title: string, c: string, extra = '') => {
    const r = (await g(`mutation { discountCodeBasicCreate(basicCodeDiscount: { title: "${title}", code: "${c}", startsAt: "2026-01-01T00:00:00Z", customerGets: { value: { percentage: 0.1 }, items: { all: true } } ${extra} }) { codeDiscountNode { id } userErrors { message } } }`)).discountCodeBasicCreate;
    expect(r.userErrors).toEqual([]);
    return r.codeDiscountNode.id as string;
  };
  const auto = async (title: string) => {
    const r = (await g(`mutation { discountAutomaticBasicCreate(automaticBasicDiscount: { title: "${title}", startsAt: "2026-01-01T00:00:00Z", customerGets: { value: { percentage: 0.05 }, items: { all: true } } }) { automaticDiscountNode { id } userErrors { message } } }`)).discountAutomaticBasicCreate;
    expect(r.userErrors).toEqual([]);
    return r.automaticDiscountNode.id as string;
  };

  beforeAll(async () => {
    t = await createTestApp();
    gql = makeGql(t.app, await setupAndLogin(t.app));
    g = makeGqlOk(gql);
    a = await code('Alpha', 'ALPHA');
    b = await code('Beta', 'BETA');
    auto1 = await auto('Auto one');
    auto2 = await auto('Auto two');
  }, 120_000);
  afterAll(async () => { await t.close(); });

  it('adds redeem codes in bulk and reports per-code errors', async () => {
    const add = `mutation($id: ID!, $codes: [DiscountRedeemCodeInput!]!) { discountRedeemCodeBulkAdd(discountId: $id, codes: $codes) {
      bulkCreation { id done codesCount importedCount failedCount createdAt discountCode { id } codes(first: 10) { nodes { code discountRedeemCode { id code asyncUsageCount } errors { field message code } } } } userErrors { field message code } } }`;
    const r = (await g(add, { id: a, codes: [{ code: 'one' }, { code: 'TWO' }, { code: 'one' }, { code: 'BETA' }, { code: '' }] })).discountRedeemCodeBulkAdd;
    expect(r.userErrors).toEqual([]);
    expect(r.bulkCreation).toMatchObject({ done: true, codesCount: 5, importedCount: 2, failedCount: 3, discountCode: { id: a } });
    const codes = r.bulkCreation.codes.nodes;
    expect(codes.map((c: { code: string }) => c.code)).toEqual(['ONE', 'TWO', 'ONE', 'BETA', '']);
    expect(codes[0].discountRedeemCode).toMatchObject({ code: 'ONE', asyncUsageCount: 0 });
    expect(codes[2]).toMatchObject({ discountRedeemCode: null, errors: [{ field: ['code'], code: 'TAKEN' }] });
    expect(codes[3].errors[0].code).toBe('TAKEN');
    expect(codes[4].errors[0].code).toBe('BLANK');

    const again = (await g(`query($id: ID!) { discountRedeemCodeBulkCreation(id: $id) { id importedCount done } }`, { id: r.bulkCreation.id })).discountRedeemCodeBulkCreation;
    expect(again).toMatchObject({ id: r.bulkCreation.id, importedCount: 2, done: true });
    expect((await g(`{ discountRedeemCodeBulkCreation(id: "gid://shopify/DiscountRedeemCodeBulkCreation/999") { id } }`)).discountRedeemCodeBulkCreation).toBeNull();

    // The new codes work like the original code.
    const byCode = (await g(`{ codeDiscountNodeByCode(code: "two") { id codeDiscount { ... on DiscountCodeBasic { title codesCount { count } codes(first: 10) { nodes { code } } } } } }`)).codeDiscountNodeByCode;
    expect(byCode.id).toBe(a);
    expect(byCode.codeDiscount).toMatchObject({ title: 'Alpha', codesCount: { count: 3 } });
    expect(byCode.codeDiscount.codes.nodes.map((c: { code: string }) => c.code)).toEqual(['ALPHA', 'ONE', 'TWO']);
  });

  it('validates discount, count and automatic discounts for redeem codes', async () => {
    const add = (id: string, n: number) => g(`mutation($id: ID!, $c: [DiscountRedeemCodeInput!]!) { discountRedeemCodeBulkAdd(discountId: $id, codes: $c) { bulkCreation { id } userErrors { field message code } } }`, { id, c: Array.from({ length: n }, (_, i) => ({ code: `X${i}` })) });
    expect((await add('gid://shopify/DiscountCodeNode/999999', 1)).discountRedeemCodeBulkAdd.userErrors[0]).toMatchObject({ field: ['discountId'], code: 'INVALID' });
    expect((await add(auto1, 1)).discountRedeemCodeBulkAdd.userErrors[0]).toMatchObject({ field: ['discountId'], code: 'INVALID' });
    expect((await add(a, 251)).discountRedeemCodeBulkAdd.userErrors[0]).toMatchObject({ field: ['codes'], code: 'EXCEEDED_MAX' });
    expect((await add(a, 0)).discountRedeemCodeBulkAdd.userErrors[0]).toMatchObject({ field: ['codes'], code: 'BLANK' });
    expect((await add(a, 250)).discountRedeemCodeBulkAdd.userErrors).toEqual([]);
  });

  it('counts redeem codes', async () => {
    const all = (await g(`{ discountCodesCount { count precision } }`)).discountCodesCount;
    expect(all).toEqual({ count: 4 + 250, precision: 'EXACT' });
    expect((await g(`{ discountCodesCount(query: "code:BETA") { count } }`)).discountCodesCount.count).toBe(1);
    expect((await g(`{ discountCodesCount(limit: 100) { count precision } }`)).discountCodesCount).toEqual({ count: 100, precision: 'AT_LEAST' });
    expect((await g(`{ discountCodesCount(query: "times_used:0") { count } }`)).discountCodesCount.count).toBe(254);
  });

  it('generates codes with prefix, suffix, length and character set', async () => {
    const gen = `mutation($id: ID!, $n: Int!, $len: Int, $p: String, $s: String, $cs: ShopmeDiscountCodeCharacterSet) { shopmeDiscountCodesGenerate(discountId: $id, count: $n, length: $len, prefix: $p, suffix: $s, characterSet: $cs) {
      bulkCreation { done importedCount failedCount codes(first: 50) { nodes { code } } } userErrors { field message code } } }`;
    const r = (await g(gen, { id: b, n: 30, len: 6, p: 'sum-', s: '-eu', cs: 'DIGITS' })).shopmeDiscountCodesGenerate;
    expect(r.userErrors).toEqual([]);
    expect(r.bulkCreation).toMatchObject({ done: true, importedCount: 30, failedCount: 0 });
    const codes = r.bulkCreation.codes.nodes.map((c: { code: string }) => c.code);
    expect(new Set(codes).size).toBe(30);
    for (const c of codes) expect(c).toMatch(/^SUM-\d{6}-EU$/);
    const letters = (await g(gen, { id: b, n: 5, len: 10, cs: 'LETTERS' })).shopmeDiscountCodesGenerate.bulkCreation.codes.nodes;
    for (const c of letters) expect(c.code).toMatch(/^[A-Z]{10}$/);
    const unamb = (await g(gen, { id: b, n: 20, len: 12, cs: 'UNAMBIGUOUS' })).shopmeDiscountCodesGenerate.bulkCreation.codes.nodes;
    for (const c of unamb) expect(c.code).toMatch(/^[A-HJKMNP-Z2-9]{12}$/);
    const checks = [
      [{ id: b, n: 0, len: 8 }, ['count'], 'GREATER_THAN'], [{ id: b, n: 20001, len: 8 }, ['count'], 'EXCEEDED_MAX'], [{ id: b, n: 5, len: 2 }, ['length'], 'TOO_SHORT'],
      [{ id: b, n: 5, len: 8, p: 'bad prefix' }, ['prefix'], 'INVALID'], [{ id: b, n: 3000, len: 4, cs: 'DIGITS' }, ['length'], 'TOO_SHORT'], [{ id: auto1, n: 5, len: 8 }, ['discountId'], 'INVALID'],
    ] as const;
    for (const [vars, field, errCode] of checks) {
      const e = (await g(gen, vars as never)).shopmeDiscountCodesGenerate;
      expect(e.bulkCreation).toBeNull();
      expect(e.userErrors[0]).toMatchObject({ field, code: errCode });
    }
  });

  it('deletes redeem codes of a discount but keeps at least one', async () => {
    const ids = (await g(`{ codeDiscountNode(id: "${a}") { codeDiscount { ... on DiscountCodeBasic { codes(first: 3) { nodes { id code } } } } } }`)).codeDiscountNode.codeDiscount.codes.nodes as { id: string; code: string }[];
    const del = `mutation($d: ID!, $ids: [ID!], $search: String) { discountCodeRedeemCodeBulkDelete(discountId: $d, ids: $ids, search: $search) { job { id done } userErrors { field message code } } }`;
    const r = (await g(del, { d: a, ids: [ids[1]!.id, ids[2]!.id] })).discountCodeRedeemCodeBulkDelete;
    expect(r.userErrors).toEqual([]);
    expect(r.job.done).toBe(true);
    const left = (await g(`{ codeDiscountNode(id: "${a}") { codeDiscount { ... on DiscountCodeBasic { codesCount { count } } } } }`)).codeDiscountNode.codeDiscount.codesCount.count;
    expect(left).toBe(1 + 250);
    expect((await g(del, { d: a })).discountCodeRedeemCodeBulkDelete.userErrors[0]).toMatchObject({ code: 'MISSING_ARGUMENT' });
    expect((await g(del, { d: a, ids: [], search: 'x' })).discountCodeRedeemCodeBulkDelete.userErrors[0]).toMatchObject({ code: 'TOO_MANY_ARGUMENTS' });
    // Everything but the first code can go by search; deleting all would orphan the discount.
    const all = (await g(del, { d: a, search: 'code:*' })).discountCodeRedeemCodeBulkDelete;
    expect(all.userErrors[0]).toMatchObject({ field: ['ids'], code: 'INVALID' });
    const job = (await g(`query($id: ID!) { job(id: $id) { id done } }`, { id: r.job.id })).job;
    expect(job).toEqual({ id: r.job.id, done: true });
  });

  it('activates, deactivates and deletes code discounts by ids, search or saved search', async () => {
    const act = (name: string, vars: Record<string, unknown>) => g(`mutation($ids: [ID!], $search: String, $saved: ID) { ${name}(ids: $ids, search: $search, savedSearchId: $saved) { job { id done } userErrors { field message code } } }`, vars);
    const status = async (id: string) => (await g(`{ codeDiscountNode(id: "${id}") { codeDiscount { ... on DiscountCodeBasic { status } } } }`)).codeDiscountNode.codeDiscount.status;
    expect((await act('discountCodeBulkDeactivate', { ids: [a, b] })).discountCodeBulkDeactivate.userErrors).toEqual([]);
    expect([await status(a), await status(b)]).toEqual(['EXPIRED', 'EXPIRED']);
    expect((await act('discountCodeBulkActivate', { search: 'title:Alpha' })).discountCodeBulkActivate.userErrors).toEqual([]);
    expect([await status(a), await status(b)]).toEqual(['ACTIVE', 'EXPIRED']);
    const saved = (await g(`mutation { savedSearchCreate(input: { resourceType: PRODUCT, name: "Beta only", query: "title:Beta" }) { savedSearch { id } userErrors { message } } }`)).savedSearchCreate;
    if (!saved.savedSearch) throw new Error(JSON.stringify(saved.userErrors));
    expect((await act('discountCodeBulkActivate', { saved: saved.savedSearch.id })).discountCodeBulkActivate.userErrors).toEqual([]);
    expect(await status(b)).toBe('ACTIVE');

    expect((await act('discountCodeBulkActivate', {})).discountCodeBulkActivate.userErrors[0]).toMatchObject({ code: 'MISSING_ARGUMENT', field: null });
    expect((await act('discountCodeBulkActivate', { ids: [a], search: 'x' })).discountCodeBulkActivate.userErrors[0]).toMatchObject({ code: 'TOO_MANY_ARGUMENTS' });
    expect((await act('discountCodeBulkActivate', { ids: [auto1] })).discountCodeBulkActivate.userErrors[0]).toMatchObject({ field: ['ids'], code: 'INVALID' });
    expect((await act('discountCodeBulkActivate', { saved: 'gid://shopify/SavedSearch/99999' })).discountCodeBulkActivate.userErrors[0]).toMatchObject({ field: ['savedSearchId'], code: 'INVALID' });

    const extra = await code('Gamma', 'GAMMA');
    expect((await act('discountCodeBulkDelete', { ids: [extra] })).discountCodeBulkDelete.userErrors).toEqual([]);
    expect((await g(`{ codeDiscountNode(id: "${extra}") { id } }`)).codeDiscountNode).toBeNull();
  });

  it('adds and removes tags and lists them', async () => {
    const tag = (name: string, vars: Record<string, unknown>) => g(`mutation($ids: [ID!], $search: String, $tags: [String!]!) { ${name}(ids: $ids, search: $search, tags: $tags) { job { id done } userErrors { field message code } } }`, vars);
    expect((await tag('discountBulkTagsAdd', { ids: [a, auto1], tags: ['spring', 'vip'] })).discountBulkTagsAdd.userErrors).toEqual([]);
    expect((await tag('discountBulkTagsAdd', { search: 'title:Beta', tags: ['Spring', 'beta'] })).discountBulkTagsAdd.userErrors).toEqual([]);
    const tags = async (id: string) => (await g(`{ discountNode(id: "${id}") { discount { ... on DiscountCodeBasic { tags } ... on DiscountAutomaticBasic { tags } } } }`)).discountNode.discount.tags;
    expect(await tags(a)).toEqual(['spring', 'vip']);
    expect(await tags(auto1)).toEqual(['spring', 'vip']);
    expect(await tags(b)).toEqual(['Spring', 'beta']);
    expect([...(await g(`{ discountTags(first: 10) { nodes } }`)).discountTags.nodes].sort()).toEqual(['Spring', 'beta', 'spring', 'vip']);
    expect((await g(`{ discountTags(first: 10, query: "vi") { nodes } }`)).discountTags.nodes).toEqual(['vip']);
    expect((await tag('discountBulkTagsRemove', { ids: [a], tags: ['SPRING'] })).discountBulkTagsRemove.userErrors).toEqual([]);
    expect(await tags(a)).toEqual(['vip']);
    expect((await tag('discountBulkTagsAdd', { ids: [a], tags: [] })).discountBulkTagsAdd.userErrors[0]).toMatchObject({ field: ['tags'], code: 'BLANK' });
    expect((await tag('discountBulkTagsRemove', { tags: ['x'] })).discountBulkTagsRemove.userErrors[0].code).toBe('MISSING_ARGUMENT');
  });

  it('reads automatic discounts through the legacy roots and deletes them in bulk', async () => {
    const one = (await g(`{ automaticDiscount(id: "${auto1}") { __typename ... on DiscountAutomaticBasic { title status } } }`)).automaticDiscount;
    expect(one).toEqual({ __typename: 'DiscountAutomaticBasic', title: 'Auto one', status: 'ACTIVE' });
    expect((await g(`{ automaticDiscount(id: "${a}") { __typename } }`)).automaticDiscount).toBeNull();
    const list = (await g(`{ automaticDiscounts(first: 10, sortKey: CREATED_AT, reverse: true) { edges { cursor node { __typename ... on DiscountAutomaticBasic { title } } } nodes { __typename } pageInfo { hasNextPage } } }`)).automaticDiscounts;
    expect(list.edges.map((e: { node: { title: string } }) => e.node.title)).toEqual(['Auto two', 'Auto one']);
    expect((await g(`{ automaticDiscounts(first: 10, query: "title:two") { nodes { __typename } } }`)).automaticDiscounts.nodes).toHaveLength(1);
    expect((await g(`{ automaticDiscountNodes(first: 10, sortKey: CREATED_AT) { nodes { id } } discountNodes(first: 20) { nodes { id } } }`)).discountNodes.nodes.length).toBeGreaterThanOrEqual(4);

    const del = (name: string, vars: Record<string, unknown>) => g(`mutation($ids: [ID!], $search: String) { ${name}(ids: $ids, search: $search) { job { done } userErrors { field message code } } }`, vars);
    expect((await del('discountAutomaticBulkDelete', { ids: [a] })).discountAutomaticBulkDelete.userErrors[0]).toMatchObject({ field: ['ids'], code: 'INVALID' });
    expect((await del('discountAutomaticBulkDelete', { ids: [auto1] })).discountAutomaticBulkDelete.userErrors).toEqual([]);
    expect((await del('discountAutomaticBulkDelete', { search: 'title:Auto*' })).discountAutomaticBulkDelete.userErrors).toEqual([]);
    expect((await g(`{ automaticDiscounts(first: 10) { nodes { __typename } } }`)).automaticDiscounts.nodes).toEqual([]);
    expect(auto2).toBeTruthy();
  });
});
