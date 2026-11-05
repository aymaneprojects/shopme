/**
 * Pure shipping rules: zone resolution, rate conditions and the combination of rates across delivery profiles.
 * No database access here, so every rule is unit-testable.
 */

export type ConditionField = 'TOTAL_WEIGHT' | 'TOTAL_PRICE';
export type ConditionOperator = 'GREATER_THAN_OR_EQUAL_TO' | 'LESS_THAN_OR_EQUAL_TO';
/** Weight in grams, price in minor units. */
export interface Condition { field: ConditionField; operator: ConditionOperator; value: number }

export interface MethodDef {
  id: number; name: string; price: number; position: number; freeOverAmount: number | null; conditions: Condition[];
  /** Estimated transit time in days. */
  transit?: { min: number; max: number } | null;
}
export interface ZoneCountryDef { countryCode: string | null; restOfWorld: boolean; provinceCodes: string[] }
export interface ZoneDef { id: number; countries: ZoneCountryDef[]; methods: MethodDef[] }

export interface QuotedRate { id: number; name: string; price: number; position: number; transit?: { min: number; max: number } | null }

/** What a profile's lines add up to. */
export interface CartTotals { subtotal: number; grams: number }

/** The zone covering a destination: a province zone beats a country zone, which beats the rest-of-world zone. */
export function resolveZone(zones: ZoneDef[], country: string | null, province: string | null): ZoneDef | null {
  if (!country) return null;
  const c = country.toUpperCase();
  const p = (province ?? '').toUpperCase();
  const entries = zones.flatMap((z) => z.countries.map((e) => ({ z, e })));
  const byProvince = entries.find(({ e }) => e.countryCode?.toUpperCase() === c && e.provinceCodes.length > 0 && !!p && e.provinceCodes.some((x) => x.toUpperCase() === p));
  if (byProvince) return byProvince.z;
  const byCountry = entries.find(({ e }) => e.countryCode?.toUpperCase() === c && e.provinceCodes.length === 0);
  if (byCountry) return byCountry.z;
  return entries.find(({ e }) => e.restOfWorld)?.z ?? null;
}

/** Whether every condition of a rate holds for the totals. A rate without conditions always matches. */
export function conditionsMatch(conditions: Condition[], totals: CartTotals): boolean {
  return conditions.every((c) => {
    const v = c.field === 'TOTAL_WEIGHT' ? totals.grams : totals.subtotal;
    return c.operator === 'GREATER_THAN_OR_EQUAL_TO' ? v >= c.value : v <= c.value;
  });
}

/** Price of a rate for the totals: 0 once the free-over threshold is reached. */
export function rateCost(m: Pick<MethodDef, 'price' | 'freeOverAmount'>, totals: CartTotals): number {
  return m.freeOverAmount != null && totals.subtotal >= m.freeOverAmount ? 0 : m.price;
}

/**
 * Rates of one zone offered for the totals. Rates sharing a name collapse into one option, the highest price wins.
 * Ordered by price ascending, then by merchant order.
 */
export function matchMethods(methods: MethodDef[], totals: CartTotals): QuotedRate[] {
  const byName = new Map<string, QuotedRate>();
  for (const m of [...methods].sort((a, b) => a.position - b.position || a.id - b.id)) {
    if (!conditionsMatch(m.conditions, totals)) continue;
    const q: QuotedRate = { id: m.id, name: m.name, price: rateCost(m, totals), position: m.position, ...(m.transit ? { transit: m.transit } : {}) };
    const key = m.name.trim().toLowerCase();
    const cur = byName.get(key);
    if (!cur || q.price > cur.price) byName.set(key, q);
  }
  return [...byName.values()].sort((a, b) => a.price - b.price || a.position - b.position || a.id - b.id);
}

/** Parcels of several profiles arrive together: the slowest estimate wins. */
const transitOf = (parts: QuotedRate[]): { transit?: { min: number; max: number } } => {
  const t = parts.map((p) => p.transit).filter((x): x is { min: number; max: number } => !!x);
  return t.length ? { transit: { min: Math.max(...t.map((x) => x.min)), max: Math.max(...t.map((x) => x.max)) } } : {};
};

/**
 * Combine the options of several profiles into what the buyer sees. A profile with no option means the cart cannot ship.
 * Options with the same name in every profile are summed. Without any shared name, one option adds the cheapest of each profile.
 * The id of a combined option is the smallest id of its parts, so it stays stable between requests.
 */
export function combineProfiles(perProfile: QuotedRate[][]): QuotedRate[] {
  if (!perProfile.length || perProfile.some((p) => !p.length)) return [];
  if (perProfile.length === 1) return perProfile[0]!;
  const key = (n: string) => n.trim().toLowerCase();
  const shared = perProfile[0]!.filter((o) => perProfile.every((p) => p.some((x) => key(x.name) === key(o.name))));
  if (shared.length) {
    return shared.map((o) => {
      const parts = perProfile.map((p) => p.find((x) => key(x.name) === key(o.name))!);
      return { id: Math.min(...parts.map((x) => x.id)), name: o.name, price: parts.reduce((a, x) => a + x.price, 0), position: Math.min(...parts.map((x) => x.position)), ...transitOf(parts) };
    }).sort((a, b) => a.price - b.price || a.position - b.position || a.id - b.id);
  }
  const parts = perProfile.map((p) => p[0]!);
  return [{ id: Math.min(...parts.map((x) => x.id)), name: parts.map((x) => x.name).join(' + '), price: parts.reduce((a, x) => a + x.price, 0), position: Math.min(...parts.map((x) => x.position)), ...transitOf(parts) }];
}

// --- special option ids ----------------------------------------------------------------------------------------------
// Checkout carries the chosen option as one integer. Rates use their own (positive) id, pickup and local delivery use negative ones.

const LOCAL_BASE = 1_000_000_000;
export const pickupOptionId = (locationId: number) => -locationId;
export const localDeliveryOptionId = (locationId: number) => -(LOCAL_BASE + locationId);
export function decodeOptionId(id: number): { type: 'SHIPPING' } | { type: 'PICK_UP'; locationId: number } | { type: 'LOCAL'; locationId: number } {
  if (id > 0) return { type: 'SHIPPING' };
  const n = -id;
  return n >= LOCAL_BASE ? { type: 'LOCAL', locationId: n - LOCAL_BASE } : { type: 'PICK_UP', locationId: n };
}

// --- local delivery ----------------------------------------------------------------------------------------------------

const normZip = (z: string) => z.replace(/[\s-]/g, '').toUpperCase();
/** A postal code is in the area when it starts with one of the patterns (spaces and dashes ignored, `*` suffix allowed). */
export function postalCodeInArea(zip: string | null | undefined, patterns: string[]): boolean {
  const z = normZip(zip ?? '');
  if (!z) return false;
  return patterns.some((p) => { const n = normZip(p.replace(/\*+$/, '')); return n !== '' && z.startsWith(n); });
}
