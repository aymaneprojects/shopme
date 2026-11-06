
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
      var KEY = '@H@-age-ok', ok = false;
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
