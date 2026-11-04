/* Aurora: small vanilla JS (no dependencies). Talks to the Ajax cart API and the Section Rendering API. */
(function () {
  'use strict';
  var A = window.aurora || {};

  function formatMoney(cents, format) {
    var f = format || A.moneyFormat || '${{amount}}';
    function num(thousand, decimal, digits) {
      var p = (Math.abs(cents) / 100).toFixed(digits).split('.');
      p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, thousand);
      return (cents < 0 ? '-' : '') + p[0] + (digits ? decimal + p[1] : '');
    }
    return f.replace(/\{\{\s*(\w+)\s*\}\}/g, function (m, k) {
      switch (k) {
        case 'amount': return num(',', '.', 2);
        case 'amount_no_decimals': return num(',', '.', 0);
        case 'amount_with_comma_separator': return num('.', ',', 2);
        case 'amount_no_decimals_with_comma_separator': return num('.', ',', 0);
        case 'amount_with_apostrophe_separator': return num("'", '.', 2);
        case 'amount_with_space_separator': return num(' ', ',', 2);
        default: return m;
      }
    });
  }

  function json(url, opts) {
    return fetch(url, Object.assign({ headers: { Accept: 'application/json' } }, opts)).then(function (r) {
      return r.json().then(function (body) { return { ok: r.ok, status: r.status, body: body }; });
    });
  }

  function setCount(n) {
    document.querySelectorAll('[data-cart-count]').forEach(function (el) {
      el.textContent = n;
      el.classList.toggle('is-empty', !n);
    });
  }
  function refreshCount() { return json(A.routes.cartJson).then(function (r) { setCount(r.body.item_count); }); }

  /* Mobile navigation */
  var toggle = document.querySelector('[data-nav-toggle]');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var header = document.querySelector('[data-header]');
      var open = header.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  /* Auto-submit sort and filter selects */
  document.querySelectorAll('form[data-auto-submit] select').forEach(function (s) {
    s.addEventListener('change', function () { s.form.submit(); });
  });

  /* Product page: variant selection and add to cart */
  document.querySelectorAll('[data-product-section]').forEach(function (root) {
    var dataEl = root.querySelector('[data-product-json]');
    var form = root.querySelector('form.product-form');
    if (!dataEl || !form) return;
    var product = JSON.parse(dataEl.textContent);
    var idInput = form.querySelector('[data-variant-id]');
    var button = form.querySelector('[data-add-to-cart]');
    var label = form.querySelector('[data-add-label]');
    var message = form.querySelector('[data-form-message]');
    var priceBox = root.querySelector('[data-product-price]');
    var mainImage = root.querySelector('[data-main-image] img');

    function selectedOptions() {
      return Array.prototype.map.call(form.querySelectorAll('fieldset.option'), function (fs) {
        var checked = fs.querySelector('input:checked');
        return checked ? checked.value : null;
      });
    }
    function currentVariant() {
      var sel = selectedOptions();
      if (!sel.length) return product.variants[0];
      return product.variants.filter(function (v) { return sel.every(function (o, i) { return v.options[i] === o; }); })[0];
    }
    function renderPrice(v) {
      if (!priceBox || !v) return;
      var sale = v.compare_at_price && v.compare_at_price > v.price;
      priceBox.innerHTML = '<div class="price price--large' + (sale ? ' price--on-sale' : '') + '">' +
        (sale ? '<s class="price__compare">' + formatMoney(v.compare_at_price) + '</s>' : '') +
        '<span class="price__current">' + formatMoney(v.price) + '</span></div>';
    }
    function update() {
      var v = currentVariant();
      if (!v) { button.disabled = true; label.textContent = A.strings.soldOut; return; }
      idInput.value = v.id;
      button.disabled = !v.available;
      label.textContent = v.available ? A.strings.addToCart : A.strings.soldOut;
      renderPrice(v);
      if (v.featured_image && mainImage) { mainImage.removeAttribute('srcset'); mainImage.src = v.featured_image.src; }
      var url = new URL(window.location.href);
      url.searchParams.set('variant', v.id);
      window.history.replaceState({}, '', url);
    }
    form.addEventListener('change', function (e) { if (e.target.matches('.option__input')) update(); });
    root.querySelectorAll('[data-thumb]').forEach(function (t) {
      t.addEventListener('click', function () {
        if (mainImage) { mainImage.removeAttribute('srcset'); mainImage.src = t.getAttribute('data-src'); }
        root.querySelectorAll('[data-thumb]').forEach(function (x) { x.classList.toggle('is-active', x === t); });
      });
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (button.disabled) return;
      message.textContent = '';
      message.classList.remove('is-error');
      button.disabled = true;
      var body = new FormData(form);
      fetch(A.routes.cartAdd, { method: 'POST', body: body, headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
        .then(function (r) {
          if (r.ok) {
            message.innerHTML = A.strings.added + ' &middot; <a href="' + A.routes.cart + '"></a>';
            message.querySelector('a').textContent = document.documentElement.lang === 'fr' ? 'Voir le panier' : 'View cart';
            return refreshCount();
          }
          message.textContent = r.body.description || r.body.message || A.strings.error;
          message.classList.add('is-error');
          return refreshCount();
        })
        .catch(function () { message.textContent = A.strings.error; message.classList.add('is-error'); })
        .then(function () { update(); });
    });
  });

  /* Cart page: change quantities through the Ajax API and swap the section HTML from the response */
  var cartRoot = document.querySelector('[data-cart-section]');
  if (cartRoot) {
    var sectionId = cartRoot.getAttribute('data-section-id');
    var change = function (line, quantity) {
      cartRoot.classList.add('is-loading');
      var payload = { line: Number(line), quantity: Number(quantity), sections: sectionId, sections_url: A.routes.cart };
      return json(A.routes.cartChange, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload) })
        .then(function (r) {
          if (r.ok && r.body.sections && r.body.sections[sectionId]) {
            var wrapper = document.getElementById('shopify-section-' + sectionId);
            if (wrapper) wrapper.outerHTML = r.body.sections[sectionId];
            setCount(r.body.item_count);
            document.dispatchEvent(new CustomEvent('aurora:cart-updated'));
          } else { window.location.reload(); }
        })
        .catch(function () { window.location.reload(); });
    };
    document.addEventListener('click', function (e) {
      var step = e.target.closest('[data-qty-step]');
      var remove = e.target.closest('[data-remove-line]');
      if (step) {
        var input = document.querySelector('[data-line-qty][data-line="' + step.getAttribute('data-line') + '"]');
        change(step.getAttribute('data-line'), Math.max(0, Number(input.value) + Number(step.getAttribute('data-qty-step'))));
      } else if (remove) {
        e.preventDefault();
        change(remove.getAttribute('data-remove-line'), 0);
      }
    });
    document.addEventListener('change', function (e) {
      var input = e.target.closest('[data-line-qty]');
      if (input) change(input.getAttribute('data-line'), Math.max(0, Number(input.value) || 0));
    });
  }
}());
