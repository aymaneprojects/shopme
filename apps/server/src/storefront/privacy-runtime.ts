import { createHash } from 'node:crypto';

/**
 * Browser runtime of customer privacy and customer events, served at `/.shopme/runtime.js` and loaded in the head of every storefront and
 * checkout page. It reads its configuration from `<script type="application/json" id="shopme-privacy-config">`.
 *
 *  - consent: `window.Shopify.customerPrivacy` (and `window.shopme.consent`), the `_shopme_consent` cookie, the banner behaviour
 *  - event bus: `window.shopme.analytics.publish/subscribe`, standard events, replay (max 100) after consent, in-page subscribers
 *  - pixels: merchant code runs in a sandboxed null-origin iframe (`/.shopme/pixels/:id`) only once its required consent exists
 *  - first-party analytics: a consumer of the same bus that batches events to `/.shopme/events` while analytics consent is granted,
 *    with the browser's time zone (the server keeps only the country it maps to)
 *
 * Plain ES2017 without dependencies. Written as the body of a function of (window, document) so tests can run it against stubs.
 */
export const RUNTIME_BODY = String.raw`
'use strict';
var cfgEl = document.getElementById('shopme-privacy-config');
var cfg = {};
try { cfg = JSON.parse(cfgEl ? cfgEl.textContent : '{}'); } catch (e) { cfg = {}; }
var policy = cfg.policy || {};
var cookieName = (cfg.cookie && cfg.cookie.name) || '_shopme_consent';
var VERSION = (cfg.cookie && cfg.cookie.version) || 1;
var CATS = ['analytics', 'marketing', 'preferences'];
var listeners = {};
var banner = null;

function readCookie(name) {
  try {
    var parts = String(document.cookie || '').split('; ');
    for (var i = 0; i < parts.length; i++) { if (parts[i].indexOf(name + '=') === 0) return parts[i].slice(name.length + 1); }
  } catch (e) { /* cookies blocked */ }
  return null;
}
function writeCookie(name, value, maxAge) {
  try {
    document.cookie = name + '=' + value + '; path=/; SameSite=Lax' + (maxAge ? '; max-age=' + maxAge : '') + (window.location && window.location.protocol === 'https:' ? '; Secure' : '');
  } catch (e) { /* cookies blocked */ }
}
function parseConsent(raw) {
  if (!raw) return null;
  try {
    var o = JSON.parse(decodeURIComponent(raw));
    if (!o || o.v !== VERSION) return null;
    return o;
  } catch (e) { return null; }
}
function choice(v) { return v === 'yes' || v === 'no' ? v : ''; }

/** Same rules as the server (services/privacy/consent.ts): what was answered and what may run. */
function compute() {
  var saved = parseConsent(readCookie(cookieName));
  var copy = cfg.customerConsent && cfg.customerConsent.v === VERSION ? cfg.customerConsent : null;
  if (copy && (!saved || (copy.ts || 0) > (saved.ts || 0))) saved = copy;
  var off = policy.bannerMode === 'OFF';
  var required = (!!policy.consentRequired || policy.bannerMode === 'ALWAYS') && !off;
  var answered = !!saved && CATS.every(function (k) { return saved[k] === 'yes' || saved[k] === 'no'; });
  var out = { answers: {}, allowed: {} };
  CATS.forEach(function (k) {
    var v = saved ? choice(saved[k]) : '';
    out.answers[k] = v;
    out.allowed[k] = required ? v === 'yes' : v !== 'no';
  });
  var saleOut = (saved && saved.saleOfData === 'no') || (!!policy.gpc && !!policy.dataSaleOptOutRequired) || !!policy.customerOptOut;
  out.answers.sale_of_data = saleOut ? 'no' : saved ? choice(saved.saleOfData) : '';
  out.allowed.sale_of_data = !saleOut;
  var collected = !!saved && (required ? answered : true);
  out.show = off ? false : policy.bannerMode === 'ALWAYS' ? !collected : (!!policy.consentRequired || policy.level === 'NOTICE') && !collected;
  out.forceShow = !!window.__shopmeShowBanner;
  return out;
}
var state = compute();

var privacy = {
  currentVisitorConsent: function () { var a = state.answers; return { analytics: a.analytics, marketing: a.marketing, preferences: a.preferences, sale_of_data: a.sale_of_data }; },
  shouldShowBanner: function () { return state.show || state.forceShow; },
  userCanBeTracked: function () { return state.allowed.analytics || state.allowed.marketing; },
  analyticsProcessingAllowed: function () { return state.allowed.analytics; },
  marketingAllowed: function () { return state.allowed.marketing; },
  preferencesProcessingAllowed: function () { return state.allowed.preferences; },
  saleOfDataAllowed: function () { return state.allowed.sale_of_data; },
  getRegion: function () { return cfg.region || ''; },
  setTrackingConsent: function (consent, callback) {
    consent = consent || {};
    var saved = parseConsent(readCookie(cookieName)) || {};
    var next = { v: VERSION, analytics: choice(saved.analytics), marketing: choice(saved.marketing), preferences: choice(saved.preferences), saleOfData: choice(saved.saleOfData), region: cfg.region || '', ts: Date.now() };
    var map = { analytics: 'analytics', marketing: 'marketing', preferences: 'preferences', sale_of_data: 'saleOfData' };
    Object.keys(map).forEach(function (k) {
      var v = consent[k];
      if (typeof v === 'boolean') next[map[k]] = v ? 'yes' : 'no';
      else if (v === 'yes' || v === 'no') next[map[k]] = v;
    });
    writeCookie(cookieName, encodeURIComponent(JSON.stringify(next)), (cfg.cookie && cfg.cookie.maxAge) || 31536000);
    cfg.customerConsent = null; // the visitor's own answer is newer than the copy saved on the customer
    window.__shopmeShowBanner = false;
    refresh(true);
    try {
      if (cfg.endpoints && cfg.endpoints.consent && window.fetch) {
        window.fetch(cfg.endpoints.consent, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', keepalive: true,
          body: JSON.stringify({ analytics: consent.analytics, marketing: consent.marketing, preferences: consent.preferences, sale_of_data: consent.sale_of_data }) }).catch(function () {});
      }
    } catch (e) { /* best effort */ }
    if (typeof callback === 'function') { try { callback(); } catch (e) { /* theme callback */ } }
  },
};
var S = window.Shopify = window.Shopify || {};
S.customerPrivacy = privacy;
S.loadFeatures = S.loadFeatures || function (features, cb) { if (typeof cb === 'function') cb(); };
var shopme = window.shopme = window.shopme || {};
shopme.consent = privacy;

function emit(type, detail) {
  var fns = listeners[type] || [];
  for (var i = 0; i < fns.length; i++) { try { fns[i](detail); } catch (e) { /* subscriber */ } }
  try { if (window.CustomEvent && document.dispatchEvent) document.dispatchEvent(new window.CustomEvent(type, { detail: detail })); } catch (e) { /* old browser */ }
}
function consentDetail() {
  return { analyticsAllowed: state.allowed.analytics, marketingAllowed: state.allowed.marketing, preferencesAllowed: state.allowed.preferences, saleOfDataAllowed: state.allowed.sale_of_data,
    firstPartyMarketingAllowed: state.allowed.marketing, thirdPartyMarketingAllowed: state.allowed.marketing && state.allowed.sale_of_data };
}

// ---------------------------------------------------------------------------------------------------------------------
// event bus
// ---------------------------------------------------------------------------------------------------------------------
var buffer = [];
var seq = 0;
var subs = {};
var targets = [];
function uid() { seq += 1; return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10) + '-' + seq; }
var clientId = null;
function getClientId() {
  if (clientId) return clientId;
  var c = readCookie('_shopme_cid');
  if (!c) { c = uid(); writeCookie('_shopme_cid', c, 0); }
  clientId = c;
  return c;
}
function eventContext() {
  var loc = window.location || {};
  var nav = window.navigator || {};
  var scr = window.screen || {};
  return {
    document: { location: { href: loc.href, pathname: loc.pathname, search: loc.search, hash: loc.hash, origin: loc.origin, host: loc.host, hostname: loc.hostname, protocol: loc.protocol }, referrer: document.referrer || '', title: document.title || '', characterSet: document.characterSet || 'UTF-8' },
    navigator: { language: nav.language || '', cookieEnabled: !!nav.cookieEnabled, userAgent: nav.userAgent || '' },
    window: { innerWidth: window.innerWidth, innerHeight: window.innerHeight, outerWidth: window.outerWidth, outerHeight: window.outerHeight, pageXOffset: window.pageXOffset || 0, pageYOffset: window.pageYOffset || 0, screen: { width: scr.width, height: scr.height } },
  };
}

function deliver(target, ev) {
  if (!target.ready || target.dead || target.seen[ev.id]) return;
  if (ev.type === 'dom' && !target.domEvents) return;
  if (!target.allowed()) return;
  target.seen[ev.id] = true;
  target.send(ev);
}
function pump(target) { for (var i = 0; i < buffer.length; i++) deliver(target, buffer[i]); }

function publish(name, data, opts) {
  if (typeof name !== 'string' || !name) return null;
  opts = opts || {};
  var ev = { id: uid(), name: name, timestamp: new Date(opts.timestamp || Date.now()).toISOString(), type: opts.type || 'standard', data: data || {}, context: eventContext() };
  if (state.allowed.analytics || state.allowed.marketing) ev.clientId = getClientId();
  if (ev.type !== 'dom') { buffer.push(ev); if (buffer.length > 100) buffer.shift(); }
  var fns = (subs[name] || []).concat(subs.all_events || []);
  for (var i = 0; i < fns.length; i++) { try { fns[i](ev); } catch (e) { /* subscriber */ } }
  for (var j = 0; j < targets.length; j++) deliver(targets[j], ev);
  return ev;
}
var analytics = shopme.analytics = {
  publish: publish,
  subscribe: function (name, fn) { (subs[name] = subs[name] || []).push(fn); return function () { subs[name] = (subs[name] || []).filter(function (f) { return f !== fn; }); }; },
};
S.analytics = S.analytics || {};
S.analytics.publish = publish;
S.analytics.subscribe = analytics.subscribe;
shopme.publish = publish;
shopme._buffer = buffer;

// ---------------------------------------------------------------------------------------------------------------------
// first-party consumer: batches the standard events to the server while analytics consent is granted
// ---------------------------------------------------------------------------------------------------------------------
var queue = [];
var flushTimer = null;
// The browser's IANA time zone (such as Europe/Paris): the server turns it into a country for the live view and keeps nothing else.
function timeZone() { try { return String(window.Intl.DateTimeFormat().resolvedOptions().timeZone || '').slice(0, 64); } catch (e) { return ''; } }
function flush() {
  flushTimer = null;
  if (!queue.length || !cfg.endpoints || !cfg.endpoints.events) return;
  var batch = queue.splice(0, 100);
  var body = JSON.stringify({ tz: timeZone(), events: batch.map(function (e) { return { id: e.id, name: e.name, clientId: e.clientId, timestamp: e.timestamp, data: e.data, context: { document: { location: { pathname: e.context.document.location.pathname } } } }; }) });
  try {
    if (window.navigator && window.navigator.sendBeacon && window.Blob) { window.navigator.sendBeacon(cfg.endpoints.events, new window.Blob([body], { type: 'application/json' })); return; }
    if (window.fetch) window.fetch(cfg.endpoints.events, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body, credentials: 'same-origin', keepalive: true }).catch(function () {});
  } catch (e) { /* best effort */ }
}
targets.push({
  id: 'first-party', ready: true, dead: false, seen: {}, domEvents: false,
  allowed: function () { return state.allowed.analytics; },
  send: function (ev) { queue.push(ev); if (!flushTimer) flushTimer = setTimeout(flush, 1500); },
});
if (document.addEventListener) {
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);
}

// ---------------------------------------------------------------------------------------------------------------------
// pixels: sandboxed iframes
// ---------------------------------------------------------------------------------------------------------------------
function storageOp(op, args) {
  try {
    var parts = op.split('.');
    var store = parts[0] === 'localStorage' ? window.localStorage : parts[0] === 'sessionStorage' ? window.sessionStorage : null;
    if (parts[0] === 'cookie') {
      if (parts[1] === 'get') return readCookie(args[0]);
      if (parts[1] === 'set') { writeCookie(args[0], args[1], 0); return 'OK'; }
      return null;
    }
    if (!store) return null;
    if (parts[1] === 'getItem') return store.getItem(args[0]);
    if (parts[1] === 'setItem') { store.setItem(args[0], String(args[1])); return null; }
    if (parts[1] === 'removeItem') { store.removeItem(args[0]); return null; }
    if (parts[1] === 'clear') { store.clear(); return null; }
    if (parts[1] === 'key') return store.key(args[0]);
    if (parts[1] === 'length') return store.length;
  } catch (e) { /* storage blocked */ }
  return null;
}
function initData() {
  return { context: eventContext(), data: { customer: cfg.customer || null, cart: null }, shop: cfg.shop || {} };
}
function addPixel(p) {
  var target = {
    id: 'pixel-' + p.id, pixel: p, name: p.name, ready: false, dead: false, seen: {}, domEvents: !!p.domEvents, frame: null, failures: 0,
    allowed: function () { return mayRun(p); },
    send: function (ev) { if (target.frame && target.frame.contentWindow) target.frame.contentWindow.postMessage({ shopmePixel: 'event', event: ev }, '*'); },
  };
  targets.push(target);
  return target;
}
function mayRun(p) {
  var req = p.requiredConsent || [];
  for (var i = 0; i < req.length; i++) { if (!state.allowed[req[i]]) return false; }
  return !(p.respectSaleOptOut && !state.allowed.sale_of_data);
}
function syncPixels() {
  for (var i = 0; i < targets.length; i++) {
    var t = targets[i];
    if (!t.pixel) continue;
    var ok = mayRun(t.pixel);
    if (ok && !t.frame && !t.dead) { t.frame = startPixelFor(t); }
    else if (!ok && t.frame) { stopPixelFor(t); }
  }
}
function startPixelFor(t) {
  var f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-scripts');
  f.setAttribute('title', 'pixel ' + t.name);
  f.setAttribute('aria-hidden', 'true');
  f.setAttribute('tabindex', '-1');
  f.style.cssText = 'display:none;width:0;height:0;border:0;position:absolute';
  f.src = '/.shopme/pixels/' + t.pixel.id;
  t.ready = false;
  (document.body || document.documentElement).appendChild(f);
  return f;
}
function stopPixelFor(t) {
  if (t.frame && t.frame.parentNode) t.frame.parentNode.removeChild(t.frame);
  t.frame = null; t.ready = false; t.seen = {};
}
window.addEventListener('message', function (e) {
  var m = e && e.data;
  if (!m || !m.shopmePixel) return;
  var t = null;
  for (var i = 0; i < targets.length; i++) { if (targets[i].frame && targets[i].frame.contentWindow === e.source) { t = targets[i]; break; } }
  if (!t) return;
  if (m.shopmePixel === 'ready') {
    t.frame.contentWindow.postMessage({ shopmePixel: 'init', init: initData(), settings: (t.pixel && t.pixel.settings) || {} }, '*');
    t.ready = true;
    pump(t);
  } else if (m.shopmePixel === 'storage') {
    var res = storageOp(String(m.op || ''), m.args || []);
    t.frame.contentWindow.postMessage({ shopmePixel: 'storage-result', id: m.id, result: res }, '*');
  } else if (m.shopmePixel === 'error') {
    t.failures += 1;
    if (window.console && window.console.warn) window.console.warn('[shopme] pixel "' + t.name + '" failed: ' + m.message);
    if (t.failures >= 20) { t.dead = true; stopPixelFor(t); }
  }
});
(cfg.pixels || []).forEach(addPixel);

// ---------------------------------------------------------------------------------------------------------------------
// banner
// ---------------------------------------------------------------------------------------------------------------------
var L = cfg.labels || {};
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function buildDefaultBanner() {
  var el = document.createElement('div');
  el.setAttribute('data-consent-banner', '');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', L.title || 'Cookie consent');
  el.hidden = true;
  var pos = (cfg.banner && cfg.banner.position) || 'bottom';
  var place = pos === 'left' ? 'left:1rem;bottom:1rem;max-width:26rem;border-radius:12px' : pos === 'right' ? 'right:1rem;bottom:1rem;max-width:26rem;border-radius:12px' : 'left:0;right:0;bottom:0';
  el.style.cssText = 'position:fixed;' + place + ';z-index:2147483000;background:#fff;color:#111;border:1px solid #d4d4d4;box-shadow:0 -2px 14px rgba(0,0,0,.14);font:15px/1.45 system-ui,-apple-system,sans-serif;padding:1rem 1.25rem';
  var btn = 'font:inherit;padding:.5rem 1rem;border-radius:999px;border:1px solid #111;background:#fff;color:#111;cursor:pointer';
  var link = (cfg.policyUrls && cfg.policyUrls.privacy) ? ' <a href="' + esc(cfg.policyUrls.privacy) + '">' + esc(L.privacyPolicy || 'Privacy policy') + '</a>' : '';
  var cats = CATS.map(function (k) {
    return '<label style="display:flex;gap:.5rem;align-items:flex-start;margin:.4rem 0"><input type="checkbox" data-consent-category="' + k + '"> <span><strong>' + esc((L.categories || {})[k] || k) + '</strong><br><span style="color:#555">' + esc((L.categoryHelp || {})[k] || '') + '</span></span></label>';
  }).join('');
  el.innerHTML = '<div data-consent-main><p style="margin:0 0 .75rem">' + esc(cfg.banner && cfg.banner.message) + link + '</p><div style="display:flex;gap:.5rem;flex-wrap:wrap">'
    + '<button type="button" style="' + btn + '" data-consent-reject>' + esc(L.reject || 'Decline') + '</button>'
    + '<button type="button" style="' + btn + '" data-consent-manage>' + esc(L.manage || 'Manage preferences') + '</button>'
    + '<button type="button" style="' + btn + ';background:#111;color:#fff" data-consent-accept>' + esc(L.accept || 'Accept') + '</button></div></div>'
    + '<div data-consent-panel hidden><p style="margin:0 0 .5rem;font-weight:600">' + esc(L.managePreferences || 'Cookie preferences') + '</p>' + cats
    + '<div style="margin-top:.75rem"><button type="button" style="' + btn + ';background:#111;color:#fff" data-consent-save>' + esc(L.save || 'Save preferences') + '</button></div></div>';
  (document.body || document.documentElement).appendChild(el);
  return el;
}
function findBanner() {
  if (banner && banner.parentNode) return banner;
  banner = document.querySelector ? document.querySelector('[data-consent-banner]') : null;
  if (!banner && (state.show || state.forceShow)) banner = buildDefaultBanner();
  return banner;
}
/** A full-width bar fixed to the bottom would hide the end of the page (the checkout button): leave room for it while it is shown. */
function padForBanner(el, show) {
  try {
    var r = el.getBoundingClientRect();
    document.body.style.paddingBottom = show && r.width >= window.innerWidth * 0.9 && r.bottom >= window.innerHeight - 2 ? Math.ceil(r.height) + 'px' : '';
  } catch (e) { /* no layout (tests) */ }
}
function syncBanner() {
  var el = findBanner();
  if (!el) return;
  var show = state.show || state.forceShow;
  el.hidden = !show;
  padForBanner(el, show);
  var boxes = el.querySelectorAll ? el.querySelectorAll('[data-consent-category]') : [];
  for (var i = 0; i < boxes.length; i++) boxes[i].checked = !!state.allowed[boxes[i].getAttribute('data-consent-category')] && !!state.answers[boxes[i].getAttribute('data-consent-category')];
}
function all(v) { return { analytics: v, marketing: v, preferences: v, sale_of_data: v }; }
document.addEventListener('click', function (ev) {
  var t = ev.target && ev.target.closest ? ev.target.closest('[data-consent-accept],[data-consent-reject],[data-consent-manage],[data-consent-save],[data-consent-open]') : null;
  if (!t) return;
  if (t.hasAttribute('data-consent-accept')) { ev.preventDefault(); privacy.setTrackingConsent(all(true)); }
  else if (t.hasAttribute('data-consent-reject')) { ev.preventDefault(); privacy.setTrackingConsent(all(false)); }
  else if (t.hasAttribute('data-consent-manage')) {
    ev.preventDefault();
    var el = findBanner(); var panel = el && el.querySelector('[data-consent-panel]');
    if (panel) { panel.hidden = !panel.hidden; var first = panel.querySelector('input'); if (!panel.hidden && first && first.focus) first.focus(); padForBanner(el, true); }
  } else if (t.hasAttribute('data-consent-save')) {
    ev.preventDefault();
    var el2 = findBanner(); var c = { sale_of_data: true };
    var boxes = el2 ? el2.querySelectorAll('[data-consent-category]') : [];
    for (var i = 0; i < boxes.length; i++) c[boxes[i].getAttribute('data-consent-category')] = !!boxes[i].checked;
    c.sale_of_data = state.answers.sale_of_data === 'no' ? false : !!(c.marketing || c.analytics);
    privacy.setTrackingConsent(c);
  } else if (t.hasAttribute('data-consent-open')) {
    ev.preventDefault(); window.__shopmeShowBanner = true; refresh(false);
    var el3 = findBanner(); var p3 = el3 && el3.querySelector('[data-consent-panel]'); if (p3) p3.hidden = false;
  }
});

function refresh(collected) {
  state = compute();
  syncPixels();
  for (var i = 0; i < targets.length; i++) { if (targets[i].ready) pump(targets[i]); }
  syncBanner();
  if (collected) { emit('visitorConsentCollected', consentDetail()); if (privacy.userCanBeTracked()) emit('trackingConsentAccepted', consentDetail()); }
}

// ---------------------------------------------------------------------------------------------------------------------
// page events
// ---------------------------------------------------------------------------------------------------------------------
function money(cents) { return { amount: Math.round(Number(cents || 0)) / 100, currencyCode: cfg.currency || '' }; }
function onceKey(k) { try { if (window.sessionStorage.getItem(k)) return false; window.sessionStorage.setItem(k, '1'); return true; } catch (e) { return true; } }

function startPageEvents() {
  var page = cfg.page || {};
  publish('page_viewed', {});
  (page.events || []).forEach(function (e) { if (!e.once || onceKey('shopme_ev_' + e.once)) publish(e.name, e.data || {}); });
  // pending add to cart of a classic form post (the page reloaded before the event could be published)
  try {
    var pending = window.sessionStorage.getItem('shopme_pending_add');
    if (pending) { window.sessionStorage.removeItem('shopme_pending_add'); var p = JSON.parse(pending); publish('product_added_to_cart', { cartLine: { quantity: p.quantity, merchandise: { id: String(p.id) } } }); }
  } catch (e) { /* storage blocked */ }
}

function lineFromAdd(json) {
  var l = json && json.items ? json.items[0] : json;
  if (!l) return null;
  return { cartLine: {
    quantity: l.quantity, merchandise: { id: String(l.variant_id || l.id), title: l.variant_title || l.title, sku: l.sku || '', price: money(l.price), image: l.image ? { src: l.image } : null, product: { id: String(l.product_id || ''), title: l.product_title || l.title, vendor: l.vendor || '', type: l.product_type || '', url: l.url } },
    cost: { totalAmount: money(l.final_line_price != null ? l.final_line_price : l.line_price) },
  } };
}
if (window.fetch && !shopme._fetchPatched) {
  shopme._fetchPatched = true;
  var nativeFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    var p = nativeFetch.apply(this, arguments);
    if (method === 'POST' && /\/cart\/add(\.js)?(\?|$)/.test(url)) {
      p.then(function (res) { if (res && res.ok && res.clone) res.clone().json().then(function (j) { var d = lineFromAdd(j); if (d) publish('product_added_to_cart', d); }).catch(function () {}); }).catch(function () {});
    }
    return p;
  };
}
document.addEventListener('submit', function (ev) {
  var f = ev.target;
  if (!f || !f.getAttribute) return;
  var action = f.getAttribute('action') || '';
  if (/\/cart\/add(\?|$)/.test(action)) {
    // a classic (non-Ajax) form post leaves the page: remember it and publish on the next page
    setTimeout(function () {
      if (ev.defaultPrevented) return;
      try { var idEl = f.elements && f.elements.id; var qEl = f.elements && f.elements.quantity; window.sessionStorage.setItem('shopme_pending_add', JSON.stringify({ id: idEl ? idEl.value : '', quantity: qEl ? Number(qEl.value) || 1 : 1 })); } catch (e) { /* storage blocked */ }
    }, 0);
  }
  var tag = f.tagName ? f.tagName.toLowerCase() : 'form';
  if (hasDomPixels()) publish('form_submitted', { element: { id: f.id || '', tagName: tag, action: action } }, { type: 'dom' });
});
function hasDomPixels() { for (var i = 0; i < targets.length; i++) { if (targets[i].domEvents && targets[i].frame) return true; } return false; }
function elementInfo(el) {
  var type = el.type || '';
  return { id: el.id || '', tagName: el.tagName ? el.tagName.toLowerCase() : '', name: el.name || '', type: type, value: type === 'password' ? '' : String(el.value || '').slice(0, 200), href: el.href || '', innerText: String(el.innerText || '').slice(0, 100) };
}
document.addEventListener('click', function (ev) { if (hasDomPixels() && ev.target) publish('clicked', { element: elementInfo(ev.target) }, { type: 'dom' }); }, true);
document.addEventListener('focusin', function (ev) { if (hasDomPixels() && ev.target && ev.target.tagName === 'INPUT') publish('input_focused', { element: elementInfo(ev.target) }, { type: 'dom' }); });
document.addEventListener('focusout', function (ev) { if (hasDomPixels() && ev.target && ev.target.tagName === 'INPUT') publish('input_blurred', { element: elementInfo(ev.target) }, { type: 'dom' }); });
document.addEventListener('change', function (ev) { if (hasDomPixels() && ev.target && ev.target.tagName === 'INPUT') publish('input_changed', { element: elementInfo(ev.target) }, { type: 'dom' }); });

function ready() {
  refresh(false);
  startPageEvents();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
shopme._state = function () { return state; };
`;

/** Source served to browsers: the body wrapped as an immediately invoked function. */
export const RUNTIME_JS = `(function(window,document){${RUNTIME_BODY}})(window,document);`;
export const RUNTIME_VERSION = createHash('sha1').update(RUNTIME_JS).digest('hex').slice(0, 10);

/**
 * The sandbox document of a pixel. It is served with `Content-Security-Policy: sandbox allow-scripts` and framed with the same sandbox
 * attribute, so the code runs in a null origin: no access to the page, its DOM, cookies or storage. It talks to the page by messages only
 * (events in; storage requests out) and starts the merchant code once the page sent the init data.
 */
export function pixelDocument(p: { name: string; code: string }): string {
  const code = JSON.stringify(p.code).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${p.name.replace(/[<>&"]/g, '')}</title></head><body><script>
(function(){
var handlers={},pending={},n=0,started=false;
function post(m){parent.postMessage(m,'*')}
function call(op,args){return new Promise(function(res){n+=1;pending[n]=res;post({shopmePixel:'storage',id:n,op:op,args:args})})}
var analytics={subscribe:function(name,fn){(handlers[name]=handlers[name]||[]).push(fn);return function(){handlers[name]=(handlers[name]||[]).filter(function(f){return f!==fn})}}};
var browser={cookie:{get:function(k){return call('cookie.get',[k])},set:function(k,v){return call('cookie.set',[k,v])}},
localStorage:{getItem:function(k){return call('localStorage.getItem',[k])},setItem:function(k,v){return call('localStorage.setItem',[k,v])},removeItem:function(k){return call('localStorage.removeItem',[k])},clear:function(){return call('localStorage.clear',[])},key:function(i){return call('localStorage.key',[i])},length:function(){return call('localStorage.length',[])}},
sessionStorage:{getItem:function(k){return call('sessionStorage.getItem',[k])},setItem:function(k,v){return call('sessionStorage.setItem',[k,v])},removeItem:function(k){return call('sessionStorage.removeItem',[k])},clear:function(){return call('sessionStorage.clear',[])},key:function(i){return call('sessionStorage.key',[i])},length:function(){return call('sessionStorage.length',[])}}};
var init={},settings={};
var CODE=${code};
function run(){var s=document.createElement('script');s.text='(function(analytics,browser,init,settings){'+CODE+'\\n})(window.__px.analytics,window.__px.browser,window.__px.init,window.__px.settings);';document.body.appendChild(s)}
window.addEventListener('message',function(e){var m=e.data;if(!m||!m.shopmePixel)return;
if(m.shopmePixel==='init'&&!started){started=true;init=m.init||{};settings=m.settings||{};window.__px={analytics:analytics,browser:browser,init:init,settings:settings};try{run()}catch(err){post({shopmePixel:'error',message:String(err&&err.message||err)})}}
else if(m.shopmePixel==='event'){var ev=m.event;var fns=(handlers[ev.name]||[]).concat(handlers.all_events||[]);for(var i=0;i<fns.length;i++){try{var r=fns[i](ev);if(r&&r.catch)r.catch(function(x){post({shopmePixel:'error',message:String(x&&x.message||x)})})}catch(err){post({shopmePixel:'error',message:String(err&&err.message||err)})}}}
else if(m.shopmePixel==='storage-result'){var f=pending[m.id];if(f){delete pending[m.id];f(m.result)}}});
window.addEventListener('error',function(e){post({shopmePixel:'error',message:String(e.message||'error')})});
post({shopmePixel:'ready'});
})();
</script></body></html>`;
}
