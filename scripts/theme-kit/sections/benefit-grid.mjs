// Benefit grid (single-product stores): the reasons to buy, as icon cards on a bordered grid.
const t = (en, fr) => ({ en, fr });
const ICONS = ['leaf', 'drop', 'sparkle', 'heart', 'truck', 'check', 'refresh', 'shield', 'package', 'gift', 'clock', 'sun', 'scissors', 'home'].map((v) => ({ value: v, label: t(v[0].toUpperCase() + v.slice(1), v[0].toUpperCase() + v.slice(1)) }));
export default {
  id: 'benefit-grid',
  name: t('Benefits', 'Avantages'),
  settings: [
    { id: 'eyebrow', type: 'text', label: t('Eyebrow', 'Sur-titre'), default: t('Why this one', 'Pourquoi celle-ci') },
    { id: 'heading', type: 'text', label: t('Heading', 'Titre'), default: t('Made to be the last one you buy', 'Faite pour être la dernière que vous achetez') },
    { id: 'text', type: 'text', label: t('Text', 'Texte'), default: '' },
    { id: 'color_scheme', type: 'color_scheme', label: t('Color scheme', 'Palette de couleurs') },
  ],
  blocks: [{
    type: 'benefit',
    name: t('Benefit', 'Avantage'),
    settings: [
      { id: 'icon', type: 'select', label: t('Icon', 'Icône'), default: 'leaf', options: ICONS },
      { id: 'title', type: 'text', label: t('Title', 'Titre'), default: t('Keeps cold for 24 hours', 'Garde au frais 24 heures') },
      { id: 'text', type: 'text', label: t('Text', 'Texte'), default: t('Double-wall steel holds ice from morning to night.', 'L’acier double paroi garde la glace du matin au soir.') },
    ],
  }],
  max_blocks: 8,
  presets: [{ name: t('Benefits', 'Avantages'), blocks: [{ type: 'benefit' }, { type: 'benefit' }, { type: 'benefit' }] }],
  liquid: `{%- assign s = section.settings -%}
<div id="benefits" class="k-section k-benefit-grid {% render 'scheme-class', scheme: s.color_scheme %}">
  <div class="page-width">
    <div class="k-section__head k-section__head--center">
      {%- if s.eyebrow != blank -%}<p class="k-eyebrow">{{ s.eyebrow | escape }}</p>{%- endif -%}
      {%- if s.heading != blank -%}<h2 class="k-section__title">{{ s.heading | escape }}</h2>{%- endif -%}
      {%- if s.text != blank -%}<p class="k-bgrid__lead">{{ s.text | escape }}</p>{%- endif -%}
    </div>
    <ul class="k-bgrid" role="list">
      {%- for block in section.blocks -%}
        <li class="k-bgrid__item" {{ block.shopify_attributes }}>
          <span class="k-bgrid__icon">{% render 'icon', name: block.settings.icon, size: 26 %}</span>
          <h3 class="k-bgrid__title">{{ block.settings.title | escape }}</h3>
          <p class="k-bgrid__text">{{ block.settings.text | escape }}</p>
        </li>
      {%- endfor -%}
    </ul>
  </div>
</div>
`,
  css: `
.k-bgrid__lead { margin: 12px 0 0; color: var(--v-muted); }
.k-bgrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0; margin: 0; padding: 0; list-style: none; border-top: 1px solid var(--v-line); border-left: 1px solid var(--v-line); }
.k-bgrid__item { padding: 34px 30px 36px; border-right: 1px solid var(--v-line); border-bottom: 1px solid var(--v-line); background: var(--v-card); }
.k-bgrid__icon { display: grid; place-items: center; width: 56px; height: 56px; margin-bottom: 18px; border-radius: 50%; background: var(--v-ink); color: var(--v-bg); }
.k-bgrid__title { margin: 0 0 8px; font-size: 1.2rem; } .k-bgrid__text { margin: 0; color: var(--v-muted); }
@media (max-width: 899px) { .k-bgrid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 559px) { .k-bgrid { grid-template-columns: 1fr; } .k-bgrid__item { padding: 24px 20px; } }
`,
};
