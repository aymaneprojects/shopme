import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getShop } from '@shopme/core';
import { accountOf, authenticate } from '../plugins/auth';
import type { EmailInput } from './service';

const input = z.object({
  mode: z.enum(['direct', 'relay']).nullable().optional(), preset: z.string().max(40).nullable().optional(), host: z.string().max(253).nullable().optional(), port: z.number().int().nullable().optional(),
  security: z.string().max(20).nullable().optional(), username: z.string().max(200).nullable().optional(), password: z.string().max(500).nullable().optional(), clearPassword: z.boolean().nullable().optional(),
  manualPublicIp: z.string().max(100).nullable().optional(), dmarcReportEmail: z.string().max(200).nullable().optional(),
});

const page = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#1f2937}button{font:inherit;padding:.6rem 1.1rem;border-radius:.4rem;border:0;background:#1e40af;color:#fff;cursor:pointer}</style></head><body>${body}</body></html>`;

/**
 * E-mail routes.
 *   GET|POST /unsubscribe/:token                      List-Unsubscribe target of marketing mail (signed token; POST is the one-click form)
 *   GET|PUT  /admin/api/platform/email/settings       installation sending identity (the fallback From): settings view / update
 *   GET      /admin/api/platform/email/records        DNS records to publish     POST .../check  live checks
 *   POST     .../dkim/rotate, .../dkim/activate       key rotation               POST .../test   test e-mail
 *   GET      .../outbox                                latest messages
 * The platform routes belong to the platform owner (multi-store) or to the store's administrators (single-store).
 */
export function registerEmailRoutes(app: FastifyInstance) {
  const { config } = app.ctx;
  const email = () => app.ctx.email;

  // ---- unsubscribe ----
  void app.register(async (scope) => {
    scope.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => done(null, body));
    scope.get('/unsubscribe/:token', async (req, reply) => {
      const token = (req.params as { token: string }).token;
      const t = email().readUnsubscribeToken(token);
      if (!t) return reply.code(404).type('text/html').send(page('Unsubscribe', '<p>This link is not valid.</p>'));
      const shop = await getShop(app.ctx.db, t.shopId);
      const fr = (shop?.locale ?? 'en').toLowerCase().startsWith('fr');
      return reply.type('text/html').send(page(fr ? 'Se désabonner' : 'Unsubscribe', fr
        ? `<h1>Se désabonner</h1><p>Vous ne recevrez plus d’e-mails promotionnels de ${shop?.name ?? 'cette boutique'}.</p><form method="post"><button>Confirmer</button></form>`
        : `<h1>Unsubscribe</h1><p>You will no longer receive promotional e-mails from ${shop?.name ?? 'this store'}.</p><form method="post"><button>Confirm</button></form>`));
    });
    scope.post('/unsubscribe/:token', async (req, reply) => {
      const ok = await email().unsubscribe((req.params as { token: string }).token);
      if (!ok) return reply.code(404).type('text/html').send(page('Unsubscribe', '<p>This link is not valid.</p>'));
      return reply.type('text/html').send(page('Unsubscribe', '<h1>✓</h1><p>You are unsubscribed. / Vous êtes désabonné(e).</p>'));
    });
  });

  // ---- platform identity ----
  async function guard(req: FastifyRequest, reply: FastifyReply, write: boolean): Promise<boolean> {
    if (config.multiStore) {
      const s = await accountOf(req);
      if (!s) { reply.code(401).send({ error: 'Not authenticated' }); return false; }
      if (!s.account.platformOwner) { reply.code(403).send({ error: 'Only the platform owner can do this' }); return false; }
      return true;
    }
    const auth = await authenticate(req);
    if (!auth) { reply.code(req.authDenied ? 403 : 401).send({ error: req.authDenied ? 'You do not have access to this store' : 'Not authenticated' }); return false; }
    const ok = auth.scopes.includes('*') || auth.scopes.includes('write_shop') || (!write && auth.scopes.includes('read_shop'));
    if (!ok) { reply.code(403).send({ error: `Access denied. Required access: ${write ? 'write_shop' : 'read_shop'}` }); return false; }
    return true;
  }
  const base = '/admin/api/platform/email';
  app.get(`${base}/settings`, async (req, reply) => { if (!(await guard(req, reply, false))) return; return email().view(null); });
  app.put(`${base}/settings`, async (req, reply) => {
    if (!(await guard(req, reply, true))) return;
    const body = input.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid input' });
    const r = await email().updateSettings(null, body.data as EmailInput);
    if ('errors' in r) return reply.code(422).send({ error: r.errors.map((e) => e.message).join(' · '), errors: r.errors });
    return email().view(null);
  });
  app.get(`${base}/records`, async (req, reply) => { if (!(await guard(req, reply, false))) return; return email().records(null); });
  app.post(`${base}/check`, async (req, reply) => { if (!(await guard(req, reply, true))) return; return email().check(null); });
  app.post(`${base}/dkim/rotate`, async (req, reply) => { if (!(await guard(req, reply, true))) return; await email().rotateKey(null); return email().records(null); });
  app.post(`${base}/dkim/activate`, async (req, reply) => { if (!(await guard(req, reply, true))) return; await email().activateKey(null); return email().records(null); });
  app.get(`${base}/outbox`, async (req, reply) => { if (!(await guard(req, reply, false))) return; return { messages: await email().outbox(null) }; });
  app.post(`${base}/test`, async (req, reply) => {
    if (!(await guard(req, reply, true))) return;
    const to = z.object({ to: z.string().trim().max(200) }).safeParse(req.body);
    if (!to.success || !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(to.data.to)) return reply.code(422).send({ error: 'Enter a valid e-mail address' });
    const wait = email().testRateLimit(null);
    if (wait) return reply.code(429).header('retry-after', String(wait)).send({ error: 'Too many test e-mails. Try again later.' });
    return email().sendTest(null, to.data.to);
  });
}
