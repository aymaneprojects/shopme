import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNotNull } from 'drizzle-orm';
import { checkoutSettingsOf, configOf, createLocalStorage, getPrimaryShop, schema as s, seedDemo } from '@shopme/core';
import { createTestApp, SETUP_BODY, type TestApp } from './test-utils';
import { makeGql, makeGqlOk } from '../test/conformance/helpers';

let t: TestApp;
let gql: ReturnType<typeof makeGql>;
let g: ReturnType<typeof makeGqlOk>;
const db = () => t.dbHandle.db;

beforeAll(async () => {
  t = await createTestApp();
  const setup = await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: SETUP_BODY });
  gql = makeGql(t.app, setup.cookies.find((c) => c.name === 'shopme_session')!.value);
  g = makeGqlOk(gql);
  await seedDemo(db(), createLocalStorage(mkdtempSync(path.join(tmpdir(), 'final-'))));
}, 90_000);
afterAll(async () => { await t.close(); });

const CONFIG = 'id name active config settings { company phone marketing nameMode orderNotes tipping { enabled presets } }';

describe('checkout configurations', () => {
  it('lists the default one as active, duplicates, edits, renames and sets another active; the checkout reads the active one', async () => {
    const first = (await g(`{ shopmeCheckoutConfigurations { ${CONFIG} } }`)).shopmeCheckoutConfigurations;
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ id: 'default', active: true });

    const dup = await g(`mutation { shopmeCheckoutConfigurationCreate(name: "Holiday") { configuration { ${CONFIG} } userErrors { field message } } }`);
    expect(dup.shopmeCheckoutConfigurationCreate.userErrors).toEqual([]);
    const holiday = dup.shopmeCheckoutConfigurationCreate.configuration;
    expect(holiday).toMatchObject({ id: 'holiday', name: 'Holiday', active: false });
    expect((await g(`mutation { shopmeCheckoutConfigurationCreate(name: "holiday") { userErrors { message } } }`)).shopmeCheckoutConfigurationCreate.userErrors[0].message).toMatch(/already exists/);

    // Editing a stored configuration leaves what the checkout uses alone.
    const edit = await g(`mutation($c: JSON) { shopmeCheckoutConfigurationUpdate(id: "holiday", settings: { phone: required, tipping: { enabled: true, presets: [10, 20] } }, config: $c) { configuration { ${CONFIG} } userErrors { field message } } }`,
      { c: { addressAutocomplete: true, branding: { accentColor: '#aa2200', backgroundColor: '', logoUrl: '', buttonShape: 'square', headerText: 'Happy holidays', footerText: '' } } });
    expect(edit.shopmeCheckoutConfigurationUpdate.userErrors).toEqual([]);
    const shop0 = (await getPrimaryShop(db()))!;
    expect(checkoutSettingsOf(shop0).phone).not.toBe('required');
    expect(configOf(shop0, 'CHECKOUT').branding.accentColor).toBe('');

    const bad = await g(`mutation { shopmeCheckoutConfigurationUpdate(id: "holiday", settings: { tipping: { enabled: true, presets: [] } }) { userErrors { message } } }`);
    expect(bad.shopmeCheckoutConfigurationUpdate.userErrors.length).toBe(1);

    // Set active: the live checkout settings and look are the configuration's.
    const act = await g(`mutation { shopmeCheckoutConfigurationActivate(id: "holiday") { configuration { id active } userErrors { message } } }`);
    expect(act.shopmeCheckoutConfigurationActivate.configuration).toEqual({ id: 'holiday', active: true });
    const shop1 = (await getPrimaryShop(db()))!;
    expect(checkoutSettingsOf(shop1)).toMatchObject({ phone: 'required', tipping: { enabled: true, presets: [10, 20] } });
    expect(configOf(shop1, 'CHECKOUT').branding).toMatchObject({ accentColor: '#aa2200', headerText: 'Happy holidays', buttonShape: 'square' });
    const live = (await g(`{ shopmeCheckoutSettings { phone tipping { enabled } } }`)).shopmeCheckoutSettings;
    expect(live).toMatchObject({ phone: 'REQUIRED'.toLowerCase(), tipping: { enabled: true } });

    // The previous one was saved back as a snapshot; editing the active one edits the live values.
    const list = (await g(`{ shopmeCheckoutConfigurations { id name active settings { phone } } }`)).shopmeCheckoutConfigurations;
    expect(list.map((c: { id: string; active: boolean }) => [c.id, c.active])).toEqual([['holiday', true], ['default', false]]);
    expect(list[1].settings.phone).not.toBe('required');
    await g(`mutation { shopmeCheckoutConfigurationUpdate(id: "holiday", settings: { company: hidden }) { userErrors { message } } }`);
    expect(checkoutSettingsOf((await getPrimaryShop(db()))!).company).toBe('hidden');

    const ren = await g(`mutation { shopmeCheckoutConfigurationRename(id: "default", name: "Standard") { configuration { id name } userErrors { message } } }`);
    expect(ren.shopmeCheckoutConfigurationRename.configuration).toEqual({ id: 'default', name: 'Standard' });

    // The active one cannot be deleted; an inactive one can.
    expect((await g(`mutation { shopmeCheckoutConfigurationDelete(id: "holiday") { userErrors { message } } }`)).shopmeCheckoutConfigurationDelete.userErrors[0].message).toMatch(/active configuration/);
    expect((await g(`mutation { shopmeCheckoutConfigurationDelete(id: "default") { deletedId userErrors { message } } }`)).shopmeCheckoutConfigurationDelete.deletedId).toBe('default');
    expect((await g(`{ shopmeCheckoutConfigurations { id } }`)).shopmeCheckoutConfigurations).toHaveLength(1);
  });
});

describe('WhatsApp marketing consent', () => {
  it('is stored on a customer with a phone number, exported, filterable and editable in bulk', async () => {
    const r = await g(`mutation { customerCreate(input: { firstName: "Wa", lastName: "Tsapp", email: "wa@example.com", phone: "+33612345678", shopmeWhatsappMarketingConsent: { marketingState: "SUBSCRIBED" } }) {
      customer { id shopmeWhatsappMarketingConsent { marketingState consentUpdatedAt } } userErrors { message } } }`);
    expect(r.customerCreate.userErrors).toEqual([]);
    const c = r.customerCreate.customer;
    expect(c.shopmeWhatsappMarketingConsent.marketingState).toBe('SUBSCRIBED');
    expect(c.shopmeWhatsappMarketingConsent.consentUpdatedAt).toBeTruthy();

    const found = await g(`{ customers(first: 5, query: "whatsapp_subscription:subscribed") { nodes { id } } }`);
    expect(found.customers.nodes.map((n: { id: string }) => n.id)).toContain(c.id);

    const bulk = await g(`mutation($ids: [ID!]!) { shopmeCustomerBulkUpdate(customerIds: $ids, input: { whatsappMarketing: UNSUBSCRIBE }) { updatedCount failures { message } } }`, { ids: [c.id] });
    expect(bulk.shopmeCustomerBulkUpdate).toMatchObject({ updatedCount: 1, failures: [] });
    expect((await g(`{ customer(id: "${c.id}") { shopmeWhatsappMarketingConsent { marketingState } } }`)).customer.shopmeWhatsappMarketingConsent.marketingState).toBe('UNSUBSCRIBED');

    const [row] = await db().select().from(s.customers).where(eq(s.customers.email, 'wa@example.com'));
    expect(row!.whatsappMarketingState).toBe('UNSUBSCRIBED');

    // No phone number: no consent to record.
    const nophone = await g(`mutation { customerCreate(input: { firstName: "No", email: "nophone@example.com" }) { customer { id shopmeWhatsappMarketingConsent { marketingState } } } }`);
    expect(nophone.customerCreate.customer.shopmeWhatsappMarketingConsent).toBeNull();
  });
});

describe('image focal point', () => {
  it('is stored on the media, exposed to the Admin API and applied by the Aurora theme', async () => {
    const { pm, m } = (await db().select({ pm: s.productMedia, m: s.media }).from(s.productMedia).innerJoin(s.media, eq(s.media.id, s.productMedia.mediaId)).where(and(isNotNull(s.media.url), eq(s.media.type, 'IMAGE'))).limit(1))[0]!;
    const [product] = await db().select().from(s.products).where(eq(s.products.id, pm.productId));
    const gid = `gid://shopify/MediaImage/${m.id}`;

    // No focal point yet: the presentation exists and its focal point is null.
    const before = await g(`{ node(id: "${gid}") { ... on MediaImage { image { shopmePresentation { focalPoint { x y } } } } } }`);
    expect(before.node.image.shopmePresentation).toEqual({ focalPoint: null });

    const set = await g(`mutation($f: [FileUpdateInput!]!) { fileUpdate(files: $f) { files { id ... on MediaImage { image { shopmePresentation { focalPoint { x y } } } } } userErrors { message } } }`, { f: [{ id: gid, focalPoint: { x: 30, y: 40.5 } }] });
    expect(set.fileUpdate.userErrors).toEqual([]);
    expect(set.fileUpdate.files[0].image.shopmePresentation.focalPoint).toEqual({ x: 30, y: 40.5 });

    const bad = await gql(`mutation($f: [FileUpdateInput!]!) { fileUpdate(files: $f) { userErrors { message } } }`, { f: [{ id: gid, focalPoint: { x: 130, y: 10 } }] });
    expect(bad.data.fileUpdate.userErrors[0].message).toMatch(/between 0 and 100/);

    // Liquid: image.presentation.focal_point, and the theme positions the cropped image with it.
    const page = await t.app.inject({ method: 'GET', url: `/products/${product!.handle}` });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('object-position: 30% 40.5%');
    const home = await t.app.inject({ method: 'GET', url: '/collections/all' });
    expect(home.body).toContain('object-position: 30% 40.5%');

    const clear = await g(`mutation($f: [FileUpdateInput!]!) { fileUpdate(files: $f) { files { id } userErrors { message } } }`, { f: [{ id: gid, focalPoint: null }] });
    expect(clear.fileUpdate.userErrors).toEqual([]);
    expect((await t.app.inject({ method: 'GET', url: `/products/${product!.handle}` })).body).not.toContain('object-position');
  });
});

describe('per-variant Online Store availability', () => {
  it('hides a variant from the product page and refuses it in the cart while the product stays published', async () => {
    const variants = await db().select().from(s.productVariants);
    const byProduct = new Map<number, typeof variants>();
    for (const v of variants) byProduct.set(v.productId, [...(byProduct.get(v.productId) ?? []), v]);
    const [productId, list] = [...byProduct.entries()].find(([, vs]) => vs.length >= 2)!;
    const [product] = await db().select().from(s.products).where(eq(s.products.id, productId));
    const [hide, keep] = list;
    const hideGid = `gid://shopify/ProductVariant/${hide!.id}`;
    const update = (id: string, hidden: boolean) => g(`mutation($p: ID!, $v: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $p, variants: $v) { productVariants { id shopmeHiddenFromOnlineStore } userErrors { message } } }`,
      { p: `gid://shopify/Product/${productId}`, v: [{ id, shopmeHiddenFromOnlineStore: hidden }] });

    const before = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: hide!.id, quantity: 1 } });
    expect(before.statusCode).toBe(200);

    const r = await update(hideGid, true);
    expect(r.productVariantsBulkUpdate.userErrors).toEqual([]);
    expect(r.productVariantsBulkUpdate.productVariants[0].shopmeHiddenFromOnlineStore).toBe(true);

    const refused = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: hide!.id, quantity: 1 } });
    expect(refused.statusCode).toBe(422);
    const ok = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: keep!.id, quantity: 1 } });
    expect(ok.statusCode).toBe(200);

    const page = await t.app.inject({ method: 'GET', url: `/products/${product!.handle}` });
    expect(page.statusCode).toBe(200);
    // The variant is neither a radio option nor part of the variants JSON the theme script reads.
    expect(page.body).not.toMatch(new RegExp(`"id":${hide!.id},"title":"${hide!.title}"`));
    expect(page.body).toMatch(new RegExp(`"id":${keep!.id},"title":"${keep!.title}"`));

    // The last visible variant cannot be hidden.
    const rest = list.slice(1);
    for (const v of rest.slice(0, -1)) await update(`gid://shopify/ProductVariant/${v.id}`, true);
    const last = await update(`gid://shopify/ProductVariant/${rest.at(-1)!.id}`, true);
    expect(last.productVariantsBulkUpdate.userErrors[0].message).toMatch(/At least one variant/);

    for (const v of list) await update(`gid://shopify/ProductVariant/${v.id}`, false);
    expect((await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: hide!.id, quantity: 1 } })).statusCode).toBe(200);
  });
});
