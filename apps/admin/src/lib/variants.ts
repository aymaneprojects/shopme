export type WeightUnit = 'KILOGRAMS' | 'GRAMS' | 'POUNDS' | 'OUNCES';
export const WEIGHT_UNITS: WeightUnit[] = ['KILOGRAMS', 'GRAMS', 'POUNDS', 'OUNCES'];
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
  requiresShipping: boolean;
  weight: string;
  weightUnit: WeightUnit;
  /** Available quantity per location id, as typed. */
  quantities: Record<string, string>;
}

let seq = 0;
export const newKey = () => `v${Date.now().toString(36)}${(seq++).toString(36)}`;

export const blankVariant = (over: Partial<VariantDraft> = {}): VariantDraft => ({
  key: newKey(), optionValues: [], price: '0.00', compareAtPrice: '', cost: '', sku: '', barcode: '',
  taxable: true, tracked: true, continueSelling: false, requiresShipping: true, weight: '', weightUnit: 'KILOGRAMS', quantities: {}, ...over,
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
  for (const combo of combos.slice(0, MAX_VARIANTS)) {
    let match = byKey.get(joinKey(combo));
    if (!match) {
      match = existing.find((v) => v.optionValues.length < combo.length && !used.has(v.key) && v.optionValues.every((x, i) => x === combo[i]));
    }
    if (match && !used.has(match.key)) {
      used.add(match.key);
      result.push({ ...match, optionValues: combo });
    } else {
      result.push(blankVariant({
        optionValues: combo,
        ...(template && { price: template.price, compareAtPrice: template.compareAtPrice, cost: template.cost, taxable: template.taxable, tracked: template.tracked, continueSelling: template.continueSelling, requiresShipping: template.requiresShipping, weight: template.weight, weightUnit: template.weightUnit, quantities: Object.fromEntries(Object.keys(template.quantities).map((k) => [k, '0'])) }),
      }));
    }
  }
  return result;
}

export const variantLabel = (v: VariantDraft, fallback: string) => (v.optionValues.length ? v.optionValues.join(' / ') : fallback);
