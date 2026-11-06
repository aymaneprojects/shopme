// Pet tiles (pets): shop by pet in large tiles, a photo cropped to a soft blob with a label under it.
export default {
  id: 'pet-tiles',
  name: { en: 'Shop by pet', fr: 'Acheter par animal' },
  settings: [
    { id: 'eyebrow', type: 'text', label: { en: 'Eyebrow', fr: 'Sur-titre' }, default: { en: 'Shop by pet', fr: 'Par animal' } },
    { id: 'heading', type: 'text', label: { en: 'Heading', fr: 'Titre' }, default: { en: 'Who are we shopping for?', fr: 'Pour qui faisons-nous les courses ?' } },
    { id: 'color_scheme', type: 'color_scheme', label: { en: 'Color scheme', fr: 'Palette de couleurs' } },
  ],
  blocks: [{
    type: 'pet',
    name: { en: 'Pet', fr: 'Animal' },
    settings: [
      { id: 'image', type: 'image_picker', label: { en: 'Photo', fr: 'Photo' } },
      { id: 'product', type: 'product', label: { en: 'Product (its photo is used when there is no photo)', fr: 'Produit (sa photo est utilisée sans photo)' } },
      { id: 'title', type: 'text', label: { en: 'Title', fr: 'Titre' }, default: { en: 'For dogs', fr: 'Pour chiens' } },
      { id: 'text', type: 'text', label: { en: 'Text', fr: 'Texte' }, default: { en: 'Beds, bowls, leads and toys.', fr: 'Paniers, gamelles, laisses et jouets.' } },
      { id: 'link', type: 'url', label: { en: 'Link', fr: 'Lien' } },
    ],
  }],
  max_blocks: 4,
  presets: [{ name: { en: 'Shop by pet', fr: 'Acheter par animal' }, blocks: [{ type: 'pet' }, { type: 'pet' }] }],
  liquid: `{%- assign s = section.settings -%}
<div class="k-section k-pets {% render 'scheme-class', scheme: s.color_scheme %}">
  <div class="page-width">
    <div class="k-section__head k-section__head--center">
      {%- if s.eyebrow != blank -%}<p class="k-eyebrow">{{ s.eyebrow | escape }}</p>{%- endif -%}
      {%- if s.heading != blank -%}<h2 class="k-section__title">{{ s.heading | escape }}</h2>{%- endif -%}
    </div>
    <ul class="k-pets__list k-pets__list--{{ section.blocks.size }}" role="list">
      {%- for block in section.blocks -%}
        {%- assign pet = block.settings -%}
        {%- assign pic = pet.image | default: pet.product.featured_image -%}
        <li {{ block.shopify_attributes }}>
          <a class="k-pet" href="{{ pet.link | default: pet.product.url | default: routes.collections_url }}">
            <span class="k-pet__photo{% if pet.image == blank %} k-pet__photo--product{% endif %}">
              {%- if pic != blank -%}{{ pic | image_url: width: 800 | image_tag: loading: 'lazy', widths: '400, 600, 800', sizes: '(min-width: 990px) 30vw, 90vw', alt: '' }}{%- else -%}{{ 'lifestyle-1' | placeholder_svg_tag: 'k-pet__placeholder' }}{%- endif -%}
            </span>
            <span class="k-pet__title">{{ pet.title | escape }}</span>
            <span class="k-pet__text">{{ pet.text | escape }}</span>
          </a>
        </li>
      {%- endfor -%}
    </ul>
  </div>
</div>
`,
  css: `
.k-pets__list { display: grid; gap: 40px; margin: 0 auto; padding: 0; list-style: none; max-width: 980px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
.k-pet { display: grid; justify-items: center; gap: 6px; text-align: center; color: var(--v-ink); text-decoration: none; }
.k-pet__photo { position: relative; width: 100%; aspect-ratio: 1; overflow: hidden; background: var(--v-surface); border-radius: 62% 38% 54% 46% / 48% 56% 44% 52%; transition: border-radius calc(var(--anim) * 4) ease; } .k-pet:hover .k-pet__photo { border-radius: 40% 60% 46% 54% / 56% 44% 56% 44%; }
.k-pet__photo img, .k-pet__placeholder { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; } .k-pet__photo--product img { object-fit: contain; padding: 12%; background: var(--v-card); }
.k-pet__title { margin-top: 14px; font: 600 1.7rem/1.1 var(--f-heading); } .k-pet__text { color: var(--v-muted); }
`,
};
