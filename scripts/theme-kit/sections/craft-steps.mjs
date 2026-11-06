// Craft steps (leather goods, workshops): numbered steps beside a tall photo.
export default {
  id: 'craft-steps',
  name: { en: 'Craft steps', fr: 'Étapes de fabrication' },
  settings: [
    { id: 'eyebrow', type: 'text', label: { en: 'Eyebrow', fr: 'Sur-titre' }, default: { en: 'The workshop', fr: 'L’atelier' } },
    { id: 'heading', type: 'text', label: { en: 'Heading', fr: 'Titre' }, default: { en: 'How it is made', fr: 'Comment c’est fait' } },
    { id: 'image', type: 'image_picker', label: { en: 'Photo', fr: 'Photo' } },
    { id: 'product', type: 'product', label: { en: 'Product (its photo is used when there is no photo)', fr: 'Produit (sa photo est utilisée sans photo)' } },
    { id: 'layout', type: 'select', label: { en: 'Photo position', fr: 'Position de la photo' }, options: [{ value: 'left', label: { en: 'Left', fr: 'Gauche' } }, { value: 'right', label: { en: 'Right', fr: 'Droite' } }], default: 'left' },
    { id: 'color_scheme', type: 'color_scheme', label: { en: 'Color scheme', fr: 'Palette de couleurs' } },
  ],
  blocks: [{
    type: 'step',
    name: { en: 'Step', fr: 'Étape' },
    settings: [
      { id: 'title', type: 'text', label: { en: 'Title', fr: 'Titre' }, default: { en: 'Choose the hide', fr: 'Choisir la peau' } },
      { id: 'text', type: 'text', label: { en: 'Text', fr: 'Texte' }, default: { en: 'Full-grain leather from a tannery we have worked with for years.', fr: 'Cuir pleine fleur issu d’une tannerie avec laquelle nous travaillons depuis des années.' } },
    ],
  }],
  max_blocks: 6,
  presets: [{ name: { en: 'Craft steps', fr: 'Étapes de fabrication' }, blocks: [{ type: 'step' }, { type: 'step' }, { type: 'step' }] }],
  liquid: `{%- assign s = section.settings -%}
{%- assign pic = s.image | default: s.product.featured_image -%}
<div class="k-section k-craft k-craft--{{ s.layout }} {% render 'scheme-class', scheme: s.color_scheme %}">
  <div class="page-width k-craft__inner">
    <div class="k-craft__media">
      {%- if pic != blank -%}
        {{ pic | image_url: width: 1000 | image_tag: loading: 'lazy', widths: '480, 720, 1000', sizes: '(min-width: 990px) 40vw, 90vw', alt: '' }}
      {%- else -%}
        {{ 'lifestyle-1' | placeholder_svg_tag: 'k-craft__placeholder' }}
      {%- endif -%}
    </div>
    <div class="k-craft__copy">
      {%- if s.eyebrow != blank -%}<p class="k-eyebrow">{{ s.eyebrow | escape }}</p>{%- endif -%}
      {%- if s.heading != blank -%}<h2 class="k-section__title">{{ s.heading | escape }}</h2>{%- endif -%}
      <ol class="k-craft__steps" role="list">
        {%- for block in section.blocks -%}
          <li class="k-step" {{ block.shopify_attributes }}>
            <span class="k-step__num" aria-hidden="true">{{ forloop.index | prepend: '0' }}</span>
            <div><h3 class="k-step__title">{{ block.settings.title | escape }}</h3><p class="k-step__text">{{ block.settings.text | escape }}</p></div>
          </li>
        {%- endfor -%}
      </ol>
    </div>
  </div>
</div>
`,
  css: `
.k-craft__inner { display: grid; gap: 72px; align-items: center; grid-template-columns: 1fr 1fr; } .k-craft--right .k-craft__media { order: 2; }
.k-craft__media { aspect-ratio: 4 / 5; overflow: hidden; background: var(--v-surface); border-radius: var(--round-sm); } .k-craft__media img, .k-craft__placeholder { width: 100%; height: 100%; object-fit: cover; }
.k-craft__steps { display: grid; gap: 0; margin: 28px 0 0; padding: 0; list-style: none; }
.k-step { display: grid; grid-template-columns: 64px 1fr; gap: 16px; padding: 22px 0; border-top: 1px solid var(--v-line); } .k-step:last-child { border-bottom: 1px solid var(--v-line); }
.k-step__num { font: 400 2.1rem/1 var(--f-heading); color: var(--v-accent); font-variant-numeric: tabular-nums; } .k-step__title { margin: 0 0 6px; font: 600 1.05rem/1.3 var(--f-body); } .k-step__text { margin: 0; color: var(--v-muted); }
@media (max-width: 899px) { .k-craft__inner { grid-template-columns: 1fr; gap: 32px; } .k-craft--right .k-craft__media { order: 0; } .k-craft__media { aspect-ratio: 4 / 3; } }
`,
};
