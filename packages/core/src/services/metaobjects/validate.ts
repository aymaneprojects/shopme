import { validateMetafieldValue } from '../catalog/metafields';
import { REFERENCE_GID_TYPES, baseType, isListType } from './refs';

export { REFERENCE_GID_TYPES, baseType, isListType, isReferenceType, itemsOf, pinnedDefinitionIds } from './refs';

/** Field types a metaobject definition accepts (every metafield type except customer references). */
export const FIELD_BASE_TYPES = [
  'single_line_text_field', 'multi_line_text_field', 'rich_text_field', 'number_integer', 'number_decimal', 'boolean', 'json', 'date', 'date_time', 'color', 'url',
  'weight', 'volume', 'dimension', 'money', 'rating', 'id', 'product_reference', 'variant_reference', 'collection_reference', 'file_reference', 'page_reference',
  'metaobject_reference', 'mixed_reference',
];

/** Validation names a field type understands (the editor offers these). */
export function supportedValidations(type: string): string[] {
  const b = baseType(type);
  const list = isListType(type) ? ['list.min', 'list.max'] : [];
  switch (b) {
    case 'single_line_text_field': return ['min', 'max', 'regex', 'choices', ...list];
    case 'multi_line_text_field': case 'rich_text_field': return ['min', 'max', ...list];
    case 'number_integer': case 'number_decimal': return ['min', 'max', ...(b === 'number_decimal' ? ['max_precision'] : []), ...list];
    case 'date': case 'date_time': return ['min', 'max', ...list];
    case 'url': return ['allowed_domains', ...list];
    case 'file_reference': return ['file_type_options', ...list];
    case 'metaobject_reference': return ['metaobject_definition_id', ...list];
    case 'mixed_reference': return ['metaobject_definition_ids', ...list];
    case 'rating': return ['scale_min', 'scale_max'];
    default: return list;
  }
}

type Validations = { name: string; value: string }[];
const vget = (v: Validations, name: string) => v.find((x) => x.name === name)?.value;
const vnum = (v: Validations, name: string) => { const s = vget(v, name); const n = s === undefined || s === '' ? NaN : Number(s); return Number.isFinite(n) ? n : null; };

/** Check validation inputs themselves (names known for the type, numbers parse). Returns a message or null. */
export function checkValidationDefs(type: string, validations: Validations): string | null {
  const ok = supportedValidations(type);
  for (const v of validations) {
    if (!ok.includes(v.name)) return `Validation '${v.name}' is not supported by type '${type}'.`;
    if (['min', 'max', 'list.min', 'list.max', 'max_precision', 'scale_min', 'scale_max'].includes(v.name) && !['date', 'date_time'].includes(baseType(type)) && !Number.isFinite(Number(v.value))) return `Validation '${v.name}' must be a number.`;
    if (v.name === 'regex') { try { new RegExp(v.value); } catch { return 'Validation regex is not a valid regular expression.'; } }
    if (v.name === 'choices') { try { if (!Array.isArray(JSON.parse(v.value))) return 'Validation choices must be a JSON array.'; } catch { return 'Validation choices must be a JSON array.'; } }
  }
  const mn = vnum(validations, 'min'), mx = vnum(validations, 'max');
  if (mn !== null && mx !== null && mn > mx) return 'Validation min must not be greater than max.';
  return null;
}

function checkItem(base: string, item: string, v: Validations): string | null {
  const bad = validateMetafieldValue(base, item);
  if (bad) return bad;
  const len = item.length;
  if (['single_line_text_field', 'multi_line_text_field', 'rich_text_field'].includes(base)) {
    const mn = vnum(v, 'min'), mx = vnum(v, 'max');
    if (base === 'single_line_text_field' && /[\r\n]/.test(item)) return 'Value must be a single line.';
    if (mn !== null && len < mn) return `Value must be at least ${mn} characters.`;
    if (mx !== null && len > mx) return `Value must be at most ${mx} characters.`;
    const rx = vget(v, 'regex');
    if (rx) { try { if (!new RegExp(rx).test(item)) return 'Value does not match the required pattern.'; } catch { /* ignore invalid pattern */ } }
    const ch = vget(v, 'choices');
    if (ch) { try { if (!(JSON.parse(ch) as unknown[]).map(String).includes(item)) return 'Value must be one of the allowed choices.'; } catch { /* ignore */ } }
    if (len > 128 * 1024) return 'Value is too long (128 KB maximum).';
  }
  if (base === 'number_integer' || base === 'number_decimal') {
    const n = Number(item), mn = vnum(v, 'min'), mx = vnum(v, 'max');
    if (mn !== null && n < mn) return `Value must be at least ${mn}.`;
    if (mx !== null && n > mx) return `Value must be at most ${mx}.`;
    const prec = vnum(v, 'max_precision');
    if (prec !== null && (item.split('.')[1]?.length ?? 0) > prec) return `Value must have at most ${prec} decimals.`;
  }
  if (base === 'date' || base === 'date_time') {
    const t = Date.parse(item), mn = vget(v, 'min'), mx = vget(v, 'max');
    if (mn && t < Date.parse(mn)) return `Value must be on or after ${mn}.`;
    if (mx && t > Date.parse(mx)) return `Value must be on or before ${mx}.`;
  }
  if (base === 'url') {
    const dom = vget(v, 'allowed_domains');
    if (dom) { try { const allowed = JSON.parse(dom) as string[]; const host = new URL(item, 'http://x.invalid').hostname; if (/^https?:/.test(item) && !allowed.includes(host)) return 'Value domain is not allowed.'; } catch { /* ignore */ } }
  }
  if (base === 'money') {
    try { const m = JSON.parse(item) as { amount?: unknown; currency_code?: unknown }; if (!m || typeof m !== 'object' || !Number.isFinite(Number(m.amount)) || typeof m.currency_code !== 'string') return 'Value must be {"amount","currency_code"}.'; } catch { return 'Value must be valid JSON.'; }
  }
  if (base === 'weight' || base === 'volume' || base === 'dimension') {
    try { const m = JSON.parse(item) as { value?: unknown; unit?: unknown }; if (!m || typeof m !== 'object' || !Number.isFinite(Number(m.value)) || typeof m.unit !== 'string') return 'Value must be {"value","unit"}.'; } catch { return 'Value must be valid JSON.'; }
  }
  if (base === 'rating') {
    try {
      const m = JSON.parse(item) as { value?: unknown; scale_min?: unknown; scale_max?: unknown };
      const val = Number(m?.value);
      if (!Number.isFinite(val)) return 'Value must be {"value","scale_min","scale_max"}.';
      const lo = vnum(v, 'scale_min') ?? Number(m.scale_min ?? 0), hi = vnum(v, 'scale_max') ?? Number(m.scale_max ?? 5);
      if (val < lo || val > hi) return `Rating must be between ${lo} and ${hi}.`;
    } catch { return 'Value must be valid JSON.'; }
  }
  const gidTypes = REFERENCE_GID_TYPES[base];
  if (gidTypes) {
    const m = /^gid:\/\/shopify\/([A-Za-z]+)\/(\d+)$/.exec(item);
    if (!m || !gidTypes.includes(m[1]!)) return `Value must be a ${gidTypes[0]} id (gid://shopify/${gidTypes[0]}/<id>).`;
  }
  return null;
}

/** Check a stored value against a field's type and validations (no database access: references are format-checked only). */
export function validateFieldValue(type: string, value: string, validations: Validations = []): string | null {
  const base = baseType(type);
  if (!FIELD_BASE_TYPES.includes(base)) return `Type '${type}' is not a valid field type.`;
  if (!isListType(type)) return checkItem(base, value, validations);
  let arr: unknown;
  try { arr = JSON.parse(value); } catch { return 'Value must be a JSON array.'; }
  if (!Array.isArray(arr)) return 'Value must be a JSON array.';
  const mn = vnum(validations, 'list.min'), mx = vnum(validations, 'list.max');
  if (mn !== null && arr.length < mn) return `List must have at least ${mn} items.`;
  if (mx !== null && arr.length > mx) return `List must have at most ${mx} items.`;
  if (arr.length > 128) return 'List is too long (128 items maximum).';
  for (const x of arr) {
    const item = typeof x === 'string' ? x : JSON.stringify(x);
    const bad = checkItem(base, item, validations);
    if (bad) return bad;
  }
  return null;
}

/** True when the stored value counts as empty (required fields need something). */
export const isBlankValue = (type: string, value: string | undefined | null): boolean => {
  if (value === undefined || value === null || value === '') return true;
  if (isListType(type)) { try { const a = JSON.parse(value) as unknown; return Array.isArray(a) && a.length === 0; } catch { return false; } }
  return false;
};
