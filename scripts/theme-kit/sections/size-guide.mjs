// Size guide (fashion): a size chart with three measurement columns and a how-to-measure note.
const row = (size, a, b, c) => ({ type: 'size', settings: { size, a, b, c } });
export default {
  id: 'size-guide',
  name: { en: 'Size guide', fr: 'Guide des tailles' },
  settings: [
    { id: 'eyebrow', type: 'text', label: { en: 'Eyebrow', fr: 'Sur-titre' }, default: { en: 'Find your fit', fr: 'Trouvez votre taille' } },
    { id: 'heading', type: 'text', label: { en: 'Heading', fr: 'Titre' }, default: { en: 'Size guide', fr: 'Guide des tailles' } },
    { id: 'text', type: 'text', label: { en: 'Introduction', fr: 'Introduction' }, default: { en: 'Measurements are in centimetres. If you are between two sizes, choose the larger one for a relaxed fit.', fr: 'Les mesures sont en centimètres. Entre deux tailles, choisissez la plus grande pour une coupe ample.' } },
    { id: 'column_a', type: 'text', label: { en: 'First column', fr: 'Première colonne' }, default: { en: 'Chest', fr: 'Poitrine' } },
    { id: 'column_b', type: 'text', label: { en: 'Second column', fr: 'Deuxième colonne' }, default: { en: 'Waist', fr: 'Taille' } },
    { id: 'column_c', type: 'text', label: { en: 'Third column', fr: 'Troisième colonne' }, default: { en: 'Hips', fr: 'Hanches' } },
    { id: 'size_label', type: 'text', label: { en: 'Size column title', fr: 'Titre de la colonne des tailles' }, default: { en: 'Size', fr: 'Taille' } },
    { id: 'tip_title', type: 'text', label: { en: 'Tip title', fr: 'Titre du conseil' }, default: { en: 'How to measure', fr: 'Comment mesurer' } },
    { id: 'tip_text', type: 'text', label: { en: 'Tip text', fr: 'Texte du conseil' }, default: { en: 'Stand straight, keep the tape level and snug but not tight. Measure over light clothing.', fr: 'Tenez-vous droit, gardez le mètre à l’horizontale, ajusté sans serrer. Mesurez sur des vêtements fins.' } },
    { id: 'color_scheme', type: 'color_scheme', label: { en: 'Color scheme', fr: 'Palette de couleurs' } },
  ],
  blocks: [{
    type: 'size',
    name: { en: 'Size', fr: 'Taille' },
    settings: [
      { id: 'size', type: 'text', label: { en: 'Size', fr: 'Taille' }, default: 'M' },
      { id: 'a', type: 'text', label: { en: 'First measurement', fr: 'Première mesure' }, default: '96-100' },
      { id: 'b', type: 'text', label: { en: 'Second measurement', fr: 'Deuxième mesure' }, default: '80-84' },
      { id: 'c', type: 'text', label: { en: 'Third measurement', fr: 'Troisième mesure' }, default: '98-102' },
    ],
  }],
  max_blocks: 10,
  presets: [{ name: { en: 'Size guide', fr: 'Guide des tailles' }, blocks: [row('XS', '84-88', '68-72', '90-94'), row('S', '88-92', '72-76', '94-98'), row('M', '92-96', '76-80', '98-102'), row('L', '96-100', '80-84', '102-106'), row('XL', '100-106', '84-90', '106-112')] }],
  liquid: `{%- assign s = section.settings -%}
<div class="k-section k-sizes {% render 'scheme-class', scheme: s.color_scheme %}">
  <div class="page-width k-sizes__inner">
    <div class="k-sizes__intro">
      {%- if s.eyebrow != blank -%}<p class="k-eyebrow">{{ s.eyebrow | escape }}</p>{%- endif -%}
      {%- if s.heading != blank -%}<h2 class="k-section__title">{{ s.heading | escape }}</h2>{%- endif -%}
      {%- if s.text != blank -%}<p class="k-section__text">{{ s.text | escape }}</p>{%- endif -%}
      {%- if s.tip_text != blank -%}
        <div class="k-sizes__tip">
          {% render 'icon', name: 'ruler', size: 22 %}
          <div><h3>{{ s.tip_title | escape }}</h3><p>{{ s.tip_text | escape }}</p></div>
        </div>
      {%- endif -%}
    </div>
    <div class="k-sizes__table" role="region" tabindex="0" aria-label="{{ s.heading | escape }}">
      <table>
        <thead><tr><th scope="col">{{ s.size_label | escape }}</th><th scope="col">{{ s.column_a | escape }}</th><th scope="col">{{ s.column_b | escape }}</th><th scope="col">{{ s.column_c | escape }}</th></tr></thead>
        <tbody>
          {%- for block in section.blocks -%}
            <tr {{ block.shopify_attributes }}><th scope="row">{{ block.settings.size | escape }}</th><td>{{ block.settings.a | escape }}</td><td>{{ block.settings.b | escape }}</td><td>{{ block.settings.c | escape }}</td></tr>
          {%- endfor -%}
        </tbody>
      </table>
    </div>
  </div>
</div>
`,
  css: `
.k-sizes__inner { display: grid; gap: 56px; align-items: start; grid-template-columns: 1fr 1.2fr; }
.k-sizes__tip { display: flex; gap: 14px; margin-top: 28px; padding: 20px 22px; background: var(--v-surface); border-radius: var(--round-sm); } .k-sizes__tip h3 { margin: 0 0 4px; font: 600 .78rem/1.3 var(--f-body); letter-spacing: .14em; text-transform: uppercase; } .k-sizes__tip p { margin: 0; color: var(--v-muted); font-size: .95rem; } .k-sizes__tip .icon { flex: none; color: var(--v-accent); }
.k-sizes__table { overflow-x: auto; } .k-sizes__table table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.k-sizes__table th, .k-sizes__table td { padding: 16px 14px; text-align: left; border-bottom: 1px solid var(--v-line); }
.k-sizes__table thead th { font: 600 .78rem/1.2 var(--f-body); letter-spacing: .14em; text-transform: uppercase; color: var(--v-muted); border-bottom: 1px solid var(--v-ink); }
.k-sizes__table tbody th { font: 500 1.1rem/1.2 var(--f-heading); } .k-sizes__table tbody tr:hover { background: var(--v-accent-soft); }
@media (max-width: 899px) { .k-sizes__inner { grid-template-columns: 1fr; gap: 32px; } }
`,
};
