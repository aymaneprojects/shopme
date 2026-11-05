import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eraseCustomerPersonalData, processDueCustomerErasures, schema } from '@shopme/core';
import { eq } from 'drizzle-orm';
import { createTestApp, SETUP_BODY, type TestApp } from '../../../src/test-utils';
import { makeGql } from '../helpers';
import { seedCustomer, seedOrder, shopIdOf } from '../seed-sales';

let t: TestApp;
let gql: ReturnType<typeof makeGql>;
let shopId: number;

const ok = async (query: string, variables: Record<string, unknown> = {}) => {
  const r = await gql(query, variables);
  expect(r.errors, JSON.stringify(r.errors)).toBeUndefined();
  return r.data;
};
const gid = (type: string, id: number) => `gid://shopify/${type}/${id}`;

beforeAll(async () => {
  t = await createTestApp();
  const setup = await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: SETUP_BODY });
  gql = makeGql(t.app, setup.cookies.find((c) => c.name === 'shopme_session')!.value);
  shopId = await shopIdOf(t.dbHandle.db);
}, 90_000);
afterAll(async () => { await t.close(); });

describe('customer merge', () => {
  it('previews and merges two customers, moving orders, tags and notes', async () => {
    const db = t.dbHandle.db;
    const one = await seedCustomer(db, shopId, { email: 'one@example.com', firstName: 'Ada', lastName: 'One', tags: ['a'], note: 'first note', phone: null });
    const two = await seedCustomer(db, shopId, { email: 'two@example.com', firstName: 'Bob', lastName: 'Two', tags: ['b'], note: null, phone: '+16135550199' });
    await seedOrder(db, shopId, 101, { customerId: one.id });
    await seedOrder(db, shopId, 102, { customerId: two.id });

    const preview = (await ok(`query($a: ID!, $b: ID!) { shopmeCustomerMergePreview(customerOneId: $a, customerTwoId: $b) { resultingCustomerId blockers fields { firstName email phone tags note } moves { orders addresses } } }`, { a: gid('Customer', one.id), b: gid('Customer', two.id) })).shopmeCustomerMergePreview;
    expect(preview.resultingCustomerId).toBe(gid('Customer', two.id));
    expect(preview.fields).toMatchObject({ firstName: 'Bob', email: 'two@example.com', phone: '+16135550199', tags: ['a', 'b'], note: 'first note' });
    expect(preview.moves).toEqual({ orders: 1, addresses: 1 });

    const same = await gql(`mutation($a: ID!) { customerMerge(customerOneId: $a, customerTwoId: $a) { resultingCustomerId userErrors { message } } }`, { a: gid('Customer', one.id) });
    expect(same.data.customerMerge.userErrors[0].message).toBe('Choose two different customers');

    const merged = (await ok(`mutation($a: ID!, $b: ID!, $o: CustomerMergeOverrideFields) { customerMerge(customerOneId: $a, customerTwoId: $b, overrideFields: $o) { resultingCustomerId userErrors { message } } }`,
      { a: gid('Customer', one.id), b: gid('Customer', two.id), o: { customerIdOfFirstNameToKeep: gid('Customer', one.id), tags: ['x', 'y'] } })).customerMerge;
    expect(merged.userErrors).toEqual([]);
    const c = (await ok(`query($id: ID!) { customer(id: $id) { firstName lastName tags note numberOfOrders addressesV2(first: 5) { nodes { id } } events(first: 5, reverse: true) { nodes { action } } } }`, { id: merged.resultingCustomerId })).customer;
    expect(c).toMatchObject({ firstName: 'Ada', lastName: 'Two', tags: ['x', 'y'], numberOfOrders: '2' });
    expect(c.addressesV2.nodes).toHaveLength(2);
    expect(c.events.nodes.map((e: { action: string }) => e.action)).toContain('customers/merge');
    expect((await ok(`query($id: ID!) { customer(id: $id) { id } }`, { id: gid('Customer', one.id) })).customer).toBeNull();
  });
});

describe('bulk edit', () => {
  it('adds and removes tags, sets consent and appends a note for many customers', async () => {
    const db = t.dbHandle.db;
    const a = await seedCustomer(db, shopId, { email: 'bulk-a@example.com', tags: ['old'], note: 'n', phone: '+16135550111' });
    const b = await seedCustomer(db, shopId, { email: null, tags: ['old'], note: null, phone: null });
    const r = (await ok(`mutation($ids: [ID!]!, $i: ShopmeCustomerBulkInput!) { shopmeCustomerBulkUpdate(customerIds: $ids, input: $i) { updatedCount failures { customerId message } userErrors { message } } }`,
      { ids: [gid('Customer', a.id), gid('Customer', b.id)], i: { addTags: ['new'], removeTags: ['old'], taxExempt: true, emailMarketing: 'SUBSCRIBE', smsMarketing: 'SUBSCRIBE', noteMode: 'APPEND', note: 'added' } })).shopmeCustomerBulkUpdate;
    expect(r.updatedCount).toBe(1);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].customerId).toBe(gid('Customer', b.id));
    const rows = await db.select().from(schema.customers).where(eq(schema.customers.id, a.id));
    expect(rows[0]).toMatchObject({ tags: ['new'], taxExempt: true, emailMarketingState: 'SUBSCRIBED', smsMarketingState: 'SUBSCRIBED', note: 'n\n\nadded' });
  });

  it('accepts an SMS consent on customerCreate', async () => {
    const r = await ok(`mutation { customerCreate(input: { email: "sms@example.com", phone: "+33612345678", smsMarketingConsent: { marketingState: "SUBSCRIBED", marketingOptInLevel: "SINGLE_OPT_IN" } }) { customer { smsMarketingConsent { marketingState } } userErrors { message } } }`);
    expect(r.customerCreate.userErrors).toEqual([]);
    expect(r.customerCreate.customer.smsMarketingConsent.marketingState).toBe('SUBSCRIBED');
  });
});

describe('data request and erasure', () => {
  it('exports the data, schedules and cancels an erasure, then anonymizes and keeps the orders', async () => {
    const db = t.dbHandle.db;
    const c = await seedCustomer(db, shopId, { email: 'erase@example.com', firstName: 'Eve', lastName: 'Erase', note: 'secret' });
    await seedOrder(db, shopId, 110, { customerId: c.id, email: 'erase@example.com' });
    const id = gid('Customer', c.id);

    const exp = (await ok(`mutation($id: ID!) { shopmeCustomerDataRequest(customerId: $id) { data userErrors { message } } }`, { id })).shopmeCustomerDataRequest;
    expect(exp.userErrors).toEqual([]);
    expect(exp.data.customer.email).toBe('erase@example.com');
    expect(exp.data.customer.passwordHash).toBeUndefined();
    expect(exp.data.orders).toHaveLength(1);

    const req = (await ok(`mutation($id: ID!) { customerRequestDataErasure(customerId: $id) { customerId userErrors { message } } }`, { id })).customerRequestDataErasure;
    expect(req).toEqual({ customerId: id, userErrors: [] });
    const twice = (await ok(`mutation($id: ID!) { customerRequestDataErasure(customerId: $id) { userErrors { message } } }`, { id })).customerRequestDataErasure;
    expect(twice.userErrors[0].message).toMatch(/already scheduled/);
    expect((await ok(`query($id: ID!) { customer(id: $id) { shopmeErasureScheduledAt } }`, { id })).customer.shopmeErasureScheduledAt).toBeTruthy();
    expect(await processDueCustomerErasures(db)).toBe(0); // not due yet

    const cancel = (await ok(`mutation($id: ID!) { customerCancelDataErasure(customerId: $id) { customerId userErrors { message } } }`, { id })).customerCancelDataErasure;
    expect(cancel.userErrors).toEqual([]);
    await ok(`mutation($id: ID!) { customerRequestDataErasure(customerId: $id) { userErrors { message } } }`, { id });
    await db.update(schema.customers).set({ erasureScheduledAt: new Date(Date.now() - 1000) }).where(eq(schema.customers.id, c.id));
    expect(await processDueCustomerErasures(db)).toBe(1);

    const after = (await ok(`query($id: ID!) { customer(id: $id) { displayName email note tags shopmeErasedAt orders(first: 5) { nodes { email } } addressesV2(first: 5) { nodes { id } } } }`, { id })).customer;
    expect(after).toMatchObject({ displayName: 'Erased customer', email: null, note: null, tags: [] });
    expect(after.shopmeErasedAt).toBeTruthy();
    expect(after.orders.nodes).toEqual([{ email: null }]);
    expect(after.addressesV2.nodes).toEqual([]);
    expect((await eraseCustomerPersonalData(db, shopId, c.id)).ok).toBe(true); // idempotent
  });
});

describe('companies (B2B)', () => {
  it('creates a company with a location, assigns customers and puts the company on a draft and its order', async () => {
    const db = t.dbHandle.db;
    const buyer = await seedCustomer(db, shopId, { email: 'buyer@acme.test', firstName: 'Bea', lastName: 'Buyer' });
    const created = (await ok(`mutation($i: CompanyCreateInput!) { companyCreate(input: $i) { company { id name locations(first: 5) { nodes { id name buyerExperienceConfiguration { paymentTermsTemplate { days name } } } } } userErrors { field message } } }`,
      { i: { company: { name: 'Acme Corp', externalId: 'ACME-1' }, companyLocation: { paymentTermsDays: 30, taxExempt: true, city: 'Lyon', countryCode: 'fr' } } })).companyCreate;
    expect(created.userErrors).toEqual([]);
    const company = created.company;
    expect(company.locations.nodes[0].name).toBe('Acme Corp');
    expect(company.locations.nodes[0].buyerExperienceConfiguration.paymentTermsTemplate).toEqual({ days: 30, name: 'Net 30' });

    const dup = (await ok(`mutation { companyCreate(input: { company: { name: "Other", externalId: "ACME-1" } }) { company { id } userErrors { field message } } }`)).companyCreate;
    expect(dup.company).toBeNull();
    expect(dup.userErrors[0].message).toMatch(/already been taken/);

    const assign = (await ok(`mutation($c: ID!, $u: ID!) { companyAssignCustomerAsContact(companyId: $c, customerId: $u) { companyContact { id isMainContact customer { displayName } } userErrors { message } } }`, { c: company.id, u: gid('Customer', buyer.id) })).companyAssignCustomerAsContact;
    expect(assign.companyContact).toMatchObject({ isMainContact: true, customer: { displayName: 'Bea Buyer' } });
    const again = (await ok(`mutation($c: ID!, $u: ID!) { companyAssignCustomerAsContact(companyId: $c, customerId: $u) { userErrors { message } } }`, { c: company.id, u: gid('Customer', buyer.id) })).companyAssignCustomerAsContact;
    expect(again.userErrors[0].message).toMatch(/already a contact/);

    const loc2 = (await ok(`mutation($c: ID!) { companyLocationCreate(companyId: $c, input: { name: "Paris site", paymentTermsDays: 0 }) { companyLocation { id } userErrors { message } } }`, { c: company.id })).companyLocationCreate;
    expect(loc2.userErrors).toEqual([]);

    // draft with the company, completed into an order that keeps it
    const draft = (await ok(`mutation { draftOrderCreate(input: { email: "buyer@acme.test", lineItems: [{ title: "Custom", quantity: 1, originalUnitPrice: "10.00" }] }) { draftOrder { id } userErrors { message } } }`)).draftOrderCreate.draftOrder;
    const set = (await ok(`mutation($d: ID!, $c: ID!, $l: ID!) { shopmeDraftOrderSetCompany(draftOrderId: $d, companyId: $c, companyLocationId: $l) { draftOrderId userErrors { message } } }`, { d: draft.id, c: company.id, l: loc2.companyLocation.id })).shopmeDraftOrderSetCompany;
    expect(set.userErrors).toEqual([]);
    const done = (await ok(`mutation($d: ID!) { draftOrderComplete(id: $d) { draftOrder { order { id shopmePurchasingCompany { company { name } location { name } } } } userErrors { message } } }`, { d: draft.id })).draftOrderComplete;
    expect(done.userErrors).toEqual([]);
    expect(done.draftOrder.order.shopmePurchasingCompany).toEqual({ company: { name: 'Acme Corp' }, location: { name: 'Paris site' } });

    const list = (await ok(`{ companies(first: 10, query: "acme") { nodes { name ordersCount { count } contactsCount { count } locationsCount { count } } } companiesCount { count } }`));
    expect(list.companies.nodes[0]).toMatchObject({ name: 'Acme Corp', ordersCount: { count: 1 }, contactsCount: { count: 1 }, locationsCount: { count: 2 } });
    expect((await ok(`{ customers(first: 5, query: "company:acme") { nodes { id } } }`)).customers.nodes).toHaveLength(1);

    const lastLoc = await gql(`mutation($l: ID!) { companyLocationDelete(companyLocationId: $l) { userErrors { message } } }`, { l: loc2.companyLocation.id });
    expect(lastLoc.data.companyLocationDelete.userErrors[0].message).toMatch(/orders/);
    const del = (await ok(`mutation($c: ID!) { companyDelete(id: $c) { deletedCompanyId userErrors { message } } }`, { c: company.id })).companyDelete;
    expect(del.deletedCompanyId).toBe(company.id);
  });
});

describe('segments search', () => {
  it('supports the abandoned checkout search term and spending filters', async () => {
    const r = await ok(`{ a: customersCount(query: "abandoned_checkout_in_last:30d") { count } b: customersCount(query: "amount_spent:>1") { count } c: customersCount(query: "company:false") { count } }`);
    expect(r.a.count).toBe(0);
    expect(r.b.count).toBeGreaterThanOrEqual(1);
    expect(r.c.count).toBeGreaterThanOrEqual(1);
  });
});
