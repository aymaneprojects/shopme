// Age tiles (toys): shop by age in big colourful bubbles, each with a number and a short line.
export default {
  id: 'age-tiles',
  name: { en: 'Shop by age', fr: 'Acheter par âge' },
  settings: [
    { id: 'eyebrow', type: 'text', label: { en: 'Eyebrow', fr: 'Sur-titre' }, default: { en: 'Shop by age', fr: 'Par âge' } },
    { id: 'heading', type: 'text', label: { en: 'Heading', fr: 'Titre' }, default: { en: 'Toys for every size of explorer', fr: 'Des jouets pour chaque petit explorateur' } },
    { id: 'color_scheme', type: 'color_scheme', label: { en: 'Color scheme', fr: 'Palette de couleurs' } },
  ],
  blocks: [{
    type: 'age',
    name: { en: 'Age group', fr: 'Tranche d’âge' },
    settings: [
      { id: 'range', type: 'text', label: { en: 'Age range', fr: 'Tranche d’âge' }, default: { en: '0-12', fr: '0-12' } },
      { id: 'unit', type: 'text', label: { en: 'Unit', fr: 'Unité' }, default: { en: 'months', fr: 'mois' } },
      { id: 'text', type: 'text', label: { en: 'Text', fr: 'Texte' }, default: { en: 'Soft things to hold and chew.', fr: 'Des douceurs à tenir et à mâchouiller.' } },
      { id: 'link', type: 'url', label: { en: 'Link', fr: 'Lien' } },
      { id: 'color_scheme', type: 'color_scheme', label: { en: 'Color scheme', fr: 'Palette de couleurs' }, default: 'scheme-1' },
    ],
  }],
  max_blocks: 5,
  presets: [{ name: { en: 'Shop by age', fr: 'Acheter par âge' }, blocks: [{ type: 'age' }, { type: 'age' }, { type: 'age' }, { type: 'age' }] }],
  liquid: `{%- assign s = section.settings -%}
<div class="k-section k-ages {% render 'scheme-class', scheme: s.color_scheme %}">
  <div class="page-width">
    <div class="k-section__head k-section__head--center">
      {%- if s.eyebrow != blank -%}<p class="k-eyebrow">{{ s.eyebrow | escape }}</p>{%- endif -%}
      {%- if s.heading != blank -%}<h2 class="k-section__title">{{ s.heading | escape }}</h2>{%- endif -%}
    </div>
    <ul class="k-ages__list" role="list">
      {%- for block in section.blocks -%}
        <li {{ block.shopify_attributes }}>
          <a class="k-age {% render 'scheme-class', scheme: block.settings.color_scheme %}" href="{{ block.settings.link | default: routes.all_products_collection_url }}">
            <span class="k-age__range">{{ block.settings.range | escape }}</span>
            <span class="k-age__unit">{{ block.settings.unit | escape }}</span>
            <span class="k-age__text">{{ block.settings.text | escape }}</span>
          </a>
        </li>
      {%- endfor -%}
    </ul>
  </div>
</div>
`,
  css: `
.k-ages__list { display: grid; gap: 20px; margin: 0; padding: 0; list-style: none; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); }
.k-age { display: grid; justify-items: center; align-content: center; gap: 4px; aspect-ratio: 1; padding: 24px; text-align: center; background: var(--v-bg); color: var(--v-ink); border-radius: 50%; text-decoration: none; transition: transform var(--anim) cubic-bezier(.3, 1.6, .5, 1); }
.k-ages__list li:nth-child(even) .k-age { border-radius: 38% 62% 55% 45% / 50% 45% 55% 50%; } .k-age:hover { transform: rotate(-3deg) scale(1.04); color: var(--v-ink); }
.k-age__range { font: 800 clamp(2.2rem, 4vw, 3.2rem)/1 var(--f-heading); } .k-age__unit { font-weight: 700; text-transform: uppercase; letter-spacing: .12em; font-size: .78rem; } .k-age__text { margin-top: 10px; max-width: 18ch; font-size: .92rem; color: var(--v-muted); }
`,
};
