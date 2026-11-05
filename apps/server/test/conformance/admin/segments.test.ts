import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, SETUP_BODY, type TestApp } from '../../../src/test-utils';
import { makeGql } from '../helpers';

let t: TestApp;
let gql: ReturnType<typeof makeGql>;

beforeAll(async () => {
  t = await createTestApp();
  const setup = await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: SETUP_BODY });
  gql = makeGql(t.app, setup.cookies.find((c) => c.name === 'shopme_session')!.value);
}, 90_000);
afterAll(async () => { await t.close(); });

describe('Admin GraphQL: customer segments (ShopMe extension)', () => {
  it('creates, counts, updates and deletes a segment', async () => {
    for (const c of [{ email: 'a@example.com', emailMarketingConsent: { marketingState: 'SUBSCRIBED', marketingOptInLevel: 'SINGLE_OPT_IN' }, tags: ['vip'] }, { email: 'b@example.com' }, { email: 'c@example.com', emailMarketingConsent: { marketingState: 'SUBSCRIBED', marketingOptInLevel: 'SINGLE_OPT_IN' } }]) {
      const r = await gql(`mutation($i: CustomerInput!) { customerCreate(input: $i) { userErrors { message } } }`, { i: c });
      expect(r.errors, JSON.stringify(r.errors)).toBeUndefined(); expect(r.data.customerCreate.userErrors).toEqual([]);
    }
    expect((await gql(`{ shopmeCustomerSegments { id } }`)).data.shopmeCustomerSegments).toEqual([]);

    const created = await gql(`mutation { shopmeCustomerSegmentCreate(name: " Subscribers ", query: "accepts_marketing:true") { segment { id name query customersCount { count } } userErrors { field message } } }`);
    expect(created.errors).toBeUndefined();
    const seg = created.data.shopmeCustomerSegmentCreate.segment;
    expect(seg).toMatchObject({ name: 'Subscribers', query: 'accepts_marketing:true', customersCount: { count: 2 } });
    expect(seg.id).toMatch(/^gid:\/\/shopify\/ShopmeCustomerSegment\/\d+$/);

    const blank = await gql(`mutation { shopmeCustomerSegmentCreate(name: " ", query: "") { segment { id } userErrors { field message } } }`);
    expect(blank.data.shopmeCustomerSegmentCreate).toMatchObject({ segment: null, userErrors: [{ field: ["name"], message: "Name can't be blank" }] });

    const updated = await gql(`mutation($id: ID!) { shopmeCustomerSegmentUpdate(id: $id, query: "accepts_marketing:true tag:vip") { segment { name customersCount { count } } userErrors { message } } }`, { id: seg.id });
    expect(updated.data.shopmeCustomerSegmentUpdate.segment).toEqual({ name: 'Subscribers', customersCount: { count: 1 } });

    const list = await gql(`{ shopmeCustomerSegments { id name } one: shopmeCustomerSegment(id: "${seg.id}") { name } }`);
    expect(list.data.shopmeCustomerSegments).toHaveLength(1);
    expect(list.data.one.name).toBe('Subscribers');

    const gone = await gql(`mutation { shopmeCustomerSegmentDelete(id: "${seg.id}") { deletedSegmentId userErrors { message } } }`);
    expect(gone.data.shopmeCustomerSegmentDelete).toEqual({ deletedSegmentId: seg.id, userErrors: [] });
    const again = await gql(`mutation { shopmeCustomerSegmentDelete(id: "${seg.id}") { deletedSegmentId userErrors { message } } }`);
    expect(again.data.shopmeCustomerSegmentDelete.userErrors[0].message).toBe('Segment does not exist');
    expect((await gql(`{ shopmeCustomerSegments { id } }`)).data.shopmeCustomerSegments).toEqual([]);
  });
});
