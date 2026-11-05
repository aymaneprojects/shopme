import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, createLocalStorage, getPrimaryShop, resolveMigrationsDir, runMigrations, schema as s, seedDemo, setupStore, type DbHandle } from '../../index';
import { matchShippingRates } from '../pricing';
import { addLocation } from '../catalog/inventory';
import {
  createPackage, createProfile, deletePackage, disablePickup, enablePickup, getProfile, listPackages, loadProfiles, makeDefaultPackage, quoteShipping, removeProfile, shippableCountries, updateLocalDelivery, updatePackage, updateProfile,
  type QuoteLine,
} from './index';

describe('migration of existing zones and rates', () => {
  let h: DbHandle;
  let shopId: number;
  let dir: string;
  const legacy: Record<string, number> = {};
  beforeAll(async () => {
    // Migrate up to the step before delivery profiles, create legacy data, then apply the profile migration on top.
    const full = resolveMigrationsDir();
    dir = mkdtempSync(path.join(tmpdir(), 'mig-'));
    cpSync(full, dir, { recursive: true });
    const journal = JSON.parse(readFileSync(path.join(full, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] };
    const old = { ...journal, entries: journal.entries.filter((e) => !e.tag.includes('shipping_profiles')) };
    const partial = mkdtempSync(path.join(tmpdir(), 'mig-partial-'));
    cpSync(full, partial, { recursive: true });
    writeFileSync(path.join(partial, 'meta', '_journal.json'), JSON.stringify(old));
    h = await createDb({ memory: true });
    await h.migrate(partial);
    const { shop } = await setupStore(h.db, { shopName: 'M', email: 'm@example.com', password: 'correct horse', currency: 'EUR', country: 'FR', locale: 'en' });
    shopId = shop.id;
    await h.db.insert(s.locations).values([{ shopId, name: 'Warehouse', countryCode: 'FR', priority: 1 }, { shopId, name: 'Retail only', fulfillsOnlineOrders: false, countryCode: 'FR' }, { shopId, name: 'Closed', isActive: false, countryCode: 'FR' }]);
    const [eu, rowZone, prov] = await h.db.insert(s.shippingZones).values([{ shopId, name: 'Europe' }, { shopId, name: 'World' }, { shopId, name: 'Quebec' }]).returning();
    await h.db.insert(s.shippingZoneCountries).values([
      ...['FR', 'DE'].map((countryCode) => ({ shopId, zoneId: eu!.id, countryCode })), { shopId, zoneId: rowZone!.id, countryCode: '*' }, { shopId, zoneId: prov!.id, countryCode: 'CA', provinceCodes: ['QC'] },
    ]);
    const rates = await h.db.insert(s.shippingRates).values([
      { shopId, zoneId: eu!.id, name: 'Flat', type: 'FLAT', price: 490, position: 0 },
      { shopId, zoneId: eu!.id, name: 'Free', type: 'FREE', price: 999, position: 1 },
      { shopId, zoneId: eu!.id, name: 'Light', type: 'WEIGHT_BASED', price: 300, minValue: null, maxValue: 1000, position: 2 },
      { shopId, zoneId: eu!.id, name: 'Heavy', type: 'WEIGHT_BASED', price: 900, minValue: 1001, maxValue: 5000, position: 3 },
      { shopId, zoneId: eu!.id, name: 'Cheap order', type: 'PRICE_BASED', price: 200, minValue: null, maxValue: 4999, position: 4 },
      { shopId, zoneId: eu!.id, name: 'Big order', type: 'PRICE_BASED', price: 0, minValue: 5000, maxValue: null, position: 5 },
      { shopId, zoneId: eu!.id, name: 'Off', type: 'FLAT', price: 1, active: false, position: 6 },
      { shopId, zoneId: rowZone!.id, name: 'World flat', type: 'FLAT', price: 2500, position: 0 },
      { shopId, zoneId: prov!.id, name: 'Quebec flat', type: 'FLAT', price: 1500, position: 0 },
    ]).returning();
    for (const r of rates) legacy[r.name] = r.id;
    await h.migrate(full);
  }, 120_000);
  afterAll(async () => { await h.close(); rmSync(dir, { recursive: true, force: true }); });

  it('creates one general profile whose location group holds the active online locations', async () => {
    const [p] = await loadProfiles(h.db, shopId);
    expect(p).toMatchObject({ name: 'General profile', isDefault: true });
    const names = (await h.db.select().from(s.locations).where(eq(s.locations.shopId, shopId))).filter((l) => p!.groups[0]!.locationIds.includes(l.id)).map((l) => l.name).sort();
    expect(names).toEqual(['Shop location', 'Warehouse']);
    expect(p!.groups).toHaveLength(1);
    expect(p!.groups[0]!.zones.map((z) => z.name)).toEqual(['Europe', 'World', 'Quebec']);
  });

  it('keeps rate ids, so carts and orders pointing at a rate still resolve', async () => {
    const ids = (await h.db.select().from(s.deliveryMethodDefinitions)).map((m) => m.id).sort((a, b) => a - b);
    expect(ids).toEqual(Object.values(legacy).sort((a, b) => a - b));
    const [fresh] = await h.db.insert(s.deliveryMethodDefinitions).values({ shopId, zoneId: (await h.db.select().from(s.deliveryZones))[0]!.id, name: 'New', price: 1 }).returning();
    expect(fresh!.id).toBeGreaterThan(Math.max(...Object.values(legacy)));
    await h.db.delete(s.deliveryMethodDefinitions).where(eq(s.deliveryMethodDefinitions.id, fresh!.id));
  });

  it('gives the same offers as the old selection for a matrix of carts', async () => {
    const zones = await h.db.select().from(s.shippingZones);
    const zc = await h.db.select().from(s.shippingZoneCountries);
    const oldRates = await h.db.select().from(s.shippingRates).where(eq(s.shippingRates.active, true));
    const oldQuote = (country: string, province: string, cart: { subtotal: number; grams: number }) => {
      const rows = zc.filter((r) => r.countryCode === country || r.countryCode === '*');
      const specific = rows.find((r) => r.countryCode === country && (!r.provinceCodes.length || r.provinceCodes.includes(province)));
      const zone = specific ?? rows.find((r) => r.countryCode === '*');
      return zone ? matchShippingRates(oldRates.filter((r) => r.zoneId === zone.zoneId), cart) : [];
    };
    expect(zones).toHaveLength(3);
    let compared = 0;
    for (const [country, province] of [['FR', ''], ['DE', ''], ['CA', 'QC'], ['CA', 'ON'], ['JP', '']] as const) {
      for (const subtotal of [0, 1200, 4999, 5000, 12000]) {
        for (const grams of [0, 800, 1000, 1001, 5000, 5001]) {
          const lines: QuoteLine[] = [{ variantId: 987654, quantity: 1, price: subtotal, grams, requiresShipping: true }];
          const now = (await quoteShipping(h.db, shopId, { countryCode: country, provinceCode: province }, lines)).map((o) => `${o.id}:${o.name}:${o.price}`).sort();
          const before = oldQuote(country, province, { subtotal, grams }).map((o) => `${o.id}:${o.name}:${o.price}`).sort();
          expect(now, `${country}/${province} ${subtotal} ${grams}`).toEqual(before);
          compared++;
        }
      }
    }
    expect(compared).toBe(150);
  });
});

describe('profiles, quotes, pickup, local delivery and packages', () => {
  let h: DbHandle;
  let shopId: number;
  let general: number;
  let mainLocation: number;
  const sku: Record<string, number> = {};
  const line = (code: string, quantity: number, price: number, gramsEach = 250): QuoteLine => ({ variantId: sku[code]!, quantity, price, grams: gramsEach * quantity, requiresShipping: true });
  const fr = { countryCode: 'FR', provinceCode: null, zip: '75002' };

  beforeAll(async () => {
    h = await createDb({ memory: true });
    await runMigrations(h);
    await seedDemo(h.db, createLocalStorage(mkdtempSync(path.join(tmpdir(), 'ship-'))));
    shopId = (await getPrimaryShop(h.db))!.id;
    for (const v of await h.db.select().from(s.productVariants)) if (v.sku) sku[v.sku] = v.id;
    general = (await loadProfiles(h.db, shopId))[0]!.id;
    mainLocation = (await h.db.select().from(s.locations).where(eq(s.locations.shopId, shopId)))[0]!.id;
  }, 120_000);
  afterAll(async () => { await h.close(); });

  it('seeded zone shows up in the general profile; every shop has exactly one general profile', async () => {
    const profiles = await loadProfiles(h.db, shopId);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.groups[0]!.zones[0]!.methods.map((m) => m.name)).toEqual(['Standard', 'Free shipping over 50']);
    expect(await shippableCountries(h.db, shopId)).toEqual(['FR', 'DE', 'BE', 'NL', 'ES', 'IT']);
  });

  it('validates profile input with field paths', async () => {
    const err = async (input: Parameters<typeof createProfile>[2]) => { const r = await createProfile(h.db, shopId, input); expect(r.ok).toBe(false); return r.ok ? [] : r.errors; };
    expect((await err({ name: '  ' }))[0]).toMatchObject({ field: ['name'] });
    expect((await err({ name: 'x', locationGroupsToCreate: [{ locations: [999999] }] }))[0]).toMatchObject({ field: ['locationGroupsToCreate', '0', 'locations', '0'], message: 'Location not found' });
    expect((await err({ name: 'x', locationGroupsToCreate: [{ locations: [mainLocation], zonesToCreate: [{ name: 'Z', countries: [{ code: 'FRA' }] }] }] }))[0].field).toEqual(['locationGroupsToCreate', '0', 'zonesToCreate', '0', 'countries', '0', 'code']);
    expect((await err({ name: 'x', locationGroupsToCreate: [{ locations: [mainLocation], zonesToCreate: [{ name: 'Z', countries: [{ code: 'FR' }], methodDefinitionsToCreate: [{ name: 'R', price: -1 }] }] }] }))[0].message).toMatch(/greater than or equal to 0/);
    expect((await err({ name: 'x', locationGroupsToCreate: [{ locations: [mainLocation], zonesToCreate: [{ name: 'Z', countries: [{ code: 'FR' }], methodDefinitionsToCreate: [{ name: 'R', price: 1, conditionsToCreate: [{ field: 'TOTAL_WEIGHT', operator: 'GREATER_THAN_OR_EQUAL_TO', value: 10 }, { field: 'TOTAL_WEIGHT', operator: 'LESS_THAN_OR_EQUAL_TO', value: 5 }] }] }] }] }))[0].message).toMatch(/minimum must be less/);
    expect((await err({ name: 'x', locationGroupsToCreate: [{ locations: [mainLocation], zonesToCreate: [{ name: 'A', countries: [{ code: 'FR' }] }, { name: 'B', countries: [{ code: 'FR' }] }] }] }))[0].message).toMatch(/already in another zone/);
    expect(await getProfile(h.db, shopId, general)).not.toBeNull();
    expect((await loadProfiles(h.db, shopId))).toHaveLength(1);
  });

  it('refuses a taken name (any case), renaming or removing the general profile', async () => {
    const a = await createProfile(h.db, shopId, { name: 'Fragile' });
    expect(a.ok).toBe(true);
    const dup = await createProfile(h.db, shopId, { name: 'fragile ' });
    expect(dup.ok ? null : dup.errors[0]!.field).toEqual(['name']);
    expect((await updateProfile(h.db, shopId, general, { name: 'Other' })).ok).toBe(false);
    expect((await removeProfile(h.db, shopId, general)).ok).toBe(false);
    expect((await removeProfile(h.db, shopId, a.ok ? a.value.id : 0)).ok).toBe(true);
  });

  it('moves variants between profiles, and a removed profile gives them back to the general one', async () => {
    const a = await createProfile(h.db, shopId, { name: 'A', variantsToAssociate: [sku['HEB-250']!, sku['JPG-50']!] });
    const b = await createProfile(h.db, shopId, { name: 'B', variantsToAssociate: [sku['JPG-50']!] });
    if (!a.ok || !b.ok) throw new Error('create failed');
    expect((await getProfile(h.db, shopId, a.value.id))!.variantCount).toBe(1);
    expect(b.value.variantCount).toBe(1);
    await updateProfile(h.db, shopId, a.value.id, { variantsToDissociate: [sku['HEB-250']!] });
    expect((await getProfile(h.db, shopId, a.value.id))!.variantCount).toBe(0);
    expect((await updateProfile(h.db, shopId, a.value.id, { variantsToAssociate: [123456789] })).ok).toBe(false);
    await removeProfile(h.db, shopId, b.value.id);
    await removeProfile(h.db, shopId, a.value.id);
    expect(await h.db.select().from(s.deliveryProfileVariants)).toHaveLength(0);
  });

  it('quotes across profiles: shared names add up, otherwise the cheapest of each, no zone blocks the cart', async () => {
    const general1 = await quoteShipping(h.db, shopId, fr, [line('JPG-50', 1, 1100)]);
    expect(general1.map((o) => [o.name, o.price])).toEqual([['Standard', 490]]);
    // order of 50 EUR or more: both seeded rates match, cheapest first
    expect((await quoteShipping(h.db, shopId, fr, [line('HEB-250', 4, 1300)])).map((o) => [o.name, o.price])).toEqual([['Free shipping over 50', 0]]);

    const heavy = await createProfile(h.db, shopId, {
      name: 'Freight', variantsToAssociate: [sku['HEB-250']!],
      locationGroupsToCreate: [{ locations: [mainLocation], zonesToCreate: [{ name: 'France', countries: [{ code: 'FR' }], methodDefinitionsToCreate: [
        { name: 'Freight', price: 2000, conditionsToCreate: [{ field: 'TOTAL_WEIGHT', operator: 'GREATER_THAN_OR_EQUAL_TO', value: 400 }] },
        { name: 'Standard', price: 500, freeOverAmount: 10000 },
      ] }] }],
    });
    if (!heavy.ok) throw new Error(JSON.stringify(heavy.errors));
    const cart = [line('HEB-250', 2, 1300), line('JPG-50', 1, 1100)];
    // general profile gets Standard 4.90 (its own subtotal 11.00); freight has Standard 5.00 and Freight 20.00 (500 g)
    expect((await quoteShipping(h.db, shopId, fr, cart)).map((o) => [o.name, o.price])).toEqual([['Standard', 990]]);
    // 100 g only: Freight condition not met, still Standard
    expect((await quoteShipping(h.db, shopId, fr, [line('HEB-250', 1, 1300, 100), line('JPG-50', 1, 1100)])).map((o) => [o.name, o.price])).toEqual([['Standard', 990]]);
    // free-over threshold of the custom profile counts its own lines only
    expect((await quoteShipping(h.db, shopId, fr, [line('HEB-250', 10, 1300), line('JPG-50', 1, 1100)])).map((o) => [o.name, o.price])).toEqual([['Standard', 490]]);
    // no shared name: remove the freight Standard, the cheapest of each profile is added
    const tree = (await getProfile(h.db, shopId, heavy.value.id))!;
    const stdId = tree.groups[0]!.zones[0]!.methods.find((m) => m.name === 'Standard')!.id;
    await updateProfile(h.db, shopId, heavy.value.id, { methodDefinitionsToDelete: [stdId] });
    const combo = await quoteShipping(h.db, shopId, fr, cart);
    expect(combo.map((o) => [o.name, o.price])).toEqual([['Standard + Freight', 2490]]);
    // Germany is in the general profile only: the freight item cannot ship there
    expect(await quoteShipping(h.db, shopId, { countryCode: 'DE' }, cart)).toEqual([]);
    expect((await quoteShipping(h.db, shopId, { countryCode: 'DE' }, [line('JPG-50', 1, 1100)])).map((o) => o.name)).toEqual(['Standard']);
    // lines that need no shipping are ignored
    expect(await quoteShipping(h.db, shopId, fr, [{ ...line('HEB-250', 2, 1300), requiresShipping: false }])).toEqual([]);

    await removeProfile(h.db, shopId, heavy.value.id);
    expect((await quoteShipping(h.db, shopId, fr, cart)).map((o) => o.name)).toEqual(['Standard']);
  });

  it('updates rates and conditions through the profile (zone, rate, condition ids)', async () => {
    const [p] = await loadProfiles(h.db, shopId);
    const g = p!.groups[0]!;
    const z = g.zones[0]!;
    const std = z.methods.find((m) => m.name === 'Standard')!;
    const r = await updateProfile(h.db, shopId, general, { locationGroupsToUpdate: [{ id: g.id, zonesToUpdate: [{ id: z.id, methodDefinitionsToUpdate: [{ id: std.id, price: 650, active: false }] }] }] });
    expect(r.ok).toBe(true);
    expect((await quoteShipping(h.db, shopId, fr, [line('JPG-50', 1, 1100)]))).toEqual([]);
    await updateProfile(h.db, shopId, general, { locationGroupsToUpdate: [{ id: g.id, zonesToUpdate: [{ id: z.id, methodDefinitionsToUpdate: [{ id: std.id, active: true }] }] }] });
    const q = await quoteShipping(h.db, shopId, fr, [line('JPG-50', 1, 1100)]);
    expect(q[0]).toMatchObject({ name: 'Standard', price: 650 });
    const v = (await getProfile(h.db, shopId, general))!.version;
    expect(v).toBeGreaterThan(1);
    // province zone wins over the country zone
    const added = await updateProfile(h.db, shopId, general, { locationGroupsToUpdate: [{ id: g.id, zonesToCreate: [{ name: 'Corsica', countries: [{ code: 'FR', provinces: ['2A'] }], methodDefinitionsToCreate: [{ name: 'Island', price: 1900 }] }] }] });
    expect(added.ok).toBe(true);
    expect((await quoteShipping(h.db, shopId, { countryCode: 'FR', provinceCode: '2A' }, [line('JPG-50', 1, 1100)])).map((o) => o.name)).toEqual(['Island']);
    expect((await quoteShipping(h.db, shopId, { countryCode: 'FR', provinceCode: 'IDF' }, [line('JPG-50', 1, 1100)])).map((o) => o.name)).toEqual(['Standard']);
    const corsica = (await getProfile(h.db, shopId, general))!.groups[0]!.zones.find((x) => x.name === 'Corsica')!;
    await updateProfile(h.db, shopId, general, { zonesToDelete: [corsica.id] });
    expect((await getProfile(h.db, shopId, general))!.groups[0]!.zones.map((x) => x.name)).toEqual(['Europe']);
  });

  it('offers pickup only for active locations with the items in stock, and keeps the setting when disabled', async () => {
    expect((await enablePickup(h.db, shopId, { locationId: 9999, pickupTime: 'ONE_HOUR' }))).toMatchObject({ ok: false, errors: [{ code: 'ACTIVE_LOCATION_NOT_FOUND' }] });
    expect((await enablePickup(h.db, shopId, { locationId: mainLocation, pickupTime: 'CUSTOM' }))).toMatchObject({ ok: false, errors: [{ code: 'CUSTOM_PICKUP_TIME_NOT_ALLOWED' }] });
    const on = await enablePickup(h.db, shopId, { locationId: mainLocation, pickupTime: 'TWO_TO_FOUR_DAYS', instructions: 'Ask at the counter' });
    expect(on.ok).toBe(true);
    const q = await quoteShipping(h.db, shopId, fr, [line('JPG-50', 1, 1100)]);
    expect(q.map((o) => [o.name, o.type, o.price])).toEqual([['Standard', 'SHIPPING', 650], ['Pickup at Shop location', 'PICK_UP', 0]]);
    expect(q[1]!.detail).toContain('Usually ready in 2-4 days');
    expect(q[1]!.id).toBeLessThan(0);
    // far more than the stock: no pickup
    expect((await quoteShipping(h.db, shopId, fr, [line('JPG-50', 5000, 1100)])).some((o) => o.type === 'PICK_UP')).toBe(false);
    await disablePickup(h.db, shopId, mainLocation);
    expect((await quoteShipping(h.db, shopId, fr, [line('JPG-50', 1, 1100)])).map((o) => o.type)).toEqual(['SHIPPING']);
    const kept = await enablePickup(h.db, shopId, { locationId: mainLocation, pickupTime: 'ONE_HOUR' });
    expect(kept.ok && kept.value.pickupTime).toBe('ONE_HOUR');
    // a deactivated location does not offer pickup, and comes back when reactivated
    const second = await addLocation(h.db, shopId, { name: 'Second', address: { countryCode: 'FR' } });
    if (!second.ok) throw new Error('location');
    await enablePickup(h.db, shopId, { locationId: second.value.id });
    await h.db.update(s.locations).set({ isActive: false }).where(eq(s.locations.id, second.value.id));
    expect((await quoteShipping(h.db, shopId, fr, [line('JPG-50', 1, 1100)])).filter((o) => o.type === 'PICK_UP')).toHaveLength(1);
  });

  it('offers local delivery inside the postal codes, above the minimum order, free over the threshold', async () => {
    expect((await updateLocalDelivery(h.db, shopId, mainLocation, { enabled: true, postalCodes: [] })).ok).toBe(false);
    expect((await updateLocalDelivery(h.db, shopId, mainLocation, { enabled: true, postalCodes: ['75'], areaType: 'RADIUS' })).ok).toBe(false);
    const r = await updateLocalDelivery(h.db, shopId, mainLocation, { enabled: true, postalCodes: ['75', '92'], price: 600, minimumOrder: 2000, freeOverAmount: 6000 });
    expect(r.ok).toBe(true);
    const names = async (zip: string, price: number) => (await quoteShipping(h.db, shopId, { countryCode: 'FR', zip }, [line('HEB-250', 1, price)])).filter((o) => o.type === 'LOCAL').map((o) => [o.name, o.price]);
    expect(await names('75002', 2600)).toEqual([['Local delivery', 600]]);
    expect(await names('92 100', 6500)).toEqual([['Local delivery', 0]]);
    expect(await names('69001', 2600)).toEqual([]);
    expect(await names('75002', 1300)).toEqual([]);
    expect((await quoteShipping(h.db, shopId, { countryCode: 'DE', zip: '75002' }, [line('HEB-250', 2, 1300)])).some((o) => o.type === 'LOCAL')).toBe(false);
  });

  it('manages packages with one default', async () => {
    expect(await listPackages(h.db, shopId)).toEqual([]);
    expect((await createPackage(h.db, shopId, { name: ' ' })).ok).toBe(false);
    const a = await createPackage(h.db, shopId, { name: 'Small box', type: 'BOX', length: 20, width: 15, height: 8, dimensionUnit: 'CENTIMETERS', weight: 0.1, weightUnit: 'KILOGRAMS' });
    const b = await createPackage(h.db, shopId, { name: 'Mailer', type: 'SOFT_PACK' });
    if (!a.ok || !b.ok) throw new Error('create');
    expect(a.value.isDefault).toBe(true);
    expect(b.value.isDefault).toBe(false);
    await makeDefaultPackage(h.db, shopId, b.value.id);
    expect((await listPackages(h.db, shopId)).map((p) => [p.name, p.isDefault])).toEqual([['Small box', false], ['Mailer', true]]);
    expect((await updatePackage(h.db, shopId, a.value.id, { name: 'Medium box', width: -1 })).ok).toBe(false);
    expect((await updatePackage(h.db, shopId, a.value.id, { name: 'Medium box', height: 10 })).ok).toBe(true);
    await deletePackage(h.db, shopId, b.value.id);
    expect((await listPackages(h.db, shopId)).map((p) => [p.name, p.isDefault, p.height])).toEqual([['Medium box', true, 10]]);
    expect((await h.db.select().from(s.shippingPackages).where(and(eq(s.shippingPackages.shopId, shopId), eq(s.shippingPackages.isDefault, true))))).toHaveLength(1);
  });
});
