// Frame guide (art): sizes drawn to scale as outlined rectangles, with the dimensions and the finishes.
export default {
  id: 'frame-guide',
  name: { en: 'Frame and size guide', fr: 'Guide cadres et formats' },
  settings: [
    { id: 'eyebrow', type: 'text', label: { en: 'Eyebrow', fr: 'Sur-titre' }, default: { en: 'Sizes and frames', fr: 'Formats et cadres' } },
    { id: 'heading', type: 'text', label: { en: 'Heading', fr: 'Titre' }, default: { en: 'Choose the right size for your wall', fr: 'Choisir le bon format pour votre mur' } },
    { id: 'text', type: 'text', label: { en: 'Text', fr: 'Texte' } },
    { id: 'finishes', type: 'text', label: { en: 'Frame finishes', fr: 'Finitions de cadre' }, default: { en: 'Black oak, natural oak, white', fr: 'Chêne noir, chêne naturel, blanc' } },
    { id: 'color_scheme', type: 'color_scheme', label: { en: 'Color scheme', fr: 'Palette de couleurs' } },
  ],
  blocks: [{
    type: 'format',
    name: { en: 'Size', fr: 'Format' },
    settings: [
      { id: 'label', type: 'text', label: { en: 'Name', fr: 'Nom' }, default: { en: 'Small', fr: 'Petit' } },
      { id: 'width', type: 'range', label: { en: 'Width (cm)', fr: 'Largeur (cm)' }, min: 20, max: 120, step: 5, default: 30 },
      { id: 'height', type: 'range', label: { en: 'Height (cm)', fr: 'Hauteur (cm)' }, min: 20, max: 160, step: 5, default: 40 },
      { id: 'text', type: 'text', label: { en: 'Where it works', fr: 'Où il convient' }, default: { en: 'Shelves and desks', fr: 'Étagères et bureaux' } },
    ],
  }],
  max_blocks: 5,
  presets: [{ name: { en: 'Frame and size guide', fr: 'Guide cadres et formats' }, blocks: [{ type: 'format' }, { type: 'format' }, { type: 'format' }] }],
  liquid: `{%- assign s = section.settings -%}
<div class="k-section k-frames {% render 'scheme-class', scheme: s.color_scheme %}">
  <div class="page-width">
    <div class="k-section__head">
      {%- if s.eyebrow != blank -%}<p class="k-eyebrow">{{ s.eyebrow | escape }}</p>{%- endif -%}
      {%- if s.heading != blank -%}<h2 class="k-section__title">{{ s.heading | escape }}</h2>{%- endif -%}
      {%- if s.text != blank -%}<p class="k-section__text">{{ s.text | escape }}</p>{%- endif -%}
    </div>
    <ul class="k-frames__list" role="list">
      {%- for block in section.blocks -%}
        {%- assign b = block.settings -%}
        <li class="k-frame" {{ block.shopify_attributes }}>
          <span class="k-frame__stage"><span class="k-frame__shape" style="width: {{ b.width | times: 1.2 }}px; aspect-ratio: {{ b.width }} / {{ b.height }};"></span></span>
          <span class="k-frame__label">{{ b.label | escape }}</span>
          <span class="k-frame__dim">{{ b.width }} x {{ b.height }} cm</span>
          <span class="k-frame__text">{{ b.text | escape }}</span>
        </li>
      {%- endfor -%}
    </ul>
    {%- if s.finishes != blank -%}<p class="k-frames__finishes">{% render 'icon', name: 'ruler', size: 18 %} {{ s.finishes | escape }}</p>{%- endif -%}
  </div>
</div>
`,
  css: `
.k-frames__list { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); border-top: 1px solid var(--v-ink); }
.k-frame { display: grid; gap: 4px; align-content: start; padding: 28px 20px 28px 0; }
.k-frame__stage { display: flex; align-items: flex-end; height: 200px; margin-bottom: 14px; } .k-frame__shape { max-width: 100%; max-height: 100%; border: 1px solid var(--v-ink); background: var(--v-surface); }
.k-frame__label { font: 400 1.3rem/1.2 var(--f-heading); } .k-frame__dim { font-variant-numeric: tabular-nums; letter-spacing: .08em; font-size: .85rem; } .k-frame__text { color: var(--v-muted); font-size: .92rem; }
.k-frames__finishes { display: flex; align-items: center; gap: 10px; margin: 24px 0 0; padding-top: 20px; border-top: 1px solid var(--v-line); color: var(--v-muted); letter-spacing: .08em; text-transform: uppercase; font-size: .78rem; }
`,
};
