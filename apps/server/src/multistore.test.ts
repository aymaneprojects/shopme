import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { and, eq, getTableColumns, getTableName, is, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import {
  getNamedType, getNullableType, isEnumType, isInputObjectType, isInterfaceType, isListType, isNonNullType, isObjectType, isScalarType, isUnionType,
  type GraphQLField, type GraphQLInputType,
} from 'graphql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticateAccount, createAccount, createStaffUser, exportStore, inviteStaff, recordDeliveries, registerCustomer, saveUpload, schema as s, type DbHandle } from '@shopme/core';
import { schema as gqlSchema } from './admin/graphql/schema';
import { setTxtResolver } from './admin/stores-routes';
import { activeShopIds } from './jobs';
import { createTestApp, type TestApp } from './test-utils';

/**
 * Multi-store isolation. Two stores (Alpha, owned by Alice who is the platform owner; Beta, owned by Bob) and one account
 * (Carol) that is staff of both. Everything that belongs to Beta carries the marker below, so a leak shows up in any response.
 */
const MARK = 'BETAMARK';
const ADMIN = 'localhost';
const A = 'alpha-store';
const B = 'beta-shop';
const AH = `${A}.shops.test`;
const BH = `${B}.shops.test`;

let t: TestApp;
let db: DbHandle['db'];
let alice: string, bob: string, carol: string;
let shopA: number, shopB: number;
const ids: Record<string, string> = {};

type Inject = { method?: string; url: string; host?: string; cookie?: string; payload?: unknown; headers?: Record<string, string>; customer?: string };
const req = (o: Inject) => t.app.inject({
  method: (o.method ?? 'GET') as 'GET', url: o.url, payload: o.payload as never,
  headers: { host: o.host ?? ADMIN, ...(o.headers ?? {}) },
  cookies: { ...(o.cookie ? { shopme_session: o.cookie } : {}), ...(o.customer ? { shopme_customer: o.customer } : {}) },
});
const gql = async (cookie: string, handle: string, query: string, variables: Record<string, unknown> = {}) => {
  const r = await req({ method: 'POST', url: `/admin/store/${handle}/api/2026-10/graphql.json`, cookie, payload: { query, variables } });
  return { status: r.statusCode, body: r.json() as { data?: any; errors?: { message: string; extensions?: { code?: string } }[] } };
};
const ok = async (cookie: string, handle: string, query: string, variables: Record<string, unknown> = {}) => {
  const r = await gql(cookie, handle, query, variables);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(r.body.errors, JSON.stringify(r.body.errors)).toBeUndefined();
  return r.body.data;
};
const cookieOf = (res: Awaited<ReturnType<typeof req>>) => res.cookies.find((c) => c.name === 'shopme_session')!.value;
const login = async (email: string, password: string, host = ADMIN) => {
  const r = await req({ method: 'POST', url: '/admin/api/auth/login', host, payload: { email, password } });
  expect(r.statusCode, r.body).toBe(200);
  return cookieOf(r);
};

/** Every row of every table that belongs to a store (hash): proves nothing touched it. */
async function fingerprint(shopId: number): Promise<{ hash: string; rows: number }> {
  const h = createHash('sha256');
  let rows = 0;
  const tables = Object.values(s as Record<string, unknown>).filter((v): v is PgTable => is(v, PgTable)).sort((a, b) => getTableName(a).localeCompare(getTableName(b)));
  for (const table of tables) {
    const col = Object.entries(getTableColumns(table)).find(([, c]) => (c as { name: string }).name === 'shop_id');
    if (!col || getTableName(table) === 'sessions') continue;
    const list = await db.select().from(table).where(eq(col[1] as never, shopId));
    const sorted = list.map((r) => JSON.stringify(r)).sort();
    rows += sorted.length;
    h.update(`${getTableName(table)}:${sorted.join('\n')}`);
  }
  const [shop] = await db.select().from(s.shops).where(eq(s.shops.id, shopId));
  h.update(JSON.stringify(shop ?? null));
  return { hash: h.digest('hex'), rows };
}

const PRODUCT = `mutation($p: ProductCreateInput!) { productCreate(product: $p) { product { id handle variants(first: 1) { nodes { id } } } userErrors { message } } }`;

beforeAll(async () => {
  t = await createTestApp({ MULTI_STORE: 'true', STRIPE_SECRET_KEY: '', STRIPE_PUBLISHABLE_KEY: '', STRIPE_WEBHOOK_SECRET: '' });
  db = t.dbHandle.db;
  // Alice sets up the installation: first account (platform owner) and the Alpha store.
  const setup = await req({ method: 'POST', url: '/admin/api/setup', payload: { shopName: 'Alpha Store', email: 'alice@example.com', password: 'alice-password', currency: 'EUR', country: 'FR', locale: 'en' } });
  expect(setup.statusCode, setup.body).toBe(201);
  expect(setup.json().storeHandle).toBe(A);
  alice = cookieOf(setup);
  expect((await req({ method: 'PUT', url: '/admin/api/platform/settings', cookie: alice, payload: { storeCreation: 'EVERYONE' } })).statusCode).toBe(200);
  // Bob has an account and no store yet; he creates Beta.
  await createAccount(db, { email: 'bob@example.com', password: 'bob-password' });
  bob = await login('bob@example.com', 'bob-password');
  const created = await req({ method: 'POST', url: '/admin/api/account/stores', cookie: bob, payload: { shopName: 'Beta Shop', currency: 'USD', country: 'US', locale: 'en' } });
  expect(created.statusCode, created.body).toBe(201);
  expect(created.json().store.handle).toBe(B);
  shopA = (await db.select().from(s.shops).where(eq(s.shops.handle, A)))[0]!.id;
  shopB = (await db.select().from(s.shops).where(eq(s.shops.handle, B)))[0]!.id;
  // Carol: invited to Alpha (new account), then to Beta, joined with the same account by proving its password.
  const invA = await inviteStaff(db, shopA, { email: 'carol@example.com', role: 'admin' });
  const accA = await req({ method: 'POST', url: '/admin/api/staff/accept-invite', payload: { token: invA.ok && invA.value.token, password: 'carol-password' } });
  expect(accA.statusCode, accA.body).toBe(200);
  const invB = await inviteStaff(db, shopB, { email: 'carol@example.com', role: 'admin' });
  const wrong = await req({ method: 'POST', url: '/admin/api/staff/accept-invite', payload: { token: invB.ok && invB.value.token, password: 'not-carols-password' } });
  expect(wrong.statusCode).toBe(422);
  const accB = await req({ method: 'POST', url: '/admin/api/staff/accept-invite', payload: { token: invB.ok && invB.value.token, password: 'carol-password' } });
  expect(accB.statusCode, accB.body).toBe(200);
  carol = await login('carol@example.com', 'carol-password');

  // Data in both stores; Beta's carries the marker.
  for (const [cookie, handle, key, mark] of [[alice, A, 'a', 'Alpha'], [bob, B, 'b', MARK]] as const) {
    const p = (await ok(cookie, handle, PRODUCT, { p: { title: `${mark} Board`, status: 'ACTIVE' } })).productCreate.product;
    ids[`${key}Product`] = p.id; ids[`${key}Variant`] = p.variants.nodes[0].id; ids[`${key}Handle`] = p.handle;
    ids[`${key}Customer`] = (await ok(cookie, handle, `mutation { customerCreate(input: { email: "${key}-buyer@example.com", firstName: "${mark}", lastName: "Buyer" }) { customer { id } userErrors { message } } }`)).customerCreate.customer.id;
    ids[`${key}Collection`] = (await ok(cookie, handle, `mutation { collectionCreate(input: { title: "${mark} picks" }) { collection { id } userErrors { message } } }`)).collectionCreate.collection.id;
    const draft = (await ok(cookie, handle, `mutation { draftOrderCreate(input: { email: "${key}-buyer@example.com", note: "${mark}", lineItems: [{ title: "${mark} item", quantity: 1, originalUnitPrice: "12.00" }] }) { draftOrder { id } userErrors { message } } }`)).draftOrderCreate.draftOrder;
    ids[`${key}Draft`] = draft.id;
    const done = (await ok(cookie, handle, `mutation($id: ID!) { draftOrderComplete(id: $id, paymentPending: true) { draftOrder { order { id } } userErrors { message } } }`, { id: draft.id })).draftOrderComplete;
    ids[`${key}Order`] = done.draftOrder.order.id;
    ids[`${key}Draft2`] = (await ok(cookie, handle, `mutation { draftOrderCreate(input: { email: "${key}-buyer@example.com", note: "${mark} open", lineItems: [{ title: "${mark} other", quantity: 1, originalUnitPrice: "5.00" }] }) { draftOrder { id } userErrors { message } } }`)).draftOrderCreate.draftOrder.id;
    ids[`${key}Discount`] = (await ok(cookie, handle, `mutation { discountCodeBasicCreate(basicCodeDiscount: { title: "${mark} ten", code: "${mark}10", startsAt: "2026-01-01T00:00:00Z", customerGets: { value: { percentage: 0.1 }, items: { all: true } } }) { codeDiscountNode { id } userErrors { message } } }`)).discountCodeBasicCreate.codeDiscountNode.id;
    ids[`${key}Page`] = (await ok(cookie, handle, `mutation { pageCreate(page: { title: "${mark} about", body: "${mark}", isPublished: true }) { page { id } userErrors { message } } }`)).pageCreate.page.id;
    ids[`${key}Webhook`] = (await ok(cookie, handle, `mutation { webhookSubscriptionCreate(topic: PRODUCTS_CREATE, webhookSubscription: { callbackUrl: "https://hooks.example.com/${key}", format: JSON }) { webhookSubscription { id } userErrors { message } } }`)).webhookSubscriptionCreate.webhookSubscription.id;
  }
  const file = await saveUpload(db, t.app.ctx.storageFor(shopB), shopB, { filename: `${MARK}.txt`, data: Buffer.from(`${MARK} file`), mimeType: 'text/plain' });
  ids.bFileUrl = file.url;
  ids.bFile = `gid://shopify/GenericFile/${file.id}`;
  const theme = (await db.select().from(s.themes).where(eq(s.themes.shopId, shopB)))[0]!;
  ids.bThemeId = String(theme.id);
  ids.bTheme = `gid://shopify/OnlineStoreTheme/${theme.id}`;
}, 240_000);
afterAll(async () => { setTxtResolver(undefined); await t?.close(); });

describe('accounts and the account menu', () => {
  it('lists the stores of each account; Carol is one account in both stores', async () => {
    const me = async (cookie: string, handle?: string) => (await req({ url: handle ? `/admin/store/${handle}/api/auth/me` : '/admin/api/auth/me', cookie })).json();
    expect((await me(alice)).stores.map((x: { handle: string }) => x.handle)).toEqual([A]);
    expect((await me(bob)).stores.map((x: { handle: string }) => x.handle)).toEqual([B]);
    const c = await me(carol, B);
    expect(c.stores.map((x: { handle: string }) => x.handle)).toEqual([A, B]);
    expect(c.shop.handle).toBe(B);
    expect(c.user.role).toBe('admin');
    expect(c.account.email).toBe('carol@example.com');
    expect((await me(alice)).account.platformOwner).toBe(true);
    expect((await me(bob)).account.platformOwner).toBe(false);
    const accounts = await db.select().from(s.platformAccounts).where(eq(s.platformAccounts.email, 'carol@example.com'));
    expect(accounts).toHaveLength(1);
    const members = await db.select().from(s.staffUsers).where(eq(s.staffUsers.accountId, accounts[0]!.id));
    expect(members.map((m) => m.shopId).sort()).toEqual([shopA, shopB].sort());
  });

  it('never merges same-email accounts of two stores unless the password proves both', async () => {
    const one = await createStaffUser(db, { shopId: shopA, email: 'dup@example.com', password: 'first-password' });
    const two = await createStaffUser(db, { shopId: shopB, email: 'dup@example.com', password: 'second-password' });
    expect(one.accountId).not.toBe(two.accountId);
    expect((await authenticateAccount(db, 'dup@example.com', 'first-password'))!.id).toBe(one.accountId);
    expect(await db.select().from(s.platformAccounts).where(eq(s.platformAccounts.email, 'dup@example.com'))).toHaveLength(2);
    // Same password on both: signing in proves both, so they become one account.
    await db.update(s.platformAccounts).set({ passwordHash: (await db.select().from(s.platformAccounts).where(eq(s.platformAccounts.id, one.accountId!)))[0]!.passwordHash }).where(eq(s.platformAccounts.id, two.accountId!));
    const merged = await authenticateAccount(db, 'dup@example.com', 'first-password');
    expect(merged!.id).toBe(Math.min(one.accountId!, two.accountId!));
    expect((await db.select().from(s.staffUsers).where(eq(s.staffUsers.email, 'dup@example.com'))).every((m) => m.accountId === merged!.id)).toBe(true);
  });
});

describe('admin: the URL picks the store, the session must be staff there', () => {
  const SHOP = '{ shop { name } }';
  it('serves each store to its staff and 403 to others', async () => {
    expect((await ok(alice, A, SHOP)).shop.name).toBe('Alpha Store');
    expect((await ok(bob, B, SHOP)).shop.name).toBe('Beta Shop');
    expect((await ok(carol, A, SHOP)).shop.name).toBe('Alpha Store');
    expect((await ok(carol, B, SHOP)).shop.name).toBe('Beta Shop');
    expect((await gql(alice, B, SHOP)).status).toBe(403);
    expect((await gql(bob, A, SHOP)).status).toBe(403);
    expect((await gql(alice, 'no-such-store', SHOP)).status).toBe(403);
  });

  it('refuses every store-level REST route of another store', async () => {
    for (const url of ['/api/export/products.csv', '/api/store/backups', `/api/customers/${ids.bCustomer!.split('/').pop()}/export.json`, '/api/store/domains', '/api/store/payments/stripe', '/api/jobs/1']) {
      const r = await req({ url: `/admin/store/${B}${url}`, cookie: alice });
      expect(r.statusCode, `${url}: ${r.body}`).toBe(403);
      expect(r.body).not.toContain(MARK);
    }
    const post = await req({ method: 'POST', url: `/admin/store/${B}/api/store/backups`, cookie: alice, payload: {} });
    expect(post.statusCode).toBe(403);
  });

  it('host spoofing never switches store without a session for it', async () => {
    const q = { query: '{ shop { name } products(first: 5) { nodes { title } } }' };
    // Alice on Beta's host (the store's own domain serves /admin): her session is not staff there.
    const onBetaHost = await req({ method: 'POST', url: '/admin/api/2026-10/graphql.json', host: BH, cookie: alice, payload: q });
    expect(onBetaHost.statusCode).toBe(403);
    expect(onBetaHost.body).not.toContain(MARK);
    // Store named by header.
    const byHeader = await req({ method: 'POST', url: '/admin/api/2026-10/graphql.json', cookie: alice, headers: { 'x-shopme-store': B }, payload: q });
    expect(byHeader.statusCode).toBe(403);
    // Carol works in both, but a URL and a host that disagree are refused.
    const mixed = await req({ method: 'POST', url: `/admin/store/${A}/api/2026-10/graphql.json`, host: BH, cookie: carol, payload: q });
    expect(mixed.statusCode).toBe(403);
    // Unknown host: neutral 404, no admin at all.
    const unknown = await req({ method: 'POST', url: '/admin/api/2026-10/graphql.json', host: 'evil.example.com', cookie: alice, payload: q });
    expect(unknown.statusCode).toBe(404);
    // An Alpha API token cannot be pointed at Beta.
    const tok = (await ok(alice, A, `mutation { shopmeApiTokenCreate(name: "ci") { token userErrors { message } } }`).catch(() => null));
    const token = tok?.shopmeApiTokenCreate?.token as string | undefined;
    if (token) {
      const r = await req({ method: 'POST', url: `/admin/store/${B}/api/2026-10/graphql.json`, headers: { 'x-shopify-access-token': token }, payload: q });
      expect(r.statusCode).toBe(403);
      const own = await req({ method: 'POST', url: '/admin/api/2026-10/graphql.json', headers: { 'x-shopify-access-token': token }, payload: q });
      expect(own.json().data.shop.name).toBe('Alpha Store');
    }
  });

  it('serves theme previews on the admin host only to the store\'s staff, with scripts disabled', async () => {
    const preview = `/?preview_theme_id=${ids.bThemeId}`;
    const asBob = await req({ url: preview, cookie: bob });
    expect(asBob.statusCode).toBe(200);
    expect(asBob.body).toContain('Beta Shop');
    expect(asBob.headers['content-security-policy']).toContain("script-src 'none'");
    expect(asBob.headers['content-security-policy']).toContain("form-action 'none'");
    expect(asBob.headers['cache-control']).toContain('no-store');
    // Alice (not staff of Beta), by URL, by asset path or by a Referer naming Beta's theme: the admin host's own answer (its root
    // redirects to the admin, anything else is the neutral 404), nothing of Beta.
    for (const r of [
      await req({ url: preview, cookie: alice }),
      await req({ url: preview }),
      await req({ url: `/cdn/shop/t/${ids.bThemeId}/assets/base.css`, cookie: alice }),
      await req({ url: '/cart.js', cookie: alice, headers: { referer: `http://${ADMIN}${preview}` } }),
    ]) {
      expect([302, 404]).toContain(r.statusCode);
      if (r.statusCode === 302) expect(r.headers.location).toBe('/admin/');
      expect(r.body).not.toContain('Beta Shop');
    }
    // The home page thumbnail of the admin renders the store named in the URL, for its staff only.
    expect((await req({ url: `/admin/store/${B}/api/store/home-preview`, cookie: alice })).statusCode).toBe(403);
    const thumb = await req({ url: `/admin/store/${B}/api/store/home-preview`, cookie: bob });
    expect(thumb.statusCode).toBe(200);
    expect(thumb.body).toContain(`http://${BH}:3000/`);
  });

  it('blocks cross-host posts with the session cookie (origin check per host)', async () => {
    const r = await req({ method: 'POST', url: `/admin/store/${A}/api/2026-10/graphql.json`, cookie: alice, headers: { origin: `http://${BH}:3000` }, payload: { query: '{ shop { name } }' } });
    expect(r.statusCode).toBe(403);
  });
});

describe('ids of another store', () => {
  it('reads give null and writes give userErrors', async () => {
    const d = await ok(alice, A, `query($p: ID!, $c: ID!, $o: ID!, $col: ID!, $dr: ID!, $v: ID!) {
      product(id: $p) { id title } customer(id: $c) { id } order(id: $o) { id } collection(id: $col) { id } draftOrder(id: $dr) { id } productVariant(id: $v) { id }
      node(id: $p) { id } nodes(ids: [$p, $c, $o]) { id }
    }`, { p: ids.bProduct, c: ids.bCustomer, o: ids.bOrder, col: ids.bCollection, dr: ids.bDraft2, v: ids.bVariant });
    expect(d).toEqual({ product: null, customer: null, order: null, collection: null, draftOrder: null, productVariant: null, node: null, nodes: [null, null, null] });
    const upd = await ok(alice, A, `mutation($id: ID!) { productUpdate(product: { id: $id, title: "hijacked" }) { product { id } userErrors { message } } }`, { id: ids.bProduct });
    expect(upd.productUpdate.product).toBeNull();
    expect(upd.productUpdate.userErrors.length).toBeGreaterThan(0);
    const del = await ok(alice, A, `mutation($id: ID!) { productDelete(input: { id: $id }) { deletedProductId userErrors { message } } }`, { id: ids.bProduct });
    expect(del.productDelete.deletedProductId).toBeNull();
    const comp = await ok(alice, A, `mutation($id: ID!) { draftOrderComplete(id: $id) { draftOrder { id } userErrors { message } } }`, { id: ids.bDraft2 });
    expect(comp.draftOrderComplete.userErrors.length).toBeGreaterThan(0);
    const list = await ok(alice, A, '{ products(first: 50) { nodes { title } } customers(first: 50) { nodes { firstName } } orders(first: 50) { nodes { note } } }');
    expect(JSON.stringify(list)).not.toContain(MARK);
  });

  /**
   * Walks every root field of the Admin API (queries and mutations) that takes an ID, under Alice's session in Alpha, with ids
   * of Beta. Nothing may come back that belongs to Beta, and Beta's rows must be byte-for-byte unchanged afterwards.
   */
  it('walks every Admin GraphQL root field with Beta ids under an Alpha session', async () => {
    const before = await fingerprint(shopB);
    const pool = Object.entries(ids).filter(([k, v]) => k.startsWith('b') && typeof v === 'string' && v.startsWith('gid://')).map(([, v]) => v);
    const typeOfGid = (g: string) => g.split('/')[3]!;
    const pick = (hint: string): string => {
      const h = hint.toLowerCase().replace(/ids?$/, '');
      return pool.find((g) => h.includes(typeOfGid(g).toLowerCase())) ?? pool.find((g) => typeOfGid(g).toLowerCase().includes(h)) ?? ids.bProduct!;
    };
    const SCALARS: Record<string, unknown> = { String: 'x', Int: 1, Float: 1, Boolean: false, DateTime: '2026-01-01T00:00:00Z', Date: '2026-01-01', Decimal: '1.00', Money: '1.00', UnsignedInt64: '1', JSON: '{}', URL: 'https://example.com', HTML: '<p>x</p>', ARN: 'arn:aws:events:us-east-1::event-source/x' };
    const value = (type: GraphQLInputType, hint: string, depth = 0): unknown => {
      const inner = isNonNullType(type) ? type.ofType : type;
      if (isListType(inner)) return [value(inner.ofType as GraphQLInputType, hint, depth)];
      if (isScalarType(inner)) return inner.name === 'ID' ? pick(hint) : (SCALARS[inner.name] ?? 'x');
      if (isEnumType(inner)) return inner.getValues()[0]!.value;
      if (isInputObjectType(inner)) {
        const out: Record<string, unknown> = {};
        for (const f of Object.values(inner.getFields())) {
          const idLike = getNamedType(f.type).name === 'ID';
          if ((isNonNullType(f.type) || idLike) && depth < 4) out[f.name] = value(f.type, idLike ? `${f.name === 'id' ? hint : f.name}` : f.name, depth + 1);
        }
        return out;
      }
      return null;
    };
    const takesId = (f: GraphQLField<unknown, unknown>) => f.args.some((a) => {
      if (getNamedType(a.type).name === 'ID') return true;
      const n = getNamedType(a.type);
      return isInputObjectType(n) && Object.values(n.getFields()).some((x) => getNamedType(x.type).name === 'ID');
    });
    const selection = (f: GraphQLField<unknown, unknown>) => {
      const n = getNamedType(f.type);
      return isObjectType(n) || isInterfaceType(n) || isUnionType(n) ? ' { __typename }' : '';
    };
    const roots = [['query', gqlSchema.getQueryType()!], ['mutation', gqlSchema.getMutationType()!]] as const;
    let walked = 0, executed = 0;
    const leaks: string[] = [];
    for (const [kind, root] of roots) {
      for (const f of Object.values(root.getFields())) {
        if (!takesId(f)) continue;
        // Bulk operations run the walk's own queries later in the background; staged uploads only sign URLs. Neither reads by id.
        if (/^bulkOperationRun/.test(f.name)) continue;
        const vars: Record<string, unknown> = {};
        const decl: string[] = [];
        const args: string[] = [];
        for (const a of f.args) {
          const required = isNonNullType(a.type);
          const idish = getNamedType(a.type).name === 'ID' || isInputObjectType(getNamedType(a.type));
          if (!required && !idish) continue;
          vars[a.name] = value(a.type, `${f.name} ${a.name}`);
          decl.push(`$${a.name}: ${a.type.toString()}`);
          args.push(`${a.name}: $${a.name}`);
        }
        const query = `${kind} Walk${decl.length ? `(${decl.join(', ')})` : ''} { ${f.name}${args.length ? `(${args.join(', ')})` : ''}${selection(f)} }`;
        walked++;
        const r = await gql(alice, A, query, vars);
        const text = JSON.stringify(r.body);
        if (r.status !== 200) leaks.push(`${f.name}: HTTP ${r.status}`);
        if (text.includes(MARK)) leaks.push(`${f.name}: returned Beta data ${text.slice(0, 200)}`);
        const validation = r.body.errors?.some((e) => e.extensions?.code === 'GRAPHQL_VALIDATION_FAILED' || /Variable "\$|got invalid value|Expected value of type/.test(e.message));
        if (!validation) executed++;
        // A non-null result object must not be one of Beta's records (its id would echo back).
        const data = r.body.data?.[f.name];
        if (data && typeof data === 'object' && getNullableType(f.type) && pool.some((g) => text.includes(`"id":"${g}"`))) leaks.push(`${f.name}: returned a Beta id`);
      }
    }
    expect(leaks).toEqual([]);
    expect(walked).toBeGreaterThan(150);
    // Most fields really executed their resolver with the Beta id (the rest failed input validation on generated values).
    expect(executed / walked).toBeGreaterThan(0.8);
    const after = await fingerprint(shopB);
    expect(after.rows).toBe(before.rows);
    expect(after.hash).toBe(before.hash);
  }, 600_000);
});

describe('storefront, cart, checkout and customer accounts resolve the store by host', () => {
  it('serves each store on its own host and never the other store\'s catalog', async () => {
    const onB = await req({ url: `/products/${ids.bHandle}`, host: BH });
    expect(onB.statusCode).toBe(200);
    expect(onB.body).toContain(MARK);
    for (const url of [`/products/${ids.bHandle}`, `/products/${ids.bHandle}.json`, `/products/${ids.bHandle}.js`, `/pages/${MARK.toLowerCase()}-about`]) {
      const r = await req({ url, host: AH });
      expect(r.statusCode, url).toBe(404);
      expect(r.body).not.toContain(MARK);
    }
    for (const url of ['/', '/collections/all', '/sitemap_products_1.xml', '/products.json', '/sitemap.xml', '/robots.txt', '/meta.json']) {
      const r = await req({ url, host: AH });
      expect(r.body, url).not.toContain(MARK);
      expect(r.body, url).not.toContain(BH);
    }
    // Searching Alpha for Beta's words finds nothing (the page only echoes the query).
    for (const url of [`/search?q=${MARK}`, `/search/suggest.json?q=${MARK}`]) {
      const r = await req({ url, host: AH });
      expect(r.body, url).not.toContain(`${MARK} Board`);
      expect(r.body, url).not.toContain(`${MARK} about`);
    }
    const sitemap = await req({ url: '/sitemap.xml', host: BH });
    expect(sitemap.body).toContain(`http://${BH}:3000/sitemap_`);
  });

  it('answers a neutral page on unknown hosts and on the admin host', async () => {
    for (const host of ['unknown.shops.test', 'evil.example.com']) {
      const r = await req({ url: '/', host, headers: { 'accept-language': 'fr-FR' } });
      expect(r.statusCode).toBe(404);
      expect(r.body).toContain('Boutique introuvable');
      expect(r.body).not.toMatch(/Alpha|Beta/);
    }
    const admin = await req({ url: '/products/x' });
    expect(admin.statusCode).toBe(404);
    expect((await req({ url: '/' })).headers.location).toBe('/admin/');
  });

  it('keeps carts and checkouts per store', async () => {
    const addB = await req({ method: 'POST', url: '/cart/add.js', host: BH, payload: { id: Number(ids.bVariant!.split('/').pop()), quantity: 1 } });
    expect(addB.statusCode, addB.body).toBe(200);
    const cartB = addB.cookies.find((c) => c.name === 'cart')!.value;
    // Beta's variant cannot be added on Alpha.
    const addOnA = await req({ method: 'POST', url: '/cart/add.js', host: AH, payload: { id: Number(ids.bVariant!.split('/').pop()), quantity: 1 } });
    expect(addOnA.statusCode).not.toBe(200);
    expect(addOnA.body).not.toContain(MARK);
    // Beta's cart token on Alpha's host is an unknown cart.
    const cartOnA = await t.app.inject({ url: '/cart.js', headers: { host: AH }, cookies: { cart: cartB } });
    expect(cartOnA.json().item_count).toBe(0);
    expect(cartOnA.body).not.toContain(MARK);
    const checkoutOnA = await t.app.inject({ url: `/checkouts/${cartB}`, headers: { host: AH }, cookies: { cart: cartB } });
    expect(checkoutOnA.body).not.toContain(MARK);
    expect([302, 303, 404]).toContain(checkoutOnA.statusCode);
    const checkoutOnB = await t.app.inject({ url: `/checkouts/${cartB}`, headers: { host: BH }, cookies: { cart: cartB } });
    expect(checkoutOnB.statusCode).toBe(200);
    expect(checkoutOnB.body).toContain(MARK);
  });

  it('keeps customer accounts per store', async () => {
    const r = await registerCustomer(db, shopB, { email: 'shopper@example.com', password: 'shopper-password', firstName: MARK });
    expect(r.ok).toBe(true);
    const form = 'customer%5Bemail%5D=shopper%40example.com&customer%5Bpassword%5D=shopper-password';
    const onA = await t.app.inject({ method: 'POST', url: '/account/login', headers: { host: AH, 'content-type': 'application/x-www-form-urlencoded' }, payload: form });
    expect(onA.cookies.find((c) => c.name === 'shopme_customer')).toBeUndefined();
    const onB = await t.app.inject({ method: 'POST', url: '/account/login', headers: { host: BH, 'content-type': 'application/x-www-form-urlencoded' }, payload: form });
    const customer = onB.cookies.find((c) => c.name === 'shopme_customer')!.value;
    expect(customer).toBeTruthy();
    expect((await req({ url: '/account', host: BH, customer })).statusCode).toBe(200);
    const crossed = await req({ url: '/account', host: AH, customer });
    expect(crossed.statusCode).toBe(302);
    expect(crossed.headers.location).toContain('/account/login');
  });

  it('serves theme assets and uploaded files only on the owning store', async () => {
    const theme = await db.select().from(s.themeFiles).where(and(eq(s.themeFiles.shopId, shopB), sql`${s.themeFiles.path} like 'assets/%'`)).limit(1);
    const asset = `/cdn/shop/t/${ids.bThemeId}/${theme[0]!.path}`;
    expect((await req({ url: asset, host: BH })).statusCode).toBe(200);
    expect((await req({ url: asset, host: AH })).statusCode).toBe(404);
    expect(ids.bFileUrl).toMatch(new RegExp(`^/files/shops/${shopB}/`));
    expect(existsSync(path.join(t.app.ctx.config.storageDir, 'shops', String(shopB)))).toBe(true);
    expect((await req({ url: ids.bFileUrl!, host: BH })).body).toContain(MARK);
    expect((await req({ url: ids.bFileUrl!, host: AH })).statusCode).toBe(404);
    expect((await req({ url: ids.bFileUrl!, cookie: alice })).statusCode).toBe(404);
    expect((await req({ url: ids.bFileUrl! })).statusCode).toBe(404);
    expect((await req({ url: ids.bFileUrl!, cookie: bob })).statusCode).toBe(200);
  });
});

describe('exports, backups, webhooks and jobs stay per store', () => {
  it('exports and backs up one store only', async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'ms-export-')), 'a.shopme');
    await exportStore(db, t.app.ctx.storageFor(shopA), shopA, file, { appVersion: 'test' });
    const entries = unzipSync(new Uint8Array(readFileSync(file)));
    for (const [name, data] of Object.entries(entries)) expect(strFromU8(data, true).includes(MARK), name).toBe(false);
    const backupB = await req({ method: 'POST', url: `/admin/store/${B}/api/store/backups`, cookie: bob, payload: {} });
    expect(backupB.statusCode).toBe(202);
    let names: string[] = [];
    for (let i = 0; i < 100 && !names.length; i++) {
      names = (await req({ url: `/admin/store/${B}/api/store/backups`, cookie: bob })).json().backups.map((b: { name: string }) => b.name);
      if (!names.length) await new Promise((r) => setTimeout(r, 100));
    }
    expect(names.length).toBe(1);
    const listA = (await req({ url: `/admin/store/${A}/api/store/backups`, cookie: alice })).json();
    expect(listA.backups.map((b: { name: string }) => b.name)).not.toContain(names[0]);
    expect(listA.directory).not.toBe((await req({ url: `/admin/store/${B}/api/store/backups`, cookie: bob })).json().directory);
    expect((await req({ url: `/admin/store/${A}/api/store/backups/${names[0]}`, cookie: alice })).statusCode).toBe(404);
    expect((await req({ url: `/admin/store/${B}/api/store/backups/${names[0]}`, cookie: bob })).statusCode).toBe(200);
  });

  it('verifies Stripe events with the store\'s own secret and only touches that store', async () => {
    const keys = (n: string) => ({ publishableKey: `pk_test_${n}`, secretKey: `sk_test_${n}`, webhookSecret: `whsec_${n}` });
    expect((await req({ method: 'PUT', url: `/admin/store/${A}/api/store/payments/stripe`, cookie: alice, payload: keys('alpha123') })).statusCode).toBe(200);
    const st = await req({ method: 'PUT', url: `/admin/store/${B}/api/store/payments/stripe`, cookie: bob, payload: keys('beta456') });
    expect(st.json()).toMatchObject({ configured: true, secretKeyLast4: 'a456', webhookUrl: `http://localhost:3000/webhooks/stripe/${B}` });
    expect(st.body).not.toContain('sk_test_beta456');
    const secret = (await db.select().from(s.shopSecrets).where(eq(s.shopSecrets.shopId, shopB)))[0]!;
    expect(secret.stripeSecretKey).not.toContain('beta456');
    const orderB = Number(ids.bOrder!.split('/').pop());
    await db.insert(s.transactions).values({ shopId: shopB, orderId: orderB, kind: 'SALE', status: 'PENDING', gateway: 'stripe', amount: 1200, currency: 'USD', paymentId: 'pi_beta_1' } as never);
    const before = await fingerprint(shopB);
    const event = JSON.stringify({ id: 'evt_1', object: 'event', type: 'payment_intent.succeeded', data: { object: { id: 'pi_beta_1', object: 'payment_intent' } } });
    const sign = (secretKey: string) => { const ts = Math.floor(Date.now() / 1000); return `t=${ts},v1=${createHmac('sha256', secretKey).update(`${ts}.${event}`).digest('hex')}`; };
    const post = (url: string, sig: string, host = ADMIN) => t.app.inject({ method: 'POST', url, headers: { host, 'content-type': 'application/json', 'stripe-signature': sig }, payload: event });
    // Beta's secret on Alpha's endpoint: rejected.
    expect((await post(`/webhooks/stripe/${A}`, sign('whsec_beta456'))).statusCode).toBe(400);
    expect((await post('/webhooks/stripe', sign('whsec_beta456'), AH)).statusCode).toBe(400);
    // Alpha's own secret with Beta's payment id: accepted, but Alpha has no such payment and Beta is untouched.
    expect((await post(`/webhooks/stripe/${A}`, sign('whsec_alpha123'))).statusCode).toBe(200);
    expect((await fingerprint(shopB)).hash).toBe(before.hash);
    // Beta's endpoint with Beta's secret marks Beta's order paid.
    expect((await post(`/webhooks/stripe/${B}`, sign('whsec_beta456'))).statusCode).toBe(200);
    expect((await db.select().from(s.orders).where(eq(s.orders.id, orderB)))[0]!.financialStatus).toBe('PAID');
  });

  it('fans out outbound webhooks to the store\'s own subscriptions only', async () => {
    const deliveries = await recordDeliveries(db, shopA, { verb: 'products/create', subjectId: Number(ids.aProduct!.split('/').pop()), data: null });
    expect(deliveries.length).toBe(1);
    const rows = await db.select().from(s.webhookDeliveries).where(sql`${s.webhookDeliveries.id} in (${sql.join(deliveries.map((d) => sql`${d}`), sql`, `)})`);
    const subA = Number(ids.aWebhook!.split('/').pop());
    expect(rows.every((r) => r.shopId === shopA && r.subscriptionId === subA)).toBe(true);
    expect(JSON.stringify(rows.map((r) => r.payload))).not.toContain(MARK);
  });

  it('suspends a store: storefront unavailable, admin read-only, jobs skip it', async () => {
    expect((await req({ method: 'POST', url: `/admin/api/platform/stores/${shopB}/suspend`, cookie: bob })).statusCode).toBe(403);
    expect((await req({ method: 'POST', url: `/admin/api/platform/stores/${shopB}/suspend`, cookie: alice })).statusCode).toBe(200);
    const page = await req({ url: '/', host: BH });
    expect(page.statusCode).toBe(503);
    expect(page.body).toContain('Store unavailable');
    expect(page.body).not.toContain(MARK);
    expect((await ok(bob, B, '{ shop { name } }')).shop.name).toBe('Beta Shop');
    const mut = await gql(bob, B, 'mutation { collectionCreate(input: { title: "nope" }) { collection { id } } }');
    expect(mut.body.errors?.[0]?.extensions?.code).toBe('STORE_SUSPENDED');
    expect((await req({ method: 'POST', url: `/admin/store/${B}/api/store/backups`, cookie: bob, payload: {} })).statusCode).toBe(423);
    expect((await req({ url: '/admin/api/auth/me', cookie: bob })).json().suspended).toBe(true);
    expect(await activeShopIds(t.app.ctx)).toEqual([shopA]);
    expect((await req({ method: 'POST', url: `/admin/api/platform/stores/${shopB}/resume`, cookie: alice })).statusCode).toBe(200);
    expect((await req({ url: '/', host: BH })).statusCode).toBe(200);
    expect(await activeShopIds(t.app.ctx)).toEqual([shopA, shopB]);
  });
});

describe('domains', () => {
  it('adds, verifies and makes a custom domain primary; other stores cannot claim it', async () => {
    const add = await req({ method: 'POST', url: `/admin/store/${B}/api/store/domains`, cookie: bob, payload: { host: 'https://Shop.Beta.example/' } });
    expect(add.statusCode, add.body).toBe(201);
    const d = add.json().domains[0];
    expect(d).toMatchObject({ host: 'shop.beta.example', verified: false, verificationRecord: '_shopme-verify.shop.beta.example' });
    // Not verified yet: the host serves nothing, and Alpha cannot add it.
    expect((await req({ url: '/', host: 'shop.beta.example' })).statusCode).toBe(404);
    expect((await req({ method: 'POST', url: `/admin/store/${A}/api/store/domains`, cookie: alice, payload: { host: 'shop.beta.example' } })).statusCode).toBe(422);
    expect((await req({ method: 'POST', url: `/admin/store/${A}/api/store/domains`, cookie: alice, payload: { host: BH } })).statusCode).toBe(422);
    setTxtResolver(async () => [['wrong']]);
    expect((await req({ method: 'POST', url: `/admin/store/${B}/api/store/domains/${d.id}/verify`, cookie: bob })).statusCode).toBe(422);
    setTxtResolver(async (name) => (name === '_shopme-verify.shop.beta.example' ? [[d.verificationValue]] : []));
    expect((await req({ method: 'POST', url: `/admin/store/${B}/api/store/domains/${d.id}/verify`, cookie: bob })).json().domains[0].verified).toBe(true);
    expect((await req({ url: '/__shopme/tls-ask?domain=shop.beta.example' })).statusCode).toBe(200);
    expect((await req({ url: `/__shopme/tls-ask?domain=${BH}` })).statusCode).toBe(200);
    expect((await req({ url: '/__shopme/tls-ask?domain=other.example' })).statusCode).toBe(404);
    // Alpha cannot point its primary domain at Beta's domain.
    const steal = await ok(alice, A, 'mutation { shopmeShopUpdate(input: { primaryDomain: "shop.beta.example" }) { userErrors { message } } }');
    expect(steal.shopmeShopUpdate.userErrors.length).toBe(1);
    // Primary: Beta's permanent host redirects to it (same path), the domain serves Beta.
    expect((await req({ method: 'PUT', url: `/admin/store/${B}/api/store/domains/primary`, cookie: bob, payload: { id: d.id } })).statusCode).toBe(200);
    const redirect = await req({ url: '/collections/all?page=2', host: BH });
    expect(redirect.statusCode).toBe(301);
    expect(redirect.headers.location).toBe('http://shop.beta.example:3000/collections/all?page=2');
    const served = await req({ url: `/products/${ids.bHandle}`, host: 'shop.beta.example' });
    expect(served.statusCode).toBe(200);
    expect(served.body).toContain(MARK);
    expect((await req({ method: 'PUT', url: `/admin/store/${B}/api/store/domains/primary`, cookie: bob, payload: { id: null } })).statusCode).toBe(200);
    expect((await req({ url: '/', host: BH })).statusCode).toBe(200);
  });
});

describe('platform owner', () => {
  it('lists every store and deletes one with every row and file', async () => {
    expect((await req({ url: '/admin/api/platform/stores', cookie: bob })).statusCode).toBe(403);
    const created = await req({ method: 'POST', url: '/admin/api/account/stores', cookie: alice, payload: { shopName: 'Gamma', handle: 'gamma-test', currency: 'EUR', country: 'FR', locale: 'fr' } });
    expect(created.statusCode, created.body).toBe(201);
    const gamma = created.json().store.id as number;
    expect((await ok(alice, 'gamma-test', '{ shop { name } menus(first: 5) { nodes { handle title } } }')).menus.nodes.map((m: { handle: string; title: string }) => `${m.handle}:${m.title}`)).toEqual(expect.arrayContaining(['main-menu:Menu principal', 'footer:Menu de pied de page']));
    expect((await req({ url: '/', host: 'gamma-test.shops.test' })).statusCode).toBe(200);
    await ok(alice, 'gamma-test', PRODUCT, { p: { title: 'Gamma thing' } });
    await saveUpload(db, t.app.ctx.storageFor(gamma), gamma, { filename: 'g.txt', data: Buffer.from('g'), mimeType: 'text/plain' });
    const all = (await req({ url: '/admin/api/platform/stores', cookie: alice })).json().stores as { handle: string; ownerEmail: string; staffCount: number }[];
    const list = all.map((x) => x.handle);
    expect(list).toEqual([A, B, 'gamma-test']);
    expect(all.map((x) => [x.ownerEmail, x.staffCount])).toEqual([['alice@example.com', 3], ['bob@example.com', 3], ['alice@example.com', 1]]); // owner, Carol and the duplicate-e-mail member
    const before = { a: await fingerprint(shopA), b: await fingerprint(shopB) };
    expect((await req({ method: 'DELETE', url: `/admin/api/platform/stores/${gamma}`, cookie: alice, payload: { confirm: 'wrong' } })).statusCode).toBe(422);
    expect((await req({ method: 'DELETE', url: `/admin/api/platform/stores/${gamma}`, cookie: alice, payload: { confirm: 'gamma-test' } })).statusCode).toBe(200);
    expect((await fingerprint(gamma)).rows).toBe(0);
    expect(existsSync(path.join(t.app.ctx.config.storageDir, 'shops', String(gamma)))).toBe(false);
    expect((await req({ url: '/', host: 'gamma-test.shops.test' })).statusCode).toBe(404);
    // Alice is still signed in and the other stores are untouched (Alice's Alpha session saw no change either).
    expect((await ok(alice, A, '{ shop { name } }')).shop.name).toBe('Alpha Store');
    expect((await fingerprint(shopA)).hash).toBe(before.a.hash);
    expect((await fingerprint(shopB)).hash).toBe(before.b.hash);
  });

  it('decides whether other accounts may create stores', async () => {
    expect((await req({ method: 'PUT', url: '/admin/api/platform/settings', cookie: alice, payload: { storeCreation: 'OWNER' } })).json().settings.storeCreation).toBe('OWNER');
    const denied = await req({ method: 'POST', url: '/admin/api/account/stores', cookie: bob, payload: { shopName: 'Another', currency: 'EUR', country: 'FR', locale: 'en' } });
    expect(denied.statusCode).toBe(403);
    expect((await req({ url: '/admin/api/auth/me', cookie: bob })).json().canCreateStores).toBe(false);
    const handle = (await req({ url: '/admin/api/account/stores/handle?name=Beta%20Shop', cookie: alice })).json();
    expect(handle).toMatchObject({ handle: 'beta-shop-2', available: true, host: 'beta-shop-2.shops.test' });
    expect((await req({ url: '/admin/api/account/stores/handle?handle=admin', cookie: alice })).json().available).toBe(false);
  });
});
