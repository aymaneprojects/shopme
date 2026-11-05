import { Context, type Liquid } from 'liquidjs';
import { createEngine } from './engine';
import { escapeHtml, type Runtime } from './runtime';
import { renderGroup, renderSectionInstance } from './tags';
import { resolveSettings, type Theme } from './theme';
import type { ResourceResolvers, SectionGroupJson, SectionInstance, TemplateJson } from './types';

export const HEAD_MARKER = '<!--shopme:head-->';

export interface PageInput {
  /** Template base name: `index`, `product`, `collection`, `list-collections`, `cart`, `search`, `page`, `404`, `password`, ... */
  template: string;
  suffix?: string | null;
  /** Page-level objects (`shop`, `cart`, `product`, `collection`, `request`, `routes`, `linklists`, ...). */
  globals: Record<string, unknown>;
  request: { path: string; query: Record<string, string | string[] | undefined> };
  locale: string;
  money: Runtime['money'];
  /** Per-request data lookups for typed settings; overrides the renderer default. */
  resolvers?: ResourceResolvers;
  /** Emit editor attributes on section and block wrappers (theme editor preview only). */
  designMode?: boolean;
}

export interface RendererOptions { resolvers?: ResourceResolvers }

/** Renders pages and sections of one theme. Create one per theme version; it caches the engine and parsed templates. */
export class ThemeRenderer {
  readonly engine: Liquid;
  private resolvers: ResourceResolvers;

  constructor(readonly theme: Theme, opts: RendererOptions = {}) {
    this.engine = createEngine(theme);
    this.resolvers = opts.resolvers ?? {};
  }

  setResolvers(r: ResourceResolvers): void { this.resolvers = r; }

  private async context(input: PageInput): Promise<{ ctx: Context; rt: Runtime; globals: Record<string, unknown> }> {
    const theme = this.theme;
    const rt: Runtime = {
      theme, engine: this.engine, resolvers: input.resolvers ?? this.resolvers, locale: input.locale, defaultLocale: theme.defaultLocale(), money: input.money, request: input.request,
      stylesheets: new Map(), javascripts: new Map(), layout: undefined, stack: [], sectionCounter: 0, errors: [], designMode: !!input.designMode,
      assetUrl: (n) => `/cdn/shop/t/${theme.id}/assets/${n}?v=${theme.version}`,
      fileUrl: (n) => `/files/${n}`,
    };
    const settings = await resolveSettings(theme.globalSettingDefs(), theme.globalSettingValues(), { resolvers: rt.resolvers, schemaLocale: theme.localeFile(rt.defaultLocale, true) });
    const globals: Record<string, unknown> = {
      content_for_header: HEAD_MARKER,
      template: { name: input.template, suffix: input.suffix ?? null, directory: null },
      ...input.globals, settings, __rt: rt,
    };
    const ctx = new Context({}, this.engine.options, { globals, sync: false });
    return { ctx, rt, globals };
  }

  /** Full page: template -> `content_for_layout` -> layout. Returns HTML. */
  async renderPage(input: PageInput): Promise<{ html: string; errors: string[] }> {
    const { ctx, rt, globals } = await this.context(input);
    const found = this.theme.findTemplate(input.template, input.suffix);
    let body = '';
    let layout: string | null | undefined;
    if (!found) body = `<!-- template ${escapeHtml(input.template)} not found -->`;
    else if (found.kind === 'json') {
      const tpl = this.theme.json<TemplateJson>(found.path) ?? {};
      layout = tpl.layout === false ? null : tpl.layout;
      let i = 0;
      for (const id of tpl.order ?? Object.keys(tpl.sections ?? {})) {
        const inst = tpl.sections?.[id];
        if (!inst || inst.disabled) continue;
        body += await renderSectionInstance(this.engine, ctx, { id, type: inst.type, instance: inst, index: i++ });
      }
    } else {
      try { body = await this.engine.render(this.engine.parse(this.theme.source(found.path)!, found.path), {}, { globals }); } catch (e) { body = `<!-- ${escapeHtml(e instanceof Error ? e.message : e)} -->`; rt.errors.push(`${found.path}: ${String(e)}`); }
      layout = rt.layout;
    }
    if (rt.layout !== undefined) layout = rt.layout;
    let html = body;
    const layoutName = layout === undefined ? 'theme' : layout;
    if (layoutName && this.theme.has(`layout/${layoutName}.liquid`)) {
      try {
        html = await this.engine.render(this.engine.parse(this.theme.source(`layout/${layoutName}.liquid`)!, `layout/${layoutName}.liquid`), { content_for_layout: body }, { globals });
      } catch (e) {
        rt.errors.push(`layout/${layoutName}.liquid: ${String(e)}`);
        html = `<!doctype html><title>Error</title><body>${escapeHtml(e instanceof Error ? e.message : e)}</body>`;
      }
    }
    return { html: html.replace(HEAD_MARKER, headInjection(rt)), errors: rt.errors };
  }

  /** Section Rendering API: `{ id: html }`. Unknown ids map to null. */
  async renderSections(input: PageInput, ids: string[]): Promise<Record<string, string | null>> {
    const { ctx } = await this.context(input);
    const out: Record<string, string | null> = {};
    const tpl = this.templateSections(input);
    const groups = this.theme.paths('sections/').filter((p) => p.endsWith('.json'));
    for (const id of ids) {
      let inst: SectionInstance | undefined = tpl[id];
      let group: string | undefined;
      if (!inst) {
        for (const g of groups) {
          const j = this.theme.json<SectionGroupJson>(g);
          if (j?.sections?.[id]) { inst = j.sections[id]; group = g.replace(/^sections\/|\.json$/g, '').replace(/-group$/, ''); break; }
        }
      }
      if (!inst && this.theme.has(`sections/${id}.liquid`)) inst = { type: id };
      out[id] = inst ? await renderSectionInstance(this.engine, ctx, { id, type: inst.type, instance: inst, group, location: group ? `${group}-group` : 'template' }) : null;
    }
    return out;
  }

  /** Render a whole group (used by the Section Rendering API for `header-group` style names). */
  async renderGroupByName(input: PageInput, name: string): Promise<string> {
    const { ctx } = await this.context(input);
    return renderGroup(this.engine, ctx, name);
  }

  private templateSections(input: PageInput): Record<string, SectionInstance> {
    const found = this.theme.findTemplate(input.template, input.suffix);
    return found?.kind === 'json' ? this.theme.json<TemplateJson>(found.path)?.sections ?? {} : {};
  }
}

function headInjection(rt: Runtime): string {
  let out = '<meta name="generator" content="ShopMe">';
  const css = [...rt.stylesheets.values()].filter(Boolean).join('\n');
  if (css) out += `<style data-shopme-sections>\n${css}\n</style>`;
  const js = [...rt.javascripts.values()].filter(Boolean).join('\n');
  if (js) out += `<script data-shopme-sections>\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`;
  return out;
}
