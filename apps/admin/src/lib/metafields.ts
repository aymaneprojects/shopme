import type { Key } from '../i18n';

export type MetafieldOwnerType = 'PRODUCT' | 'PRODUCTVARIANT' | 'COLLECTION' | 'CUSTOMER' | 'ORDER';
export const OWNER_TYPES: Array<{ id: MetafieldOwnerType; label: Key }> = [
  { id: 'PRODUCT', label: 'mf.owner.PRODUCT' }, { id: 'PRODUCTVARIANT', label: 'mf.owner.PRODUCTVARIANT' }, { id: 'COLLECTION', label: 'mf.owner.COLLECTION' },
  { id: 'CUSTOMER', label: 'mf.owner.CUSTOMER' }, { id: 'ORDER', label: 'mf.owner.ORDER' },
];

/** Types offered by the definition editor (the server accepts more; these are the ones with a real editor). */
export const BASE_TYPES = [
  'single_line_text_field', 'multi_line_text_field', 'rich_text_field', 'number_integer', 'number_decimal', 'boolean', 'date', 'date_time', 'url', 'color', 'json',
  'file_reference', 'product_reference', 'collection_reference', 'variant_reference', 'page_reference', 'metaobject_reference',
] as const;
export type BaseType = (typeof BASE_TYPES)[number];

export const typeLabelKey = (type: string): Key => `mf.type.${type.replace(/^list\./, '')}` as Key;
export const isList = (type: string) => type.startsWith('list.');
export const baseOf = (type: string) => type.replace(/^list\./, '');

export type InputKind = 'text' | 'multiline' | 'number' | 'boolean' | 'date' | 'datetime' | 'url' | 'color' | 'json' | 'list';
export function inputKind(type: string): InputKind {
  if (isList(type)) return 'list';
  switch (type) {
    case 'multi_line_text_field': case 'rich_text_field': return 'multiline';
    case 'number_integer': case 'number_decimal': return 'number';
    case 'boolean': return 'boolean';
    case 'date': return 'date';
    case 'date_time': return 'datetime';
    case 'url': return 'url';
    case 'color': return 'color';
    case 'json': return 'json';
    default: return 'text';
  }
}

/** Stored value -> what the form field shows (lists become one item per line, date times local). */
export function toField(type: string, value: string): string {
  if (isList(type)) { try { const a = JSON.parse(value) as unknown[]; return a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n'); } catch { return value; } }
  if (type === 'date_time') return value.replace(/:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/, '').slice(0, 16);
  if (type === 'json') { try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; } }
  return value;
}

/** Form field -> stored value. */
export function fromField(type: string, field: string): string {
  if (isList(type)) return JSON.stringify(field.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => (baseOf(type) === 'number_integer' || baseOf(type) === 'number_decimal' ? Number(l) : l)));
  if (type === 'date_time' && field && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(field)) return new Date(field).toISOString();
  if (type === 'json') { try { return JSON.stringify(JSON.parse(field)); } catch { return field; } }
  return field;
}

export interface MetafieldValue { id: string; namespace: string; key: string; type: string; value: string }
export interface MetafieldDefinitionRow { id: string; name: string; namespace: string; key: string; description: string | null; type: { name: string; category: string }; pinnedPosition: number | null; metafieldsCount: number; validations?: Array<{ name: string; value: string | null }> }

/** `MetafieldsSetInput` entries for fields whose text changed (blank means "leave as is": clearing is not supported by the API). */
export function changedInputs(ownerId: string, fields: Record<string, { namespace: string; key: string; type: string; value: string }>, original: Record<string, string>) {
  return Object.entries(fields)
    .filter(([id, f]) => f.value !== (original[id] ?? '') && f.value.trim() !== '')
    .map(([, f]) => ({ ownerId, namespace: f.namespace, key: f.key, type: f.type, value: fromField(f.type, f.value) }));
}
