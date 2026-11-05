export { getMetaobjectDefinition, getMetaobjectDefinitionByType, moErr, moFail, entryDisplayName } from './common';
export type { MetaobjectDefinition, MoError } from './common';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { metafieldDefinitions, metaobjectDefinitions, metaobjects, type MetaobjectFieldDef } from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { emit, errR, okR, txResult, type Result } from '../catalog/common';
import { removeEntriesTx } from './entries';
import { entryDisplayName, getMetaobjectDefinition, getMetaobjectDefinitionByType, moErr, moFail, type MetaobjectDefinition, type MoError } from './common';
import { FIELD_BASE_TYPES, baseType, checkValidationDefs, isListType, pinnedDefinitionIds } from './validate';

export const MAX_DEFINITIONS = 128;
export const MAX_FIELDS = 40;
export const ADMIN_ACCESS = ['PRIVATE', 'MERCHANT_READ', 'MERCHANT_READ_WRITE', 'PUBLIC_READ', 'PUBLIC_READ_WRITE'];

export interface FieldDefInput {
  key: string; type: string; name?: string | null; description?: string | null; required?: boolean | null;
  validations?: { name: string; value: string }[] | null; adminFilterable?: boolean | null;
}
export interface FieldDefUpdate {
  key: string; name?: string | null; description?: string | null; required?: boolean | null;
  validations?: { name: string; value: string }[] | null; adminFilterable?: boolean | null;
}
export interface DefinitionCapabilitiesInput {
  publishable?: { enabled: boolean } | null; translatable?: { enabled: boolean } | null;
  renderable?: { enabled: boolean; data?: { metaTitleKey?: string | null; metaDescriptionKey?: string | null } | null } | null;
  onlineStore?: { enabled: boolean; data?: { urlHandle: string; createRedirects?: boolean | null } | null } | null;
}
export interface AccessInput { admin?: string | null; storefront?: string | null; customerAccount?: string | null }
export interface DefinitionCreateInput {
  type: string; name?: string | null; description?: string | null; fieldDefinitions?: FieldDefInput[] | null; access?: AccessInput | null;
  displayNameKey?: string | null; capabilities?: DefinitionCapabilitiesInput | null;
}
export interface DefinitionUpdateInput {
  name?: string | null; description?: string | null; access?: AccessInput | null; displayNameKey?: string | null; resetFieldOrder?: boolean | null;
  fieldDefinitions?: { create?: FieldDefInput | null; update?: FieldDefUpdate | null; delete?: { key: string } | null }[] | null; capabilities?: DefinitionCapabilitiesInput | null;
}

const TYPE_RE = /^[A-Za-z0-9_-]{3,255}$/;
const KEY_RE = /^[A-Za-z0-9_-]{2,64}$/;
const URL_HANDLE_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const RESERVED_URL_HANDLES = ['products', 'collections', 'blogs', 'cart', 'checkout', 'account', 'search', 'policies', 'admin', 'apps', 'password', 'pages'];

export function listMetaobjectDefinitions(db: Executor, shopId: number, o: { offset: number; limit: number; reverse?: boolean; query?: string | null }): Promise<MetaobjectDefinition[]> {
  const q = o.query?.trim();
  return db.select().from(metaobjectDefinitions)
    .where(and(eq(metaobjectDefinitions.shopId, shopId), q ? sql`(${metaobjectDefinitions.name} ilike ${`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`} or ${metaobjectDefinitions.type} ilike ${`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`})` : undefined))
    .orderBy((o.reverse ? desc : asc)(metaobjectDefinitions.id)).limit(o.limit).offset(o.offset);
}

/** Entry counts by status over the whole shop (landing page tiles). */
export async function metaobjectSummary(db: Executor, shopId: number): Promise<{ active: number; draft: number; webPages: number; total: number }> {
  const rows = await db.select({
    status: metaobjects.status, defPublishable: metaobjectDefinitions.capPublishable, online: metaobjectDefinitions.capOnlineStore, n: sql<number>`count(*)::int`,
  }).from(metaobjects).innerJoin(metaobjectDefinitions, eq(metaobjectDefinitions.id, metaobjects.definitionId)).where(eq(metaobjects.shopId, shopId))
    .groupBy(metaobjects.status, metaobjectDefinitions.capPublishable, metaobjectDefinitions.capOnlineStore);
  let active = 0, draft = 0, webPages = 0, total = 0;
  for (const r of rows) {
    total += r.n;
    const isDraft = r.defPublishable && r.status === 'DRAFT';
    if (isDraft) draft += r.n; else active += r.n;
    if (r.online && !isDraft) webPages += r.n;
  }
  return { active, draft, webPages, total };
}

function normalizeField(f: FieldDefInput | FieldDefUpdate, base: MetaobjectFieldDef | null): MetaobjectFieldDef {
  const type = base?.type ?? (f as FieldDefInput).type;
  return {
    key: f.key, type, name: (f.name ?? base?.name ?? f.key).trim() || f.key,
    description: f.description !== undefined ? (f.description || null) : (base?.description ?? null),
    required: f.required ?? base?.required ?? false,
    validations: f.validations ? f.validations.map((v) => ({ name: v.name, value: v.value })) : (base?.validations ?? []),
    adminFilterable: f.adminFilterable ?? base?.adminFilterable ?? false,
  };
}

/** Validate the field list of a definition; returns errors with `elementKey`/`elementIndex`. */
function checkFields(fields: MetaobjectFieldDef[], path: string[]): MoError[] {
  const errors: MoError[] = [];
  const seen = new Set<string>();
  if (fields.length > MAX_FIELDS) errors.push(moErr(path, `A definition can have at most ${MAX_FIELDS} fields.`, 'INPUT_LIMIT_EXCEEDED'));
  fields.forEach((f, i) => {
    const at = [...path, String(i)];
    const el = { elementKey: f.key, elementIndex: i };
    if (!KEY_RE.test(f.key)) errors.push(moErr([...at, 'key'], 'Field key is invalid (2-64 letters, digits, - and _).', 'INVALID', el));
    if (seen.has(f.key.toLowerCase())) errors.push(moErr([...at, 'key'], `Field key '${f.key}' is duplicated.`, 'DUPLICATE_FIELD_INPUT', el));
    seen.add(f.key.toLowerCase());
    if (!FIELD_BASE_TYPES.includes(baseType(f.type))) { errors.push(moErr([...at, 'type'], `Type '${f.type}' is not a valid field type.`, 'INVALID_TYPE', el)); return; }
    const bad = checkValidationDefs(f.type, f.validations);
    if (bad) errors.push(moErr([...at, 'validations'], bad, 'INVALID_OPTION', el));
  });
  return errors;
}

/** Definition-level checks that need the final field list. */
function checkDefinition(d: { displayNameKey: string | null; fields: MetaobjectFieldDef[]; renderableMetaTitleKey: string | null; renderableMetaDescKey: string | null; capRenderable: boolean }): MoError[] {
  const errors: MoError[] = [];
  if (d.displayNameKey) {
    const f = d.fields.find((x) => x.key === d.displayNameKey);
    if (!f) errors.push(moErr(['definition', 'displayNameKey'], 'Display name key does not match a field.', 'DISPLAY_NAME_CONFLICT'));
    else if (isListType(f.type) || !['single_line_text_field', 'multi_line_text_field', 'number_integer', 'number_decimal', 'date', 'date_time', 'color', 'url', 'id'].includes(f.type)) errors.push(moErr(['definition', 'displayNameKey'], 'Display name must be a text field.', 'DISPLAY_NAME_CONFLICT'));
  }
  for (const [k, key] of [['metaTitleKey', d.renderableMetaTitleKey], ['metaDescriptionKey', d.renderableMetaDescKey]] as const) {
    if (d.capRenderable && key && !d.fields.some((x) => x.key === key)) errors.push(moErr(['definition', 'capabilities', 'renderable', 'data', k], 'Key does not match a field.', 'INVALID'));
  }
  return errors;
}

async function urlHandleErrors(db: Executor, shopId: number, urlHandle: string | null | undefined, selfId: number | null): Promise<MoError[]> {
  const path = ['definition', 'capabilities', 'onlineStore', 'data', 'urlHandle'];
  if (!urlHandle?.trim()) return [moErr(path, 'URL handle can not be blank.', 'URL_HANDLE_BLANK')];
  if (!URL_HANDLE_RE.test(urlHandle) || RESERVED_URL_HANDLES.includes(urlHandle)) return [moErr(path, 'URL handle is invalid.', 'URL_HANDLE_INVALID')];
  const [row] = await db.select({ id: metaobjectDefinitions.id }).from(metaobjectDefinitions).where(and(eq(metaobjectDefinitions.shopId, shopId), eq(metaobjectDefinitions.onlineStoreUrlHandle, urlHandle), selfId ? ne(metaobjectDefinitions.id, selfId) : undefined));
  return row ? [moErr(path, 'URL handle is already taken.', 'URL_HANDLE_TAKEN')] : [];
}

function accessErrors(a: AccessInput | null | undefined): MoError[] {
  const errors: MoError[] = [];
  if (a?.admin && !ADMIN_ACCESS.includes(a.admin)) errors.push(moErr(['definition', 'access', 'admin'], 'Admin access is invalid.', 'INVALID'));
  return errors;
}

export async function createMetaobjectDefinition(db: Db, shopId: number, i: DefinitionCreateInput): Promise<Result<MetaobjectDefinition>> {
  const type = (i.type ?? '').trim();
  if (!type) return moFail(moErr(['definition', 'type'], "Type can't be blank.", 'BLANK'));
  if (type.length < 3) return moFail(moErr(['definition', 'type'], 'Type is too short (3 characters minimum).', 'TOO_SHORT'));
  if (type.length > 255) return moFail(moErr(['definition', 'type'], 'Type is too long (255 characters maximum).', 'TOO_LONG'));
  if (!TYPE_RE.test(type)) return moFail(moErr(['definition', 'type'], 'Type can only contain letters, digits, hyphens and underscores.', 'INVALID'));
  if (/^(shopify--|app--)/.test(type)) return moFail(moErr(['definition', 'type'], 'This type prefix is reserved.', 'RESERVED_NAME'));
  const fields = (i.fieldDefinitions ?? []).map((f) => normalizeField(f, null));
  const caps = i.capabilities ?? {};
  const renderable = !!caps.renderable?.enabled || !!caps.onlineStore?.enabled;
  const draft = {
    displayNameKey: i.displayNameKey ?? null, fields, capRenderable: renderable,
    renderableMetaTitleKey: caps.renderable?.data?.metaTitleKey ?? null, renderableMetaDescKey: caps.renderable?.data?.metaDescriptionKey ?? null,
  };
  const errors = [...checkFields(fields, ['definition', 'fieldDefinitions']), ...checkDefinition(draft), ...accessErrors(i.access)];
  for (const [n, f] of fields.entries()) if (pinnedDefinitionIds(f.validations).length === 0 && f.validations.some((v) => v.name.startsWith('metaobject_definition')) && !errors.length) errors.push(moErr(['definition', 'fieldDefinitions', String(n), 'validations'], 'Definition id is invalid.', 'INVALID_OPTION', { elementKey: f.key, elementIndex: n }));
  if (caps.onlineStore?.enabled) errors.push(...await urlHandleErrors(db, shopId, caps.onlineStore.data?.urlHandle, null));
  if (errors.length) return { ok: false, errors };
  return txResult(db, async (tx) => {
    if (await getMetaobjectDefinitionByType(tx, shopId, type)) return moFail(moErr(['definition', 'type'], 'Type has already been taken.', 'TAKEN'));
    const [n] = await tx.select({ n: sql<number>`count(*)::int` }).from(metaobjectDefinitions).where(eq(metaobjectDefinitions.shopId, shopId));
    if ((n?.n ?? 0) >= MAX_DEFINITIONS) return moFail(moErr(['definition'], `A shop can have at most ${MAX_DEFINITIONS} definitions.`, 'MAX_DEFINITIONS_EXCEEDED'));
    const pins = await pinErrors(tx, shopId, fields, null);
    if (pins.length) return { ok: false, errors: pins };
    const [row] = await tx.insert(metaobjectDefinitions).values({
      shopId, type, name: i.name?.trim() || type, description: i.description?.trim() || null, fieldDefinitions: fields, displayNameKey: i.displayNameKey || null,
      accessAdmin: i.access?.admin ?? 'PUBLIC_READ_WRITE', accessStorefront: i.access?.storefront ?? 'PUBLIC_READ', accessCustomerAccount: i.access?.customerAccount ?? 'NONE',
      capPublishable: caps.publishable?.enabled ?? true, capTranslatable: caps.translatable?.enabled ?? true, capRenderable: renderable,
      renderableMetaTitleKey: draft.renderableMetaTitleKey, renderableMetaDescKey: draft.renderableMetaDescKey,
      capOnlineStore: !!caps.onlineStore?.enabled, onlineStoreUrlHandle: caps.onlineStore?.enabled ? caps.onlineStore.data!.urlHandle : null, onlineStoreCreateRedirects: !!caps.onlineStore?.data?.createRedirects,
    }).returning();
    await emit(tx, shopId, 'metaobject_definition', row!.id, 'metaobject_definitions/create', { type });
    return okR(row!);
  });
}

/** Reference fields pinned to a definition must point at an existing one. */
async function pinErrors(db: Executor, shopId: number, fields: MetaobjectFieldDef[], selfId: number | null): Promise<MoError[]> {
  const errors: MoError[] = [];
  for (const [n, f] of fields.entries()) {
    for (const id of pinnedDefinitionIds(f.validations)) {
      if (id === selfId) continue;
      if (!(await getMetaobjectDefinition(db, shopId, id))) errors.push(moErr(['definition', 'fieldDefinitions', String(n), 'validations'], 'The pinned definition does not exist.', 'INVALID_OPTION', { elementKey: f.key, elementIndex: n }));
    }
  }
  return errors;
}

export async function updateMetaobjectDefinition(db: Db, shopId: number, id: number, i: DefinitionUpdateInput): Promise<Result<MetaobjectDefinition>> {
  const cur = await getMetaobjectDefinition(db, shopId, id);
  if (!cur) return moFail(moErr(['id'], 'Definition not found.', 'RECORD_NOT_FOUND'));
  const errors: MoError[] = [...accessErrors(i.access)];
  let fields = cur.fieldDefinitions.map((f) => ({ ...f }));
  const submitted: string[] = [];
  (i.fieldDefinitions ?? []).forEach((op, n) => {
    const at = ['definition', 'fieldDefinitions', String(n)];
    if (op.create) {
      const f = normalizeField(op.create, null);
      if (fields.some((x) => x.key === f.key)) errors.push(moErr([...at, 'create', 'key'], `Field key '${f.key}' already exists.`, 'OBJECT_FIELD_TAKEN', { elementKey: f.key, elementIndex: n }));
      else { fields.push(f); submitted.push(f.key); }
    } else if (op.update) {
      const idx = fields.findIndex((x) => x.key === op.update!.key);
      if (idx < 0) errors.push(moErr([...at, 'update', 'key'], `Field '${op.update.key}' does not exist.`, 'UNDEFINED_OBJECT_FIELD', { elementKey: op.update.key, elementIndex: n }));
      else { fields[idx] = normalizeField(op.update, fields[idx]!); submitted.push(op.update.key); }
    } else if (op.delete) {
      if (!fields.some((x) => x.key === op.delete!.key)) errors.push(moErr([...at, 'delete', 'key'], `Field '${op.delete.key}' does not exist.`, 'UNDEFINED_OBJECT_FIELD', { elementKey: op.delete.key, elementIndex: n }));
      fields = fields.filter((x) => x.key !== op.delete!.key);
    }
  });
  if (i.resetFieldOrder) {
    const first = submitted.map((k) => fields.find((f) => f.key === k)).filter((f): f is MetaobjectFieldDef => !!f);
    fields = [...first, ...fields.filter((f) => !submitted.includes(f.key)).sort((a, b) => a.key.localeCompare(b.key))];
  }
  const caps = i.capabilities ?? {};
  const capOnline = caps.onlineStore ? caps.onlineStore.enabled : cur.capOnlineStore;
  const urlHandle = caps.onlineStore?.enabled ? caps.onlineStore.data?.urlHandle ?? cur.onlineStoreUrlHandle : cur.onlineStoreUrlHandle;
  const capRenderable = caps.renderable ? caps.renderable.enabled : cur.capRenderable;
  const renderable = capRenderable || capOnline;
  const displayNameKey = i.displayNameKey !== undefined ? (i.displayNameKey || null) : (fields.some((f) => f.key === cur.displayNameKey) ? cur.displayNameKey : null);
  const metaTitle = caps.renderable?.data ? caps.renderable.data.metaTitleKey ?? null : cur.renderableMetaTitleKey;
  const metaDesc = caps.renderable?.data ? caps.renderable.data.metaDescriptionKey ?? null : cur.renderableMetaDescKey;
  errors.push(...checkFields(fields, ['definition', 'fieldDefinitions']), ...checkDefinition({ displayNameKey, fields, capRenderable: renderable, renderableMetaTitleKey: metaTitle, renderableMetaDescKey: metaDesc }));
  if (capOnline && (caps.onlineStore?.enabled || !cur.capOnlineStore)) errors.push(...await urlHandleErrors(db, shopId, urlHandle, cur.id));
  if (errors.length) return { ok: false, errors };
  return txResult(db, async (tx) => {
    const pins = await pinErrors(tx, shopId, fields, cur.id);
    if (pins.length) return { ok: false, errors: pins };
    const removed = cur.fieldDefinitions.filter((f) => !fields.some((x) => x.key === f.key)).map((f) => f.key);
    if (removed.length) {
      // Drop the values of removed fields right away (and their reverse index rows) so a later field with the same key starts empty.
      const entries = await tx.select().from(metaobjects).where(eq(metaobjects.definitionId, cur.id));
      for (const e of entries) {
        if (!removed.some((k) => k in e.values)) continue;
        const values = { ...e.values };
        for (const k of removed) delete values[k];
        await tx.update(metaobjects).set({ values }).where(eq(metaobjects.id, e.id));
      }
    }
    const [row] = await tx.update(metaobjectDefinitions).set({
      ...(i.name != null && { name: i.name.trim() || cur.name }), ...(i.description !== undefined && { description: i.description?.trim() || null }), fieldDefinitions: fields, displayNameKey,
      ...(i.access?.admin && { accessAdmin: i.access.admin }), ...(i.access?.storefront && { accessStorefront: i.access.storefront }), ...(i.access?.customerAccount && { accessCustomerAccount: i.access.customerAccount }),
      ...(caps.publishable && { capPublishable: caps.publishable.enabled }), ...(caps.translatable && { capTranslatable: caps.translatable.enabled }),
      capRenderable: renderable, renderableMetaTitleKey: renderable ? metaTitle : null, renderableMetaDescKey: renderable ? metaDesc : null,
      capOnlineStore: capOnline, onlineStoreUrlHandle: capOnline ? urlHandle : null, ...(caps.onlineStore?.data && { onlineStoreCreateRedirects: !!caps.onlineStore.data.createRedirects }),
    }).where(eq(metaobjectDefinitions.id, cur.id)).returning();
    if (displayNameKey !== cur.displayNameKey || removed.length) await recomputeDisplayNames(tx, row!);
    await emit(tx, shopId, 'metaobject_definition', row!.id, 'metaobject_definitions/update', { type: row!.type });
    return okR(row!);
  });
}

/** Recompute `display_name` of every entry (after the display name key changed). */
export async function recomputeDisplayNames(db: Executor, def: MetaobjectDefinition): Promise<void> {
  const rows = await db.select().from(metaobjects).where(eq(metaobjects.definitionId, def.id));
  for (const e of rows) {
    const name = entryDisplayName(def, e.values, e.handle);
    if (name !== e.displayName) await db.update(metaobjects).set({ displayName: name }).where(eq(metaobjects.id, e.id));
  }
}

export async function deleteMetaobjectDefinition(db: Db, shopId: number, id: number): Promise<Result<number>> {
  const cur = await getMetaobjectDefinition(db, shopId, id);
  if (!cur) return moFail(moErr(['id'], 'Definition not found.', 'RECORD_NOT_FOUND'));
  const others = await db.select().from(metaobjectDefinitions).where(and(eq(metaobjectDefinitions.shopId, shopId), ne(metaobjectDefinitions.id, id)));
  for (const o of others) {
    const f = o.fieldDefinitions.find((x) => pinnedDefinitionIds(x.validations).includes(id));
    if (f) return moFail(moErr(['id'], `The field '${f.key}' of definition '${o.name}' references this definition. Remove that field first.`, 'REFERENCE_EXISTS_ERROR', { elementKey: f.key }));
  }
  const metas = await db.select({ id: metafieldDefinitions.id, validations: metafieldDefinitions.validations, name: metafieldDefinitions.name }).from(metafieldDefinitions).where(eq(metafieldDefinitions.shopId, shopId));
  const pinned = metas.find((m) => pinnedDefinitionIds((m.validations as { name: string; value: string }[]) ?? []).includes(id));
  if (pinned) return moFail(moErr(['id'], `The metafield definition '${pinned.name}' references this definition. Remove it first.`, 'REFERENCE_EXISTS_ERROR'));
  return txResult(db, async (tx) => {
    const entries = await tx.select({ id: metaobjects.id }).from(metaobjects).where(eq(metaobjects.definitionId, id));
    const r = await removeEntriesTx(tx, shopId, entries.map((e) => e.id), { ignoreRequired: true });
    if (!r.ok) return r;
    await tx.delete(metaobjectDefinitions).where(eq(metaobjectDefinitions.id, id));
    await emit(tx, shopId, 'metaobject_definition', id, 'metaobject_definitions/delete', { type: cur.type });
    return okR(id);
  });
}
