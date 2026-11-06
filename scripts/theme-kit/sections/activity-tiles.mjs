// Activity tiles (sport and outdoor): tall numbered photo tiles for hike, run, camp and the like, with a diagonal edge.
const t = (en, fr) => ({ en, fr });
export default {
  id: 'activity-tiles',
  name: t('Activity tiles', 'Tuiles d’activités'),
  settings: [
    { id: 'eyebrow', type: 'text', label: t('Eyebrow', 'Sur-titre'), default: t('Pick your day', 'Choisissez votre journée') },
    { id: 'heading', type: 'text', label: t('Heading', 'Titre'), default: t('Shop by activity', 'Acheter par activité') },
    { id: 'color_scheme', type: 'color_scheme', label: t('Color scheme', 'Palette de couleurs') },
  ],
  blocks: [{
    type: 'activity',
    name: t('Activity', 'Activité'),
    settings: [
      { id: 'title', type: 'text', label: t('Title', 'Titre'), default: t('Hike', 'Rando') },
      { id: 'text', type: 'text', label: t('Text', 'Texte'), default: t('Packs, poles and layers for long days.', 'Sacs, bâtons et couches pour les longues journées.') },
      { id: 'image', type: 'image_picker', label: t('Photo', 'Photo') },
      { id: 'product', type: 'product', label: t('Product (its photo is used when there is no photo)', 'Produit (sa photo est utilisée sans photo)') },
      { id: 'link', type: 'url', label: t('Link', 'Lien') },
    ],
  }],
  max_blocks: 4,
  presets: [{ name: t('Activity tiles', 'Tuiles d’activités'), blocks: [{ type: 'activity' }, { type: 'activity' }, { type: 'activity' }] }],
  liquid: `{%- assign s = section.settings -%}
<div class="k-section k-acts {% render 'scheme-class', scheme: s.color_scheme %}">
  <div class="page-width">
    <div class="k-section__head k-acts__head">
      {%- if s.eyebrow != blank -%}<p class="k-eyebrow">{{ s.eyebrow | escape }}</p>{%- endif -%}
      {%- if s.heading != blank -%}<h2 class="k-section__title">{{ s.heading | escape }}</h2>{%- endif -%}
    </div>
    <ul class="k-acts__grid k-acts__grid--{{ section.blocks.size }}" role="list">
      {%- for block in section.blocks -%}
        {%- assign a = block.settings -%}
        {%- assign pic = a.image | default: a.product.featured_image -%}
        <li class="k-act" {{ block.shopify_attributes }}>
          <a class="k-act__link{% if a.image == blank %} k-act__link--product{% endif %}" href="{{ a.link | default: a.product.url | default: routes.collections_url }}">
            {%- if pic != blank -%}{{ pic | image_url: width: 900 | image_tag: loading: 'lazy', widths: '400, 640, 900', sizes: '(min-width: 990px) 30vw, 90vw', alt: '' }}{%- else -%}{{ 'lifestyle-1' | placeholder_svg_tag: 'k-act__placeholder' }}{%- endif -%}
            <span class="k-act__num" aria-hidden="true">{{ forloop.index | prepend: '0' }}</span>
            <span class="k-act__label"><span class="k-act__title">{{ a.title | escape }}</span><span class="k-act__text">{{ a.text | escape }}</span></span>
            <span class="k-act__go">{% render 'icon', name: 'arrow-right', size: 18 %}</span>
          </a>
        </li>
      {%- endfor -%}
    </ul>
  </div>
</div>
`,
  css: `
.k-acts__head { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; flex-wrap: wrap; } .k-acts__head .k-eyebrow { width: 100%; margin: 0 0 6px; }
.k-acts__grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin: 0; padding: 0; list-style: none; } .k-acts__grid--2 { grid-template-columns: repeat(2, minmax(0, 1fr)); } .k-acts__grid--4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.k-act__link { position: relative; display: block; aspect-ratio: 3 / 4; overflow: hidden; background: var(--v-surface); color: #fff; text-decoration: none; clip-path: polygon(0 0, 100% 0, 100% calc(100% - 28px), calc(100% - 28px) 100%, 0 100%); }
.k-act__link img, .k-act__placeholder { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transition: transform calc(var(--anim) * 2) ease; } .k-act__link:hover img { transform: scale(1.06); }
.k-act__link--product { background: var(--v-card); color: var(--v-ink); } .k-act__link--product img { object-fit: contain; padding: 14% 14% 34%; }
.k-act__link::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, transparent 40%, color-mix(in srgb, #06101d 82%, transparent)); } .k-act__link--product::after { background: none; }
.k-act__num { position: absolute; z-index: 1; top: 14px; left: 16px; font: 700 2.6rem/1 var(--f-heading); letter-spacing: -.04em; color: var(--v-accent); }
.k-act__label { position: absolute; z-index: 1; left: 18px; right: 70px; bottom: 18px; display: grid; gap: 4px; }
.k-act__title { font: 700 clamp(1.7rem, 3vw, 2.3rem)/1 var(--f-heading); text-transform: uppercase; letter-spacing: -.01em; } .k-act__text { font-size: .92rem; opacity: .9; }
.k-act__go { position: absolute; z-index: 1; right: 36px; bottom: 18px; display: grid; place-items: center; width: 42px; height: 42px; background: var(--v-accent); color: var(--v-on-accent); transition: transform var(--anim); } .k-act__link:hover .k-act__go { transform: translateX(5px); }
.k-act__link--product .k-act__text { color: var(--v-muted); }
@media (max-width: 899px) { .k-acts__grid, .k-acts__grid--4 { grid-template-columns: 1fr; } .k-act__link { aspect-ratio: 16 / 10; } .k-act__link--product img { padding: 6% 6% 22%; } }
`,
};
