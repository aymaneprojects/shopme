import type { FastifyInstance } from 'fastify';
import { formatGiftCardCode, getCustomer, getGiftCardByToken, giftCardState, lastCharacters, type GiftCard, type Shop } from '@shopme/core';
import type { AppContext } from '../context';
import { makeEnv } from './env';
import type { createContent } from './pages';
import type { ThemeStore } from './theme-store';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Liquid `gift_card` (Shopify shape: money in minor units, `code` shown in groups of four). */
export async function giftCardObject(ctx: AppContext, shop: Shop, c: GiftCard) {
  const [customer, recipient] = await Promise.all([
    c.customerId ? getCustomer(ctx.db, shop.id, c.customerId) : null,
    c.recipientCustomerId ? getCustomer(ctx.db, shop.id, c.recipientCustomerId) : null,
  ]);
  const state = giftCardState(c);
  const person = (x: typeof customer) => (x ? { id: x.id, email: x.email, first_name: x.firstName, last_name: x.lastName, name: [x.firstName, x.lastName].filter(Boolean).join(' ') } : null);
  return {
    id: c.id, balance: c.balance, initial_value: c.initialValue, currency: c.currency, code: formatGiftCardCode(c.code).replace(/-/g, ' '), last_characters: lastCharacters(c.code),
    enabled: c.enabled, expired: state === 'EXPIRED', 'expired?': state === 'EXPIRED', expires_on: c.expiresOn ? c.expiresOn.toISOString().slice(0, 10) : null,
    message: c.message ?? '', send_on: c.sendNotificationAt ? c.sendNotificationAt.toISOString() : null, template_suffix: c.templateSuffix ?? '', url: `/gift_cards/${c.token}`,
    customer: person(customer), recipient: person(recipient), properties: {}, product: null, qr_identifier: c.code, pass_url: null,
  };
}

/** `/gift_cards/:token`: the public page of a gift card, rendered with the theme's `gift_card` template (a minimal page when the theme has none). */
export function registerGiftCardRoutes(app: FastifyInstance, ctx: AppContext, content: ReturnType<typeof createContent>, store: ThemeStore): void {
  const { withShop, renderTemplate, notFound } = content;
  app.get('/gift_cards/:token', withShop(async (req, reply, shop) => {
    const { token } = req.params as { token: string };
    const card = await getGiftCardByToken(ctx.db, shop.id, token);
    if (!card) return notFound(req, reply, shop);
    const obj = await giftCardObject(ctx, shop, card);
    const loaded = await store.main(shop.id);
    const suffix = card.templateSuffix && loaded.theme.has(`templates/gift_card.${card.templateSuffix}.liquid`) ? card.templateSuffix : null;
    if (!loaded.theme.has('templates/gift_card.liquid') && !loaded.theme.has('templates/gift_card.json')) {
      const money = (n: number) => new Intl.NumberFormat(shop.locale, { style: 'currency', currency: card.currency }).format(n / 100);
      return reply.code(200).header('cache-control', 'no-store').type('text/html; charset=utf-8')
        .send(`<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>${esc(shop.name)}</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>${esc(shop.name)}</h1><p style="font-size:2rem;font-weight:700">${esc(money(card.balance))}</p><p><code>${esc(obj.code)}</code></p>${obj.message ? `<blockquote>${esc(obj.message)}</blockquote>` : ''}</body>`);
    }
    const env = await makeEnv(ctx, req, shop);
    return renderTemplate(req, reply, env, { template: 'gift_card', pageType: 'gift_card', title: shop.name, suffix, extra: { gift_card: obj } });
  }));
}
