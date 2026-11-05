import { createRequire } from 'node:module';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { createInProcessQueue, createLocalStorage, createMailer, ensureSearchExtensions, type AppConfig, type DbHandle } from '@shopme/core';
import { registerAuthRoutes } from './admin/auth-routes';
import { registerBackupRoutes } from './admin/backup-routes';
import { registerReportRoutes } from './admin/report-routes';
import { registerTwoFactorRoutes } from './admin/two-factor-routes';
import { registerDataRoutes } from './admin/data-routes';
import { registerFileUploadRoute } from './admin/files-routes';
import { registerAdminGraphQL } from './admin/graphql/route';
import { registerAdminSpa, registerFilesStatic } from './admin/spa';
import { registerCheckout } from './checkout';
import type { AppContext } from './context';
import { registerJobs } from './jobs';
import { registerSubscriptionJobs } from './subscriptions';
import { LocaleCache } from './locale-cache';
import { registerOpsRoutes } from './ops-routes';
import { resolvePaths, type ServerPaths } from './paths';
import { installOriginCheck } from './plugins/auth';
import { registerSecurity } from './security';
import { registerStorefront } from './storefront';
import { registerWebhooks } from './webhooks';

export const APP_VERSION = '0.1.0';

export interface BuildAppOptions {
  config: AppConfig;
  dbHandle: DbHandle;
  paths?: Partial<ServerPaths>;
  /** false disables logging (tests). Default: pino at config.logLevel. */
  logger?: boolean;
}

function loggerOptions(config: AppConfig, enabled: boolean) {
  if (!enabled) return false;
  const base = { level: config.logLevel, redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-shopify-access-token"]'] };
  if (config.env === 'development' && process.stdout.isTTY) {
    try {
      createRequire(import.meta.url).resolve('pino-pretty');
      return { ...base, transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } };
    } catch { /* pino-pretty not installed (production image): JSON logs */ }
  }
  return base;
}

/** `X-Robots-Tag` for paths that must not be indexed (matches the reference store: search, discount links, checkouts). */
export function robotsHeader(path: string, status: number): string | null {
  if (path.startsWith('/checkout') || path.startsWith('/checkouts/')) return 'none';
  if (path.startsWith('/admin') || path.startsWith('/search') || path.startsWith('/discount/') || path === '/cart' || path.startsWith('/account')) return 'noindex, nofollow';
  return status === 301 || status === 302 ? 'noindex' : null;
}

/** Build the Fastify app without listening (used by startServer and by tests via `app.inject`). */
export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const { config, dbHandle } = opts;
  const locales = new LocaleCache();
  const app = Fastify({ logger: loggerOptions(config, opts.logger ?? true), trustProxy: config.trustProxy, bodyLimit: 2 * 1024 * 1024, routerOptions: { maxParamLength: 600 }, rewriteUrl: (req) => locales.rewrite(req) });

  const ctx: AppContext = {
    config, db: dbHandle.db, dbHandle, paths: resolvePaths(opts.paths), log: app.log,
    queue: createInProcessQueue(app.log),
    mailer: createMailer({ smtpUrl: config.smtpUrl, from: config.mailFrom, logger: app.log }),
    storage: createLocalStorage(config.storageDir),
    locales, appVersion: APP_VERSION,
  };
  app.decorate('ctx', ctx);
  if (dbHandle.driver === 'postgres') await ensureSearchExtensions(ctx.db); // pg_trgm for typo tolerance when the server allows it
  app.decorateRequest('auth', null);

  await app.register(cookie, { secret: config.sessionSecret });
  registerSecurity(app);
  app.addHook('onSend', async (req, reply) => {
    const robots = robotsHeader(req.url.split('?')[0]!, reply.statusCode);
    if (robots && !reply.hasHeader('x-robots-tag')) reply.header('x-robots-tag', robots);
  });
  installOriginCheck(app);

  app.get('/healthz', async (_req, reply) => {
    try {
      await ctx.db.execute('select 1' as never);
      return { status: 'ok', db: dbHandle.driver };
    } catch {
      return reply.code(503).send({ status: 'error' });
    }
  });

  registerAuthRoutes(app);
  registerTwoFactorRoutes(app);
  registerReportRoutes(app);
  registerBackupRoutes(app);
  registerFileUploadRoute(app);
  registerDataRoutes(app);
  registerAdminGraphQL(app);
  registerFilesStatic(app);
  registerAdminSpa(app);
  await registerCheckout(app);
  registerSubscriptionJobs(app);
  await registerWebhooks(app);
  await registerOpsRoutes(app);
  await registerStorefront(app); // last: owns "/" and (later) catch-all storefront routes
  const stopEvents = registerJobs(ctx);

  app.addHook('onClose', async () => { stopEvents(); await ctx.queue.stop(); });
  return app;
}
