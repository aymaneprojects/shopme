/**
 * The flat "shipping zones and rates" API (`shippingZones`, `shippingZoneCreate`, ...), kept as a view over the general delivery profile:
 * a zone is a zone of the profile's first location group, a rate is a method definition (type derived from its conditions).
 */
import { and, asc, eq } from 'drizzle-orm';
import { deliveryLocationGroupLocations, deliveryLocationGroups, locations } from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { errR, okR, type Result } from '../catalog/common';
import { ensureGeneralProfile, getProfile, updateProfile, type ConditionInput, type MethodInput, type MethodRow, type ZoneRow } from './profiles';

export interface ShippingRate { id: number; shopId: number; zoneId: number; name: string; type: string; price: number; minValue: number | null; maxValue: number | null; position: number; active: boolean }
export interface ShippingZone { id: number; shopId: number; name: string; countries: { zoneId: number; countryCode: string; provinceCodes: string[] }[]; rates: ShippingRate[] }

export interface ShippingRateInput {
  name?: string | null;
  type?: 'FLAT' | 'WEIGHT_BASED' | 'PRICE_BASED' | 'FREE' | null;
  /** minor units */
  price?: number | null;
  /** grams for WEIGHT_BASED, minor units for PRICE_BASED */
  minValue?: number | null;
  maxValue?: number | null;
  active?: boolean | null;
}
export interface ShippingZoneInput { name?: string | null; countries?: { countryCode: string; provinceCodes?: string[] | null }[] | null; rates?: ShippingRateInput[] | null }

const RATE_TYPES = ['FLAT', 'WEIGHT_BASED', 'PRICE_BASED', 'FREE'];

function checkRate(r: ShippingRateInput, creating: boolean, at: string[]): Result<null> {
  if (creating && !r.name?.trim()) return errR([...at, 'name'], "Name can't be blank");
  if (r.name !== undefined && r.name !== null && !r.name.trim()) return errR([...at, 'name'], "Name can't be blank");
  if (r.type && !RATE_TYPES.includes(r.type)) return errR([...at, 'type'], 'Type is invalid');
  if (r.price != null && r.price < 0) return errR([...at, 'price'], 'Price must be greater than or equal to 0');
  if (r.minValue != null && r.maxValue != null && r.maxValue < r.minValue) return errR([...at, 'maxValue'], 'Maximum must be greater than or equal to the minimum');
  return okR(null);
}

function checkZone(i: ShippingZoneInput, creating: boolean): Result<null> {
  if ((creating || i.name !== undefined) && !i.name?.trim()) return errR(['name'], "Name can't be blank");
  const bad = i.countries?.findIndex((c) => c.countryCode !== '*' && !/^[A-Za-z]{2}$/.test(c.countryCode)) ?? -1;
  if (bad >= 0) return errR(['countries', String(bad), 'countryCode'], 'Country code is invalid');
  for (const [n, r] of (i.rates ?? []).entries()) { const v = checkRate(r, true, ['rates', String(n)]); if (!v.ok) return v; }
  return okR(null);
}

// --- mapping between the flat rate and a method definition ----------------------------------------------------------------

const rateOf = (shopId: number, m: MethodRow): ShippingRate => {
  const w = m.conditions.filter((c) => c.field === 'TOTAL_WEIGHT');
  const p = m.conditions.filter((c) => c.field === 'TOTAL_PRICE');
  const conds = w.length ? w : p;
  const min = conds.find((c) => c.operator === 'GREATER_THAN_OR_EQUAL_TO')?.value ?? null;
  const max = conds.find((c) => c.operator === 'LESS_THAN_OR_EQUAL_TO')?.value ?? null;
  const type = w.length ? 'WEIGHT_BASED' : p.length ? 'PRICE_BASED' : m.price === 0 ? 'FREE' : 'FLAT';
  return { id: m.id, shopId, zoneId: m.zoneId, name: m.name, type, price: m.price, minValue: min, maxValue: max, position: m.position, active: m.active };
};
const zoneOf = (shopId: number, z: ZoneRow): ShippingZone => ({
  id: z.id, shopId, name: z.name,
  countries: z.countries.map((c) => ({ zoneId: z.id, countryCode: c.restOfWorld ? '*' : c.countryCode ?? '', provinceCodes: c.provinceCodes })),
  rates: z.methods.map((m) => rateOf(shopId, m)),
});

const conditionsFor = (r: Pick<ShippingRateInput, 'type' | 'minValue' | 'maxValue'>): ConditionInput[] => {
  if (r.type !== 'WEIGHT_BASED' && r.type !== 'PRICE_BASED') return [];
  const field: ConditionInput['field'] = r.type === 'WEIGHT_BASED' ? 'TOTAL_WEIGHT' : 'TOTAL_PRICE';
  return [
    ...(r.minValue != null ? [{ field, operator: 'GREATER_THAN_OR_EQUAL_TO' as const, value: r.minValue }] : []),
    ...(r.maxValue != null ? [{ field, operator: 'LESS_THAN_OR_EQUAL_TO' as const, value: r.maxValue }] : []),
  ];
};
const methodOf = (r: ShippingRateInput): MethodInput => ({
  name: r.name, active: r.active ?? true, price: r.type === 'FREE' ? 0 : (r.price ?? 0), conditionsToCreate: conditionsFor(r),
});

/** The first location group of the general profile (created when missing). */
async function generalGroup(db: Executor, shopId: number): Promise<{ profileId: number; groupId: number }> {
  const profileId = await ensureGeneralProfile(db, shopId);
  const [g] = await db.select({ id: deliveryLocationGroups.id }).from(deliveryLocationGroups).where(eq(deliveryLocationGroups.profileId, profileId)).orderBy(asc(deliveryLocationGroups.id)).limit(1);
  if (g) return { profileId, groupId: g.id };
  const [row] = await db.insert(deliveryLocationGroups).values({ shopId, profileId }).returning({ id: deliveryLocationGroups.id });
  const locs = await db.select({ id: locations.id }).from(locations).where(and(eq(locations.shopId, shopId), eq(locations.isActive, true), eq(locations.fulfillsOnlineOrders, true)));
  if (locs.length) await db.insert(deliveryLocationGroupLocations).values(locs.map((l) => ({ groupId: row!.id, locationId: l.id })));
  return { profileId, groupId: row!.id };
}

async function generalZones(db: Executor, shopId: number): Promise<ZoneRow[]> {
  const { profileId, groupId } = await generalGroup(db, shopId);
  return (await getProfile(db, shopId, profileId))!.groups.find((g) => g.id === groupId)!.zones;
}

const toCountries = (cs: NonNullable<ShippingZoneInput['countries']>) => cs.map((c) => (c.countryCode === '*' ? { restOfWorld: true } : { code: c.countryCode.toUpperCase(), provinces: c.provinceCodes ?? [] }));

export async function listShippingZones(db: Executor, shopId: number): Promise<ShippingZone[]> {
  return (await generalZones(db, shopId)).map((z) => zoneOf(shopId, z));
}
export async function getShippingZone(db: Executor, shopId: number, id: number): Promise<ShippingZone | null> {
  const z = (await generalZones(db, shopId)).find((x) => x.id === id);
  return z ? zoneOf(shopId, z) : null;
}
export async function getShippingRate(db: Executor, shopId: number, id: number): Promise<ShippingRate | null> {
  for (const z of await generalZones(db, shopId)) { const m = z.methods.find((x) => x.id === id); if (m) return rateOf(shopId, m); }
  return null;
}

export async function createShippingZone(db: Db, shopId: number, i: ShippingZoneInput): Promise<Result<ShippingZone>> {
  const v = checkZone(i, true);
  if (!v.ok) return v;
  const { profileId, groupId } = await generalGroup(db, shopId);
  const before = new Set((await generalZones(db, shopId)).map((z) => z.id));
  const r = await updateProfile(db, shopId, profileId, { locationGroupsToUpdate: [{ id: groupId, zonesToCreate: [{ name: i.name, countries: toCountries(i.countries ?? []), methodDefinitionsToCreate: (i.rates ?? []).map(methodOf) }] }] });
  if (!r.ok) return r;
  const z = r.value.groups.find((g) => g.id === groupId)!.zones.find((x) => !before.has(x.id))!;
  return okR(zoneOf(shopId, z));
}

/** `rates`, when given, replaces the zone's rates. */
export async function updateShippingZone(db: Db, shopId: number, id: number, i: ShippingZoneInput): Promise<Result<ShippingZone>> {
  const cur = (await generalZones(db, shopId)).find((z) => z.id === id);
  if (!cur) return errR(['id'], 'Shipping zone does not exist');
  const v = checkZone(i, false);
  if (!v.ok) return v;
  const { profileId, groupId } = await generalGroup(db, shopId);
  const replace = !!i.rates;
  const r = await updateProfile(db, shopId, profileId, {
    ...(replace && { methodDefinitionsToDelete: cur.methods.map((m) => m.id) }),
    locationGroupsToUpdate: [{ id: groupId, zonesToUpdate: [{ id, name: i.name, countries: i.countries ? toCountries(i.countries) : undefined, ...(replace && { methodDefinitionsToCreate: i.rates!.map(methodOf) }) }] }],
  });
  if (!r.ok) return r;
  return okR(zoneOf(shopId, r.value.groups.find((g) => g.id === groupId)!.zones.find((z) => z.id === id)!));
}

export async function deleteShippingZone(db: Db, shopId: number, id: number): Promise<Result<number>> {
  if (!(await getShippingZone(db, shopId, id))) return errR(['id'], 'Shipping zone does not exist');
  const { profileId } = await generalGroup(db, shopId);
  const r = await updateProfile(db, shopId, profileId, { zonesToDelete: [id] });
  return r.ok ? okR(id) : r;
}

export async function createShippingRate(db: Db, shopId: number, zoneId: number, i: ShippingRateInput): Promise<Result<ShippingRate>> {
  if (!(await getShippingZone(db, shopId, zoneId))) return errR(['zoneId'], 'Shipping zone does not exist');
  const v = checkRate(i, true, []);
  if (!v.ok) return v;
  const { profileId, groupId } = await generalGroup(db, shopId);
  const before = new Set((await generalZones(db, shopId)).find((z) => z.id === zoneId)!.methods.map((m) => m.id));
  const r = await updateProfile(db, shopId, profileId, { locationGroupsToUpdate: [{ id: groupId, zonesToUpdate: [{ id: zoneId, methodDefinitionsToCreate: [methodOf({ type: 'FLAT', ...i })] }] }] });
  if (!r.ok) return r;
  const m = r.value.groups.find((g) => g.id === groupId)!.zones.find((z) => z.id === zoneId)!.methods.find((x) => !before.has(x.id))!;
  return okR(rateOf(shopId, m));
}

export async function updateShippingRate(db: Db, shopId: number, id: number, i: ShippingRateInput): Promise<Result<ShippingRate>> {
  const cur = await getShippingRate(db, shopId, id);
  if (!cur) return errR(['id'], 'Shipping rate does not exist');
  const v = checkRate(i, false, []);
  if (!v.ok) return v;
  const merged: ShippingRateInput = {
    name: i.name ?? cur.name, type: (i.type ?? cur.type) as ShippingRateInput['type'], price: i.price ?? cur.price,
    minValue: i.minValue !== undefined ? i.minValue : cur.minValue, maxValue: i.maxValue !== undefined ? i.maxValue : cur.maxValue, active: i.active ?? cur.active,
  };
  const touchesConditions = i.type != null || i.minValue !== undefined || i.maxValue !== undefined;
  const { profileId, groupId } = await generalGroup(db, shopId);
  const zone = (await generalZones(db, shopId)).find((z) => z.id === cur.zoneId)!;
  const conds = zone.methods.find((m) => m.id === id)!.conditions;
  const r = await updateProfile(db, shopId, profileId, {
    ...(touchesConditions && { conditionsToDelete: conds.map((c) => c.id) }),
    locationGroupsToUpdate: [{ id: groupId, zonesToUpdate: [{ id: cur.zoneId, methodDefinitionsToUpdate: [{ id, name: merged.name, active: merged.active, price: i.type === 'FREE' ? 0 : merged.price, ...(touchesConditions && { conditionsToCreate: conditionsFor(merged) }) }] }] }],
  });
  if (!r.ok) return r;
  return okR(rateOf(shopId, r.value.groups.find((g) => g.id === groupId)!.zones.find((z) => z.id === cur.zoneId)!.methods.find((m) => m.id === id)!));
}

export async function deleteShippingRate(db: Db, shopId: number, id: number): Promise<Result<number>> {
  if (!(await getShippingRate(db, shopId, id))) return errR(['id'], 'Shipping rate does not exist');
  const { profileId } = await generalGroup(db, shopId);
  const r = await updateProfile(db, shopId, profileId, { methodDefinitionsToDelete: [id] });
  return r.ok ? okR(id) : r;
}
