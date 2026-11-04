import type { Liquid } from 'liquidjs';
import type { Theme } from './theme';
import type { ResourceResolvers } from './types';

export interface Frame {
  kind: 'section' | 'block';
  id: string;
  type: string;
  instance: { blocks?: Record<string, import('./types').BlockInstance>; block_order?: string[] };
  /** Extra keyword arguments passed through `content_for`, readable as `closest.*`. */
  closest: Record<string, unknown>;
}

/** Per-request render state. Lives in `globals.__rt`, so every tag and filter can reach it (also inside `render`). */
export interface Runtime {
  theme: Theme;
  engine: Liquid;
  resolvers: ResourceResolvers;
  locale: string;
  defaultLocale: string;
  money: { format: string; withCurrency: string; currency: string };
  /** `/path` of the current request and its query, used by paginate for page links. */
  request: { path: string; query: Record<string, string | string[] | undefined> };
  stylesheets: Map<string, string>;
  javascripts: Map<string, string>;
  /** Set by the layout tag: undefined = template default, null = `none`, string = layout name. */
  layout: string | null | undefined;
  stack: Frame[];
  sectionCounter: number;
  errors: string[];
  assetUrl(name: string): string;
  fileUrl(name: string): string;
}

export const rtOf = (ctx: { globals: Record<string, unknown> }): Runtime => ctx.globals.__rt as Runtime;

export const escapeHtml = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Split filter arguments into positional values and keyword pairs (LiquidJS passes `name: value` as `[name, value]`). */
export function splitArgs(args: unknown[]): { pos: unknown[]; named: Record<string, unknown> } {
  const pos: unknown[] = [];
  const named: Record<string, unknown> = {};
  for (const a of args) {
    if (Array.isArray(a) && a.length === 2 && typeof a[0] === 'string' && /^[\w-]+$/.test(a[0])) named[a[0]] = a[1];
    else pos.push(a);
  }
  return { pos, named };
}

export function attrs(map: Record<string, unknown>): string {
  let s = '';
  for (const [k, v] of Object.entries(map)) {
    if (v === undefined || v === null || v === false) continue;
    s += v === true ? ` ${k}` : ` ${k}="${escapeHtml(v)}"`;
  }
  return s;
}
