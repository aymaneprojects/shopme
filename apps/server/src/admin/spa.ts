import { existsSync, mkdirSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { adminBuilt } from '../paths';

const NOT_BUILT = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ShopMe admin</title><body style="font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;line-height:1.5">
<h1>Admin not built</h1><p>The ShopMe server is running, but the admin interface has not been built yet.</p>
<p>Run <code>pnpm --filter @shopme/admin build</code> and reload, or use the API directly (<code>/admin/api/setup/status</code>).</p></body>`;

/** Serve the built admin SPA at /admin/* with history fallback; or a friendly page when it is not built. */
export function registerAdminSpa(app: FastifyInstance) {
  const { paths } = app.ctx;
  app.register(async (scope) => {
    scope.addHook('onSend', async (_req, reply) => { reply.header('x-frame-options', 'SAMEORIGIN'); });
    const apiNotFound = (url: string) => url.startsWith('/admin/api/');
    if (!adminBuilt(paths)) {
      scope.get('/admin', async (_r, reply) => reply.type('text/html').send(NOT_BUILT));
      scope.get('/admin/*', async (req, reply) =>
        apiNotFound(req.url) ? reply.code(404).send({ error: 'Not found' }) : reply.type('text/html').send(NOT_BUILT));
      return;
    }
    await scope.register(fastifyStatic, {
      root: paths.adminDist, prefix: '/admin/', index: ['index.html'],
      setHeaders(res, p) {
        res.header('cache-control', p.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    scope.get('/admin', async (_r, reply) => reply.redirect('/admin/', 301));
    scope.setNotFoundHandler(async (req, reply) => {
      if (req.method === 'GET' && !apiNotFound(req.url) && req.headers.accept?.includes('text/html')) {
        return reply.header('cache-control', 'no-cache').sendFile('index.html');
      }
      return reply.code(404).send({ error: 'Not found' });
    });
  });
}

/** Serve uploads at /files/*. Content is user supplied: sandbox it and forbid sniffing. */
export function registerFilesStatic(app: FastifyInstance) {
  const root = app.ctx.config.storageDir;
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  app.register(async (scope) => {
    await scope.register(fastifyStatic, {
      root, prefix: '/files/', index: false, dotfiles: 'deny',
      setHeaders(res) {
        res.header('x-content-type-options', 'nosniff');
        res.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
        res.header('cache-control', 'public, max-age=86400');
      },
    });
  });
}
