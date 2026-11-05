import { parseDecimal } from '../format';

/** Shape of what the delivery profile queries return (only the fields the screens use). */
export interface ApiCondition { id: string; field: 'TOTAL_WEIGHT' | 'TOTAL_PRICE'; operator: 'GREATER_THAN_OR_EQUAL_TO' | 'LESS_THAN_OR_EQUAL_TO'; conditionCriteria: { __typename: 'MoneyV2'; amount: string } | { __typename: 'Weight'; unit: string; value: number } }
export interface ApiMethod {
  id: string; name: string; description: string | null; active: boolean; shopmeFreeOverAmount: { amount: string } | null;
  rateProvider: { __typename: string; price?: { amount: string } }; methodConditions: ApiCondition[];
  shopmeTransitMinDays: number | null; shopmeTransitMaxDays: number | null; shopmeCollectionIds: string[]; shopmeOriginLocationIds: string[];
  shopmeRateType: 'FIXED' | 'CARRIER'; shopmeCarrierProvider: string | null; shopmeCarrierParams: Record<string, unknown>;
}
export interface ApiCountry { id: string; code: { countryCode: string | null; restOfWorld: boolean }; name: string; provinces: { code: string }[] }
export interface ApiZone { zone: { id: string; name: string; countries: ApiCountry[] }; methodDefinitions: { nodes: ApiMethod[] } }
export interface ApiGroup { locationGroup: { id: string; locations: { nodes: { id: string; name: string }[] } }; locationGroupZones: { nodes: ApiZone[] } }

export const GRAMS_PER: Record<string, number> = { GRAMS: 1, KILOGRAMS: 1000, POUNDS: 453.59237, OUNCES: 28.349523125 };
export const WEIGHT_ABBR: Record<string, string> = { GRAMS: 'g', KILOGRAMS: 'kg', POUNDS: 'lb', OUNCES: 'oz' };
export const LENGTH_ABBR: Record<string, string> = { MILLIMETERS: 'mm', CENTIMETERS: 'cm', METERS: 'm', INCHES: 'in', FEET: 'ft', YARDS: 'yd' };

/** Grams -> the shop weight unit, trimmed to at most 3 decimals. */
export const fromGrams = (g: number, unit: string) => Math.round((g / (GRAMS_PER[unit] ?? 1)) * 1000) / 1000;

export const PICKUP_TIMES = ['ONE_HOUR', 'TWO_HOURS', 'FOUR_HOURS', 'TWENTY_FOUR_HOURS', 'TWO_TO_FOUR_DAYS', 'FIVE_OR_MORE_DAYS'] as const;

/** One rate of an option as the dialog edits it. Numbers stay strings until saved. */
export interface RateCard {
  id: string | null; price: string; cond: 'none' | 'weight' | 'price'; min: string; max: string; freeOn: boolean; freeOver: string; conditionIds: string[];
  /** Transit time in days as `min-max` (empty: not shown to the buyer). */
  transit: string;
  /** Collection ids the rate is limited to, and the locations it ships from (empty: no limit). */
  collections: string[]; origins: string[];
  rateType: 'FIXED' | 'CARRIER'; provider: string; params: Record<string, string>;
}
export const blankCard = (): RateCard => ({ id: null, price: '', cond: 'none', min: '', max: '', freeOn: false, freeOver: '', conditionIds: [], transit: '', collections: [], origins: [], rateType: 'FIXED', provider: '', params: {} });

/** Transit presets of the rate editor (`min-max` days). */
export const TRANSIT_PRESETS = ['0-1', '1-2', '2-3', '3-5', '5-7', '7-14', '14-21', '21-30'];

export function cardOf(m: ApiMethod, weightUnit: string): RateCard {
  const w = m.methodConditions.filter((c) => c.field === 'TOTAL_WEIGHT');
  const p = m.methodConditions.filter((c) => c.field === 'TOTAL_PRICE');
  const conds = w.length ? w : p;
  const val = (c?: ApiCondition) => (!c ? '' : c.conditionCriteria.__typename === 'Weight' ? String(fromGrams(c.conditionCriteria.value, weightUnit)) : c.conditionCriteria.amount);
  return {
    id: m.id, price: m.rateProvider.price?.amount ?? '0', cond: w.length ? 'weight' : p.length ? 'price' : 'none',
    min: val(conds.find((c) => c.operator === 'GREATER_THAN_OR_EQUAL_TO')), max: val(conds.find((c) => c.operator === 'LESS_THAN_OR_EQUAL_TO')),
    freeOn: !!m.shopmeFreeOverAmount, freeOver: m.shopmeFreeOverAmount?.amount ?? '', conditionIds: m.methodConditions.map((c) => c.id),
    transit: m.shopmeTransitMinDays != null || m.shopmeTransitMaxDays != null ? `${m.shopmeTransitMinDays ?? m.shopmeTransitMaxDays}-${m.shopmeTransitMaxDays ?? m.shopmeTransitMinDays}` : '',
    collections: m.shopmeCollectionIds, origins: m.shopmeOriginLocationIds, rateType: m.shopmeRateType, provider: m.shopmeCarrierProvider ?? '',
    params: Object.fromEntries(Object.entries(m.shopmeCarrierParams ?? {}).map(([k, v]) => [k, String(v ?? '')])),
  };
}

/** Validation message key for a card, or null when it can be saved. */
export function cardProblem(c: RateCard): 'price' | 'range' | 'free' | 'carrier' | null {
  if (c.rateType === 'CARRIER' && !c.provider) return 'carrier';
  const price = parseDecimal(c.price);
  if (price === null || price < 0) return 'price';
  if (c.cond !== 'none') {
    const min = parseDecimal(c.min), max = parseDecimal(c.max);
    if ((c.min.trim() && (min === null || min < 0)) || (c.max.trim() && (max === null || max < 0)) || (min !== null && max !== null && max < min) || (min === null && max === null)) return 'range';
  }
  if (c.freeOn) { const f = parseDecimal(c.freeOver); if (f === null || f < 0) return 'free'; }
  return null;
}

/** GraphQL method input for a card (conditions are recreated on every save). */
export function methodInput(o: { name: string; description: string; active: boolean }, c: RateCard, currency: string, weightUnit: string) {
  const amount = (n: number) => ({ amount: n.toFixed(2), currencyCode: currency });
  const min = parseDecimal(c.min), max = parseDecimal(c.max);
  const ops = [
    ...(min !== null ? [{ operator: 'GREATER_THAN_OR_EQUAL_TO', v: min }] : []),
    ...(max !== null ? [{ operator: 'LESS_THAN_OR_EQUAL_TO', v: max }] : []),
  ];
  return {
    ...(c.id ? { id: c.id } : {}),
    name: o.name.trim(), description: o.description.trim() || null, active: o.active,
    rateDefinition: { price: amount(parseDecimal(c.price) ?? 0) },
    ...(c.cond === 'weight' && { weightConditionsToCreate: ops.map((x) => ({ operator: x.operator, criteria: { value: x.v, unit: weightUnit } })) }),
    ...(c.cond === 'price' && { priceConditionsToCreate: ops.map((x) => ({ operator: x.operator, criteria: amount(x.v) })) }),
    ...(c.freeOn ? { shopmeFreeOverAmount: amount(parseDecimal(c.freeOver) ?? 0) } : { shopmeClearFreeOver: true }),
    ...(c.transit ? { shopmeTransitMinDays: Number(c.transit.split('-')[0]), shopmeTransitMaxDays: Number(c.transit.split('-')[1]) } : { shopmeClearTransit: true }),
    shopmeCollectionIds: c.collections, shopmeOriginLocationIds: c.origins, shopmeRateType: c.rateType,
    ...(c.rateType === 'CARRIER' ? { shopmeCarrierProvider: c.provider, shopmeCarrierParams: c.params } : { shopmeCarrierProvider: null, shopmeCarrierParams: {} }),
  };
}

/** Group a zone's rates into options (same name = one option, as the buyer sees it). */
export function optionsOf(methods: ApiMethod[]): { name: string; methods: ApiMethod[] }[] {
  const out: { name: string; methods: ApiMethod[] }[] = [];
  for (const m of methods) {
    const o = out.find((x) => x.name.trim().toLowerCase() === m.name.trim().toLowerCase());
    if (o) o.methods.push(m); else out.push({ name: m.name, methods: [m] });
  }
  return out;
}
