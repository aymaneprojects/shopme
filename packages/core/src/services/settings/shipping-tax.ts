import { and, asc, eq, inArray } from 'drizzle-orm';
import { shippingRates, shippingZoneCountries, shippingZones, taxRates } from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { errR, okR, txResult, type Result } from '../catalog/common';

export type ShippingRate = typeof shippingRates.$inferSelect;
export type ShippingZone = typeof shippingZones.$inferSelect & { countries: (typeof shippingZoneCountries.$inferSelect)[]; rates: ShippingRate[] };
export type TaxRate = typeof taxRates.$inferSelect;

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

const rateValues = (r: ShippingRateInput) => ({
  ...(r.name != null && { name: r.name.trim() }), ...(r.type && { type: r.type }),
  ...(r.price != null && { price: r.type === 'FREE' ? 0 : r.price }), ...(r.type === 'FREE' && { price: 0 }),
  ...(r.minValue !== undefined && { minValue: r.minValue }), ...(r.maxValue !== undefined && { maxValue: r.maxValue }), ...(r.active != null && { active: r.active }),
});

async function load(db: Executor, shopId: number, zones: (typeof shippingZones.$inferSelect)[]): Promise<ShippingZone[]> {
  if (!zones.length) return [];
  const ids = zones.map((z) => z.id);
  const [countries, rates] = await Promise.all([
    db.select().from(shippingZoneCountries).where(inArray(shippingZoneCountries.zoneId, ids)).orderBy(asc(shippingZoneCountries.id)),
    db.select().from(shippingRates).where(and(eq(shippingRates.shopId, shopId), inArray(shippingRates.zoneId, ids))).orderBy(asc(shippingRates.position), asc(shippingRates.id)),
  ]);
  return zones.map((z) => ({ ...z, countries: countries.filter((c) => c.zoneId === z.id), rates: rates.filter((r) => r.zoneId === z.id) }));
}

export async function listShippingZones(db: Executor, shopId: number): Promise<ShippingZone[]> {
  return load(db, shopId, await db.select().from(shippingZones).where(eq(shippingZones.shopId, shopId)).orderBy(asc(shippingZones.id)));
}
export async function getShippingZone(db: Executor, shopId: number, id: number): Promise<ShippingZone | null> {
  return (await load(db, shopId, await db.select().from(shippingZones).where(and(eq(shippingZones.shopId, shopId), eq(shippingZones.id, id)))))[0] ?? null;
}
export async function getShippingRate(db: Executor, shopId: number, id: number): Promise<ShippingRate | null> {
  return (await db.select().from(shippingRates).where(and(eq(shippingRates.shopId, shopId), eq(shippingRates.id, id))))[0] ?? null;
}

async function setCountries(tx: Executor, shopId: number, zoneId: number, countries: NonNullable<ShippingZoneInput['countries']>) {
  await tx.delete(shippingZoneCountries).where(eq(shippingZoneCountries.zoneId, zoneId));
  const seen = new Set<string>();
  const rows = countries.map((c) => ({ shopId, zoneId, countryCode: c.countryCode.toUpperCase(), provinceCodes: c.provinceCodes ?? [] })).filter((c) => !seen.has(c.countryCode) && !!seen.add(c.countryCode));
  if (rows.length) await tx.insert(shippingZoneCountries).values(rows);
}

function checkZone(i: ShippingZoneInput, creating: boolean): Result<null> {
  if ((creating || i.name !== undefined) && !i.name?.trim()) return errR(['name'], "Name can't be blank");
  const bad = i.countries?.findIndex((c) => c.countryCode !== '*' && !/^[A-Za-z]{2}$/.test(c.countryCode)) ?? -1;
  if (bad >= 0) return errR(['countries', String(bad), 'countryCode'], 'Country code is invalid');
  for (const [n, r] of (i.rates ?? []).entries()) { const v = checkRate(r, true, ['rates', String(n)]); if (!v.ok) return v; }
  return okR(null);
}

export async function createShippingZone(db: Db, shopId: number, i: ShippingZoneInput): Promise<Result<ShippingZone>> {
  const v = checkZone(i, true);
  if (!v.ok) return v;
  return txResult(db, async (tx) => {
    const [z] = await tx.insert(shippingZones).values({ shopId, name: i.name!.trim() }).returning();
    await setCountries(tx, shopId, z!.id, i.countries ?? []);
    if (i.rates?.length) await tx.insert(shippingRates).values(i.rates.map((r, n) => ({ shopId, zoneId: z!.id, name: r.name!.trim(), position: n, ...rateValues({ type: 'FLAT', ...r }) })));
    return okR((await getShippingZone(tx, shopId, z!.id))!);
  });
}

/** `rates`, when given, replaces the zone's rates. */
export async function updateShippingZone(db: Db, shopId: number, id: number, i: ShippingZoneInput): Promise<Result<ShippingZone>> {
  if (!(await getShippingZone(db, shopId, id))) return errR(['id'], 'Shipping zone does not exist');
  const v = checkZone(i, false);
  if (!v.ok) return v;
  return txResult(db, async (tx) => {
    if (i.name) await tx.update(shippingZones).set({ name: i.name.trim(), updatedAt: new Date() }).where(eq(shippingZones.id, id));
    if (i.countries) await setCountries(tx, shopId, id, i.countries);
    if (i.rates) {
      await tx.delete(shippingRates).where(eq(shippingRates.zoneId, id));
      if (i.rates.length) await tx.insert(shippingRates).values(i.rates.map((r, n) => ({ shopId, zoneId: id, name: r.name!.trim(), position: n, ...rateValues({ type: 'FLAT', ...r }) })));
    }
    return okR((await getShippingZone(tx, shopId, id))!);
  });
}

export async function deleteShippingZone(db: Db, shopId: number, id: number): Promise<Result<number>> {
  if (!(await getShippingZone(db, shopId, id))) return errR(['id'], 'Shipping zone does not exist');
  await db.delete(shippingZones).where(eq(shippingZones.id, id));
  return okR(id);
}

export async function createShippingRate(db: Db, shopId: number, zoneId: number, i: ShippingRateInput): Promise<Result<ShippingRate>> {
  if (!(await getShippingZone(db, shopId, zoneId))) return errR(['zoneId'], 'Shipping zone does not exist');
  const v = checkRate(i, true, []);
  if (!v.ok) return v;
  const position = (await db.select({ id: shippingRates.id }).from(shippingRates).where(eq(shippingRates.zoneId, zoneId))).length;
  const [row] = await db.insert(shippingRates).values({ shopId, zoneId, name: i.name!.trim(), position, ...rateValues({ type: 'FLAT', ...i }) }).returning();
  return okR(row!);
}

export async function updateShippingRate(db: Db, shopId: number, id: number, i: ShippingRateInput): Promise<Result<ShippingRate>> {
  if (!(await getShippingRate(db, shopId, id))) return errR(['id'], 'Shipping rate does not exist');
  const v = checkRate(i, false, []);
  if (!v.ok) return v;
  const [row] = await db.update(shippingRates).set(rateValues(i)).where(eq(shippingRates.id, id)).returning();
  return okR(row!);
}

export async function deleteShippingRate(db: Db, shopId: number, id: number): Promise<Result<number>> {
  if (!(await getShippingRate(db, shopId, id))) return errR(['id'], 'Shipping rate does not exist');
  await db.delete(shippingRates).where(eq(shippingRates.id, id));
  return okR(id);
}

/* ------------------------------ tax rates ------------------------------ */

export interface TaxRateInput { name?: string | null; countryCode?: string | null; provinceCode?: string | null; rate?: number | null; appliesToShipping?: boolean | null; priority?: number | null; active?: boolean | null }

function checkTax(i: TaxRateInput, creating: boolean): Result<null> {
  if ((creating || i.name !== undefined) && !i.name?.trim()) return errR(['name'], "Name can't be blank");
  if ((creating || i.countryCode !== undefined) && !/^[A-Za-z]{2}$/.test(i.countryCode ?? '')) return errR(['countryCode'], 'Country code is invalid');
  if ((creating || i.rate !== undefined) && (i.rate == null || i.rate < 0 || i.rate > 100)) return errR(['rate'], 'Rate must be between 0 and 100');
  return okR(null);
}
const taxValues = (i: TaxRateInput) => ({
  ...(i.name != null && { name: i.name.trim() }), ...(i.countryCode && { countryCode: i.countryCode.toUpperCase() }), ...(i.provinceCode !== undefined && { provinceCode: i.provinceCode?.toUpperCase() || null }),
  ...(i.rate != null && { rate: i.rate }), ...(i.appliesToShipping != null && { appliesToShipping: i.appliesToShipping }), ...(i.priority != null && { priority: i.priority }), ...(i.active != null && { active: i.active }),
});

export const listTaxRates = (db: Executor, shopId: number) => db.select().from(taxRates).where(eq(taxRates.shopId, shopId)).orderBy(asc(taxRates.countryCode), asc(taxRates.provinceCode), asc(taxRates.priority), asc(taxRates.id));
export async function getTaxRate(db: Executor, shopId: number, id: number): Promise<TaxRate | null> {
  return (await db.select().from(taxRates).where(and(eq(taxRates.shopId, shopId), eq(taxRates.id, id))))[0] ?? null;
}
export async function createTaxRate(db: Db, shopId: number, i: TaxRateInput): Promise<Result<TaxRate>> {
  const v = checkTax(i, true);
  if (!v.ok) return v;
  const [row] = await db.insert(taxRates).values({ shopId, name: i.name!.trim(), countryCode: i.countryCode!.toUpperCase(), rate: i.rate!, ...taxValues(i) }).returning();
  return okR(row!);
}
export async function updateTaxRate(db: Db, shopId: number, id: number, i: TaxRateInput): Promise<Result<TaxRate>> {
  if (!(await getTaxRate(db, shopId, id))) return errR(['id'], 'Tax rate does not exist');
  const v = checkTax(i, false);
  if (!v.ok) return v;
  const values = taxValues(i);
  if (!Object.keys(values).length) return okR((await getTaxRate(db, shopId, id))!);
  const [row] = await db.update(taxRates).set(values).where(eq(taxRates.id, id)).returning();
  return okR(row!);
}
export async function deleteTaxRate(db: Db, shopId: number, id: number): Promise<Result<number>> {
  if (!(await getTaxRate(db, shopId, id))) return errR(['id'], 'Tax rate does not exist');
  await db.delete(taxRates).where(eq(taxRates.id, id));
  return okR(id);
}
