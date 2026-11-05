import type { Key } from '../i18n';

/** Field types of a metaobject definition, grouped like the type dropdown. */
export const FIELD_TYPE_GROUPS: Array<{ label: Key; types: string[] }> = [
  { label: 'mo.group.text', types: ['single_line_text_field', 'multi_line_text_field', 'rich_text_field'] },
  { label: 'mo.group.number', types: ['number_integer', 'number_decimal', 'rating'] },
  { label: 'mo.group.other', types: ['boolean', 'date', 'date_time', 'color', 'url', 'json', 'id'] },
  { label: 'mo.group.measure', types: ['money', 'weight', 'volume', 'dimension'] },
  { label: 'mo.group.reference', types: ['product_reference', 'variant_reference', 'collection_reference', 'page_reference', 'file_reference', 'metaobject_reference', 'mixed_reference'] },
];
export const FIELD_TYPES = FIELD_TYPE_GROUPS.flatMap((g) => g.types);

export const isListType = (type: string) => type.startsWith('list.');
export const baseOf = (type: string) => type.replace(/^list\./, '');
export const typeKey = (type: string): Key => `mo.type.${baseOf(type)}` as Key;
export const isReference = (type: string) => baseOf(type).endsWith('_reference');

/** `Cart upsell` -> `cart_upsell` (types and field keys: letters, digits, `_`). */
export const slugKey = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** Text-like types that can name an entry. */
export const DISPLAY_NAME_TYPES = ['single_line_text_field'];

export type ValidationKind = 'number' | 'date' | 'text' | 'choices' | 'definition' | 'definitions' | 'fileTypes';
export interface ValidationSpec { name: string; kind: ValidationKind; label: Key }

/** Validations the editor offers per base type (names match what the server accepts). */
export function validationSpecs(type: string): ValidationSpec[] {
  const b = baseOf(type);
  const v = (name: string, kind: ValidationKind, label: Key): ValidationSpec => ({ name, kind, label });
  const out: ValidationSpec[] = [];
  switch (b) {
    case 'single_line_text_field': out.push(v('min', 'number', 'mo.val.minLength'), v('max', 'number', 'mo.val.maxLength'), v('regex', 'text', 'mo.val.regex'), v('choices', 'choices', 'mo.val.choices')); break;
    case 'multi_line_text_field': case 'rich_text_field': out.push(v('min', 'number', 'mo.val.minLength'), v('max', 'number', 'mo.val.maxLength')); break;
    case 'number_integer': case 'number_decimal': out.push(v('min', 'number', 'mo.val.min'), v('max', 'number', 'mo.val.max')); if (b === 'number_decimal') out.push(v('max_precision', 'number', 'mo.val.precision')); break;
    case 'date': case 'date_time': out.push(v('min', 'date', 'mo.val.minDate'), v('max', 'date', 'mo.val.maxDate')); break;
    case 'file_reference': out.push(v('file_type_options', 'fileTypes', 'mo.val.fileTypes')); break;
    case 'metaobject_reference': out.push(v('metaobject_definition_id', 'definition', 'mo.val.definition')); break;
    case 'mixed_reference': out.push(v('metaobject_definition_ids', 'definitions', 'mo.val.definitions')); break;
    case 'rating': out.push(v('scale_min', 'number', 'mo.val.scaleMin'), v('scale_max', 'number', 'mo.val.scaleMax')); break;
    default: break;
  }
  if (isListType(type)) out.push(v('list.min', 'number', 'mo.val.listMin'), v('list.max', 'number', 'mo.val.listMax'));
  return out;
}

/** Editable draft of one field definition. */
export interface FieldDraft {
  uid: string; key: string; name: string; description: string; base: string; list: boolean; required: boolean; filterable: boolean;
  validations: Record<string, string>; keyTouched: boolean; existing: boolean;
}
export const fieldType = (f: Pick<FieldDraft, 'base' | 'list'>) => (f.list ? `list.${f.base}` : f.base);

export const emptyField = (uid: string): FieldDraft => ({ uid, key: '', name: '', description: '', base: 'single_line_text_field', list: false, required: false, filterable: false, validations: {}, keyTouched: false, existing: false });

export function draftOf(f: { key: string; name: string; description?: string | null; required: boolean; type: { name: string }; validations: Array<{ name: string; value: string | null }>; capabilities?: { adminFilterable?: { enabled: boolean } } }, uid: string): FieldDraft {
  return {
    uid, key: f.key, name: f.name, description: f.description ?? '', base: baseOf(f.type.name), list: isListType(f.type.name), required: f.required, filterable: !!f.capabilities?.adminFilterable?.enabled,
    validations: Object.fromEntries(f.validations.filter((v) => v.value != null).map((v) => [v.name, v.value as string])), keyTouched: true, existing: true,
  };
}

/** Only validations the type supports and that have a value. */
export function validationInputs(f: FieldDraft): Array<{ name: string; value: string }> {
  const allowed = new Set(validationSpecs(fieldType(f)).map((s) => s.name));
  return Object.entries(f.validations).filter(([k, v]) => allowed.has(k) && v.trim() !== '').map(([name, value]) => ({ name, value: value.trim() }));
}

/** Choices are stored as a JSON array; the editor shows one per line. */
export const choicesToText = (json: string | undefined): string => { try { return (JSON.parse(json ?? '[]') as unknown[]).map(String).join('\n'); } catch { return ''; } };
export const textToChoices = (text: string): string => { const l = text.split('\n').map((x) => x.trim()).filter(Boolean); return l.length ? JSON.stringify(l) : ''; };

export const definitionIdsOf = (v: string | undefined): string[] => { if (!v) return []; try { const a = JSON.parse(v) as unknown; if (Array.isArray(a)) return a.map(String); } catch { /* single id */ } return [v]; };

/** Value of a list field as items (stored as a JSON array). */
export function parseList(value: string | null | undefined): string[] {
  if (!value) return [];
  try { const a = JSON.parse(value) as unknown; return Array.isArray(a) ? a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))) : []; } catch { return []; }
}
/** Items to the stored list value (numbers stay numbers, empty lists clear the field). */
export function serializeList(base: string, items: string[]): string {
  const clean = items.filter((i) => i.trim() !== '');
  if (!clean.length) return '';
  return JSON.stringify(clean.map((i) => (base === 'number_integer' || base === 'number_decimal' ? Number(i) : i)));
}

export interface EntryField { key: string; type: string; value: string | null }
/** First few non-empty plain values of an entry, for list rows. */
export function previewValues(fields: EntryField[], max = 3): Array<{ key: string; text: string }> {
  const out: Array<{ key: string; text: string }> = [];
  for (const f of fields) {
    if (out.length >= max) break;
    if (!f.value || isReference(f.type) || f.type === 'json' || f.type === 'rich_text_field') continue;
    const text = isListType(f.type) ? parseList(f.value).join(', ') : f.value;
    if (text) out.push({ key: f.key, text: text.length > 60 ? `${text.slice(0, 57)}…` : text });
  }
  return out;
}

export const WEIGHT_UNITS = ['kg', 'g', 'lb', 'oz'];
export const VOLUME_UNITS = ['ml', 'cl', 'l', 'fl_oz', 'gal'];
export const DIMENSION_UNITS = ['mm', 'cm', 'm', 'in', 'ft'];
export const unitsOf = (base: string) => (base === 'weight' ? WEIGHT_UNITS : base === 'volume' ? VOLUME_UNITS : DIMENSION_UNITS);
