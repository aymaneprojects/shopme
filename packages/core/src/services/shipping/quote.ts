import { and, asc, eq, inArray } from 'drizzle-orm';
import { inventoryItems, inventoryLevels, locationLocalDelivery, locationPickupSettings, locations, productVariants } from '../../db/schema';
import type { Executor } from '../../db/client';
import type { PricingShippingRate } from '../pricing';
import { loadProfiles, profileOfVariants, type ProfileTree } from './profiles';
import { combineProfiles, localDeliveryOptionId, matchMethods, pickupOptionId, postalCodeInArea, resolveZone, type CartTotals, type QuotedRate, type ZoneDef } from './rates';

/** A cart line as shipping sees it. `grams` is the weight of the whole line (unit weight x quantity). */
export interface QuoteLine { variantId: number; quantity: number; price: number; grams: number; requiresShipping: boolean }
export interface QuoteDestination { countryCode: string | null; provinceCode?: string | null; zip?: string | null }

const PICKUP_LABELS: Record<string, string> = {
  ONE_HOUR: 'Usually ready in 1 hour', TWO_HOURS: 'Usually ready in 2 hours', FOUR_HOURS: 'Usually ready in 4 hours', TWENTY_FOUR_HOURS: 'Usually ready in 24 hours',
  TWO_TO_FOUR_DAYS: 'Usually ready in 2-4 days', FIVE_OR_MORE_DAYS: 'Usually ready in 5 days or more',
};
export const pickupTimeLabel = (time: string, custom?: string | null) => (time === 'CUSTOM' ? custom?.trim() || '' : PICKUP_LABELS[time] ?? '');

interface Stock { free: boolean; byLocation: Map<number, number> }

/** Stock of each variant per location. Variants that do not track stock, or that sell past zero, can be fulfilled from anywhere. */
async function stockOf(db: Executor, shopId: number, variantIds: number[]): Promise<Map<number, Stock>> {
  const out = new Map<number, Stock>();
  if (!variantIds.length) return out;
  const items = await db.select({ variantId: productVariants.id, policy: productVariants.inventoryPolicy, itemId: inventoryItems.id, tracked: inventoryItems.tracked })
    .from(productVariants).leftJoin(inventoryItems, eq(inventoryItems.variantId, productVariants.id))
    .where(and(eq(productVariants.shopId, shopId), inArray(productVariants.id, variantIds)));
  const itemIds = items.flatMap((i) => (i.itemId ? [i.itemId] : []));
  const levels = itemIds.length ? await db.select().from(inventoryLevels).where(and(inArray(inventoryLevels.inventoryItemId, itemIds), eq(inventoryLevels.isActive, true))) : [];
  for (const i of items) {
    const byLocation = new Map<number, number>();
    for (const l of levels) if (l.inventoryItemId === i.itemId) byLocation.set(l.locationId, Math.max(0, l.available));
    out.set(i.variantId, { free: i.policy === 'CONTINUE' || !i.itemId || i.tracked === false, byLocation });
  }
  return out;
}

/** Whether the given locations together hold every line. */
function canFulfill(lines: QuoteLine[], locationIds: number[], stock: Map<number, Stock>): boolean {
  const want = new Map<number, number>();
  for (const l of lines) want.set(l.variantId, (want.get(l.variantId) ?? 0) + l.quantity);
  for (const [variantId, qty] of want) {
    const s = stock.get(variantId);
    if (!s || s.free) continue;
    if (locationIds.reduce((a, id) => a + (s.byLocation.get(id) ?? 0), 0) < qty) return false;
  }
  return true;
}

const totalsOf = (lines: QuoteLine[]): CartTotals => ({ subtotal: lines.reduce((a, l) => a + l.price * l.quantity, 0), grams: lines.reduce((a, l) => a + l.grams, 0) });

/** Options of one profile for the destination: the location group that can ship the lines (priority order), its zone, the matching rates. */
function profileOptions(profile: ProfileTree, lines: QuoteLine[], dest: QuoteDestination, activeLocs: Map<number, number>, stock: Map<number, Stock>): QuotedRate[] {
  const totals = totalsOf(lines);
  const groups = profile.groups
    .map((g) => ({ g, ids: g.locationIds.filter((id) => activeLocs.has(id)) }))
    .filter((x) => x.ids.length > 0)
    .map((x) => ({ ...x, ok: canFulfill(lines, x.ids, stock), prio: Math.min(...x.ids.map((id) => activeLocs.get(id)!)) }))
    .sort((a, b) => Number(b.ok) - Number(a.ok) || a.prio - b.prio || a.g.id - b.g.id);
  for (const { g } of groups) {
    const zones: ZoneDef[] = g.zones.map((z) => ({
      id: z.id, countries: z.countries.map((c) => ({ countryCode: c.countryCode, restOfWorld: c.restOfWorld, provinceCodes: c.provinceCodes })),
      methods: z.methods.filter((m) => m.active).map((m) => ({ id: m.id, name: m.name, price: m.price, position: m.position, freeOverAmount: m.freeOverAmount, conditions: m.conditions })),
    }));
    const zone = resolveZone(zones, dest.countryCode, dest.provinceCode ?? null);
    if (!zone) continue;
    const rates = matchMethods(zone.methods, totals);
    if (rates.length) return rates;
  }
  return [];
}

/**
 * Everything the buyer can pick to receive the cart: shipping rates combined across delivery profiles (cheapest first), then local
 * delivery, then pickup at the locations that hold the items. Empty when nothing ships to the destination.
 */
export async function quoteShipping(db: Executor, shopId: number, dest: QuoteDestination, allLines: QuoteLine[]): Promise<PricingShippingRate[]> {
  const lines = allLines.filter((l) => l.requiresShipping);
  if (!lines.length || !dest.countryCode) return [];
  const variantIds = [...new Set(lines.map((l) => l.variantId))];
  const [profiles, owner, stock, locs] = await Promise.all([
    loadProfiles(db, shopId), profileOfVariants(db, shopId, variantIds), stockOf(db, shopId, variantIds),
    db.select().from(locations).where(and(eq(locations.shopId, shopId), eq(locations.isActive, true))).orderBy(asc(locations.priority), asc(locations.id)),
  ]);
  const activeLocs = new Map(locs.filter((l) => l.fulfillsOnlineOrders).map((l) => [l.id, l.priority]));
  const byProfile = new Map<number, QuoteLine[]>();
  for (const l of lines) { const pid = owner.get(l.variantId)!; byProfile.set(pid, [...(byProfile.get(pid) ?? []), l]); }
  const perProfile: QuotedRate[][] = [];
  // General profile first, then the others by id, so combined option names read the same every time.
  const order = (pid: number) => { const p = profiles.find((x) => x.id === pid); return [p?.isDefault ? 0 : 1, pid]; };
  for (const [pid, pl] of [...byProfile].sort((a, b) => order(a[0])[0]! - order(b[0])[0]! || a[0] - b[0])) {
    const profile = profiles.find((p) => p.id === pid);
    perProfile.push(profile ? profileOptions(profile, pl, dest, activeLocs, stock) : []);
  }
  const options: PricingShippingRate[] = combineProfiles(perProfile).map((o) => ({ id: o.id, name: o.name, price: o.price, type: 'SHIPPING' as const }));

  // Local delivery and pickup are per location, outside profiles.
  const locIds = locs.map((l) => l.id);
  const [pickups, locals] = locIds.length ? await Promise.all([
    db.select().from(locationPickupSettings).where(and(eq(locationPickupSettings.shopId, shopId), eq(locationPickupSettings.enabled, true), inArray(locationPickupSettings.locationId, locIds))),
    db.select().from(locationLocalDelivery).where(and(eq(locationLocalDelivery.shopId, shopId), eq(locationLocalDelivery.enabled, true), inArray(locationLocalDelivery.locationId, locIds))),
  ]) : [[], []];
  const totals = totalsOf(lines);
  const localOpts: PricingShippingRate[] = [];
  const eligibleLocal = locals.filter((d) => {
    const loc = locs.find((l) => l.id === d.locationId)!;
    return loc.countryCode?.toUpperCase() === dest.countryCode!.toUpperCase() && postalCodeInArea(dest.zip, d.postalCodes)
      && (d.minimumOrder == null || totals.subtotal >= d.minimumOrder) && canFulfill(lines, [d.locationId], stock);
  });
  for (const d of eligibleLocal) {
    const loc = locs.find((l) => l.id === d.locationId)!;
    localOpts.push({
      id: localDeliveryOptionId(d.locationId), name: eligibleLocal.length > 1 ? `Local delivery from ${loc.name}` : 'Local delivery',
      price: d.freeOverAmount != null && totals.subtotal >= d.freeOverAmount ? 0 : d.price, type: 'LOCAL', locationId: d.locationId, detail: d.info || null,
    });
  }
  const pickupOpts: PricingShippingRate[] = [];
  for (const p of pickups) {
    const loc = locs.find((l) => l.id === p.locationId)!;
    if (!canFulfill(lines, [p.locationId], stock)) continue;
    const address = [loc.address1, [loc.zip, loc.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    pickupOpts.push({
      id: pickupOptionId(p.locationId), name: `Pickup at ${loc.name}`, price: 0, type: 'PICK_UP', locationId: p.locationId,
      detail: [pickupTimeLabel(p.pickupTime, p.customPickupTime), address].filter(Boolean).join(' · ') || null,
    });
  }
  return [...options, ...localOpts.sort((a, b) => a.price - b.price), ...pickupOpts];
}

/** Country codes that have at least one active rate (`'*'` means any country). */
export async function shippableCountries(db: Executor, shopId: number): Promise<string[]> {
  const out = new Set<string>();
  for (const p of await loadProfiles(db, shopId)) {
    for (const g of p.groups) for (const z of g.zones) {
      if (!z.methods.some((m) => m.active)) continue;
      for (const c of z.countries) { if (c.restOfWorld) out.add('*'); else if (c.countryCode) out.add(c.countryCode); }
    }
  }
  return [...out];
}
