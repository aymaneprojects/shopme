/**
 * The small query language of the report query box:
 *
 *   FROM sales SHOW total_sales, orders BY week WHERE channel = web AND total > 5000 SINCE last_30_days UNTIL 2026-10-31 COMPARE previous_year VISUALIZE bar CUMULATIVE
 *
 * Every clause is optional. The same text drives the report controls and the exploration builder, so the box and the panel always agree.
 */
export type QueryOp = 'EQ' | 'NEQ' | 'CONTAINS' | 'GT' | 'LT';
export type QueryCompare = 'NONE' | 'PREVIOUS_PERIOD' | 'PREVIOUS_YEAR';
export type QueryViz = 'TABLE' | 'LINE' | 'BAR';
export interface QueryFilter { field: string; op: QueryOp; value: string }
export interface ReportQuery {
  from: string | null; show: string[]; by: string | null; where: QueryFilter[]; since: string | null; until: string | null;
  compare: QueryCompare | null; visualize: QueryViz | null; cumulative: boolean;
}
export const emptyQuery = (): ReportQuery => ({ from: null, show: [], by: null, where: [], since: null, until: null, compare: null, visualize: null, cumulative: false });

export type ParseResult = { ok: true; query: ReportQuery } | { ok: false; error: string; token?: string };

const KEYWORDS = ['FROM', 'SHOW', 'BY', 'WHERE', 'SINCE', 'UNTIL', 'COMPARE', 'VISUALIZE', 'CUMULATIVE'] as const;
const OPS: Record<string, QueryOp> = { '=': 'EQ', '!=': 'NEQ', '~': 'CONTAINS', '>': 'GT', '<': 'LT' };
const OP_TEXT: Record<QueryOp, string> = { EQ: '=', NEQ: '!=', CONTAINS: '~', GT: '>', LT: '<' };
const COMPARES: Record<string, QueryCompare> = { none: 'NONE', previous_period: 'PREVIOUS_PERIOD', previous_year: 'PREVIOUS_YEAR' };
const VIZ: Record<string, QueryViz> = { table: 'TABLE', line: 'LINE', bar: 'BAR' };

interface Tok { type: 'word' | 'str' | 'comma' | 'op'; text: string }

function tokenize(text: string): Tok[] | { error: string; token: string } {
  const out: Tok[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (c === ',') { out.push({ type: 'comma', text: ',' }); i++; continue; }
    if (c === '"') {
      const end = text.indexOf('"', i + 1);
      if (end < 0) return { error: 'unterminated', token: text.slice(i) };
      out.push({ type: 'str', text: text.slice(i + 1, end) }); i = end + 1; continue;
    }
    const op = /^(!=|=|~|>|<)/.exec(text.slice(i));
    if (op) { out.push({ type: 'op', text: op[1]! }); i += op[1]!.length; continue; }
    const w = /^[A-Za-z0-9_.:\-/]+/.exec(text.slice(i));
    if (!w) return { error: 'unexpected', token: c };
    out.push({ type: 'word', text: w[0] }); i += w[0].length;
  }
  return out;
}

const isKeyword = (t: Tok | undefined) => !!t && t.type === 'word' && (KEYWORDS as readonly string[]).includes(t.text.toUpperCase());

/** Parse the query text. Errors name the offending token so the box can point at it. */
export function parseReportQuery(text: string): ParseResult {
  const toks = tokenize(text);
  if (!Array.isArray(toks)) return { ok: false, error: toks.error, token: toks.token };
  const q = emptyQuery();
  let i = 0;
  const fail = (error: string, token?: string): ParseResult => ({ ok: false, error, token });
  const seen = new Set<string>();
  while (i < toks.length) {
    const t = toks[i]!;
    if (!isKeyword(t)) return fail('expectedKeyword', t.text);
    const kw = t.text.toUpperCase();
    if (seen.has(kw)) return fail('duplicateClause', t.text);
    seen.add(kw);
    i++;
    if (kw === 'CUMULATIVE') { q.cumulative = true; continue; }
    if (kw === 'SHOW') {
      const names: string[] = [];
      while (i < toks.length && !isKeyword(toks[i])) {
        const x = toks[i]!;
        if (x.type === 'comma') { i++; continue; }
        if (x.type !== 'word') return fail('expectedName', x.text);
        names.push(x.text.toLowerCase()); i++;
      }
      if (!names.length) return fail('emptyClause', 'SHOW');
      q.show = names; continue;
    }
    if (kw === 'WHERE') {
      for (;;) {
        const field = toks[i], op = toks[i + 1], value = toks[i + 2];
        if (!field || field.type !== 'word' || isKeyword(field)) return fail('expectedField', field?.text ?? 'WHERE');
        if (!op || op.type !== 'op') return fail('expectedOperator', field.text);
        if (!value || (value.type !== 'word' && value.type !== 'str') || (value.type === 'word' && isKeyword(value))) return fail('expectedValue', field.text);
        q.where.push({ field: field.text.toLowerCase(), op: OPS[op.text]!, value: value.text });
        i += 3;
        if (toks[i]?.type === 'word' && toks[i]!.text.toUpperCase() === 'AND') { i++; continue; }
        break;
      }
      continue;
    }
    const arg = toks[i];
    if (!arg || (arg.type !== 'word' && arg.type !== 'str') || isKeyword(arg)) return fail('emptyClause', kw);
    i++;
    const v = arg.text;
    if (kw === 'FROM') q.from = v.toLowerCase();
    else if (kw === 'BY') q.by = v.toLowerCase() === 'none' ? null : v.toLowerCase();
    else if (kw === 'SINCE') q.since = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : v.toUpperCase();
    else if (kw === 'UNTIL') { if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return fail('badDate', v); q.until = v; }
    else if (kw === 'COMPARE') { const c = COMPARES[v.toLowerCase()]; if (!c) return fail('badCompare', v); q.compare = c; }
    else if (kw === 'VISUALIZE') { const z = VIZ[v.toLowerCase()]; if (!z) return fail('badVisualization', v); q.visualize = z; }
  }
  return { ok: true, query: q };
}

const word = (v: string) => (/^[A-Za-z0-9_.:\-/]+$/.test(v) ? v : `"${v.replace(/"/g, '')}"`);

/** The text of a query, in the order of the grammar. Parsing the result gives the same query back. */
export function formatReportQuery(q: ReportQuery): string {
  const parts: string[] = [];
  if (q.from) parts.push(`FROM ${q.from}`);
  if (q.show.length) parts.push(`SHOW ${q.show.join(', ')}`);
  if (q.by) parts.push(`BY ${q.by}`);
  if (q.where.length) parts.push(`WHERE ${q.where.map((f) => `${f.field} ${OP_TEXT[f.op]} ${word(f.value)}`).join(' AND ')}`);
  if (q.since) parts.push(`SINCE ${q.since.toLowerCase().startsWith('last_') || q.since.includes('_') ? q.since.toLowerCase() : q.since}`);
  if (q.until) parts.push(`UNTIL ${q.until}`);
  if (q.compare) parts.push(`COMPARE ${q.compare.toLowerCase()}`);
  if (q.visualize) parts.push(`VISUALIZE ${q.visualize.toLowerCase()}`);
  if (q.cumulative) parts.push('CUMULATIVE');
  return parts.join(' ');
}

/** Whether a row cell passes a filter: numbers compare as numbers, text case-insensitively. */
export function matchesFilter(cell: string | number | null, f: QueryFilter): boolean {
  if (cell == null) return f.op === 'NEQ';
  const v = String(cell);
  const a = Number(v), b = Number(f.value);
  const numeric = v !== '' && f.value !== '' && Number.isFinite(a) && Number.isFinite(b);
  switch (f.op) {
    case 'EQ': return numeric ? a === b : v.toLowerCase() === f.value.toLowerCase();
    case 'NEQ': return numeric ? a !== b : v.toLowerCase() !== f.value.toLowerCase();
    case 'CONTAINS': return v.toLowerCase().includes(f.value.toLowerCase());
    case 'GT': return numeric ? a > b : v.toLowerCase() > f.value.toLowerCase();
    case 'LT': return numeric ? a < b : v.toLowerCase() < f.value.toLowerCase();
  }
}

/** Running total of a series (the "cumulative" option of a chart). */
export const cumulate = (values: number[]): number[] => { let s = 0; return values.map((v) => (s += v)); };
