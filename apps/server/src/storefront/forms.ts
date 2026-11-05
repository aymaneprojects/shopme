import type { FastifyReply, FastifyRequest } from 'fastify';
import { isValidEmail, renderContactMessage, subscribeNewsletter, type Mail } from '@shopme/core';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { FailureLimiter } from '../plugins/rate-limit';
import { nestKeys } from './cart-routes';
import { setFlash } from './flash';
import { messages } from './i18n';
import type { createContent } from './pages';

/** Form body as nested objects: `contact[email]=x` becomes `{ contact: { email: 'x' } }`. */
export function formBody(req: FastifyRequest): Record<string, any> {
  return req.body && typeof req.body === 'object' ? nestKeys(req.body as Record<string, unknown>) : {};
}

/** Where to send the visitor after a POST: `return_to`/`return_url` when it is a local path, else the page the form was on (Referer), else `fallback`. */
export function returnPath(req: FastifyRequest, fallback = '/'): string {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const asked = String(body.return_to ?? body.return_url ?? '');
  if (asked.startsWith('/') && !asked.startsWith('//')) return asked;
  try {
    const ref = new URL(String(req.headers.referer ?? ''));
    if (ref.host === req.headers.host) return ref.pathname;
  } catch { /* no usable referer */ }
  return fallback;
}

/** Reject form posts that come from another site (SameSite=Lax cookies already prevent most CSRF; this covers the rest). */
export function crossSite(req: FastifyRequest): boolean {
  const origin = req.headers.origin;
  if (!origin) return req.headers['sec-fetch-site'] === 'cross-site';
  try { return new URL(origin).host !== req.headers.host; } catch { return true; }
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** `POST /contact`: `form 'contact'` mails the shop owner, `form 'customer'` (newsletter) subscribes the visitor to marketing. */
export function registerFormRoutes(app: FastifyInstance, ctx: AppContext, content: ReturnType<typeof createContent>): void {
  const { db } = ctx;
  const limiter = new FailureLimiter(8, 10 * 60 * 1000);
  const secure = ctx.config.appUrl.startsWith('https://');

  ctx.queue.register<Mail>('mail.send', async (mail) => { await ctx.mailer.send(mail); });

  app.post('/contact', content.withShop(async (req, reply: FastifyReply, shop) => {
    if (crossSite(req)) return reply.code(403).send('');
    const body = formBody(req);
    const type = str(body.form_type) === 'customer' ? 'customer' : 'contact';
    const back = returnPath(req, type === 'customer' ? '/' : '/pages/contact');
    const fields = (body.contact ?? {}) as Record<string, unknown>;
    const { fieldErrors } = messages(shop.locale);
    const key = `ip:${req.ip}`;
    const fail = (errors: Record<string, string>) => { setFlash(reply, { type, errors, values: Object.fromEntries(Object.entries(fields).filter(([, v]) => typeof v === 'string')) as Record<string, string> }, secure); return reply.redirect(`${back}#contact_form`, 303); };
    if (limiter.isLimited(key)) return fail(fieldErrors([{ field: ['form'], message: messages(shop.locale).t('rate_limited') }]));
    limiter.fail(key);

    const email = str(fields.email);
    if (type === 'customer') {
      const tags = str(fields.tags).split(',').map((t) => t.trim()).filter(Boolean);
      const r = await subscribeNewsletter(db, shop.id, { email, tags });
      if (!r.ok) return fail(fieldErrors(r.errors));
      setFlash(reply, { type, success: true }, secure);
      return reply.redirect(`${back}${back.includes('?') ? '&' : '?'}customer_posted=true#contact_form`, 303);
    }
    if (!email || !isValidEmail(email)) return fail(fieldErrors([{ field: ['email'], message: 'Email is invalid', code: email ? 'INVALID' : 'BLANK' }]));
    const { name, phone, body: text, email: _e, tags: _t, ...rest } = fields;
    const extra = Object.fromEntries(Object.entries(rest).filter(([, v]) => typeof v === 'string' && v).map(([k, v]) => [k, String(v).slice(0, 500)]));
    ctx.queue.enqueue<Mail>('mail.send', renderContactMessage(shop, { name: str(name).slice(0, 200), email, phone: str(phone).slice(0, 50), body: str(text).slice(0, 5000), extra }));
    setFlash(reply, { type, success: true }, secure);
    return reply.redirect(`${back}${back.includes('?') ? '&' : '?'}contact_posted=true#contact_form`, 303);
  }));
}
