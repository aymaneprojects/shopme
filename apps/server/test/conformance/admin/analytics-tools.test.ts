import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPORT_NAMES, schema } from '@shopme/core';
import { createTestApp, SETUP_BODY, type TestApp } from '../../../src/test-utils';
import { makeGql } from '../helpers';
import { seedCustomer, seedOrder, shopIdOf } from '../seed-sales';

let t: TestApp;
let gql: ReturnType<typeof makeGql>;
let shopId: number;
const ok = async (query: string, variables: Record<string, unknown> = {}) => {
  const r = await gql(query, variables);
  expect(r.errors, JSON.stringify(r.errors)).toBeUndefined();
  return r.data;
};
const day = (offset = 0) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  t = await createTestApp();
  const setup = await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: SETUP_BODY });
  gql = makeGql(t.app, setup.cookies.find((c) => c.name === 'shopme_session')!.value);
  shopId = await shopIdOf(t.dbHandle.db);
  const db = t.dbHandle.db;
  const c = await seedCustomer(db, shopId, { email: 'rep@example.com' });
  await seedOrder(db, shopId, 1, { customerId: c.id, processedAt: new Date(Date.now() - 40 * 86400_000), fulfillmentStatus: 'FULFILLED' });
  await seedOrder(db, shopId, 2, { customerId: c.id, fulfillmentStatus: 'FULFILLED' });
  await seedOrder(db, shopId, 3, { customerId: null, lineTitle: 'Other', unitPrice: 300 });
  await db.insert(schema.visits).values([
    { shopId, sessionId: 'a', path: '/', referrer: 'https://www.example.org/page?x=1' }, { shopId, sessionId: 'a', path: '/products/x', referrer: null }, { shopId, sessionId: 'b', path: '/', referrer: null },
  ]);
}, 90_000);
afterAll(async () => { await t.close(); });

const REPORT = `query($n: ShopmeReportName!, $f: String!, $t: String!, $c: String) { shopmeReport(name: $n, from: $f, to: $t, currency: $c) { name currencyCode columns { key type } rows totals } }`;

describe('reports', () => {
  it('runs every report', async () => {
    for (const name of REPORT_NAMES) {
      const r = (await ok(REPORT, { n: name, f: day(-60), t: day(1) })).shopmeReport;
      expect(r.name, name).toBe(name);
      expect(r.columns.length, name).toBeGreaterThan(0);
      for (const row of r.rows) expect(row.length, name).toBe(r.columns.length);
    }
  });

  it('reports orders fulfilled, channels, payment methods and the cohort table', async () => {
    const orders = (await ok(REPORT, { n: 'ORDERS_OVER_TIME', f: day(-60), t: day(1) })).shopmeReport;
    expect(orders.columns.map((c: { key: string }) => c.key)).toContain('fulfilled');
    expect(orders.totals.fulfilled).toBe(2);
    const channel = (await ok(REPORT, { n: 'SALES_BY_CHANNEL', f: day(-60), t: day(1) })).shopmeReport;
    expect(channel.rows).toEqual([['web', 3, expect.any(Number)]]);
    const pay = (await ok(REPORT, { n: 'SALES_BY_PAYMENT_METHOD', f: day(-60), t: day(1) })).shopmeReport;
    expect(pay.rows[0][0]).toBe('bogus');
    const nvr = (await ok(REPORT, { n: 'NEW_VS_RETURNING', f: day(-60), t: day(1) })).shopmeReport;
    expect(nvr.totals.new_orders + nvr.totals.returning_orders).toBe(3);
    const acq = (await ok(REPORT, { n: 'ACQUISITION_BY_REFERRER', f: day(-1), t: day(1) })).shopmeReport;
    expect(acq.rows).toEqual([['direct', 2, 2], ['example.org', 1, 1]]);
    const abc = (await ok(REPORT, { n: 'ABC_ANALYSIS', f: day(-60), t: day(1) })).shopmeReport;
    expect(abc.rows[0][4]).toBe('A');
    const rfm = (await ok(REPORT, { n: 'RFM_SEGMENTS', f: day(-1), t: day(0) })).shopmeReport;
    expect(rfm.rows.reduce((s: number, r: number[]) => s + r[1], 0)).toBeGreaterThanOrEqual(1);
  });

  it('converts money into an enabled presentment currency with a rate', async () => {
    await t.dbHandle.db.insert(schema.currencySettings).values({ shopId, currencyCode: 'USD', enabled: true, manualRate: 2 });
    const base = (await ok(REPORT, { n: 'SALES_OVER_TIME', f: day(-60), t: day(1) })).shopmeReport;
    const usd = (await ok(REPORT, { n: 'SALES_OVER_TIME', f: day(-60), t: day(1), c: 'USD' })).shopmeReport;
    expect(usd.currencyCode).toBe('USD');
    expect(usd.totals.total).toBe(base.totals.total * 2);
    expect(usd.totals.orders).toBe(base.totals.orders);
    const unknown = (await ok(REPORT, { n: 'SALES_OVER_TIME', f: day(-60), t: day(1), c: 'JPY' })).shopmeReport;
    expect(unknown.currencyCode).toBe(base.currencyCode);
    const list = (await ok(`{ shopmeReportCurrencies { code rate } }`)).shopmeReportCurrencies;
    expect(list.map((c: { code: string }) => c.code)).toEqual(['EUR', 'USD']);
  });
});

describe('pins and last viewed', () => {
  it('pins and remembers views per staff member and rejects unknown reports', async () => {
    const pin = (await ok(`mutation { shopmeReportPin(key: "SALES_BY_CHANNEL", pinned: true) { state { key pinned } userErrors { message } } }`)).shopmeReportPin;
    expect(pin.state).toEqual({ key: 'SALES_BY_CHANNEL', pinned: true });
    await ok(`mutation { shopmeReportViewed(key: "SALES_BY_CHANNEL") { state { lastViewedAt } } }`);
    const states = (await ok(`{ shopmeReportStates { key pinned lastViewedAt } }`)).shopmeReportStates;
    expect(states).toEqual([{ key: 'SALES_BY_CHANNEL', pinned: true, lastViewedAt: expect.any(String) }]);
    const bad = (await ok(`mutation { shopmeReportPin(key: "NOPE", pinned: true) { state { key } userErrors { message } } }`)).shopmeReportPin;
    expect(bad.userErrors[0].message).toBe('Report does not exist');
  });
});

describe('goals and annotations', () => {
  it('sets a goal, shows progress and deletes it', async () => {
    const set = (await ok(`mutation { shopmeGoalSet(metric: TOTAL_SALES, period: MONTH, target: 1000000) { goalId userErrors { message } } }`)).shopmeGoalSet;
    expect(set.userErrors).toEqual([]);
    const bad = (await ok(`mutation { shopmeGoalSet(metric: ORDERS, period: WEEK, target: 0) { goalId userErrors { message } } }`)).shopmeGoalSet;
    expect(bad.userErrors[0].message).toMatch(/greater than zero/);
    await ok(`mutation { shopmeGoalSet(metric: TOTAL_SALES, period: MONTH, target: 2000000) { goalId } }`); // updates the same goal
    const goals = (await ok(`{ shopmeGoals { id metric period target actual elapsed from to } }`)).shopmeGoals;
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({ metric: 'TOTAL_SALES', period: 'MONTH', target: 2000000 });
    expect(goals[0].elapsed).toBeGreaterThan(0);
    expect(goals[0].actual).toBeGreaterThanOrEqual(0);
    const del = (await ok(`mutation($id: ID!) { shopmeGoalDelete(id: $id) { deletedId userErrors { message } } }`, { id: goals[0].id })).shopmeGoalDelete;
    expect(del.deletedId).toBe(goals[0].id);
    expect((await ok(`{ shopmeGoals { id } }`)).shopmeGoals).toEqual([]);
  });

  it('creates annotations for a report and lists them by range', async () => {
    const a = (await ok(`mutation($d: String!) { shopmeAnnotationCreate(day: $d, text: "Launched summer sale", reportKey: "SALES_OVER_TIME") { annotation { id day text } userErrors { message } } }`, { d: day(-3) })).shopmeAnnotationCreate;
    expect(a.userErrors).toEqual([]);
    await ok(`mutation($d: String!) { shopmeAnnotationCreate(day: $d, text: "Other report") { annotation { id } } }`, { d: day(-2) });
    const mine = (await ok(`query($f: String!, $t: String!) { shopmeAnnotations(reportKey: "SALES_OVER_TIME", from: $f, to: $t) { text } }`, { f: day(-10), t: day(0) })).shopmeAnnotations;
    expect(mine.map((x: { text: string }) => x.text)).toEqual(['Launched summer sale', 'Other report']);
    const other = (await ok(`{ shopmeAnnotations(reportKey: "TAXES") { text } }`)).shopmeAnnotations;
    expect(other.map((x: { text: string }) => x.text)).toEqual(['Other report']);
    expect((await ok(`mutation { shopmeAnnotationCreate(day: "bad", text: "x") { annotation { id } userErrors { message } } }`)).shopmeAnnotationCreate.userErrors[0].message).toMatch(/YYYY-MM-DD/);
    expect((await ok(`mutation($id: ID!) { shopmeAnnotationDelete(id: $id) { deletedId } }`, { id: a.annotation.id })).shopmeAnnotationDelete.deletedId).toBe(a.annotation.id);
  });
});

describe('explorations', () => {
  const RUN = `query($d: JSON!, $f: String!, $t: String!) { shopmeExplorationRun(definition: $d, from: $f, to: $t) { currencyCode columns { key label type } rows totals } }`;

  it('runs a definition over each dataset', async () => {
    const orders = (await ok(RUN, { d: { dataset: 'ORDERS', metrics: ['orders', 'total_sales', 'aov'], dimension: 'month', filters: [], period: 'LAST_90_DAYS', compare: 'NONE', visualization: 'LINE' }, f: day(-90), t: day(1) })).shopmeExplorationRun;
    expect(orders.columns.map((c: { key: string }) => c.key)).toEqual(['dim', 'orders', 'total_sales', 'aov']);
    expect(orders.totals.orders).toBe(3);
    expect(orders.totals.aov).toBeUndefined();
    const byChannel = (await ok(RUN, { d: { dataset: 'ORDERS', metrics: ['orders'], dimension: 'channel', filters: [{ field: 'financial_status', op: 'EQ', value: 'paid' }] }, f: day(-90), t: day(1) })).shopmeExplorationRun;
    expect(byChannel.rows).toEqual([['web', 3]]);
    const none = (await ok(RUN, { d: { dataset: 'ORDERS', metrics: ['orders'], dimension: null, filters: [{ field: 'total', op: 'GT', value: '99999999' }] }, f: day(-90), t: day(1) })).shopmeExplorationRun;
    expect(none.rows).toEqual([['total', 0]]);
    const products = (await ok(RUN, { d: { dataset: 'PRODUCTS', metrics: ['units', 'sales'], dimension: 'product', filters: [{ field: 'product', op: 'CONTAINS', value: 'snow' }] }, f: day(-90), t: day(1) })).shopmeExplorationRun;
    expect(products.rows[0][0]).toBe('Snow Board');
    const customers = (await ok(RUN, { d: { dataset: 'CUSTOMERS', metrics: ['customers', 'spent'], dimension: 'customer', filters: [] }, f: day(-90), t: day(1) })).shopmeExplorationRun;
    expect(customers.rows).toHaveLength(1);
    const sessions = (await ok(RUN, { d: { dataset: 'SESSIONS', metrics: ['sessions', 'views'], dimension: 'page', filters: [{ field: 'page', op: 'CONTAINS', value: 'products' }] }, f: day(-1), t: day(1) })).shopmeExplorationRun;
    expect(sessions.rows).toEqual([['/products/x', 1, 1]]);
  });

  it('refuses unknown metrics, dimensions and filter fields', async () => {
    for (const d of [{ dataset: 'ORDERS', metrics: ['nope'] }, { dataset: 'ORDERS', metrics: ['orders'], dimension: 'drop table' }, { dataset: 'ORDERS', metrics: ['orders'], filters: [{ field: 'x; --', op: 'EQ', value: '1' }] }, { dataset: 'NOPE', metrics: ['orders'] }, { dataset: 'ORDERS', metrics: [] }]) {
      const r = await gql(RUN, { d, f: day(-5), t: day(0) });
      expect(r.errors?.[0]?.message, JSON.stringify(d)).toBeTruthy();
    }
    expect((await gql(RUN, { d: { dataset: 'ORDERS', metrics: ['orders'] }, f: day(0), t: day(-5) })).errors?.[0]?.message).toMatch(/from <= to/);
  });

  it('saves, lists, pins and deletes an exploration', async () => {
    const def = { dataset: 'ORDERS', metrics: ['orders'], dimension: 'day', filters: [], period: 'LAST_30_DAYS', compare: 'PREVIOUS_PERIOD', visualization: 'BAR' };
    const saved = (await ok(`mutation($d: JSON!) { shopmeExplorationSave(name: " My sales ", definition: $d) { exploration { id name definition createdByName } userErrors { message } } }`, { d: def })).shopmeExplorationSave;
    expect(saved.userErrors).toEqual([]);
    expect(saved.exploration).toMatchObject({ name: 'My sales', definition: { visualization: 'BAR', compare: 'PREVIOUS_PERIOD' } });
    const blank = (await ok(`mutation($d: JSON!) { shopmeExplorationSave(name: " ", definition: $d) { userErrors { message } } }`, { d: def })).shopmeExplorationSave;
    expect(blank.userErrors[0].message).toBe("Name can't be blank");
    const renamed = (await ok(`mutation($id: ID!, $d: JSON!) { shopmeExplorationSave(id: $id, name: "Renamed", definition: $d) { exploration { name } } }`, { id: saved.exploration.id, d: { ...def, metrics: ['orders', 'units'] } })).shopmeExplorationSave;
    expect(renamed.exploration.name).toBe('Renamed');
    expect((await ok(`{ shopmeExplorations { id name } }`)).shopmeExplorations).toHaveLength(1);
    await ok(`mutation($k: String!) { shopmeReportPin(key: $k, pinned: true) { state { key } } }`, { k: `EXPLORATION:${saved.exploration.id.split('/').pop()}` });
    const del = (await ok(`mutation($id: ID!) { shopmeExplorationDelete(id: $id) { deletedId userErrors { message } } }`, { id: saved.exploration.id })).shopmeExplorationDelete;
    expect(del.deletedId).toBe(saved.exploration.id);
    expect((await ok(`{ shopmeExplorations { id } }`)).shopmeExplorations).toEqual([]);
  });

  it('describes the datasets for the builder', async () => {
    const cat = (await ok(`{ shopmeExplorationCatalog }`)).shopmeExplorationCatalog;
    expect(Object.keys(cat).sort()).toEqual(['CUSTOMERS', 'ORDERS', 'PRODUCTS', 'SESSIONS']);
    expect(cat.ORDERS.metrics.map((m: { key: string }) => m.key)).toContain('total_sales');
  });
});

describe('live view', () => {
  it('counts visitors, sessions and orders of the moment', async () => {
    const l = (await ok(`{ shopmeLiveView { visitorsNow sessionsToday ordersToday salesToday activeCarts currencyCode viewsPerMinute { minute views } topPages { path views } topSources { source sessions } recentOrders { name total } } }`)).shopmeLiveView;
    expect(l.visitorsNow).toBe(2);
    expect(l.sessionsToday).toBe(2);
    expect(l.ordersToday).toBe(2);
    expect(l.viewsPerMinute).toHaveLength(30);
    expect(l.viewsPerMinute.reduce((s: number, m: { views: number }) => s + m.views, 0)).toBe(3);
    expect(l.topPages[0]).toEqual({ path: '/', views: 2 });
    expect(l.topSources.map((s: { source: string }) => s.source).sort()).toEqual(['direct', 'example.org']);
    expect(l.recentOrders.length).toBe(2);
  });
});
