import type { FastifyInstance } from 'fastify';
import { createYoga } from 'graphql-yoga';
import { authenticate } from '../../plugins/auth';
import { useCostExtension } from './cost';
import { createGraphQLContext, type GraphQLContext } from './context';
import { schema } from './schema';

const VERSION_RE = /^(\d{4}-\d{2}|unstable)$/;

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
      if (!auth) return reply.code(401).send({ errors: 'Unauthorized: missing or invalid access token or session' });
      const response = await yoga.handleNodeRequestAndResponse(req, reply, { gql: createGraphQLContext(req, auth) });
      response.headers.forEach((value, key) => { reply.header(key, value); });
      reply.status(response.status);
      return reply.send(response.body);
    },
  });
}
