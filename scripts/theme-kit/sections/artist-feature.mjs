// Artist feature (art): a portrait, a short biography and a pull quote, with the featured work to shop.
export default {
  id: 'artist-feature',
  name: { en: 'Featured artist', fr: 'Artiste à l’honneur' },
  settings: [
    { id: 'eyebrow', type: 'text', label: { en: 'Eyebrow', fr: 'Sur-titre' }, default: { en: 'Featured artist', fr: 'Artiste à l’honneur' } },
    { id: 'name', type: 'text', label: { en: 'Artist name', fr: 'Nom de l’artiste' }, default: { en: 'Name of the artist', fr: 'Nom de l’artiste' } },
    { id: 'meta', type: 'text', label: { en: 'Line under the name', fr: 'Ligne sous le nom' }, default: { en: 'Painter, born 1984', fr: 'Peintre, née en 1984' } },
    { id: 'bio', type: 'richtext', label: { en: 'Biography', fr: 'Biographie' } },
    { id: 'quote', type: 'textarea', label: { en: 'Quote', fr: 'Citation' } },
    { id: 'image', type: 'image_picker', label: { en: 'Photo', fr: 'Photo' } },
    { id: 'product', type: 'product', label: { en: 'Featured work (its photo is used when there is no photo)', fr: 'Œuvre à l’honneur (sa photo est utilisée sans photo)' } },
    { id: 'button_label', type: 'text', label: { en: 'Button label', fr: 'Texte du bouton' }, default: { en: 'View the work', fr: 'Voir l’œuvre' } },
    { id: 'color_scheme', type: 'color_scheme', label: { en: 'Color scheme', fr: 'Palette de couleurs' } },
  ],
  presets: [{ name: { en: 'Featured artist', fr: 'Artiste à l’honneur' } }],
  liquid: `{%- assign s = section.settings -%}
{%- assign pic = s.image | default: s.product.featured_image -%}
<div class="k-section k-artist {% render 'scheme-class', scheme: s.color_scheme %}">
  <div class="page-width k-artist__inner">
    <div class="k-artist__media">
      {%- if pic != blank -%}{{ pic | image_url: width: 1000 | image_tag: loading: 'lazy', widths: '500, 800, 1000', sizes: '(min-width: 990px) 45vw, 90vw', alt: s.name }}{%- else -%}{{ 'lifestyle-1' | placeholder_svg_tag: 'k-artist__placeholder' }}{%- endif -%}
    </div>
    <div class="k-artist__body">
      {%- if s.eyebrow != blank -%}<p class="k-eyebrow">{{ s.eyebrow | escape }}</p>{%- endif -%}
      <h2 class="k-artist__name">{{ s.name | escape }}</h2>
      {%- if s.meta != blank -%}<p class="k-artist__meta">{{ s.meta | escape }}</p>{%- endif -%}
      {%- if s.quote != blank -%}<blockquote class="k-artist__quote">{{ s.quote | escape }}</blockquote>{%- endif -%}
      {%- if s.bio != blank -%}<div class="k-artist__bio rte">{{ s.bio }}</div>{%- endif -%}
      {%- if s.product != blank -%}<a class="k-artist__link" href="{{ s.product.url }}">{{ s.button_label | escape }} {% render 'icon', name: 'arrow-right', size: 16 %}</a>{%- endif -%}
    </div>
  </div>
</div>
`,
  css: `
.k-artist__inner { display: grid; gap: 96px; align-items: end; grid-template-columns: 6fr 5fr; }
.k-artist__media { position: relative; aspect-ratio: 4 / 5; background: var(--v-surface); } .k-artist__media img, .k-artist__placeholder { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.k-artist__name { margin: 0; font: 300 clamp(2.4rem, 5vw, 4.4rem)/1 var(--f-heading); letter-spacing: -.03em; }
.k-artist__meta { margin: 12px 0 0; color: var(--v-muted); letter-spacing: .14em; text-transform: uppercase; font-size: .78rem; }
.k-artist__quote { margin: 48px 0 28px; padding: 0 0 0 24px; border-left: 1px solid var(--v-ink); font: italic 400 1.45rem/1.4 var(--f-accent); }
.k-artist__bio { color: var(--v-muted); max-width: 46ch; } .k-artist__link { display: inline-flex; align-items: center; gap: 10px; margin-top: 32px; padding-bottom: 4px; border-bottom: 1px solid var(--v-ink); color: var(--v-ink); text-transform: uppercase; letter-spacing: .14em; font-size: .78rem; text-decoration: none; }
@media (max-width: 899px) { .k-artist__inner { grid-template-columns: 1fr; gap: 36px; } }
`,
};
