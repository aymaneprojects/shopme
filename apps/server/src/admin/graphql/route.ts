import type { FastifyInstance } from 'fastify';
import { createYoga } from 'graphql-yoga';
import { parse, type OperationDefinitionNode } from 'graphql';
import { authenticate } from '../../plugins/auth';
import { useCostExtension } from './cost';
import { createGraphQLContext, type GraphQLContext } from './context';
import { schema } from './schema';

const VERSION_RE = /^(\d{4}-\d{2}|unstable)$/;

/** True when the request body runs a mutation (the named operation, or the only one). */
function isMutation(body: unknown): boolean {
  const b = body as { query?: unknown; operationName?: unknown } | null;
  if (!b || typeof b.query !== 'string') return false;
  try {
    const ops = parse(b.query).definitions.filter((d): d is OperationDefinitionNode => d.kind === 'OperationDefinition');
    const op = typeof b.operationName === 'string' ? ops.find((o) => o.name?.value === b.operationName) : ops[0];
    return op?.operation === 'mutation';
  } catch { return false; }
}

/** `POST /admin/api/:version/graphql.json`. Auth: session cookie or `X-Shopify-Access-Token`. */
export function registerAdminGraphQL(app: FastifyInstance) {
  const yoga = createYoga<{ gql: GraphQLContext }>({
    schema,
    graphqlEndpoint: '/admin/api/:version/graphql.json',
    landingPage: false,
    graphiql: false,
    logging: 'warn',
    maskedErrors: app.ctx.config.env === 'production',
    context: ({ gql }) => gql,
    plugins: [useCostExtension()],
  });

  app.route({
    url: '/admin/api/:version/graphql.json',
    method: ['POST', 'OPTIONS'],
    handler: async (req, reply) => {
      const { version } = req.params as { version: string };
      if (!VERSION_RE.test(version)) return reply.code(404).send({ errors: `Unknown API version ${version}` });
      if (req.method === 'OPTIONS') return reply.code(204).send();
      const auth = await authenticate(req);
      if (!auth && req.authDenied) return reply.code(403).send({ errors: 'Forbidden: this account is not a staff member of this store' });
      if (!auth) return reply.code(401).send({ errors: 'Unauthorized: missing or invalid access token or session' });
      // A suspended store (multi-store) is read-only: queries run, mutations are refused.
      if (app.ctx.stores.info(auth.shopId)?.status === 'SUSPENDED' && isMutation(req.body)) {
        return reply.code(200).send({ errors: [{ message: 'This store is suspended: its admin is read-only.', extensions: { code: 'STORE_SUSPENDED' } }] });
      }
      // Yoga matches its endpoint on the raw request's original URL: give it the routed one (multi-store admin URLs carry `/admin/store/<handle>`).
      const raw = req.raw as typeof req.raw & { originalUrl?: string };
      if (raw.originalUrl && raw.originalUrl !== req.url) raw.originalUrl = req.url;
      const response = await yoga.handleNodeRequestAndResponse(req, reply, { gql: createGraphQLContext(req, auth) });
      response.headers.forEach((value, key) => { reply.header(key, value); });
      reply.status(response.status);
      return reply.send(response.body);
    },
  });
}
