import {
  Kind, getNamedType, isInterfaceType, isObjectType, parse, print,
  type ArgumentNode, type FieldNode, type FragmentDefinitionNode, type GraphQLNamedType, type GraphQLSchema, type SelectionNode,
} from 'graphql';

/** Shopify limits: five connections per query, nested at most two levels deep. */
export const MAX_CONNECTIONS = 5;
export const MAX_NESTING = 2;
export const PAGE = 250;

/** A connection field of a bulk query: its own selection (nested connections removed) and the connections inside its nodes. */
export interface ConnDef {
  /** Response key (alias or field name). */
  key: string;
  name: string;
  args: readonly ArgumentNode[];
  nodeType: string;
  hasId: boolean;
  own: SelectionNode[];
  nested: ConnDef[];
  /** The user asked for `id` themselves (otherwise it is only emitted when children need it). */
  selectsId: boolean;
}

export type Analysis = { ok: true; roots: ConnDef[]; connections: number } | { ok: false; message: string };

const PAGING = new Set(['first', 'last', 'after', 'before']);
const isConnectionType = (t: GraphQLNamedType | undefined) => !!t && isObjectType(t) && t.name.endsWith('Connection') && 'edges' in t.getFields() && 'pageInfo' in t.getFields();

class Invalid extends Error {}
const fail = (m: string): never => { throw new Invalid(m); };

/** Parse and check a bulk query, then split it into connections. Never throws. */
export function analyzeBulkQuery(schema: GraphQLSchema, text: string): Analysis {
  try {
    let doc;
    try { doc = parse(text); } catch (e) { return { ok: false, message: `Parse error: ${(e as Error).message.replace(/^Syntax Error: /, '')}` }; }
    const ops = doc.definitions.filter((d) => d.kind === Kind.OPERATION_DEFINITION);
    const frags = new Map(doc.definitions.filter((d): d is FragmentDefinitionNode => d.kind === Kind.FRAGMENT_DEFINITION).map((f) => [f.name.value, f]));
    if (ops.length !== 1) return { ok: false, message: 'A bulk query must contain exactly one operation.' };
    const op = ops[0]!;
    if (op.kind !== Kind.OPERATION_DEFINITION || op.operation !== 'query') return { ok: false, message: 'Bulk operations of this kind must be a query.' };
    if (op.variableDefinitions?.length) return { ok: false, message: 'Variables are not supported in bulk queries.' };
    const root = schema.getQueryType();
    if (!root) return { ok: false, message: 'Schema has no query root.' };
    const split = splitSelections(schema, root, op.selectionSet.selections, frags, 0);
    if (split.own.length) return { ok: false, message: 'A bulk query must contain only connection fields at the top level.' };
    if (!split.nested.length) return { ok: false, message: 'A bulk query must contain at least one connection.' };
    const count = (cs: ConnDef[]): number => cs.reduce((n, c) => n + 1 + count(c.nested), 0);
    const total = count(split.nested);
    if (total > MAX_CONNECTIONS) return { ok: false, message: `A bulk query can contain at most ${MAX_CONNECTIONS} connections (found ${total}).` };
    return { ok: true, roots: split.nested, connections: total };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, message: e.message };
    throw e;
  }
}

function hasConnectionDeep(schema: GraphQLSchema, parent: GraphQLNamedType, sels: readonly SelectionNode[], frags: Map<string, FragmentDefinitionNode>): boolean {
  for (const s of sels) {
    if (s.kind === Kind.FIELD) {
      const fd = (isObjectType(parent) || isInterfaceType(parent)) ? parent.getFields()[s.name.value] : undefined;
      const t = fd && getNamedType(fd.type);
      if (isConnectionType(t)) return true;
      if (t && s.selectionSet && hasConnectionDeep(schema, t, s.selectionSet.selections, frags)) return true;
    } else if (s.kind === Kind.INLINE_FRAGMENT) {
      const t = s.typeCondition ? schema.getType(s.typeCondition.name.value) : parent;
      if (t && hasConnectionDeep(schema, t, s.selectionSet.selections, frags)) return true;
    } else {
      const f = frags.get(s.name.value);
      const t = f && schema.getType(f.typeCondition.name.value);
      if (f && t && hasConnectionDeep(schema, t, f.selectionSet.selections, frags)) return true;
    }
  }
  return false;
}

function splitSelections(schema: GraphQLSchema, parent: GraphQLNamedType, sels: readonly SelectionNode[], frags: Map<string, FragmentDefinitionNode>, depth: number): { own: SelectionNode[]; nested: ConnDef[] } {
  const own: SelectionNode[] = [];
  const nested: ConnDef[] = [];
  for (const s of sels) {
    if (s.kind === Kind.FIELD) {
      const fields = isObjectType(parent) || isInterfaceType(parent) ? parent.getFields() : {};
      const fd = fields[s.name.value];
      if (s.name.value === '__typename') { own.push(s); continue; }
      if (!fd) return fail(`Field '${s.name.value}' doesn't exist on type '${parent.name}'.`);
      const t = getNamedType(fd.type);
      if (isConnectionType(t)) {
        if (depth > MAX_NESTING) fail(`Connections can be nested at most ${MAX_NESTING} levels deep.`);
        nested.push(connDef(schema, s, t as GraphQLNamedType & { getFields(): Record<string, { type: never }> }, frags, depth));
      } else {
        if (t && s.selectionSet && hasConnectionDeep(schema, t, s.selectionSet.selections, frags)) fail('Connections must be selected directly on the nodes of another connection, not inside nested objects.');
        own.push(s);
      }
    } else if (s.kind === Kind.INLINE_FRAGMENT) {
      const t = s.typeCondition ? schema.getType(s.typeCondition.name.value) : parent;
      if (!t) return fail(`Unknown type '${s.typeCondition?.name.value}'.`);
      const inner = splitSelections(schema, t, s.selectionSet.selections, frags, depth);
      nested.push(...inner.nested);
      if (inner.own.length) own.push({ ...s, selectionSet: { ...s.selectionSet, selections: inner.own } });
    } else {
      const f = frags.get(s.name.value);
      if (!f) return fail(`Unknown fragment '${s.name.value}'.`);
      const t = schema.getType(f.typeCondition.name.value);
      if (!t) return fail(`Unknown type '${f.typeCondition.name.value}'.`);
      const inner = splitSelections(schema, t, f.selectionSet.selections, frags, depth);
      nested.push(...inner.nested);
      if (inner.own.length) own.push({ kind: Kind.INLINE_FRAGMENT, typeCondition: f.typeCondition, selectionSet: { kind: Kind.SELECTION_SET, selections: inner.own } });
    }
  }
  return { own, nested };
}

function connDef(schema: GraphQLSchema, field: FieldNode, connType: GraphQLNamedType & { getFields(): Record<string, { type: never }> }, frags: Map<string, FragmentDefinitionNode>, depth: number): ConnDef {
  const nodesField = connType.getFields().nodes;
  const nodeNamed = nodesField ? getNamedType(nodesField.type) : undefined;
  if (!nodeNamed) return fail(`Connection '${field.name.value}' has no nodes.`);
  // Node selections come from `edges { node { ... } }` and `nodes { ... }`; the rest (pageInfo, cursor) is dropped.
  const nodeSels: SelectionNode[] = [];
  const collect = (sels: readonly SelectionNode[]) => {
    for (const s of sels) {
      if (s.kind === Kind.FIELD) {
        if (s.name.value === 'nodes' && s.selectionSet) nodeSels.push(...s.selectionSet.selections);
        else if (s.name.value === 'edges' && s.selectionSet) {
          for (const e of s.selectionSet.selections) if (e.kind === Kind.FIELD && e.name.value === 'node' && e.selectionSet) nodeSels.push(...e.selectionSet.selections);
        }
      } else if (s.kind === Kind.INLINE_FRAGMENT) collect(s.selectionSet.selections);
      else { const f = frags.get(s.name.value); if (f) collect(f.selectionSet.selections); }
    }
  };
  collect(field.selectionSet?.selections ?? []);
  if (!nodeSels.length) fail(`Connection '${field.name.value}' must select the fields of its nodes (edges { node { ... } } or nodes { ... }).`);
  const inner = splitSelections(schema, nodeNamed, nodeSels, frags, depth + 1);
  const hasId = (isObjectType(nodeNamed) || isInterfaceType(nodeNamed)) && 'id' in nodeNamed.getFields();
  if (inner.nested.length && !hasId) fail(`Connection '${field.name.value}' has nested connections but its nodes have no id.`);
  const selectsId = nodeSels.some((s) => s.kind === Kind.FIELD && s.name.value === 'id' && !s.alias);
  return { key: field.alias?.value ?? field.name.value, name: field.name.value, args: (field.arguments ?? []).filter((a) => !PAGING.has(a.name.value)), nodeType: nodeNamed.name, hasId, own: inner.own, nested: inner.nested, selectsId };
}

/** GraphQL text selecting one page of a connection (with its nested connections' first pages). */
export function connSelection(def: ConnDef, after: string | null): string {
  const args = [...def.args.map((a) => print(a)), `first: ${PAGE}`, ...(after ? [`after: ${JSON.stringify(after)}`] : [])].join(', ');
  const inner = [
    def.hasId ? '__bulkId: id' : '', '__bulkType: __typename', ...def.own.map((s) => print(s)), ...def.nested.map((n) => connSelection(n, null)),
  ].filter(Boolean).join(' ');
  return `${def.key}: ${def.name}(${args}) { pageInfo { hasNextPage endCursor } edges { node { ${inner} } } }`;
}
