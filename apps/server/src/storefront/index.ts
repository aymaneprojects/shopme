import type { FastifyInstance } from 'fastify';

/**
 * Storefront mount point. The storefront agent replaces this placeholder with the Liquid renderer,
 * the Ajax cart API (/cart/*.js) and the content routes (/products/*, /collections/*, /pages/*, ...).
 * Registered last, so admin routes (/admin/*), /files/*, /healthz and /checkout/* take precedence.
 */
export async function registerStorefront(app: FastifyInstance): Promise<void> {
  app.get('/', async (_req, reply) =>
    reply.type('text/html; charset=utf-8').send(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ShopMe</title>' +
      '<body style="font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;line-height:1.5">' +
      '<h1>Storefront coming soon</h1><p>Your ShopMe server is running. The storefront is not available yet.</p>' +
      '<p><a href="/admin/">Open the admin</a></p></body>'));
}
