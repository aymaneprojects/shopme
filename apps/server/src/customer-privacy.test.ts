import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  builtinPolicy, CONSENT_COOKIE, confirmSubscription, consentAnswer, createLocalStorage, decodeConsentCookie, encodeConsentCookie, getPrimaryShop, pixelMayRun, policyFor, resolveVisitorConsent, schema as s, seedDemo,
  type Mail, type PrivacySettings, type RegionPolicy,
} from '@shopme/core';
import { createTestApp, SETUP_BODY, type TestApp } from './test-utils';
import { makeGql, makeGqlOk } from '../test/conformance/helpers';

const AUTO: PrivacySettings = { mode: 'AUTO', cookieBanner: { mode: 'AUTO', message: 'm', position: 'bottom' }, dataSaleOptOutPage: 'AUTO', doubleOptIn: false };
const MANUAL: PrivacySettings = { ...AUTO, mode: 'MANUAL' };
const policyRow = (countryCode: string | null, regionCode: string | null, consentRequired: boolean, dataSaleOptOutRequired = false) => ({ countryCode, regionCode, consentRequired, dataSaleOptOutRequired });
const cookieOf = (o: Partial<{ analytics: string; marketing: string; preferences: string; saleOfData: string; ts: number }>) =>
  decodeConsentCookie(encodeConsentCookie({ v: 1, analytics: 'yes', marketing: 'yes', preferences: 'yes', saleOfData: 'yes', ts: 10, ...o } as never));

describe('consent policy and resolution (pure rules)', () => {
  it('looks policies up by country and region, with the manual list taking precedence over the table', () => {
    expect(policyFor(AUTO, [], 'FR').consentRequired).toBe(true);
    expect(policyFor(AUTO, [], 'GB').consentRequired).toBe(true);
    expect(policyFor(AUTO, [], 'US', 'CA')).toMatchObject({ consentRequired: false, dataSaleOptOutRequired: true });
    expect(policyFor(AUTO, [], 'US', 'NY').dataSaleOptOutRequired).toBe(false);
    expect(policyFor(AUTO, [], 'BR').level).toBe('NOTICE');
    expect(policyFor(AUTO, [], 'JP', null).consentRequired).toBe(false);
    const rows = [policyRow(null, null, false), policyRow('FR', null, true), policyRow('FR', 'BRE', false), policyRow('US', 'CA', false, true)];
    expect(policyFor(MANUAL, rows, 'FR', 'BRE').consentRequired).toBe(false); // country + region wins
    expect(policyFor(MANUAL, rows, 'FR', 'IDF').consentRequired).toBe(true); // then the country
    expect(policyFor(MANUAL, rows, 'DE').consentRequired).toBe(false); // then the default row
    expect(policyFor(MANUAL, [policyRow('DE', null, true)], 'FR').consentRequired).toBe(false); // nothing matches: not required
    expect(policyFor(MANUAL, rows, 'US', 'CA').dataSaleOptOutRequired).toBe(true);
    expect(builtinPolicy(null).consentRequired).toBe(false);
  });

  const resolve = (policy: RegionPolicy, cookie: ReturnType<typeof cookieOf>, extra: Partial<Parameters<typeof resolveVisitorConsent>[0]> = {}) =>
    resolveVisitorConsent({ bannerMode: 'AUTO', policy, cookie, ...extra });

  it('denies tracking until the visitor accepts where consent is required, and treats it as granted elsewhere', () => {
    const eu = builtinPolicy('DE');
    const none = resolve(eu, null);
    expect(none.shouldShowBanner).toBe(true);
    expect(none.allowed).toMatchObject({ analytics: false, marketing: false, preferences: false });
    const yes = resolve(eu, cookieOf({}));
    expect(yes.shouldShowBanner).toBe(false);
    expect(yes.allowed).toMatchObject({ analytics: true, marketing: true });
    const partial = resolve(eu, cookieOf({ marketing: 'no' }));
    expect(partial.allowed).toMatchObject({ analytics: true, marketing: false });
    expect(resolve(eu, cookieOf({ marketing: '' })).shouldShowBanner).toBe(true); // an unanswered category asks again

    const us = builtinPolicy('US', 'TX');
    expect(resolve(us, null).shouldShowBanner).toBe(false);
    expect(resolve(us, null).allowed.analytics).toBe(true);
    expect(resolve(us, cookieOf({ analytics: 'no' })).allowed.analytics).toBe(false); // a refusal is honoured everywhere
    expect(resolve(builtinPolicy('BR'), null).shouldShowBanner).toBe(true); // notice level
  });

  it('banner modes: always asks, off treats everything as granted', () => {
    const eu = builtinPolicy('FR');
    expect(resolve(builtinPolicy('US', 'NY'), null, { bannerMode: 'ALWAYS' }).shouldShowBanner).toBe(true);
    expect(resolve(builtinPolicy('US', 'NY'), cookieOf({}), { bannerMode: 'ALWAYS' }).shouldShowBanner).toBe(false);
    const off = resolve(eu, null, { bannerMode: 'OFF' });
    expect(off.shouldShowBanner).toBe(false);
    expect(off.allowed.analytics).toBe(true);
  });

  it('versions the cookie, prefers a newer customer copy and maps GPC to the data-sale opt-out only', () => {
    expect(decodeConsentCookie(encodeURIComponent(JSON.stringify({ v: 99, analytics: 'yes' })))).toBeNull();
    expect(decodeConsentCookie('not json')).toBeNull();
    expect(decodeConsentCookie(JSON.stringify({ v: 1, analytics: 'yes', marketing: 'x', preferences: 'no', saleOfData: '', ts: 5 }))).toMatchObject({ analytics: 'yes', marketing: '', preferences: 'no' });
    const eu = builtinPolicy('FR');
    const copy = cookieOf({ analytics: 'yes', ts: 50 });
    expect(resolve(eu, cookieOf({ analytics: 'no', ts: 10 }), { customerConsent: copy }).allowed.analytics).toBe(true); // newer copy wins
    expect(resolve(eu, cookieOf({ analytics: 'no', ts: 90 }), { customerConsent: copy }).allowed.analytics).toBe(false);
    const ca = builtinPolicy('US', 'CA');
    const gpc = resolve(ca, cookieOf({}), { gpc: true });
    expect(gpc.allowed.saleOfData).toBe(false);
    expect(gpc.saleOfData).toBe('no');
    expect(gpc.allowed.analytics).toBe(true); // GPC is not a denial of analytics
    expect(resolve(builtinPolicy('FR'), cookieOf({}), { gpc: true }).allowed.saleOfData).toBe(true); // only where the opt-out is required
    expect(resolve(ca, cookieOf({}), { customerOptOut: true }).allowed.saleOfData).toBe(false);
    expect(consentAnswer(cookieOf({ marketing: 'no' }), { analytics: true }, 'FR', 7)).toMatchObject({ analytics: 'yes', marketing: 'no', ts: 7 });
  });

  it('runs a pixel only when every required category is allowed (and the sale opt-out is respected)', () => {
    const base = resolve(builtinPolicy('FR'), cookieOf({ marketing: 'no' }));
    expect(pixelMayRun({ requiredConsent: ['analytics'], respectSaleOptOut: true }, base)).toBe(true);
    expect(pixelMayRun({ requiredConsent: ['analytics', 'marketing'], respectSaleOptOut: true }, base)).toBe(false);
    expect(pixelMayRun({ requiredConsent: [], respectSaleOptOut: true }, resolve(builtinPolicy('FR'), null))).toBe(true); // no category: runs for everyone
    const optedOut = resolve(builtinPolicy('US', 'CA'), cookieOf({ saleOfData: 'no' }));
    expect(pixelMayRun({ requiredConsent: [], respectSaleOptOut: true }, optedOut)).toBe(false);
    expect(pixelMayRun({ requiredConsent: [], respectSaleOptOut: false }, optedOut)).toBe(true);
  });
});

describe('customer privacy on the storefront', () => {
  let t: TestApp;
  let g: ReturnType<typeof makeGqlOk>;
  let owner: string;
  let shopId: number;
  let sent: Mail[];
  const db = () => t.dbHandle.db;

  beforeAll(async () => {
    t = await createTestApp();
    const setup = await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: SETUP_BODY });
    owner = setup.cookies.find((c) => c.name === 'shopme_session')!.value;
    g = makeGqlOk(makeGql(t.app, owner));
    await seedDemo(db(), createLocalStorage(mkdtempSync(path.join(tmpdir(), 'priv-'))));
    shopId = (await getPrimaryShop(db()))!.id;
    sent = [];
    t.app.ctx.mailer = { send: async (m) => { sent.push(m); } };
  }, 90_000);
  afterAll(async () => { await t.close(); });

  const page = (url = '/', headers: Record<string, string> = {}, cookies: Record<string, string> = {}) => t.app.inject({ url, headers, cookies });
  const config = (html: string) => JSON.parse(/<script type="application\/json" id="shopme-privacy-config">(.*?)<\/script>/s.exec(html)![1]!) as Record<string, any>;
  const cookie = (o: object) => encodeURIComponent(JSON.stringify({ v: 1, analytics: 'yes', marketing: 'yes', preferences: 'yes', saleOfData: 'yes', ts: 10, ...o }));

  it('puts the consent runtime and a region-driven configuration in every page, with the Aurora banner markup', async () => {
    const fr = await page(); // the shop is in France: consent required
    expect(fr.body).toContain('/.shopme/runtime.js');
    expect(fr.body).toContain('data-consent-banner');
    expect(fr.body).toContain('data-consent-accept');
    const cfg = config(fr.body);
    expect(cfg.policy).toMatchObject({ consentRequired: true, bannerMode: 'AUTO', gpc: false });
    expect(cfg.endpoints.events).toBe('/.shopme/events');
    expect(cfg.pixels).toEqual([]);
    const us = config((await page('/', { 'cf-ipcountry': 'US', 'cf-region-code': 'NY' })).body);
    expect(us.policy).toMatchObject({ consentRequired: false, dataSaleOptOutRequired: false });
    const ca = config((await page('/', { 'cf-ipcountry': 'US', 'cf-region-code': 'CA', 'sec-gpc': '1' })).body);
    expect(ca.policy).toMatchObject({ dataSaleOptOutRequired: true, gpc: true });
    const runtime = await t.app.inject('/.shopme/runtime.js');
    expect(runtime.statusCode).toBe(200);
    expect(runtime.headers['content-type']).toContain('javascript');
    expect(runtime.body).toContain('customerPrivacy');
  });

  it('serves the resolved consent state for headless storefronts and records answers', async () => {
    const state = (await page('/.shopme/consent.json')).json();
    expect(state).toMatchObject({ shouldShowBanner: true, consentRequired: true, consent: { analytics: '', allowed: { analytics: false } } });
    const answer = await t.app.inject({ method: 'POST', url: '/.shopme/consent', payload: { analytics: true, marketing: false, preferences: true, sale_of_data: true } });
    expect(answer.statusCode).toBe(200);
    const set = answer.cookies.find((c) => c.name === CONSENT_COOKIE)!;
    expect(decodeConsentCookie(set.value)).toMatchObject({ analytics: 'yes', marketing: 'no', preferences: 'yes' });
    const after = (await page('/.shopme/consent.json', {}, { [CONSENT_COOKIE]: set.value })).json();
    expect(after).toMatchObject({ shouldShowBanner: false, consent: { allowed: { analytics: true, marketing: false } } });
  });

  it('stores first-party events only with analytics consent, once per event id', async () => {
    const events = [{ id: 'e1', name: 'page_viewed', data: {}, timestamp: new Date().toISOString() }, { id: 'e2', name: 'product_viewed', data: { productVariant: { id: '1' } } }, { id: 'e3', name: 'not_standard' }];
    const count = async () => (await db().select().from(s.storefrontEvents)).length;
    const none = await t.app.inject({ method: 'POST', url: '/.shopme/events', payload: { events } });
    expect(none.statusCode).toBe(204);
    expect(await count()).toBe(0); // no consent in a region that requires it
    const no = await t.app.inject({ method: 'POST', url: '/.shopme/events', payload: { events }, cookies: { [CONSENT_COOKIE]: cookie({ analytics: 'no' }) } });
    expect(no.statusCode).toBe(204);
    expect(await count()).toBe(0);
    const yes = await t.app.inject({ method: 'POST', url: '/.shopme/events', payload: { events }, cookies: { [CONSENT_COOKIE]: cookie({}) } });
    expect(yes.statusCode).toBe(204);
    expect(await count()).toBe(2); // the unknown event name is dropped
    await t.app.inject({ method: 'POST', url: '/.shopme/events', payload: { events }, cookies: { [CONSENT_COOKIE]: cookie({}) } });
    expect(await count()).toBe(2); // duplicates are ignored
    const counts = await g('{ shopmeStorefrontEventCounts(days: 7) { name count } }');
    expect(counts.shopmeStorefrontEventCounts).toContainEqual({ name: 'page_viewed', count: 1 });
  });

  it('counts visits only where analytics may run', async () => {
    const visits = async () => { await new Promise((r) => setTimeout(r, 200)); return (await db().select().from(s.visits)).length; }; // stored after the reply
    const before = await visits();
    await page('/', { 'user-agent': 'Mozilla/5.0 Firefox' });
    await t.app.inject({ url: '/', headers: { 'user-agent': 'Mozilla/5.0 Firefox' } });
    expect(await visits()).toBe(before); // France, no consent yet
    await t.app.inject({ url: '/', headers: { 'user-agent': 'Mozilla/5.0 Firefox' }, cookies: { [CONSENT_COOKIE]: cookie({}) } });
    expect(await visits()).toBe(before + 1);
    await t.app.inject({ url: '/', headers: { 'user-agent': 'Mozilla/5.0 Firefox', 'cf-ipcountry': 'US', 'cf-region-code': 'NY' } });
    expect(await visits()).toBe(before + 2); // not required in New York
  });

  describe('data-sale opt-out', () => {
    it('shows the footer link and the page only in regions that need them, and flags the customer', async () => {
      const ca = { 'cf-ipcountry': 'US', 'cf-region-code': 'CA' };
      const home = await page('/', ca);
      expect(home.body).toContain('/pages/data-sale-opt-out');
      expect((await page('/', { 'cf-ipcountry': 'US', 'cf-region-code': 'NY' })).body).not.toContain('Do not sell or share');
      expect((await page('/pages/data-sale-opt-out', ca)).statusCode).toBe(200);
      const post = await t.app.inject({ method: 'POST', url: '/pages/data-sale-opt-out', headers: { ...ca, 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams({ email: 'Optout@Example.com' }).toString() });
      expect(post.statusCode).toBe(303);
      const [c] = await db().select().from(s.customers).where(eq(s.customers.email, 'optout@example.com'));
      expect(c!.dataSaleOptOut).toBe(true);
      expect(decodeConsentCookie(post.cookies.find((x) => x.name === CONSENT_COOKIE)!.value)).toMatchObject({ saleOfData: 'no' });
      const bad = await t.app.inject({ method: 'POST', url: '/pages/data-sale-opt-out', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams({ email: 'nope' }).toString() });
      expect(bad.statusCode).toBe(200);
      expect(bad.body).toContain('role="alert"');
      const viaApi = await g('mutation { dataSaleOptOut(email: "second@example.com") { customerId userErrors { code } } }');
      expect(viaApi.dataSaleOptOut.userErrors).toEqual([]);
      const read = await g(`{ customer(id: "${viaApi.dataSaleOptOut.customerId}") { dataSaleOptOut } }`);
      expect(read.customer.dataSaleOptOut).toBe(true);
      const failed = await g('mutation { dataSaleOptOut(email: "bad") { customerId userErrors { code } } }');
      expect(failed.dataSaleOptOut.userErrors[0].code).toBe('FAILED');
    });

    it('can be switched off', async () => {
      await g('mutation { shopmePrivacySettingsUpdate(input: { dataSaleOptOutPage: OFF }) { settings { dataSaleOptOutPage } userErrors { message } } }');
      expect((await page('/pages/data-sale-opt-out', { 'cf-ipcountry': 'US', 'cf-region-code': 'CA' })).statusCode).toBe(404);
      await g('mutation { shopmePrivacySettingsUpdate(input: { dataSaleOptOutPage: AUTO }) { settings { dataSaleOptOutPage } userErrors { message } } }');
    });

    it('treats a signed-in customer opt-out and the GPC header as a refusal of data sale', async () => {
      const ca = { 'cf-ipcountry': 'US', 'cf-region-code': 'CA' };
      const state = (await page('/.shopme/consent.json', { ...ca, 'sec-gpc': '1' }, { [CONSENT_COOKIE]: cookie({}) })).json();
      expect(state.consent.sale_of_data).toBe('no');
      expect(state.consent.allowed.saleOfData).toBe(false);
    });
  });

  describe('privacy settings and consent policies in the Admin API', () => {
    it('reads and updates the privacy settings and the manual consent rules', async () => {
      const r = await g(`{ privacySettings { banner { enabled autoManaged } dataSaleOptOutPage { autoManaged } privacyPolicy { autoManaged supportedLocales } } consentPolicyRegions { countryCode regionCode } shopmePrivacySettings { mode regions { reviewedAt } } }`);
      expect(r.privacySettings.banner).toEqual({ enabled: true, autoManaged: true });
      expect(r.consentPolicyRegions.length).toBeGreaterThan(20);
      expect(r.shopmePrivacySettings.mode).toBe('AUTO');
      const upd = await g(`mutation { consentPolicyUpdate(consentPolicies: [{ countryCode: FR, consentRequired: false }, { countryCode: US, regionCode: "CA", consentRequired: false, dataSaleOptOutRequired: true }]) { updatedPolicies { countryCode regionCode consentRequired } userErrors { code field } } }`);
      expect(upd.consentPolicyUpdate.userErrors).toEqual([]);
      expect(upd.consentPolicyUpdate.updatedPolicies).toHaveLength(2);
      // manual mode: France no longer needs consent
      expect(config((await page()).body).policy.consentRequired).toBe(false);
      const missing = await g(`mutation { consentPolicyUpdate(consentPolicies: [{ regionCode: "CA", consentRequired: true }]) { userErrors { code } } }`);
      expect(missing.consentPolicyUpdate.userErrors[0].code).toBe('COUNTRY_CODE_REQUIRED');
      const one = await g(`{ consentPolicy(countryCode: FR) { countryCode consentRequired } }`);
      expect(one.consentPolicy).toEqual([{ countryCode: 'FR', consentRequired: false }]);
      await g(`mutation { shopmePrivacySettingsUpdate(input: { mode: AUTO }) { settings { mode } userErrors { message } } }`);
      expect(config((await page()).body).policy.consentRequired).toBe(true);
      const off = await g(`mutation { privacyFeaturesDisable(featuresToDisable: [COOKIE_BANNER]) { featuresDisabled userErrors { message } } }`);
      expect(off.privacyFeaturesDisable.featuresDisabled).toEqual(['COOKIE_BANNER']);
      expect(config((await page()).body).policy.bannerMode).toBe('OFF');
      expect((await page('/.shopme/consent.json')).json().consent.allowed.analytics).toBe(true); // off: everything granted
      await g(`mutation { shopmePrivacySettingsUpdate(input: { cookieBanner: { mode: AUTO } }) { settings { mode } userErrors { message } } }`);
    });

    it('keeps the legacy cookie banner switch working (always show)', async () => {
      await g('mutation { shopmeCookieBannerUpdate(enabled: true) { cookieBanner { enabled } } }');
      expect((await g('{ shopmePrivacySettings { cookieBanner { mode } } }')).shopmePrivacySettings.cookieBanner.mode).toBe('ALWAYS');
      const cfg = config((await page('/', { 'cf-ipcountry': 'US', 'cf-region-code': 'NY' })).body);
      expect(cfg.policy.bannerMode).toBe('ALWAYS');
      await g('mutation { shopmeCookieBannerUpdate(enabled: false) { cookieBanner { enabled } } }');
    });
  });

  describe('marketing consent', () => {
    it('moves through the consent states with Admin API validation', async () => {
      const [c] = await db().insert(s.customers).values({ shopId, email: 'consent@example.com' }).returning();
      const id = `gid://shopify/Customer/${c!.id}`;
      const upd = (state: string, level = 'SINGLE_OPT_IN') => g(`mutation { customerEmailMarketingConsentUpdate(input: { customerId: "${id}", emailMarketingConsent: { marketingState: ${state}, marketingOptInLevel: ${level} } }) { customer { emailMarketingConsent { marketingState marketingOptInLevel } defaultEmailAddress { marketingState } } userErrors { field code } } }`);
      expect((await upd('SUBSCRIBED')).customerEmailMarketingConsentUpdate.customer.emailMarketingConsent).toEqual({ marketingState: 'SUBSCRIBED', marketingOptInLevel: 'SINGLE_OPT_IN' });
      expect((await upd('UNSUBSCRIBED')).customerEmailMarketingConsentUpdate.customer.defaultEmailAddress.marketingState).toBe('UNSUBSCRIBED');
      expect((await upd('PENDING', 'CONFIRMED_OPT_IN')).customerEmailMarketingConsentUpdate.customer.emailMarketingConsent.marketingState).toBe('PENDING');
      expect((await upd('PENDING', 'SINGLE_OPT_IN')).customerEmailMarketingConsentUpdate.userErrors[0].code).toBe('INVALID');
      const row = async () => (await db().select().from(s.customers).where(eq(s.customers.id, c!.id)))[0]!;
      expect((await row()).acceptsMarketing).toBe(false);
      await upd('SUBSCRIBED');
      expect((await row()).acceptsMarketing).toBe(true); // the boolean stays in step
      const noPhone = await g(`mutation { customerSmsMarketingConsentUpdate(input: { customerId: "${id}", smsMarketingConsent: { marketingState: SUBSCRIBED } }) { userErrors { code } } }`);
      expect(noPhone.customerSmsMarketingConsentUpdate.userErrors[0].code).toBe('INVALID');
      const bad = await g(`mutation { customerEmailMarketingConsentUpdate(input: { customerId: "gid://shopify/Customer/999999", emailMarketingConsent: { marketingState: SUBSCRIBED } }) { userErrors { code } } }`);
      expect(bad.customerEmailMarketingConsentUpdate.userErrors[0].code).toBe('INVALID');
    });

    const subscribe = (email: string) => t.app.inject({ method: 'POST', url: '/contact', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams({ form_type: 'customer', 'contact[email]': email, 'contact[tags]': 'newsletter' }).toString() });
    const stateOf = async (email: string) => (await db().select().from(s.customers).where(eq(s.customers.email, email)))[0];

    it('subscribes at once without double opt-in', async () => {
      await subscribe('single@example.com');
      expect(await stateOf('single@example.com')).toMatchObject({ emailMarketingState: 'SUBSCRIBED', emailMarketingOptInLevel: 'SINGLE_OPT_IN', acceptsMarketing: true });
    });

    it('only redirects form posts to local paths (a backslash is not one)', async () => {
      const post = (return_to: string) => t.app.inject({ method: 'POST', url: '/contact', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams({ form_type: 'customer', 'contact[email]': 'redirect@example.com', return_to }).toString() });
      expect(String((await post('/\\evil.example')).headers.location)).toMatch(/^\/(\?|#|$)/);
      expect(String((await post('//evil.example')).headers.location)).toMatch(/^\/(\?|#|$)/);
      expect(String((await post('/pages/about')).headers.location)).toMatch(/^\/pages\/about\?/);
    });

    it('keeps the newsletter subscription pending until the emailed link is opened (double opt-in)', async () => {
      await g('mutation { shopmePrivacySettingsUpdate(input: { doubleOptIn: true }) { settings { doubleOptIn } userErrors { message } } }');
      sent.length = 0;
      await subscribe('double@example.com');
      await t.app.ctx.queue.idle();
      expect(await stateOf('double@example.com')).toMatchObject({ emailMarketingState: 'PENDING', emailMarketingOptInLevel: 'CONFIRMED_OPT_IN', acceptsMarketing: false });
      const mail = sent.find((m) => m.to === 'double@example.com')!;
      const link = /\/account\/subscribe\/confirm\/(\d+)\/([\w-]+)/.exec(mail.text)!;
      expect(link).toBeTruthy();
      const bad = await page(`/account/subscribe/confirm/${link[1]}/wrong`);
      expect(bad.statusCode).toBe(410);
      expect((await stateOf('double@example.com'))!.emailMarketingState).toBe('PENDING');
      const ok = await page(link[0]);
      expect(ok.statusCode).toBe(200);
      expect(await stateOf('double@example.com')).toMatchObject({ emailMarketingState: 'SUBSCRIBED', emailMarketingOptInLevel: 'CONFIRMED_OPT_IN', acceptsMarketing: true });
      expect((await page(link[0])).statusCode).toBe(410); // the link works once
      expect(await confirmSubscription(db(), shopId, Number(link[1]), link[2]!)).toBeNull();
    });

    it('applies double opt-in to the checkout marketing box', async () => {
      const sku = (await db().select().from(s.productVariants).where(eq(s.productVariants.sku, 'HEB-250')))[0]!;
      const add = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: sku.id, quantity: 1 } });
      const cart = add.cookies.find((c) => c.name === 'cart')!.value;
      const token = (await t.app.inject({ method: 'POST', url: '/checkout', cookies: { cart } })).headers.location!.toString().split('/').pop()!;
      sent.length = 0;
      const done = await t.app.inject({
        method: 'POST', url: `/checkouts/${token}/complete`, headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({ email: 'checkout-optin@example.com', firstName: 'A', lastName: 'B', address1: '1 rue', city: 'Paris', zip: '75001', countryCode: 'FR', paymentMethod: 'bank_transfer', acceptsMarketing: '1' }).toString(),
      });
      expect(done.statusCode).toBe(303);
      await t.app.ctx.queue.idle();
      expect(await stateOf('checkout-optin@example.com')).toMatchObject({ emailMarketingState: 'PENDING', acceptsMarketing: false });
      expect(sent.some((m) => m.to === 'checkout-optin@example.com' && /subscribe\/confirm/.test(m.text))).toBe(true);
      await g('mutation { shopmePrivacySettingsUpdate(input: { doubleOptIn: false }) { settings { doubleOptIn } userErrors { message } } }');
    });
  });

  describe('pixels', () => {
    it('keeps merchant code out of the page and serves it only as a sandboxed document for connected pixels', async () => {
      const code = 'analytics.subscribe("page_viewed", function (e) { console.log("SECRET_PIXEL_CODE", e.name); });';
      const made = await g(`mutation($code: String) { shopmeCustomPixelCreate(input: { name: "Test pixel", code: $code, requiredConsent: [analytics], respectSaleOptOut: true }) { pixel { id connected requiredConsent } userErrors { field message } } }`, { code });
      const pixel = made.shopmeCustomPixelCreate.pixel;
      expect(pixel).toMatchObject({ connected: false, requiredConsent: ['analytics'] });
      const numeric = pixel.id.split('/').pop();
      expect((await page(`/.shopme/pixels/${numeric}`)).statusCode).toBe(404); // not connected
      const connect = await g(`mutation { shopmeCustomPixelConnect(id: "${pixel.id}") { pixel { connected } userErrors { message } } }`);
      expect(connect.shopmeCustomPixelConnect.pixel.connected).toBe(true);

      const home = await page();
      expect(home.body).not.toContain('SECRET_PIXEL_CODE');
      expect(config(home.body).pixels).toEqual([{ id: Number(numeric), name: 'Test pixel', requiredConsent: ['analytics'], respectSaleOptOut: true, domEvents: false, settings: {} }]);
      const doc = await page(`/.shopme/pixels/${numeric}`);
      expect(doc.statusCode).toBe(200);
      expect(String(doc.headers['content-security-policy'])).toContain('sandbox allow-scripts');
      expect(String(doc.headers['content-security-policy'])).not.toContain('allow-same-origin');
      expect(doc.body).toContain('SECRET_PIXEL_CODE');
      expect(doc.body).toContain('analytics.subscribe'.slice(0, 9));

      const toolong = await g(`mutation($code: String) { shopmeCustomPixelUpdate(id: "${pixel.id}", input: { code: $code }) { pixel { id } userErrors { message } } }`, { code: 'x'.repeat(256 * 1024 + 1) });
      expect(toolong.shopmeCustomPixelUpdate.userErrors[0].message).toMatch(/256 KB/);
      const noName = await g(`mutation { shopmeCustomPixelCreate(input: { code: "1" }) { pixel { id } userErrors { message } } }`);
      expect(noName.shopmeCustomPixelCreate.userErrors[0].message).toMatch(/blank/);

      await g(`mutation { shopmeCustomPixelDisconnect(id: "${pixel.id}") { pixel { connected } userErrors { message } } }`);
      expect((await page(`/.shopme/pixels/${numeric}`)).statusCode).toBe(404);
      expect(config((await page()).body).pixels).toEqual([]);
      const del = await g(`mutation { shopmeCustomPixelDelete(id: "${pixel.id}") { deletedPixelId userErrors { message } } }`);
      expect(del.shopmeCustomPixelDelete.deletedPixelId).toBe(pixel.id);
    });

    it('stores web pixel settings through the Admin API names', async () => {
      const made = await g(`mutation($w: WebPixelInput!) { webPixelCreate(webPixel: $w) { webPixel { id settings } userErrors { code field } } }`, { w: { settings: { accountID: '123' } } });
      expect(made.webPixelCreate.webPixel.settings).toEqual({ accountID: '123' });
      const dup = await g(`mutation($w: WebPixelInput!) { webPixelCreate(webPixel: $w) { webPixel { id } userErrors { code } } }`, { w: { settings: {} } });
      expect(dup.webPixelCreate.userErrors[0].code).toBe('TAKEN');
      const upd = await g(`mutation($id: ID!, $w: WebPixelInput!) { webPixelUpdate(id: $id, webPixel: $w) { webPixel { settings } userErrors { code } } }`, { id: made.webPixelCreate.webPixel.id, w: { settings: { accountID: '456' } } });
      expect(upd.webPixelUpdate.webPixel.settings).toEqual({ accountID: '456' });
      expect((await g('{ webPixel { id settings } }')).webPixel.settings).toEqual({ accountID: '456' });
      const del = await g(`mutation { webPixelDelete(id: "${made.webPixelCreate.webPixel.id}") { deletedWebPixelId userErrors { code } } }`);
      expect(del.webPixelDelete.deletedWebPixelId).toBe(made.webPixelCreate.webPixel.id);
      expect((await g(`mutation { webPixelDelete(id: "gid://shopify/WebPixel/9999") { userErrors { code } } }`)).webPixelDelete.userErrors[0].code).toBe('NOT_FOUND');
    });
  });
});

