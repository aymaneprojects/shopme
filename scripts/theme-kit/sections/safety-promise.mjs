// Safety promise (toys): a round photo and a checklist of the promises behind every toy.
export default {
  id: 'safety-promise',
  name: { en: 'Safety promise', fr: 'Promesse sécurité' },
  settings: [
    { id: 'eyebrow', type: 'text', label: { en: 'Eyebrow', fr: 'Sur-titre' }, default: { en: 'Our promise', fr: 'Notre promesse' } },
    { id: 'heading', type: 'text', label: { en: 'Heading', fr: 'Titre' }, default: { en: 'Safe to chew, safe to drop', fr: 'Sans danger, même en bouche' } },
    { id: 'text', type: 'text', label: { en: 'Text', fr: 'Texte' } },
    { id: 'image', type: 'image_picker', label: { en: 'Photo', fr: 'Photo' } },
    { id: 'product', type: 'product', label: { en: 'Product (its photo is used when there is no photo)', fr: 'Produit (sa photo est utilisée sans photo)' } },
    { id: 'color_scheme', type: 'color_scheme', label: { en: 'Color scheme', fr: 'Palette de couleurs' } },
  ],
  blocks: [{
    type: 'point',
    name: { en: 'Promise', fr: 'Promesse' },
    settings: [
      { id: 'title', type: 'text', label: { en: 'Title', fr: 'Titre' }, default: { en: 'Tested twice', fr: 'Testé deux fois' } },
      { id: 'text', type: 'text', label: { en: 'Text', fr: 'Texte' }, default: { en: 'Every toy passes independent safety tests.', fr: 'Chaque jouet passe des tests de sécurité indépendants.' } },
    ],
  }],
  max_blocks: 5,
  presets: [{ name: { en: 'Safety promise', fr: 'Promesse sécurité' }, blocks: [{ type: 'point' }, { type: 'point' }, { type: 'point' }] }],
  liquid: `{%- assign s = section.settings -%}
{%- assign pic = s.image | default: s.product.featured_image -%}
<div class="k-section k-safe {% render 'scheme-class', scheme: s.color_scheme %}">
  <div class="page-width k-safe__inner">
    <div class="k-safe__media">
      {%- if pic != blank -%}{{ pic | image_url: width: 900 | image_tag: loading: 'lazy', widths: '400, 600, 900', sizes: '(min-width: 990px) 40vw, 90vw', alt: '' }}{%- else -%}{{ 'lifestyle-1' | placeholder_svg_tag: 'k-safe__placeholder' }}{%- endif -%}
    </div>
    <div class="k-safe__body">
      {%- if s.eyebrow != blank -%}<p class="k-eyebrow">{{ s.eyebrow | escape }}</p>{%- endif -%}
      {%- if s.heading != blank -%}<h2 class="k-section__title">{{ s.heading | escape }}</h2>{%- endif -%}
      {%- if s.text != blank -%}<p class="k-section__text">{{ s.text | escape }}</p>{%- endif -%}
      <ul class="k-safe__list" role="list">
        {%- for block in section.blocks -%}
          <li class="k-safe__item" {{ block.shopify_attributes }}>
            <span class="k-safe__tick">{% render 'icon', name: 'check', size: 18 %}</span>
            <div><h3>{{ block.settings.title | escape }}</h3><p>{{ block.settings.text | escape }}</p></div>
          </li>
        {%- endfor -%}
      </ul>
    </div>
  </div>
</div>
`,
  css: `
.k-safe__inner { display: grid; gap: 64px; align-items: center; grid-template-columns: 5fr 6fr; }
.k-safe__media { position: relative; aspect-ratio: 1; overflow: hidden; border-radius: 50% 50% 46% 54% / 56% 48% 52% 44%; background: var(--v-surface); } .k-safe__media img, .k-safe__placeholder { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.k-safe__list { display: grid; gap: 18px; margin: 28px 0 0; padding: 0; list-style: none; }
.k-safe__item { display: flex; gap: 16px; align-items: flex-start; padding: 18px 22px; background: var(--v-card); border-radius: var(--round); } .k-safe__item h3 { margin: 0 0 2px; font: 800 1.05rem/1.3 var(--f-heading); } .k-safe__item p { margin: 0; color: var(--v-muted); font-size: .95rem; }
.k-safe__tick { flex: none; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: var(--v-accent); color: var(--v-on-accent); }
@media (max-width: 899px) { .k-safe__inner { grid-template-columns: 1fr; gap: 32px; } .k-safe__media { max-width: 420px; } }
`,
};
