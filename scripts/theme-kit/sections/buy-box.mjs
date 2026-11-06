// Buy box (single-product stores): the product page on the home page. Gallery, colour swatches, quantity, add to cart,
// purchase options and a sticky add to cart bar that appears once the buy button has scrolled out of view.
const t = (en, fr) => ({ en, fr });
const ICONS = ['truck', 'shield', 'refresh', 'leaf', 'heart', 'check', 'package', 'gift', 'clock', 'sparkle', 'drop', 'tag'].map((v) => ({ value: v, label: t(v[0].toUpperCase() + v.slice(1), v[0].toUpperCase() + v.slice(1)) }));
export default {
  id: 'buy-box',
  name: t('Buy box', 'Bloc d’achat'),
  settings: [
    { id: 'product', type: 'product', label: t('Product (the first product of the shop when empty)', 'Produit (le premier produit de la boutique si vide)') },
    { id: 'eyebrow', type: 'text', label: t('Eyebrow', 'Sur-titre'), default: t('The one bottle', 'La gourde unique') },
    { id: 'rating_text', type: 'text', label: t('Rating line', 'Ligne de notation'), default: t('4.9 out of 5, from 1,200 reviews', '4,9 sur 5, d’après 1 200 avis') },
    { id: 'text', type: 'text', label: t('Short text (the product description when empty)', 'Texte court (la description du produit si vide)') },
    { id: 'payment_note', type: 'text', label: t('Note under the button', 'Note sous le bouton'), default: t('Safe checkout. Ships in 24 hours.', 'Règlement protégé. Expédié sous 24 heures.') },
    { id: 'sticky_bar', type: 'checkbox', label: t('Sticky add to cart bar', 'Barre d’ajout au panier fixe'), default: true },
    { id: 'color_scheme', type: 'color_scheme', label: t('Color scheme', 'Palette de couleurs') },
  ],
  blocks: [{
    type: 'perk',
    name: t('Perk', 'Atout'),
    settings: [
      { id: 'icon', type: 'select', label: t('Icon', 'Icône'), default: 'truck', options: ICONS },
      { id: 'text', type: 'text', label: t('Text', 'Texte'), default: t('Free delivery', 'Livraison offerte') },
    ],
  }],
  max_blocks: 4,
  presets: [{ name: t('Buy box', 'Bloc d’achat'), blocks: [{ type: 'perk' }, { type: 'perk' }, { type: 'perk' }] }],
  liquid: `{%- liquid
  assign s = section.settings
  assign product = s.product | default: collections.all.products.first
  assign current = product.selected_or_first_available_variant
  assign first_image = current.featured_image | default: product.featured_image
  assign first_alt = first_image.alt | default: product.title
  assign first_focal = ''
  if first_image.presentation.focal_point != blank
    assign first_focal = 'object-position: ' | append: first_image.presentation.focal_point
  endif
  assign swatch_names = settings.swatch_option_names | downcase | split: ','
  assign form_id = 'buy-form-' | append: section.id
-%}
{%- if product != blank -%}
<div id="buy" class="k-buybox {% render 'scheme-class', scheme: s.color_scheme %}" data-product-section data-section-id="{{ section.id }}">
  <div class="page-width k-pdp k-pdp--left">
    <div class="k-pdp__grid">
      {% render 'product-gallery', product: product, first_image: first_image, first_alt: first_alt, first_focal: first_focal, show_badge: true %}
      <div class="k-info k-buybox__info">
        {%- if s.eyebrow != blank -%}<p class="k-eyebrow">{{ s.eyebrow | escape }}</p>{%- endif -%}
        <h1 class="k-info__title">{{ product.title | escape }}</h1>
        {%- if s.rating_text != blank -%}<p class="k-buybox__rating"><span class="k-buybox__stars" aria-hidden="true">★★★★★</span> {{ s.rating_text | escape }}</p>{%- endif -%}
        <div class="k-info__price" data-product-price>{% render 'price', product: product, variant: current, class: 'k-price--large' %}</div>
        {%- assign summary = s.text | default: product.description | strip_html | truncatewords: 38 -%}
        {%- if summary != blank -%}<div class="k-info__summary rte">{{ summary }}</div>{%- endif -%}
        <p class="k-info__stock k-stock {% if current.available %}k-stock--in{% else %}k-stock--out{% endif %}" data-stock role="status"><span data-stock-label>{% if current.available %}{{ 'products.in_stock' | t }}{% else %}{{ 'products.sold_out' | t }}{% endif %}</span></p>
        {%- if settings.stock_counter -%}
          {%- assign low_limit = settings.stock_threshold | default: 10 -%}
          <p class="k-lowstock" data-lowstock data-limit="{{ low_limit }}" data-template="{{ 'products.low_stock' | t: count: '[count]' | escape }}" role="status"{% unless current.available and current.inventory_management != blank and current.inventory_quantity > 0 and current.inventory_quantity <= low_limit %} hidden{% endunless %}>{{ 'products.low_stock' | t: count: current.inventory_quantity }}</p>
          <script type="application/json" data-stock-json>{ {%- for variant in product.variants -%}"{{ variant.id }}": {% if variant.inventory_management != blank %}{{ variant.inventory_quantity | default: 0 }}{% else %}-1{% endif %}{% unless forloop.last %}, {% endunless %}{%- endfor -%} }</script>
        {%- endif -%}

        {%- form 'product', product, id: form_id, class: 'k-form', novalidate: 'novalidate' -%}
          <input type="hidden" name="id" value="{{ current.id }}" data-variant-id>
          {%- unless product.has_only_default_variant -%}
            {%- for option in product.options_with_values -%}
              {%- assign option_key = option.name | downcase | strip -%}
              {%- assign as_swatch = false -%}
              {%- if settings.swatches_enabled and swatch_names contains option_key -%}{%- assign as_swatch = true -%}{%- endif -%}
              <fieldset class="k-option{% if as_swatch %} k-option--swatch{% endif %}" data-option-index="{{ forloop.index0 }}">
                <legend class="k-legend">{{ option.name | escape }}<span class="k-legend__value" data-option-value>{{ option.selected_value | escape }}</span></legend>
                <div class="k-option__values">
                  {%- for value in option.values -%}
                    <input type="radio" class="k-option__input" id="{{ section.id }}-{{ option.position }}-{{ forloop.index }}" name="options[{{ option.name | escape }}]" value="{{ value | escape }}"{% if option.selected_value == value %} checked{% endif %}>
                    {%- if as_swatch -%}
                      <label class="k-option__label k-option__label--swatch" for="{{ section.id }}-{{ option.position }}-{{ forloop.index }}" style="{% render 'swatch-style', name: value %}" title="{{ value | escape }}"><span class="visually-hidden">{{ value | escape }}</span></label>
                    {%- else -%}
                      <label class="k-option__label" for="{{ section.id }}-{{ option.position }}-{{ forloop.index }}">{{ value | escape }}</label>
                    {%- endif -%}
                  {%- endfor -%}
                </div>
              </fieldset>
            {%- endfor -%}
          {%- endunless -%}

          {% render 'purchase-options', product: product, variant: current, id_prefix: section.id %}

          <div class="k-form__row">
            <div class="k-qty k-qty--lg">
              <label class="visually-hidden" for="{{ section.id }}-qty">{{ 'products.quantity' | t }}</label>
              <button type="button" class="k-qty__btn" data-pdp-step="-1" aria-label="{{ 'products.decrease_quantity' | t }}">{% render 'icon', name: 'minus', size: 16 %}</button>
              <input class="k-qty__input" id="{{ section.id }}-qty" type="number" name="quantity" value="1" min="1" inputmode="numeric">
              <button type="button" class="k-qty__btn" data-pdp-step="1" aria-label="{{ 'products.increase_quantity' | t }}">{% render 'icon', name: 'plus', size: 16 %}</button>
            </div>
            <button type="submit" class="button button--block" name="add" data-add-to-cart{% unless current.available %} disabled{% endunless %}>
              <span data-add-label>{% if current.available %}{{ 'products.add_to_cart' | t }}{% else %}{{ 'products.sold_out' | t }}{% endif %}</span>
            </button>
          </div>
          <p class="k-form__message" role="status" aria-live="polite" data-form-message></p>
        {%- endform -%}
        {%- if s.payment_note != blank -%}<p class="k-buybox__note">{% render 'icon', name: 'shield', size: 16 %} {{ s.payment_note | escape }}</p>{%- endif -%}
        {%- if section.blocks.size > 0 -%}
          <ul class="k-benefits k-buybox__perks" role="list">
            {%- for block in section.blocks -%}<li {{ block.shopify_attributes }}>{% render 'icon', name: block.settings.icon, size: 20 %} <span>{{ block.settings.text | escape }}</span></li>{%- endfor -%}
          </ul>
        {%- endif -%}
      </div>
    </div>
  </div>
  {%- if s.sticky_bar -%}
    <div class="k-sticky" data-sticky-bar hidden>
      <div class="page-width k-sticky__inner">
        {%- if first_image != blank -%}<span class="k-sticky__img" data-sticky-image>{{ first_image | image_url: width: 120 | image_tag: loading: 'lazy', alt: '' }}</span>{%- endif -%}
        <span class="k-sticky__text"><span class="k-sticky__name">{{ product.title | escape }}</span><span class="k-sticky__variant" data-sticky-variant>{{ current.title | escape }}</span></span>
        <span class="k-sticky__price" data-sticky-price>{% render 'price', product: product, variant: current %}</span>
        <button type="submit" form="{{ form_id }}" class="button button--small" data-sticky-add{% unless current.available %} disabled{% endunless %}>{% if current.available %}{{ 'products.add_to_cart' | t }}{% else %}{{ 'products.sold_out' | t }}{% endif %}</button>
      </div>
    </div>
    <script>
      (function () {
        var root = document.currentScript.parentNode;
        var bar = root.querySelector('[data-sticky-bar]');
        var cta = root.querySelector('[data-add-to-cart]');
        var priceBox = root.querySelector('[data-product-price]');
        var priceOut = bar && bar.querySelector('[data-sticky-price]');
        var nameOut = bar && bar.querySelector('[data-sticky-variant]');
        var addOut = bar && bar.querySelector('[data-sticky-add]');
        var imgOut = bar && bar.querySelector('[data-sticky-image] img');
        if (!bar || !cta || !('IntersectionObserver' in window)) return;
        var passed = false;
        new IntersectionObserver(function (entries) {
          var e = entries[0];
          passed = !e.isIntersecting && e.boundingClientRect.top < 0;
          bar.hidden = !passed;
          document.documentElement.classList.toggle('has-sticky-bar', passed);
        }).observe(cta);
        document.addEventListener('product:variant', function (ev) {
          if (!ev.detail || ev.detail.root !== root) return;
          var v = ev.detail.variant;
          if (nameOut) nameOut.textContent = v.title || '';
          if (priceOut && priceBox) priceOut.innerHTML = priceBox.innerHTML;
          if (addOut && cta) { addOut.disabled = cta.disabled; addOut.textContent = (root.querySelector('[data-add-label]') || cta).textContent; }
          if (imgOut && v.featured_image) { imgOut.removeAttribute('srcset'); imgOut.src = v.featured_image.src; }
        });
      }());
    </script>
  {%- endif -%}
  <script type="application/json" data-product-json>{{ product | json }}</script>
</div>
{%- endif -%}
`,
  css: `
.k-buybox { padding-block: 28px 56px; } .k-buybox .k-pdp { padding-top: 12px; }
.k-buybox__info { gap: 16px; }
.k-buybox__rating { display: flex; align-items: center; gap: 8px; margin: 0; font-size: .92rem; color: var(--v-muted); } .k-buybox__stars { color: #e0a21b; letter-spacing: .12em; font-size: 1.05rem; }
.k-buybox__note { display: flex; align-items: center; gap: 8px; margin: 0; font-size: .86rem; color: var(--v-muted); }
.k-buybox__perks { margin-top: 6px; }
.k-sticky { position: fixed; left: 0; right: 0; bottom: 0; z-index: 90; background: var(--v-card); color: var(--v-ink); border-top: 1px solid var(--v-line); box-shadow: 0 -10px 30px color-mix(in srgb, var(--v-ink) 12%, transparent); animation: k-sticky-in var(--anim) ease; } .k-sticky[hidden] { display: none; }
.k-sticky__inner { display: flex; align-items: center; gap: 16px; padding-block: 10px; }
.k-sticky__img { width: 48px; height: 48px; flex-shrink: 0; border-radius: var(--round-sm); overflow: hidden; background: var(--v-surface); } .k-sticky__img img { width: 100%; height: 100%; object-fit: cover; }
.k-sticky__text { display: grid; min-width: 0; margin-right: auto; } .k-sticky__name { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .k-sticky__variant { font-size: .84rem; color: var(--v-muted); }
.k-sticky__price .k-price { margin: 0; font-weight: 700; }
.has-sticky-bar .k-back-top, .has-sticky-bar [data-back-to-top] { bottom: 84px; }
@keyframes k-sticky-in { from { transform: translateY(100%); } }
@media (max-width: 599px) { .k-sticky__img { display: none; } .k-sticky__inner { gap: 10px; } .k-sticky__name { font-size: .9rem; } }
@media (prefers-reduced-motion: reduce) { .k-sticky { animation: none; } }
`,
};
