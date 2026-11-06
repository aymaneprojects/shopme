import { GraphQLError } from 'graphql';
import type { FastifyRequest } from 'fastify';
import type { Db } from '@shopme/core';
import type { AppContext, AuthInfo } from '../../context';

export interface GraphQLContext {
  app: AppContext;
  db: Db;
  /** Tenant of the caller. Pass to every service function. */
  shopId: number;
  auth: AuthInfo;
  request: FastifyRequest;
  /** Base of the store's storefront links: APP_URL (single-store), the store's permanent host (multi-store). */
  storeUrl: string;
}

export const createGraphQLContext = (request: FastifyRequest, auth: AuthInfo): GraphQLContext =>
  ({ app: request.server.ctx, db: request.server.ctx.db, shopId: auth.shopId, auth, request, storeUrl: request.server.ctx.stores.storefrontBase(auth.shopId) });

/** Throw an ACCESS_DENIED error unless the caller holds `scope` (or `write_x` for `read_x`). Staff sessions hold all. */
export function requireScope(ctx: GraphQLContext, scope: string): void {
  const have = ctx.auth.scopes;
  const alt = scope.startsWith('read_') ? `write_${scope.slice(5)}` : null;
  if (have.includes('*') || have.includes(scope) || (alt && have.includes(alt))) return;
  throw new GraphQLError(`Access denied. Required access: ${scope}`, { extensions: { code: 'ACCESS_DENIED' } });
}
