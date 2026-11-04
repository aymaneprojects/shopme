import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GraphQLSchema } from 'graphql';
import { expect } from 'vitest';
import type { FastifyInstance } from 'fastify';

const here = path.dirname(fileURLToPath(import.meta.url));

/** GraphQL client over `app.inject` using a staff session cookie. */
export function makeGql(app: FastifyInstance, cookie: string) {
  return async (query: string, variables: Record<string, unknown> = {}) => {
    const res = await app.inject({ method: 'POST', url: '/admin/api/2026-10/graphql.json', payload: { query, variables }, cookies: { shopme_session: cookie } });
    return JSON.parse(res.body) as { data?: any; errors?: { message: string; path?: unknown }[] };
  };
}

/** Like `makeGql` but fails the test on top-level errors and returns `data`. */
export function makeGqlOk(gql: ReturnType<typeof makeGql>) {
  return async (query: string, variables: Record<string, unknown> = {}) => {
    const r = await gql(query, variables);
    expect(r.errors, JSON.stringify(r.errors)).toBeUndefined();
    return r.data;
  };
}

/* ------------------------------ shape fixtures ------------------------------ */

export interface ShapeFixture { root: string; rootType: string; fields: { path: string; type: string }[] }
export const loadFixture = (name: string): ShapeFixture => JSON.parse(readFileSync(path.join(here, 'fixtures', `admin-${name}.shape.json`), 'utf8'));

const named = (t: string) => t.replace(/[[\]!]/g, '');
const seg = (s: string) => s.replace(/\[\]$/, '');

interface Node { children: Map<string, Node> }

/** Build the selection set that requests every fixture path. */
export function buildSelection(schema: GraphQLSchema, fx: ShapeFixture): string {
  const typeOf = new Map(fx.fields.map((f) => [f.path.replace(/\[\]/g, ''), f.type]));
  const tree: Node = { children: new Map() };
  for (const { path: p } of fx.fields) {
    let cur = tree;
    for (const s of p.split('.')) {
      const k = seg(s);
      if (!cur.children.has(k)) cur.children.set(k, { children: new Map() });
      cur = cur.children.get(k)!;
    }
  }
  const render = (node: Node, parentType: string, prefix: string): string => {
    const parts: string[] = [];
    const frag: string[] = [];
    for (const [key, child] of node.children) {
      const p = prefix ? `${prefix}.${key}` : key;
      const t = typeOf.get(p) ?? '';
      const childType = named(t);
      let args = '';
      if (childType.endsWith('Connection')) args = '(first: 5)';
      if (key === 'quantities') args = '(names: ["available", "on_hand", "committed", "incoming", "reserved"])';
      // Samples are sparse: a path with no recorded children still needs a selection when its type is composite.
      const composite = !!(schema.getType(childType) as { getFields?: unknown } | undefined)?.getFields;
      const inner = child.children.size ? ` { ${render(child, childType, p)} }` : composite ? ' { __typename }' : '';
      const field = `${key}${args}${inner}`;
      const pt = schema.getType(parentType) as { getFields?: () => Record<string, unknown> } | undefined;
      if (parentType === 'Media' && !pt?.getFields?.()[key]) frag.push(field);
      else parts.push(field);
    }
    if (frag.length) parts.push(`... on MediaImage { ${frag.join(' ')} }`);
    return parts.join(' ');
  };
  return render(tree, fx.rootType, '');
}

/** Values found at `path` in the response, flattening lists; `null` parents end the walk. */
function collect(value: unknown, segs: string[]): unknown[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap((v) => collect(v, segs));
  if (!segs.length) return [value];
  if (value === null || typeof value !== 'object') return [];
  return collect((value as Record<string, unknown>)[seg(segs[0]!)], segs.slice(1));
}

/** Deviations from the real schema we accept on purpose (see the catalog report). `Parent.field` -> our printed type. */
export const KNOWN_TYPE_DEVIATIONS: Record<string, string> = {
  'InventoryItem.countryCodeOfOrigin': 'String',
};

// `graphql` can be loaded twice under vitest (ESM and CJS); duck-type instead of using its `is*` helpers.
type Named = { name: string; getFields?: () => Record<string, { type: unknown }> };
const namedOf = (t: unknown): Named => { let c = t as { ofType?: unknown }; while (c.ofType) c = c.ofType as { ofType?: unknown }; return c as Named; };

/** Assert our schema declares each fixture path with the same GraphQL type and the response carries well-typed data. */
export function assertShape(schema: GraphQLSchema, fx: ShapeFixture, nodes: unknown[]) {
  const problems: string[] = [];
  for (const { path: p, type } of fx.fields) {
    const segs = p.split('.');
    let cur: Named | undefined = schema.getType(fx.rootType) as Named;
    let ourType = '';
    let parent = fx.rootType;
    for (const s of segs) {
      const k = seg(s);
      let f = cur?.getFields?.()[k];
      if (!f && cur?.name === 'Media') f = (schema.getType('MediaImage') as Named).getFields!()[k];
      if (!f) { cur = undefined; ourType = '(missing)'; break; }
      parent = cur!.name;
      ourType = String(f.type);
      cur = namedOf(f.type);
    }
    const expected = KNOWN_TYPE_DEVIATIONS[`${parent}.${seg(segs.at(-1)!)}`] ?? type;
    if (ourType !== expected) problems.push(`${p}: type ${ourType} != ${type}`);
    const values = collect(nodes, segs);
    if (type.endsWith('!') && values.some((v) => v === null)) problems.push(`${p}: null for non-null type`);
    if (cur && !cur.getFields) {
      if (!values.length) problems.push(`${p}: no data in response (seed more data)`);
      const want = cur.name === 'Int' || cur.name === 'Float' ? 'number' : cur.name === 'Boolean' ? 'boolean' : cur.name === 'JSON' ? null : 'string';
      for (const v of values) if (v !== null && want && typeof v !== want) { problems.push(`${p}: ${typeof v} is not ${want}`); break; }
    }
  }
  expect(problems).toEqual([]);
}
