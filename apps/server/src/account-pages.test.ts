import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, setupAndLogin, type TestApp } from './test-utils';

/** Aurora's customer account templates: sections with settings, editable in the theme editor, previewed with a sample customer. */
describe('customer account pages in the theme editor', () => {
  let t: TestApp;
  let cookie: string;
  let themeId: number;
  const preview = (url: string, token?: string) => t.app.inject({ url: `${url}${url.includes('?') ? '&' : '?'}preview_theme_id=${themeId}${token ? `&_draft=${token}` : ''}`, cookies: { shopme_session: cookie } });
  const draft = async (files: Record<string, unknown>) => {
    const r = await t.app.inject({ method: 'POST', url: `/admin/api/themes/${themeId}/preview-draft`, cookies: { shopme_session: cookie }, payload: { files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, JSON.stringify(v)])) } });
    return (r.json() as { token: string }).token;
  };
  const noLiquidErrors = (html: string) => expect([...html.matchAll(/<!-- Liquid error[^>]*-->|Liquid error/g)].map((m) => m[0])).toEqual([]);
  beforeAll(async () => {
    t = await createTestApp();
    cookie = await setupAndLogin(t.app);
    const r = await t.app.inject({ method: 'POST', url: '/admin/api/2026-10/graphql.json', cookies: { shopme_session: cookie }, payload: { query: '{ themes(first: 5) { nodes { id role } } }' } });
    themeId = Number(String(r.json().data.themes.nodes[0].id).split('/').pop());
  }, 60_000);
  afterAll(async () => { await t.close(); });

  it('ships every customer template as a JSON template whose section has settings', async () => {
    const r = await t.app.inject({ method: 'POST', url: '/admin/api/2026-10/graphql.json', cookies: { shopme_session: cookie }, payload: { query: `{ theme(id: "gid://shopify/OnlineStoreTheme/${themeId}") { files(filenames: ["templates/customers/*.json", "sections/main-*.liquid"], first: 50) { nodes { filename body { ... on OnlineStoreThemeFileBodyText { content } } } } } }` } });
    const files = r.json().data.theme.files.nodes as Array<{ filename: string; body: { content: string } }>;
    const templates = files.filter((f) => f.filename.startsWith('templates/customers/')).map((f) => f.filename).sort();
    expect(templates).toEqual(['account', 'activate_account', 'addresses', 'login', 'order', 'register', 'reset_password'].map((n) => `templates/customers/${n}.json`));
    for (const f of files.filter((x) => x.filename.startsWith('templates/'))) {
      const tpl = JSON.parse(f.body.content) as { sections: Record<string, { type: string }>; order: string[] };
      const type = tpl.sections[tpl.order[0]!]!.type;
      const section = files.find((x) => x.filename === `sections/${type}.liquid`)!.body.content;
      const schema = JSON.parse(/\{% schema %\}([\s\S]*?)\{% endschema %\}/.exec(section)![1]!) as { name: string; settings: Array<{ id?: string; type: string }> };
      expect(schema.name, type).toMatch(/^t:sections\.main_/);
      expect(schema.settings.filter((s) => s.id).map((s) => s.id), type).toContain('color_scheme');
    }
  });

  it('renders the sign-in and sign-up pages with the merchant\'s heading, text and toggles', async () => {
    const token = await draft({
      'templates/customers/login.json': { sections: { main: { type: 'main-login', settings: { heading: 'Welcome back zq1', text: '<p>Intro zq2</p>', align: 'center', show_register_link: false } } }, order: ['main'] },
      'templates/customers/register.json': { sections: { main: { type: 'main-register', settings: { heading: 'Join us zq3', show_name_fields: false, show_marketing: false, width: 'page', color_scheme: 'scheme-2' } } }, order: ['main'] },
    });
    const login = await preview('/account/login', token);
    expect(login.statusCode).toBe(200);
    noLiquidErrors(login.body);
    expect(login.body).toContain('Welcome back zq1');
    expect(login.body).toContain('Intro zq2');
    expect(login.body).toContain('customer--center');
    expect(login.body).not.toContain('href="/account/register"');
    expect(login.body).toContain('data-shopify-editor-section');
    const register = await preview('/account/register', token);
    noLiquidErrors(register.body);
    expect(register.body).toContain('Join us zq3');
    expect(register.body).not.toContain('customer[first_name]');
    expect(register.body).not.toContain('customer[accepts_marketing]');
    expect(register.body).toContain('color-scheme-2');
    // The live store keeps the default pages.
    const live = await t.app.inject('/account/login');
    expect(live.body).not.toContain('Welcome back zq1');
    expect(live.body).toContain('href="/account/register"');
    expect((await t.app.inject('/account/register')).body).toContain('customer[first_name]');
  });

  it('previews the signed-in pages with a sample customer, never redirecting staff to the login page', async () => {
    const account = await preview('/account');
    expect(account.statusCode).toBe(200);
    noLiquidErrors(account.body);
    expect(account.body).toContain('Sam Sample');
    expect(account.body).toContain('sample@example.com');
    expect(account.body).toContain('#1003');
    const order = await preview('/account/orders/sample');
    expect(order.statusCode).toBe(200);
    noLiquidErrors(order.body);
    expect(order.body).toContain('#1002');
    expect(order.body).toContain('Sample item');
    expect(order.body).toContain('SAMPLE-1');
    const addresses = await preview('/account/addresses');
    expect(addresses.statusCode).toBe(200);
    noLiquidErrors(addresses.body);
    expect(addresses.body).toContain('12 Sample Street');
    for (const path of ['/account/activate/0/preview', '/account/reset/0/preview']) {
      const r = await preview(path);
      expect(r.statusCode, path).toBe(200);
      noLiquidErrors(r.body);
      expect(r.body, path).toContain('customer[password_confirmation]');
    }
    // Without a staff session the same addresses keep their normal behaviour.
    expect((await t.app.inject(`/account?preview_theme_id=${themeId}`)).statusCode).toBe(302);
    expect((await t.app.inject('/account/orders/sample')).statusCode).toBe(302);
    expect((await t.app.inject('/account/reset/1/nope')).headers.location).toBe('/account/login');
  });

  it('applies the account and order page settings', async () => {
    const token = await draft({
      'templates/customers/account.json': { sections: { main: { type: 'main-account', settings: { heading: 'Your space zq4', details_position: 'below', show_default_address: false } } }, order: ['main'] },
      'templates/customers/order.json': { sections: { main: { type: 'main-order', settings: { heading: 'Purchase', show_sku: false, show_addresses: false, show_shipments: false } } }, order: ['main'] },
      'templates/customers/addresses.json': { sections: { main: { type: 'main-addresses', settings: { heading: 'Address book zq5', columns: '2' } } }, order: ['main'] },
    });
    const account = (await preview('/account', token)).body;
    expect(account).toContain('Your space zq4');
    expect(account).toContain('customer__layout--stacked');
    expect(account).not.toContain('12 Sample Street');
    const order = (await preview('/account/orders/sample', token)).body;
    expect(order).toContain('Purchase #1002');
    expect(order).not.toContain('SAMPLE-1');
    expect(order).not.toContain('SAMPLE0000000');
    expect(order).toContain('colspan="3"');
    const addresses = (await preview('/account/addresses', token)).body;
    expect(addresses).toContain('Address book zq5');
    expect(addresses).toContain('grid--2');
  });
});
