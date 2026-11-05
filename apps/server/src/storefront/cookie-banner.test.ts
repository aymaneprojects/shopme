import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Shop } from '@shopme/core';
import { createTestApp, setupAndLogin, type TestApp } from '../test-utils';
import { cookieBannerHtml, injectCookieBanner } from './cookie-banner';

const shopLike = (over: Partial<{ locale: string; cookieBanner: unknown }>) => ({ locale: 'en', settings: over.cookieBanner === undefined ? {} : { cookieBanner: over.cookieBanner }, ...over }) as unknown as Shop;

describe('cookieBannerHtml', () => {
  it('is empty when disabled or when the visitor already chose', () => {
    expect(cookieBannerHtml(shopLike({ cookieBanner: { enabled: false, message: 'x' } }))).toBe('');
    expect(cookieBannerHtml(shopLike({ cookieBanner: { enabled: true, message: 'x' } }), 'accepted')).toBe('');
    expect(cookieBannerHtml(shopLike({}))).toBe('');
  });

  it('uses French text for French shops and the merchant message when set', () => {
    const fr = cookieBannerHtml(shopLike({ locale: 'fr-FR', cookieBanner: { enabled: true, message: '' } }));
    expect(fr).toContain('Accepter');
    expect(fr).toContain('Refuser');
    expect(fr).toContain('Nous utilisons des cookies');
    const en = cookieBannerHtml(shopLike({ cookieBanner: { enabled: true, message: 'Our <b>cookies</b>' } }));
    expect(en).toContain('>Accept<');
    expect(en).toContain('Our &lt;b&gt;cookies&lt;/b&gt;');
    expect(en).toContain('role="region"');
  });

  it('injects before </body> and appends otherwise', () => {
    expect(injectCookieBanner('<html><body>hi</body></html>', '<X>')).toBe('<html><body>hi<X></body></html>');
    expect(injectCookieBanner('<p>hi</p>', '<X>')).toBe('<p>hi</p><X>');
    expect(injectCookieBanner('<p>hi</p>', '')).toBe('<p>hi</p>');
  });
});

describe('storefront cookie banner', () => {
  let t: TestApp;
  let owner: string;
  const gql = async (query: string) => (await t.app.inject({ method: 'POST', url: '/admin/api/2026-10/graphql.json', cookies: { shopme_session: owner }, payload: { query } })).json();

  beforeAll(async () => { t = await createTestApp(); owner = await setupAndLogin(t.app); }, 60_000);
  afterAll(async () => { await t.close(); });

  it('renders the banner only while enabled and not yet decided', async () => {
    expect((await t.app.inject('/')).body).not.toContain('shopme-cookie-banner');
    await gql('mutation { shopmeCookieBannerUpdate(enabled: true) { cookieBanner { enabled } } }');
    const page = await t.app.inject('/');
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('id="shopme-cookie-banner"');
    expect(page.body).toContain('data-consent="accepted"');
    const decided = await t.app.inject({ method: 'GET', url: '/', cookies: { shopme_consent: 'declined' } });
    expect(decided.body).not.toContain('shopme-cookie-banner');
    await gql('mutation { shopmeCookieBannerUpdate(enabled: false) { cookieBanner { enabled } } }');
    expect((await t.app.inject('/')).body).not.toContain('shopme-cookie-banner');
  });
});
