import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { fr } from '../i18n/fr';
import { previewPath, templateForPath } from '../pages/online-store/SectionsEditor';
import { groupTemplates, templateLabel } from '../pages/online-store/ThemeEditor';

const tEn = (k: string, v?: Record<string, string | number>) => Object.entries(v ?? {}).reduce((s, [a, b]) => s.replace(`{${a}}`, String(b)), (en as Record<string, string>)[k] ?? k);

describe('customer account pages in the theme editor', () => {
  const ACCOUNT = ['customers/login', 'customers/register', 'customers/account', 'customers/order', 'customers/addresses', 'customers/activate_account', 'customers/reset_password'];

  it('previews each account template at its storefront address and finds it back from that address', () => {
    expect(previewPath('customers/login', {})).toBe('/account/login');
    expect(previewPath('customers/account', {})).toBe('/account');
    expect(previewPath('customers/order', {})).toBe('/account/orders/sample');
    for (const tpl of ACCOUNT) expect(templateForPath(previewPath(tpl, {}))).toBe(tpl);
    expect(templateForPath('/account/orders/42?view=x')).toBe('customers/order');
    expect(templateForPath('/account/reset/12/abc')).toBe('customers/reset_password');
    expect(templateForPath('/products/tee')).toBe('product');
  });

  it('lists storefront pages first, then the account pages in the order customers meet them, with readable names', () => {
    const g = groupTemplates(['404', 'customers/reset_password', 'index', 'customers/account', 'customers/login', 'page.contact', 'customers/order']);
    expect(g.pages).toEqual(['404', 'index', 'page.contact']);
    expect(g.account).toEqual(['customers/login', 'customers/account', 'customers/order', 'customers/reset_password']);
    expect(templateLabel('customers/login', tEn as never)).toBe('Login');
    expect(templateLabel('page.contact', tEn as never)).toBe('Page: contact');
    expect(templateLabel('product', tEn as never)).toBe('Product page');
    expect(templateLabel('mystery', tEn as never)).toBe('mystery');
  });

  it('names every account page in English and French', () => {
    for (const tpl of ACCOUNT) {
      expect((en as Record<string, string>)[`editor.page.${tpl}`], tpl).toBeTruthy();
      expect((fr as Record<string, string>)[`editor.page.${tpl}`], tpl).toBeTruthy();
      expect((fr as Record<string, string>)[`editor.page.${tpl}`]).not.toBe((en as Record<string, string>)[`editor.page.${tpl}`]);
    }
  });
});
