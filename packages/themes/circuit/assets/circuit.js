/* Circuit: small vanilla JS (no dependencies). Ajax cart API, Section Rendering API, predictive search, filters, compare tray. */
(function () {
  'use strict';
  var C = window.circuit || {};
  var S = C.strings || {};
  var root = document.documentElement;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function store(key, value) {
    try {
      if (value === undefined) return JSON.parse(window.localStorage.getItem(key) || 'null');
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* storage blocked */ }
    return null;
  }

  function formatMoney(cents, format) {
    var f = format || C.moneyFormat || '{{amount}}';
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

  /* Customer pages: preselect the country of address forms, confirm destructive actions. */
  $$('select[data-default]').forEach(function (select) {
    var wanted = select.getAttribute('data-default');
    if (wanted) select.value = wanted;
  });
  document.addEventListener('submit', function (e) {
    var message = e.target && e.target.getAttribute && e.target.getAttribute('data-confirm');
    if (message && !window.confirm(message)) e.preventDefault();
  });

  /* Focus trap for dialogs. */
  function trap(container, e) {
    if (e.key !== 'Tab') return;
    var items = $$('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])', container).filter(function (el) { return el.offsetParent !== null; });
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* ---------- Header: mobile navigation and department mega menu ---------- */
  var header = $('[data-header]');
  var navToggle = $('[data-nav-toggle]');
  if (header && navToggle) {
    var setNav = function (open) {
      header.classList.toggle('is-nav-open', open);
      root.classList.toggle('has-nav-open', open);
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    navToggle.addEventListener('click', function () { setNav(!header.classList.contains('is-nav-open')); });
    $$('[data-nav-overlay], [data-nav-close]', header).forEach(function (el) { el.addEventListener('click', function () { setNav(false); navToggle.focus(); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && header.classList.contains('is-nav-open')) { setNav(false); navToggle.focus(); } });
  }
  var megaBtn = $('[data-mega-toggle]');
  var mega = $('[data-mega]');
  if (megaBtn && mega) {
    var setMega = function (open) {
      mega.classList.toggle('is-open', open);
      megaBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    megaBtn.addEventListener('click', function (e) { e.stopPropagation(); setMega(!mega.classList.contains('is-open')); });
    document.addEventListener('click', function (e) { if (mega.classList.contains('is-open') && !mega.contains(e.target)) setMega(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && mega.classList.contains('is-open')) { setMega(false); megaBtn.focus(); } });
    var navBar = megaBtn.closest('.cx-nav');
    if (navBar && window.matchMedia('(hover: hover) and (min-width: 900px)').matches) {
      var hoverTimer;
      megaBtn.addEventListener('mouseenter', function () { clearTimeout(hoverTimer); setMega(true); });
      navBar.addEventListener('mouseleave', function () { hoverTimer = setTimeout(function () { setMega(false); }, 180); });
      mega.addEventListener('mouseenter', function () { clearTimeout(hoverTimer); });
    }
  }

  /* ---------- Cart: counts, regions and the drawer ---------- */
  function setCount(n) {
    $$('[data-cart-count]').forEach(function (el) { el.textContent = n; el.classList.toggle('is-empty', !n); });
  }
  function refreshCart() {
    var regions = $$('[data-cart-region]');
    var ids = regions.map(function (r) { return r.getAttribute('data-section-id'); }).filter(Boolean);
    return json(C.routes.cartJson).then(function (r) {
      setCount(r.body.item_count);
      if (!ids.length) return null;
      var url = (C.root || '/') + '?sections=' + encodeURIComponent(ids.join(','));
      return fetch(url, { headers: { Accept: 'application/json' } }).then(function (res) { return res.json(); }).then(function (sections) {
        ids.forEach(function (id) {
          var wrap = document.getElementById('shopify-section-' + id);
          if (wrap && sections[id]) wrap.outerHTML = sections[id];
        });
        document.dispatchEvent(new CustomEvent('circuit:cart-updated'));
      });
    });
  }
  function changeLine(line, quantity) {
    $$('[data-cart-region]').forEach(function (r) { r.classList.add('is-loading'); });
    return json(C.routes.cartChange, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ line: Number(line), quantity: Number(quantity) }) })
      .then(refreshCart).catch(function () { window.location.reload(); });
  }
  var drawerTrigger = null;
  function drawerEl() { return $('[data-cart-drawer]'); }
  function openDrawer(from) {
    var d = drawerEl();
    if (!d) return false;
    drawerTrigger = from || document.activeElement;
    root.classList.add('has-cart-open');
    setTimeout(function () { d.focus(); }, reduce ? 0 : 60);
    return true;
  }
  function closeDrawer() {
    if (!root.classList.contains('has-cart-open')) return;
    root.classList.remove('has-cart-open');
    if (drawerTrigger && drawerTrigger.focus) drawerTrigger.focus();
  }
  document.addEventListener('click', function (e) {
    var link = e.target.closest('[data-cart-link]');
    if (link && C.cartType === 'drawer' && drawerEl() && !document.body.classList.contains('template-cart')) { e.preventDefault(); openDrawer(link); return; }
    if (e.target.closest('[data-drawer-close]')) { closeDrawer(); return; }
    var step = e.target.closest('[data-qty-step]');
    var remove = e.target.closest('[data-remove-line]');
    if (step) {
      var input = $('[data-line-qty][data-line="' + step.getAttribute('data-line') + '"]', step.closest('[data-cart-region]') || document);
      changeLine(step.getAttribute('data-line'), Math.max(0, Number(input.value) + Number(step.getAttribute('data-qty-step'))));
    } else if (remove) {
      e.preventDefault();
      changeLine(remove.getAttribute('data-remove-line'), 0);
    }
  });
  document.addEventListener('change', function (e) {
    var input = e.target.closest('[data-line-qty]');
    if (input) changeLine(input.getAttribute('data-line'), Math.max(0, Number(input.value) || 0));
    var note = e.target.closest('[data-cart-note]');
    if (note) fetch('/cart/update.js', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: note.value }) });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeDrawer();
    var d = drawerEl();
    if (d && root.classList.contains('has-cart-open')) trap(d, e);
  });

  function addToCart(form, button, message) {
    var body = new FormData(form);
    if (button) button.disabled = true;
    return fetch(C.routes.cartAdd, { method: 'POST', body: body, headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (r) {
        if (!r.ok) {
          if (message) { message.textContent = r.body.description || r.body.message || S.error; message.classList.add('is-error'); }
          return refreshCart();
        }
        return refreshCart().then(function () {
          if (C.cartType === 'drawer' && openDrawer(button)) return;
          if (C.cartType === 'page' && !message) { window.location.href = C.routes.cart; return; }
          if (message) {
            message.innerHTML = esc(S.added) + ' &middot; <a href="' + esc(C.routes.cart) + '">' + esc(S.viewCart) + '</a>';
          }
        });
      })
      .catch(function () { if (message) { message.textContent = S.error; message.classList.add('is-error'); } })
      .then(function () { if (button) button.disabled = false; });
  }
  document.addEventListener('submit', function (e) {
    var quick = e.target.closest && e.target.closest('form.cx-quick');
    if (!quick) return;
    e.preventDefault();
    addToCart(quick, quick.querySelector('button'), null);
  });

  /* ---------- Product page ---------- */
  $$('[data-product-section]').forEach(function (rootEl) {
    var dataEl = $('[data-product-json]', rootEl);
    var form = $('form.cx-form', rootEl);
    if (!dataEl || !form) return;
    var product = JSON.parse(dataEl.textContent);
    var idInput = $('[data-variant-id]', form);
    var button = $('[data-add-to-cart]', form);
    var label = $('[data-add-label]', form);
    var message = $('[data-form-message]', form);
    var priceBox = $('[data-product-price]', rootEl);
    var mainBox = $('[data-main-image]', rootEl);
    var stock = $('[data-stock]', rootEl);
    var stockLabel = $('[data-stock-label]', rootEl);
    var skuEl = $('[data-sku]', rootEl);
    var fieldsets = $$('fieldset.cx-option', form);

    function selectedOptions() {
      return fieldsets.map(function (fs) { var c = $('input:checked', fs); return c ? c.value : null; });
    }
    function currentVariant() {
      var sel = selectedOptions();
      if (!sel.length) return product.variants[0];
      return product.variants.filter(function (v) { return sel.every(function (o, i) { return v.options[i] === o; }); })[0];
    }
    /* Mark option values that lead nowhere (sold out or no such combination). */
    function markAvailability() {
      var sel = selectedOptions();
      fieldsets.forEach(function (fs, i) {
        $$('input', fs).forEach(function (input) {
          var wanted = sel.slice(); wanted[i] = input.value;
          var matches = product.variants.filter(function (v) { return wanted.every(function (o, n) { return o === null || v.options[n] === o; }); });
          var ok = matches.some(function (v) { return v.available; });
          var lab = $('label[for="' + input.id + '"]', fs);
          if (lab) { lab.classList.toggle('is-unavailable', !ok); lab.setAttribute('title', ok ? '' : (matches.length ? S.soldOut : '')); }
        });
        var legend = $('[data-option-value]', fs);
        if (legend) legend.textContent = sel[i] || '';
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
      priceBox.innerHTML = '<div class="cx-price cx-price--large' + (sale ? ' cx-price--sale' : '') + '"><span class="cx-price__now">' + esc(formatMoney(price)) + '</span>' +
        (sale ? '<s class="cx-price__was">' + esc(formatMoney(compare)) + '</s>' : '') + '</div>';
    }
    function setImage(src, alt, focal) {
      var img = mainBox && $('img', mainBox);
      if (!img || !src) return;
      img.removeAttribute('srcset');
      img.src = src;
      if (alt) img.alt = alt;
      img.style.objectPosition = focal || '';
    }
    var base = function (u) { return String(u || '').split('?')[0]; };
    function update() {
      var v = currentVariant();
      markAvailability();
      if (!v) { button.disabled = true; label.textContent = S.soldOut; if (stock) stock.className = 'cx-stock cx-stock--out'; if (stockLabel) stockLabel.textContent = S.soldOut; return; }
      idInput.value = v.id;
      button.disabled = !v.available;
      label.textContent = v.available ? S.addToCart : S.soldOut;
      if (stock) stock.className = 'cx-stock ' + (v.available ? 'cx-stock--in' : 'cx-stock--out');
      if (stockLabel) stockLabel.textContent = v.available ? S.compareInStock : S.soldOut;
      if (skuEl) skuEl.textContent = v.sku || '-';
      updatePlans(v);
      renderPrice(v);
      if (v.featured_image) {
        var thumb = $$('[data-thumb]', rootEl).filter(function (t) { return base(t.getAttribute('data-src')) === base(v.featured_image.src); })[0];
        setImage(v.featured_image.src, v.featured_image.alt, thumb ? thumb.getAttribute('data-focal') : '');
        $$('[data-thumb]', rootEl).forEach(function (x) { var on = x === thumb; x.classList.toggle('is-active', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      }
      try {
        var url = new URL(window.location.href);
        url.searchParams.set('variant', v.id);
        var plan = selectedPlanId();
        if (plan) url.searchParams.set('selling_plan', plan); else url.searchParams.delete('selling_plan');
        window.history.replaceState({}, '', url);
      } catch (err) { /* ignore */ }
    }
    form.addEventListener('change', function (e) { if (e.target.matches('.cx-option__input, [data-purchase-option], [data-plan-select]')) update(); });
    markAvailability();
    if (plansBox) { updatePlans(currentVariant()); renderPrice(currentVariant()); }
    $$('[data-thumb]', rootEl).forEach(function (t) {
      t.addEventListener('click', function () {
        setImage(t.getAttribute('data-src'), t.getAttribute('data-alt'), t.getAttribute('data-focal'));
        $$('[data-thumb]', rootEl).forEach(function (x) { var on = x === t; x.classList.toggle('is-active', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      });
    });
    $$('[data-pdp-step]', form).forEach(function (b) {
      b.addEventListener('click', function () {
        var q = $('input[name="quantity"]', form);
        q.value = Math.max(1, (Number(q.value) || 1) + Number(b.getAttribute('data-pdp-step')));
      });
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (button.disabled) return;
      message.textContent = '';
      message.classList.remove('is-error');
      addToCart(form, button, C.cartType === 'drawer' ? message : message).then(update);
    });
  });

  /* ---------- Recommendations ---------- */
  $$('[data-recommendations]').forEach(function (box) {
    var url = box.getAttribute('data-url');
    if (!url || box.children.length) return;
    fetch(url, { headers: { Accept: 'text/html' } }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (html) {
      if (!html) return;
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var fresh = doc.querySelector('[data-recommendations]');
      if (fresh && fresh.children.length) box.innerHTML = fresh.innerHTML;
    }).catch(function () { /* optional */ });
  });

  /* ---------- Listing: filters, view toggle ---------- */
  $$('[data-filter-form]').forEach(function (form) {
    form.addEventListener('change', function (e) { if (e.target.matches('[data-auto-submit]')) form.submit(); });
    $$('.cx-facet__range input', form).forEach(function (input) {
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); form.submit(); } });
    });
  });
  var filtersPanel = $('[data-filters-panel]');
  if (filtersPanel) {
    var openBtn = $('[data-filters-open]');
    var setFilters = function (open) {
      root.classList.toggle('has-filters-open', open);
      if (openBtn) openBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) { var f = $('select, input, button', filtersPanel); if (f) f.focus(); } else if (openBtn) openBtn.focus();
    };
    if (openBtn) openBtn.addEventListener('click', function () { setFilters(true); });
    $$('[data-filters-close]').forEach(function (b) { b.addEventListener('click', function () { setFilters(false); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && root.classList.contains('has-filters-open')) setFilters(false); });
  }
  var grid = $('[data-product-grid]');
  var viewBtns = $$('[data-view]');
  if (grid && viewBtns.length) {
    var setView = function (mode) {
      grid.classList.toggle('cx-grid--list', mode === 'list');
      viewBtns.forEach(function (b) { var on = b.getAttribute('data-view') === mode; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      store('circuit:view', mode);
    };
    viewBtns.forEach(function (b) { b.addEventListener('click', function () { setView(b.getAttribute('data-view')); }); });
    var saved = store('circuit:view');
    if (saved === 'list') setView('list');
  }

  /* ---------- Predictive search ---------- */
  (function () {
    var panel = $('[data-predictive-search]');
    if (!panel) return;
    var input = $('[data-predictive-input]');
    var out = $('[data-predictive-results]', panel);
    var predictive = !(C.search && C.search.predictive === false);
    var limit = parseInt(panel.getAttribute('data-limit') || '4', 10) || 4;
    var showImage = panel.getAttribute('data-show-image') !== 'false';
    var showPrice = panel.getAttribute('data-show-price') !== 'false';
    var labels = {};
    try { labels = JSON.parse(out.getAttribute('data-labels') || '{}'); } catch (e) { labels = {}; }
    var timer, ctrl, cache = {};
    function open(show) { panel.hidden = !show; input.setAttribute('aria-expanded', show ? 'true' : 'false'); }
    function group(title, items) { return items.length ? '<div class="cx-suggest__group"><h3>' + esc(title) + '</h3><ul role="presentation">' + items.join('') + '</ul></div>' : ''; }
    function row(url, inner) { return '<li role="presentation"><a class="cx-suggest__item" role="option" href="' + esc(url) + '">' + inner + '</a></li>'; }
    function render(r, term) {
      var res = (r && r.resources && r.resources.results) || {};
      var html = '';
      html += group(labels.queries, (res.queries || []).map(function (q) { return row(q.url, '<span>' + (q.styled_text || esc(q.text)) + '</span>'); }));
      html += group(labels.products, (res.products || []).map(function (p) {
        return row(p.url, (showImage && p.image ? '<img src="' + esc(p.image) + '" alt="" loading="lazy" width="44" height="44">' : '') + '<span>' + esc(p.title) + (showPrice ? '<br><span class="cx-suggest__price cx-mono">' + esc(C.currency || '') + ' ' + esc(p.price) + '</span>' : '') + '</span>');
      }));
      html += group(labels.collections, (res.collections || []).map(function (c) { return row(c.url, '<span>' + esc(c.title) + '</span>'); }));
      html += group(labels.articles, (res.articles || []).map(function (a) { return row(a.url, '<span>' + esc(a.title) + '</span>'); }));
      html += group(labels.pages, (res.pages || []).map(function (p) { return row(p.url, '<span>' + esc(p.title) + '</span>'); }));
      out.innerHTML = !html ? '<p class="empty">' + esc((labels.none || '').replace('{terms}', term)) + '</p>'
        : html + '<div class="cx-suggest__group"><a class="cx-suggest__item cx-suggest__all" href="/search?q=' + encodeURIComponent(term) + '">' + esc((labels.all || '').replace('{terms}', term)) + '</a></div>';
      open(true);
    }
    function query() {
      var term = input.value.trim();
      if (!term) { out.innerHTML = ''; open(false); return; }
      if (cache[term]) return render(cache[term], term);
      if (ctrl) ctrl.abort();
      ctrl = window.AbortController ? new AbortController() : null;
      var url = (panel.getAttribute('data-url') || '/search/suggest') + '.json?q=' + encodeURIComponent(term) + '&resources[type]=query,product,collection,article,page&resources[limit]=' + limit + '&resources[options][fields]=title,product_type,variants.title,vendor';
      fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { return r.json(); })
        .then(function (j) { cache[term] = j; if (input.value.trim() === term) render(j, term); })
        .catch(function () {});
    }
    if (predictive) {
      input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(query, 180); });
      input.addEventListener('focus', function () { if (out.innerHTML) open(true); });
    }
    document.addEventListener('click', function (e) { if (!panel.hidden && !e.target.closest('[data-search]')) open(false); });
    $('[data-search]').addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { open(false); input.focus(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      var links = $$('a', out);
      if (!links.length) return;
      e.preventDefault();
      var i = links.indexOf(document.activeElement);
      var next = e.key === 'ArrowDown' ? (i + 1) % links.length : (i <= 0 ? -1 : i - 1);
      if (next < 0) input.focus(); else links[next].focus();
    });
  }());

  /* ---------- Compare (client side, up to 4 products) ---------- */
  (function () {
    var tray = $('[data-compare-tray]');
    var modal = $('[data-compare-modal]');
    var KEY = 'circuit:compare';
    var MAX = 4;
    var items = [];
    var saved = store(KEY);
    if (saved && saved.length) items = saved.slice(0, MAX);
    var cache = {};
    var lastFocus = null;

    function has(handle) { return items.some(function (i) { return i.handle === handle; }); }
    function persist() { store(KEY, items); }
    function toggle(item) {
      if (has(item.handle)) items = items.filter(function (i) { return i.handle !== item.handle; });
      else if (items.length >= MAX) { announce(S.compareFull); return; }
      else items.push(item);
      persist(); render();
    }
    function announce(text) {
      var el = $('[data-compare-counter]');
      if (el) { el.setAttribute('title', text); el.classList.add('is-warn'); setTimeout(function () { el.classList.remove('is-warn'); }, 1600); }
      var live = $('[data-compare-live]') || (function () { var p = document.createElement('p'); p.className = 'visually-hidden'; p.setAttribute('role', 'status'); p.setAttribute('data-compare-live', ''); document.body.appendChild(p); return p; }());
      live.textContent = text;
    }
    function render() {
      $$('[data-compare-toggle]').forEach(function (btn) {
        var on = has(btn.getAttribute('data-handle'));
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.classList.toggle('is-active', on);
        var l = $('[data-compare-label]', btn);
        if (l) l.textContent = on ? S.compareAdded : S.compareAdd;
      });
      $$('[data-compare-count]').forEach(function (el) { el.textContent = items.length; el.classList.toggle('is-empty', !items.length); });
      if (!tray) return;
      tray.hidden = !items.length;
      root.classList.toggle('has-compare-tray', !!items.length);
      var counter = $('[data-compare-counter]', tray);
      if (counter) counter.textContent = items.length + '/' + MAX;
      var slots = $('[data-compare-slots]', tray);
      var html = items.map(function (i) {
        return '<li class="cx-compare__slot"><a href="' + esc(i.url) + '">' + (i.image ? '<img src="' + esc(i.image) + '" alt="" width="40" height="40">' : '') + '<span>' + esc(i.title) + '</span></a>' +
          '<button type="button" class="cx-icon-btn" data-compare-drop="' + esc(i.handle) + '" aria-label="' + esc(S.compareRemove + ': ' + i.title) + '">&times;</button></li>';
      }).join('');
      for (var n = items.length; n < MAX; n++) html += '<li class="cx-compare__slot cx-compare__slot--empty" aria-hidden="true"><span>' + (n + 1) + '</span></li>';
      slots.innerHTML = html;
      var view = $('[data-compare-view]', tray);
      if (view) view.disabled = items.length < 2;
      if (modal && !modal.hidden) buildTable();
    }
    function load(item) {
      if (cache[item.handle]) return Promise.resolve(cache[item.handle]);
      return fetch(item.url + (item.url.indexOf('?') > -1 ? '&' : '?') + 'view=compare', { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.text(); })
        .then(function (t) { var m = /<!--circuit-compare-->([\s\S]*?)<!--\/circuit-compare-->/.exec(t); var d = JSON.parse(m[1]); cache[item.handle] = d; return d; })
        .catch(function () { return { handle: item.handle, title: item.title, url: item.url, image: item.image, price: item.price, specs: [], error: true }; });
    }
    function buildTable() {
      var host = $('[data-compare-table]', modal);
      host.innerHTML = '<p class="cx-note">' + esc(S.compareLoading) + '</p>';
      Promise.all(items.map(load)).then(function (data) {
        if (!data.length) { host.innerHTML = ''; return; }
        var labels = [];
        data.forEach(function (d) { (d.specs || []).forEach(function (s) { if (labels.indexOf(s.label) < 0) labels.push(s.label); }); });
        function val(d, label) { var s = (d.specs || []).filter(function (x) { return x.label === label; })[0]; return s ? s.value : ''; }
        var html = '<label class="cx-check cx-compare-diff"><input type="checkbox" data-compare-diff><span class="cx-check__box" aria-hidden="true"></span><span class="cx-check__label">' + esc(S.compareDiff || '') + '</span></label>';
        html += '<div class="cx-compare-table-wrap"><table class="cx-compare-table"><thead><tr><td></td>';
        data.forEach(function (d) {
          html += '<th scope="col"><a href="' + esc(d.url) + '">' + (d.image ? '<img src="' + esc(d.image) + '" alt="" width="96" height="96">' : '') + '<span>' + esc(d.title) + '</span></a>' +
            '<button type="button" class="cx-link-btn" data-compare-drop="' + esc(d.handle) + '">' + esc(S.compareRemove) + '</button></th>';
        });
        html += '</tr></thead><tbody>';
        var rows = [[S.comparePrice, function (d) { return d.price; }], [S.compareBrand, function (d) { return d.vendor; }], [S.compareAvailability, function (d) { return d.available ? S.compareInStock : S.compareOutOfStock; }]];
        labels.forEach(function (l) { rows.push([l, function (d) { return val(d, l); }]); });
        rows.forEach(function (r) {
          var cells = data.map(function (d) { return r[1](d) || '-'; });
          var same = cells.every(function (c) { return c === cells[0]; });
          html += '<tr' + (same ? ' data-same' : '') + '><th scope="row">' + esc(r[0]) + '</th>' + cells.map(function (c) { return '<td class="cx-mono">' + esc(c) + '</td>'; }).join('') + '</tr>';
        });
        html += '</tbody></table></div>';
        host.innerHTML = html;
      });
    }
    function openModal() {
      if (!modal || items.length < 1) return;
      lastFocus = document.activeElement;
      modal.hidden = false;
      root.classList.add('has-modal-open');
      buildTable();
      modal.focus();
    }
    function closeModal() {
      if (!modal || modal.hidden) return;
      modal.hidden = true;
      root.classList.remove('has-modal-open');
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-compare-toggle]');
      if (t) { toggle({ handle: t.getAttribute('data-handle'), title: t.getAttribute('data-title'), url: t.getAttribute('data-url'), image: t.getAttribute('data-image'), price: t.getAttribute('data-price') }); return; }
      var drop = e.target.closest('[data-compare-drop]');
      if (drop) { var h = drop.getAttribute('data-compare-drop'); items = items.filter(function (i) { return i.handle !== h; }); persist(); render(); if (!items.length) closeModal(); return; }
      if (e.target.closest('[data-compare-clear]')) { items = []; persist(); render(); closeModal(); return; }
      if (e.target.closest('[data-compare-view]')) { openModal(); return; }
      if (e.target.closest('[data-compare-open]')) { if (items.length) openModal(); else if (tray) announce(S.compareAdd); return; }
      if (e.target.closest('[data-compare-close]') || e.target === modal) closeModal();
    });
    document.addEventListener('change', function (e) {
      if (e.target.matches('[data-compare-diff]')) $('[data-compare-table]', modal).classList.toggle('only-diff', e.target.checked);
    });
    document.addEventListener('keydown', function (e) {
      if (modal && !modal.hidden) { if (e.key === 'Escape') closeModal(); else trap(modal, e); }
    });
    render();
  }());
}());
