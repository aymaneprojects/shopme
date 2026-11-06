import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Db } from './db/client';
import { defaultTemplate, htmlToText, liquidError, NOTIFICATION_KEYS, renderNotification, sampleVars } from './mail/notifications';
import { priceDraft, type DraftLine } from './services';
import { hasPermission, normalizePermissions, scopesFor } from './services/staff';
import { signBody, topicFromWire, topicsForVerb, topicToWire } from './services/webhooks';
import type { Shop } from './services/shops';

const shop = (locale: string): Shop => ({
  id: 1, name: 'Boutique <Test>', email: 'shop@example.com', currency: 'EUR', country: 'FR', locale, timezone: 'UTC', weightUnit: 'KILOGRAMS', moneyFormat: '{{amount}} €', moneyWithCurrencyFormat: '{{amount}} EUR',
  taxesIncluded: false, primaryDomain: null, handle: 'boutique-test', status: 'ACTIVE', storagePrefix: null, settings: {}, createdAt: new Date(), updatedAt: new Date(),
});

describe('notification templates', () => {
  it('renders every default in English and French, escaping variables', async () => {
    for (const locale of ['en', 'fr']) {
      const sh = shop(locale);
      for (const key of NOTIFICATION_KEYS) {
        const r = await renderNotification({} as Db, sh, 'https://shop.test', key, sampleVars(sh, 'https://shop.test'), defaultTemplate(sh, key));
        expect(r.subject.length).toBeGreaterThan(3);
        expect(r.subject).not.toMatch(/\{\{|\{%/);
        expect(r.html).toContain('Boutique &lt;Test&gt;'); // shop name in the layout is escaped
        expect(r.html).not.toMatch(/\{\{|\{%/);
      }
    }
    const fr = await renderNotification({} as Db, shop('fr'), 'https://shop.test', 'order_confirmation', sampleVars(shop('fr'), 'https://shop.test'), defaultTemplate(shop('fr'), 'order_confirmation'));
    expect(fr.subject).toBe('Commande #1001 confirmée');
    expect(fr.text).toContain('Sous-total');
  });

  it('escapes HTML in values but not in the template', async () => {
    const r = await renderNotification({} as Db, shop('en'), 'https://x', 'contact_form', { contact: { name: 'A', email: 'a@b.c', message: '<script>alert(1)</script>' } }, { subject: 'Hi {{ contact.name }}', body: '<b>{{ contact.message }}</b>' });
    expect(r.html).toContain('<b>&lt;script&gt;alert(1)&lt;/script&gt;</b>');
    expect(r.subject).toBe('Hi A');
  });

  it('detects Liquid syntax errors and converts HTML to text', () => {
    expect(liquidError('{% if x %}')).toBeTruthy();
    expect(liquidError('{{ a | upcase }}')).toBeNull();
    expect(htmlToText('<p>Hello &amp; welcome</p><table><tr><td>A</td><td>B</td></tr></table>')).toBe('Hello & welcome\nA  B');
  });
});

describe('permissions', () => {
  it('maps areas to scopes', () => {
    expect(scopesFor({ role: 'owner', permissions: [] })).toEqual(['*']);
    expect(scopesFor({ role: 'admin', permissions: [] })).toEqual(['*']);
    const s = scopesFor({ role: 'staff', permissions: ['orders'] });
    expect(s).toEqual(expect.arrayContaining(['read_orders', 'write_orders', 'write_draft_orders', 'write_fulfillments']));
    expect(s).not.toContain('read_products');
    expect(scopesFor({ role: 'staff', permissions: [] })).toEqual([]);
    expect(normalizePermissions(['settings', 'bogus', 'products'])).toEqual(['products', 'settings']);
    expect(hasPermission({ role: 'staff', permissions: ['staff'] }, 'staff')).toBe(true);
    expect(hasPermission({ role: 'staff', permissions: [] }, 'staff')).toBe(false);
  });
});

describe('webhook helpers', () => {
  it('maps topics and signs bodies', () => {
    expect(topicToWire('ORDERS_CREATE')).toBe('orders/create');
    expect(topicFromWire('draft_orders/update')).toBe('DRAFT_ORDERS_UPDATE');
    expect(topicsForVerb('order.fulfilled')).toEqual(expect.arrayContaining(['orders/fulfilled', 'fulfillments/create']));
    expect(topicsForVerb('shop.updated')).toEqual([]);
    expect(signBody('secret', 'body')).toBe(createHmac('sha256', 'secret').update('body').digest('base64'));
  });
});

describe('draft pricing', () => {
  const line = (over: Partial<DraftLine>): DraftLine => ({ uuid: 'u', variantId: null, productId: null, title: 'x', variantTitle: null, sku: null, vendor: null, imageUrl: null, quantity: 1, unitPrice: 1000, taxable: false, requiresShipping: false, grams: 0, discount: null, properties: {}, ...over });
  const db = { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) } as unknown as Db;
  it('applies line then order discounts and custom shipping', async () => {
    const d: Parameters<typeof priceDraft>[2] = { lines: [line({ uuid: 'a', quantity: 2, discount: { title: null, description: null, valueType: 'PERCENTAGE', value: 10 } }), line({ uuid: 'b', unitPrice: 500 })], appliedDiscount: { title: null, description: null, valueType: 'FIXED_AMOUNT', value: 300 }, shippingLine: { title: 'Courier', price: 490 }, shippingAddress: null, billingAddress: null, taxExempt: false, customerId: null };
    const { pricing, calc } = await priceDraft(db, shop('en'), d);
    expect(pricing.subtotal).toBe(2500);
    expect(calc.lines[0]).toMatchObject({ lineDiscount: 200, subtotal: 2000 });
    expect(calc.orderDiscount).toBe(300);
    expect(pricing.totalDiscounts).toBe(500);
    expect(pricing.total).toBe(2500 - 500 + 490);
  });
});
