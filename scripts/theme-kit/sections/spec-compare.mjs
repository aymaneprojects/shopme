// Tech specs comparison (sport and outdoor): products side by side with four rows of specs.
const t = (en, fr) => ({ en, fr });
const row = (n, en, fr) => ({ id: `label_${n}`, type: 'text', label: t(`Row ${n} label`, `Libellé de la ligne ${n}`), default: t(en, fr) });
const val = (n, en, fr) => ({ id: `value_${n}`, type: 'text', label: t(`Row ${n} value`, `Valeur de la ligne ${n}`), default: t(en, fr) });
export default {
  id: 'spec-compare',
  name: t('Specs comparison', 'Comparatif technique'),
  settings: [
    { id: 'eyebrow', type: 'text', label: t('Eyebrow', 'Sur-titre'), default: t('Tech specs', 'Fiche technique') },
    { id: 'heading', type: 'text', label: t('Heading', 'Titre'), default: t('Compare before you go', 'Comparez avant de partir') },
    row(1, 'Weight', 'Poids'), row(2, 'Best for', 'Idéal pour'), row(3, 'Weather rating', 'Protection météo'), row(4, 'Warranty', 'Garantie'),
    { id: 'button_label', type: 'text', label: t('Button label', 'Libellé du bouton'), default: t('View', 'Voir') },
    { id: 'color_scheme', type: 'color_scheme', label: t('Color scheme', 'Palette de couleurs') },
  ],
  blocks: [{
    type: 'item',
    name: t('Product', 'Produit'),
    settings: [
      { id: 'product', type: 'product', label: t('Product', 'Produit') },
      { id: 'badge', type: 'text', label: t('Badge', 'Pastille'), default: t('Best seller', 'Meilleure vente') },
      val(1, '640 g', '640 g'), val(2, 'Day hikes', 'Randonnées à la journée'), val(3, 'Showerproof', 'Résiste aux averses'), val(4, '5 years', '5 ans'),
    ],
  }],
  max_blocks: 4,
  presets: [{ name: t('Specs comparison', 'Comparatif technique'), blocks: [{ type: 'item' }, { type: 'item' }, { type: 'item' }] }],
  liquid: `{%- assign s = section.settings -%}
<div class="k-section k-specs {% render 'scheme-class', scheme: s.color_scheme %}">
  <div class="page-width">
    <div class="k-section__head">
      {%- if s.eyebrow != blank -%}<p class="k-eyebrow">{{ s.eyebrow | escape }}</p>{%- endif -%}
      {%- if s.heading != blank -%}<h2 class="k-section__title">{{ s.heading | escape }}</h2>{%- endif -%}
    </div>
    <div class="k-specs__scroll">
      <table class="k-specs__table k-specs__table--{{ section.blocks.size }}">
        <thead>
          <tr>
            <th scope="col"><span class="visually-hidden">{{ s.heading | escape }}</span></th>
            {%- for block in section.blocks -%}
              {%- assign p = block.settings.product -%}
              <th scope="col" class="k-specs__prod" {{ block.shopify_attributes }}>
                {%- if block.settings.badge != blank -%}<span class="k-specs__badge">{{ block.settings.badge | escape }}</span>{%- endif -%}
                {%- if p.featured_image != blank -%}<a class="k-specs__img" href="{{ p.url }}">{{ p.featured_image | image_url: width: 400 | image_tag: loading: 'lazy', widths: '200, 400', sizes: '220px', alt: p.title }}</a>{%- endif -%}
                <span class="k-specs__name">{{ p.title | escape }}</span>
                <span class="k-specs__price">{% render 'price', product: p %}</span>
                {%- if p != blank -%}<a class="button button--small" href="{{ p.url }}">{{ s.button_label | escape }}</a>{%- endif -%}
              </th>
            {%- endfor -%}
          </tr>
        </thead>
        <tbody>
          <tr><th scope="row">{{ s.label_1 | escape }}</th>{%- for block in section.blocks -%}<td>{{ block.settings.value_1 | escape }}</td>{%- endfor -%}</tr>
          <tr><th scope="row">{{ s.label_2 | escape }}</th>{%- for block in section.blocks -%}<td>{{ block.settings.value_2 | escape }}</td>{%- endfor -%}</tr>
          <tr><th scope="row">{{ s.label_3 | escape }}</th>{%- for block in section.blocks -%}<td>{{ block.settings.value_3 | escape }}</td>{%- endfor -%}</tr>
          <tr><th scope="row">{{ s.label_4 | escape }}</th>{%- for block in section.blocks -%}<td>{{ block.settings.value_4 | escape }}</td>{%- endfor -%}</tr>
        </tbody>
      </table>
    </div>
  </div>
</div>
`,
  css: `
.k-specs__scroll { overflow-x: auto; border: 2px solid var(--v-ink); background: var(--v-card); }
.k-specs__table { width: 100%; min-width: 640px; border-collapse: collapse; text-align: center; }
.k-specs__table th, .k-specs__table td { padding: 16px 18px; border-top: 1px solid var(--v-line); border-left: 1px solid var(--v-line); vertical-align: middle; } .k-specs__table th:first-child, .k-specs__table td:first-child { border-left: 0; }
.k-specs__table tbody th { width: 18%; text-align: left; font: 700 .8rem/1.3 var(--f-heading); letter-spacing: .1em; text-transform: uppercase; color: var(--v-muted); } .k-specs__table tbody td { font-weight: 600; }
.k-specs__table thead th { border-top: 0; padding-block: 26px 22px; }
.k-specs__prod { position: relative; } .k-specs__prod > * { margin-inline: auto; }
.k-specs__badge { position: absolute; top: 0; left: 50%; transform: translateX(-50%); padding: 3px 12px; background: var(--v-accent); color: var(--v-on-accent); font: 700 .7rem/1.5 var(--f-heading); letter-spacing: .1em; text-transform: uppercase; white-space: nowrap; }
.k-specs__img { display: block; width: min(160px, 100%); aspect-ratio: 1; margin-bottom: 10px; } .k-specs__img img { width: 100%; height: 100%; object-fit: contain; }
.k-specs__name { display: block; font: 700 1.05rem/1.2 var(--f-heading); text-transform: uppercase; } .k-specs__price { display: block; margin: 4px 0 12px; font-weight: 500; }
.k-specs__table tbody tr:nth-child(odd) td, .k-specs__table tbody tr:nth-child(odd) th { background: color-mix(in srgb, var(--v-surface) 55%, transparent); }
`,
};
