// Lookbook (fashion): large editorial photos with a caption and the product to shop, in an asymmetric grid.
export default {
  id: 'lookbook',
  name: { en: 'Lookbook', fr: 'Lookbook' },
  settings: [
    { id: 'eyebrow', type: 'text', label: { en: 'Eyebrow', fr: 'Sur-titre' }, default: { en: 'The edit', fr: 'La sélection' } },
    { id: 'heading', type: 'text', label: { en: 'Heading', fr: 'Titre' }, default: { en: 'Shop the look', fr: 'Shopper le look' } },
    { id: 'color_scheme', type: 'color_scheme', label: { en: 'Color scheme', fr: 'Palette de couleurs' } },
  ],
  blocks: [{
    type: 'look',
    name: { en: 'Look', fr: 'Look' },
    settings: [
      { id: 'image', type: 'image_picker', label: { en: 'Photo', fr: 'Photo' }, info: { en: 'The photo of the product is used when no photo is chosen.', fr: 'La photo du produit est utilisée si aucune photo n’est choisie.' } },
      { id: 'title', type: 'text', label: { en: 'Title', fr: 'Titre' }, default: { en: 'The look', fr: 'Le look' } },
      { id: 'text', type: 'text', label: { en: 'Caption', fr: 'Légende' } },
      { id: 'product', type: 'product', label: { en: 'Product to shop', fr: 'Produit à shopper' } },
    ],
  }],
  max_blocks: 5,
  presets: [{ name: { en: 'Lookbook', fr: 'Lookbook' }, blocks: [{ type: 'look' }, { type: 'look' }, { type: 'look' }] }],
  liquid: `{%- assign s = section.settings -%}
<div class="k-section k-lookbook {% render 'scheme-class', scheme: s.color_scheme %}">
  <div class="page-width">
    <div class="k-section__head">
      {%- if s.eyebrow != blank -%}<p class="k-eyebrow">{{ s.eyebrow | escape }}</p>{%- endif -%}
      {%- if s.heading != blank -%}<h2 class="k-section__title">{{ s.heading | escape }}</h2>{%- endif -%}
    </div>
    <div class="k-lookbook__grid k-lookbook__grid--{{ section.blocks.size }}">
      {%- for block in section.blocks -%}
        {%- assign look = block.settings -%}
        {%- assign pic = look.image | default: look.product.featured_image -%}
        <article class="k-look k-look--{{ forloop.index }}" {{ block.shopify_attributes }}>
          <a class="k-look__media" href="{{ look.product.url | default: routes.all_products_collection_url }}" tabindex="-1" aria-hidden="true">
            {%- if pic != blank -%}
              {{ pic | image_url: width: 1200 | image_tag: loading: 'lazy', widths: '480, 720, 1200', sizes: '(min-width: 990px) 40vw, 100vw', alt: look.title }}
            {%- else -%}
              {{ 'lifestyle-1' | placeholder_svg_tag: 'k-look__placeholder' }}
            {%- endif -%}
          </a>
          <div class="k-look__caption">
            {%- if look.title != blank -%}<h3 class="k-look__title">{{ look.title | escape }}</h3>{%- endif -%}
            {%- if look.text != blank -%}<p class="k-look__text">{{ look.text | escape }}</p>{%- endif -%}
            {%- if look.product != blank -%}
              <a class="k-look__shop" href="{{ look.product.url }}">
                <span>{{ look.product.title | escape }}</span>
                {% render 'price', product: look.product %}
              </a>
            {%- endif -%}
          </div>
        </article>
      {%- endfor -%}
    </div>
  </div>
</div>
`,
  css: `
.k-lookbook__grid { display: grid; gap: 24px; grid-template-columns: repeat(12, minmax(0, 1fr)); align-items: end; }
.k-look { position: relative; display: grid; gap: 14px; grid-column: span 4; }
.k-lookbook__grid--3 { align-items: start; } .k-lookbook__grid--3 .k-look--1 { grid-column: 1 / span 6; grid-row: 1 / span 2; } .k-lookbook__grid--3 .k-look--2, .k-lookbook__grid--3 .k-look--3 { grid-column: 7 / span 6; grid-template-columns: 1fr 1fr; align-items: end; gap: 22px; } .k-lookbook__grid--3 .k-look--2 .k-look__media, .k-lookbook__grid--3 .k-look--3 .k-look__media { aspect-ratio: 4 / 5; }
.k-lookbook__grid--2 .k-look { grid-column: span 6; } .k-lookbook__grid--4 .k-look { grid-column: span 3; } .k-lookbook__grid--1 .k-look { grid-column: 3 / span 8; }
.k-look__media { display: block; aspect-ratio: 4 / 5; overflow: hidden; background: var(--v-surface); border-radius: var(--round-sm); }
.k-look--1 .k-look__media { aspect-ratio: 5 / 6; } .k-look--2 .k-look__media { aspect-ratio: 3 / 4; }
.k-look__media img, .k-look__placeholder { width: 100%; height: 100%; object-fit: cover; transition: transform calc(var(--anim) * 2) ease; } .k-look:hover .k-look__media img { transform: scale(1.03); }
.k-look__caption { display: grid; gap: 6px; }
.k-look__title { margin: 0; font: 500 clamp(1.3rem, 2vw, 1.8rem)/1.15 var(--f-heading); } .k-look__text { margin: 0; color: var(--v-muted); font-size: .95rem; }
.k-look__shop { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 4px 14px; margin-top: 6px; padding: 12px 0 0; border-top: 1px solid var(--v-line); color: var(--v-ink); text-decoration: none; font-size: .92rem; } .k-look__shop:hover { color: var(--v-accent); }
@media (max-width: 899px) { .k-lookbook__grid--3 .k-look--2, .k-lookbook__grid--3 .k-look--3 { grid-template-columns: 1fr; } .k-look, .k-lookbook__grid--3 .k-look--1, .k-lookbook__grid--3 .k-look--2, .k-lookbook__grid--3 .k-look--3, .k-lookbook__grid--4 .k-look, .k-lookbook__grid--2 .k-look, .k-lookbook__grid--1 .k-look { grid-column: span 12; } .k-look--1 .k-look__media, .k-look--2 .k-look__media { aspect-ratio: 4 / 5; } }
`,
};
