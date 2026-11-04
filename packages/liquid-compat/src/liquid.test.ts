import { describe, expect, it } from 'vitest';
import { analyzeTheme, createEngine, lazyList, parseJsonc, Theme, ThemeRenderer, type PageInput } from './index';

const money = { format: '${{amount}}', withCurrency: '${{amount}} USD', currency: 'USD' };

function page(globals: Record<string, unknown> = {}, extra: Partial<PageInput> = {}): PageInput {
  return { template: 'index', globals, request: { path: '/', query: {} }, locale: 'en', money, ...extra };
}

/** Render a snippet of Liquid in a minimal theme with a runtime, via a throwaway template. */
async function liquid(src: string, globals: Record<string, unknown> = {}, files: Record<string, string> = {}, input: Partial<PageInput> = {}): Promise<string> {
  const theme = new Theme({
    'layout/theme.liquid': '{{ content_for_layout }}',
    'templates/index.liquid': src,
    'locales/en.default.json': JSON.stringify({ hello: 'Hello {{ name }}', items: { one: '{{ count }} item', other: '{{ count }} items' }, nested: { k: 'v' } }),
    'assets/icon.svg': '<svg id="i"/>',
    ...files,
  }, { id: 7, version: 'abc' });
  const r = new ThemeRenderer(theme);
  const out = await r.renderPage(page(globals, input));
  return out.html;
}

describe('jsonc', () => {
  it('strips comments and trailing commas', () => {
    expect(parseJsonc('/* head */ { "a": 1, // x\n "b": "//not", }')).toEqual({ a: 1, b: '//not' });
  });
});

describe('filters', () => {
  it('money family', async () => {
    expect(await liquid('{{ 123456 | money }}|{{ 123456 | money_with_currency }}|{{ 123456 | money_without_currency }}|{{ 1000 | money_without_trailing_zeros }}|{{ 1050 | money_without_trailing_zeros }}')).toBe('$1,234.56|$1,234.56 USD|1,234.56|$10|$10.50');
  });
  it('image_url, image_tag, img_url', async () => {
    const image = { src: '/files/a.jpg', alt: 'An <alt>', width: 800, height: 400, aspect_ratio: 2 };
    expect(await liquid('{{ image | image_url: width: 200 }}', { image })).toBe('/files/a.jpg?width=200&height=100');
    const tag = await liquid("{{ image | image_url: width: 200 | image_tag: loading: 'lazy', class: 'c', widths: '100, 200', sizes: '50vw' }}", { image });
    expect(tag).toContain('src="/files/a.jpg?width=200&amp;height=100"');
    expect(tag).toContain('srcset="/files/a.jpg?width=100 100w, /files/a.jpg?width=200 200w"');
    expect(tag).toContain('loading="lazy"');
    expect(tag).toContain('width="200"');
    expect(await liquid("{{ image | img_url: '100x' }}", { image })).toBe('/files/a.jpg?width=100');
    expect(await liquid('{{ image | image_tag }}', { image })).toContain('alt="An &lt;alt&gt;"');
  });
  it('asset_url, file_url, inline_asset_content, stylesheet_tag, script_tag', async () => {
    expect(await liquid("{{ 'a.css' | asset_url }}")).toBe('/cdn/shop/t/7/assets/a.css?v=abc');
    expect(await liquid("{{ 'a.png' | file_url }}")).toBe('/files/a.png');
    expect(await liquid("{{ 'icon.svg' | inline_asset_content }}")).toBe('<svg id="i"/>');
    expect(await liquid("{{ 'a.css' | asset_url | stylesheet_tag }}")).toBe('<link href="/cdn/shop/t/7/assets/a.css?v=abc" rel="stylesheet" type="text/css" media="all">');
    expect(await liquid("{{ '/x.js' | script_tag }}")).toBe('<script src="/x.js"></script>');
  });
  it('t with interpolation, plural and missing keys', async () => {
    expect(await liquid("{{ 'hello' | t: name: 'Ann' }}|{{ 'items' | t: count: 1 }}|{{ 'items' | t: count: 3 }}|{{ 'nested.k' | t }}|{{ 'no.key' | t }}")).toBe('Hello Ann|1 item|3 items|v|translation missing: en.no.key');
  });
  it('t falls back to the default locale', async () => {
    const out = await liquid("{{ 'hello' | t: name: 'x' }}", {}, { 'locales/fr.json': '{"other":"x"}' }, { locale: 'fr' });
    expect(out).toBe('Hello x');
  });
  it('json escapes html and handles nesting', async () => {
    expect(await liquid('{{ o | json }}', { o: { a: '</script>', b: [1, null] } })).toBe('{"a":"\\u003c/script\\u003e","b":[1,null]}');
  });
  it('handleize / handle', async () => {
    expect(await liquid("{{ 'Héllo  World!' | handleize }}|{{ 'A_b' | handle }}")).toBe('hello-world|a-b');
  });
  it('color filters', async () => {
    expect(await liquid("{{ '#1E40AF' | color_lighten: 10 }}|{{ '#1E40AF' | color_darken: 10 }}|{{ '#ff0000' | color_modify: 'alpha', 0.5 }}|{{ '#ffffff' | color_brightness }}|{{ '#000' | color_contrast: '#fff' }}|{{ '#336699' | color_to_rgb }}|{{ '#000' | color_mix: '#fff', 50 }}"))
      .toBe('#2650da|#173083|rgba(255, 0, 0, 0.5)|255|21|rgb(51, 102, 153)|#808080');
  });
  it('link_to, url helpers, within', async () => {
    expect(await liquid("{{ 'Shoes' | link_to: '/x', title: 'T' }}|{{ 'a b' | url_for_type }}|{{ '/products/p' | within: c }}", { c: { handle: 'sale' } }))
      .toBe('<a href="/x" title="T">Shoes</a>|/collections/types?q=a%20b|/collections/sale/products/p');
  });
  it('cart helpers', async () => {
    const cart = { items: [{ variant_id: 1, product_id: 9, quantity: 2 }, { variant_id: 2, product_id: 9, quantity: 3 }] };
    expect(await liquid('{{ cart | item_count_for_variant: 2 }}|{{ cart | line_items_for: p | size }}', { cart, p: { id: 9, variants: [] } })).toBe('3|2');
  });
  it('misc: md5, time_tag, placeholder_svg_tag, font_modify, structured_data', async () => {
    expect(await liquid("{{ 'a' | md5 }}")).toBe('0cc175b9c0f1b6a831c399e269772661');
    expect(await liquid("{{ '2024-03-05T00:00:00Z' | time_tag: '%Y' }}")).toBe('<time datetime="2024-03-05T00:00:00.000Z">2024</time>');
    expect(await liquid("{{ 'product-1' | placeholder_svg_tag: 'ph' }}")).toContain('class="placeholder-svg ph"');
    expect(await liquid("{% assign f = settings.f | font_modify: 'weight', 'bold' %}{{ f.weight }}", { settings: {} })).toBe('700');
    const sd = await liquid('{{ product | structured_data }}', { product: { title: 'P', url: '/products/p', variants: [{ price: 1500, available: true }] }, shop: { currency: 'EUR' } });
    expect(JSON.parse(sd.replace(/\\u003c/g, '<'))).toMatchObject({ '@type': 'Product', offers: [{ price: '15.00', priceCurrency: 'EUR' }] });
  });
  it('standard LiquidJS filters used by themes exist', () => {
    const theme = new Theme({});
    const names = Object.keys(createEngine(theme).filters);
    for (const n of ['append', 'escape', 'default', 'replace', 'divided_by', 'where', 'map', 'find', 'find_index', 'has', 'reject', 'sum', 'sort_natural', 'at_most', 'at_least', 'strip_html', 'truncatewords', 'date', 'newline_to_br', 'compact', 'uniq', 'concat']) expect(names).toContain(n);
  });
});

describe('tags', () => {
  it('schema and doc emit nothing; stylesheet/javascript are hoisted once into the head', async () => {
    const files = {
      'layout/theme.liquid': '<head>{{ content_for_header }}</head>{{ content_for_layout }}',
      'sections/a.liquid': 'A{% doc %}@param x {{ not parsed }}{% enddoc %}{% stylesheet %}.a{color:red}{% endstylesheet %}{% javascript %}window.a=1{% endjavascript %}{% schema %}{"name":"A","settings":[{"type":"text","id":"t","default":"hi {{ x }}"}]}{% endschema %}',
      'templates/index.json': '{"sections":{"s1":{"type":"a"},"s2":{"type":"a"}},"order":["s1","s2"]}',
    };
    const r = new ThemeRenderer(new Theme(files));
    const { html } = await r.renderPage(page());
    expect(html).toContain('<div id="shopify-section-s1" class="shopify-section">A</div>');
    expect(html).not.toContain('not parsed');
    expect(html.match(/\.a\{color:red\}/g)).toHaveLength(1);
    expect(html).toContain('window.a=1');
    expect(html).toContain('<head><meta name="generator" content="ShopMe">');
  });
  it('style renders its body as liquid', async () => {
    expect(await liquid('{% style %}.x{width:{{ w }}px}{% endstyle %}', { w: 5 })).toBe('<style data-shopify>.x{width:5px}</style>');
  });
  it('form emits a form element with hidden inputs and a form object', async () => {
    const out = await liquid("{% form 'product', product, id: 'f1', class: 'pf' %}{{ form.id }}{% endform %}", { product: { id: 42 } });
    expect(out).toContain('<form method="post" action="/cart/add" id="f1" accept-charset="UTF-8" class="pf" enctype="multipart/form-data">');
    expect(out).toContain('name="form_type" value="product"');
    expect(out).toContain('name="product-id" value="42"');
    expect(out.endsWith('f1</form>')).toBe(true);
    expect(await liquid("{% form 'localization' %}x{% endform %}")).toContain('action="/localization"');
  });
  it('paginate slices arrays, builds the paginate object and links', async () => {
    const products = Array.from({ length: 25 }, (_, i) => i + 1);
    const src = '{% paginate c.products by 10 %}{% for p in c.products %}{{ p }},{% endfor %}|{{ paginate.current_page }}/{{ paginate.pages }}|{{ paginate.items }}|{{ paginate.next.url }}|{{ paginate.previous.url }}{% endpaginate %}';
    const o = { c: { products } };
    expect(await liquid(src, o, {}, { request: { path: '/collections/all', query: { sort_by: 'price-ascending', page: '2' } } })).toBe('11,12,13,14,15,16,17,18,19,20,|2/3|25|/collections/all?sort_by=price-ascending&page=3|/collections/all?sort_by=price-ascending');
    expect(await liquid(src, o, {}, { request: { path: '/c', query: { page: '99' } } })).toContain('21,22,23,24,25,|3/3');
  });
  it('paginate uses lazy loaders and default_pagination renders links', async () => {
    const calls: number[][] = [];
    const c = { products: lazyList([1, 2], 7, async (o, l) => { calls.push([o, l]); return [o + 1]; }) };
    const out = await liquid('{% paginate c.products by 3 %}{{ c.products | join: "," }}{{ paginate | default_pagination }}{% endpaginate %}', { c }, {}, { request: { path: '/x', query: { page: '2' } } });
    expect(calls).toEqual([[3, 3]]);
    expect(out).toContain('4<span class="prev"><a href="/x"');
    expect(out).toContain('<span class="page current">2</span>');
    expect(out).toContain('<span class="next"><a href="/x?page=3"');
  });
  it('render is isolated, finds snippets, and keeps globals reachable', async () => {
    const out = await liquid("{% assign secret = 's' %}{% render 'snip', arg: 'A' %}", { shop: { name: 'Shop' } }, { 'snippets/snip.liquid': '[{{ arg }}|{{ secret }}|{{ shop.name }}]' });
    expect(out).toBe('[A||Shop]');
  });
  it('layout none renders without the layout', async () => {
    expect(await liquid('{% layout none %}body')).toBe('body');
    expect(await liquid('body')).toBe('body');
  });
  it('sections group, nested theme blocks, static blocks and closest', async () => {
    const files = {
      'layout/theme.liquid': '{% sections "head-group" %}|{{ content_for_layout }}',
      'sections/head-group.json': '{"type":"header","sections":{"h":{"type":"hdr","settings":{"title":"{{ closest.product.title }}!"}}},"order":["h"]}',
      'sections/hdr.liquid': '<h>{{ section.settings.title }}</h>{% schema %}{"name":"Hdr","tag":"header","class":"hd","settings":[{"type":"text","id":"title","default":"d"}]}{% endschema %}',
      'sections/main.liquid': '{% content_for "blocks" %}#{% content_for "block", type: "badge", id: "b1", product: product %}{% schema %}{"name":"M","tag":null,"blocks":[{"type":"@theme"}]}{% endschema %}',
      'blocks/group.liquid': 'G({% content_for "blocks" %}){% schema %}{"name":"g","tag":null}{% endschema %}',
      'blocks/text.liquid': 'T:{{ block.settings.text }}:{{ block.id }}{% schema %}{"name":"t","tag":null,"settings":[{"type":"text","id":"text","default":"dflt"}]}{% endschema %}',
      'blocks/badge.liquid': 'B:{{ closest.product.title }}:{{ block.settings.label }}{% schema %}{"name":"b","tag":"span","class":"bdg","settings":[{"type":"text","id":"label","default":"L"}]}{% endschema %}',
      'templates/index.json': JSON.stringify({ sections: { main: { type: 'main', blocks: { g: { type: 'group', blocks: { t2: { type: 'text', settings: { text: 'x' } } }, block_order: ['t2'] }, t1: { type: 'text' } }, block_order: ['g', 't1'] } }, order: ['main'] }),
    };
    const r = new ThemeRenderer(new Theme(files));
    const { html, errors } = await r.renderPage(page({ product: { title: 'Mug' } }));
    expect(errors).toEqual([]);
    expect(html).toBe('<header id="shopify-section-h" class="shopify-section shopify-section-group-head hd"><h>Mug!</h></header>|G(T:x:t2)T:dflt:t1#<span class="shopify-block bdg">B:Mug:L</span>');
  });
  it('section tag renders a section file by name', async () => {
    expect(await liquid('{% section "x" %}', {}, { 'sections/x.liquid': 'X{{ section.id }}' })).toBe('<div id="shopify-section-x" class="shopify-section">Xx</div>');
  });
  it('typed settings: image_picker, collection, url, font_picker resolve through resolvers', async () => {
    const files = {
      'config/settings_schema.json': '[{"name":"theme_info"},{"name":"g","settings":[{"type":"image_picker","id":"logo"},{"type":"font_picker","id":"f","default":"system-ui"},{"type":"url","id":"u"},{"type":"range","id":"w","default":3}]}]',
      'config/settings_data.json': '/* c */ {"current":{"logo":"shopify://shop_images/l.png","u":"shopify://collections/all"}}',
      'templates/index.liquid': '{{ settings.logo.src }}|{{ settings.f.family }}|{{ settings.u }}|{{ settings.w }}',
    };
    const r = new ThemeRenderer(new Theme(files), { resolvers: { image: (v) => ({ src: `/files/${v.split('/').pop()}` }) } });
    expect((await r.renderPage(page())).html).toBe('/files/l.png|system-ui|/collections/all|3');
  });
  it('section rendering API renders template, group and file sections', async () => {
    const files = {
      'sections/g-group.json': '{"sections":{"hd":{"type":"hdr"}},"order":["hd"]}',
      'sections/hdr.liquid': 'H',
      'sections/solo.liquid': 'S',
      'templates/index.json': '{"sections":{"m":{"type":"solo"}},"order":["m"]}',
    };
    const out = await new ThemeRenderer(new Theme(files)).renderSections(page(), ['m', 'hd', 'solo', 'nope']);
    expect(out).toEqual({
      m: '<div id="shopify-section-m" class="shopify-section">S</div>',
      hd: '<div id="shopify-section-hd" class="shopify-section shopify-section-group-g">H</div>',
      solo: '<div id="shopify-section-solo" class="shopify-section">S</div>',
      nope: null,
    });
  });
  it('liquid errors in a section are rendered inline and collected', async () => {
    const files = { 'sections/bad.liquid': '{% render "missing" %}', 'templates/index.json': '{"sections":{"b":{"type":"bad"}},"order":["b"]}' };
    const { html, errors } = await new ThemeRenderer(new Theme(files)).renderPage(page());
    expect(html).toContain('<!-- Liquid error');
    expect(errors).toHaveLength(1);
  });
  it('analyzeTheme reports unknown tags and filters', () => {
    const theme = new Theme({ 'sections/x.liquid': '{% weird %}{{ a | nofilter | upcase }}{% liquid\n echo b | other_missing\n%}', 'sections/ok.liquid': '{% if a %}{{ a | money }}{% endif %}' });
    const rep = analyzeTheme(theme, createEngine(theme));
    expect(rep.unknownTags).toEqual({ weird: 1 });
    expect(rep.unknownFilters).toEqual({ nofilter: 1, other_missing: 1 });
    expect(rep.parseFailures).toHaveLength(1);
  });
});
