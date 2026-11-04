import { GraphQLError } from 'graphql';
import type { ObjectRef } from '@pothos/core';
import { builder } from '../builder';

export const MAX_PAGE_SIZE = 250;

export interface PageInfoShape { hasNextPage: boolean; hasPreviousPage: boolean; startCursor: string | null; endCursor: string | null }
export interface Connection<T> { edges: { cursor: string; node: T }[]; nodes: T[]; pageInfo: PageInfoShape }
export interface PageArgs { first?: number | null; after?: string | null; last?: number | null; before?: string | null; reverse?: boolean | null }

const PageInfo = builder.objectRef<PageInfoShape>('PageInfo').implement({
  fields: (t) => ({
    hasNextPage: t.exposeBoolean('hasNextPage'),
    hasPreviousPage: t.exposeBoolean('hasPreviousPage'),
    startCursor: t.exposeString('startCursor', { nullable: true }),
    endCursor: t.exposeString('endCursor', { nullable: true }),
  }),
});

/** Reusable args for connection fields: `args: ConnectionArgs`. Add `sortKey`/`query` per field as needed. */
export const ConnectionArgs = builder.args((t) => ({
  first: t.int(), after: t.string(), last: t.int(), before: t.string(), reverse: t.boolean({ defaultValue: false }),
}));

/**
 * Define `<Name>Connection` and `<Name>Edge` for a node type.
 *   const ProductConnection = defineConnection('Product', ProductRef);
 *   // in a field: type: ProductConnection, args: ConnectionArgs, resolve: (_, args, ctx) => paginate(args, {...})
 */
export function defineConnection<T>(name: string, nodeRef: ObjectRef<any, T>) {
  const Edge = builder.objectRef<{ cursor: string; node: T }>(`${name}Edge`).implement({
    fields: (t) => ({ cursor: t.exposeString('cursor'), node: t.field({ type: nodeRef as never, resolve: (e) => e.node as never }) }),
  });
  return builder.objectRef<Connection<T>>(`${name}Connection`).implement({
    fields: (t) => ({
      edges: t.field({ type: [Edge], resolve: (c) => c.edges }),
      nodes: t.field({ type: [nodeRef] as never, resolve: (c) => c.nodes as never }),
      pageInfo: t.field({ type: PageInfo, resolve: (c) => c.pageInfo }),
    }),
  });
}

const encode = (i: number) => Buffer.from(`c:${i}`).toString('base64url');
function decode(cursor: string): number {
  const m = /^c:(\d+)$/.exec(Buffer.from(cursor, 'base64url').toString());
  if (!m) throw new GraphQLError('Invalid cursor', { extensions: { code: 'INVALID_CURSOR' } });
  return Number(m[1]);
}

export interface PageSource<T> {
  /** Fetch rows [offset, offset+limit) in the final order (apply `args.reverse` yourself). */
  fetch(range: { offset: number; limit: number }): Promise<T[]>;
  /** Total row count. Only needed when the client uses `last` without `before`. */
  total?: () => Promise<number>;
}

/** Relay-style pagination (first/after/last/before) over an offset-addressable source. Cursors are opaque. */
export async function paginate<T>(args: PageArgs, src: PageSource<T>): Promise<Connection<T>> {
  const first = args.first ?? undefined;
  const last = args.last ?? undefined;
  if (first == null && last == null) throw new GraphQLError('You must provide one of first or last', { extensions: { code: 'BAD_REQUEST' } });
  const size = first ?? last!;
  if (size < 0 || size > MAX_PAGE_SIZE) throw new GraphQLError(`Page size must be between 0 and ${MAX_PAGE_SIZE}`, { extensions: { code: 'BAD_REQUEST' } });

  let start: number;
  let rows: T[];
  let hasNext: boolean;
  let hasPrev: boolean;
  if (first != null) {
    start = args.after ? decode(args.after) + 1 : 0;
    const got = await src.fetch({ offset: start, limit: first + 1 });
    hasNext = got.length > first;
    rows = got.slice(0, first);
    hasPrev = start > 0;
  } else {
    let end: number;
    if (args.before) end = decode(args.before);
    else if (src.total) end = await src.total();
    else throw new GraphQLError('This connection does not support `last` without `before`', { extensions: { code: 'BAD_REQUEST' } });
    start = Math.max(0, end - size);
    rows = end > start ? await src.fetch({ offset: start, limit: end - start }) : [];
    hasPrev = start > 0;
    hasNext = args.before != null;
  }
  const edges = rows.map((node, i) => ({ cursor: encode(start + i), node }));
  return {
    edges, nodes: rows,
    pageInfo: { hasNextPage: hasNext, hasPreviousPage: hasPrev, startCursor: edges[0]?.cursor ?? null, endCursor: edges.at(-1)?.cursor ?? null },
  };
}

/** Convenience for small in-memory lists. */
export const paginateArray = <T>(args: PageArgs, all: T[]) =>
  paginate(args, { fetch: async ({ offset, limit }) => all.slice(offset, offset + limit), total: async () => all.length });
