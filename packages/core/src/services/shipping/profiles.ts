import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  deliveryConditions, deliveryLocationGroupLocations, deliveryLocationGroups, deliveryMethodDefinitions, deliveryProfiles, deliveryProfileVariants, deliveryZoneCountries, deliveryZones, locations, productVariants,
} from '../../db/schema';
import type { Db, Executor, Tx } from '../../db/client';
import { errR, okR, txResult, type Result } from '../catalog/common';
import type { Condition, ConditionField, ConditionOperator } from './rates';
import { carrierProvider } from './carriers';

export type DeliveryProfile = typeof deliveryProfiles.$inferSelect;
export interface ConditionRow extends Condition { id: number }
export interface MethodExtras {
  transitMinDays: number | null; transitMaxDays: number | null; collectionIds: number[]; originLocationIds: number[];
  rateType: 'FIXED' | 'CARRIER'; carrierProvider: string | null; carrierParams: Record<string, unknown>;
}
export interface MethodRow extends MethodExtras { id: number; zoneId: number; name: string; description: string | null; active: boolean; position: number; price: number; freeOverAmount: number | null; conditions: ConditionRow[] }
export interface ZoneCountryRow { id: number; countryCode: string | null; restOfWorld: boolean; provinceCodes: string[] }
export interface ZoneRow { id: number; groupId: number; name: string; marketId: number | null; countries: ZoneCountryRow[]; methods: MethodRow[] }
export interface GroupRow { id: number; profileId: number; locationIds: number[]; zones: ZoneRow[] }
export interface ProfileTree extends DeliveryProfile { variantCount: number; groups: GroupRow[] }

const GENERAL_NAME = 'General profile';

// ---------------------------------------------------------------------------------------------------------------------
// General profile
// ---------------------------------------------------------------------------------------------------------------------

/** The shop's general profile; created with a location group holding the active locations that fulfill online orders when missing. */
export async function ensureGeneralProfile(db: Executor, shopId: number): Promise<number> {
  const find = async () => (await db.select({ id: deliveryProfiles.id }).from(deliveryProfiles).where(and(eq(deliveryProfiles.shopId, shopId), eq(deliveryProfiles.isDefault, true))).limit(1))[0]?.id;
  const existing = await find();
  if (existing) return existing;
  const [p] = await db.insert(deliveryProfiles).values({ shopId, name: GENERAL_NAME, isDefault: true }).onConflictDoNothing().returning({ id: deliveryProfiles.id });
  if (!p) return (await find())!;
  const [g] = await db.insert(deliveryLocationGroups).values({ shopId, profileId: p.id }).returning({ id: deliveryLocationGroups.id });
  const locs = await db.select({ id: locations.id }).from(locations).where(and(eq(locations.shopId, shopId), eq(locations.isActive, true), eq(locations.fulfillsOnlineOrders, true)));
  if (locs.length) await db.insert(deliveryLocationGroupLocations).values(locs.map((l) => ({ shopId, groupId: g!.id, locationId: l.id })));
  return p.id;
}

/** A new location ships the general profile's items too. */
export async function addLocationToGeneralProfile(db: Executor, shopId: number, locationId: number): Promise<void> {
  const profileId = await ensureGeneralProfile(db, shopId);
  const [g] = await db.select({ id: deliveryLocationGroups.id }).from(deliveryLocationGroups).where(eq(deliveryLocationGroups.profileId, profileId)).orderBy(asc(deliveryLocationGroups.id)).limit(1);
  if (g) await db.insert(deliveryLocationGroupLocations).values({ shopId, groupId: g.id, locationId }).onConflictDoNothing();
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------------------------------

/** Full tree of the shop's profiles (or of the given ones): groups, zones, rates, conditions. General profile first. */
export async function loadProfiles(db: Executor, shopId: number, ids?: number[]): Promise<ProfileTree[]> {
  await ensureGeneralProfile(db, shopId);
  const profiles = await db.select().from(deliveryProfiles).where(and(eq(deliveryProfiles.shopId, shopId), ids ? inArray(deliveryProfiles.id, ids) : undefined)).orderBy(sql`${deliveryProfiles.isDefault} desc`, asc(deliveryProfiles.id));
  if (!profiles.length) return [];
  const pids = profiles.map((p) => p.id);
  const [groups, varCounts] = await Promise.all([
    db.select().from(deliveryLocationGroups).where(inArray(deliveryLocationGroups.profileId, pids)).orderBy(asc(deliveryLocationGroups.id)),
    db.select({ profileId: deliveryProfileVariants.profileId, n: sql<number>`count(*)::int` }).from(deliveryProfileVariants).where(inArray(deliveryProfileVariants.profileId, pids)).groupBy(deliveryProfileVariants.profileId),
  ]);
  const gids = groups.map((g) => g.id);
  const [glocs, zones] = gids.length ? await Promise.all([
    db.select().from(deliveryLocationGroupLocations).where(inArray(deliveryLocationGroupLocations.groupId, gids)),
    db.select().from(deliveryZones).where(inArray(deliveryZones.groupId, gids)).orderBy(asc(deliveryZones.id)),
  ]) : [[], []];
  const zids = zones.map((z) => z.id);
  const [countries, methods] = zids.length ? await Promise.all([
    db.select().from(deliveryZoneCountries).where(inArray(deliveryZoneCountries.zoneId, zids)).orderBy(asc(deliveryZoneCountries.id)),
    db.select().from(deliveryMethodDefinitions).where(inArray(deliveryMethodDefinitions.zoneId, zids)).orderBy(asc(deliveryMethodDefinitions.position), asc(deliveryMethodDefinitions.id)),
  ]) : [[], []];
  const mids = methods.map((m) => m.id);
  const conds = mids.length ? await db.select().from(deliveryConditions).where(inArray(deliveryConditions.methodId, mids)).orderBy(asc(deliveryConditions.id)) : [];
  const counts = new Map(varCounts.map((c) => [c.profileId, c.n]));
  return profiles.map((p) => ({
    ...p, variantCount: counts.get(p.id) ?? 0,
    groups: groups.filter((g) => g.profileId === p.id).map((g) => ({
      id: g.id, profileId: p.id, locationIds: glocs.filter((l) => l.groupId === g.id).map((l) => l.locationId),
      zones: zones.filter((z) => z.groupId === g.id).map((z) => ({
        id: z.id, groupId: g.id, name: z.name, marketId: z.marketId,
        countries: countries.filter((c) => c.zoneId === z.id).map((c) => ({ id: c.id, countryCode: c.countryCode, restOfWorld: c.restOfWorld, provinceCodes: c.provinceCodes })),
        methods: methods.filter((m) => m.zoneId === z.id).map((m) => ({
          id: m.id, zoneId: z.id, name: m.name, description: m.description, active: m.active, position: m.position, price: m.price, freeOverAmount: m.freeOverAmount,
          transitMinDays: m.transitMinDays, transitMaxDays: m.transitMaxDays, collectionIds: m.collectionIds, originLocationIds: m.originLocationIds,
          rateType: m.rateType === 'CARRIER' ? 'CARRIER' : 'FIXED', carrierProvider: m.carrierProvider, carrierParams: m.carrierParams ?? {},
          conditions: conds.filter((c) => c.methodId === m.id).map((c) => ({ id: c.id, field: c.field as ConditionField, operator: c.operator as ConditionOperator, value: c.value })),
        })),
      })),
    })),
  }));
}

export async function getProfile(db: Executor, shopId: number, id: number): Promise<ProfileTree | null> {
  return (await loadProfiles(db, shopId, [id]))[0] ?? null;
}

/** Variant ids assigned to a custom profile (the general profile holds everything else). */
export async function profileVariantIds(db: Executor, shopId: number, profileId: number): Promise<number[]> {
  const rows = await db.select({ v: deliveryProfileVariants.variantId }).from(deliveryProfileVariants).where(and(eq(deliveryProfileVariants.shopId, shopId), eq(deliveryProfileVariants.profileId, profileId))).orderBy(asc(deliveryProfileVariants.variantId));
  return rows.map((r) => r.v);
}

/** Profile of each variant (`variantId -> profileId`), general profile for the unassigned ones. */
export async function profileOfVariants(db: Executor, shopId: number, variantIds: number[]): Promise<Map<number, number>> {
  const general = await ensureGeneralProfile(db, shopId);
  const out = new Map(variantIds.map((v) => [v, general]));
  if (!variantIds.length) return out;
  const rows = await db.select().from(deliveryProfileVariants).where(and(eq(deliveryProfileVariants.shopId, shopId), inArray(deliveryProfileVariants.variantId, variantIds)));
  for (const r of rows) out.set(r.variantId, r.profileId);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------------------------------

export interface ConditionInput { id?: number | null; field: ConditionField; operator: ConditionOperator; value: number }
export interface MethodInput {
  id?: number | null; name?: string | null; description?: string | null; active?: boolean | null;
  /** Minor units. */
  price?: number | null; freeOverAmount?: number | null; clearFreeOver?: boolean | null;
  /** Estimated transit time in days (both null clears it). */
  transitMinDays?: number | null; transitMaxDays?: number | null;
  /** Collections the rate is limited to / locations it ships from (empty array clears). */
  collectionIds?: number[] | null; originLocationIds?: number[] | null;
  rateType?: 'FIXED' | 'CARRIER' | null; carrierProvider?: string | null; carrierParams?: Record<string, unknown> | null;
  conditionsToCreate?: ConditionInput[] | null;
  conditionsToUpdate?: (ConditionInput & { id: number })[] | null;
}
export interface CountryInput { code?: string | null; restOfWorld?: boolean | null; provinces?: string[] | null }
export interface ZoneInput { id?: number | null; name?: string | null; countries?: CountryInput[] | null; methodDefinitionsToCreate?: MethodInput[] | null; methodDefinitionsToUpdate?: MethodInput[] | null }
export interface GroupInput {
  id?: number | null; locations?: number[] | null; locationsToAdd?: number[] | null; locationsToRemove?: number[] | null;
  zonesToCreate?: ZoneInput[] | null; zonesToUpdate?: ZoneInput[] | null;
}
export interface ProfileInput {
  name?: string | null;
  variantsToAssociate?: number[] | null; variantsToDissociate?: number[] | null;
  locationGroupsToCreate?: GroupInput[] | null; locationGroupsToUpdate?: GroupInput[] | null; locationGroupsToDelete?: number[] | null;
  zonesToDelete?: number[] | null; methodDefinitionsToDelete?: number[] | null; conditionsToDelete?: number[] | null;
}

const at = (...p: (string | number)[]) => p.map(String);

async function checkName(tx: Executor, shopId: number, name: string, selfId: number | null): Promise<Result<null>> {
  const n = name.trim();
  if (!n) return errR(['name'], "Name can't be blank");
  if (n.length > 255) return errR(['name'], 'Name is too long');
  const rows = await tx.select({ id: deliveryProfiles.id, name: deliveryProfiles.name }).from(deliveryProfiles).where(eq(deliveryProfiles.shopId, shopId));
  if (rows.some((r) => r.id !== selfId && r.name.trim().toLowerCase() === n.toLowerCase())) return errR(['name'], 'Profile name has already been taken');
  return okR(null);
}

async function activeLocationIds(tx: Executor, shopId: number, ids: number[], path: string[]): Promise<Result<number[]>> {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return okR([]);
  const rows = await tx.select({ id: locations.id, active: locations.isActive }).from(locations).where(and(eq(locations.shopId, shopId), inArray(locations.id, uniq)));
  for (const [i, id] of ids.entries()) {
    const r = rows.find((x) => x.id === id);
    if (!r) return errR([...path, String(i)], 'Location not found');
    if (!r.active) return errR([...path, String(i)], 'Location is not active');
  }
  return okR(uniq);
}

const COUNTRY_RE = /^[A-Z]{2}$/;

function checkMethodValues(m: MethodInput, creating: boolean, path: string[]): Result<null> {
  if ((creating || m.name !== undefined) && !m.name?.trim()) return errR([...path, 'name'], "Name can't be blank");
  if (m.price != null && m.price < 0) return errR([...path, 'rateDefinition', 'price'], 'Price must be greater than or equal to 0');
  if (creating && m.price == null) return errR([...path, 'rateDefinition'], 'A rate needs a price');
  if (m.freeOverAmount != null && m.freeOverAmount < 0) return errR([...path, 'freeOverAmount'], 'Free shipping threshold must be greater than or equal to 0');
  for (const [k, v] of [['transitMinDays', m.transitMinDays], ['transitMaxDays', m.transitMaxDays]] as const) {
    if (v != null && (!Number.isInteger(v) || v < 0 || v > 365)) return errR([...path, k], 'Transit time must be a whole number of days between 0 and 365');
  }
  if (m.transitMinDays != null && m.transitMaxDays != null && m.transitMinDays > m.transitMaxDays) return errR([...path, 'transitMaxDays'], 'The longest transit time must be at least the shortest');
  if (m.rateType === 'CARRIER') {
    if (!carrierProvider(m.carrierProvider)) return errR([...path, 'carrierProvider'], 'Choose a carrier provider');
  }
  for (const [i, c] of [...(m.conditionsToCreate ?? []), ...(m.conditionsToUpdate ?? [])].entries()) {
    if (!(c.value >= 0)) return errR([...path, 'conditions', String(i), 'criteria'], 'Condition value must be greater than or equal to 0');
  }
  return okR(null);
}

/** Column values of the rate options (transit time, collections, origins, carrier); only the fields given. */
function extraValues(m: MethodInput) {
  return {
    ...(m.transitMinDays !== undefined && { transitMinDays: m.transitMinDays }), ...(m.transitMaxDays !== undefined && { transitMaxDays: m.transitMaxDays }),
    ...(m.collectionIds != null && { collectionIds: [...new Set(m.collectionIds)] }), ...(m.originLocationIds != null && { originLocationIds: [...new Set(m.originLocationIds)] }),
    ...(m.rateType != null && { rateType: m.rateType }), ...(m.carrierProvider !== undefined && { carrierProvider: m.rateType === 'FIXED' ? null : m.carrierProvider }),
    ...(m.carrierParams != null && { carrierParams: m.carrierParams }),
  };
}

async function applyConditions(tx: Executor, shopId: number, methodId: number, m: MethodInput): Promise<void> {
  if (m.conditionsToCreate?.length) await tx.insert(deliveryConditions).values(m.conditionsToCreate.map((c) => ({ shopId, methodId, field: c.field, operator: c.operator, value: Math.round(c.value) })));
  for (const c of m.conditionsToUpdate ?? []) {
    await tx.update(deliveryConditions).set({ field: c.field, operator: c.operator, value: Math.round(c.value) }).where(and(eq(deliveryConditions.shopId, shopId), eq(deliveryConditions.id, c.id), eq(deliveryConditions.methodId, methodId)));
  }
}

function checkRanges(methods: MethodRow[], path: string[]): Result<null> {
  for (const m of methods) {
    for (const field of ['TOTAL_WEIGHT', 'TOTAL_PRICE'] as const) {
      const lo = Math.max(-Infinity, ...m.conditions.filter((c) => c.field === field && c.operator === 'GREATER_THAN_OR_EQUAL_TO').map((c) => c.value));
      const hi = Math.min(Infinity, ...m.conditions.filter((c) => c.field === field && c.operator === 'LESS_THAN_OR_EQUAL_TO').map((c) => c.value));
      if (lo > hi) return errR([...path, 'methodDefinitions', m.name, 'conditions'], 'The minimum must be less than or equal to the maximum');
    }
  }
  return okR(null);
}

async function setCountries(tx: Executor, shopId: number, zoneId: number, countries: CountryInput[], path: string[]): Promise<Result<null>> {
  const rows: { code: string | null; row: boolean; prov: string[] }[] = [];
  for (const [i, c] of countries.entries()) {
    if (c.restOfWorld) { rows.push({ code: null, row: true, prov: [] }); continue; }
    const code = (c.code ?? '').toUpperCase();
    if (!COUNTRY_RE.test(code)) return errR([...path, String(i), 'code'], 'Country code is invalid');
    const prov = [...new Set((c.provinces ?? []).map((p) => p.trim().toUpperCase()).filter(Boolean))];
    if (rows.some((r) => r.code === code && (!r.prov.length || !prov.length || r.prov.some((p) => prov.includes(p))))) return errR([...path, String(i), 'code'], 'Country is listed twice in the zone');
    rows.push({ code, row: false, prov });
  }
  await tx.delete(deliveryZoneCountries).where(eq(deliveryZoneCountries.zoneId, zoneId));
  if (rows.length) await tx.insert(deliveryZoneCountries).values(rows.map((r) => ({ shopId, zoneId, countryCode: r.code, restOfWorld: r.row, provinceCodes: r.prov })));
  return okR(null);
}

async function createMethod(tx: Executor, shopId: number, zoneId: number, m: MethodInput, path: string[]): Promise<Result<null>> {
  const v = checkMethodValues(m, true, path);
  if (!v.ok) return v;
  const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(deliveryMethodDefinitions).where(eq(deliveryMethodDefinitions.zoneId, zoneId));
  const [row] = await tx.insert(deliveryMethodDefinitions).values({
    shopId, zoneId, name: m.name!.trim(), description: m.description?.trim() || null, active: m.active ?? true, position: n, price: Math.round(m.price!), freeOverAmount: m.freeOverAmount != null ? Math.round(m.freeOverAmount) : null,
    ...extraValues(m),
  }).returning({ id: deliveryMethodDefinitions.id });
  await applyConditions(tx, shopId, row!.id, m);
  return okR(null);
}

async function updateMethod(tx: Executor, shopId: number, zoneId: number, m: MethodInput, path: string[]): Promise<Result<null>> {
  const [cur] = m.id ? await tx.select({ id: deliveryMethodDefinitions.id }).from(deliveryMethodDefinitions).where(and(eq(deliveryMethodDefinitions.shopId, shopId), eq(deliveryMethodDefinitions.id, m.id), eq(deliveryMethodDefinitions.zoneId, zoneId))) : [];
  if (!cur) return errR([...path, 'id'], 'Method definition not found');
  const v = checkMethodValues(m, false, path);
  if (!v.ok) return v;
  const set = {
    ...(m.name != null && { name: m.name.trim() }), ...(m.description !== undefined && { description: m.description?.trim() || null }), ...(m.active != null && { active: m.active }),
    ...(m.price != null && { price: Math.round(m.price) }),
    ...(m.clearFreeOver ? { freeOverAmount: null } : m.freeOverAmount !== undefined ? { freeOverAmount: m.freeOverAmount != null ? Math.round(m.freeOverAmount) : null } : {}),
    ...extraValues(m),
  };
  if (Object.keys(set).length) await tx.update(deliveryMethodDefinitions).set(set).where(eq(deliveryMethodDefinitions.id, cur.id));
  await applyConditions(tx, shopId, cur.id, m);
  return okR(null);
}

async function createZone(tx: Executor, shopId: number, groupId: number, z: ZoneInput, path: string[]): Promise<Result<null>> {
  if (!z.name?.trim()) return errR([...path, 'name'], "Name can't be blank");
  const [row] = await tx.insert(deliveryZones).values({ shopId, groupId, name: z.name.trim() }).returning({ id: deliveryZones.id });
  const c = await setCountries(tx, shopId, row!.id, z.countries ?? [], [...path, 'countries']);
  if (!c.ok) return c;
  for (const [i, m] of (z.methodDefinitionsToCreate ?? []).entries()) { const r = await createMethod(tx, shopId, row!.id, m, [...path, 'methodDefinitionsToCreate', String(i)]); if (!r.ok) return r; }
  return okR(null);
}

async function updateZone(tx: Executor, shopId: number, groupId: number, z: ZoneInput, path: string[]): Promise<Result<null>> {
  const [cur] = z.id ? await tx.select({ id: deliveryZones.id }).from(deliveryZones).where(and(eq(deliveryZones.shopId, shopId), eq(deliveryZones.id, z.id), eq(deliveryZones.groupId, groupId))) : [];
  if (!cur) return errR([...path, 'id'], 'Zone not found');
  if (z.name !== undefined && !z.name?.trim()) return errR([...path, 'name'], "Name can't be blank");
  if (z.name) await tx.update(deliveryZones).set({ name: z.name.trim() }).where(eq(deliveryZones.id, cur.id));
  if (z.countries) { const c = await setCountries(tx, shopId, cur.id, z.countries, [...path, 'countries']); if (!c.ok) return c; }
  for (const [i, m] of (z.methodDefinitionsToCreate ?? []).entries()) { const r = await createMethod(tx, shopId, cur.id, m, [...path, 'methodDefinitionsToCreate', String(i)]); if (!r.ok) return r; }
  for (const [i, m] of (z.methodDefinitionsToUpdate ?? []).entries()) { const r = await updateMethod(tx, shopId, cur.id, m, [...path, 'methodDefinitionsToUpdate', String(i)]); if (!r.ok) return r; }
  return okR(null);
}

/** Within one group, a country may not be in two zones with the same coverage (whole country, an overlapping province, rest of world). */
function checkZoneOverlap(g: GroupRow, path: string[]): Result<null> {
  const seen: { zone: ZoneRow; c: ZoneCountryRow }[] = [];
  for (const z of g.zones) {
    for (const c of z.countries) {
      const clash = seen.find((s) => s.zone.id !== z.id && (c.restOfWorld ? s.c.restOfWorld
        : s.c.countryCode === c.countryCode && (!s.c.provinceCodes.length || !c.provinceCodes.length ? s.c.provinceCodes.length === c.provinceCodes.length : s.c.provinceCodes.some((p) => c.provinceCodes.includes(p)))));
      if (clash) return errR([...path, 'zones', z.name, 'countries'], c.restOfWorld ? 'Rest of world is already in another zone' : `${c.countryCode} is already in another zone of this location group`);
      seen.push({ zone: z, c });
    }
  }
  return okR(null);
}

async function applyGroup(tx: Executor, shopId: number, groupId: number, g: GroupInput, path: string[], creating: boolean): Promise<Result<null>> {
  const setLocs = async (ids: number[], p: string[]): Promise<Result<number[]>> => activeLocationIds(tx, shopId, ids, p);
  if (g.locations) {
    const r = await setLocs(g.locations, [...path, 'locations']);
    if (!r.ok) return r;
    await tx.delete(deliveryLocationGroupLocations).where(eq(deliveryLocationGroupLocations.groupId, groupId));
    if (r.value.length) await tx.insert(deliveryLocationGroupLocations).values(r.value.map((locationId) => ({ shopId, groupId, locationId })));
  }
  if (g.locationsToAdd?.length) {
    const r = await setLocs(g.locationsToAdd, [...path, 'locationsToAdd']);
    if (!r.ok) return r;
    if (r.value.length) await tx.insert(deliveryLocationGroupLocations).values(r.value.map((locationId) => ({ shopId, groupId, locationId }))).onConflictDoNothing();
  }
  if (g.locationsToRemove?.length) await tx.delete(deliveryLocationGroupLocations).where(and(eq(deliveryLocationGroupLocations.groupId, groupId), inArray(deliveryLocationGroupLocations.locationId, g.locationsToRemove)));
  for (const [i, z] of (g.zonesToCreate ?? []).entries()) { const r = await createZone(tx, shopId, groupId, z, [...path, 'zonesToCreate', String(i)]); if (!r.ok) return r; }
  for (const [i, z] of (g.zonesToUpdate ?? []).entries()) { const r = await updateZone(tx, shopId, groupId, z, [...path, 'zonesToUpdate', String(i)]); if (!r.ok) return r; }
  void creating;
  return okR(null);
}

async function applyProfileInput(tx: Tx, shopId: number, profileId: number, isDefault: boolean, i: ProfileInput): Promise<Result<null>> {
  if (i.variantsToDissociate?.length) await tx.delete(deliveryProfileVariants).where(and(eq(deliveryProfileVariants.profileId, profileId), inArray(deliveryProfileVariants.variantId, i.variantsToDissociate)));
  if (i.variantsToAssociate?.length) {
    const ids = [...new Set(i.variantsToAssociate)];
    const found = await tx.select({ id: productVariants.id }).from(productVariants).where(and(eq(productVariants.shopId, shopId), inArray(productVariants.id, ids)));
    const bad = i.variantsToAssociate.findIndex((v) => !found.some((f) => f.id === v));
    if (bad >= 0) return errR(at('variantsToAssociate', bad), 'Variant not found');
    // A variant sits in one profile only: giving it to this one takes it from the others; the general profile simply holds the rest.
    await tx.delete(deliveryProfileVariants).where(and(eq(deliveryProfileVariants.shopId, shopId), inArray(deliveryProfileVariants.variantId, ids)));
    if (!isDefault) await tx.insert(deliveryProfileVariants).values(ids.map((variantId) => ({ profileId, variantId, shopId })));
  }
  const ownZones = (await tx.select({ id: deliveryZones.id }).from(deliveryZones).innerJoin(deliveryLocationGroups, eq(deliveryLocationGroups.id, deliveryZones.groupId)).where(and(eq(deliveryZones.shopId, shopId), eq(deliveryLocationGroups.profileId, profileId)))).map((z) => z.id);
  const ownGroups = (await tx.select({ id: deliveryLocationGroups.id }).from(deliveryLocationGroups).where(eq(deliveryLocationGroups.profileId, profileId))).map((g) => g.id);
  if (i.conditionsToDelete?.length) {
    await tx.delete(deliveryConditions).where(and(eq(deliveryConditions.shopId, shopId), inArray(deliveryConditions.id, i.conditionsToDelete)));
  }
  if (i.methodDefinitionsToDelete?.length && ownZones.length) await tx.delete(deliveryMethodDefinitions).where(and(eq(deliveryMethodDefinitions.shopId, shopId), inArray(deliveryMethodDefinitions.id, i.methodDefinitionsToDelete), inArray(deliveryMethodDefinitions.zoneId, ownZones)));
  if (i.zonesToDelete?.length && ownZones.length) await tx.delete(deliveryZones).where(and(eq(deliveryZones.shopId, shopId), inArray(deliveryZones.id, i.zonesToDelete), inArray(deliveryZones.id, ownZones)));
  if (i.locationGroupsToDelete?.length && ownGroups.length) await tx.delete(deliveryLocationGroups).where(and(eq(deliveryLocationGroups.shopId, shopId), inArray(deliveryLocationGroups.id, i.locationGroupsToDelete), inArray(deliveryLocationGroups.id, ownGroups)));
  for (const [n, g] of (i.locationGroupsToCreate ?? []).entries()) {
    const [row] = await tx.insert(deliveryLocationGroups).values({ shopId, profileId }).returning({ id: deliveryLocationGroups.id });
    const r = await applyGroup(tx, shopId, row!.id, g, at('locationGroupsToCreate', n), true);
    if (!r.ok) return r;
  }
  for (const [n, g] of (i.locationGroupsToUpdate ?? []).entries()) {
    if (!g.id || !ownGroups.includes(g.id)) return errR(at('locationGroupsToUpdate', n, 'id'), 'Location group not found');
    const r = await applyGroup(tx, shopId, g.id, g, at('locationGroupsToUpdate', n), false);
    if (!r.ok) return r;
  }
  // Rules over the final state of the profile.
  const [tree] = await loadProfiles(tx, shopId, [profileId]);
  for (const g of tree!.groups) {
    const o = checkZoneOverlap(g, at('locationGroups', g.id));
    if (!o.ok) return o;
    for (const z of g.zones) { const r = checkRanges(z.methods, at('locationGroups', g.id, 'zones', z.name)); if (!r.ok) return r; }
  }
  await tx.update(deliveryProfiles).set({ version: sql`${deliveryProfiles.version} + 1`, updatedAt: new Date() }).where(eq(deliveryProfiles.id, profileId));
  return okR(null);
}

export async function createProfile(db: Db, shopId: number, input: ProfileInput): Promise<Result<ProfileTree>> {
  return txResult(db, async (tx) => {
    await ensureGeneralProfile(tx, shopId);
    const nm = await checkName(tx, shopId, input.name ?? '', null);
    if (!nm.ok) return nm;
    const [p] = await tx.insert(deliveryProfiles).values({ shopId, name: input.name!.trim() }).returning({ id: deliveryProfiles.id });
    const r = await applyProfileInput(tx, shopId, p!.id, false, { ...input, conditionsToDelete: null, methodDefinitionsToDelete: null, zonesToDelete: null, locationGroupsToDelete: null, locationGroupsToUpdate: null });
    if (!r.ok) return r;
    return okR((await getProfile(tx, shopId, p!.id))!);
  });
}

export async function updateProfile(db: Db, shopId: number, id: number, input: ProfileInput): Promise<Result<ProfileTree>> {
  const cur = await getProfile(db, shopId, id);
  if (!cur) return errR(['id'], 'Profile not found');
  return txResult(db, async (tx) => {
    if (input.name !== undefined && input.name !== null && !(cur.isDefault && input.name.trim() === cur.name)) {
      if (cur.isDefault) return errR(['name'], 'The general profile cannot be renamed');
      const nm = await checkName(tx, shopId, input.name, id);
      if (!nm.ok) return nm;
      await tx.update(deliveryProfiles).set({ name: input.name.trim() }).where(eq(deliveryProfiles.id, id));
    }
    const r = await applyProfileInput(tx, shopId, id, cur.isDefault, input);
    if (!r.ok) return r;
    return okR((await getProfile(tx, shopId, id))!);
  });
}

/** Removes a custom profile; its variants fall back to the general profile. */
export async function removeProfile(db: Db, shopId: number, id: number): Promise<Result<number>> {
  const cur = await getProfile(db, shopId, id);
  if (!cur) return errR(['id'], 'Profile not found');
  if (cur.isDefault) return errR(['id'], 'The general profile cannot be removed');
  await db.delete(deliveryProfiles).where(and(eq(deliveryProfiles.shopId, shopId), eq(deliveryProfiles.id, id)));
  return okR(id);
}
