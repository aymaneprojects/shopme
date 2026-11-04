import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { schema as s, seedDemo } from '@shopme/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../src/test-utils';

type Shape = Record<string, string>;
const fixtures = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/ajax-shapes.shape.json'), 'utf8')) as Record<string, { status: number; shape: Shape }>;

const typeOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
function walk(v: unknown, prefix: string, acc: Record<string, Set<string>>) {
  const t = typeOf(v);
  if (prefix) (acc[prefix] ??= new Set()).add(t);
  if (Array.isArray(v)) v.forEach((x) => walk(x, `${prefix}[]`, acc));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, prefix ? `${prefix}.${k}` : k, acc);
}

/** Every path of the recorded shape must exist in `body` (unless an ancestor array is empty) with a compatible JSON type. */
function expectShape(name: string, body: unknown, ignore: RegExp[] = []) {
  const got: Record<string, Set<string>> = {};
  walk(body, '', got);
  const problems: string[] = [];
  for (const [p, t] of Object.entries(fixtures[name]!.shape)) {
    if (ignore.some((r) => r.test(p)) || p.startsWith('sections.') || /(^|\.)(properties|attributes)\./.test(p)) continue; // user-defined keys
    const want = t.split('|');
    const have = got[p];
    if (!have) {
      const parents = [...p.matchAll(/\[\]/g)].map((m) => p.slice(0, m.index! + 2));
      if (!parents.some((x) => !got[x] || got[x].size === 0)) problems.push(`missing ${p}`);
      continue;
    }
    for (const h of have) {
      const ok = want.includes(h) || (h === 'integer' && want.includes('number')) || (h === 'number' && want.includes('integer')) || h === 'null' || want.includes('null');
      if (!ok) problems.push(`${p}: ${h} not in ${t}`);
    }
  }
  expect(problems, name).toEqual([]);
}

let t: TestApp;
let app: FastifyInstance;
const ids: Record<string, number> = {};

beforeAll(async () => {
  t = await createTestApp();
  app = t.app;
  await seedDemo(t.dbHandle.db, app.ctx.storage);
  for (const v of await t.dbHandle.db.select().from(s.productVariants)) if (v.sku) ids[v.sku] = v.id;
});
afterAll(async () => { await t.close(); });

/** A tiny cookie-keeping client. */
function client() {
  let cookie = '';
  const call = async (method: 'GET' | 'POST', url: string, body?: unknown, type?: 'json' | 'form' | 'multipart') => {
    const headers: Record<string, string> = cookie ? { cookie } : {};
    let payload: string | undefined;
    if (body !== undefined) {
      if (type === 'form') { headers['content-type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(body as Record<string, string>).toString(); }
      else if (type === 'multipart') {
        const b = '----t';
        headers['content-type'] = `multipart/form-data; boundary=${b}`;
        payload = Object.entries(body as Record<string, string>).map(([k, v]) => `--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join('') + `--${b}--\r\n`;
      } else { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    }
    const r = await app.inject({ method, url, headers, payload });
    const c = r.cookies.find((x) => x.name === 'cart');
    if (c) cookie = `cart=${c.value}`;
    let json: any;
    try { json = JSON.parse(r.body); } catch { json = undefined; }
    return { status: r.statusCode, json, headers: r.headers, body: r.body };
  };
  return { call, post: (u: string, b?: unknown, ty?: 'json' | 'form' | 'multipart') => call('POST', u, b ?? {}, ty), get: (u: string) => call('GET', u) };
}

describe('cart object and add', () => {
  it('empty cart shape and token format', async () => {
    const r = await client().get('/cart.js');
    expect(r.status).toBe(200);
    expect(r.json.token).toMatch(/^[A-Za-z0-9]{24}\?key=[0-9a-f]{32}$/);
    expectShape('05-cart-get-empty', r.json);
  });

  it('add.js: multi-item, single, form and multipart forms; merging and keys', async () => {
    const c = client();
    const V = ids['HEB-250']!;
    const multi = await c.post('/cart/add.js', { items: [{ id: V, quantity: 1 }] });
    expect(multi.status).toBe(200);
    expect(multi.headers['content-type']).toContain('text/javascript');
    expectShape('06-cart-add-json', multi.json);
    expect(multi.json.items[0].key).toMatch(/^\d+:[0-9a-f]{32}$/);

    const single = await c.post('/cart/add.js', { id: V, quantity: 1 });
    expectShape('09-cart-add-single-json', single.json);
    expect(single.json.quantity).toBe(2);

    const form = await c.post('/cart/add.js', { id: String(V), quantity: '1' }, 'form');
    expectShape('08-cart-add-form', form.json);
    expect(form.json.quantity).toBe(3);

    const multipart = await c.post('/cart/add', { id: String(V), quantity: '1', 'properties[gift]': 'yes', form_type: 'product' }, 'multipart');
    expect(multipart.status).toBe(200);
    expect(multipart.json.properties).toEqual({ gift: 'yes' });
    expect(multipart.json.key.split(':')[1]).not.toBe(single.json.key.split(':')[1]);

    const cart = (await c.get('/cart.js')).json;
    expect(cart.items).toHaveLength(2);
    expect(cart.items[0].properties).toEqual({ gift: 'yes' }); // newest line first
    expect(cart.item_count).toBe(4);
    expect(cart.total_price).toBe(cart.items.reduce((n: number, i: any) => n + i.final_line_price, 0));
    expect(cart.total_discount).toBe(cart.original_total_price - cart.total_price);
  });

  it('add.js sections in body returns section HTML wrappers', async () => {
    const c = client();
    const r = await c.post('/cart/add.js', { items: [{ id: ids['JPG-50'], quantity: 1 }], sections: 'header', sections_url: '/cart' });
    expect(r.json.sections.header).toMatch(/^<div id="shopify-section-header"/);
    expectShape('29-cart-add-sections-json', r.json);
  });

  it('GET /cart/add.js adds, GET /cart/clear.js clears', async () => {
    const c = client();
    expect((await c.get(`/cart/add.js?id=${ids['JPG-50']}&quantity=2`)).json.quantity).toBe(2);
    const cleared = await c.get('/cart/clear.js');
    expect(cleared.json.items).toEqual([]);
  });
});

describe('inventory enforcement', () => {
  it('sold out variant: 422 with title', async () => {
    const r = await client().post('/cart/add.js', { items: [{ id: ids['HMC-1K-FL'], quantity: 1 }] });
    expect(r.status).toBe(422);
    expect(r.json.status).toBe(422);
    expect(r.json.message).toMatch(/^The product 'Highland Morning Coffee Beans' is already sold out\.$/);
    expectShape('61-cart-add-oos', r.json);
  });

  it('over-stock add adds up to stock and answers 422; adding at the maximum says so', async () => {
    const c = client();
    const V = ids['CPD-SL']!; // stock 5
    const r = await c.post('/cart/add.js', { items: [{ id: V, quantity: 999 }] });
    expect(r.status).toBe(422);
    expect(r.json.message).toBe('Only 5 items were added to your cart due to availability.');
    expectShape('63-cart-add-over-stock', r.json);
    expect((await c.get('/cart.js')).json.item_count).toBe(5);
    const again = await c.post('/cart/add.js', { items: [{ id: V, quantity: 1 }] });
    expect(again.status).toBe(422);
    expect(again.json.message).toBe('The maximum quantity of this item is already in your cart.');
    expect((await c.post('/cart/add.js', { items: [{ id: V, quantity: 0 }] })).status).toBe(422);
  });

  it('quantity 0 on an empty cart is a no-op', async () => {
    const r = await client().post('/cart/add.js', { items: [{ id: ids['JPG-50'], quantity: 0 }] });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ items: [] });
  });

  it('change.js enforces stock, update.js does not', async () => {
    const c = client();
    const V = ids['CPD-CR']!; // stock 8
    await c.post('/cart/add.js', { id: V, quantity: 1 });
    const over = await c.post('/cart/change.js', { line: 1, quantity: 50 });
    expect(over.status).toBe(422);
    expect(over.json.message).toBe('Only 8 items were added to your cart due to availability.');
    expectShape('80-cart-change-over-stock', over.json);
    expect((await c.get('/cart.js')).json.item_count).toBe(1);
    const upd = await c.post('/cart/update.js', { updates: { [V]: 50 } });
    expect(upd.status).toBe(200);
    expect(upd.json.item_count).toBe(50);
    expect(upd.json.items_changelog).toEqual({ added: [{ variant_id: V, quantity: 49 }] });
    expectShape('81-cart-update-over-stock', upd.json);
  });
});

describe('errors', () => {
  it('unknown variant, empty body, bad items', async () => {
    const c = client();
    const unknown = await c.post('/cart/add.js', { items: [{ id: 999999, quantity: 1 }] });
    expect(unknown.status).toBe(422);
    expect(unknown.json).toEqual({ status: 422, message: 'Cart Error', description: 'Cannot find variant' });
    expectShape('65-cart-add-unknown-variant', unknown.json);
    const none = await c.post('/cart/add.js', {});
    expect(none.status).toBe(400);
    expect(none.json).toEqual({ status: 'bad_request', message: 'Parameter Missing or Invalid', description: 'Required parameter missing or invalid: items' });
    const garbage = await c.post('/cart/add.js', { items: 'garbage' }, 'form');
    expect(garbage.status).toBe(400);
    expect(garbage.json.message).toBe('must be a collection of items: items');
    const upd = await c.post('/cart/update.js', { updates: { 999999: 1 } });
    expect(upd.status).toBe(422);
    expect(upd.json.description).toBe('Cannot find variant');
  });
});

describe('change, update, clear', () => {
  it('change by line, key, variant id and form; deltas; invalid line', async () => {
    const c = client();
    const V = ids['HEB-1K']!;
    await c.post('/cart/add.js', { id: V, quantity: 3 });
    await c.post('/cart/add.js', { id: ids['JPG-50'], quantity: 1 });
    // JPG-50 is now line 1 (newest first)
    const byLine = await c.post('/cart/change.js', { line: 2, quantity: 2 });
    expect(byLine.status).toBe(200);
    expect(byLine.json.items_removed[0].quantity).toBe(1);
    expect(byLine.json.items_added).toEqual([]);
    expectShape('12-cart-change-by-line', byLine.json);
    const key = byLine.json.items.find((i: any) => i.variant_id === V).key;
    const byKey = await c.post('/cart/change.js', { id: key, quantity: 4 });
    expect(byKey.json.items_added[0].quantity).toBe(2);
    const byVariant = await c.post('/cart/change.js', { id: String(V), quantity: 1 });
    expect(byVariant.json.items.find((i: any) => i.variant_id === V).quantity).toBe(1);
    const form = await c.post('/cart/change.js', { line: '1', quantity: '0' }, 'form');
    expect(form.json.items).toHaveLength(1);
    const bad = await c.post('/cart/change.js', { line: 9, quantity: 1 });
    expect(bad.status).toBe(422);
    expect(bad.json).toEqual({ status: 'unprocessable_entity', message: 'line parameter is invalid.', description: 'line parameter is invalid.' });
    expectShape('18-cart-change-bad-line', bad.json);
  });

  it('change with properties re-keys the line', async () => {
    const c = client();
    const first = await c.post('/cart/add.js', { id: ids['JPG-50'], quantity: 1 });
    const r = await c.post('/cart/change.js', { line: 1, properties: { engraving: 'hi' } });
    expect(r.json.items[0].properties).toEqual({ engraving: 'hi' });
    expect(r.json.items[0].key).not.toBe(first.json.key);
  });

  it('update by array and map, note and attributes (merge, delete), clear keeps note and token', async () => {
    const c = client();
    await c.post('/cart/add.js', { id: ids['JPG-50'], quantity: 1 });
    await c.post('/cart/add.js', { id: ids['SEG-75'], quantity: 1 });
    const arr = await c.post('/cart/update.js', { updates: [3, 0] });
    expect(arr.json.items).toHaveLength(1);
    expect(arr.json.items[0].quantity).toBe(3);
    expectShape('21-cart-update-array', arr.json);
    const map = await c.post('/cart/update.js', { updates: { [ids['JPG-50']!]: 2 } });
    expect(map.json.item_count).toBe(5); // line 1 (SEG-75) kept its 3; JPG-50 was removed above, so this adds it back
    expect(map.json.items_changelog).toEqual({ added: [{ variant_id: ids['JPG-50'], quantity: 2 }] });
    const na = await c.post('/cart/update.js', { note: 'hello', attributes: { a: '1', b: '2' } });
    expect(na.json.note).toBe('hello');
    const del = await c.post('/cart/update.js', { attributes: { a: '' } });
    expect(del.json.attributes).toEqual({ b: '2' });
    const formNote = await c.post('/cart/update.js', { note: 'form note', 'attributes[k]': 'v' }, 'form');
    expect(formNote.json.attributes).toEqual({ b: '2', k: 'v' });
    const token = formNote.json.token;
    const cleared = await c.post('/cart/clear.js');
    expect(cleared.json.items).toEqual([]);
    expect(cleared.json.token).toBe(token);
    expect(cleared.json.note).toBe('form note');
    expect(cleared.json.attributes).toEqual({ b: '2', k: 'v' });
    expect(cleared.json.requires_shipping).toBe(false);
    expectShape('39-cart-get-after-clear', cleared.json);
  });

  it('update sections', async () => {
    const c = client();
    await c.post('/cart/add.js', { id: ids['JPG-50'], quantity: 1 });
    const r = await c.post('/cart/update.js', { updates: [2], sections: 'header,footer' });
    expect(Object.keys(r.json.sections).sort()).toEqual(['footer', 'header']);
  });
});

describe('catalog json endpoints', () => {
  it('product .js has minor-unit prices, .json decimal strings, 404 is empty', async () => {
    const js = await app.inject('/products/house-espresso-blend.js');
    const j = JSON.parse(js.body);
    expectShape('01-product-js', j, [/^variants\[\]\.featured_image\./, /^media/, /^featured_image/, /^images/]);
    expect(Number.isInteger(j.price)).toBe(true);
    const json = JSON.parse((await app.inject('/products/house-espresso-blend.json')).body);
    expect(typeof json.product.variants[0].price).toBe('string');
    expect(json.product.variants[0].price).toBe('13.00');
    for (const u of ['/products/nope.js', '/products/nope.json']) {
      const r = await app.inject(u);
      expect(r.statusCode).toBe(404);
      expect(r.body).toBe('');
    }
  });

  it('collections/all/products.json paginates; collections.json; suggest; recommendations', async () => {
    const all = JSON.parse((await app.inject('/collections/all/products.json')).body);
    expect(all.products).toHaveLength(5);
    expect(typeof all.products[0].variants[0].price).toBe('string');
    const page2 = JSON.parse((await app.inject('/collections/all/products.json?limit=2&page=2')).body);
    expect(page2.products).toHaveLength(2);
    expect(JSON.parse((await app.inject('/products.json?limit=2')).body).products).toHaveLength(2);
    expectShape('46-collections-json', JSON.parse((await app.inject('/collections.json')).body), [/image/, /description/, /updated_at/]);
    const sug = JSON.parse((await app.inject('/search/suggest.json?q=tea&resources[type]=product&resources[limit]=3')).body);
    expect(Object.keys(sug.resources.results)).toEqual(['products']);
    expect(sug.resources.results.products[0].url).toMatch(/\?_pos=1&_psq=tea&_psid=\d+$/);
    const multi = JSON.parse((await app.inject('/search/suggest.json?q=zzz&resources[type]=product,collection,page,article')).body);
    expect(Object.keys(multi.resources.results).sort()).toEqual(['articles', 'collections', 'pages', 'products']);
    const rec = JSON.parse((await app.inject('/recommendations/products.json?product_id=2&limit=3')).body);
    expect(rec.intent).toBe('related');
    expect(rec.products.length).toBeGreaterThan(0);
    expect(rec.products.every((p: any) => p.id !== 2)).toBe(true);
  });
});
