// Only types are imported from `graphql`: the schema comes from another copy of the library (pothos), so runtime helpers like
// `getNamedType` would fail their cross-realm checks. Everything below works on the plain AST and on duck-typed schema objects.
import type { DocumentNode, FieldNode, FragmentDefinitionNode, GraphQLCompositeType, GraphQLField, GraphQLSchema, OperationDefinitionNode, SelectionSetNode } from 'graphql';
import type { Plugin } from 'graphql-yoga';
import type { GraphQLContext } from './context';

/**
 * Query cost in the style of the Shopify Admin API: scalars cost 0, objects 1, a connection costs `2 + first * (cost of one node)`,
 * a mutation adds 10. `requestedQueryCost` is computed from the document, `actualQueryCost` from the nodes really returned.
 * Each shop has a leaky bucket (`MAX_AVAILABLE`, refilled `RESTORE_RATE` per second) reported in `throttleStatus`; requests are never refused.
 */
export const MAX_AVAILABLE = 2000;
export const RESTORE_RATE = 100;

interface Ctx { schema: GraphQLSchema; vars: Record<string, unknown>; fragments: Map<string, FragmentDefinitionNode>; data: boolean }

const FIELD = 'Field', INLINE = 'InlineFragment', FRAGMENT_DEF = 'FragmentDefinition', OPERATION = 'OperationDefinition';
type AnyType = { ofType?: AnyType; name?: string; getFields?: () => Record<string, GraphQLField<unknown, unknown>> };
const getNamedType = (t: unknown): GraphQLCompositeType => { let x = t as AnyType; while (x.ofType) x = x.ofType; return x as unknown as GraphQLCompositeType; };
const isCompositeType = (t: unknown): t is GraphQLCompositeType => typeof (t as AnyType).getFields === 'function' || (t as { constructor?: { name?: string } }).constructor?.name === 'GraphQLUnionType';

/** Value of the `first`/`last` argument (literal or variable). */
function pageArg(node: FieldNode, vars: Record<string, unknown>): number | undefined {
  for (const a of node.arguments ?? []) {
    if (a.name.value !== 'first' && a.name.value !== 'last') continue;
    const v = a.value;
    const n = v.kind === 'IntValue' ? Number(v.value) : v.kind === 'Variable' ? Number(vars[v.name.value]) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

const fieldsOf = (set: SelectionSetNode, ctx: Ctx, seen = new Set<string>()): FieldNode[] => set.selections.flatMap((s) => {
  if (s.kind === FIELD) return [s];
  if (s.kind === INLINE) return fieldsOf(s.selectionSet, ctx, seen);
  if (seen.has(s.name.value)) return [];
  seen.add(s.name.value);
  const f = ctx.fragments.get(s.name.value);
  return f ? fieldsOf(f.selectionSet, ctx, seen) : [];
});

const fieldDefOf = (type: GraphQLCompositeType, name: string): GraphQLField<unknown, unknown> | undefined => {
  if (name === '__typename') return undefined;
  const t = type as unknown as { getFields?: () => Record<string, GraphQLField<unknown, unknown>> };
  return t.getFields?.()[name];
};

/** Cost of the selection under an object (each field of composite type costs per `fieldCost`). `data` is the matching result object (actual cost) or undefined (requested cost). */
function selectionCost(set: SelectionSetNode, parent: GraphQLCompositeType, ctx: Ctx, data?: unknown): number {
  let total = 0;
  for (const node of fieldsOf(set, ctx)) {
    const def = fieldDefOf(parent, node.name.value);
    if (!def) continue;
    const named = getNamedType(def.type);
    if (!isCompositeType(named) || !node.selectionSet) continue;
    const key = node.alias?.value ?? node.name.value;
    const value = data && typeof data === 'object' ? (data as Record<string, unknown>)[key] : undefined;
    if (ctx.data && value === undefined) continue; // not returned (null parent or error)
    total += fieldCost(node, def, named, ctx, value);
  }
  return total;
}

function fieldCost(node: FieldNode, def: GraphQLField<unknown, unknown>, named: GraphQLCompositeType, ctx: Ctx, value: unknown): number {
  const page = pageArg(node, ctx.vars);
  const isConnection = typeof page === 'number' && named.name.endsWith('Connection');
  if (isConnection) {
    const edgeSel = fieldsOf(node.selectionSet!, ctx);
    const nodesField = edgeSel.find((f) => f.name.value === 'nodes');
    const edgesField = edgeSel.find((f) => f.name.value === 'edges');
    const nodeType = getNamedType(fieldDefOf(named, 'nodes')?.type ?? fieldDefOf(named, 'edges')?.type ?? named) as GraphQLCompositeType;
    const perNode = (sel: SelectionSetNode | undefined, at: GraphQLCompositeType, item?: unknown) => 1 + (sel ? selectionCost(sel, at, ctx, item) : 0);
    let one = 0;
    let count = page!;
    const conn = value as { nodes?: unknown[]; edges?: { node?: unknown }[] } | undefined;
    if (ctx.data) {
      const items = conn?.nodes ?? conn?.edges?.map((e) => e.node) ?? [];
      count = items.length;
      if (nodesField?.selectionSet) one = items.reduce<number>((n, it) => n + perNode(nodesField.selectionSet, nodeType, it), 0);
      else if (edgesField?.selectionSet) {
        const nodeSel = fieldsOf(edgesField.selectionSet, ctx).find((f) => f.name.value === 'node');
        one = items.reduce<number>((n, it) => n + perNode(nodeSel?.selectionSet, getNamedType(fieldDefOf(getNamedType(fieldDefOf(named, 'edges')!.type) as GraphQLCompositeType, 'node')!.type) as GraphQLCompositeType, it), 0);
      }
      return 2 + one + (count === 0 ? 0 : 0);
    }
    if (nodesField?.selectionSet) one = perNode(nodesField.selectionSet, nodeType);
    else if (edgesField?.selectionSet) {
      const nodeSel = fieldsOf(edgesField.selectionSet, ctx).find((f) => f.name.value === 'node');
      const edgeType = getNamedType(fieldDefOf(named, 'edges')!.type) as GraphQLCompositeType;
      one = perNode(nodeSel?.selectionSet, getNamedType(fieldDefOf(edgeType, 'node')!.type) as GraphQLCompositeType);
    }
    return 2 + count * one;
  }
  if (Array.isArray(value)) return value.reduce<number>((n, it) => n + 1 + selectionCost(node.selectionSet!, named, ctx, it), 0);
  return 1 + selectionCost(node.selectionSet!, named, ctx, value);
}

export function queryCost(schema: GraphQLSchema, document: DocumentNode, operationName: string | null | undefined, vars: Record<string, unknown>, result?: unknown): number {
  const fragments = new Map<string, FragmentDefinitionNode>();
  const ops: OperationDefinitionNode[] = [];
  for (const d of document.definitions) { if (d.kind === FRAGMENT_DEF) fragments.set(d.name.value, d); else if (d.kind === OPERATION) ops.push(d); }
  const op = ops.find((o) => !operationName || o.name?.value === operationName) ?? ops[0];
  if (!op) return 0;
  const root = op.operation === 'mutation' ? schema.getMutationType() : op.operation === 'subscription' ? schema.getSubscriptionType() : schema.getQueryType();
  if (!root) return 0;
  const ctx: Ctx = { schema, vars, fragments, data: result !== undefined };
  return (op.operation === 'mutation' ? 10 : 0) + selectionCost(op.selectionSet, root, ctx, result);
}

const buckets = new Map<number, { available: number; at: number }>();
/** Deduct `cost` from the shop's bucket and return its state. */
export function throttle(shopId: number, cost: number, now = Date.now()) {
  const b = buckets.get(shopId) ?? { available: MAX_AVAILABLE, at: now };
  const restored = Math.min(MAX_AVAILABLE, b.available + ((now - b.at) / 1000) * RESTORE_RATE);
  const next = { available: Math.max(0, restored - cost), at: now };
  buckets.set(shopId, next);
  return { maximumAvailable: MAX_AVAILABLE, currentlyAvailable: Math.floor(next.available), restoreRate: RESTORE_RATE };
}

/** `extensions.cost` on every response (queries and mutations). */
export function useCostExtension(): Plugin<{ gql?: GraphQLContext } & Record<string, unknown>> {
  return {
    onExecute: ({ args }) => {
      const requested = queryCost(args.schema, args.document, args.operationName, (args.variableValues ?? {}) as Record<string, unknown>);
      return {
        onExecuteDone({ result, setResult }) {
          if (Array.isArray(result) || !('data' in result || 'errors' in result)) return;
          const actual = result.data ? queryCost(args.schema, args.document, args.operationName, (args.variableValues ?? {}) as Record<string, unknown>, result.data) : 0;
          const shopId = (args.contextValue as unknown as GraphQLContext | undefined)?.shopId ?? 0;
          setResult({ ...result, extensions: { ...result.extensions, cost: { requestedQueryCost: requested, actualQueryCost: Math.min(actual, requested), throttleStatus: throttle(shopId, Math.min(actual, requested)) } } });
        },
      };
    },
  };
}
