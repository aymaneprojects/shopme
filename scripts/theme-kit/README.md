# ShopMe theme kit

Makes a complete theme cheap: the Liquid plumbing every storefront needs (layout, cart drawer, predictive search, filters, selling
plans, focal points, customer pages, EN and FR strings) is written and tested once, and a theme is a short file of options. The
generator composes the theme folder and commits it under `packages/themes/<handle>/`. Same options, same bytes.

```
node scripts/theme-kit/build.mjs [handle...]      write the theme folders (all the kit themes when none is named)
node scripts/theme-kit/build.mjs --check          fail when a committed folder differs from what the kit generates
node scripts/theme-kit/demo-images.mjs [handle]   convert the demo photos to WebP (see "Demo catalogue")
node scripts/theme-kit/browser-check.mjs          check the kit JavaScript (age check, infinite scroll, counter...) in a browser
```

## Layout of the kit

```
base/             shared plumbing, copied into every theme: layout, snippets, sections, templates, locales, settings schema
variants/header/  centered.liquid, mega.liquid, split.liquid (+ _schema.liquid shared by the three)
variants/gallery/ switcher.liquid (main photo and thumbnails), stacked.liquid (every photo in a column)
css/              core.css and hero.css, header*.css, card-<style>.css, pdp-<layout>.css, listing-<layout>.css, features.css
js/               core.js (cart, search, product page, filters) and features.js (see below), joined into assets/<handle>.js
sections/         extra sections: one file each, with the Liquid, the CSS and the schema texts in EN and FR
themes/           one options file per theme: <handle>.mjs
build.mjs         the generator;  demo-images.mjs  the photo converter;  LICENSE.txt  the MIT text copied into each theme
```

The generated theme keeps only what its options ask for: one header variant, one card style, one product page layout, one
collection layout, only the fonts it uses (the woff2 files come from `packages/themes/nocturne/assets`), only its extra sections.

## Options of a theme (`themes/<handle>.mjs`)

| Option | Values |
|---|---|
| `handle`, `name`, `version`, `date` | folder name, display name, `1.0.0`, changelog date |
| `header.layout` | `centered` (centred logo, search left, menu on its own row), `mega` (logo left, mega menu, icons right), `split` (half of the menu on each side of the logo) |
| `header.sticky`, `announcement` | sticky header; text and colour scheme of the announcement bar |
| `card.style` | `minimal` (bare photo, small caps), `rounded` (soft tile that lifts), `framed` (thin border, offset shadow), `arched` (arch above the photo) |
| `card.ratio`, `card.align`, `card.quickAdd` | `portrait`, `square`, `landscape`; `left`, `center`; `true`, `false` |
| `product.layout` | `left` (thumbnails under the photo), `rail` (vertical rail of thumbnails), `stacked` (all photos in a column, details stay in view); `product.benefits` the three reassurance lines |
| `collection.layout` | `sidebar` (filter groups listed open on the left) or `topbar` (drop-downs in a row); `columns`, `perPage`, `infiniteScroll` |
| `fonts` | `heading`, `body`, `accent`, `extra`: from `dm-sans`, `manrope`, `inter`, `space-grotesk`, `playfair-display`, `lora` |
| `type` | `h1`, `h2` (percent of the base size), `headingWeight`, `headingCase`, `lineHeight`, `baseSize` |
| `colors` | `accent`, `background`, `surface`, `card`, `text`, `sale`, `swatchColors`, and `schemes` (the colour schemes sections can use: `scheme-1`, `scheme-2`...) |
| `scale` | `radius` (`sharp`, `soft`, `round`, `pill`), `spacing` (`compact`, `regular`, `airy`), `pageWidth`, `arch` |
| `buttons`, `freeShipping`, `logoWidth` | button case, height and border; free shipping threshold (0 hides the bar) |
| `home` | the home page: `[{ id, type, settings, blocks: [{ type, settings }] }]` using any section of the theme |
| `templates` | extra page templates, e.g. `{ 'page.size-guide': [ ...sections ] }` |
| `sections` | extra sections to ship (see below); the countdown timer is always shipped |
| `features` | `breadcrumbs`, `backToTop`, `stockCounter`, `stockThreshold`, `ageGate`, `ageGateMinAge`: the defaults of the settings below |
| `css` | a few lines of CSS that give the theme its own character, appended last |
| `info` | `description`, `tags`, `industries`, `catalogSize` for the theme store |
| `changelog` | the notes of version 1.0.0, EN and FR |
| `demo` | the demo catalogue (see below) |

Every text is written once as `t('English', 'Français')`. The English goes into the theme, the French into `seed_defaults` of
`locales/fr.json`, so a French shop gets French texts at install. The kit refuses a text that contains a storefront string
(`reword it`): such a text would stay English on a French page.

## Features of every generated theme

Sticky header (setting), breadcrumbs, back to top button, colour swatches (cards and product page), low stock counter ("Only 3
left", per variant), countdown timer section, age verification popup (theme setting, asked once per browser, never shown in the
editor) and infinite scroll on collections (section setting; pagination stays for visitors without JavaScript). Theme settings
live in the "Store features" group; the plumbing is `snippets/breadcrumbs`, `back-to-top`, `age-gate`, `sections/countdown` and
`js/features.js`.

## Add a theme

1. Copy `themes/sillage.mjs` to `themes/<handle>.mjs` and change the options. Pick a header, a card style, a product page
   layout, a collection layout, two fonts, colour schemes, the home page sections and the extra sections.
2. Need a section for the trade? Add `sections/<id>.mjs` (a Liquid body, its CSS and a definition of its settings with labels in EN
   and FR) and list its id in `sections`. The kit writes the schema and the schema locales for you.
3. `node scripts/theme-kit/build.mjs <handle>`.
4. Photos and demo catalogue: see below. Then `node scripts/theme-checksums.mjs <handle>` and
   `node scripts/theme-previews.mjs <handle>` (after `pnpm build`).
5. Add `<handle>` to `KIT` in `apps/server/src/storefront-themes.test.ts`, run that test and `apps/server/src/theme-kit.test.ts`.

## Demo catalogue

`demo.*` in the options becomes `packages/themes/<handle>/demo/catalog.json` (store name, collections, products with titles,
descriptions, prices, options and variants, menus, pages, and the home page texts in EN and FR taken from `home`). The photos
go in `demo/images/` (`hero.webp`, `ambiance.webp`, `produit-01..06.webp`): `demo-images.mjs` converts the source photos
(`/home/user/theme-images/<handle>/<handle>-hero.jpg`, `-ambiance.jpg`, `-produit-01..06.jpg`) to WebP, products at 1200 px,
the hero 2000 px wide, the ambiance photo 1200 x 1500, quality 80 down to what keeps each file near 150 KB. The folder is not a
theme file and is never installed; `scripts/theme-previews.mjs` seeds it to photograph the theme, and the theme store demo shows
those photos.
