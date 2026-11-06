// Gift guide (accessories): big budget tiles that lead to a collection.
export default {
  id: 'gift-guide',
  name: { en: 'Gift guide', fr: 'Guide cadeaux' },
  settings: [
    { id: 'eyebrow', type: 'text', label: { en: 'Eyebrow', fr: 'Sur-titre' }, default: { en: 'Gift guide', fr: 'Guide cadeaux' } },
    { id: 'heading', type: 'text', label: { en: 'Heading', fr: 'Titre' }, default: { en: 'Find the right gift', fr: 'Trouvez le bon cadeau' } },
    { id: 'text', type: 'text', label: { en: 'Text', fr: 'Texte' } },
    { id: 'color_scheme', type: 'color_scheme', label: { en: 'Color scheme', fr: 'Palette de couleurs' } },
  ],
  blocks: [{
    type: 'budget',
    name: { en: 'Budget', fr: 'Budget' },
    settings: [
      { id: 'label', type: 'text', label: { en: 'Label', fr: 'Libellé' }, default: { en: 'Under 100', fr: 'Moins de 100' } },
      { id: 'text', type: 'text', label: { en: 'Text', fr: 'Texte' }, default: { en: 'Small leather goods and belts.', fr: 'Petite maroquinerie et ceintures.' } },
      { id: 'link', type: 'url', label: { en: 'Link', fr: 'Lien' } },
      { id: 'color_scheme', type: 'color_scheme', label: { en: 'Color scheme', fr: 'Palette de couleurs' }, default: 'scheme-1' },
    ],
  }],
  max_blocks: 4,
  presets: [{ name: { en: 'Gift guide', fr: 'Guide cadeaux' }, blocks: [{ type: 'budget' }, { type: 'budget' }, { type: 'budget' }] }],
  liquid: `{%- assign s = section.settings -%}
<div class="k-section k-gifts {% render 'scheme-class', scheme: s.color_scheme %}">
  <div class="page-width">
    <div class="k-section__head k-section__head--center">
      {%- if s.eyebrow != blank -%}<p class="k-eyebrow">{{ s.eyebrow | escape }}</p>{%- endif -%}
      {%- if s.heading != blank -%}<h2 class="k-section__title">{{ s.heading | escape }}</h2>{%- endif -%}
      {%- if s.text != blank -%}<p class="k-section__text">{{ s.text | escape }}</p>{%- endif -%}
    </div>
    <ul class="k-gifts__list k-gifts__list--{{ section.blocks.size }}" role="list">
      {%- for block in section.blocks -%}
        <li {{ block.shopify_attributes }}>
          <a class="k-gift {% render 'scheme-class', scheme: block.settings.color_scheme %}" href="{{ block.settings.link | default: routes.all_products_collection_url }}">
            <span class="k-gift__label">{{ block.settings.label | escape }}</span>
            <span class="k-gift__text">{{ block.settings.text | escape }}</span>
            <span class="k-gift__arrow">{% render 'icon', name: 'arrow-right', size: 18 %}</span>
          </a>
        </li>
      {%- endfor -%}
    </ul>
  </div>
</div>
`,
  css: `
.k-gifts__list { display: grid; gap: 18px; margin: 0; padding: 0; list-style: none; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); }
.k-gift { position: relative; display: grid; align-content: space-between; gap: 40px; min-height: 260px; padding: 30px 28px; background: var(--v-bg); color: var(--v-ink); border: 1px solid var(--v-line); border-radius: var(--round); text-decoration: none; transition: transform var(--anim), box-shadow var(--anim); }
.k-gift:hover { transform: translateY(-4px); box-shadow: 0 22px 44px color-mix(in srgb, var(--v-ink) 12%, transparent); color: var(--v-ink); }
.k-gift__label { font: 500 clamp(1.7rem, 3vw, 2.4rem)/1.05 var(--f-heading); } .k-gift__text { color: var(--v-muted); max-width: 26ch; } .k-gift__arrow { justify-self: end; display: grid; place-items: center; width: 42px; height: 42px; border-radius: var(--pill); background: var(--v-accent); color: var(--v-on-accent); }
`,
};
