import { eq } from 'drizzle-orm';
import { marketRegions, markets } from '../../db/schema';
import type { Executor } from '../../db/client';
import { loadProfiles } from './profiles';
import { resolveZone } from './rates';

export interface MarketShippingOption {
  profile: string; zone: string; name: string; price: number; countries: string[];
  /** Ids of the rate, its profile and its location group, so a screen can link to it. */
  methodId: number; profileId: number;
  /** Free once the order subtotal reaches this amount (minor units), when set. */
  freeOverAmount: number | null;
  transitMinDays: number | null; transitMaxDays: number | null;
  /** Collections the rate is limited to (empty: every product) and the locations it ships from (empty: every location of its group). */
  collectionIds: number[]; originLocationIds: number[];
}
export interface MarketShipping { marketId: number; name: string; handle: string; status: string; primary: boolean; countries: string[]; options: MarketShippingOption[]; uncovered: string[] }

/**
 * The shipping options each market gets: for every country of the market, the zone of each delivery profile that covers it and the active rates
 * of that zone. Options with the same name and price in several countries are listed once with all of their countries.
 */
export async function shippingByMarket(db: Executor, shopId: number): Promise<MarketShipping[]> {
  const [ms, regions, profiles] = await Promise.all([
    db.select().from(markets).where(eq(markets.shopId, shopId)).orderBy(markets.id),
    db.select().from(marketRegions).where(eq(marketRegions.shopId, shopId)),
    loadProfiles(db, shopId),
  ]);
  return ms.map((m) => {
    const countries = regions.filter((r) => r.marketId === m.id).map((r) => r.countryCode).sort();
    const found = new Map<string, MarketShippingOption>();
    const covered = new Set<string>();
    for (const p of profiles) {
      for (const g of p.groups) {
        const zones = g.zones.map((z) => ({ id: z.id, countries: z.countries.map((c) => ({ countryCode: c.countryCode, restOfWorld: c.restOfWorld, provinceCodes: c.provinceCodes })), methods: [] }));
        for (const country of countries) {
          const zone = resolveZone(zones, country, null);
          const full = zone && g.zones.find((z) => z.id === zone.id);
          if (!full) continue;
          for (const method of full.methods.filter((x) => x.active)) {
            covered.add(country);
            const key = `${p.id}|${full.id}|${method.name}|${method.price}`;
            const cur = found.get(key);
            if (cur) cur.countries.push(country);
            else found.set(key, {
              profile: p.name, zone: full.name, name: method.name, price: method.price, countries: [country], methodId: method.id, profileId: p.id,
              freeOverAmount: method.freeOverAmount ?? null, transitMinDays: method.transitMinDays ?? null, transitMaxDays: method.transitMaxDays ?? null,
              collectionIds: method.collectionIds ?? [], originLocationIds: method.originLocationIds?.length ? method.originLocationIds : g.locationIds,
            });
          }
        }
      }
    }
    return { marketId: m.id, name: m.name, handle: m.handle, status: m.status, primary: m.isPrimary, countries, options: [...found.values()], uncovered: countries.filter((c) => !covered.has(c)) };
  });
}
