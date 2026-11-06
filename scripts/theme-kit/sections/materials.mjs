// Materials and care (home, leather goods): icons with a title and a short text on a tinted band.
const icons = ['leaf', 'drop', 'sun', 'shield', 'refresh', 'package'].map((value) => ({ value, label: { en: value[0].toUpperCase() + value.slice(1), fr: { leaf: 'Feuille', drop: 'Goutte', sun: 'Soleil', shield: 'Bouclier', refresh: 'Renouvellement', package: 'Colis' }[value] } }));
export default {
  id: 'materials',
  name: { en: 'Materials and care', fr: 'Matières et entretien' },
  settings: [
    { id: 'eyebrow', type: 'text', label: { en: 'Eyebrow', fr: 'Sur-titre' }, default: { en: 'Good to know', fr: 'Bon à savoir' } },
    { id: 'heading', type: 'text', label: { en: 'Heading', fr: 'Titre' }, default: { en: 'Materials and care', fr: 'Matières et entretien' } },
    { id: 'text', type: 'text', label: { en: 'Text', fr: 'Texte' } },
    { id: 'color_scheme', type: 'color_scheme', label: { en: 'Color scheme', fr: 'Palette de couleurs' }, default: 'scheme-2' },
  ],
  blocks: [{
    type: 'material',
    name: { en: 'Material', fr: 'Matière' },
    settings: [
      { id: 'icon', type: 'select', label: { en: 'Icon', fr: 'Icône' }, options: icons, default: 'leaf' },
      { id: 'title', type: 'text', label: { en: 'Title', fr: 'Titre' }, default: { en: 'Natural fibres', fr: 'Fibres naturelles' } },
      { id: 'text', type: 'text', label: { en: 'Text', fr: 'Texte' }, default: { en: 'Linen, cotton and wool, chosen for how they age.', fr: 'Lin, coton et laine, choisis pour leur façon de vieillir.' } },
    ],
  }],
  max_blocks: 6,
  presets: [{ name: { en: 'Materials and care', fr: 'Matières et entretien' }, blocks: [{ type: 'material' }, { type: 'material', settings: { icon: 'drop' } }, { type: 'material', settings: { icon: 'refresh' } }] }],
  liquid: `{%- assign s = section.settings -%}
<div class="k-section k-materials {% render 'scheme-class', scheme: s.color_scheme %}">
  <div class="page-width">
    <div class="k-section__head k-section__head--center">
      {%- if s.eyebrow != blank -%}<p class="k-eyebrow">{{ s.eyebrow | escape }}</p>{%- endif -%}
      {%- if s.heading != blank -%}<h2 class="k-section__title">{{ s.heading | escape }}</h2>{%- endif -%}
      {%- if s.text != blank -%}<p class="k-section__text">{{ s.text | escape }}</p>{%- endif -%}
    </div>
    <ul class="k-materials__list k-materials__list--{{ section.blocks.size }}" role="list">
      {%- for block in section.blocks -%}
        <li class="k-material" {{ block.shopify_attributes }}>
          <span class="k-material__icon">{% render 'icon', name: block.settings.icon, size: 26 %}</span>
          <h3 class="k-material__title">{{ block.settings.title | escape }}</h3>
          <p class="k-material__text">{{ block.settings.text | escape }}</p>
        </li>
      {%- endfor -%}
    </ul>
  </div>
</div>
`,
  css: `
.k-materials__list { display: grid; gap: 28px; margin: 0; padding: 0; list-style: none; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
.k-material { padding: 30px 26px; background: var(--v-card); border-radius: var(--round); text-align: left; }
.k-material__icon { display: grid; place-items: center; width: 54px; height: 54px; margin-bottom: 18px; border-radius: var(--pill); background: var(--v-accent-soft); color: var(--v-accent); }
.k-material__title { margin: 0 0 8px; font: 500 1.25rem/1.25 var(--f-heading); } .k-material__text { margin: 0; color: var(--v-muted); font-size: .96rem; }
`,
};
