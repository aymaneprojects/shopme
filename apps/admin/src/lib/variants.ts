export type WeightUnit = 'KILOGRAMS' | 'GRAMS' | 'POUNDS' | 'OUNCES';
export const WEIGHT_UNITS: WeightUnit[] = ['KILOGRAMS', 'GRAMS', 'POUNDS', 'OUNCES'];
export type LengthUnit = 'MILLIMETERS' | 'CENTIMETERS' | 'METERS' | 'INCHES' | 'FEET' | 'YARDS';
export const LENGTH_UNITS: LengthUnit[] = ['MILLIMETERS', 'CENTIMETERS', 'METERS', 'INCHES', 'FEET', 'YARDS'];
export const MAX_OPTIONS = 3;
export const MAX_VARIANTS = 2048;

export interface OptionDef { id?: string; name: string; values: string[] }

/** Editable state of one variant. Money and numbers are kept as strings while typing. */
export interface VariantDraft {
  key: string;
  id?: string;
  inventoryItemId?: string;
  /** Aligned with the product options. Empty for the implicit default variant. */
  optionValues: string[];
  price: string;
  compareAtPrice: string;
  cost: string;
  sku: string;
  barcode: string;
  taxable: boolean;
  tracked: boolean;
  continueSelling: boolean;
  /** Hidden from the Online Store: not offered on the product page and refused by the cart, while the product stays published. */
  onlineStoreHidden: boolean;
  requiresShipping: boolean;
  weight: string;
  weightUnit: WeightUnit;
  /** Package size, as typed. */
  length: string; width: string; height: string;
  dimensionUnit: LengthUnit;
  /** ISO country code of origin and harmonized system (customs) code, or empty. */
  countryOfOrigin: string; hsCode: string;
  /** Media (image) of the variant: a `MediaImage` GID of the product, or empty. */
  mediaId: string;
  /** Unit price measurement: `unitQuantity` `unitQuantityUnit` priced per `unitReference` `unitReferenceUnit`. */
  unitQuantity: string; unitQuantityUnit: string; unitReference: string; unitReferenceUnit: string;
  /** Available quantity per location id, as typed. The keys are the locations the variant is stocked at. */
  quantities: Record<string, string>;
  /** On hand quantity per location id, as typed (edited when the quantity state is "On hand"). */
  onHand: Record<string, string>;
  /** Read-outs per location id from the server: committed to orders, unavailable (reserved) and incoming. */
  committed: Record<string, number>; unavailable: Record<string, number>; incoming: Record<string, number>;
  /** Inventory level GID per location id (needed to stop stocking a location). */
  levelIds: Record<string, string>;
  /** Harmonized System code per destination country (customs ship-to). */
  countryHs: Array<{ countryCode: string; code: string }>;
  /** Shipping package GID from Settings > Shipping > Packaging, or empty. */
  packageId: string;
}

let seq = 0;
export const newKey = () => `v${Date.now().toString(36)}${(seq++).toString(36)}`;

export const blankVariant = (over: Partial<VariantDraft> = {}): VariantDraft => ({
  key: newKey(), optionValues: [], price: '0.00', compareAtPrice: '', cost: '', sku: '', barcode: '',
  taxable: true, tracked: true, continueSelling: false, onlineStoreHidden: false, requiresShipping: true, weight: '', weightUnit: 'KILOGRAMS', length: '', width: '', height: '', dimensionUnit: 'CENTIMETERS', countryOfOrigin: '', hsCode: '', mediaId: '', unitQuantity: '', unitQuantityUnit: 'L', unitReference: '1', unitReferenceUnit: 'L', quantities: {}, onHand: {}, committed: {}, unavailable: {}, incoming: {}, levelIds: {}, countryHs: [], packageId: '', ...over,
});

/** Options that count: named and with at least one distinct non-empty value. */
export function cleanOptions(options: OptionDef[]): OptionDef[] {
  return options
    .map((o) => ({ ...o, name: o.name.trim(), values: [...new Set(o.values.map((v) => v.trim()).filter(Boolean))] }))
    .filter((o) => o.name && o.values.length);
}

/** Cartesian product of option values, in option order. */
export function combinations(options: OptionDef[]): string[][] {
  return cleanOptions(options).reduce<string[][]>((acc, o) => acc.flatMap((c) => o.values.map((v) => [...c, v])), [[]]);
}

const joinKey = (v: string[]) => v.join('\u0001');

/** A new variant (no id, SKU, barcode or stock) with the price, cost, tracking and shipping settings of `template`. */
export function newVariantLike(template: VariantDraft | undefined, optionValues: string[]): VariantDraft {
  return blankVariant({
    optionValues,
    ...(template && {
      price: template.price, compareAtPrice: template.compareAtPrice, cost: template.cost, taxable: template.taxable, tracked: template.tracked, continueSelling: template.continueSelling,
      requiresShipping: template.requiresShipping, weight: template.weight, weightUnit: template.weightUnit, length: template.length, width: template.width, height: template.height,
      dimensionUnit: template.dimensionUnit, countryOfOrigin: template.countryOfOrigin, hsCode: template.hsCode, quantities: Object.fromEntries(Object.keys(template.quantities).map((k) => [k, '0'])),
      onHand: Object.fromEntries(Object.keys(template.quantities).map((k) => [k, '0'])), packageId: template.packageId, countryHs: template.countryHs.map((c) => ({ ...c })),
    }),
  });
}

/**
 * Regenerate the variant list for `options`. Variants whose option values still exist are kept
 * (with their ids and data); new combinations copy price/cost/tracking from the first existing variant.
 * A variant created before an option was added (fewer values) is attached to the first combination sharing its prefix.
 */
export function generateVariants(options: OptionDef[], existing: VariantDraft[]): VariantDraft[] {
  const combos = combinations(options);
  if (combos[0]!.length === 0) return [existing[0] ? { ...existing[0], optionValues: [] } : blankVariant()];
  const used = new Set<string>();
  const byKey = new Map(existing.map((v) => [joinKey(v.optionValues), v]));
  const template = existing[0];
  const result: VariantDraft[] = [];
  // Values already in use at each option position: a combination made only of such values that has no variant was deleted on purpose.
  const inUse = options.length ? cleanOptions(options).map((_, i) => new Set(existing.filter((v) => v.optionValues.length > i).map((v) => v.optionValues[i]!))) : [];
  for (const combo of combos.slice(0, MAX_VARIANTS)) {
    let match = byKey.get(joinKey(combo));
    if (!match && existing.length > 0 && combo.every((x, i) => inUse[i]?.has(x)) && !existing.some((v) => v.optionValues.length < combo.length && v.optionValues.every((x, i) => x === combo[i]))) continue;
    if (!match) {
      match = existing.find((v) => v.optionValues.length < combo.length && !used.has(v.key) && v.optionValues.every((x, i) => x === combo[i]));
    }
    if (match && !used.has(match.key)) {
      used.add(match.key);
      result.push({ ...match, optionValues: combo });
    } else {
      result.push(newVariantLike(template, combo));
    }
  }
  return result.length ? result : [newVariantLike(template, combos[0]!)];
}

export const variantLabel = (v: VariantDraft, fallback: string) => (v.optionValues.length ? v.optionValues.join(' / ') : fallback);
