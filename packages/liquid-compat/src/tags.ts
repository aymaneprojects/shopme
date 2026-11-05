import { Hash, Tag, Tokenizer, TokenKind, Value, evalToken, toPromise, type Context, type Emitter, type Liquid, type Template, type TagToken, type TopLevelToken } from 'liquidjs';
import { attrs, escapeHtml, rtOf, type Frame, type Runtime } from './runtime';
import { resolveSettings } from './theme';
import type { BlockInstance, SectionGroupJson, SectionInstance, SettingDef } from './types';

type Gen<T = unknown> = Generator<unknown, T, unknown>;

/** Block-level tag that swallows everything up to `{% end<name> %}` and returns the raw source text. */
function readRaw(token: TagToken, remain: TopLevelToken[]): string {
  const end = `end${token.name}`;
  let body = '';
  while (remain.length) {
    const t = remain.shift()!;
    if (t.kind === TokenKind.Tag && (t as TagToken).name === end) return body;
    body += t.getText();
  }
  throw new Error(`tag {% ${token.name} %} not closed`);
}

/** Parse tokens up to `{% end<name> %}` into templates. */
function readBlock(tag: Tag, token: TagToken, remain: TopLevelToken[], liquid: Liquid): Template[] {
  const templates: Template[] = [];
  const stream = liquid.parser.parseStream(remain);
  stream.on(`tag:end${token.name}`, () => stream.stop()).on('template', (t: Template) => templates.push(t)).on('end', () => { throw new Error(`tag ${token.getText()} not closed`); });
  stream.start();
  void tag;
  return templates;
}

/** Read leading positional values then keyword args (`name: value`). */
function* readArgs(tag: Tag, ctx: Context, tk: { readValue(): unknown; skipBlank(): void; peek(): string; advance(): void; remaining(): string; end(): boolean }, maxPos = 4): Gen<{ pos: unknown[]; hash: Record<string, any> }> {
  const pos: unknown[] = [];
  for (let i = 0; i < maxPos; i++) {
    tk.skipBlank();
    if (tk.end() || /^[\w-]+\s*:/.test(tk.remaining())) break;
    const v = tk.readValue();
    if (!v) break;
    pos.push(yield evalToken(v as never, ctx));
    tk.skipBlank();
    if (tk.peek() === ',') tk.advance();
  }
  tk.skipBlank();
  const hash: Record<string, any> = tk.end() ? {} : ((yield new Hash(tk as never).render(ctx)) as Record<string, any>);
  void tag;
  return { pos, hash };
}

/** Tag instances are cached and rendered many times, so each render reads its arguments with a new tokenizer. */
function fresh(tag: Tag): Tokenizer {
  return new Tokenizer((tag as unknown as { token: TagToken }).token.args, tag.liquid.options.operators);
}

// ---------------------------------------------------------------------------------------------------------------------
// schema / doc: parse-time only
// ---------------------------------------------------------------------------------------------------------------------
class NoopBlockTag extends Tag {
  constructor(token: TagToken, remain: TopLevelToken[], liquid: Liquid) { super(token, remain, liquid); readRaw(token, remain); }
  render(): void { /* emits nothing */ }
}

// ---------------------------------------------------------------------------------------------------------------------
// stylesheet / javascript: hoisted once per file
// ---------------------------------------------------------------------------------------------------------------------
function collector(kind: 'stylesheets' | 'javascripts') {
  return class extends Tag {
    body: string;
    file: string;
    constructor(token: TagToken, remain: TopLevelToken[], liquid: Liquid) {
      super(token, remain, liquid);
      this.body = readRaw(token, remain).trim();
      this.file = token.file ?? `inline-${token.begin}`;
    }
    render(ctx: Context): void { rtOf(ctx)[kind].set(this.file, this.body); }
  };
}

class StyleTag extends Tag {
  templates: Template[];
  constructor(token: TagToken, remain: TopLevelToken[], liquid: Liquid) { super(token, remain, liquid); this.templates = readBlock(this, token, remain, liquid); }
  *render(ctx: Context, emitter: Emitter): Gen<void> {
    const css = (yield this.liquid.renderer.renderTemplates(this.templates, ctx)) as string;
    emitter.write(`<style data-shopify>${css}</style>`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------------------------------------------------
class LayoutTag extends Tag {
  name_: string | null;
  constructor(token: TagToken, remain: TopLevelToken[], liquid: Liquid) {
    super(token, remain, liquid);
    const a = token.args.trim();
    this.name_ = a === 'none' || a === 'false' || a === 'nil' ? null : a.replace(/^['"]|['"]$/g, '');
  }
  render(ctx: Context): void { rtOf(ctx).layout = this.name_; }
}

// ---------------------------------------------------------------------------------------------------------------------
// form
// ---------------------------------------------------------------------------------------------------------------------
const FORM_ACTIONS: Record<string, string> = {
  product: '/cart/add', cart: '/cart', contact: '/contact#contact_form', customer: '/contact#contact_form', localization: '/localization',
  storefront_password: '/password', customer_login: '/account/login', create_customer: '/account', recover_customer_password: '/account/recover',
  guest_login: '/account/login', customer_login_code: '/account/login/code', customer_login_code_verify: '/account/login/code/verify', data_sale_opt_out: '/pages/data-sale-opt-out', reset_customer_password: '/account/reset', activate_customer_password: '/account/activate',
  customer_address: '/account/addresses', new_comment: '', currency: '/cart/update',
};

class FormTag extends Tag {
  templates: Template[];
  constructor(token: TagToken, remain: TopLevelToken[], liquid: Liquid) { super(token, remain, liquid); this.templates = readBlock(this, token, remain, liquid); }
  *render(ctx: Context, emitter: Emitter): Gen<void> {
    const { pos, hash } = yield* readArgs(this, ctx, fresh(this) as never, 3);
    const type = String(pos[0] ?? '');
    const resource = pos[1] as any;
    const id = hash.id ?? `${type}-form`;
    const { id: _i, class: cls, ...rest } = hash;
    const hostAction = (ctx.getSync(['__form_actions']) as Record<string, string> | undefined)?.[type];
    const action = hostAction ?? (type === 'customer_address' && resource?.id ? `/account/addresses/${resource.id}` : FORM_ACTIONS[type] ?? String(pos[1] ?? '/'));
    const extra: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) extra[k.replace(/_/g, '-')] = v;
    // Host-provided state: `__form_errors[type]` (string[] or { field: message }), `__form_success[type]`, `__form_values[type]` (re-filled inputs).
    const rawErrors = ctx.getSync(['__form_errors', type]) as string[] | Record<string, string> | null | undefined;
    const errors = !rawErrors ? null : Array.isArray(rawErrors) ? rawErrors : Object.assign(Object.keys(rawErrors), { messages: rawErrors, translated_fields: Object.fromEntries(Object.keys(rawErrors).map((k) => [k, k])) });
    const ok = ctx.getSync(['__form_success', type]) === true;
    const values = (ctx.getSync(['__form_values', type]) ?? {}) as Record<string, unknown>;
    const form = { ...values, id, errors, posted_successfully: ok, 'posted_successfully?': ok, ...(type === 'product' && resource ? { product_id: resource.id } : {}) };
    ctx.push({ form });
    try {
      const inner = (yield this.liquid.renderer.renderTemplates(this.templates, ctx)) as string;
      const open = `<form method="post" action="${escapeHtml(action)}" id="${escapeHtml(id)}" accept-charset="UTF-8"${attrs({ class: cls, enctype: type === 'product' ? 'multipart/form-data' : undefined, ...extra })}>`;
      const hidden = `<input type="hidden" name="form_type" value="${escapeHtml(type)}"><input type="hidden" name="utf8" value="&#x2713;">`
        + (type === 'product' && resource?.id ? `<input type="hidden" name="product-id" value="${escapeHtml(resource.id)}">` : '');
      emitter.write(`${open}${hidden}${inner}</form>`);
    } finally { ctx.pop(); }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// paginate
// ---------------------------------------------------------------------------------------------------------------------
export interface LazyList { total: number; load(offset: number, limit: number): Promise<unknown[]> }

/** Attach a lazy loader to an array so `paginate` fetches only the current page. */
export function lazyList(preview: unknown[], total: number, load: LazyList['load']): unknown[] {
  Object.defineProperty(preview, '__lazy', { value: { total, load }, enumerable: false });
  return preview;
}

function pageUrl(rt: Runtime, page: number): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(rt.request.query)) {
    if (k === 'page' || v === undefined) continue;
    for (const x of Array.isArray(v) ? v : [v]) q.append(k, x);
  }
  if (page > 1) q.set('page', String(page));
  const s = q.toString();
  return rt.request.path + (s ? `?${s}` : '');
}

class PaginateTag extends Tag {
  templates: Template[];
  listExpr: string;
  sizeExpr: string;
  windowSize: number;
  constructor(token: TagToken, remain: TopLevelToken[], liquid: Liquid) {
    super(token, remain, liquid);
    const m = /^\s*(.+?)\s+by\s+([^\s,]+)(?:\s*,\s*window_size\s*:\s*(\d+))?\s*$/.exec(token.args);
    if (!m) throw new Error(`illegal paginate syntax: ${token.args}`);
    this.listExpr = m[1]!; this.sizeExpr = m[2]!; this.windowSize = m[3] ? Number(m[3]) : 3;
    this.templates = readBlock(this, token, remain, liquid);
  }
  *render(ctx: Context, emitter: Emitter): Gen<void> {
    const rt = rtOf(ctx);
    const list = (yield new Value(this.listExpr, this.liquid).value(ctx)) as any;
    const size = Math.min(250, Math.max(1, Math.floor(Number(yield new Value(this.sizeExpr, this.liquid).value(ctx))) || 20));
    const lazy = Array.isArray(list) ? (list as any).__lazy as LazyList | undefined : undefined;
    const total = lazy ? lazy.total : Array.isArray(list) ? list.length : 0;
    const pages = Math.max(1, Math.ceil(total / size));
    const requested = parseInt(String(rt.request.query.page ?? '1'), 10);
    const current = Math.min(pages, Math.max(1, Number.isFinite(requested) ? requested : 1));
    const offset = (current - 1) * size;
    const slice = lazy ? ((yield lazy.load(offset, size)) as unknown[]) : Array.isArray(list) ? list.slice(offset, offset + size) : [];

    const w = this.windowSize;
    const parts: { title: string; url?: string; is_link: boolean }[] = [];
    let gap = false;
    for (let p = 1; p <= pages; p++) {
      if (p === 1 || p === pages || Math.abs(p - current) <= w - 1 || pages <= w * 2 + 1) {
        parts.push(p === current ? { title: String(p), is_link: false } : { title: String(p), url: pageUrl(rt, p), is_link: true });
        gap = false;
      } else if (!gap) { parts.push({ title: '&hellip;', is_link: false }); gap = true; }
    }
    const paginate = {
      current_page: current, current_offset: offset, items: total, page_size: size, pages, parts,
      previous: current > 1 ? { title: 'Previous', url: pageUrl(rt, current - 1), is_link: true } : null,
      next: current < pages ? { title: 'Next', url: pageUrl(rt, current + 1), is_link: true } : null,
    };
    // Shallow-clone the path to the list so the block sees only this page's items.
    const parts2 = this.listExpr.replace(/\[['"]?([^\]'"]+)['"]?\]/g, '.$1').split('.');
    const scope: Record<string, unknown> = { paginate, current_page: current };
    if (parts2.length === 1) scope[parts2[0]!] = slice;
    else {
      const rootVal = (yield new Value(parts2[0]!, this.liquid).value(ctx)) as Record<string, unknown> | undefined;
      const clone = (src: any, path: string[]): any => (path.length === 1 ? { ...src, [path[0]!]: slice } : { ...src, [path[0]!]: clone(src?.[path[0]!] ?? {}, path.slice(1)) });
      scope[parts2[0]!] = clone(rootVal ?? {}, parts2.slice(1));
    }
    ctx.push(scope);
    try { emitter.write((yield this.liquid.renderer.renderTemplates(this.templates, ctx)) as string); } finally { ctx.pop(); }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// sections, blocks
// ---------------------------------------------------------------------------------------------------------------------
const templateCache = new WeakMap<Liquid, Map<string, Template[]>>();

function parsedFile(liquid: Liquid, rt: Runtime, path: string): Template[] | null {
  const src = rt.theme.source(path);
  if (src === undefined) return null;
  let m = templateCache.get(liquid);
  if (!m) { m = new Map(); templateCache.set(liquid, m); }
  let t = m.get(path);
  if (!t) { t = liquid.parse(src, path); m.set(path, t); }
  return t;
}

/** Evaluate Liquid inside string settings (e.g. `{{ closest.product.title }}`) when the setting is read. */
async function evalSettingStrings(liquid: Liquid, settings: Record<string, unknown>, ctx: Context, scope: Record<string, unknown>): Promise<void> {
  for (const [k, v] of Object.entries(settings)) {
    if (typeof v === 'string' && (v.includes('{{') || v.includes('{%'))) {
      try { settings[k] = await toPromise(liquid.renderer.renderTemplates(liquid.parse(v), ctx.spawn(scope))); } catch { /* keep raw */ }
    }
  }
}

function pageDefaults(ctx: Context): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const k of ['product', 'collection', 'article', 'blog']) { const v = ctx.getSync([k]); if (v) o[k] = v; }
  return o;
}

interface InstanceOpts { id: string; type: string; instance: SectionInstance; location?: string; group?: string; index?: number; extraClosest?: Record<string, unknown> }

const blockDefs = (rt: Runtime, sectionPath: string, type: string): SettingDef[] | undefined => {
  if (rt.theme.has(`blocks/${type}.liquid`)) return rt.theme.schema(`blocks/${type}.liquid`)?.settings;
  return rt.theme.schema(sectionPath)?.blocks?.find((b) => b.type === type)?.settings;
};

function errorHtml(rt: Runtime, where: string, e: unknown): string {
  const msg = e instanceof Error ? e.message.split('\n')[0]! : String(e);
  rt.errors.push(`${where}: ${msg}`);
  return `<!-- Liquid error (${where}): ${escapeHtml(msg).replace(/--/g, '- -')} -->`;
}

/** Editor attributes (`data-shopify-editor-block`) for a block; empty outside the theme editor preview. */
const editorBlockAttrs = (rt: Runtime, id: string, type: string): string => (rt.designMode ? `data-shopify-editor-block="${escapeHtml(JSON.stringify({ id, type }))}"` : '');

async function childBlocks(rt: Runtime, ownerPath: string, inst: BlockInstance, sc: { resolvers: Runtime['resolvers']; schemaLocale?: Record<string, unknown> }) {
  const ids = inst.block_order ?? Object.keys(inst.blocks ?? {});
  const out: Record<string, unknown>[] = [];
  for (const bid of ids) {
    const b = inst.blocks?.[bid];
    if (!b || b.disabled) continue;
    out.push({ id: bid, type: b.type, settings: await resolveSettings(blockDefs(rt, ownerPath, b.type), b.settings, sc), shopify_attributes: editorBlockAttrs(rt, bid, b.type), 'static?': !!b.static });
  }
  return out;
}

export async function renderSectionInstance(liquid: Liquid, ctx: Context, o: InstanceOpts): Promise<string> {
  const rt = rtOf(ctx);
  const path = `sections/${o.type}.liquid`;
  const templates = parsedFile(liquid, rt, path);
  if (!templates) return errorHtml(rt, path, new Error('section file not found'));
  const schema = rt.theme.schema(path);
  const sc = { resolvers: rt.resolvers, schemaLocale: rt.theme.localeFile(rt.defaultLocale, true) };
  const closest = { ...pageDefaults(ctx), ...(o.extraClosest ?? {}) };
  try {
    const settings = await resolveSettings(schema?.settings, o.instance.settings, sc);
    const section = {
      id: o.id, type: o.type, settings, blocks: await childBlocks(rt, path, o.instance, sc), block_order: o.instance.block_order ?? Object.keys(o.instance.blocks ?? {}),
      index: (o.index ?? rt.sectionCounter) + 1, index0: o.index ?? rt.sectionCounter, location: o.location ?? 'template',
    };
    rt.sectionCounter++;
    const child = ctx.spawn({ section, closest });
    await evalSettingStrings(liquid, settings, child, { section, closest });
    const frame: Frame = { kind: 'section', id: o.id, type: o.type, instance: o.instance, closest };
    rt.stack.push(frame);
    let html: string;
    try { html = (await toPromise(liquid.renderer.renderTemplates(templates, child))) as string; } finally { rt.stack.pop(); }
    const tag = schema?.tag === null ? null : (schema?.tag ?? 'div');
    if (!tag) return html;
    const cls = ['shopify-section', o.group ? `shopify-section-group-${o.group}` : '', schema?.class ?? ''].filter(Boolean).join(' ');
    const editor = rt.designMode ? ` data-shopify-editor-section="${escapeHtml(JSON.stringify({ id: o.id, type: o.type }))}"` : '';
    return `<${tag} id="shopify-section-${escapeHtml(o.id)}" class="${escapeHtml(cls)}"${editor}>${html}</${tag}>`;
  } catch (e) {
    return `<div id="shopify-section-${escapeHtml(o.id)}" class="shopify-section">${errorHtml(rt, path, e)}</div>`;
  }
}

export async function renderBlock(liquid: Liquid, ctx: Context, parent: Frame, id: string, inst: BlockInstance, extra: Record<string, unknown>): Promise<string> {
  const rt = rtOf(ctx);
  const path = `blocks/${inst.type}.liquid`;
  const templates = parsedFile(liquid, rt, path);
  if (!templates) return ''; // @app blocks and unknown types render nothing
  const schema = rt.theme.schema(path);
  const sc = { resolvers: rt.resolvers, schemaLocale: rt.theme.localeFile(rt.defaultLocale, true) };
  const closest = { ...parent.closest, ...extra };
  try {
    const settings = await resolveSettings(schema?.settings, inst.settings, sc);
    const block = { id, type: inst.type, settings, shopify_attributes: editorBlockAttrs(rt, id, inst.type), 'static?': !!inst.static, blocks: await childBlocks(rt, path, inst, sc), index: 1 };
    const section = ctx.getSync(['section']);
    const child = ctx.spawn({ block, section, closest });
    await evalSettingStrings(liquid, settings, child, { block, section, closest });
    rt.stack.push({ kind: 'block', id, type: inst.type, instance: inst, closest });
    let html: string;
    try { html = (await toPromise(liquid.renderer.renderTemplates(templates, child))) as string; } finally { rt.stack.pop(); }
    const tag = schema && 'tag' in schema ? schema.tag : 'div';
    if (!tag) return html;
    const editor = rt.designMode ? ` ${editorBlockAttrs(rt, id, inst.type)}` : '';
    return `<${tag}${attrs({ class: ['shopify-block', schema?.class].filter(Boolean).join(' ') })}${editor}>${html}</${tag}>`;
  } catch (e) {
    return errorHtml(rt, path, e);
  }
}

class ContentForTag extends Tag {
  constructor(token: TagToken, remain: TopLevelToken[], liquid: Liquid) { super(token, remain, liquid); }
  *render(ctx: Context, emitter: Emitter): Gen<void> {
    const { pos, hash } = yield* readArgs(this, ctx, fresh(this) as never, 1);
    const rt = rtOf(ctx);
    const parent = rt.stack[rt.stack.length - 1];
    const kind = String(pos[0] ?? '');
    if (!parent) return;
    if (kind === 'blocks') {
      const inst = parent.instance;
      for (const bid of inst.block_order ?? Object.keys(inst.blocks ?? {})) {
        const b = inst.blocks?.[bid];
        if (!b || b.disabled || b.static) continue;
        emitter.write((yield renderBlock(this.liquid, ctx, parent, bid, b, hash)) as string);
      }
    } else if (kind === 'block') {
      const { type, id, ...extra } = hash;
      const existing = parent.instance.blocks?.[String(id)];
      const inst: BlockInstance = existing ?? { type: String(type), settings: {}, static: true };
      emitter.write((yield renderBlock(this.liquid, ctx, parent, String(id), { ...inst, type: String(type ?? inst.type) }, extra)) as string);
    }
  }
}

class SectionTag extends Tag {
  constructor(token: TagToken, remain: TopLevelToken[], liquid: Liquid) { super(token, remain, liquid); }
  *render(ctx: Context, emitter: Emitter): Gen<void> {
    const { pos } = yield* readArgs(this, ctx, fresh(this) as never, 1);
    const name = String(pos[0] ?? '');
    const rt = rtOf(ctx);
    const data = rt.theme.json<{ current?: { sections?: Record<string, SectionInstance> } }>('config/settings_data.json');
    const instance = data?.current && typeof data.current === 'object' ? data.current.sections?.[name] : undefined;
    emitter.write((yield renderSectionInstance(this.liquid, ctx, { id: name, type: instance?.type ?? name, instance: instance ?? { type: name } })) as string);
  }
}

/** Render every enabled section of a group file (`sections/<name>.json`). */
export async function renderGroup(liquid: Liquid, ctx: Context, name: string): Promise<string> {
  const rt = rtOf(ctx);
  const group = rt.theme.json<SectionGroupJson>(`sections/${name}.json`);
  if (!group) return errorHtml(rt, `sections/${name}.json`, new Error('section group not found'));
  let out = '';
  let i = 0;
  for (const id of group.order ?? Object.keys(group.sections ?? {})) {
    const inst = group.sections?.[id];
    if (!inst || inst.disabled) continue;
    out += await renderSectionInstance(liquid, ctx, { id, type: inst.type, instance: inst, group: name.replace(/-group$/, ''), location: name, index: i++ });
  }
  return out;
}

class SectionsTag extends Tag {
  constructor(token: TagToken, remain: TopLevelToken[], liquid: Liquid) { super(token, remain, liquid); }
  *render(ctx: Context, emitter: Emitter): Gen<void> {
    const { pos } = yield* readArgs(this, ctx, fresh(this) as never, 1);
    emitter.write((yield renderGroup(this.liquid, ctx, String(pos[0] ?? ''))) as string);
  }
}

export function registerTags(l: Liquid): void {
  l.registerTag('schema', NoopBlockTag as never);
  l.registerTag('doc', NoopBlockTag as never);
  l.registerTag('stylesheet', collector('stylesheets') as never);
  l.registerTag('javascript', collector('javascripts') as never);
  l.registerTag('style', StyleTag as never);
  l.registerTag('layout', LayoutTag as never);
  l.registerTag('form', FormTag as never);
  l.registerTag('paginate', PaginateTag as never);
  l.registerTag('content_for', ContentForTag as never);
  l.registerTag('section', SectionTag as never);
  l.registerTag('sections', SectionsTag as never);
}
