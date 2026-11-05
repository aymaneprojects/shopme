/* Aurora: small vanilla JS (no dependencies). Talks to the Ajax cart API and the Section Rendering API. */
/* Customer pages: preselect the country of address forms, confirm address deletion. */
(function () {
  'use strict';
  document.querySelectorAll('select[data-default]').forEach(function (select) {
    var wanted = select.getAttribute('data-default');
    if (wanted) select.value = wanted;
  });
  document.addEventListener('submit', function (e) {
    var message = e.target && e.target.getAttribute && e.target.getAttribute('data-confirm');
    if (message && !window.confirm(message)) e.preventDefault();
  });
}());

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

/* Predictive search: header toggle, debounced /search/suggest.json (products, collections, pages, articles, queries), keyboard navigation. */
(function () {
  'use strict';
  var panel = document.querySelector('[data-predictive-search]');
  if (!panel) return;
  var toggle = document.querySelector('[data-search-toggle]');
  var input = panel.querySelector('[data-predictive-input]');
  var out = panel.querySelector('[data-predictive-results]');
  var labels = {};
  try { labels = JSON.parse(out.getAttribute('data-labels') || '{}'); } catch (e) { labels = {}; }
  var A = window.aurora || {};
  var timer, ctrl, cache = {};

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function open(show) {
    panel.hidden = !show;
    if (toggle) toggle.setAttribute('aria-expanded', show ? 'true' : 'false');
    if (show) input.focus();
  }
  function group(title, items) {
    return items.length ? '<div class="predictive-search__group"><h3>' + esc(title) + '</h3><ul>' + items.join('') + '</ul></div>' : '';
  }
  function row(url, inner) { return '<li><a class="predictive-search__item" role="option" href="' + esc(url) + '">' + inner + '</a></li>'; }
  function render(r, term) {
    var res = (r && r.resources && r.resources.results) || {};
    var html = '';
    html += group(labels.queries, (res.queries || []).map(function (q) { return row(q.url, '<span>' + (q.styled_text || esc(q.text)) + '</span>'); }));
    html += group(labels.products, (res.products || []).map(function (p) {
      return row(p.url, (p.image ? '<img src="' + esc(p.image) + '" alt="" loading="lazy" width="44" height="44">' : '') + '<span>' + esc(p.title) + '<br><span class="predictive-search__price">' + esc(A.currency || '') + ' ' + esc(p.price) + '</span></span>');
    }));
    html += group(labels.collections, (res.collections || []).map(function (c) { return row(c.url, '<span>' + esc(c.title) + '</span>'); }));
    html += group(labels.articles, (res.articles || []).map(function (a) { return row(a.url, '<span>' + esc(a.title) + '</span>'); }));
    html += group(labels.pages, (res.pages || []).map(function (p) { return row(p.url, '<span>' + esc(p.title) + '</span>'); }));
    var empty = !html;
    out.innerHTML = empty ? '<p class="empty">' + esc((labels.none || '').replace('{terms}', term)) + '</p>'
      : html + '<div class="predictive-search__group"><a class="predictive-search__item" href="/search?q=' + encodeURIComponent(term) + '">' + esc((labels.all || '').replace('{terms}', term)) + '</a></div>';
    input.setAttribute('aria-expanded', empty ? 'false' : 'true');
  }
  function query() {
    var term = input.value.trim();
    if (!term) { out.innerHTML = ''; input.setAttribute('aria-expanded', 'false'); return; }
    if (cache[term]) return render(cache[term], term);
    if (ctrl) ctrl.abort();
    ctrl = window.AbortController ? new AbortController() : null;
    var url = (panel.getAttribute('data-url') || '/search/suggest') + '.json?q=' + encodeURIComponent(term) + '&resources[type]=query,product,collection,article,page&resources[limit]=4&resources[options][fields]=title,product_type,variants.title,vendor';
    fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { return r.json(); })
      .then(function (j) { cache[term] = j; if (input.value.trim() === term) render(j, term); })
      .catch(function () {});
  }
  if (toggle) toggle.addEventListener('click', function (e) { e.preventDefault(); open(panel.hidden); });
  input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(query, 180); });
  panel.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { open(false); if (toggle) toggle.focus(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    var links = Array.prototype.slice.call(out.querySelectorAll('a'));
    if (!links.length) return;
    e.preventDefault();
    var i = links.indexOf(document.activeElement);
    var next = e.key === 'ArrowDown' ? (i + 1) % links.length : (i <= 0 ? -1 : i - 1);
    if (next < 0) input.focus(); else links[next].focus();
  });
}());
