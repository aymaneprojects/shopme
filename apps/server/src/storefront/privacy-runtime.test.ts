import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RUNTIME_BODY, pixelDocument } from './privacy-runtime';

/** A just-enough browser: cookies, an element tree for iframes and the banner, message events, sendBeacon. */
function browser(config: Record<string, unknown>, cookie = '') {
  const listeners = new Map<string, Array<(e: any) => void>>();
  const on = (type: string, fn: (e: any) => void) => listeners.set(type, [...(listeners.get(type) ?? []), fn]);
  const frames: any[] = [];
  const beacons: any[] = [];
  const fetches: string[] = [];
  const make = (tag: string): any => {
    const el: any = {
      tagName: tag.toUpperCase(), attrs: {} as Record<string, string>, style: {}, children: [] as any[], parentNode: null, hidden: false, innerHTML: '',
      setAttribute(k: string, v: string) { el.attrs[k] = v; }, getAttribute(k: string) { return el.attrs[k] ?? null; }, hasAttribute(k: string) { return k in el.attrs; },
      appendChild(c: any) { c.parentNode = el; el.children.push(c); if (c.tagName === 'IFRAME') { c.contentWindow = { messages: [] as any[], postMessage(m: unknown) { c.contentWindow.messages.push(m); } }; frames.push(c); } return c; },
      querySelector: () => null, querySelectorAll: () => [],
    };
    return el;
  };
  const body = make('body');
  body.removeChild = (c: any) => { body.children = body.children.filter((x: any) => x !== c); c.parentNode = null; const i = frames.indexOf(c); if (i >= 0) frames.splice(i, 1); };
  const state = { cookie };
  const fakeDocument: any = {
    getElementById: (id: string) => (id === 'shopme-privacy-config' ? { textContent: JSON.stringify(config) } : null),
    get cookie() { return state.cookie; },
    set cookie(v: string) { const [pair] = v.split(';'); const [name] = pair!.split('='); state.cookie = [...state.cookie.split('; ').filter((c) => c && !c.startsWith(`${name}=`)), pair].join('; '); },
    createElement: make, body, documentElement: body, readyState: 'complete', referrer: '', title: 'T', characterSet: 'UTF-8', visibilityState: 'visible',
    addEventListener: on, dispatchEvent: () => true, querySelector: () => null,
  };
  const fakeWindow: any = {
    location: { href: 'https://shop.test/products/x', pathname: '/products/x', search: '', hash: '', origin: 'https://shop.test', host: 'shop.test', hostname: 'shop.test', protocol: 'https:' },
    navigator: { language: 'en', cookieEnabled: true, userAgent: 'test', sendBeacon: (url: string, blob: any) => { beacons.push({ url, blob }); return true; } },
    screen: { width: 100, height: 100 }, innerWidth: 100, innerHeight: 100, addEventListener: on,
    fetch: (url: string) => { fetches.push(url); return Promise.resolve({ ok: true }); },
    Blob: class { constructor(public parts: string[]) {} }, sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: 'Europe/Paris' }) }) },
  };
  new Function('window', 'document', RUNTIME_BODY)(fakeWindow, fakeDocument);
  const fire = (type: string, e: unknown) => (listeners.get(type) ?? []).forEach((fn) => fn(e));
  return { window: fakeWindow, document: fakeDocument, frames, beacons, fetches, fire, state };
}

const cfg = (over: Record<string, unknown> = {}) => ({
  cookie: { name: '_shopme_consent', version: 1, maxAge: 100 }, policy: { consentRequired: true, level: 'OPT_IN', bannerMode: 'AUTO', gpc: false, dataSaleOptOutRequired: false },
  endpoints: { consent: '/.shopme/consent', events: '/.shopme/events' }, banner: { message: 'We use cookies', position: 'bottom' }, labels: {}, page: { type: 'index', events: [] },
  pixels: [{ id: 7, name: 'Ads', requiredConsent: ['marketing'], respectSaleOptOut: true, domEvents: false, settings: {} }], shop: { currency: 'EUR' }, ...over,
});

describe('customer privacy runtime', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('exposes the Shopify.customerPrivacy API with consent states as yes / no / empty strings', () => {
    const b = browser(cfg());
    const p = b.window.Shopify.customerPrivacy;
    expect(p.shouldShowBanner()).toBe(true);
    expect(p.currentVisitorConsent()).toEqual({ analytics: '', marketing: '', preferences: '', sale_of_data: '' });
    expect(p.analyticsProcessingAllowed()).toBe(false);
    expect(p.userCanBeTracked()).toBe(false);
    const done = vi.fn();
    p.setTrackingConsent({ analytics: true, marketing: false, preferences: 'yes', sale_of_data: true }, done);
    expect(done).toHaveBeenCalled();
    expect(p.currentVisitorConsent()).toEqual({ analytics: 'yes', marketing: 'no', preferences: 'yes', sale_of_data: 'yes' });
    expect(p.analyticsProcessingAllowed()).toBe(true);
    expect(p.marketingAllowed()).toBe(false);
    expect(p.shouldShowBanner()).toBe(false);
    expect(b.state.cookie).toContain('_shopme_consent=');
    expect(b.window.shopme.consent).toBe(p);
  });

  it('allows everything where consent is not required until the visitor says no', () => {
    const b = browser(cfg({ policy: { consentRequired: false, level: 'NONE', bannerMode: 'AUTO', gpc: false, dataSaleOptOutRequired: false } }));
    const p = b.window.Shopify.customerPrivacy;
    expect(p.shouldShowBanner()).toBe(false);
    expect(p.analyticsProcessingAllowed()).toBe(true);
    p.setTrackingConsent({ analytics: false });
    expect(p.analyticsProcessingAllowed()).toBe(false);
    expect(p.marketingAllowed()).toBe(true);
  });

  it('starts a pixel only after its consent exists, replays earlier events in order with their timestamps, and removes it on withdrawal', () => {
    const b = browser(cfg());
    const first = b.window.shopme.analytics.publish('page_viewed', { n: 1 });
    const second = b.window.shopme.analytics.publish('product_viewed', { n: 2 });
    expect(b.frames).toHaveLength(0); // no marketing consent: no frame at all
    b.window.Shopify.customerPrivacy.setTrackingConsent({ marketing: true, analytics: false });
    expect(b.frames).toHaveLength(1);
    const frame = b.frames[0];
    expect(frame.attrs.sandbox).toBe('allow-scripts'); // a null origin: never allow-same-origin
    expect(frame.attrs.sandbox).not.toContain('same-origin');
    expect(frame.src).toBe('/.shopme/pixels/7');
    expect(frame.contentWindow.messages).toEqual([]); // not delivered before the frame says it is ready
    b.fire('message', { source: frame.contentWindow, data: { shopmePixel: 'ready' } });
    const sent = frame.contentWindow.messages;
    expect(sent[0]).toMatchObject({ shopmePixel: 'init' });
    const events = sent.filter((m: any) => m.shopmePixel === 'event').map((m: any) => m.event);
    expect(events.map((e: any) => e.name)).toEqual(['page_viewed', 'page_viewed', 'product_viewed']); // the page's own event, then the two published above
    expect(events.slice(1).map((e: any) => e.id)).toEqual([first!.id, second!.id]);
    expect(events[1].timestamp).toBe(first!.timestamp);
    const later = b.window.shopme.analytics.publish('collection_viewed', {});
    expect(frame.contentWindow.messages.at(-1).event.id).toBe(later!.id);
    expect(frame.contentWindow.messages.filter((m: any) => m.shopmePixel === 'event')).toHaveLength(4); // no duplicates
    b.window.Shopify.customerPrivacy.setTrackingConsent({ marketing: false });
    expect(b.frames).toHaveLength(0);
  });

  it('only talks to the pixel frame it created and answers storage requests for it', () => {
    const b = browser(cfg());
    b.window.Shopify.customerPrivacy.setTrackingConsent({ marketing: true });
    const frame = b.frames[0];
    const stranger = { postMessage: vi.fn() };
    b.fire('message', { source: stranger, data: { shopmePixel: 'ready' } });
    expect(stranger.postMessage).not.toHaveBeenCalled();
    b.fire('message', { source: frame.contentWindow, data: { shopmePixel: 'ready' } });
    b.fire('message', { source: frame.contentWindow, data: { shopmePixel: 'storage', id: 5, op: 'cookie.set', args: ['k', 'v'] } });
    b.fire('message', { source: frame.contentWindow, data: { shopmePixel: 'storage', id: 6, op: 'cookie.get', args: ['k'] } });
    const results = frame.contentWindow.messages.filter((m: any) => m.shopmePixel === 'storage-result');
    expect(results.map((r: any) => r.result)).toEqual(['OK', 'v']);
  });

  it('disables a pixel after 20 failures', () => {
    const b = browser(cfg({ pixels: [{ id: 3, name: 'Flaky', requiredConsent: [], respectSaleOptOut: false, domEvents: false, settings: {} }] }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(b.frames).toHaveLength(1); // no category required: runs for everyone
    const frame = b.frames[0];
    for (let i = 0; i < 20; i++) b.fire('message', { source: frame.contentWindow, data: { shopmePixel: 'error', message: 'boom' } });
    expect(b.frames).toHaveLength(0);
  });

  it('respects the sale opt-out for pixels that ask for it', () => {
    const b = browser(cfg({ policy: { consentRequired: false, level: 'NONE', bannerMode: 'AUTO', gpc: true, dataSaleOptOutRequired: true }, pixels: [{ id: 4, name: 'Sale', requiredConsent: [], respectSaleOptOut: true, domEvents: false, settings: {} }] }));
    expect(b.window.Shopify.customerPrivacy.saleOfDataAllowed()).toBe(false);
    expect(b.frames).toHaveLength(0);
  });

  it('feeds the first-party stream only while analytics consent is granted, replaying what happened before', async () => {
    const b = browser(cfg({ pixels: [] }));
    b.window.shopme.analytics.publish('page_viewed', {});
    vi.advanceTimersByTime(5000);
    expect(b.beacons).toHaveLength(0); // consent required and not given
    b.window.Shopify.customerPrivacy.setTrackingConsent({ analytics: true });
    vi.advanceTimersByTime(5000);
    expect(b.beacons).toHaveLength(1);
    expect(b.beacons[0].url).toBe('/.shopme/events');
    const body = JSON.parse(b.beacons[0].blob.parts[0]);
    const sent = body.events;
    expect(sent.map((e: any) => e.name)).toEqual(['page_viewed', 'page_viewed']);
    expect(body.tz).toBe('Europe/Paris'); // only the time zone: the server keeps the country it maps to
    b.window.Shopify.customerPrivacy.setTrackingConsent({ analytics: false });
    b.window.shopme.analytics.publish('product_viewed', {});
    vi.advanceTimersByTime(5000);
    expect(b.beacons).toHaveLength(1);
  });

  it('publishes the page events the server describes, with in-page subscribers always served', () => {
    const b = browser(cfg({ pixels: [], page: { type: 'product', events: [{ name: 'product_viewed', data: { productVariant: { id: '9' } } }] } }));
    const seen: string[] = [];
    b.window.shopme.analytics.subscribe('all_events', (e: any) => seen.push(e.name));
    expect(b.window.shopme._buffer.map((e: any) => e.name)).toEqual(['page_viewed', 'product_viewed']);
    b.window.Shopify.analytics.publish('custom_thing', { x: 1 });
    expect(seen).toEqual(['custom_thing']);
    expect(b.window.shopme._buffer.length).toBeLessThanOrEqual(100);
  });

  it('keeps at most 100 events for replay, newest winning', () => {
    const b = browser(cfg({ pixels: [] }));
    for (let i = 0; i < 130; i++) b.window.shopme.analytics.publish('page_viewed', { i });
    const buf = b.window.shopme._buffer;
    expect(buf).toHaveLength(100);
    expect(buf.at(-1).data.i).toBe(129);
  });
});

describe('pixel sandbox document', () => {
  it('escapes the merchant code into a JSON string so it cannot close the script tag', () => {
    const doc = pixelDocument({ name: 'x<y', code: 'var a = "</script><script>alert(1)</script>";' });
    expect(doc).not.toContain('</script><script>alert(1)');
    expect(doc).toContain('\\u003c/script');
    expect(doc).toContain("shopmePixel:'ready'");
    expect(doc).toContain('<title>xy</title>');
  });
});
