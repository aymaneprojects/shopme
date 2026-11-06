// Refill highlight (pets): puts one product with a subscription forward and lists its plans and the benefits.
export default {
  id: 'refill-highlight',
  name: { en: 'Refill highlight', fr: 'Réassort en vedette' },
  settings: [
    { id: 'eyebrow', type: 'text', label: { en: 'Eyebrow', fr: 'Sur-titre' }, default: { en: 'Never run out', fr: 'Jamais à court' } },
    { id: 'heading', type: 'text', label: { en: 'Heading', fr: 'Titre' }, default: { en: 'Subscribe to the food they love', fr: 'Abonnez-vous à ce qu’ils adorent' } },
    { id: 'text', type: 'text', label: { en: 'Text', fr: 'Texte' } },
    { id: 'product', type: 'product', label: { en: 'Product', fr: 'Produit' }, info: { en: 'Choose a product that has a subscription (selling plan).', fr: 'Choisissez un produit avec abonnement (plan de vente).' } },
    { id: 'button_label', type: 'text', label: { en: 'Button label', fr: 'Texte du bouton' }, default: { en: 'Choose a delivery rhythm', fr: 'Choisir un rythme de livraison' } },
    { id: 'color_scheme', type: 'color_scheme', label: { en: 'Color scheme', fr: 'Palette de couleurs' } },
  ],
  blocks: [{
    type: 'perk',
    name: { en: 'Benefit', fr: 'Avantage' },
    settings: [
      { id: 'icon', type: 'select', label: { en: 'Icon', fr: 'Icône' }, default: 'refresh', options: [
        { value: 'refresh', label: { en: 'Refresh', fr: 'Renouvellement' } }, { value: 'truck', label: { en: 'Delivery', fr: 'Livraison' } }, { value: 'tag', label: { en: 'Price tag', fr: 'Étiquette' } }, { value: 'clock', label: { en: 'Clock', fr: 'Horloge' } }, { value: 'heart', label: { en: 'Heart', fr: 'Cœur' } },
      ] },
      { id: 'text', type: 'text', label: { en: 'Text', fr: 'Texte' }, default: { en: 'Skip, pause or cancel any time', fr: 'Sautez, suspendez ou annulez à tout moment' } },
    ],
  }],
  max_blocks: 4,
  presets: [{ name: { en: 'Refill highlight', fr: 'Réassort en vedette' }, blocks: [{ type: 'perk' }, { type: 'perk' }, { type: 'perk' }] }],
  liquid: `{%- assign s = section.settings -%}
{%- assign p = s.product -%}
<div class="k-section k-refill {% render 'scheme-class', scheme: s.color_scheme %}">
  <div class="page-width k-refill__inner">
    <div class="k-refill__body">
      {%- if s.eyebrow != blank -%}<p class="k-eyebrow">{{ s.eyebrow | escape }}</p>{%- endif -%}
      {%- if s.heading != blank -%}<h2 class="k-section__title">{{ s.heading | escape }}</h2>{%- endif -%}
      {%- if s.text != blank -%}<p class="k-section__text">{{ s.text | escape }}</p>{%- endif -%}
      <ul class="k-refill__perks" role="list">
        {%- for block in section.blocks -%}
          <li {{ block.shopify_attributes }}>{% render 'icon', name: block.settings.icon, size: 20 %}<span>{{ block.settings.text | escape }}</span></li>
        {%- endfor -%}
      </ul>
      {%- if p != blank -%}
        {%- for group in p.selling_plan_groups -%}
          {%- for plan in group.selling_plans -%}<span class="k-refill__plan">{{ plan.name | escape }}</span>{%- endfor -%}
        {%- endfor -%}
        <a class="button k-refill__button" href="{{ p.url }}">{{ s.button_label | escape }}</a>
      {%- endif -%}
    </div>
    {%- if p != blank -%}
      <a class="k-refill__card" href="{{ p.url }}">
        {%- if p.featured_image != blank -%}{{ p.featured_image | image_url: width: 700 | image_tag: loading: 'lazy', widths: '350, 500, 700', sizes: '(min-width: 990px) 30vw, 80vw', alt: p.title }}{%- endif -%}
        <span class="k-refill__title">{{ p.title | escape }}</span>
        <span class="k-refill__price">{% render 'price', product: p %}</span>
      </a>
    {%- endif -%}
  </div>
</div>
`,
  css: `
.k-refill__inner { display: grid; gap: 64px; align-items: center; grid-template-columns: 6fr 4fr; }
.k-refill__perks { display: grid; gap: 12px; margin: 26px 0; padding: 0; list-style: none; } .k-refill__perks li { display: flex; align-items: center; gap: 12px; } .k-refill__perks .icon { flex: none; color: var(--v-accent); }
.k-refill__plan { display: inline-block; margin: 0 8px 12px 0; padding: 6px 14px; border: 1px dashed var(--v-accent); border-radius: var(--pill); font-size: .88rem; } .k-refill__button { display: inline-flex; margin-top: 8px; }
.k-refill__card { display: grid; gap: 4px; padding: 20px 20px 24px; text-align: center; background: var(--v-card); color: var(--v-ink); border-radius: calc(var(--round) * 1.5); box-shadow: 0 24px 48px color-mix(in srgb, var(--v-ink) 10%, transparent); text-decoration: none; transform: rotate(1.5deg); }
.k-refill__card img { width: 100%; aspect-ratio: 1; object-fit: contain; border-radius: var(--round); } .k-refill__title { font: 600 1.25rem/1.2 var(--f-heading); margin-top: 8px; }
@media (max-width: 899px) { .k-refill__inner { grid-template-columns: 1fr; gap: 36px; } .k-refill__card { transform: none; } }
`,
};
