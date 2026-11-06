// Trail-tested promise (sport and outdoor): a bold band with a promise and big figures.
const t = (en, fr) => ({ en, fr });
export default {
  id: 'trail-promise',
  name: t('Trail-tested promise', 'Promesse testée sur le terrain'),
  settings: [
    { id: 'eyebrow', type: 'text', label: t('Eyebrow', 'Sur-titre'), default: t('Trail tested', 'Testé sur le terrain') },
    { id: 'heading', type: 'text', label: t('Heading', 'Titre'), default: t('Tested where it counts', 'Testé là où ça compte') },
    { id: 'text', type: 'text', label: t('Text', 'Texte'), default: t('Every piece goes through a season of real use before it reaches the shop.', 'Chaque pièce traverse une saison d’usage réel avant d’arriver en boutique.') },
    { id: 'button_label', type: 'text', label: t('Button label', 'Libellé du bouton'), default: t('Our promise', 'Notre promesse') },
    { id: 'button_link', type: 'url', label: t('Button link', 'Lien du bouton') },
    { id: 'color_scheme', type: 'color_scheme', label: t('Color scheme', 'Palette de couleurs') },
  ],
  blocks: [{
    type: 'stat',
    name: t('Figure', 'Chiffre'),
    settings: [
      { id: 'value', type: 'text', label: t('Figure', 'Chiffre'), default: t('500 km', '500 km') },
      { id: 'label', type: 'text', label: t('Label', 'Libellé'), default: t('walked by every prototype', 'parcourus par chaque prototype') },
    ],
  }],
  max_blocks: 4,
  presets: [{ name: t('Trail-tested promise', 'Promesse testée sur le terrain'), blocks: [{ type: 'stat' }, { type: 'stat' }, { type: 'stat' }] }],
  liquid: `{%- assign s = section.settings -%}
<div class="k-section k-promise {% render 'scheme-class', scheme: s.color_scheme %}">
  <div class="page-width k-promise__inner">
    <div class="k-promise__copy">
      {%- if s.eyebrow != blank -%}<p class="k-eyebrow">{{ s.eyebrow | escape }}</p>{%- endif -%}
      {%- if s.heading != blank -%}<h2 class="k-section__title">{{ s.heading | escape }}</h2>{%- endif -%}
      {%- if s.text != blank -%}<p class="k-promise__text">{{ s.text | escape }}</p>{%- endif -%}
      {%- if s.button_label != blank -%}<a class="button" href="{{ s.button_link | default: routes.all_products_collection_url }}">{{ s.button_label | escape }}</a>{%- endif -%}
    </div>
    <ul class="k-promise__stats" role="list">
      {%- for block in section.blocks -%}
        <li class="k-stat" {{ block.shopify_attributes }}><span class="k-stat__value">{{ block.settings.value | escape }}</span><span class="k-stat__label">{{ block.settings.label | escape }}</span></li>
      {%- endfor -%}
    </ul>
  </div>
</div>
`,
  css: `
.k-promise__inner { display: grid; grid-template-columns: 1fr 1.1fr; gap: 56px; align-items: center; }
.k-promise__text { max-width: 44ch; margin: 0 0 26px; font-size: 1.1rem; }
.k-promise__stats { display: grid; margin: 0; padding: 0; list-style: none; }
.k-stat { display: grid; grid-template-columns: minmax(150px, .8fr) 1fr; gap: 22px; align-items: baseline; padding: 18px 0; border-top: 2px solid currentColor; } .k-stat:last-child { border-bottom: 2px solid currentColor; }
.k-stat__value { font: 700 clamp(2.6rem, 5vw, 4.2rem)/1 var(--f-heading); letter-spacing: -.04em; text-transform: uppercase; } .k-stat__label { font-weight: 600; text-transform: uppercase; letter-spacing: .06em; font-size: .86rem; }
@media (max-width: 899px) { .k-promise__inner { grid-template-columns: 1fr; gap: 28px; } .k-stat { grid-template-columns: 1fr; gap: 4px; } }
`,
};
