import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getTableColumns } from 'drizzle-orm';
import { schema as s } from '@shopme/core';
import { createTestApp, SETUP_BODY, type TestApp } from './test-utils';
import { makeGql, makeGqlOk } from '../test/conformance/helpers';

/** Live view map: a country per visit from the browser time zone the analytics beacon sends; nothing else about location is kept. */
describe('live view countries', () => {
  let t: TestApp;
  let g: ReturnType<typeof makeGqlOk>;
  // New York needs no consent for analytics (the shop is in France, where it is required).
  const NY = { 'user-agent': 'Mozilla/5.0 Firefox', 'cf-ipcountry': 'US', 'cf-region-code': 'NY' };
  const visit = async (headers: Record<string, string> = NY) => {
    const r = await t.app.inject({ url: '/', headers });
    return r.cookies.find((c) => c.name === 'shopme_vid')?.value;
  };
  const beacon = (vid: string, tz: unknown, headers: Record<string, string> = NY) => t.app.inject({ method: 'POST', url: '/.shopme/events', headers, cookies: { shopme_vid: vid }, payload: { tz, events: [{ id: `e-${Math.random()}`, name: 'page_viewed', data: {} }] } });
  const live = async () => (await g('{ shopmeLiveView { visitorsNow visitorsUnlocated countries { countryCode visitors } } }')).shopmeLiveView as { visitorsNow: number; visitorsUnlocated: number; countries: Array<{ countryCode: string; visitors: number }> };
  const countryOf = async (vid: string) => [...new Set((await t.dbHandle.db.select().from(s.visits).where(eq(s.visits.sessionId, vid))).map((v) => v.countryCode))];

  beforeAll(async () => {
    t = await createTestApp();
    const setup = await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: SETUP_BODY });
    g = makeGqlOk(makeGql(t.app, setup.cookies.find((c) => c.name === 'shopme_session')!.value));
  }, 60_000);
  afterAll(async () => { await t.close(); });

  it('stores only a country code on the visit, from the time zone of the beacon', async () => {
    const a = (await visit())!;
    expect(a).toBeTruthy();
    expect((await beacon(a, 'Europe/Berlin')).statusCode).toBe(204);
    expect(await countryOf(a)).toEqual(['DE']);
    await t.app.inject({ url: '/collections/all', headers: NY, cookies: { shopme_vid: a } });
    await beacon(a, 'Europe/Berlin');
    expect(await countryOf(a)).toEqual(['DE']); // every page view of the session
    const b = (await visit())!;
    await beacon(b, 'Asia/Calcutta');
    const c = (await visit())!; // no beacon: unknown country
    const d = (await visit())!;
    await beacon(d, 'Etc/UTC'); // a zone without a country
    const view = await live();
    expect(view.visitorsNow).toBe(4);
    expect(view.countries).toEqual([{ countryCode: 'DE', visitors: 1 }, { countryCode: 'IN', visitors: 1 }]);
    expect(view.visitorsUnlocated).toBe(2);
    expect(await countryOf(c)).toEqual([null]);
    // The visit log has no column for an IP address, a region, a city or the time zone itself.
    const cols = Object.keys(getTableColumns(s.visits));
    expect(cols).toContain('countryCode');
    for (const forbidden of ['ip', 'ipAddress', 'region', 'city', 'timeZone', 'timezone', 'latitude', 'longitude', 'userAgent']) expect(cols).not.toContain(forbidden);
  });

  it('honours consent, Do Not Track and Global Privacy Control', async () => {
    const e = (await visit())!;
    await beacon(e, 'Asia/Tokyo', { ...NY, dnt: '1' });
    await beacon(e, 'Asia/Tokyo', { ...NY, 'sec-gpc': '1' });
    expect(await countryOf(e)).toEqual([null]);
    // France requires consent: no visit, no cookie, and the beacon stores nothing without it.
    expect(await visit({ 'user-agent': 'Mozilla/5.0 Firefox' })).toBeUndefined();
    await beacon(e, 'Asia/Tokyo', { 'user-agent': 'Mozilla/5.0 Firefox' });
    expect(await countryOf(e)).toEqual([null]);
    expect((await live()).countries.map((x) => x.countryCode)).not.toContain('JP');
    // A forged visit id stores nothing either.
    expect((await beacon('short', 'Asia/Tokyo')).statusCode).toBe(204);
  });
});
