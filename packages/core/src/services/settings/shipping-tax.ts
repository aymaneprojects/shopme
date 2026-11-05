import { and, asc, eq } from 'drizzle-orm';
import { taxRates } from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { errR, okR, type Result } from '../catalog/common';

export * from '../shipping/legacy';
export type TaxRate = typeof taxRates.$inferSelect;

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
