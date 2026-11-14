import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  changeContractStatus, getCustomerSubscriptionContract, type ContractAction, accountsModeOf, addCustomerAddress, addItems, authenticateCustomer, customerAccountsSettingsOf, customerCancelOrder, customerRequestReturn, getOrCreateCart, orderActionsFor, renderLoginCode, requestLoginCode, returnableQuantities, verifyLoginCode, createCustomerSession, deleteCustomerAddress, destroySession, getCustomerOrder, isCustomerTokenValid, registerCustomer, renderAccountActivation, renderPasswordReset,
  requestPasswordReset, setPasswordWithToken, updateCustomerAddress, type Customer, type CustomerAddressInput, type Mail, type Shop,
} from '@shopme/core';
import { gatewaysFor } from '../payments-gateways';
import type { AppContext } from '../context';
import { countryOptions, PROVINCES } from '../checkout/geo';
import { FailureLimiter } from '../plugins/rate-limit';
import { CART_COOKIE, CUSTOMER_COOKIE, customerOf, makeEnv, primaryShop } from './env';
import { setFlash } from './flash';
import { crossSite, formBody } from './forms';
import { messages } from './i18n';
import { orderObject, productLookups } from './data/customer';
import { sampleCustomer, sampleOrder } from './data/sample-customer';
import { isEditorPreview, type createContent } from './pages';

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const localPath = (v: unknown, fallback: string) => { const s = str(v); return s.startsWith('/') && !s.startsWith('//') ? s : fallback; };

/** Storefront customer accounts: `/account`, `/account/login`, `/account/register`, `/account/logout`, `/account/recover`, `/account/reset/:id/:token`, `/account/activate/:id/:token`, `/account/orders/:id`, `/account/addresses`. */
export function registerAccountRoutes(app: FastifyInstance, ctx: AppContext, content: ReturnType<typeof createContent>): void {
  const { db } = ctx;
  const { withShop, renderTemplate, notFound } = content;
  const secure = ctx.config.appUrl.startsWith('https://');
  const loginLimiter = new FailureLimiter(10, 15 * 60 * 1000);
  const recoverLimiter = new FailureLimiter(5, 60 * 60 * 1000);
  const registerLimiter = new FailureLimiter(10, 60 * 60 * 1000);

  const codeLimiter = new FailureLimiter(5, 15 * 60 * 1000);
  const verifyLimiter = new FailureLimiter(20, 60 * 60 * 1000);

  // Accounts switched off: every account page is a 404 (and the links are gone from the theme).
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0]!;
    if (path !== '/account' && !path.startsWith('/account/')) return;
    const shop = await primaryShop(ctx, req);
    if (shop && accountsModeOf(shop) === 'DISABLED') return notFound(req, reply, shop);
  });

  const html = (reply: FastifyReply) => reply.header('cache-control', 'no-store');
  const enqueueMail = (mail: Mail) => ctx.queue.enqueue<Mail>('mail.send', mail);

  const startSession = async (req: FastifyRequest, reply: FastifyReply, shop: Shop, c: Customer) => {
    const session = await createCustomerSession(db, { shopId: shop.id, customerId: c.id, ip: req.ip, userAgent: req.headers['user-agent'] });
    reply.setCookie(CUSTOMER_COOKIE, session.token, { path: '/', httpOnly: true, sameSite: 'lax', signed: true, expires: session.expiresAt, secure });
  };

  /**
   * Routes for signed-in customers only; others go to the login page (and come back afterwards). In the theme editor preview the page is
   * rendered with a made-up sample customer (`preview`) instead, so staff can design it without signing in and without real data.
   */
  const signedIn = (fn: (req: FastifyRequest, reply: FastifyReply, shop: Shop, customer: Customer) => Promise<unknown>, preview?: (req: FastifyRequest, reply: FastifyReply, shop: Shop) => Promise<unknown>) => withShop(async (req, reply, shop) => {
    if (preview && (await isEditorPreview(req, shop))) { html(reply); return preview(req, reply, shop); }
    const customer = await customerOf(ctx, req, shop);
    if (!customer) return reply.redirect(`/account/login?return_url=${encodeURIComponent(req.url.split('?')[0]!)}`, 302);
    html(reply);
    return fn(req, reply, shop, customer);
  });

  /** Form POSTs: same-site only, then the handler returns where to go. */
  const post = (path: string, fn: (req: FastifyRequest, reply: FastifyReply, shop: Shop, body: Record<string, any>) => Promise<unknown>) =>
    app.post(path, withShop(async (req, reply, shop) => (crossSite(req) ? reply.code(403).send('') : fn(req, reply, shop, formBody(req)))));

  const back = (reply: FastifyReply, to: string, flash?: Parameters<typeof setFlash>[1]) => { if (flash) setFlash(reply, flash, secure); return reply.redirect(to, 303); };
  const limited = (reply: FastifyReply, shop: Shop, to: string, type: string) => back(reply, to, { type, errors: { form: messages(shop.locale).t('rate_limited') } });

  const page = (template: string, title: string, extra: Record<string, unknown> = {}) => async (req: FastifyRequest, reply: FastifyReply, shop: Shop) => {
    const env = await makeEnv(ctx, req, shop);
    html(reply);
    return renderTemplate(req, reply, env, { template: `customers/${template}`, pageType: `customers/${template}`, title, suffix: null, extra });
  };
  const titleOf = (shop: Shop, en: string, fr: string) => (shop.locale.startsWith('fr') ? fr : en);

  // --- account home
  const accountTitle = (shop: Shop) => titleOf(shop, 'Account', 'Compte');
  app.get('/account', signedIn(async (req, reply, shop) => page('account', accountTitle(shop))(req, reply, shop), async (req, reply, shop) => page('account', accountTitle(shop), { customer: sampleCustomer(shop) })(req, reply, shop)));

  // --- subscriptions: pause, resume, skip the next order or cancel (own contracts only)
  const SUBSCRIPTION_ACTIONS: Record<string, ContractAction> = { pause: 'pause', resume: 'activate', skip: 'skip', cancel: 'cancel' };
  post('/account/subscriptions/:id/:action', async (req, reply, shop) => {
    const customer = await customerOf(ctx, req, shop);
    if (!customer) return reply.redirect('/account/login?return_url=%2Faccount', 303);
    const { id, action } = req.params as { id: string; action: string };
    const what = SUBSCRIPTION_ACTIONS[action];
    const contract = /^\d+$/.test(id) && what ? await getCustomerSubscriptionContract(db, shop.id, customer.id, Number(id)) : null;
    if (!contract) return notFound(req, reply, shop);
    const r = await changeContractStatus(db, shop.id, contract.id, what!, { actor: 'customer' });
    if (r.ok && what === 'cancel') ctx.queue.enqueue('subscription.notify', { shopId: shop.id, contractId: contract.id, key: 'subscription_cancelled' });
    return back(reply, '/account#subscriptions', r.ok ? undefined : { type: 'subscription', errors: { form: r.errors[0]?.message ?? '' } });
  });

  // --- login / logout
  app.get('/account/login', withShop(async (req, reply, shop) => {
    if (await isEditorPreview(req, shop)) return page('login', titleOf(shop, 'Login', 'Connexion'), { customer: null, login_step: 'start', login_email: '', login_return_url: '' })(req, reply, shop);
    if (await customerOf(ctx, req, shop)) return reply.redirect(localPath((req.query as Record<string, unknown>).return_url, '/account'), 302);
    const q = req.query as Record<string, unknown>;
    const back = localPath(q.return_url, '');
    const step = str(q.step) === 'code' && customerAccountsSettingsOf(shop).signIn.emailCode ? 'code' : 'start';
    const actions = back ? { customer_login: `/account/login?return_url=${encodeURIComponent(back)}` } : undefined;
    return page('login', titleOf(shop, 'Login', 'Connexion'), { login_step: step, login_email: str(q.email).slice(0, 254), login_return_url: back, ...(actions && { __form_actions: actions }) })(req, reply, shop);
  }));
  post('/account/login', async (req, reply, shop, body) => {
    const c = (body.customer ?? {}) as Record<string, unknown>;
    const email = str(c.email).toLowerCase();
    const keys = [`ip:${req.ip}`, `email:${email}`];
    if (!customerAccountsSettingsOf(shop).signIn.password) return back(reply, '/account/login', { type: 'customer_login', errors: { form: messages(shop.locale).t('login_failed') }, values: { email } });
    if (keys.some((k) => loginLimiter.isLimited(k))) return limited(reply, shop, '/account/login', 'customer_login');
    const customer = await authenticateCustomer(db, shop.id, email, String(c.password ?? ''));
    if (!customer) {
      keys.forEach((k) => loginLimiter.fail(k));
      return back(reply, '/account/login', { type: 'customer_login', errors: { form: messages(shop.locale).t('login_failed') }, values: { email } });
    }
    keys.forEach((k) => loginLimiter.reset(k));
    await startSession(req, reply, shop, customer);
    return back(reply, localPath(body.return_url ?? (req.query as Record<string, unknown>).return_url, '/account'));
  });

  const logout = withShop(async (req, reply) => {
    const raw = req.cookies[CUSTOMER_COOKIE];
    const un = raw ? req.unsignCookie(raw) : null;
    if (un?.valid && un.value) await destroySession(db, un.value);
    reply.clearCookie(CUSTOMER_COOKIE, { path: '/' });
    return reply.redirect('/', 302);
  });
  app.get('/account/logout', logout);
  app.post('/account/logout', logout);

  // --- email code sign-in (passwordless)
  const codeEnabled = (shop: Shop) => customerAccountsSettingsOf(shop).signIn.emailCode;
  const loginTo = (body: Record<string, any>, step: 'start' | 'code', email = '') => {
    const ret = localPath(body.return_url, '');
    const q = new URLSearchParams({ ...(step === 'code' ? { step: 'code', email } : {}), ...(ret ? { return_url: ret } : {}) }).toString();
    return `/account/login${q ? `?${q}` : ''}#email-code`;
  };
  post('/account/login/code', async (req, reply, shop, body) => {
    if (!codeEnabled(shop)) return notFound(req, reply, shop);
    const email = str(((body.customer ?? {}) as Record<string, unknown>).email).toLowerCase();
    const keys = [`ip:${req.ip}`, `email:${email}`];
    if (keys.some((k) => codeLimiter.isLimited(k))) return limited(reply, shop, loginTo(body, 'start'), 'customer_login_code');
    keys.forEach((k) => codeLimiter.fail(k));
    const r = await requestLoginCode(db, shop.id, email);
    if (!r.ok && r.reason === 'invalid_email') return back(reply, loginTo(body, 'start'), { type: 'customer_login_code', errors: { email: messages(shop.locale).t('email_invalid') }, values: { email } });
    if (r.ok) enqueueMail(renderLoginCode(shop, r.email, r.code));
    // The same answer whether or not the address is known (and when a code was just sent).
    return back(reply, loginTo(body, 'code', email));
  });
  post('/account/login/code/verify', async (req, reply, shop, body) => {
    if (!codeEnabled(shop)) return notFound(req, reply, shop);
    const c = (body.customer ?? {}) as Record<string, unknown>;
    const email = str(c.email).toLowerCase();
    const keys = [`ip:${req.ip}`, `email:${email}`];
    if (keys.some((k) => verifyLimiter.isLimited(k))) return limited(reply, shop, loginTo(body, 'code', email), 'customer_login_code_verify');
    const r = await verifyLoginCode(db, shop.id, email, str(c.code));
    if (!r.ok) {
      keys.forEach((k) => verifyLimiter.fail(k));
      const text = messages(shop.locale);
      return back(reply, loginTo(body, r.reason === 'locked' || r.reason === 'expired' ? 'start' : 'code', email), { type: 'customer_login_code_verify', errors: { form: text.t(r.reason === 'invalid' ? 'code_invalid' : 'code_expired') }, values: { email } });
    }
    keys.forEach((k) => verifyLimiter.reset(k));
    await startSession(req, reply, shop, r.customer);
    return back(reply, localPath(body.return_url ?? (req.query as Record<string, unknown>).return_url, '/account'));
  });

  // --- registration
  app.get('/account/register', withShop(async (req, reply, shop) => {
    const preview = await isEditorPreview(req, shop);
    if (!preview && (await customerOf(ctx, req, shop))) return reply.redirect('/account', 302);
    return page('register', titleOf(shop, 'Create account', 'Créer un compte'), preview ? { customer: null } : {})(req, reply, shop);
  }));
  const register = async (req: FastifyRequest, reply: FastifyReply, shop: Shop, body: Record<string, any>) => {
    const c = (body.customer ?? {}) as Record<string, unknown>;
    const key = `ip:${req.ip}`;
    if (registerLimiter.isLimited(key)) return limited(reply, shop, '/account/register', 'create_customer');
    registerLimiter.fail(key);
    const r = await registerCustomer(db, shop.id, { email: str(c.email), password: String(c.password ?? ''), firstName: str(c.first_name), lastName: str(c.last_name), acceptsMarketing: c.accepts_marketing === 'true' || c.accepts_marketing === 'on' });
    if (!r.ok) return back(reply, '/account/register', { type: 'create_customer', errors: messages(shop.locale).fieldErrors(r.errors), values: { email: str(c.email), first_name: str(c.first_name), last_name: str(c.last_name) } });
    if (r.value.activationToken) {
      // The email belongs to a guest customer: ownership must be proven by email, so an activation link is sent instead of an account.
      enqueueMail(renderAccountActivation(shop, r.value.customer.email!, `${ctx.stores.publicOrigin(shop.id)}/account/activate/${r.value.customer.id}/${r.value.activationToken}`));
      return back(reply, '/account/login', { type: 'recover_customer_password', success: true });
    }
    await startSession(req, reply, shop, r.value.customer);
    return back(reply, localPath(body.return_url, '/account'));
  };
  post('/account', register);
  post('/account/register', register);

  // --- password recovery
  app.get('/account/recover', (_req, reply) => reply.redirect('/account/login#recover', 302));
  post('/account/recover', async (req, reply, shop, body) => {
    const email = str(body.email).toLowerCase();
    const keys = [`ip:${req.ip}`, `email:${email}`];
    if (keys.some((k) => recoverLimiter.isLimited(k))) return limited(reply, shop, '/account/login#recover', 'recover_customer_password');
    keys.forEach((k) => recoverLimiter.fail(k));
    const r = email ? await requestPasswordReset(db, shop.id, email) : null;
    if (r) enqueueMail(renderPasswordReset(shop, r.customer.email!, `${ctx.stores.publicOrigin(shop.id)}/account/reset/${r.customer.id}/${r.token}`));
    // Same answer whether or not the address has an account.
    return back(reply, '/account/login#recover', { type: 'recover_customer_password', success: true });
  });

  // --- reset and activation links
  const tokenPage = (kind: 'reset' | 'activate', template: string, formType: string, title: [string, string]) => withShop(async (req, reply, shop) => {
    const { id, token } = req.params as { id: string; token: string };
    // Theme editor preview: the page is shown without a real link (its form is not wired to any customer).
    if (await isEditorPreview(req, shop)) return page(template, titleOf(shop, ...title), { customer: null, __form_actions: { [formType]: '#' } })(req, reply, shop);
    if (!/^\d+$/.test(id) || !(await isCustomerTokenValid(db, shop.id, Number(id), kind, token))) return back(reply, '/account/login', { type: 'customer_login', errors: { form: messages(shop.locale).t('token_invalid') } });
    const base = `/account/${kind}/${id}/${token}`;
    return page(template, titleOf(shop, ...title), { __form_actions: { [formType]: base } })(req, reply, shop);
  });
  app.get('/account/reset/:id/:token', tokenPage('reset', 'reset_password', 'reset_customer_password', ['Reset password', 'Réinitialiser le mot de passe']));
  app.get('/account/activate/:id/:token', tokenPage('activate', 'activate_account', 'activate_customer_password', ['Activate account', 'Activer le compte']));

  const setPassword = (kind: 'reset' | 'activate', formType: string) => async (req: FastifyRequest, reply: FastifyReply, shop: Shop, body: Record<string, any>) => {
    const p = req.params as { id?: string; token?: string };
    const id = Number(p.id ?? body.id);
    const token = String(p.token ?? body.token ?? '');
    const here = `/account/${kind}/${id}/${token}`;
    const c = (body.customer ?? {}) as Record<string, unknown>;
    const r = await setPasswordWithToken(db, shop.id, kind, id, token, String(c.password ?? ''), c.password_confirmation === undefined ? undefined : String(c.password_confirmation));
    if (!r.ok) {
      const invalid = r.errors.some((e) => e.code === 'INVALID_TOKEN');
      return invalid ? back(reply, '/account/login', { type: 'customer_login', errors: { form: messages(shop.locale).t('token_invalid') } }) : back(reply, here, { type: formType, errors: messages(shop.locale).fieldErrors(r.errors) });
    }
    await startSession(req, reply, shop, r.value);
    return back(reply, '/account');
  };
  post('/account/reset/:id/:token', setPassword('reset', 'reset_customer_password'));
  post('/account/reset', setPassword('reset', 'reset_customer_password'));
  post('/account/activate/:id/:token', setPassword('activate', 'activate_customer_password'));
  post('/account/activate', setPassword('activate', 'activate_customer_password'));

  // --- orders
  app.get('/account/orders', (_req, reply) => reply.redirect('/account', 302));
  app.get('/account/orders/:id', signedIn(async (req, reply, shop, customer) => {
    const id = Number((req.params as { id: string }).id);
    const found = Number.isInteger(id) ? await getCustomerOrder(db, shop.id, customer.id, id) : null;
    if (!found) return notFound(req, reply, shop);
    const { handles } = await productLookups(db, found.detail.lines);
    const actions = await orderActionsFor(db, shop, found.order, found.detail);
    const room = actions.returns ? await returnableQuantities(db, shop.id, found.order.id) : new Map<number, number>();
    const base = `/account/orders/${found.order.id}`;
    const order = {
      ...orderObject(found.order, shop, found.detail, handles),
      actions: {
        reorder: actions.reorder, cancel: actions.cancel, return: actions.returns, cancel_until: actions.cancelUntil?.toISOString() ?? null, reorder_url: `${base}/reorder`, cancel_url: `${base}/cancel`, return_url: `${base}/return`,
        return_lines: found.detail.lines.filter((l) => (room.get(l.id) ?? 0) > 0).map((l) => ({ id: l.id, title: l.title, variant_title: l.variantTitle ?? '', max: room.get(l.id) ?? 0 })),
      },
    };
    return page('order', `${titleOf(shop, 'Order', 'Commande')} ${found.order.name}`, { order, order_notice: str((req.query as Record<string, unknown>).notice) })(req, reply, shop);
  }, async (req, reply, shop) => {
    const order = sampleOrder(shop);
    return page('order', `${titleOf(shop, 'Order', 'Commande')} ${order.name}`, { customer: sampleCustomer(shop), order })(req, reply, shop);
  }));
  const ownOrder = async (req: FastifyRequest, shop: Shop, customer: Customer) => {
    const id = Number((req.params as { id: string }).id);
    return Number.isInteger(id) ? getCustomerOrder(db, shop.id, customer.id, id) : null;
  };
  post('/account/orders/:id/cancel', async (req, reply, shop) => {
    const customer = await customerOf(ctx, req, shop);
    if (!customer) return back(reply, '/account/login');
    const found = await ownOrder(req, shop, customer);
    if (!found) return notFound(req, reply, shop);
    const r = await customerCancelOrder(db, shop, customer.id, found.order.id, found.detail, undefined, await gatewaysFor(app, shop.id));
    return back(reply, `/account/orders/${found.order.id}?notice=${r.ok ? 'cancel_ok' : 'cancel_failed'}`);
  });
  post('/account/orders/:id/return', async (req, reply, shop, body) => {
    const customer = await customerOf(ctx, req, shop);
    if (!customer) return back(reply, '/account/login');
    const found = await ownOrder(req, shop, customer);
    if (!found) return notFound(req, reply, shop);
    const wanted = Object.entries((body.return ?? {}) as Record<string, unknown>).map(([id, q]) => ({ orderLineId: Number(id), quantity: Number(q) })).filter((l) => Number.isInteger(l.orderLineId) && l.quantity > 0);
    const r = wanted.length ? await customerRequestReturn(db, shop, customer.id, found.order.id, found.detail, wanted.map((l) => ({ ...l, reason: 'UNKNOWN' })), str(body.note)) : null;
    return back(reply, `/account/orders/${found.order.id}?notice=${r?.ok ? 'return_ok' : 'return_failed'}`);
  });
  post('/account/orders/:id/reorder', async (req, reply, shop) => {
    const customer = await customerOf(ctx, req, shop);
    if (!customer) return back(reply, '/account/login');
    const found = await ownOrder(req, shop, customer);
    if (!found) return notFound(req, reply, shop);
    if (!customerAccountsSettingsOf(shop).orderActions.reorder) return back(reply, `/account/orders/${found.order.id}`);
    const token = (req.cookies[CART_COOKIE] ?? '').split('?')[0]!.split('%3F')[0]!;
    const cart = await getOrCreateCart(db, shop.id, shop.currency, token || null);
    await addItems(db, shop.id, cart.id, found.detail.lines.filter((l) => l.variantId != null).map((l) => ({ id: l.variantId, quantity: l.currentQuantity || l.quantity, properties: l.properties })));
    reply.setCookie(CART_COOKIE, cart.token, { path: '/', sameSite: 'lax', httpOnly: false, maxAge: 90 * 24 * 3600, secure });
    return reply.redirect('/cart', 303);
  });

  // --- address book
  const addressesTitle = (shop: Shop) => titleOf(shop, 'Addresses', 'Adresses');
  app.get('/account/addresses', signedIn(async (req, reply, shop) => page('addresses', addressesTitle(shop))(req, reply, shop), async (req, reply, shop) => page('addresses', addressesTitle(shop), { customer: sampleCustomer(shop) })(req, reply, shop)));

  const COUNTRIES = (locale: string) => countryOptions(null, locale);
  /** Form `address[...]` -> address input. `country` may be an ISO code or a country name; `province` a code or a name. */
  function addressFrom(a: Record<string, unknown>, shop: Shop): CustomerAddressInput {
    const rawCountry = str(a.country_code) || str(a.country);
    const country = /^[A-Za-z]{2}$/.test(rawCountry) ? rawCountry.toUpperCase() : COUNTRIES('en').concat(COUNTRIES(shop.locale)).find((c) => c.name.toLowerCase() === rawCountry.toLowerCase())?.code ?? '';
    const rawProvince = str(a.province_code) || str(a.province);
    const known = PROVINCES[country]?.find((p) => p.code === rawProvince.toUpperCase() || p.name.toLowerCase() === rawProvince.toLowerCase());
    return {
      firstName: str(a.first_name), lastName: str(a.last_name), company: str(a.company), address1: str(a.address1), address2: str(a.address2), city: str(a.city), zip: str(a.zip), phone: str(a.phone), countryCode: country,
      provinceCode: known?.code ?? null, province: known?.name ?? (rawProvince || null),
    };
  }

  post('/account/addresses', async (req, reply, shop, body) => {
    const customer = await customerOf(ctx, req, shop);
    if (!customer) return back(reply, '/account/login');
    const a = (body.address ?? {}) as Record<string, unknown>;
    const r = await addCustomerAddress(db, shop.id, customer.id, addressFrom(a, shop), a.default === '1' || a.default === 'true' || a.default === 'on');
    return back(reply, '/account/addresses', r.ok ? undefined : { type: 'customer_address', errors: messages(shop.locale).fieldErrors(r.errors), values: Object.fromEntries(Object.entries(a).filter(([, v]) => typeof v === 'string')) as Record<string, string> });
  });
  post('/account/addresses/:id', async (req, reply, shop, body) => {
    const customer = await customerOf(ctx, req, shop);
    if (!customer) return back(reply, '/account/login');
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return back(reply, '/account/addresses');
    const method = str(body._method).toLowerCase();
    if (method === 'delete') { await deleteCustomerAddress(db, shop.id, customer.id, id); return back(reply, '/account/addresses'); }
    const a = (body.address ?? {}) as Record<string, unknown>;
    const r = await updateCustomerAddress(db, shop.id, customer.id, id, addressFrom(a, shop), a.default === '1' || a.default === 'true' || a.default === 'on');
    return back(reply, '/account/addresses', r.ok ? undefined : { type: 'customer_address', errors: messages(shop.locale).fieldErrors(r.errors) });
  });
  app.delete('/account/addresses/:id', withShop(async (req, reply, shop) => {
    const customer = await customerOf(ctx, req, shop);
    if (!customer) return reply.code(401).send('');
    if (crossSite(req)) return reply.code(403).send('');
    await deleteCustomerAddress(db, shop.id, customer.id, Number((req.params as { id: string }).id));
    return reply.redirect('/account/addresses', 303);
  }));

}
