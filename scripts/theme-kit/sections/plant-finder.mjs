// Plant finder (garden): pick a room and its light, jump to the matching products.
const t = (en, fr) => ({ en, fr });
export default {
  id: 'plant-finder',
  name: t('Plant finder', 'Trouver sa plante'),
  settings: [
    { id: 'eyebrow', type: 'text', label: t('Eyebrow', 'Sur-titre'), default: t('Plant finder', 'Trouver sa plante') },
    { id: 'heading', type: 'text', label: t('Heading', 'Titre'), default: t('Which room are you planting for?', 'Pour quelle pièce cherchez-vous ?') },
    { id: 'text', type: 'text', label: t('Text', 'Texte'), default: t('Pick a spot and we will show you what thrives there.', 'Choisissez un endroit, nous vous montrons ce qui s’y plaît.') },
    { id: 'color_scheme', type: 'color_scheme', label: t('Color scheme', 'Palette de couleurs') },
  ],
  blocks: [{
    type: 'room',
    name: t('Room', 'Pièce'),
    settings: [
      { id: 'title', type: 'text', label: t('Room', 'Pièce'), default: t('Bright living room', 'Salon lumineux') },
      { id: 'light', type: 'text', label: t('Light', 'Lumière'), default: t('Bright, indirect light', 'Lumière vive, indirecte') },
      { id: 'icon', type: 'select', label: t('Icon', 'Icône'), default: 'sun', options: [{ value: 'sun', label: t('Sun', 'Soleil') }, { value: 'moon', label: t('Shade', 'Ombre') }, { value: 'drop', label: t('Humid', 'Humide') }, { value: 'home', label: t('Home', 'Maison') }, { value: 'leaf', label: t('Leaf', 'Feuille') }] },
      { id: 'image', type: 'image_picker', label: t('Photo', 'Photo') },
      { id: 'product', type: 'product', label: t('Product (its photo is used when there is no photo)', 'Produit (sa photo est utilisée sans photo)') },
      { id: 'link', type: 'url', label: t('Link', 'Lien') },
    ],
  }],
  max_blocks: 6,
  presets: [{ name: t('Plant finder', 'Trouver sa plante'), blocks: [{ type: 'room' }, { type: 'room' }, { type: 'room' }] }],
  liquid: `{%- assign s = section.settings -%}
<div class="k-section k-finder {% render 'scheme-class', scheme: s.color_scheme %}">
  <div class="page-width k-finder__inner">
    <div class="k-finder__intro">
      {%- if s.eyebrow != blank -%}<p class="k-eyebrow">{{ s.eyebrow | escape }}</p>{%- endif -%}
      {%- if s.heading != blank -%}<h2 class="k-section__title">{{ s.heading | escape }}</h2>{%- endif -%}
      {%- if s.text != blank -%}<p class="k-finder__text">{{ s.text | escape }}</p>{%- endif -%}
    </div>
    <ul class="k-finder__rooms" role="list">
      {%- for block in section.blocks -%}
        {%- assign r = block.settings -%}
        {%- assign pic = r.image | default: r.product.featured_image -%}
        <li {{ block.shopify_attributes }}>
          <a class="k-spot" href="{{ r.link | default: r.product.url | default: routes.all_products_collection_url }}">
            <span class="k-spot__pic">{%- if pic != blank -%}{{ pic | image_url: width: 240 | image_tag: loading: 'lazy', alt: '' }}{%- endif -%}</span>
            <span class="k-spot__text"><span class="k-spot__title">{{ r.title | escape }}</span><span class="k-spot__light">{% render 'icon', name: r.icon, size: 14 %} {{ r.light | escape }}</span></span>
            <span class="k-spot__arrow">{% render 'icon', name: 'arrow-right', size: 16 %}</span>
          </a>
        </li>
      {%- endfor -%}
    </ul>
  </div>
</div>
`,
  css: `
.k-finder__inner { display: grid; grid-template-columns: .85fr 1.15fr; gap: 64px; align-items: center; }
.k-finder__text { margin: 0; color: var(--v-muted); max-width: 38ch; }
.k-finder__rooms { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
.k-spot { display: grid; grid-template-columns: 72px 1fr 40px; align-items: center; gap: 18px; padding: 10px 18px 10px 10px; border: 1px solid var(--v-line); border-radius: 999px; background: var(--v-card); color: var(--v-ink); text-decoration: none; transition: border-color var(--anim), transform var(--anim); }
.k-spot:hover { border-color: var(--v-accent); transform: translateX(6px); color: var(--v-ink); }
.k-spot__pic { width: 72px; height: 72px; border-radius: 50%; overflow: hidden; background: var(--v-surface); } .k-spot__pic img { width: 100%; height: 100%; object-fit: cover; }
.k-spot__text { display: grid; gap: 2px; } .k-spot__title { font: 600 1.15rem/1.2 var(--f-heading); } .k-spot__light { display: flex; align-items: center; gap: 6px; color: var(--v-muted); font-size: .88rem; }
.k-spot__arrow { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; background: var(--v-accent); color: var(--v-on-accent); }
@media (max-width: 899px) { .k-finder__inner { grid-template-columns: 1fr; gap: 28px; } .k-spot { grid-template-columns: 56px 1fr 34px; gap: 12px; } .k-spot__pic { width: 56px; height: 56px; } .k-spot__arrow { width: 34px; height: 34px; } }
`,
};
