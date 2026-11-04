import { sql, type SQL } from 'drizzle-orm';

/** Shopify-style search syntax: `field:value`, `-field:value`, `field:>5`, quoted phrases, free text, `OR` between groups. */
export interface Term { field: string | null; op: ':' | '<' | '>' | '<=' | '>='; value: string; negate: boolean }

export function parseSearch(q: string): Term[][] {
  const groups: Term[][] = [[]];
  const re = /(-?)(?:([A-Za-z_]+):)?(<=|>=|<|>)?(?:"([^"]*)"|(\S+))/g;
  for (const m of q.replace(/[()]/g, ' ').matchAll(re)) {
    const word = m[5];
    if (!m[2] && !m[1] && !m[3] && m[4] === undefined && word) {
      if (word === 'OR') { groups.push([]); continue; }
      if (word === 'AND') continue;
    }
    groups.at(-1)!.push({ field: m[2]?.toLowerCase() ?? null, op: (m[3] as Term['op']) ?? ':', value: m[4] ?? word ?? '', negate: m[1] === '-' });
  }
  return groups.filter((g) => g.length);
}

export type FieldFn = (op: Term['op'], value: string) => SQL | null;
export interface SearchSpec { fields: Record<string, FieldFn>; text: (value: string) => SQL }

/** Build a SQL condition from a search string, or undefined when it filters nothing. Unknown fields are ignored. */
export function buildSearch(q: string | null | undefined, spec: SearchSpec): SQL | undefined {
  if (!q?.trim()) return undefined;
  const ors: SQL[] = [];
  for (const group of parseSearch(q)) {
    const ands: SQL[] = [];
    for (const t of group) {
      const cond = t.field ? spec.fields[t.field]?.(t.op, t.value) : spec.text(t.value);
      if (cond) ands.push(t.negate ? sql`not (${cond})` : cond);
    }
    if (ands.length) ors.push(sql`(${sql.join(ands, sql` and `)})`);
  }
  return ors.length ? sql`(${sql.join(ors, sql` or `)})` : undefined;
}

const esc = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);
/** Case-insensitive match. `*` is a wildcard; `exact` matches the whole value unless a wildcard is used. */
export function likeCi(col: unknown, value: string, exact = false): SQL {
  const pattern = value.includes('*') ? esc(value).replace(/\*/g, '%') : exact ? esc(value) : `%${esc(value)}%`;
  return sql`${col} ilike ${pattern}`;
}

/** Numeric/date comparison with the operator of a term. */
export function compare(col: unknown, op: Term['op'], value: unknown): SQL {
  return op === '<' ? sql`${col} < ${value}` : op === '>' ? sql`${col} > ${value}` : op === '<=' ? sql`${col} <= ${value}` : op === '>=' ? sql`${col} >= ${value}` : sql`${col} = ${value}`;
}

/** Date term: `2026-11-04` means that whole day for `:`; operators compare against the start of day. */
export function dateCompare(col: unknown, op: Term['op'], value: string): SQL | null {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  if (op === ':' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return sql`(${col} >= ${d.toISOString()}::timestamptz and ${col} < ${new Date(d.getTime() + 86400000).toISOString()}::timestamptz)`;
  }
  return compare(col, op === ':' ? '>=' : op, d.toISOString());
}

/** Integer id term (`id:123`, gid tails accepted). */
export const idTerm = (col: unknown, value: string): SQL | null => {
  const n = Number(value.split('/').pop());
  return Number.isSafeInteger(n) ? sql`${col} = ${n}` : null;
};
