import type { FastifyInstance } from 'fastify';
import { CONFIG_SCHEMAS, availablePaymentMethods, checkoutSettingsOf, getShop, mergeCheckoutSettings, type CheckoutSettingsInput, type CheckoutView, type OrderSummary, type Shop } from '@shopme/core';
import type { PaymentProvider } from '@shopme/payments';
import { authenticate } from '../plugins/auth';
import { thankYouPage, checkoutPage, pageCtx, type PageCtx } from './views';

/** Pages the checkout editor can preview (the account pages are the theme's own and are previewed by the storefront). */
export const PREVIEW_PAGES = ['checkout', 'thank-you'] as const;
export type PreviewPage = (typeof PREVIEW_PAGES)[number];

const SAMPLE_ADDRESS = { firstName: 'Alex', lastName: 'Martin', address1: '12 Example Street', city: 'Springfield', zip: '12345', provinceCode: '', province: null, countryCode: '', company: null, address2: null, phone: null };

/** A checkout with one sample product, so the editor shows every block whatever the store holds. */
export function sampleCheckout(c: PageCtx, shop: Shop, settings: CheckoutView['settings']): CheckoutView {
  const price = 2500;
  const line = {
    lineId: 1, key: 'sample', variantId: 1, productId: 1, quantity: 1, properties: {}, position: 0, variantTitle: c.t('sampleDefault'), options: [], hasOnlyDefaultVariant: true, sku: '',
    price, compareAtPrice: null, shopPrice: price, taxable: true, requiresShipping: true, grams: 0, image: null, sellingPlan: null,
    product: { title: c.t('sampleProduct'), handle: 'sample', vendor: '', productType: '', descriptionHtml: '', isGiftCard: false, requiresSellingPlan: false },
  };
  const rate = { id: 1, name: 'Standard', price: 500, transit: { min: 3, max: 5 } };
  return {
    token: 'preview', currency: shop.currency, shopCurrency: shop.currency, rate: 1, taxesIncluded: false, email: 'alex.martin@example.com',
    address: { ...SAMPLE_ADDRESS, countryCode: shop.country ?? '' }, note: null, settings, tip: 0, tipChoice: { percent: null, amount: 0 },
    lines: [line], requiresShipping: true, shippingOptions: [rate], shippingRateId: 1, appliedDiscounts: [], rejectedCodes: [], giftCards: [], giftCardTotal: 0,
    storeCredit: { enabled: false, available: 0, use: false, applied: 0 }, amountDue: price + rate.price, stockIssues: [],
    pricing: { lines: [{ id: 1, total: price }], shipping: { rate, price: rate.price, discount: 0, tax: 0 }, taxLines: [], discountApplications: [], subtotal: price, totalDiscounts: 0, totalShipping: rate.price, totalTax: 0, total: price + rate.price },
    completed: false,
  } as unknown as CheckoutView;
}

/** A paid order with one sample product, for the thank-you page. */
export function sampleOrder(c: PageCtx, shop: Shop): OrderSummary {
  const addr = { ...SAMPLE_ADDRESS, countryCode: shop.country ?? '', country: null, kind: 'shipping' };
  return {
    order: { name: '#1001', email: 'alex.martin@example.com', financialStatus: 'PAID', taxesIncluded: false, currency: shop.currency, presentmentCurrency: shop.currency, presentmentMoney: null, subtotal: 2500, totalShipping: 500, totalTax: 0, totalDiscounts: 0, totalTip: 0, total: 3000 },
    lines: [{ title: c.t('sampleProduct'), variantTitle: null, quantity: 1, imageUrl: null, unitPrice: 2500, discountedTotal: 2500, presentmentUnitPrice: null, presentmentDiscountedTotal: null, sellingPlanName: null, subscriptionContractId: null }],
    shippingAddress: addr, billingAddress: { ...addr, kind: 'billing' }, shippingLines: [{ title: 'Standard', price: 500 }], taxLines: [], discounts: [],
    transactions: [{ gateway: 'stripe', status: 'SUCCESS', kind: 'SALE', amount: 3000 }],
  } as unknown as OrderSummary;
}

/**
 * `POST /admin/api/checkout-preview`: the checkout editor's live preview. Body: `{ page: 'checkout' | 'thank-you', settings?, config?, select? }` where
 * `settings` and `config` are the editor's unsaved values (checkout rules, and look); the page comes back as HTML with sample data and nothing that submits.
 */
export function registerCheckoutPreview(app: FastifyInstance): void {
  const { db } = app.ctx;
  app.post('/admin/api/checkout-preview', { bodyLimit: 256 * 1024 }, async (req, reply) => {
    const auth = await authenticate(req);
    if (!auth) return reply.code(401).send({ error: 'Not authenticated' });
    if (!auth.scopes.includes('*') && !auth.scopes.includes('write_shop') && !auth.scopes.includes('read_shop')) return reply.code(403).send({ error: 'Access denied. Required access: read_shop' });
    const shop = await getShop(db, auth.shopId);
    if (!shop) return reply.code(404).send({ error: 'Store not found' });
    const b = (req.body ?? {}) as { page?: unknown; settings?: unknown; config?: unknown; select?: unknown };
    const page = PREVIEW_PAGES.find((p) => p === b.page);
    if (!page) return reply.code(400).send({ error: 'page must be checkout or thank-you' });

    const merged = mergeCheckoutSettings(checkoutSettingsOf(shop), (b.settings && typeof b.settings === 'object' ? b.settings : {}) as CheckoutSettingsInput);
    const settings = merged.ok ? merged.value : checkoutSettingsOf(shop);
    const cfg = CONFIG_SCHEMAS.CHECKOUT.safeParse(b.config ?? {});
    const stored = (shop.settings as { config?: Record<string, unknown> }).config ?? {};
    const preview = { ...shop, settings: { ...shop.settings, config: { ...stored, ...(b.config && cfg.success ? { checkout: cfg.data } : {}) } } } as Shop;
    const c = pageCtx(preview);
    c.preview = { select: typeof b.select === 'string' ? b.select.slice(0, 40) : undefined };

    let html: string;
    if (page === 'thank-you') html = thankYouPage(c, sampleOrder(c, preview), '');
    else {
      const view = sampleCheckout(c, preview, settings);
      const methods = availablePaymentMethods(preview.settings, { stripeConfigured: false, context: { country: view.address?.countryCode ?? null, total: view.amountDue } });
      const fallback: PaymentProvider[] = [{ id: 'cod', kind: 'manual' } as unknown as PaymentProvider];
      html = checkoutPage(c, { view, methods: methods.length ? methods : fallback, errors: [], bankInstructions: '', stripe: null, countries: null, marketing: settings.marketing === 'checked' });
    }
    return reply.header('cache-control', 'no-store').header('content-security-policy', "default-src 'self'; img-src * data:; style-src 'self' 'unsafe-inline'; script-src 'unsafe-inline'").type('text/html; charset=utf-8').send(html);
  });
}
