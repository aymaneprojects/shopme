import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, setupAndLogin, type TestApp } from '../test-utils';

describe('checkout editor preview (POST /admin/api/checkout-preview)', () => {
  let t: TestApp;
  let cookie: string;
  const preview = (body: Record<string, unknown>, auth = true) =>
    t.app.inject({ method: 'POST', url: '/admin/api/checkout-preview', cookies: auth ? { shopme_session: cookie } : {}, payload: body });

  beforeAll(async () => { t = await createTestApp(); cookie = await setupAndLogin(t.app); }, 60_000);
  afterAll(async () => { await t.close(); });

  it('needs a signed-in admin and a known page', async () => {
    expect((await preview({ page: 'checkout' }, false)).statusCode).toBe(401);
    expect((await preview({ page: 'cart' })).statusCode).toBe(400);
  });

  it('renders the checkout with sample data, every block tagged for the editor, and nothing that submits', async () => {
    const r = await preview({ page: 'checkout' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/html');
    for (const block of ['header', 'logo', 'contact', 'address', 'shipping', 'payment', 'action', 'discount']) expect(r.body).toContain(`data-co="${block}"`);
    expect(r.body).toContain('Sample product');
    expect(r.body).not.toContain('checkout.js'); // the live scripts are not loaded
    expect(r.body).toContain('/checkout-assets/preview.js'); // clicks and submits do nothing in the editor
    const js = await t.app.inject('/checkout-assets/preview.js');
    expect(js.headers['content-type']).toContain('javascript');
    expect(js.body).toContain("addEventListener('submit'");
    expect(js.body).toContain('shopmeClick');
  });

  it('shows the unsaved checkout rules and look', async () => {
    const base = (await preview({ page: 'checkout' })).body;
    expect(base).not.toContain('name="tip"');
    expect(base).toContain('name="phone"');
    const draft = (await preview({
      page: 'checkout', settings: { tipping: { enabled: true, presets: [5, 10] }, phone: 'hidden', orderNotes: true, nameMode: 'last' },
      config: { addressAutocomplete: false, branding: { accentColor: '#aa3300', backgroundColor: '', logoUrl: '', buttonShape: 'square', headerText: 'Free returns', footerText: 'Thanks for shopping' } },
    })).body;
    expect(draft).toContain('name="tip"');
    expect(draft).toContain('value="10"');
    expect(draft).not.toContain('name="phone"');
    expect(draft).toContain('name="note"');
    expect(draft).not.toContain('name="firstName"');
    expect(draft).toContain('--primary:#aa3300');
    expect(draft).toContain('border-radius:2px');
    expect(draft).toContain('Free returns');
    expect(draft).toContain('Thanks for shopping');
    // the stored look is not changed by a preview
    expect((await preview({ page: 'checkout' })).body).not.toContain('#aa3300');
  });

  it('renders the thank-you page with the confirmation, the order details and the summary', async () => {
    const r = await preview({ page: 'thank-you', select: 'details' });
    expect(r.statusCode).toBe(200);
    for (const block of ['confirmation', 'status', 'details', 'action', 'summary']) expect(r.body).toContain(`data-co="${block}"`);
    expect(r.body).toContain('Confirmation #1001');
    expect(r.body).toContain('Contact information');
    expect(r.body).toContain('Billing address');
    expect(r.body).toContain('Continue shopping');
    expect(r.body).toContain('Sample product');
    expect(r.body).toContain('data-select="details"'); // the block picked in the editor is outlined on load
  });
});
