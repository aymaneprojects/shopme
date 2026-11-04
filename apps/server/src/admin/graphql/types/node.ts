import { GraphQLError } from 'graphql';
import { fromGid, toGid } from '@shopme/shopify-compat';
import { builder } from '../builder';
import type { GraphQLContext } from '../context';

/** What every Node-implementing object shape must have: the numeric database id. */
export interface NodeShape { id: number }
type Loader = (ctx: GraphQLContext, id: number) => Promise<NodeShape | null>;
const loaders = new Map<string, Loader>();

/**
 * Register how `node(id:)` / `nodes(ids:)` load a type. The GID's type name selects the loader.
 * Loaders must filter by `ctx.shopId` so another shop's id resolves to null.
 *   registerNode('Product', (ctx, id) => getProduct(ctx.db, ctx.shopId, id));
 */
export function registerNode(typeName: string, loader: Loader): void {
  loaders.set(typeName, loader);
}

export async function loadNode(ctx: GraphQLContext, gid: string): Promise<(NodeShape & { __typename: string }) | null> {
  const parsed = fromGid(gid);
  if (!parsed) throw new GraphQLError(`Invalid global id '${gid}'`, { extensions: { code: 'INVALID_GLOBAL_ID' } });
  const loader = loaders.get(parsed.type);
  if (!loader) return null;
  const node = await loader(ctx, parsed.id);
  return node ? Object.assign(node, { __typename: parsed.type }) : null;
}

/**
 * `Node` interface. Objects implement it with `interfaces: [Node]`; the inherited `id` resolves to
 * `gid://shopify/<GraphQL type name>/<db id>` automatically from the concrete type name.
 */
export const Node = builder.interfaceRef<NodeShape & { __typename?: string }>('Node').implement({
  fields: (t) => ({
    id: t.id({ resolve: (n, _a, _c, info) => toGid(info.parentType.name, n.id) }),
  }),
  resolveType: (n) => (n as { __typename?: string }).__typename ?? '',
});

/** `legacyResourceId` helper: the numeric id as a string (UnsignedInt64). Use `resolve: legacyId`. */
export const legacyId = (n: NodeShape) => String(n.id);
