// Room tiles (home and decor): shop by room in a mosaic of rounded photos with a label and an arrow.
export default {
  id: 'room-tiles',
  name: { en: 'Shop by room', fr: 'Acheter par pièce' },
  settings: [
    { id: 'eyebrow', type: 'text', label: { en: 'Eyebrow', fr: 'Sur-titre' }, default: { en: 'Room by room', fr: 'Pièce par pièce' } },
    { id: 'heading', type: 'text', label: { en: 'Heading', fr: 'Titre' }, default: { en: 'Find your corner', fr: 'Trouvez votre coin' } },
    { id: 'color_scheme', type: 'color_scheme', label: { en: 'Color scheme', fr: 'Palette de couleurs' } },
  ],
  blocks: [{
    type: 'room',
    name: { en: 'Room', fr: 'Pièce' },
    settings: [
      { id: 'image', type: 'image_picker', label: { en: 'Photo', fr: 'Photo' } },
      { id: 'product', type: 'product', label: { en: 'Product (its photo is used when there is no photo)', fr: 'Produit (sa photo est utilisée sans photo)' } },
      { id: 'title', type: 'text', label: { en: 'Title', fr: 'Titre' }, default: { en: 'Living room', fr: 'Salon' } },
      { id: 'link', type: 'url', label: { en: 'Link', fr: 'Lien' } },
    ],
  }],
  max_blocks: 6,
  presets: [{ name: { en: 'Shop by room', fr: 'Acheter par pièce' }, blocks: [{ type: 'room' }, { type: 'room' }, { type: 'room' }] }],
  liquid: `{%- assign s = section.settings -%}
<div class="k-section k-rooms {% render 'scheme-class', scheme: s.color_scheme %}">
  <div class="page-width">
    <div class="k-section__head k-section__head--center">
      {%- if s.eyebrow != blank -%}<p class="k-eyebrow">{{ s.eyebrow | escape }}</p>{%- endif -%}
      {%- if s.heading != blank -%}<h2 class="k-section__title">{{ s.heading | escape }}</h2>{%- endif -%}
    </div>
    <ul class="k-rooms__grid k-rooms__grid--{{ section.blocks.size }}" role="list">
      {%- for block in section.blocks -%}
        {%- assign room = block.settings -%}
        {%- assign pic = room.image | default: room.product.featured_image -%}
        <li class="k-room k-room--{{ forloop.index }}" {{ block.shopify_attributes }}>
          <a class="k-room__link" href="{{ room.link | default: room.product.url | default: routes.collections_url }}">
            {%- if pic != blank -%}
              {{ pic | image_url: width: 900 | image_tag: loading: 'lazy', widths: '400, 600, 900', sizes: '(min-width: 990px) 30vw, 90vw', alt: '' }}
            {%- else -%}
              {{ 'lifestyle-1' | placeholder_svg_tag: 'k-room__placeholder' }}
            {%- endif -%}
            <span class="k-room__label"><span class="k-room__title">{{ room.title | escape }}</span><span class="k-room__arrow">{% render 'icon', name: 'arrow-right', size: 16 %}</span></span>
          </a>
        </li>
      {%- endfor -%}
    </ul>
  </div>
</div>
`,
  css: `
.k-rooms__grid { display: grid; gap: 18px; margin: 0; padding: 0; list-style: none; grid-template-columns: repeat(6, minmax(0, 1fr)); grid-auto-rows: 240px; }
.k-room { grid-column: span 2; min-width: 0; } .k-room--1 { grid-column: span 3; grid-row: span 2; } .k-room--2, .k-room--3 { grid-column: span 3; }
.k-rooms__grid--3 .k-room--2, .k-rooms__grid--3 .k-room--3 { grid-column: span 3; } .k-rooms__grid--4 .k-room--4 { grid-column: span 3; } .k-rooms__grid--5 .k-room--4, .k-rooms__grid--5 .k-room--5 { grid-column: span 3; }
.k-rooms__grid--2 .k-room--1, .k-rooms__grid--2 .k-room--2 { grid-column: span 3; grid-row: span 2; }
.k-room__link { position: relative; display: block; height: 100%; overflow: hidden; border-radius: var(--round); background: var(--v-surface); color: #fff; text-decoration: none; }
.k-room__link img, .k-room__placeholder { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transition: transform calc(var(--anim) * 2) ease; } .k-room__link:hover img { transform: scale(1.05); }
.k-room__link::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, transparent 55%, color-mix(in srgb, #1b1612 55%, transparent)); }
.k-room__label { position: absolute; z-index: 1; left: 18px; right: 18px; bottom: 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.k-room__title { font: 500 1.35rem/1.15 var(--f-heading); } .k-room__arrow { display: grid; place-items: center; width: 38px; height: 38px; border-radius: var(--pill); background: var(--v-card); color: var(--v-ink); transition: transform var(--anim); } .k-room__link:hover .k-room__arrow { transform: translateX(4px); }
@media (max-width: 899px) { .k-rooms__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: 200px; } .k-room, .k-room--1, .k-room--2, .k-room--3, .k-rooms__grid .k-room--4, .k-rooms__grid .k-room--5 { grid-column: span 1; grid-row: span 1; } .k-room--1 { grid-column: span 2; } .k-room__title { font-size: 1.1rem; } }
`,
};
