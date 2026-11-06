// Care levels (plants and gardening): each plant with its light and water needs shown as three-step meters.
const t = (en, fr) => ({ en, fr });
export default {
  id: 'care-levels',
  name: t('Plant care levels', 'Niveaux d’entretien des plantes'),
  settings: [
    { id: 'eyebrow', type: 'text', label: t('Eyebrow', 'Sur-titre'), default: t('Easy to live with', 'Facile à vivre') },
    { id: 'heading', type: 'text', label: t('Heading', 'Titre'), default: t('How much care does it need?', 'Quel entretien demande-t-elle ?') },
    { id: 'light_label', type: 'text', label: t('Light label', 'Libellé de la lumière'), default: t('Light', 'Lumière') },
    { id: 'water_label', type: 'text', label: t('Water label', 'Libellé de l’eau'), default: t('Water', 'Arrosage') },
    { id: 'color_scheme', type: 'color_scheme', label: t('Color scheme', 'Palette de couleurs') },
  ],
  blocks: [{
    type: 'plant',
    name: t('Plant', 'Plante'),
    settings: [
      { id: 'product', type: 'product', label: t('Product', 'Produit') },
      { id: 'image', type: 'image_picker', label: t('Photo (the product photo is used when empty)', 'Photo (celle du produit est utilisée si vide)') },
      { id: 'title', type: 'text', label: t('Name (the product title is used when empty)', 'Nom (le titre du produit est utilisé si vide)') },
      { id: 'light', type: 'range', label: t('Light needed (1 shade, 3 full sun)', 'Lumière nécessaire (1 ombre, 3 plein soleil)'), min: 1, max: 3, step: 1, default: 2 },
      { id: 'water', type: 'range', label: t('Water needed (1 rarely, 3 often)', 'Eau nécessaire (1 rarement, 3 souvent)'), min: 1, max: 3, step: 1, default: 2 },
      { id: 'note', type: 'text', label: t('Note', 'Note'), default: t('Water when the top soil is dry.', 'Arrosez quand la terre est sèche en surface.') },
    ],
  }],
  max_blocks: 4,
  presets: [{ name: t('Plant care levels', 'Niveaux d’entretien des plantes'), blocks: [{ type: 'plant' }, { type: 'plant' }] }],
  liquid: `{%- assign s = section.settings -%}
<div class="k-section k-care {% render 'scheme-class', scheme: s.color_scheme %}">
  <div class="page-width">
    <div class="k-section__head">
      {%- if s.eyebrow != blank -%}<p class="k-eyebrow">{{ s.eyebrow | escape }}</p>{%- endif -%}
      {%- if s.heading != blank -%}<h2 class="k-section__title">{{ s.heading | escape }}</h2>{%- endif -%}
    </div>
    <ul class="k-care__list" role="list">
      {%- for block in section.blocks -%}
        {%- assign b = block.settings -%}
        {%- assign pic = b.image | default: b.product.featured_image -%}
        {%- assign name = b.title | default: b.product.title -%}
        <li class="k-plant" {{ block.shopify_attributes }}>
          <a class="k-plant__media" href="{{ b.product.url | default: routes.all_products_collection_url }}">
            {%- if pic != blank -%}{{ pic | image_url: width: 700 | image_tag: loading: 'lazy', widths: '350, 520, 700', sizes: '(min-width: 990px) 22vw, 45vw', alt: name }}{%- else -%}{{ 'product-1' | placeholder_svg_tag: 'k-plant__placeholder' }}{%- endif -%}
          </a>
          <div class="k-plant__body">
            <h3 class="k-plant__name">{{ name | escape }}</h3>
            <dl class="k-plant__meters">
              <div><dt>{% render 'icon', name: 'sun', size: 16 %} {{ s.light_label | escape }}</dt><dd class="k-dots" aria-label="{{ b.light }} / 3">{%- for i in (1..3) -%}<span class="k-dot{% if i <= b.light %} is-on{% endif %}"></span>{%- endfor -%}</dd></div>
              <div><dt>{% render 'icon', name: 'drop', size: 16 %} {{ s.water_label | escape }}</dt><dd class="k-dots" aria-label="{{ b.water }} / 3">{%- for i in (1..3) -%}<span class="k-dot{% if i <= b.water %} is-on{% endif %}"></span>{%- endfor -%}</dd></div>
            </dl>
            {%- if b.note != blank -%}<p class="k-plant__note">{{ b.note | escape }}</p>{%- endif -%}
          </div>
        </li>
      {%- endfor -%}
    </ul>
  </div>
</div>
`,
  css: `
.k-care__list { display: grid; gap: 28px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin: 0; padding: 0; list-style: none; }
.k-plant { display: grid; grid-template-columns: 42% 1fr; background: var(--v-card); border: 1px solid var(--v-line); border-radius: var(--round); overflow: hidden; }
.k-plant__media { display: block; background: var(--v-surface); min-height: 220px; } .k-plant__media img, .k-plant__placeholder { width: 100%; height: 100%; object-fit: cover; }
.k-plant__body { padding: 26px 24px; display: flex; flex-direction: column; justify-content: center; }
.k-plant__name { margin: 0 0 14px; font-size: 1.35rem; }
.k-plant__meters { display: grid; gap: 10px; margin: 0 0 14px; } .k-plant__meters > div { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.k-plant__meters dt { display: flex; align-items: center; gap: 8px; font-size: .86rem; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--v-accent-deep); } .k-plant__meters dd { margin: 0; }
.k-dots { display: flex; gap: 6px; } .k-dot { width: 22px; height: 8px; border-radius: 99px; background: var(--v-line); } .k-dot.is-on { background: var(--v-accent); }
.k-plant__note { margin: 0; color: var(--v-muted); font-size: .92rem; }
@media (max-width: 899px) { .k-care__list { grid-template-columns: 1fr; } .k-plant { grid-template-columns: 38% 1fr; } .k-plant__body { padding: 18px 16px; } }
`,
};
