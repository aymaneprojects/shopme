#!/usr/bin/env node
// ShopMe theme kit: composes a complete theme folder (packages/themes/<handle>/) from shared Liquid plumbing (base/), a few
// variants (header, card, product page, collection), optional extra sections and the per-theme options of themes/<handle>.mjs.
//
//   node scripts/theme-kit/build.mjs [handle...]     write the theme folders (every theme of scripts/theme-kit/themes when none is given)
//   node scripts/theme-kit/build.mjs --check [...]   exit 1 when a committed folder differs from what the kit generates
//
// The output is deterministic: same options, same bytes. Files the kit does not own (demo/images, checksums.json) are left alone.
// See scripts/theme-kit/README.md.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KIT = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(KIT, '../..');
const THEMES_DIR = path.join(ROOT, 'packages/themes');
const FONT_SOURCE = path.join(THEMES_DIR, 'nocturne/assets');
/** Folders of a theme the kit writes (and clears before writing). */
const OWNED = ['layout', 'templates', 'sections', 'blocks', 'snippets', 'config', 'locales', 'assets'];

export const OPTION_CHOICES = {
  header: ['centered', 'mega', 'split'],
  card: ['minimal', 'rounded', 'framed', 'arched'],
  product: ['left', 'stacked', 'rail'],
  collection: ['sidebar', 'topbar'],
  radius: ['sharp', 'soft', 'round', 'pill'],
  spacing: ['compact', 'regular', 'airy'],
  catalogSize: ['one', 'few', 'some', 'many'],
};
/** Fonts ShopMe serves (the woff2 files live in packages/themes/nocturne/assets). */
export const FONTS = {
  'dm-sans': { file: 'font-dm-sans.woff2', family: 'DM Sans', weight: '100 1000', label: 'DM Sans' },
  manrope: { file: 'font-manrope.woff2', family: 'Manrope', weight: '200 800', label: 'Manrope' },
  inter: { file: 'font-inter.woff2', family: 'Inter', weight: '100 900', label: 'Inter' },
  'space-grotesk': { file: 'font-space-grotesk.woff2', family: 'Space Grotesk', weight: '300 700', label: 'Space Grotesk' },
  'playfair-display': { file: 'font-playfair-display.woff2', family: 'Playfair', weight: '400 900', label: 'Playfair Display' },
  lora: { file: 'font-lora.woff2', family: 'Lora', weight: '400 700', label: 'Lora' },
};
const SERIF = new Set(['playfair-display', 'lora']);
const RADIUS = { sharp: { corner_radius: 0, button_radius: 0, input_radius: 0 }, soft: { corner_radius: 10, button_radius: 6, input_radius: 8 }, round: { corner_radius: 20, button_radius: 14, input_radius: 12 }, pill: { corner_radius: 28, button_radius: 999, input_radius: 16 } };
const SPACING = { compact: 56, regular: 80, airy: 112 };
/** Every feature the kit gives a theme (shopme_features); `mega-menu` only comes with the mega header. */
const FEATURES = ['predictive-search', 'cart-drawer', 'selling-plans', 'product-filters', 'colour-swatches', 'quick-add', 'sticky-header', 'infinite-scroll', 'breadcrumbs', 'back-to-top', 'stock-counter', 'countdown-timer', 'age-verification', 'free-shipping-bar', 'multilingual'];

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => isObj(v) && typeof v.en === 'string' && typeof v.fr === 'string' && Object.keys(v).length === 2;
const readText = (p) => readFileSync(p, 'utf8');
const readJson = (p) => JSON.parse(readText(p));
const json = (o) => `${JSON.stringify(o, null, 2)}\n`;
const under = (id) => id.replace(/-/g, '_');
const setPath = (o, dotted, v) => { const p = dotted.split('.'); let c = o; for (const k of p.slice(0, -1)) c = c[k] ??= {}; c[p.at(-1)] = v; };

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

/** Texts written as { en, fr } become their English text; the French one is remembered for `seed_defaults`. */
class Seeds {
  map = {};
  resolve(v) {
    if (isText(v)) { this.add(v.en, v.fr); return v.en; }
    if (Array.isArray(v)) return v.map((x) => this.resolve(x));
    if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, this.resolve(x)]));
    return v;
  }
  add(en, fr) {
    if (en === fr) return;
    if (this.map[en] !== undefined && this.map[en] !== fr) throw new Error(`the text "${en}" has two different French translations`);
    this.map[en] = fr;
  }
}

/* ------------------------------ options ------------------------------ */

export function validate(o) {
  const bad = (m) => { throw new Error(`theme ${o.handle ?? '?'}: ${m}`); };
  if (!/^[a-z][a-z0-9-]{1,38}$/.test(o.handle ?? '')) bad('handle must be lowercase letters, digits and hyphens');
  if (!o.name) bad('name is required');
  if (!OPTION_CHOICES.header.includes(o.header?.layout)) bad(`header.layout must be one of ${OPTION_CHOICES.header.join(', ')}`);
  if (!OPTION_CHOICES.card.includes(o.card?.style)) bad(`card.style must be one of ${OPTION_CHOICES.card.join(', ')}`);
  if (!OPTION_CHOICES.product.includes(o.product?.layout)) bad(`product.layout must be one of ${OPTION_CHOICES.product.join(', ')}`);
  if (!OPTION_CHOICES.collection.includes(o.collection?.layout)) bad(`collection.layout must be one of ${OPTION_CHOICES.collection.join(', ')}`);
  if (!OPTION_CHOICES.radius.includes(o.scale?.radius)) bad(`scale.radius must be one of ${OPTION_CHOICES.radius.join(', ')}`);
  if (!OPTION_CHOICES.spacing.includes(o.scale?.spacing)) bad(`scale.spacing must be one of ${OPTION_CHOICES.spacing.join(', ')}`);
  for (const k of ['heading', 'body', 'accent']) if (!FONTS[o.fonts?.[k]]) bad(`fonts.${k} must be one of ${Object.keys(FONTS).join(', ')}`);
  if (!o.colors?.schemes?.length) bad('colors.schemes needs at least one scheme');
  if (!Array.isArray(o.home) || !o.home.length) bad('home needs a list of sections');
  if (!OPTION_CHOICES.catalogSize.includes(o.info?.catalogSize)) bad(`info.catalogSize must be one of ${OPTION_CHOICES.catalogSize.join(', ')}`);
  for (const id of o.sections ?? []) if (!existsSync(path.join(KIT, 'sections', `${id}.mjs`))) bad(`unknown extra section ${id}`);
  return o;
}

/* ------------------------------ sections ------------------------------ */

/** Turns a section definition (texts as { en, fr }) into its Liquid schema, adding the locale entries it needs to `locale`. */
function schemaOf(def, locale, seeds) {
  const k = under(def.id);
  const put = (dotted, text) => { setPath(locale.en, dotted, text.en); setPath(locale.fr, dotted, text.fr); };
  const lk = `sections.${k}`;
  const build = (list, base) => {
    let headers = 0;
    return list.map((s) => {
      if (s.type === 'header') { headers += 1; put(`${base}.headers.h${headers}`, s.content); return { type: 'header', content: `t:${base}.headers.h${headers}` }; }
      put(`${base}.settings.${s.id}`, s.label);
      const out = { type: s.type, id: s.id, label: `t:${base}.settings.${s.id}` };
      if (s.info) { put(`${base}.info.${s.id}`, s.info); out.info = `t:${base}.info.${s.id}`; }
      if (s.options) out.options = s.options.map((op) => { put(`${base}.options.${s.id}.${op.value}`, op.label); return { value: op.value, label: `t:${base}.options.${s.id}.${op.value}` }; });
      for (const extra of ['min', 'max', 'step', 'unit', 'variant']) if (s[extra] !== undefined) out[extra] = s[extra];
      if (s.default !== undefined) out.default = seeds.resolve(s.default);
      return out;
    });
  };
  put(`${lk}.name`, def.name);
  const schema = { name: `t:${lk}.name`, tag: 'section', settings: build(def.settings ?? [], lk) };
  if (def.blocks?.length) {
    schema.blocks = def.blocks.map((b) => { put(`${lk}.blocks.${b.type}.name`, b.name); return { type: b.type, name: `t:${lk}.blocks.${b.type}.name`, settings: build(b.settings ?? [], `${lk}.blocks.${b.type}`) }; });
    if (def.max_blocks) schema.max_blocks = def.max_blocks;
  }
  if (def.presets) schema.presets = def.presets.map((p) => { put(`${lk}.presets.${k}`, p.name); return { name: `t:${lk}.presets.${k}`, ...(p.blocks ? { blocks: seeds.resolve(p.blocks) } : {}) }; });
  return `\n{% schema %}\n${JSON.stringify(schema, null, 2)}\n{% endschema %}\n`;
}

/* ------------------------------ composition ------------------------------ */

/** templates/index.json from the list of home sections: [{ id, type, settings, blocks: [{ type, settings }], disabled }]. */
function homeTemplate(list, seeds) {
  const sections = {};
  const order = [];
  for (const s of list) {
    const entry = { type: s.type };
    if (s.blocks?.length) {
      entry.blocks = {};
      entry.block_order = [];
      s.blocks.forEach((b, i) => { const id = `${b.type}-${i + 1}`; entry.blocks[id] = { type: b.type, settings: seeds.resolve(b.settings ?? {}) }; entry.block_order.push(id); });
    }
    entry.settings = seeds.resolve(s.settings ?? {});
    if (s.disabled) entry.disabled = true;
    sections[s.id] = entry;
    order.push(s.id);
  }
  return json({ sections, order });
}

/** Sets `default` of the setting `id` wherever it is in the schema groups. */
function setDefault(groups, id, value) {
  for (const g of groups) for (const s of g.settings ?? []) if (s.id === id) s.default = value;
}

function settingsFor(o, schema) {
  const radius = RADIUS[o.scale.radius];
  const type = o.type ?? {};
  const presets = {
    preset_paragraph_size: 100, preset_paragraph_line_height: type.lineHeight ?? 160,
    preset_h1_size: type.h1 ?? 320, preset_h1_weight: type.headingWeight ?? 500, preset_h1_line_height: type.h1LineHeight ?? 110, preset_h1_case: type.headingCase ?? 'none',
    preset_h2_size: type.h2 ?? 220, preset_h2_weight: type.headingWeight ?? 500, preset_h2_line_height: 115, preset_h2_case: type.headingCase ?? 'none',
    preset_h3_size: 150, preset_h3_weight: type.headingWeight ?? 500, preset_h4_weight: type.headingWeight ?? 500,
  };
  const s = {
    color_primary: o.colors.accent, color_background: o.colors.background, color_surface: o.colors.surface, color_card: o.colors.card ?? '#ffffff', color_text: o.colors.text, color_sale: o.colors.sale ?? '#a8322d',
    type_body_font: o.fonts.body, type_heading_font: o.fonts.heading, type_accent_font: o.fonts.accent, type_base_size: type.baseSize ?? 16,
    ...presets,
    page_width: o.scale.pageWidth ?? 1240, ...radius, section_spacing: SPACING[o.scale.spacing],
    card_image_ratio: o.card.ratio ?? 'portrait', card_text_align: o.card.align ?? 'center', card_show_quick_add: o.card.quickAdd ?? true, card_show_swatches: true, show_vendor: o.card.showVendor ?? false,
    button_uppercase: o.buttons?.uppercase ?? false, button_height: o.buttons?.height ?? 48, button_border_width: o.buttons?.border ?? 1, button_font: o.buttons?.font ?? 'body',
    free_shipping_threshold: o.freeShipping ?? 50, logo_width: o.logoWidth ?? 140, badge_sold_out_color: o.colors.soldOut ?? '#4a5160',
    swatch_shape: o.scale.swatch ?? 'circle', anim_card_zoom: true,
    show_breadcrumbs: o.features?.breadcrumbs ?? true, show_back_to_top: o.features?.backToTop ?? true, stock_counter: o.features?.stockCounter ?? true, stock_threshold: o.features?.stockThreshold ?? 10,
    age_gate_enabled: o.features?.ageGate ?? false, age_gate_min_age: o.features?.ageGateMinAge ?? 18,
    swatch_colors: o.colors.swatchColors ?? '',
    ...(o.settings ?? {}),
  };
  return s;
}

function schemaGroups(o, base, themeInfo) {
  const groups = JSON.parse(JSON.stringify(base));
  groups[0] = themeInfo;
  const colors = groups.find((g) => g.name === 't:settings_schema.colors.name');
  const at = colors.settings.findIndex((s) => s.id === 'color_surface');
  colors.settings.splice(at + 1, 0, { type: 'color', id: 'color_card', label: 't:settings_schema.colors.settings.color_card', default: '#ffffff' });
  const schemes = groups.find((g) => g.name === 't:settings_schema.color_schemes.name').settings.find((s) => s.id === 'color_schemes');
  const sAt = schemes.definition.findIndex((s) => s.id === 'surface');
  schemes.definition.splice(sAt + 1, 0, { type: 'color', id: 'card', label: 't:settings_schema.color_schemes.definition.settings.card', default: '#ffffff' });
  // fonts: the ones the theme ships, plus the system stacks
  const shipped = [...new Set([o.fonts.heading, o.fonts.body, o.fonts.accent, ...(o.fonts.extra ?? [])])];
  const typo = groups.find((g) => g.name === 't:settings_schema.typography.name');
  for (const id of ['type_body_font', 'type_heading_font', 'type_accent_font']) {
    const s = typo.settings.find((x) => x.id === id);
    s.options = ['system-sans', 'system-serif', ...shipped].map((v) => ({ value: v, label: `t:settings_schema.typography.options.${id}.${under(v)}` }));
  }
  // features group, before the animations
  const features = {
    name: 't:settings_schema.features.name',
    settings: [
      { type: 'checkbox', id: 'show_breadcrumbs', label: 't:settings_schema.features.settings.show_breadcrumbs', default: true },
      { type: 'checkbox', id: 'show_back_to_top', label: 't:settings_schema.features.settings.show_back_to_top', default: true },
      { type: 'checkbox', id: 'stock_counter', label: 't:settings_schema.features.settings.stock_counter', default: true },
      { type: 'range', id: 'stock_threshold', label: 't:settings_schema.features.settings.stock_threshold', min: 2, max: 50, step: 1, default: 10 },
      { type: 'checkbox', id: 'age_gate_enabled', label: 't:settings_schema.features.settings.age_gate_enabled', info: 't:settings_schema.features.info.age_gate_enabled', default: false },
      { type: 'range', id: 'age_gate_min_age', label: 't:settings_schema.features.settings.age_gate_min_age', min: 16, max: 21, step: 1, default: 18 },
    ],
  };
  groups.splice(groups.length - 1, 0, features);
  const values = settingsFor(o, groups);
  for (const [id, value] of Object.entries(values)) setDefault(groups, id, value);
  // the swatch colours text setting has no default in the base
  return { groups, values };
}

/** Everything the kit writes for a theme, as a Map of relative path to string or Buffer (sorted by path). */
export async function compose(options) {
  const o = validate(options);
  const seeds = new Seeds();
  const files = new Map();
  const put = (p, body) => files.set(p, body);
  const fontIds = [...new Set([o.fonts.heading, o.fonts.body, o.fonts.accent, ...(o.fonts.extra ?? [])])];
  const arched = o.card.style === 'arched' || o.scale.arch === true;
  const tokens = {
    '@H@': o.handle,
    '@N@': o.name,
    '@CARD@': o.card.style,
    '@PDP@': o.product.layout,
    '@GALLERY_RATIO@': o.product.ratio === 'square' ? '1 / 1' : '4 / 5',
    '@FILTERS@': o.collection.layout === 'sidebar' ? 'side' : 'bar',
    '@INFINITE@': String(o.collection.infiniteScroll === true),
    '@ARCH@': arched ? 'calc(var(--round) * 6)' : 'var(--round)',
    '@FONT_FACES@': fontIds.map((f) => `  @font-face { font-family: '${o.name} ${FONTS[f].family}'; src: url({{ '${FONTS[f].file}' | asset_url }}) format('woff2'); font-weight: ${FONTS[f].weight}; font-display: swap; }`).join('\n'),
  };
  const fill = (text) => Object.entries(tokens).reduce((t, [k, v]) => t.split(k).join(v), text);

  // 1. shared plumbing
  const baseDir = path.join(KIT, 'base');
  for (const rel of walk(baseDir)) {
    if (rel.startsWith('locales/') || rel === 'config/settings_schema.json' || rel === 'templates/index.json') continue;
    put(rel, fill(readText(path.join(baseDir, rel))));
  }

  // 2. variants
  put('sections/header.liquid', fill(readText(path.join(KIT, `variants/header/${o.header.layout}.liquid`)) + readText(path.join(KIT, 'variants/header/_schema.liquid'))));
  put('snippets/product-gallery.liquid', fill(readText(path.join(KIT, `variants/gallery/${o.product.layout === 'stacked' ? 'stacked' : 'switcher'}.liquid`))));

  // 3. locales and extra sections
  const locale = { en: readJson(path.join(baseDir, 'locales/en.default.json')), fr: readJson(path.join(baseDir, 'locales/fr.json')) };
  const schemaLocale = { en: readJson(path.join(baseDir, 'locales/en.default.schema.json')), fr: readJson(path.join(baseDir, 'locales/fr.schema.json')) };
  let sectionCss = '';
  const extraIds = ['countdown', ...(o.sections ?? []).filter((x) => x !== 'countdown')];
  for (const id of extraIds) {
    const def = (await import(pathToFileURL(path.join(KIT, 'sections', `${id}.mjs`)).href)).default;
    put(`sections/${id}.liquid`, def.liquid + schemaOf(def, schemaLocale, seeds));
    sectionCss += `\n/* Section: ${id} */${def.css ?? ''}`;
  }
  for (const f of fontIds) for (const lang of ['en', 'fr']) for (const id of ['type_body_font', 'type_heading_font', 'type_accent_font']) setPath(schemaLocale[lang], `settings_schema.typography.options.${id}.${under(f)}`, FONTS[f].label);
  if (o.locale) for (const lang of ['en', 'fr']) for (const [key, value] of Object.entries(o.locale[lang] ?? {})) setPath(locale[lang], key, value);

  // 4. stylesheet and script
  const cssParts = ['core', 'hero', 'header', `header-${o.header.layout}`, `card-${o.card.style}`, `pdp-${o.product.layout === 'stacked' ? 'stacked' : o.product.layout}`, `listing-${o.collection.layout === 'sidebar' ? 'side' : 'bar'}`, 'features'];
  const css = cssParts.map((p) => readText(path.join(KIT, `css/${p}.css`)).trimEnd()).join('\n') + sectionCss.trimEnd() + (o.css ? `\n/* ${o.name} */\n${o.css.trim()}` : '') + '\n';
  put(`assets/${o.handle}.css`, fill(css));
  const core = readText(path.join(KIT, 'js/core.js'));
  const cut = core.lastIndexOf('}());');
  put(`assets/${o.handle}.js`, fill(`${core.slice(0, cut)}${readText(path.join(KIT, 'js/features.js')).trimEnd()}\n${core.slice(cut)}`));
  for (const f of fontIds) put(`assets/${FONTS[f].file}`, readFileSync(path.join(FONT_SOURCE, FONTS[f].file)));
  const licenses = readText(path.join(FONT_SOURCE, 'font-licenses.txt')).split(/^(?==== )/m);
  const head = licenses.shift().replace(/bundled with the \w+ theme/, `bundled with the ${o.name} theme`);
  put('assets/font-licenses.txt', head + licenses.filter((s) => fontIds.some((f) => s.startsWith(`=== ${f} ===`))).join(''));

  // 5. settings
  const info = o.info;
  const features = [...FEATURES, ...(o.header.layout === 'mega' ? ['mega-menu'] : [])].filter((f) => f !== 'quick-add' || o.card.quickAdd !== false).sort();
  const themeInfo = {
    name: 'theme_info', theme_name: o.name, theme_version: o.version ?? '1.0.0', theme_author: 'ShopMe contributors',
    theme_documentation_url: 'https://github.com/aymaneprojects/shopme/blob/main/docs/spec/theme-format.md', theme_support_url: 'https://github.com/aymaneprojects/shopme/issues',
    shopme_description: info.description.en, shopme_tags: info.tags, shopme_industries: info.industries, shopme_catalog_size: info.catalogSize, shopme_features: features,
    shopme_descriptions: { fr: info.description.fr },
  };
  const { groups, values } = schemaGroups(o, readJson(path.join(baseDir, 'config/settings_schema.json')), themeInfo);
  put('config/settings_schema.json', json(groups));
  const schemes = Object.fromEntries(o.colors.schemes.map((s, i) => [`scheme-${i + 1}`, { settings: { name: s.name, background: s.background, text: s.text, surface: s.surface, card: s.card ?? s.surface, border: s.border, button: s.button, button_label: s.button_label } }]));
  const everything = {};
  for (const g of groups) for (const st of g.settings ?? []) if (st.id && st.default !== undefined && st.type !== 'color_scheme_group') everything[st.id] = st.default;
  const current = { ...everything, ...values, color_schemes: schemes, logo: '', favicon: '' };
  put('config/settings_data.json', json({ current, presets: { [o.name]: current } }));

  // 6. templates and groups
  put('templates/index.json', homeTemplate(o.home, seeds));
  for (const [name, list] of Object.entries(o.templates ?? {})) put(`templates/${name}.json`, homeTemplate(list, seeds));
  const collectionTpl = JSON.parse(fill(readText(path.join(baseDir, 'templates/collection.json'))));
  Object.assign(collectionTpl.sections.main.settings, { columns: String(o.collection.columns ?? 3), products_per_page: o.collection.perPage ?? 12, infinite_scroll: o.collection.infiniteScroll === true });
  put('templates/collection.json', json(collectionTpl));
  const productTpl = JSON.parse(readText(path.join(baseDir, 'templates/product.json')));
  (o.product.benefits ?? []).forEach((b, i) => { const blk = productTpl.sections.main.blocks[`benefit-${i + 1}`]; if (blk) { blk.settings.icon = b.icon; blk.settings.text = seeds.resolve(b.text); } });
  put('templates/product.json', json(productTpl));
  const headerGroup = JSON.parse(readText(path.join(baseDir, 'sections/header-group.json')));
  Object.assign(headerGroup.sections.announcement.settings, { text: seeds.resolve(o.announcement?.text ?? ''), link: o.announcement?.link ?? '', color_scheme: o.announcement?.scheme ?? 'scheme-1', show: o.announcement !== null });
  Object.assign(headerGroup.sections.header.settings, { sticky: o.header.sticky ?? true, transparent_home: o.header.transparentHome ?? false });
  put('sections/header-group.json', json(headerGroup));
  const footerGroup = JSON.parse(readText(path.join(baseDir, 'sections/footer-group.json')));
  footerGroup.sections.footer.settings.color_scheme = o.footerScheme ?? 'scheme-3';
  put('sections/footer-group.json', json(footerGroup));

  // 7. locales. A theme text that contains a storefront string (a locale leaf) would stay English on a French shop whose
  // seed texts were not applied, so the kit refuses it: reword the theme text.
  const leavesOf = (obj, prefix = '', out = {}) => { for (const [k, v] of Object.entries(obj)) { if (typeof v === 'string') out[`${prefix}${k}`] = v; else if (isObj(v)) leavesOf(v, `${prefix}${k}.`, out); } return out; };
  const enLeaves = leavesOf(locale.en);
  const frLeaves = leavesOf({ ...locale.fr, seed_defaults: undefined });
  for (const [en] of Object.entries(seeds.map)) {
    for (const [key, leaf] of Object.entries(enLeaves)) {
      if (leaf.length >= 10 && /\s/.test(leaf) && !leaf.includes('{{') && en.includes(fill(leaf)) && frLeaves[key] !== leaf) throw new Error(`theme ${o.handle}: the text "${en}" contains the storefront string "${leaf}" (${key}); reword it`);
    }
  }
  locale.fr.seed_defaults = seeds.map;
  put('locales/en.default.json', fill(json(locale.en)));
  put('locales/fr.json', fill(json(locale.fr)));
  put('locales/en.default.schema.json', fill(json(schemaLocale.en)));
  put('locales/fr.schema.json', fill(json(schemaLocale.fr)));
  put('LICENSE', readText(path.join(KIT, 'LICENSE.txt')));
  put('changelog.json', json(changelogOf(o)));

  // 8. demo catalogue (the photos in demo/images are made by demo-images.mjs)
  if (o.demo) {
    put('demo/catalog.json', json(catalogOf(o)));
    put('demo/README.md', demoReadme(o));
  }
  return new Map([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function changelogOf(o) {
  const c = o.changelog;
  return {
    about: `What changed in each version of ${o.name}, shown to merchants in Online Store > Themes when an update is available. Newest first; one short line per change, in English (en) and French (fr).`,
    versions: [{ version: o.version ?? '1.0.0', date: o.date ?? '2026-11-06', notes: { en: c.map((x) => x.en), fr: c.map((x) => x.fr) } }],
  };
}

function demoReadme(o) {
  return `# ${o.name} demo catalogue\n\nThis folder is not part of the theme: the theme installer ignores it. It holds the catalogue the theme previews and the theme store demo are built from (\`catalog.json\`) and its photos (\`images/\`).\n\nThe photos are provided by the ShopMe project and are free to use (CC0).\n`;
}

/** demo/catalog.json: the hand-written demo catalogue plus the home page texts, taken from the theme's own composition. */
function catalogOf(o) {
  const homepage = { en: {}, fr: {} };
  for (const s of o.home) {
    const walk2 = (settings, key) => {
      for (const [k, v] of Object.entries(settings ?? {})) if (isText(v)) { (homepage.en[key] ??= {})[k] = v.en; (homepage.fr[key] ??= {})[k] = v.fr; }
    };
    walk2(s.settings, s.id);
    (s.blocks ?? []).forEach((b, i) => walk2(b.settings, `${s.id}.${b.type}-${i + 1}`));
  }
  return { storeName: o.name, ...o.demo, homepage: { ...homepage, images: o.demo.homeImages ?? {} }, homeImages: undefined };
}

/* ------------------------------ writing ------------------------------ */

export async function loadOptions(handle) {
  return (await import(pathToFileURL(path.join(KIT, 'themes', `${handle}.mjs`)).href)).default;
}
export const listThemes = () => readdirSync(path.join(KIT, 'themes')).filter((f) => f.endsWith('.mjs')).map((f) => f.slice(0, -4)).sort();

export async function writeTheme(handle) {
  const files = await compose(await loadOptions(handle));
  const dir = path.join(THEMES_DIR, handle);
  for (const d of [...OWNED, 'LICENSE', 'changelog.json', 'demo/catalog.json', 'demo/README.md']) rmSync(path.join(dir, d), { recursive: true, force: true });
  for (const [rel, body] of files) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return files.size;
}

/** Differences between what the kit generates and the folder on disk (empty when they match). */
export async function diffTheme(handle) {
  const files = await compose(await loadOptions(handle));
  const dir = path.join(THEMES_DIR, handle);
  const problems = [];
  for (const [rel, body] of files) {
    const full = path.join(dir, rel);
    if (!existsSync(full)) { problems.push(`missing ${rel}`); continue; }
    if (!readFileSync(full).equals(Buffer.isBuffer(body) ? body : Buffer.from(body))) problems.push(`differs ${rel}`);
  }
  for (const d of OWNED) if (existsSync(path.join(dir, d))) for (const rel of walk(path.join(dir, d))) if (!files.has(`${d}/${rel}`)) problems.push(`stale ${d}/${rel}`);
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const wanted = args.filter((a) => !a.startsWith('--'));
  const handles = wanted.length ? wanted : listThemes();
  let failed = false;
  for (const h of handles) {
    if (!listThemes().includes(h)) { console.error(`unknown theme "${h}" (kit themes: ${listThemes().join(', ')})`); process.exit(1); }
    if (check) {
      const problems = await diffTheme(h);
      if (problems.length) { failed = true; console.error(`${h}: out of date\n  ${problems.slice(0, 10).join('\n  ')}`); } else console.log(`${h}: up to date`);
    } else {
      console.log(`${h}: wrote ${await writeTheme(h)} files`);
    }
  }
  process.exit(failed ? 1 : 0);
}
