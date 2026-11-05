import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, setupAndLogin, type TestApp } from './test-utils';

const draftTemplate = (text: string) => JSON.stringify({ sections: { only: { type: 'rich-text', blocks: { h: { type: 'heading', settings: { text } } }, block_order: ['h'] } }, order: ['only'] });

describe('theme editor preview', () => {
  let t: TestApp;
  let cookie: string;
  let themeId: number;
  beforeAll(async () => {
    t = await createTestApp();
    cookie = await setupAndLogin(t.app);
    const r = await t.app.inject({ method: 'POST', url: '/admin/api/2026-10/graphql.json', cookies: { shopme_session: cookie }, payload: { query: '{ themes(first: 5) { nodes { id role } } }' } });
    themeId = Number(String(r.json().data.themes.nodes[0].id).split('/').pop());
  }, 60_000);
  afterAll(async () => { await t.close(); });

  it('the live storefront and anonymous preview requests carry no editor attributes', async () => {
    expect((await t.app.inject('/')).body).not.toContain('data-shopify-editor');
    expect((await t.app.inject(`/?preview_theme_id=${themeId}`)).body).not.toContain('data-shopify-editor');
    expect((await t.app.inject({ url: '/', cookies: { shopme_session: cookie } })).body).not.toContain('data-shopify-editor');
  });

  it('a signed-in preview marks sections and blocks', async () => {
    const html = (await t.app.inject({ url: `/?preview_theme_id=${themeId}`, cookies: { shopme_session: cookie } })).body;
    expect(html).toContain('data-shopify-editor-section="');
  });

  it('unsaved drafts show in the preview and never in the live store', async () => {
    const put = await t.app.inject({ method: 'POST', url: `/admin/api/themes/${themeId}/preview-draft`, cookies: { shopme_session: cookie }, payload: { files: { 'templates/index.json': draftTemplate('Draft heading zq') } } });
    expect(put.statusCode).toBe(200);
    const { token } = put.json() as { token: string };
    const html = (await t.app.inject({ url: `/?preview_theme_id=${themeId}&_draft=${token}`, cookies: { shopme_session: cookie } })).body;
    expect(html).toContain('Draft heading zq');
    expect(html).toContain('data-shopify-editor-section');
    expect(html).toContain('data-shopify-editor-block="');
    expect((await t.app.inject('/')).body).not.toContain('Draft heading zq');
    const again = await t.app.inject({ method: 'POST', url: `/admin/api/themes/${themeId}/preview-draft`, cookies: { shopme_session: cookie }, payload: { token, files: { 'templates/index.json': draftTemplate('Draft heading yy') } } });
    expect(again.json().token).toBe(token);
    expect((await t.app.inject({ url: `/?preview_theme_id=${themeId}&_draft=${token}`, cookies: { shopme_session: cookie } })).body).toContain('Draft heading yy');
  });

  it('the draft endpoint needs a session and a theme of the shop', async () => {
    expect((await t.app.inject({ method: 'POST', url: `/admin/api/themes/${themeId}/preview-draft`, payload: { files: {} } })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'POST', url: '/admin/api/themes/999999/preview-draft', cookies: { shopme_session: cookie }, payload: { files: {} } })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'POST', url: `/admin/api/themes/${themeId}/preview-draft`, cookies: { shopme_session: cookie }, payload: {} })).statusCode).toBe(400);
  });
});
