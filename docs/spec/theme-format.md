# Theme format (Online Store 2.0 compatible)

Status: draft. Derived from public documentation and from two themes downloaded from our own development store
(Horizon 4.4.0, a block-based theme; and "test-data-main", a section-based generated-data theme). Everything here is
described in our own words; file names, directory names, JSON keys, setting types and tag/object names are listed because
compatibility requires them. Counts are from those two themes only ("H" = Horizon, "T" = test-data-main).

A Shoppen theme loader must accept a directory (or zip) laid out as below and render it with the Liquid dialect described
in [liquid-compat.md](liquid-compat.md).

## 1. Directory layout

| Directory | Role | H files | T files |
|---|---|---:|---:|
| `layout/` | Document shells (`<html>` to `</html>`). `theme.liquid` is the default; `password.liquid` wraps the storefront password page. | 2 | 2 |
| `templates/` | One entry per page type. JSON templates (composition data) or Liquid templates. Sub-directory `customers/` for account pages. | 13 | 20 |
| `sections/` | Page regions. `.liquid` files carry markup plus a schema; `.json` files are **section groups** (shared header/footer-like areas). | 42 (40 liquid + 2 json) | 52 (50 liquid + 2 json) |
| `blocks/` | **Theme blocks**: reusable, nestable components with their own schema, available to any section that accepts them. Not present in the older style of theme. | 95 | 0 |
| `snippets/` | Reusable fragments included with `{% render %}`. No schema, no merchant settings. | 144 | 60 |
| `config/` | `settings_schema.json` (definition of global theme settings) and `settings_data.json` (current values). | 2 | 2 |
| `locales/` | Runtime translations (`<locale>.json`, default `<locale>.default.json`) and editor translations (`<locale>.schema.json`). | 83 (47 runtime + 36 schema) | 52 (31 runtime + 21 schema) |
| `assets/` | Flat directory (no sub-folders) of static files: CSS, JS, SVG, images, fonts. | 125 | 86 |

Other observations:

- Horizon additionally ships an `AGENTS.md` at the root and, inside `assets/`, development-only files (`package.json`,
  `jsconfig.json`, four `*.d.ts` files). Dev files must be tolerated and need not be served.
- Asset file types: H = 81 `.js`, 35 `.svg`, 3 `.css`, 4 `.ts`, 2 `.json`; T = 58 `.css`, 28 `.js`. No Liquid-processed
  assets (`*.css.liquid`, `*.js.liquid`) occur in either theme; the format also allows them, so support is P2.
- Blocks whose file name starts with an underscore (51 of 95 in H) are private building blocks: not offered to the
  merchant, used by name from other blocks, sections or presets. The underscore is a convention, not a rule the loader
  must enforce (the schema's accepted-block list is what governs availability).
- Locale file names: `en.default.json` (the shop default language carries the `.default` infix), `fr.json`, `pt-BR.json`,
  `bg-BG.json`. Runtime locale files may contain `//` line comments (JSON with comments), so the parser must tolerate them.
  Runtime keys are nested objects; leaf strings use `{{ name }}` interpolation; plural forms are objects with
  keys such as `one` / `other`.
- Templates and section groups written by the theme editor start with a block comment (a warning header) before the JSON
  value; strip a leading `/* ... */` before parsing.

### Rendering pipeline in one paragraph

Request resolves to a template name (+ optional suffix, see 2.3) -> template (JSON: list of sections; Liquid: markup) is
rendered into the string `content_for_layout` -> the layout is rendered with that string, `content_for_header`, and
`{% sections 'group' %}` expansions -> HTML out. Sections are always rendered by the `section` machinery (they receive a
`section` object; blocks get a `block` object).

## 2. Layouts

Required placeholders in a layout:

- `{{ content_for_header }}`: inside `<head>`; the platform injects scripts, analytics/monitoring and editor hooks here.
  Shoppen must provide this object even if it emits only its own minimal head content. Present in every layout of both themes.
- `{{ content_for_layout }}`: inside `<body>`; the rendered template. Present in every layout.

Other layout conventions seen:

- Shared areas are included with `{% sections 'header-group' %}` and `{% sections 'footer-group' %}` (section groups, see 4).
- Layouts reference `request.locale.iso_code`, `request.locale.direction` and `request.design_mode` on the `<html>` element.
- Both themes have `layout/password.liquid`; the `password` template selects it with the top-level JSON key
  `"layout": "password"` (string = layout file name without extension; public docs also describe `false` for "no layout", not observed here).
- The gift card template is a Liquid template that begins with `{% layout none %}` and renders its own complete HTML document.
- The layouts render many snippets for head content (meta tags, stylesheets, scripts, CSS variable generation from theme
  settings). One snippet emits an `importmap` mapping `@theme/...` names to `asset_url` URLs and one entry to a
  platform-hosted script; Shoppen must either host a replacement or stub that module.

## 3. Templates

### 3.1 Template names

H has 13 templates and T has 20 (including 7 under `customers/`). Names observed:

`index`, `collection`, `product`, `cart`, `search`, `page`, `blog`, `article`, `list-collections`, `404`, `password`,
`gift_card` (Liquid), `page.contact` (alternate), and for account pages `customers/account`, `customers/login`,
`customers/register`, `customers/addresses`, `customers/order`, `customers/reset_password`,
`customers/activate_account` (T only; H lacks them, i.e. account templates are optional and fall back to platform defaults).

### 3.2 JSON vs Liquid templates

Template extension may be `.json` or `.liquid`. A JSON template cannot contain markup; it only composes sections. Liquid
templates are still allowed (observed: `gift_card.liquid` in both). If both a JSON and a Liquid file exist for the same name, behavior is undefined here; Shoppen should reject such a theme or prefer JSON.

### 3.3 Alternate templates and `templateSuffix`

A resource (product, collection, page, blog, article) may select an alternate template. The file name is
`<type>.<suffix>.json` (or `.liquid`); the resource's `template_suffix` / GraphQL `templateSuffix` holds `<suffix>`.
Observed alternate: `page.contact.json` (suffix `contact`). Resolution: if the resource has a suffix and
`<type>.<suffix>.*` exists use it, otherwise fall back to `<type>.*`. In the Admin API samples every product and
collection has `templateSuffix: null`.

### 3.4 JSON template structure

Top-level keys (H: 12 JSON templates; T: 19):

| Key | Type | Required | Meaning |
|---|---|---|---|
| `sections` | object: section-id -> section instance | yes | All section instances on the page, keyed by instance id. |
| `order` | array of section-id | yes | Render order. Ids not in `order` are not rendered. |
| `layout` | string or false | no (1 in each theme: `password`) | Layout file to use. |

Section instance keys (H: 19 instances; T: 27):

| Key | Type | Meaning |
|---|---|---|
| `type` | string | File name in `sections/` (without `.liquid`) that renders this instance. Always present. |
| `settings` | object | Values for the section's schema settings, by setting `id`. Present in all instances. |
| `blocks` | object: block-id -> block instance | Block instances (see below). |
| `block_order` | array of block-id | Render order of the dynamic blocks. Present when `blocks` is non-empty (12 of 19 instances in H; 8 of 27 in T; a section may also have `blocks` without `block_order`). |
| `name` | string | Optional display-name override, often a `t:` key (9 in H). |
| `disabled` | boolean | Section hidden but kept (1 in T). |
| `custom_css` | array of strings | Merchant-authored CSS scoped to the instance (1 in T, empty array). |

Block instance keys (H: 94 instances across templates and groups; T: 30):

| Key | Type | Meaning |
|---|---|---|
| `type` | string | Theme-block file name in `blocks/` (H) or the block type declared in the section schema (T). |
| `settings` | object | Values by setting id. |
| `blocks` | object | Nested child blocks (theme blocks nest; always present in H, usually empty). |
| `block_order` | array | Order of nested children (17 of 94 in H). |
| `static` | boolean | `true` marks a **static block**: bound to a fixed spot in the section markup by the pair (`type`, key) used in `{% content_for 'block', type:, id: %}`; not reorderable by the merchant (30 in H). |
| `name` | string | Display-name override (57 in H). |
| `disabled` | boolean | Hidden but kept (2 in T). |

Further facts:

- Ids are free-form strings (human slugs like `main`, slugs with random suffixes, or UUIDs). They must stay stable because
  saved configuration, CSS and editor state key off them. The section keyed `main` is conventionally the page's primary
  content section.
- String setting values may contain Liquid output (for example a reference to a theme color-palette entry) and, in rich
  text values, references to the current resource (for example an h1 holding the page title read through the `closest`
  object). The loader must evaluate such strings when the setting is read in Liquid, not at load time.
- Resource-type settings store resource URIs or handles. Observed link values use the internal scheme
  `shopify://collections/<handle>`, `shopify://products/<handle>` and `shopify://shop_images/<file>`; the renderer must resolve
  these to storefront paths (links) or file URLs (images).

Minimal illustrative template (ours, not an excerpt):

```json
{
  "sections": {
    "hero": { "type": "banner", "settings": { "heading": "Hello" } },
    "grid": {
      "type": "product-grid",
      "settings": { "collection": "all" },
      "blocks": { "a": { "type": "card", "settings": {} } },
      "block_order": ["a"]
    }
  },
  "order": ["hero", "grid"]
}
```

## 4. Section groups (`sections/*.json`)

Both themes have `header-group.json` and `footer-group.json`, included from the layout with `{% sections 'name' %}`.
Structure: `type` (string; observed `header` and `footer`), `name` (display name, may be a
`t:` key), `sections` (same shape as a template's `sections`) and `order`. Section instances inside groups use the same
keys as in templates (H: 4; T: 3 instances; T uses `disabled` and `custom_css` there). Groups are the only place besides
templates where section instances live; global (non-template) settings do not hold sections except in the older style
where `settings_data.json` carries a `sections` map (T: password-page sections, see 7).

Section schemas can restrict where they appear: `disabled_on.groups` / `enabled_on.groups` (values `header`, `footer`, ...)
and `enabled_on.templates` (template base names).

## 5. Sections (`sections/*.liquid`)

A section file is Liquid markup plus, at the end, one `{% schema %} ... {% endschema %}` block holding JSON. The renderer
exposes `section.id`, `section.settings`, `section.blocks` (older style), `section.index`, and `block.shopify_attributes` (editor attributes; can render empty). Sections without a schema exist: T has 8
(cart drawer/notification pieces, predictive search, 404 main, pickup availability) that are rendered only through the
section-rendering endpoint or as includes; they take no settings.

A section file may also contain `{% stylesheet %}`, `{% javascript %}` and `{% style %}` blocks (see liquid-compat.md).

### 5.1 Section schema keys

Counts: H sections 40; T sections 42 (schemas parsed successfully in all files).

| Key | Type | H sections | T sections | Meaning |
|---|---|---:|---:|---|
| `name` | string (often a `t:` key) | 40 | 42 | Editor label. Only key that is always present. |
| `settings` | array of setting definitions | 39 | 39 | See 8. |
| `blocks` | array | 25 | 19 | Accepted block types. H: entries are `{ "type": "<block file>" }` or `{ "type": "@theme" }` / `{ "type": "@app" }`. T: full inline definitions (`type`, `name`, `settings`, `limit`) or `@app`. |
| `presets` | array | 28 | 19 | Ways to add the section from the editor (see 5.2). Sections without presets can only be placed by a template/group. |
| `max_blocks` | integer | 2 | 4 | Upper bound on dynamic blocks. |
| `class` | string | 18 | 30 | CSS class added to the wrapper element the platform generates. |
| `tag` | string | 5 | 23 | Wrapper element name (observed `section`, `div`, `header`). |
| `disabled_on` | object | 22 | 16 | `{ "groups": [...] }` and/or `{ "templates": [...] }`: where the section may not be added. |
| `enabled_on` | object | 6 | 0 | Same shape; whitelist instead of blacklist (H: 4 by groups, 2 by templates). |
| `default` | object | 0 | 2 | Legacy defaults (`blocks` list) used when a section is added without presets. |
| `templates` | array of strings | 0 | 1 | Legacy whitelist of template names (superseded by `enabled_on.templates`). |
| `limit` | integer | 0 | 0 | (Documented; not observed.) Max instances of the section per page. |

Block entries inside a section schema (T inline style): `type` (required), `name`, `settings` (array), `limit` (max instances of
this block type).

### 5.2 Presets

Preset keys: `name` (all), `category` (102 of 117 presets in H, sections and blocks together: editor grouping label), `settings` (58), `blocks` (52),
`block_order` (41). `blocks` is either an array of `{ "type": ... }` (older style, T) or an object keyed by block id with
`type`, `settings`, `name`, nested `blocks`/`block_order` and `static` (newer style, H). A preset is a ready-made
instance blueprint: when the merchant adds the section, this tree is copied into the template JSON. Static entries must
match the static blocks the markup renders.

## 6. Theme blocks (`blocks/*.liquid`, H only)

Same file shape as a section: Liquid markup + optional `{% stylesheet %}` + one schema. They receive `block.id`,
`block.settings`, `block.shopify_attributes`, `block.type` and can render children with `{% content_for 'blocks' %}` or fix a
child with `{% content_for 'block', type: '<file>', id: '<key>' %}` (63 static and 45 dynamic uses in the corpus; the call
may pass extra keyword arguments that the child reads, e.g. a product via `closest.product`).

Block schema keys (95 files): `name` (95), `settings` (93), `tag` (87; may be an explicit `null` meaning "no wrapper element",
86 cases), `presets` (72), `blocks` (24), `class` (5). The `blocks` array lists accepted children:
`{ "type": "@theme" }` = any non-private theme block, `{ "type": "@app" }` = app blocks, or a specific block file name.
Block-type counts across all accepted-block lists: `@theme` 29, `@app` 31, specific names 185 (H); `@app` 8, inline 64 (T).
Blocks have no `enabled_on`/`disabled_on`, `max_blocks` or `limit` observed.

App blocks (`@app`; per public docs their type strings use a `shopify://apps/...` form) are third-party: Shoppen can ignore them (render nothing)
until an app model exists.

## 7. Snippets (`snippets/*.liquid`)

Pure Liquid fragments called by name (`{% render 'name', arg: value %}`). Every snippet has an isolated variable scope; only
keyword arguments and global objects are visible. Snippets have no schema (0 of 204 contain `{% schema %}`). Most snippets in H
document their contract in a `{% doc %}` block (tags `@param` and `@example`; 154 files carry one), which is
documentation only. Names are kebab-case; snippets that only emit CSS (`*-styles`) are common in H.

## 8. Setting definitions

Each entry of a `settings` array (in section/block schemas and in `settings_schema.json`) is an object. Keys observed:

| Key | Seen in | Meaning |
|---|---|---|
| `type` | all | Control type (inventory below). |
| `id` | all value settings (not `header`/`paragraph`) | Key under which the value is stored/read (`section.settings.<id>`). |
| `label` | value settings | Editor label (`t:` key allowed). |
| `default` | ~84% of value settings | Initial value. |
| `content` | `header`, `paragraph` | Display-only text. |
| `info` | some | Help text. |
| `options` | `select` (and similar) | Array of `{ "value", "label" }`. All 2,711 options in the corpus have exactly these two keys. |
| `min`, `max`, `step`, `unit` | `range` | Slider bounds; `unit` is a display unit string. |
| `placeholder` | text-like, color | Placeholder text. |
| `visible_if` | 632 in H | Conditional visibility: a string containing a Liquid output expression over `section.settings`/`block.settings` that evaluates to a boolean (equality, inequality and boolean checks seen). Editor-only. |
| `alpha` | `color` (61 in H) | Boolean: allow transparency. |
| `accept` | `video` | Array of accepted sources (e.g. hosted/external). |

Setting-type inventory (counts of definitions; "sections" columns include theme-block schemas; header/paragraph are
non-value controls):

| Setting type | Horizon sections+blocks | Horizon settings_schema | Test-data sections | Test-data settings_schema | Total |
|---|---:|---:|---:|---:|---:|
| `select` | 505 | 50 | 154 | 14 | 723 |
| `range` | 524 | 24 | 84 | 81 | 713 |
| `header` | 297 | 23 | 79 | 29 | 428 |
| `checkbox` | 143 | 19 | 85 | 6 | 253 |
| `color` | 207 | 30 | 0 | 7 | 244 |
| `paragraph` | 38 | 4 | 17 | 5 | 64 |
| `text` | 19 | 0 | 25 | 9 | 53 |
| `image_picker` | 22 | 3 | 18 | 3 | 46 |
| `url` | 23 | 1 | 10 | 0 | 34 |
| `inline_richtext` | 2 | 0 | 30 | 1 | 33 |
| `richtext` | 6 | 0 | 10 | 1 | 17 |
| `video` | 16 | 0 | 1 | 0 | 17 |
| `text_alignment` | 16 | 0 | 0 | 0 | 16 |
| `collection` | 4 | 1 | 3 | 1 | 9 |
| `product` | 6 | 0 | 2 | 0 | 8 |
| `font_picker` | 0 | 4 | 0 | 2 | 6 |
| `link_list` | 3 | 0 | 2 | 0 | 5 |
| `liquid` | 2 | 0 | 3 | 0 | 5 |
| `page` | 1 | 0 | 4 | 0 | 5 |
| `color_background` | 0 | 0 | 0 | 4 | 4 |
| `video_url` | 1 | 0 | 2 | 0 | 3 |
| `textarea` | 2 | 0 | 0 | 0 | 2 |
| `collection_list` | 2 | 0 | 0 | 0 | 2 |
| `blog` | 1 | 0 | 1 | 0 | 2 |
| `color_palette` | 0 | 1 | 0 | 0 | 1 |
| **total** | 1840 | 160 | 530 | 163 | 2693 |

Distinct types observed: 25. Not observed here but defined in public documentation (to verify before implementing):
`number`, `radio`, `article`, `html`, `metaobject`, `metaobject_list`, `product_list`, `color_scheme`,
`color_scheme_group`, `image_picker` variants for video/audio files, and the `font_picker` metadata. Value representations
seen in saved data:

| Type | Stored value |
|---|---|
| `checkbox` | boolean |
| `range` | number |
| `select`, `text`, `textarea`, `text_alignment` | string |
| `color`, `color_background` | color string (hex with optional alpha, or empty string); `color_background` may hold a gradient (per public docs) |
| `color_palette` | object (named entries like background/foreground/color1/color2) readable as `settings.<id>.<entry>` |
| `font_picker` | font handle string (family + style token, e.g. `inter_n4`) |
| `image_picker`, `video` | resource URI string (`shopify://shop_images/<file>`, hosted video) or empty |
| `url` | path, absolute URL or resource URI such as `shopify://collections/all` |
| `collection`, `product`, `page`, `blog`, `link_list` | handle string; Liquid sees the resolved object (nil if missing) |
| `collection_list` | array of handles |
| `richtext` | HTML string with block-level markup; `inline_richtext` HTML limited to inline markup |
| `liquid` | string of Liquid source (rendered by the section; not sanitized) |
| `video_url` | URL string for accepted external hosts |

## 9. Global settings

### 9.1 `config/settings_schema.json`

An array of groups. The first group is metadata, `{ "name": "theme_info", "theme_name", "theme_version",
"theme_author", "theme_documentation_url", "theme_support_url" }`. Every other group is `{ "name": <label or t: key>,
"settings": [ ...setting definitions... ] }`. H has 18 groups (17 with settings, 160 setting definitions); T has 22 groups
(163 definitions). Group names are editor labels only. Types used there: select, range, color, header, paragraph, checkbox,
image_picker, font_picker, url, collection, color_palette (H), color_background, text, richtext, inline_richtext (T).

### 9.2 `config/settings_data.json`

Top-level keys `current` and `presets`.

- H style: `current` is an object (94 keys) holding the active values keyed by setting id (flat; the palette is a nested
  object); `presets` is an object whose single key (`Horizon`) holds the same flat key set for resetting the theme.
- T style: `current` is the **name of a preset** (a string, `"Default"`), and `presets.Default` is the flat settings object
  (127 keys). It also contains a `sections` map holding section instances for the password page (`main-password-header`,
  `main-password-footer`), i.e. section state that is not tied to a template.

A loader should accept both: if `current` is a string, look it up in `presets`; if it is an object use it directly.
Missing keys take the schema `default`. Liquid reads these as `settings.<id>`.

## 10. Locales

- `locales/<code>.json` (runtime): nested JSON of translatable storefront strings, read with the `t` filter by dotted key
  (`'group.sub.key' | t`) with named interpolation (`{{ name }}`) and plural forms keyed by quantity category. H top-level
  groups: accessibility, actions, blocks, blogs, content, fields, gift_cards, placeholders, products (311 leaf strings in the
  default locale). T has 12 groups (334 leaves).
- `locales/<code>.schema.json` (editor): translations for schema labels. H groups: categories, content, html_defaults,
  info, names, options, settings, text_defaults. T groups: settings_schema, sections.
- A schema string starting with `t:` is a key into the *schema* locale file; it is resolved at editor time. Preset content
  copied into a template may keep `t:` keys for default text (they resolve to the default-language text when saved).
- Both default locale files carry the `.default` infix. Lookup falls back to the default locale when a key is missing.

## 11. Assets and how they are referenced

- `assets/` is flat. Liquid references files with the `asset_url` filter (`{{ 'name.css' | asset_url }}`; 296 uses),
  often followed by `stylesheet_tag` (126) or placed in a `<script src>` / import map. The filter returns a CDN-style URL
  that includes a version/cache-busting query string. Shoppen should serve `assets/` at a stable path with the same
  semantics (any URL is fine as long as it is stable per theme version).
- `inline_asset_content` (111 uses in 46 files) inlines text of an asset, used mainly for small SVG icons.
- `shopify_asset_url` (5 uses, gift card only) points to platform-hosted shared files (a QR code script and two
  images); replace with equivalents we host.
- Section/block `{% stylesheet %}` content is not an asset; it is collected from the Liquid files rendered on the page.
- Images from settings and resources go through `image_url` / `image_tag` with width/height params, i.e. need an
  image-resizing endpoint (P0 for any theme).
- Fonts: `font_face`, `font_url`, `font_modify` take a `font_picker` setting value; the platform serves a font library.
  Shoppen needs a font catalogue or a self-hosted mapping from font handle to files.

## 12. Implementation checklist for the loader

1. Index the directory; tolerate unknown files and directories.
2. Parse JSON with leading block comments and (for locales) line comments.
3. Extract and parse the `{% schema %}` block of every section/block at load time; keep the Liquid source with it removed
   or ignored at render.
4. Resolve template by (type, suffix); JSON -> section instances; support section groups and `content_for` blocks, including
   `static` blocks and nested blocks to arbitrary depth (Horizon nests up to 3 levels of blocks below a section in its templates).
5. Build the `section`/`block` contexts; provide `closest`; evaluate Liquid inside string settings where the setting is read.
6. Resolve `shopify://` resource URIs and handle-typed settings to drops.
7. Provide `content_for_header` and `content_for_layout`.
8. Serve `assets/`, compute CSS/JS aggregation for `stylesheet`/`javascript` tags, and implement the image, font and
   translation helpers.
