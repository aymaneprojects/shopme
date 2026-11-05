import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { registerAccountRoutes } from './accounts';
import { registerBlogRoutes } from './blogs';
import { registerCartRoutes } from './cart-routes';
import { registerFormRoutes } from './forms';
import { registerLocalizationRoutes } from './locale';
import { registerCountryParam } from './market';
import { registerGiftCardRoutes } from './gift-cards';
import { registerSeoRoutes } from './seo';
import { registerVisitTracking } from './visits';
import { primaryShop } from './env';
import { createContent } from './pages';
import { ThemeStore } from './theme-store';

/**
 * Storefront mount point: Ajax cart API, content routes (/, /collections, /products, /cart, /search, /pages, ...),
 * JSON catalog endpoints, theme assets and the password gate. Registered last, so admin routes (/admin/*),
 * /files/*, /healthz and /checkout take precedence; unknown GET paths render the theme's 404 template.
 */
export async function registerStorefront(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const store = new ThemeStore(ctx);
  const content = createContent(ctx, store);
  await ctx.locales.refresh(ctx.db);

  await app.register(async (scope) => {
    // Forms: the theme posts urlencoded or multipart; both end up as plain key/value objects on `req.body`.
    scope.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(body as string)));
    });
    await scope.register(multipart, { attachFieldsToBody: 'keyValues', limits: { fileSize: 1024 * 1024, files: 0 } });
    registerVisitTracking(scope, ctx);
    registerCountryParam(scope, ctx);
    registerLocalizationRoutes(scope, ctx);
    registerCartRoutes(scope, ctx, content.renderSections);
    registerAccountRoutes(scope, ctx, content);
    registerBlogRoutes(scope, ctx, content);
    registerFormRoutes(scope, ctx, content);
    registerGiftCardRoutes(scope, ctx, content, store);
    registerSeoRoutes(scope, ctx, content);
    content.register(scope);
  });

  // Install the default theme right away when a shop already exists (seeded or set up before this start).
  void primaryShop(ctx).then((shop) => (shop ? store.main(shop.id) : undefined)).catch((e) => ctx.log.warn({ err: e }, 'default theme install failed'));
}
