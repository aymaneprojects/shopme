/* Vitrine: small vanilla JS (no dependencies). Ajax cart API, Section Rendering API, predictive search, reveal on scroll. */
(function () {
  'use strict';
  var C = window.vitrine || {};
  var S = C.strings || {};
  C.cartType = C.cartType || 'drawer';
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
        document.dispatchEvent(new CustomEvent('vitrine:cart-updated'));
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
    var quick = e.target.closest && e.target.closest('form.k-quick');
    if (!quick) return;
    e.preventDefault();
    addToCart(quick, quick.querySelector('button'), null);
  });

  /* ---------- Product page ---------- */
  $$('[data-product-section]').forEach(function (rootEl) {
    var dataEl = $('[data-product-json]', rootEl);
    var form = $('form.k-form', rootEl);
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
    var fieldsets = $$('fieldset.k-option', form);

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
      priceBox.innerHTML = '<p class="k-price k-price--large' + (sale ? ' k-price--sale' : '') + '">' + (sale ? '<s class="k-price__was">' + esc(formatMoney(compare)) + '</s>' : '') +
        '<span class="k-price__now">' + esc(formatMoney(price)) + '</span></p>';
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
      if (!v) { button.disabled = true; label.textContent = S.soldOut; if (stock) stock.className = 'k-info__stock k-stock k-stock--out'; if (stockLabel) stockLabel.textContent = S.soldOut; return; }
      idInput.value = v.id;
      button.disabled = !v.available;
      label.textContent = v.available ? S.addToCart : S.soldOut;
      if (stock) stock.className = 'k-info__stock k-stock ' + (v.available ? 'k-stock--in' : 'k-stock--out');
      if (stockLabel) stockLabel.textContent = v.available ? S.inStock : S.soldOut;
      if (skuEl) skuEl.textContent = v.sku || '-';
      updatePlans(v);
      renderPrice(v);
      document.dispatchEvent(new CustomEvent('product:variant', { detail: { variant: v, root: rootEl } }));
      if (v.featured_image && !mainBox) {
        var shot = $$('[data-gallery-image]', rootEl).filter(function (n) { return base(n.getAttribute('data-src')) === base(v.featured_image.src); })[0];
        if (shot && shot.scrollIntoView) shot.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
      }
      if (v.featured_image && mainBox) {
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
    form.addEventListener('change', function (e) { if (e.target.matches('.k-option__input, [data-purchase-option], [data-plan-select]')) update(); });
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

  /* ---------- Listing: filter drop-downs ---------- */
  $$('[data-filter-form]').forEach(function (form) {
    form.addEventListener('change', function (e) { if (e.target.matches('[data-auto-submit]')) form.submit(); });
    $$('.k-drop__range input', form).forEach(function (input) {
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); form.submit(); } });
    });
    var drops = $$('[data-drop]', form);
    if (form.classList.contains('k-filters--side')) {
      /* Sidebar groups are open on wide screens; on a phone they start closed unless a filter is active. */
      if (window.matchMedia && window.matchMedia('(max-width: 989px)').matches) drops.forEach(function (d) { if (!d.classList.contains('is-active')) d.open = false; });
      return;
    }
    drops.forEach(function (d) {
      d.addEventListener('toggle', function () { if (d.open) drops.forEach(function (o) { if (o !== d) o.open = false; }); });
    });
    document.addEventListener('click', function (e) { if (!form.contains(e.target)) drops.forEach(function (d) { d.open = false; }); });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      drops.forEach(function (d) { if (d.open) { d.open = false; var sum = $('summary', d); if (sum) sum.focus(); } });
    });
  });

  /* ---------- Search panel with predictive results ---------- */
  (function () {
    var panel = $('[data-predictive-search]');
    var toggle = $('[data-search-toggle]');
    if (!panel || !toggle) return;
    var input = $('[data-predictive-input]', panel);
    var out = $('[data-predictive-results]', panel);
    var predictive = !(C.search && C.search.predictive === false);
    var limit = parseInt(panel.getAttribute('data-limit') || '4', 10) || 4;
    var showImage = panel.getAttribute('data-show-image') !== 'false';
    var showPrice = panel.getAttribute('data-show-price') !== 'false';
    var labels = {};
    try { labels = JSON.parse(out.getAttribute('data-labels') || '{}'); } catch (e) { labels = {}; }
    var timer, ctrl, cache = {};
    function open(show) {
      panel.hidden = !show;
      toggle.setAttribute('aria-expanded', show ? 'true' : 'false');
      if (header) header.classList.toggle('is-search-open', show);
      if (show) input.focus();
    }
    function group(title, items) { return items.length ? '<div class="k-search__group"><h3>' + esc(title) + '</h3><ul role="presentation">' + items.join('') + '</ul></div>' : ''; }
    function row(url, inner) { return '<li role="presentation"><a class="k-search__item" role="option" href="' + esc(url) + '">' + inner + '</a></li>'; }
    function render(r, term) {
      var res = (r && r.resources && r.resources.results) || {};
      var html = '';
      html += group(labels.queries, (res.queries || []).map(function (q) { return row(q.url, '<span>' + (q.styled_text || esc(q.text)) + '</span>'); }));
      html += group(labels.products, (res.products || []).map(function (p) {
        return row(p.url, (showImage && p.image ? '<img src="' + esc(p.image) + '" alt="" loading="lazy" width="56" height="56">' : '') + '<span>' + esc(p.title) + (showPrice ? '<br><span class="k-search__price">' + esc(C.currency || '') + ' ' + esc(p.price) + '</span>' : '') + '</span>');
      }));
      html += group(labels.collections, (res.collections || []).map(function (c) { return row(c.url, '<span>' + esc(c.title) + '</span>'); }));
      html += group(labels.articles, (res.articles || []).map(function (a) { return row(a.url, '<span>' + esc(a.title) + '</span>'); }));
      html += group(labels.pages, (res.pages || []).map(function (p) { return row(p.url, '<span>' + esc(p.title) + '</span>'); }));
      out.innerHTML = !html ? '<p class="empty">' + esc((labels.none || '').replace('{terms}', term)) + '</p>'
        : html + '<div class="k-search__group"><a class="k-search__item k-search__all" href="/search?q=' + encodeURIComponent(term) + '">' + esc((labels.all || '').replace('{terms}', term)) + '</a></div>';
      input.setAttribute('aria-expanded', html ? 'true' : 'false');
    }
    function query() {
      var term = input.value.trim();
      if (!term) { out.innerHTML = ''; input.setAttribute('aria-expanded', 'false'); return; }
      if (cache[term]) return render(cache[term], term);
      if (ctrl) ctrl.abort();
      ctrl = window.AbortController ? new AbortController() : null;
      var url = (panel.getAttribute('data-url') || '/search/suggest') + '.json?q=' + encodeURIComponent(term) + '&resources[type]=query,product,collection,article,page&resources[limit]=' + limit + '&resources[options][fields]=title,product_type,variants.title,vendor';
      fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { return r.json(); })
        .then(function (j) { cache[term] = j; if (input.value.trim() === term) render(j, term); })
        .catch(function () {});
    }
    toggle.addEventListener('click', function () {
      if (!predictive) { window.location.href = (C.root || '/').replace(/\/$/, '') + '/search'; return; }
      open(panel.hidden);
    });
    if (predictive) input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(query, 180); });
    document.addEventListener('click', function (e) { if (!panel.hidden && !e.target.closest('[data-header]')) open(false); });
    panel.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { open(false); toggle.focus(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      var links = $$('a', out);
      if (!links.length) return;
      e.preventDefault();
      var i = links.indexOf(document.activeElement);
      var next = e.key === 'ArrowDown' ? (i + 1) % links.length : (i <= 0 ? -1 : i - 1);
      if (next < 0) input.focus(); else links[next].focus();
    });
  }());

  /* ---------- Reveal sections as they scroll into view ---------- */
  if (C.reveal && 'IntersectionObserver' in window && !reduce) {
    var targets = $$('main .shopify-section').slice(1);
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    targets.forEach(function (t) { t.classList.add('reveal'); io.observe(t); });
  }

  /* ---------- Kit features: sticky header shadow, back to top, stock counter, countdown, age check, infinite scroll ---------- */
  (function features() {
    var hdr = $('[data-header]');
    var toTop = $('[data-back-to-top]');
    function onScroll() {
      var y = window.pageYOffset || root.scrollTop;
      if (hdr) hdr.classList.toggle('is-stuck', y > 8);
      if (toTop) toTop.classList.toggle('is-visible', y > 700);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    if (toTop) toTop.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); });

    /* Low stock message: "Only 3 left", refreshed when the shopper picks another variant. */
    document.addEventListener('product:variant', function (e) {
      var rootEl = e.detail.root, v = e.detail.variant;
      var box = $('[data-lowstock]', rootEl), dataEl = $('[data-stock-json]', rootEl);
      if (!box || !dataEl || !v) return;
      var qty = -1;
      try { qty = Number(JSON.parse(dataEl.textContent)[String(v.id)]); } catch (err) { qty = -1; }
      var limit = Number(box.getAttribute('data-limit')) || 10;
      var show = v.available && qty > 0 && qty <= limit;
      box.hidden = !show;
      if (show) box.textContent = (box.getAttribute('data-template') || '').replace('[count]', String(qty));
    });

    /* Countdown timers. */
    $$('[data-countdown]').forEach(function (box) {
      var end = Date.parse(box.getAttribute('data-end') || '');
      if (isNaN(end)) return;
      var parts = { days: $('[data-cd="days"]', box), hours: $('[data-cd="hours"]', box), minutes: $('[data-cd="minutes"]', box), seconds: $('[data-cd="seconds"]', box) };
      var done = $('[data-countdown-ended]', box.parentNode);
      var grid = $('[data-countdown-grid]', box) || box;
      function pad(n) { return n < 10 ? '0' + n : String(n); }
      function tick() {
        var left = Math.max(0, Math.floor((end - Date.now()) / 1000));
        if (parts.days) parts.days.textContent = pad(Math.floor(left / 86400));
        if (parts.hours) parts.hours.textContent = pad(Math.floor(left % 86400 / 3600));
        if (parts.minutes) parts.minutes.textContent = pad(Math.floor(left % 3600 / 60));
        if (parts.seconds) parts.seconds.textContent = pad(left % 60);
        if (left === 0) { grid.hidden = true; if (done) done.hidden = false; return false; }
        return true;
      }
      if (tick()) { var timer = setInterval(function () { if (!tick()) clearInterval(timer); }, 1000); }
    });

    /* Age check: asked once per browser. */
    var gate = $('[data-age-gate]');
    if (gate) {
      var KEY = 'vitrine-age-ok', ok = false;
      try { ok = window.localStorage.getItem(KEY) === '1'; } catch (err) { ok = false; }
      if (!ok && gate.getAttribute('data-preview') !== 'true') {
        gate.hidden = false;
        root.classList.add('has-age-gate');
        var yes = $('[data-age-yes]', gate), no = $('[data-age-no]', gate), denied = $('[data-age-denied]', gate), ask = $('[data-age-ask]', gate);
        if (yes) yes.focus();
        gate.addEventListener('keydown', function (e) { if (e.key === 'Tab') trap(gate, e); });
        if (yes) yes.addEventListener('click', function () {
          try { window.localStorage.setItem(KEY, '1'); } catch (err) { /* private mode */ }
          gate.hidden = true; root.classList.remove('has-age-gate');
        });
        if (no) no.addEventListener('click', function () { if (ask) ask.hidden = true; if (denied) denied.hidden = false; });
      }
    }

    /* Infinite scroll on collections: load the next page when the end of the grid comes into view. */
    var grid = $('[data-infinite]');
    if (grid && 'IntersectionObserver' in window && window.fetch) {
      var next = grid.getAttribute('data-infinite-next');
      var status = $('[data-infinite-status]');
      var pager = $('.pagination');
      if (pager) pager.hidden = true;
      var sentinel = document.createElement('div');
      sentinel.setAttribute('aria-hidden', 'true');
      grid.parentNode.insertBefore(sentinel, grid.nextSibling);
      var busy = false;
      var watcher = new IntersectionObserver(function (entries) {
        if (!entries[0].isIntersecting || busy || !next) return;
        busy = true;
        if (status) status.hidden = false;
        fetch(next, { headers: { Accept: 'text/html' } }).then(function (r) { return r.text(); }).then(function (html) {
          var doc = new DOMParser().parseFromString(html, 'text/html');
          var more = $('[data-infinite]', doc);
          if (more) $$('li', more).forEach(function (li) { if (li.parentNode === more) grid.appendChild(document.importNode(li, true)); });
          next = more ? more.getAttribute('data-infinite-next') : null;
          if (!next) { watcher.disconnect(); if (pager) pager.hidden = false; }
        }).catch(function () { next = null; watcher.disconnect(); if (pager) pager.hidden = false; })
          .then(function () { busy = false; if (status) status.hidden = true; });
      }, { rootMargin: '600px 0px' });
      if (next) watcher.observe(sentinel); else if (pager) pager.hidden = false;
    }
  }());
}());
