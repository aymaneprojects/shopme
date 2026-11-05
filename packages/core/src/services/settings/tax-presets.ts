import { and, asc, eq, sql } from 'drizzle-orm';
import { inventoryItems, taxRates } from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { errR, okR, type Result } from '../catalog/common';
import type { PricingTaxRate } from '../pricing';
import { configOf, type TaxesConfig } from './config';
import type { Shop } from '../shops';

/** Built-in tax tables. Standard rates only: reduced rates, local taxes and thresholds stay the merchant's call. */
export interface TaxPresetRow { countryCode: string; provinceCode: string | null; name: string; rate: number; appliesToShipping: boolean }
export interface TaxPreset { id: string; countries: string[]; rows: TaxPresetRow[] }

export const EU_VAT: Record<string, number> = {
  AT: 20, BE: 21, BG: 20, HR: 25, CY: 19, CZ: 21, DK: 25, EE: 24, FI: 25.5, FR: 20, DE: 19, GR: 24, HU: 27, IE: 23, IT: 22, LV: 21, LT: 21, LU: 17, MT: 18, NL: 21, PL: 23, PT: 23, RO: 21, SK: 23, SI: 22, ES: 21, SE: 25,
};
const US_STATES: Record<string, number> = {
  AL: 4, AK: 0, AZ: 5.6, AR: 6.5, CA: 7.25, CO: 2.9, CT: 6.35, DE: 0, DC: 6, FL: 6, GA: 4, HI: 4, ID: 6, IL: 6.25, IN: 7, IA: 6, KS: 6.5, KY: 6, LA: 4.45, ME: 5.5, MD: 6, MA: 6.25, MI: 6, MN: 6.875, MS: 7,
  MO: 4.225, MT: 0, NE: 5.5, NV: 6.85, NH: 0, NJ: 6.625, NM: 4.875, NY: 4, NC: 4.75, ND: 5, OH: 5.75, OK: 4.5, OR: 0, PA: 6, RI: 7, SC: 6, SD: 4.2, TN: 7, TX: 6.25, UT: 6.1, VT: 6, VA: 5.3, WA: 6.5, WV: 6, WI: 5, WY: 4,
};
/** Provincial part on top of the federal GST (5 %), per province; the HST provinces fold the provincial part into one rate. */
const CA_PROVINCIAL: Record<string, [string, number]> = {
  BC: ['PST', 7], SK: ['PST', 6], MB: ['RST', 7], QC: ['QST', 9.975], ON: ['HST (provincial part)', 8], NB: ['HST (provincial part)', 10], NL: ['HST (provincial part)', 10], NS: ['HST (provincial part)', 9], PE: ['HST (provincial part)', 10],
};
const OTHER_VAT: Record<string, [string, number]> = { GB: ['VAT', 20], CH: ['VAT', 8.1], NO: ['VAT', 25], AU: ['GST', 10], NZ: ['GST', 15], JP: ['Consumption tax', 10], IS: ['VAT', 24], SG: ['GST', 9] };

const row = (countryCode: string, name: string, rate: number, provinceCode: string | null = null, appliesToShipping = true): TaxPresetRow => ({ countryCode, provinceCode, name, rate, appliesToShipping });

export const TAX_PRESETS: TaxPreset[] = [
  { id: 'EU_VAT', countries: Object.keys(EU_VAT), rows: Object.entries(EU_VAT).map(([c, r]) => row(c, 'VAT', r)) },
  { id: 'US_STATES', countries: ['US'], rows: Object.entries(US_STATES).filter(([, r]) => r > 0).map(([p, r]) => row('US', 'State sales tax', r, p, false)) },
  { id: 'CA_PROVINCES', countries: ['CA'], rows: [row('CA', 'GST', 5), ...Object.entries(CA_PROVINCIAL).map(([p, [n, r]]) => row('CA', n, r, p))] },
  { id: 'OTHER_VAT', countries: Object.keys(OTHER_VAT), rows: Object.entries(OTHER_VAT).map(([c, [n, r]]) => row(c, n, r)) },
];
export const presetOf = (id: string) => TAX_PRESETS.find((p) => p.id === id) ?? null;

/** Add the rows of a preset. Rows that already exist are skipped; `replace` first removes every rate of the preset's countries. */
export async function applyTaxPreset(db: Db, shopId: number, id: string, opts: { replace?: boolean } = {}): Promise<Result<{ added: number; skipped: number }>> {
  const preset = presetOf(id);
  if (!preset) return errR(['preset'], 'Unknown tax preset', 'INVALID');
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(taxRates).where(eq(taxRates.shopId, shopId));
    let added = 0; let skipped = 0;
    if (opts.replace) {
      for (const r of existing.filter((e) => preset.countries.includes(e.countryCode))) await tx.delete(taxRates).where(eq(taxRates.id, r.id));
    }
    const left = opts.replace ? existing.filter((r) => !preset.countries.includes(r.countryCode)) : existing;
    for (const r of preset.rows) {
      if (left.some((e) => e.countryCode === r.countryCode && (e.provinceCode ?? null) === r.provinceCode && e.name === r.name)) { skipped++; continue; }
      await tx.insert(taxRates).values({ shopId, name: r.name, countryCode: r.countryCode, provinceCode: r.provinceCode, rate: r.rate, appliesToShipping: r.appliesToShipping });
      added++;
    }
    return okR({ added, skipped });
  });
}

/** Rates of the built-in EU table, used for digital goods when the store has no rate of its own for the buyer's country. */
export const euVatRates = (): PricingTaxRate[] => Object.entries(EU_VAT).map(([countryCode, rate]) => ({ name: 'VAT', countryCode, provinceCode: null, rate, appliesToShipping: false, priority: 0 }));

/** Extra tax inputs of the store config for a destination: digital goods VAT and the duty rates collected at checkout. */
export function taxExtrasFor(shop: Pick<Shop, 'settings'>, country: string | null): { digitalVatRates?: PricingTaxRate[]; dutyRates?: PricingTaxRate[] } {
  const c = configOf(shop, 'TAXES');
  const cc = country?.toUpperCase() ?? '';
  const out: { digitalVatRates?: PricingTaxRate[]; dutyRates?: PricingTaxRate[] } = {};
  if (c.digitalVat) out.digitalVatRates = euVatRates();
  if (c.duties.enabled && cc) {
    const rules = c.duties.rules.filter((r) => r.countryCode === cc && r.rate > 0);
    if (rules.length) out.dutyRates = rules.map((r) => ({ name: r.label || 'Import duties', countryCode: r.countryCode, provinceCode: null, rate: r.rate, appliesToShipping: false, priority: 100, duty: true }));
  }
  return out;
}

export interface TaxRegionSummary { countryCode: string; rates: number; provinces: number; combinedRate: number }

/** One row per country with at least one rate (for the regions table of Settings > Taxes). `combinedRate` is the country-wide total. */
export async function taxRegions(db: Executor, shopId: number): Promise<TaxRegionSummary[]> {
  const rows = await db.select().from(taxRates).where(eq(taxRates.shopId, shopId)).orderBy(asc(taxRates.countryCode));
  const by = new Map<string, typeof rows>();
  for (const r of rows) by.set(r.countryCode, [...(by.get(r.countryCode) ?? []), r]);
  return [...by].map(([countryCode, rs]) => ({
    countryCode, rates: rs.length, provinces: new Set(rs.filter((r) => r.provinceCode).map((r) => r.provinceCode)).size,
    combinedRate: rs.filter((r) => !r.provinceCode && r.active).reduce((a, r) => a + r.rate, 0),
  }));
}

// ---- customs defaults ---------------------------------------------------------------------------------------------------------

export type CustomsDefaults = TaxesConfig['customs'];

/** Fill the origin country and HS code of every inventory item that has none, from the store's customs defaults. */
export async function applyCustomsDefaults(db: Executor, shop: Shop): Promise<{ updated: number }> {
  const { originCountry, hsCode } = configOf(shop, 'TAXES').customs;
  if (!originCountry && !hsCode) return { updated: 0 };
  const set: Record<string, unknown> = {};
  const missing = [
    ...(originCountry ? [sql`${inventoryItems.countryCodeOfOrigin} is null`] : []),
    ...(hsCode ? [sql`${inventoryItems.harmonizedSystemCode} is null`] : []),
  ];
  if (originCountry) set.countryCodeOfOrigin = sql`coalesce(${inventoryItems.countryCodeOfOrigin}, ${originCountry})`;
  if (hsCode) set.harmonizedSystemCode = sql`coalesce(${inventoryItems.harmonizedSystemCode}, ${hsCode})`;
  const res = await db.update(inventoryItems).set(set).where(and(eq(inventoryItems.shopId, shop.id), sql`(${sql.join(missing, sql` or `)})`)).returning({ id: inventoryItems.id });
  return { updated: res.length };
}
