import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  acceptInvite, completeDraftOrder, createCart, createSession, exportCustomerData, getDraftOrderByToken, getInvite, getPrimaryShop, getShop, publicStaff, schema as s, type DraftOrder, type Shop,
} from '@shopme/core';
import { and, eq, inArray } from 'drizzle-orm';
import { renderMoneyFormat } from '@shopme/shopify-compat';
import { publicShop } from './admin/auth-routes';
import { authenticate, setSessionCookie } from './plugins/auth';
import { FailureLimiter } from './plugins/rate-limit';
import { CART_COOKIE } from './storefront/env';

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const acceptBody = z.object({ token: z.string().min(10).max(200), password: z.string().min(8).max(200), firstName: z.string().trim().max(100).optional(), lastName: z.string().trim().max(100).optional() });

/** REST endpoints of the ops features: staff invitations, GDPR export and the draft order invoice (payment) link. */
export async function registerOpsRoutes(app: FastifyInstance): Promise<void> {
  const { db, config } = app.ctx;
  const limiter = new FailureLimiter(10, 15 * 60 * 1000);

  // --- staff invitation (public, the token is the capability) ---
  app.get('/admin/api/staff/invite/:token', async (req, reply) => {
    const info = await getInvite(db, (req.params as { token: string }).token);
    return info ?? reply.code(404).send({ error: 'This invitation is invalid or has expired' });
  });

  app.post('/admin/api/staff/accept-invite', async (req, reply) => {
    const body = acceptBody.safeParse(req.body);
    if (!body.success) return reply.code(422).send({ error: 'Invalid input', issues: body.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) });
    if (limiter.isLimited(`ip:${req.ip}`)) return reply.code(429).send({ error: 'Too many attempts. Try again later.' });
    const r = await acceptInvite(db, body.data.token, body.data);
    if (!r.ok) { limiter.fail(`ip:${req.ip}`); return reply.code(422).send({ error: r.errors[0]!.message, issues: r.errors }); }
    const session = await createSession(db, { shopId: r.value.shopId, staffUserId: r.value.id, ip: req.ip, userAgent: req.headers['user-agent'] });
    setSessionCookie(app, reply, session.token, session.expiresAt);
    const shop = await getShop(db, r.value.shopId);
    return { user: publicStaff(r.value), shop: shop ? publicShop(shop) : null };
  });

  // --- GDPR data export ---
  app.get('/admin/api/customers/:id/export.json', async (req, reply) => {
    const auth = await authenticate(req);
    if (!auth) return reply.code(401).send({ error: 'Not authenticated' });
    if (!auth.scopes.some((x) => x === '*' || x === 'read_customers' || x === 'write_customers')) return reply.code(403).send({ error: 'Access denied. Required access: read_customers' });
    const id = Number((req.params as { id: string }).id);
    const data = Number.isSafeInteger(id) ? await exportCustomerData(db, auth.shopId, id) : null;
    if (!data) return reply.code(404).send({ error: 'Customer not found' });
    return reply.header('content-disposition', `attachment; filename="customer-${id}.json"`).header('cache-control', 'no-store').send(data);
  });

  // --- draft order invoice link ---
  const page = (reply: FastifyReply, shop: Shop, body: string, status = 200) => reply.code(status).header('cache-control', 'no-store').type('text/html; charset=utf-8').send(
    `<!doctype html><html lang="${esc(shop.locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(shop.name)}</title>`
    + `<link rel="stylesheet" href="/checkout-assets/checkout.css"></head><body><main id="main" class="ty" style="max-width:640px;margin:2rem auto;padding:0 1rem"><h1>${esc(shop.name)}</h1>${body}</main></body></html>`);
  const fr = (shop: Shop) => shop.locale.toLowerCase().startsWith('fr');
  const bank = (shop: Shop) => {
    const p = (shop.settings.payments as { manual?: { bankTransfer?: { enabled?: boolean; instructions?: string } } } | undefined)?.manual?.bankTransfer;
    return p?.enabled && p.instructions ? p.instructions : '';
  };

  /** A draft that the regular checkout can reproduce exactly: catalog variants at their current price, no custom discount or shipping. */
  async function checkoutCompatible(shopId: number, d: DraftOrder): Promise<boolean> {
    if (d.appliedDiscount || d.shippingLine || d.lines.some((l) => !l.variantId || l.discount)) return false;
    const prices = await db.select({ id: s.productVariants.id, price: s.productVariants.price, status: s.products.status }).from(s.productVariants)
      .innerJoin(s.products, eq(s.products.id, s.productVariants.productId)).where(and(eq(s.productVariants.shopId, shopId), inArray(s.productVariants.id, d.lines.map((l) => l.variantId!))));
    return d.lines.every((l) => { const v = prices.find((p) => p.id === l.variantId); return !!v && v.status === 'ACTIVE' && v.price === l.unitPrice; });
  }

  await app.register(async (scope) => {
  scope.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(body as string))));
  scope.get('/draft_orders/:token/pay', async (req, reply) => {
    const shop = await getPrimaryShop(db);
    const d = shop ? await getDraftOrderByToken(db, (req.params as { token: string }).token) : null;
    if (!shop || !d || d.shopId !== shop.id) return reply.code(404).send('Not found');
    if (d.status === 'COMPLETED') return page(reply, shop, `<p>${fr(shop) ? 'Cette commande est déjà finalisée.' : 'This order has already been completed.'}</p><p><a href="/">${fr(shop) ? 'Retour à la boutique' : 'Back to the shop'}</a></p>`);
    if (await checkoutCompatible(shop.id, d)) {
      // Pre-fill a cart (lines, email, addresses) and hand over to the normal checkout; submitting it completes the draft.
      const cart = await createCart(db, shop.id, d.currency);
      await db.insert(s.cartLines).values(d.lines.map((l, i) => ({ shopId: shop.id, cartId: cart.id, variantId: l.variantId!, quantity: l.quantity, properties: l.properties, position: i })));
      await db.update(s.carts).set({ email: d.email, shippingAddress: d.shippingAddress, billingAddress: d.billingAddress ?? d.shippingAddress, note: d.note, draftOrderId: d.id }).where(eq(s.carts.id, cart.id));
      reply.setCookie(CART_COOKIE, cart.token, { path: '/', sameSite: 'lax', httpOnly: false, maxAge: 90 * 24 * 3600, secure: config.appUrl.startsWith('https://') });
      return reply.redirect(`/checkouts/${cart.token}`, 303);
    }
    const m = (n: number) => renderMoneyFormat(shop.moneyFormat, n, d.currency);
    const rows = d.lines.map((l) => `<tr><td>${esc(l.title)} &times; ${l.quantity}</td><td style="text-align:right">${esc(m(l.unitPrice * l.quantity))}</td></tr>`).join('');
    const f = fr(shop);
    return page(reply, shop, `<h2>${esc(d.name)}</h2><table style="width:100%">${rows}<tr><td><strong>Total</strong></td><td style="text-align:right"><strong>${esc(m(d.total))}</strong></td></tr></table>`
      + `<form method="post" action="/draft_orders/${esc(d.token)}/pay" style="margin-top:1.5rem"><button type="submit" class="btn">${f ? 'Confirmer la commande' : 'Confirm order'}</button></form>`
      + `<p class="note">${f ? 'Le paiement vous sera demandé après confirmation.' : 'Payment will be requested after you confirm.'}</p>`);
  });

  scope.post('/draft_orders/:token/pay', async (req, reply) => {
    const shop = await getPrimaryShop(db);
    const d = shop ? await getDraftOrderByToken(db, (req.params as { token: string }).token) : null;
    if (!shop || !d || d.shopId !== shop.id) return reply.code(404).send('Not found');
    const f = fr(shop);
    const r = await completeDraftOrder(db, shop, d.id, { paymentPending: true, sourceName: 'draft_order_invoice', draft: d });
    if (!r.ok && d.status !== 'COMPLETED') return page(reply, shop, `<p>${esc(r.errors[0]!.message)}</p>`, 422);
    const b = bank(shop);
    return page(reply, shop, `<h2>${f ? 'Merci !' : 'Thank you!'}</h2><p>${f ? 'Votre commande est confirmée. Le paiement est en attente.' : 'Your order is confirmed. Payment is pending.'}</p>${b ? `<p style="white-space:pre-wrap">${esc(b)}</p>` : ''}`);
  });
  });
}
