// Colour showcase (single-product stores): one tile per colour of the product; a tap picks that colour in the buy box.
const t = (en, fr) => ({ en, fr });
export default {
  id: 'colour-showcase',
  name: t('Colour showcase', 'Vitrine des coloris'),
  settings: [
    { id: 'product', type: 'product', label: t('Product (the first product of the shop when empty)', 'Produit (le premier produit de la boutique si vide)') },
    { id: 'eyebrow', type: 'text', label: t('Eyebrow', 'Sur-titre'), default: t('Six colours', 'Six coloris') },
    { id: 'heading', type: 'text', label: t('Heading', 'Titre'), default: t('Pick the one that feels like you', 'Choisissez celle qui vous ressemble') },
    { id: 'button_label', type: 'text', label: t('Tile button', 'Bouton des tuiles'), default: t('Choose', 'Choisir') },
    { id: 'color_scheme', type: 'color_scheme', label: t('Color scheme', 'Palette de couleurs') },
  ],
  presets: [{ name: t('Colour showcase', 'Vitrine des coloris') }],
  liquid: `{%- liquid
  assign s = section.settings
  assign product = s.product | default: collections.all.products.first
-%}
{%- if product != blank -%}
<div id="colours" class="k-section k-shades-show {% render 'scheme-class', scheme: s.color_scheme %}">
  <div class="page-width">
    <div class="k-section__head k-section__head--center">
      {%- if s.eyebrow != blank -%}<p class="k-eyebrow">{{ s.eyebrow | escape }}</p>{%- endif -%}
      {%- if s.heading != blank -%}<h2 class="k-section__title">{{ s.heading | escape }}</h2>{%- endif -%}
    </div>
    <ul class="k-cshow" role="list" data-colour-showcase>
      {%- for variant in product.variants -%}
        <li>
          <a class="k-cshow__tile" href="#buy" data-pick-colour="{{ variant.option1 | escape }}">
            <span class="k-cshow__img">{%- if variant.featured_image != blank -%}{{ variant.featured_image | image_url: width: 480 | image_tag: loading: 'lazy', widths: '240, 360, 480', sizes: '(min-width: 990px) 15vw, 45vw', alt: variant.option1 }}{%- endif -%}</span>
            <span class="k-cshow__name"><span class="k-cshow__dot" style="{% render 'swatch-style', name: variant.option1 %}"></span>{{ variant.option1 | escape }}</span>
            <span class="k-cshow__cta">{{ s.button_label | escape }}</span>
          </a>
        </li>
      {%- endfor -%}
    </ul>
  </div>
  <script>
    (function () {
      var list = document.currentScript.parentNode.querySelector('[data-colour-showcase]');
      if (!list) return;
      list.addEventListener('click', function (e) {
        var tile = e.target.closest('[data-pick-colour]');
        if (!tile) return;
        var wanted = tile.getAttribute('data-pick-colour');
        var input = Array.prototype.slice.call(document.querySelectorAll('#buy .k-option__input')).filter(function (i) { return i.value === wanted; })[0];
        if (!input) return;
        e.preventDefault();
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        var target = document.getElementById('buy');
        if (target) target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      });
    }());
  </script>
</div>
{%- endif -%}
`,
  css: `
.k-cshow { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 14px; margin: 0; padding: 0; list-style: none; }
.k-cshow__tile { display: grid; gap: 10px; padding: 12px 12px 16px; border: 1px solid var(--v-line); border-radius: var(--round); background: var(--v-card); color: var(--v-ink); text-align: center; text-decoration: none; transition: transform var(--anim), border-color var(--anim), box-shadow var(--anim); }
.k-cshow__tile:hover { transform: translateY(-4px); border-color: var(--v-ink); box-shadow: 0 16px 30px color-mix(in srgb, var(--v-ink) 12%, transparent); color: var(--v-ink); }
.k-cshow__img { display: block; aspect-ratio: 1; border-radius: var(--round-sm); background: var(--v-surface); overflow: hidden; } .k-cshow__img img { width: 100%; height: 100%; object-fit: cover; }
.k-cshow__name { display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 700; }
.k-cshow__dot { width: 14px; height: 14px; border-radius: 50%; border: 1px solid var(--v-line); background-color: var(--v-surface); background-image: linear-gradient(var(--shade), var(--shade)); }
.k-cshow__cta { font-size: .8rem; letter-spacing: .08em; text-transform: uppercase; color: var(--v-muted); }
@media (max-width: 899px) { .k-cshow { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 559px) { .k-cshow { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
`,
};
