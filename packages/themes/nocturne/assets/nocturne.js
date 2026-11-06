/* Nocturne storefront script: vanilla JS, no dependencies. Uses the Ajax cart API and the Section Rendering API. MIT, ShopMe contributors. */
(function () {
  'use strict';
  var C = window.themeConfig || { routes: {}, strings: {} };
  var S = C.strings || {};
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var root = document.documentElement;
  var $ = function (sel, scope) { return (scope || document).querySelector(sel); };
  var $$ = function (sel, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(sel)); };

  function formatMoney(cents, format) {
    var f = format || C.moneyFormat || '${{amount}}';
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
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function json(url, opts) {
    return fetch(url, Object.assign({ headers: { Accept: 'application/json' } }, opts)).then(function (r) {
      return r.json().then(function (body) { return { ok: r.ok, status: r.status, body: body }; });
    });
  }

  /* Customer pages: preselect the country of address forms, confirm destructive actions. */
  $$('select[data-default]').forEach(function (select) {
    var wanted = select.getAttribute('data-default');
    if (wanted) select.value = wanted;
  });
  document.addEventListener('submit', function (e) {
    var message = e.target && e.target.getAttribute && e.target.getAttribute('data-confirm');
    if (message && !window.confirm(message)) e.preventDefault();
  });

  /* Header: state on scroll, navigation drawer, sub-menus */
  var header = $('[data-header]');
  if (header) {
    var onScroll = function () { header.classList.toggle('is-scrolled', window.scrollY > 8); };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    var navToggle = $('[data-nav-toggle]');
    var setNav = function (open) {
      header.classList.toggle('is-open', open);
      root.classList.toggle('has-drawer-open', open);
      if (navToggle) navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    if (navToggle) navToggle.addEventListener('click', function () { setNav(!header.classList.contains('is-open')); });
    $$('[data-nav-overlay]').forEach(function (o) { o.addEventListener('click', function () { setNav(false); }); });
    $$('[data-nav-close]').forEach(function (b) { b.addEventListener('click', function () { setNav(false); if (navToggle) navToggle.focus(); }); });
    $$('[data-sub-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var li = btn.closest('li');
        var open = !li.classList.contains('is-open');
        li.classList.toggle('is-open', open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (header.classList.contains('is-open')) { setNav(false); if (navToggle) navToggle.focus(); return; }
      $$('.is-open[data-nav-item]', header).forEach(function (li) { li.classList.remove('is-open'); });
    });
  }

  /* Cart count and drawer */
  function setCount(n) {
    $$('[data-cart-count]').forEach(function (el) { el.textContent = n; el.classList.toggle('is-empty', !n); });
    $$('[data-cart-label]').forEach(function (el) { if (S.cartCount) el.textContent = S.cartCount.replace('[count]', n); });
  }
  function refreshCount() { return json(C.routes.cartJson).then(function (r) { setCount(r.body.item_count); return r.body; }); }
  var drawer = $('[data-cart-drawer]');
  var lastFocus = null;
  function focusables(el) { return $$('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])', el).filter(function (n) { return n.offsetParent !== null; }); }
  function openDrawer() {
    if (!drawer) return;
    lastFocus = document.activeElement;
    drawer.classList.add('is-open');
    drawer.removeAttribute('inert');
    drawer.setAttribute('aria-hidden', 'false');
    root.classList.add('has-cart-open');
    var close = $('[data-cart-drawer-close]', drawer);
    if (close) close.focus();
  }
  function closeDrawer() {
    if (!drawer) return;
    drawer.classList.remove('is-open');
    drawer.setAttribute('inert', '');
    drawer.setAttribute('aria-hidden', 'true');
    root.classList.remove('has-cart-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function swapDrawer(html) {
    if (!drawer || !html) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    var next = $('[data-cart-drawer-content]', tmp);
    var cur = $('[data-cart-drawer-content]', drawer);
    if (next && cur) cur.innerHTML = next.innerHTML;
  }
  if (drawer) {
    drawer.setAttribute('inert', '');
    drawer.addEventListener('click', function (e) {
      if (e.target.closest('[data-cart-drawer-close]') || e.target.hasAttribute('data-cart-drawer-overlay')) closeDrawer();
    });
    drawer.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeDrawer(); return; }
      if (e.key !== 'Tab') return;
      var f = focusables(drawer);
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    document.addEventListener('click', function (e) {
      var link = e.target.closest('[data-cart-open]');
      if (!link || C.cartType !== 'drawer') return;
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      openDrawer();
    });
    window.addEventListener('pageshow', function (ev) { if (ev.persisted) refreshCount(); });
  }

  /* Cart changes (cart page and drawer share the same controls) */
  var cartPage = $('[data-cart-section]');
  function change(line, quantity, scope) {
    if (scope) scope.classList.add('is-loading');
    var ids = ['cart-drawer'];
    var pageId = cartPage ? cartPage.getAttribute('data-section-id') : '';
    if (pageId) ids.push(pageId);
    var payload = { line: Number(line), quantity: Number(quantity), sections: ids.join(','), sections_url: C.routes.cart };
    return json(C.routes.cartChange, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) {
        if (!r.ok || !r.body.sections) { window.location.reload(); return; }
        swapDrawer(r.body.sections['cart-drawer']);
        if (pageId && r.body.sections[pageId]) {
          var wrapper = document.getElementById('shopify-section-' + pageId);
          if (wrapper) wrapper.outerHTML = r.body.sections[pageId];
        }
        setCount(r.body.item_count);
        document.dispatchEvent(new CustomEvent('theme:cart-updated'));
      })
      .catch(function () { window.location.reload(); });
  }
  document.addEventListener('click', function (e) {
    var step = e.target.closest('[data-qty-step]');
    var remove = e.target.closest('[data-remove-line]');
    if (step) {
      var scope = step.closest('[data-cart-scope]');
      var input = $('[data-line-qty][data-line="' + step.getAttribute('data-line') + '"]', scope || document);
      if (input) change(step.getAttribute('data-line'), Math.max(0, Number(input.value) + Number(step.getAttribute('data-qty-step'))), scope);
    } else if (remove) {
      e.preventDefault();
      change(remove.getAttribute('data-remove-line'), 0, remove.closest('[data-cart-scope]'));
    }
  });
  document.addEventListener('change', function (e) {
    var input = e.target.closest ? e.target.closest('[data-line-qty]') : null;
    if (input) change(input.getAttribute('data-line'), Math.max(0, Number(input.value) || 0), input.closest('[data-cart-scope]'));
  });

  /* The order note is saved as soon as it changes */
  document.addEventListener('change', function (e) {
    if (!e.target.matches || !e.target.matches('textarea[name="note"]')) return;
    json('/cart/update.js', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ note: e.target.value }) }).catch(function () {});
  });

  /* Add to cart (product page and quick add on cards) */
  function addToCart(form, button, message) {
    if (button) { button.disabled = true; button.classList.add('is-loading'); }
    if (message) { message.textContent = ''; message.classList.remove('is-error'); }
    var body = new FormData(form);
    body.append('sections', 'cart-drawer');
    return fetch(C.routes.cartAdd, { method: 'POST', body: body, headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (r) {
        if (r.ok) {
          if (r.body.sections) swapDrawer(r.body.sections['cart-drawer']);
          return refreshCount().then(function () {
            if (C.cartType === 'drawer' && drawer) openDrawer();
            else if (message) {
              message.textContent = '';
              var a = document.createElement('a');
              a.href = C.routes.cart; a.textContent = S.viewCart || 'View cart';
              message.appendChild(document.createTextNode((S.added || '') + ' · '));
              message.appendChild(a);
            }
          });
        }
        if (message) { message.textContent = r.body.description || r.body.message || S.error; message.classList.add('is-error'); }
        return refreshCount();
      })
      .catch(function () { if (message) { message.textContent = S.error; message.classList.add('is-error'); } })
      .then(function () { if (button) { button.classList.remove('is-loading'); button.disabled = false; } });
  }
  $$('form[data-quick-add]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = $('button[type="submit"]', form);
      addToCart(form, btn, null).then(function () { if (btn) { btn.classList.add('is-added'); setTimeout(function () { btn.classList.remove('is-added'); }, 1600); } });
    });
  });

  /* Sort and filter forms */
  $$('form[data-auto-submit]').forEach(function (form) {
    var timer;
    form.addEventListener('change', function (e) {
      if (!e.target.matches('select, input[type="checkbox"], input[type="radio"], input[type="number"]')) return;
      clearTimeout(timer);
      timer = setTimeout(function () { if (form.requestSubmit) form.requestSubmit(); else form.submit(); }, e.target.type === 'number' ? 500 : 0);
    });
  });
  var filters = $('[data-filters]');
  if (filters) {
    var setFilters = function (open) { filters.classList.toggle('is-open', open); root.classList.toggle('has-filters-open', open); $$('[data-filters-toggle]').forEach(function (b) { b.setAttribute('aria-expanded', open ? 'true' : 'false'); }); };
    $$('[data-filters-toggle]').forEach(function (b) { b.addEventListener('click', function () { setFilters(!filters.classList.contains('is-open')); }); });
    $$('[data-filters-close]').forEach(function (b) { b.addEventListener('click', function () { setFilters(false); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && filters.classList.contains('is-open')) setFilters(false); });
  }

  /* Product page: options, availability, purchase options, gallery, quantity, add to cart */
  $$('[data-product-section]').forEach(function (section) {
    var dataEl = $('[data-product-json]', section);
    var form = $('form.product-form', section);
    if (!dataEl || !form) return;
    var product = JSON.parse(dataEl.textContent);
    var idInput = $('[data-variant-id]', form);
    var button = $('[data-add-to-cart]', form);
    var label = $('[data-add-label]', form);
    var message = $('[data-form-message]', form);
    var priceBox = $('[data-product-price]', section);
    var skuBox = $('[data-sku]', section);
    var stateBox = $('[data-availability]', section);
    var single = section.hasAttribute('data-gallery-single');
    var variantMedia = {};
    try { variantMedia = JSON.parse($('[data-variant-media]', section).textContent); } catch (err) { variantMedia = {}; }

    function fieldsets() { return $$('fieldset.option', form); }
    function selectedOptions() {
      return fieldsets().map(function (fs) { var c = $('input:checked', fs); return c ? c.value : null; });
    }
    function matches(v, sel, skip) { return sel.every(function (o, i) { return i === skip || o === null || v.options[i] === o; }); }
    function currentVariant() {
      var sel = selectedOptions();
      if (!sel.length) return product.variants[0];
      return product.variants.filter(function (v) { return matches(v, sel, -1); })[0] || null;
    }
    function markAvailability() {
      var sel = selectedOptions();
      fieldsets().forEach(function (fs, i) {
        $$('input.option__input', fs).forEach(function (input) {
          var probe = sel.slice(); probe[i] = input.value;
          var exists = product.variants.some(function (v) { return matches(v, probe, -1); });
          var available = product.variants.some(function (v) { return v.available && matches(v, probe, -1); });
          var lab = $('label[for="' + input.id + '"]', fs);
          if (lab) { lab.classList.toggle('is-unavailable', exists && !available); lab.classList.toggle('is-missing', !exists); }
        });
      });
    }
    var plansBox = $('[data-purchase-options]', form);
    var planInput = $('[data-selling-plan-input]', form);
    function selectedPlanId() {
      if (!plansBox) return null;
      var checked = $('[data-purchase-option]:checked', plansBox);
      if (!checked || !checked.value) return null;
      var select = $('[data-plan-select][data-group-id="' + checked.value + '"]', plansBox);
      return select ? select.value : null;
    }
    function allocationFor(v, planId) {
      return (v && planId && (v.selling_plan_allocations || []).filter(function (a) { return String(a.selling_plan.id) === String(planId); })[0]) || null;
    }
    function updatePlans(v) {
      if (!plansBox || !v) return;
      var checked = $('[data-purchase-option]:checked', plansBox);
      $$('[data-group-plans]', plansBox).forEach(function (box) { box.hidden = !checked || checked.value !== box.getAttribute('data-group-plans'); });
      var oneTime = $('[data-one-time-price]', plansBox);
      if (oneTime) oneTime.textContent = formatMoney(v.price);
      $$('[data-plan-select]', plansBox).forEach(function (select) {
        var group = select.getAttribute('data-group-id');
        var a = allocationFor(v, select.value);
        var priceEl = $('[data-group-price="' + group + '"]', plansBox);
        var saveEl = $('[data-group-save="' + group + '"]', plansBox);
        if (priceEl) priceEl.textContent = a ? S.perDelivery.replace('[price]', formatMoney(a.per_delivery_price)) : '';
        if (saveEl) {
          var pct = a && a.compare_at_price > a.price ? Math.floor((a.compare_at_price - a.price) * 100 / a.compare_at_price) : 0;
          saveEl.hidden = !pct;
          saveEl.textContent = pct ? S.savePercent.replace('[percent]', pct) : '';
        }
      });
      if (planInput) planInput.value = selectedPlanId() || '';
    }
    function renderPrice(v) {
      if (!priceBox || !v) return;
      var a = allocationFor(v, selectedPlanId());
      var price = a ? a.price : v.price;
      var compare = a ? a.compare_at_price : v.compare_at_price;
      var sale = compare && compare > price;
      priceBox.innerHTML = '<div class="price price--large' + (sale ? ' price--on-sale' : '') + '">' +
        (sale ? '<s class="price__compare">' + formatMoney(compare) + '</s> ' : '') +
        '<span class="price__current">' + formatMoney(price) + '</span></div>';
    }
    function showMedia(id) {
      var el = $('[data-media][data-media-id="' + id + '"]', section);
      if (!el) return;
      if (single) {
        $$('[data-media]', section).forEach(function (m) { m.classList.toggle('is-active', m === el); });
        $$('[data-thumb]', section).forEach(function (t) { t.classList.toggle('is-active', t.getAttribute('data-media-id') === String(id)); t.setAttribute('aria-current', t.getAttribute('data-media-id') === String(id) ? 'true' : 'false'); });
      } else if (el.scrollIntoView) {
        el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest', inline: 'center' });
      }
    }
    function update(fromUser) {
      var v = currentVariant();
      markAvailability();
      if (!v) {
        if (button) button.disabled = true;
        if (label) label.textContent = S.unavailable;
        if (stateBox) { stateBox.textContent = S.unavailable; stateBox.setAttribute('data-state', 'unavailable'); }
        return;
      }
      if (idInput) idInput.value = v.id;
      if (button) button.disabled = !v.available;
      if (label) label.textContent = v.available ? S.addToCart : S.soldOut;
      if (stateBox) { stateBox.textContent = v.available ? S.inStock : S.soldOut; stateBox.setAttribute('data-state', v.available ? 'in' : 'out'); }
      if (skuBox) { skuBox.textContent = v.sku || ''; var row = skuBox.closest('[data-sku-row]'); if (row) row.hidden = !v.sku; }
      updatePlans(v);
      renderPrice(v);
      if (fromUser && variantMedia[v.id]) showMedia(variantMedia[v.id]);
      var url = new URL(window.location.href);
      url.searchParams.set('variant', v.id);
      var plan = selectedPlanId();
      if (plan) url.searchParams.set('selling_plan', plan); else url.searchParams.delete('selling_plan');
      window.history.replaceState({}, '', url);
    }
    form.addEventListener('change', function (e) {
      if (e.target.matches('.option__input, [data-purchase-option], [data-plan-select]')) update(true);
    });
    $$('[data-thumb]', section).forEach(function (t) {
      t.addEventListener('click', function () { showMedia(t.getAttribute('data-media-id')); });
    });
    var qty = $('[data-qty-input]', form);
    $$('[data-qty-inc], [data-qty-dec]', form).forEach(function (b) {
      b.addEventListener('click', function () {
        var n = Math.max(1, (parseInt(qty.value, 10) || 1) + (b.hasAttribute('data-qty-inc') ? 1 : -1));
        qty.value = n;
      });
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (button && button.disabled) return;
      addToCart(form, button, message).then(function () { update(false); });
    });
    update(false);
  });

  /* Recommendations: the section is fetched with the product it is about */
  $$('[data-recommendations]').forEach(function (el) {
    var u = el.getAttribute('data-url');
    if (!u || el.getAttribute('data-loaded')) return;
    fetch(u, { headers: { Accept: 'text/html' } })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (html) {
        if (!html) return;
        var tmp = document.createElement('div');
        tmp.innerHTML = html;
        var next = $('[data-recommendations]', tmp);
        if (next && $('[data-recommendations-list] li', next)) {
          el.innerHTML = next.innerHTML;
          el.setAttribute('data-loaded', 'true');
          el.hidden = false;
        }
      })
      .catch(function () {});
  });

  /* Predictive search: header toggle, debounced /search/suggest.json, keyboard navigation */
  var panel = $('[data-predictive-search]');
  if (panel && !(C.search && C.search.predictive === false)) {
    var toggles = $$('[data-search-toggle]');
    var limit = parseInt(panel.getAttribute('data-limit') || '4', 10) || 4;
    var showImage = panel.getAttribute('data-show-image') !== 'false';
    var showPrice = panel.getAttribute('data-show-price') !== 'false';
    var input = $('[data-predictive-input]', panel);
    var out = $('[data-predictive-results]', panel);
    var labels = {};
    try { labels = JSON.parse(out.getAttribute('data-labels') || '{}'); } catch (err) { labels = {}; }
    var timer, ctrl, cache = {};
    var open = function (show) {
      panel.hidden = !show;
      root.classList.toggle('has-search-open', show);
      toggles.forEach(function (t) { t.setAttribute('aria-expanded', show ? 'true' : 'false'); });
      if (show) input.focus();
    };
    var group = function (title, items) { return items.length ? '<div class="predictive-search__group"><h3>' + esc(title) + '</h3><ul>' + items.join('') + '</ul></div>' : ''; };
    var row = function (href, inner) { return '<li><a class="predictive-search__item" role="option" href="' + esc(href) + '">' + inner + '</a></li>'; };
    var render = function (r, term) {
      var res = (r && r.resources && r.resources.results) || {};
      var html = '';
      html += group(labels.queries, (res.queries || []).map(function (q) { return row(q.url, '<span>' + (q.styled_text || esc(q.text)) + '</span>'); }));
      html += group(labels.products, (res.products || []).map(function (p) {
        return row(p.url, (showImage && p.image ? '<img src="' + esc(p.image) + '" alt="" loading="lazy" width="48" height="48">' : '') + '<span>' + esc(p.title) + (showPrice ? '<span class="predictive-search__price">' + esc(C.currency || '') + ' ' + esc(p.price) + '</span>' : '') + '</span>');
      }));
      html += group(labels.collections, (res.collections || []).map(function (c) { return row(c.url, '<span>' + esc(c.title) + '</span>'); }));
      html += group(labels.articles, (res.articles || []).map(function (a) { return row(a.url, '<span>' + esc(a.title) + '</span>'); }));
      html += group(labels.pages, (res.pages || []).map(function (p) { return row(p.url, '<span>' + esc(p.title) + '</span>'); }));
      var empty = !html;
      out.innerHTML = empty ? '<p class="empty">' + esc((labels.none || '').replace('{terms}', term)) + '</p>'
        : html + '<div class="predictive-search__group"><a class="predictive-search__item predictive-search__all" href="' + esc(C.routes.search || '/search') + '?q=' + encodeURIComponent(term) + '">' + esc((labels.all || '').replace('{terms}', term)) + '</a></div>';
      input.setAttribute('aria-expanded', empty ? 'false' : 'true');
    };
    var query = function () {
      var term = input.value.trim();
      if (!term) { out.innerHTML = ''; input.setAttribute('aria-expanded', 'false'); return; }
      if (cache[term]) return render(cache[term], term);
      if (ctrl) ctrl.abort();
      ctrl = window.AbortController ? new AbortController() : null;
      var u = (panel.getAttribute('data-url') || '/search/suggest') + '.json?q=' + encodeURIComponent(term) + '&resources[type]=query,product,collection,article,page&resources[limit]=' + limit + '&resources[options][fields]=title,product_type,variants.title,vendor';
      fetch(u, { headers: { Accept: 'application/json' }, signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { return r.json(); })
        .then(function (j) { cache[term] = j; if (input.value.trim() === term) render(j, term); })
        .catch(function () {});
    };
    toggles.forEach(function (t) { t.addEventListener('click', function (e) { e.preventDefault(); open(panel.hidden); }); });
    $$('[data-search-close]', panel).forEach(function (b) { b.addEventListener('click', function () { open(false); if (toggles[0]) toggles[0].focus(); }); });
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(query, 180); });
    panel.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { open(false); if (toggles[0]) toggles[0].focus(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      var links = $$('a', out);
      if (!links.length) return;
      e.preventDefault();
      var i = links.indexOf(document.activeElement);
      var next = e.key === 'ArrowDown' ? (i + 1) % links.length : (i <= 0 ? -1 : i - 1);
      if (next < 0) input.focus(); else links[next].focus();
    });
  }

  /* Carousels (scroll-snap lists with previous/next buttons) */
  $$('[data-carousel]').forEach(function (list) {
    var scope = list.closest('.shopify-section') || document;
    function step(dir) {
      var item = list.firstElementChild;
      var w = item ? item.getBoundingClientRect().width + 20 : list.clientWidth;
      list.scrollBy({ left: dir * w, behavior: reduce ? 'auto' : 'smooth' });
    }
    $$('[data-carousel-prev]', scope).forEach(function (b) { b.addEventListener('click', function () { step(-1); }); });
    $$('[data-carousel-next]', scope).forEach(function (b) { b.addEventListener('click', function () { step(1); }); });
  });

  /* Slideshows */
  $$('[data-slideshow]').forEach(function (sl) {
    var track = $('[data-slideshow-track]', sl);
    var slides = track ? Array.prototype.slice.call(track.children) : [];
    if (slides.length < 2) return;
    var dots = $$('[data-slideshow-dot]', sl);
    var index = 0, timer = null;
    function mark() { dots.forEach(function (d, n) { d.setAttribute('aria-current', n === index ? 'true' : 'false'); }); }
    function go(i) {
      index = (i + slides.length) % slides.length;
      track.scrollTo({ left: slides[index].offsetLeft - track.offsetLeft, behavior: reduce ? 'auto' : 'smooth' });
      mark();
    }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    function start() {
      stop();
      if (sl.getAttribute('data-autoplay') !== 'true' || reduce) return;
      timer = setInterval(function () { go(index + 1); }, Math.max(2000, parseInt(sl.getAttribute('data-interval') || '6000', 10)));
    }
    var prev = $('[data-slideshow-prev]', sl), next = $('[data-slideshow-next]', sl);
    if (prev) prev.addEventListener('click', function () { go(index - 1); start(); });
    if (next) next.addEventListener('click', function () { go(index + 1); start(); });
    dots.forEach(function (d, n) { d.addEventListener('click', function () { go(n); start(); }); });
    track.addEventListener('scroll', function () {
      var best = 0, dist = Infinity;
      slides.forEach(function (s, n) { var d = Math.abs(s.offsetLeft - track.offsetLeft - track.scrollLeft); if (d < dist) { dist = d; best = n; } });
      if (best !== index) { index = best; mark(); }
    }, { passive: true });
    sl.addEventListener('mouseenter', stop); sl.addEventListener('mouseleave', start);
    sl.addEventListener('focusin', stop); sl.addEventListener('focusout', start);
    mark(); start();
  });

  /* Scroll reveal */
  if (C.reveal && 'IntersectionObserver' in window && !reduce) {
    var targets = $$('main .shopify-section').slice(1);
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    targets.forEach(function (t) { t.classList.add('reveal'); io.observe(t); });
  }

  /* Popup */
  $$('[data-popup]').forEach(function (popup) {
    var key = 'nocturne-popup:' + popup.getAttribute('data-key');
    var preview = popup.hasAttribute('data-preview');
    var days = parseInt(popup.getAttribute('data-days') || '7', 10);
    try { var until = parseInt(window.localStorage.getItem(key) || '0', 10); if (!preview && until > Date.now()) return; } catch (err) { /* storage blocked: show it */ }
    function hide() {
      popup.hidden = true;
      document.removeEventListener('keydown', onKey);
      try { window.localStorage.setItem(key, String(Date.now() + days * 86400000)); } catch (err) { /* ignore */ }
    }
    function onKey(e) { if (e.key === 'Escape') hide(); }
    var delay = preview ? 0 : Math.max(0, parseInt(popup.getAttribute('data-delay') || '0', 10)) * 1000;
    setTimeout(function () {
      popup.hidden = false;
      document.addEventListener('keydown', onKey);
      var close = $('[data-popup-close]', popup);
      if (close) close.focus();
    }, delay);
    popup.addEventListener('click', function (e) { if (e.target === popup) hide(); });
    var closeBtn = $('[data-popup-close]', popup);
    if (closeBtn) closeBtn.addEventListener('click', hide);
  });
}());
