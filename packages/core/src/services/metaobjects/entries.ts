import { and, asc, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { metafields, metaobjectDefinitions, metaobjectReferences, metaobjects, urlRedirects } from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { slugify } from '../handle';
import { buildSearch, dateCompare, idTerm, likeCi } from '../catalog/search';
import { emit, okR, txResult, type Result } from '../catalog/common';
import { entryDisplayName, getMetaobjectDefinition, getMetaobjectDefinitionByType, moErr, moFail, type MetaobjectDefinition, type MoError } from './common';
import { checkReferenceTargets, isMetaobjectRefType, itemsOf, isListType, metaobjectTargets, syncReferences } from './refs';
import { isBlankValue, validateFieldValue } from './validate';

export type Metaobject = typeof metaobjects.$inferSelect;

export const MAX_BULK = 250;
export const MAX_ENTRIES = 1_000_000;
const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{0,254}$/;

export interface EntryFieldInput { key: string; value: string }
export interface EntryCapabilitiesInput { publishable?: { status: string } | null; onlineStore?: { templateSuffix?: string | null } | null }
export interface EntryCreateInput { type: string; handle?: string | null; fields?: EntryFieldInput[] | null; values?: Record<string, unknown> | null; capabilities?: EntryCapabilitiesInput | null }
export interface EntryUpdateInput { handle?: string | null; fields?: EntryFieldInput[] | null; values?: Record<string, unknown> | null; capabilities?: EntryCapabilitiesInput | null; redirectNewHandle?: boolean | null }
export interface Actor { staffId?: number | null; app?: string | null }

export async function getMetaobject(db: Executor, shopId: number, id: number): Promise<Metaobject | null> {
  return (await db.select().from(metaobjects).where(and(eq(metaobjects.shopId, shopId), eq(metaobjects.id, id))))[0] ?? null;
}
export async function getMetaobjectByHandle(db: Executor, shopId: number, type: string, handle: string): Promise<Metaobject | null> {
  return (await db.select().from(metaobjects).where(and(eq(metaobjects.shopId, shopId), eq(metaobjects.type, type), sql`lower(${metaobjects.handle}) = ${handle.toLowerCase()}`)))[0] ?? null;
}

const fieldsTerm = /(-?)fields\.([A-Za-z0-9_-]+):(<=|>=|<|>)?(?:"([^"]*)"|(\S+))/g;

function entryQuery(def: MetaobjectDefinition | null, q: string | null | undefined): SQL | undefined {
  if (!q?.trim()) return undefined;
  const extra: SQL[] = [];
  const rest = q.replace(fieldsTerm, (_m, neg: string, key: string, op: string | undefined, quoted: string | undefined, word: string | undefined) => {
    const value = quoted ?? word ?? '';
    const type = def?.fieldDefinitions.find((f) => f.key === key)?.type ?? '';
    const col = sql`${metaobjects.values} ->> ${key}`;
    let cond: SQL;
    if ((op || /^number_/.test(type)) && Number.isFinite(Number(value))) {
      const o = op ?? '=';
      cond = sql`(case when (${col}) ~ '^-?[0-9]+(\\.[0-9]+)?$' then (${col})::numeric ${sql.raw(o)} ${Number(value)} else false end)`;
    } else cond = likeCi(col, value);
    extra.push(neg ? sql`not (${cond})` : cond);
    return ' ';
  });
  const text = (v: string) => sql`(${likeCi(metaobjects.displayName, v)} or ${likeCi(metaobjects.handle, v)} or exists (select 1 from jsonb_each_text(${metaobjects.values}) kv where kv.value ilike ${`%${v.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}))`;
  const main = buildSearch(rest, {
    fields: {
      display_name: (_o, v) => likeCi(metaobjects.displayName, v), handle: (_o, v) => likeCi(metaobjects.handle, v, true), id: (_o, v) => idTerm(metaobjects.id, v),
      updated_at: (o, v) => dateCompare(metaobjects.updatedAt, o, v), created_at: (o, v) => dateCompare(metaobjects.createdAt, o, v),
      status: (_o, v) => sql`${metaobjects.status} = ${v.toUpperCase()}`, type: (_o, v) => sql`${metaobjects.type} = ${v}`,
    },
    text,
  });
  const all = [...(main ? [main] : []), ...extra];
  return all.length ? and(...all) : undefined;
}

const SORT: Record<string, unknown> = { id: metaobjects.id, type: metaobjects.type, updated_at: metaobjects.updatedAt, display_name: sql`lower(${metaobjects.displayName})` };

export function listMetaobjects(db: Executor, shopId: number, o: { type?: string | null; definition?: MetaobjectDefinition | null; query?: string | null; sortKey?: string | null; reverse?: boolean; offset: number; limit: number; ids?: number[] }): Promise<Metaobject[]> {
  const col = SORT[(o.sortKey ?? 'id').toLowerCase()] ?? metaobjects.id;
  const dir = o.reverse ? desc : asc;
  return db.select().from(metaobjects).where(and(eq(metaobjects.shopId, shopId), o.type ? eq(metaobjects.type, o.type) : undefined, o.ids ? inArray(metaobjects.id, o.ids) : undefined, entryQuery(o.definition ?? null, o.query)))
    .orderBy(dir(col as never), dir(metaobjects.id)).limit(o.limit).offset(o.offset);
}

export async function countMetaobjects(db: Executor, shopId: number, o: { type?: string | null; query?: string | null; definition?: MetaobjectDefinition | null; status?: string }): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(metaobjects).where(and(eq(metaobjects.shopId, shopId), o.type ? eq(metaobjects.type, o.type) : undefined, o.status ? eq(metaobjects.status, o.status) : undefined, entryQuery(o.definition ?? null, o.query)));
  return r?.n ?? 0;
}

/** Latest entries across all definitions (landing page). */
export function recentMetaobjects(db: Executor, shopId: number, limit: number): Promise<Metaobject[]> {
  return db.select().from(metaobjects).where(eq(metaobjects.shopId, shopId)).orderBy(desc(metaobjects.updatedAt), desc(metaobjects.id)).limit(limit);
}

/** Status as buyers see it: definitions without the publishable capability are always active. */
export const entryPublishStatus = (def: Pick<MetaobjectDefinition, 'capPublishable'>, e: Pick<Metaobject, 'status'>) => (def.capPublishable ? e.status : 'ACTIVE');

async function recount(db: Executor, defId: number): Promise<void> {
  await db.update(metaobjectDefinitions).set({ entryCount: sql`(select count(*)::int from ${metaobjects} where ${metaobjects.definitionId} = ${defId})` }).where(eq(metaobjectDefinitions.id, defId));
}

/** Convert a `values` JSON map (numbers, booleans, arrays, objects allowed) to stored strings. */
export function storedValues(values: Record<string, unknown>): EntryFieldInput[] {
  return Object.entries(values).map(([key, v]) => ({ key, value: v === null || v === undefined ? '' : typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v) }));
}

/** Merge the provided field inputs over `base` after validating each one against the definition. */
async function applyFields(db: Executor, shopId: number, def: MetaobjectDefinition, base: Record<string, string>, inputs: EntryFieldInput[]): Promise<Result<Record<string, string>>> {
  const errors: MoError[] = [];
  const values = { ...base };
  const seen = new Set<string>();
  for (const [i, f] of inputs.entries()) {
    const el = { elementKey: f.key, elementIndex: i };
    const at = ['metaobject', 'fields', String(i)];
    const fd = def.fieldDefinitions.find((x) => x.key === f.key);
    if (!fd) { errors.push(moErr([...at, 'key'], `Field definition '${f.key}' does not exist.`, 'UNDEFINED_OBJECT_FIELD', el)); continue; }
    if (seen.has(f.key)) { errors.push(moErr([...at, 'key'], `Field '${f.key}' was provided more than once.`, 'DUPLICATE_FIELD_INPUT', el)); continue; }
    seen.add(f.key);
    if (isBlankValue(fd.type, f.value)) { delete values[f.key]; continue; }
    const bad = validateFieldValue(fd.type, f.value, fd.validations);
    if (bad) { errors.push(moErr([...at, 'value'], bad, 'INVALID_VALUE', el)); continue; }
    const refBad = await checkReferenceTargets(db, shopId, fd.type, f.value, fd.validations);
    if (refBad) { errors.push(moErr([...at, 'value'], refBad, 'INVALID_VALUE', el)); continue; }
    values[f.key] = f.value;
  }
  for (const fd of def.fieldDefinitions) {
    if (fd.required && isBlankValue(fd.type, values[fd.key])) errors.push(moErr(['metaobject', 'fields'], `Field '${fd.name}' is required.`, 'OBJECT_FIELD_REQUIRED', { elementKey: fd.key }));
  }
  return errors.length ? { ok: false, errors } : okR(values);
}

async function writeRefs(db: Executor, shopId: number, def: MetaobjectDefinition, entryId: number, values: Record<string, string>): Promise<void> {
  const fields = def.fieldDefinitions.filter((f) => isMetaobjectRefType(f.type)).map((f) => ({ fieldKey: f.key, targetIds: values[f.key] ? metaobjectTargets(f.type, values[f.key]!) : [] }));
  await syncReferences(db, shopId, 'METAOBJECT', entryId, fields);
}

async function freeHandle(db: Executor, shopId: number, type: string, base: string, selfId?: number): Promise<string> {
  const root = slugify(base).slice(0, 240);
  for (let n = 0; ; n++) {
    const candidate = n === 0 ? root : `${root}-${n}`;
    const [hit] = await db.select({ id: metaobjects.id }).from(metaobjects).where(and(eq(metaobjects.shopId, shopId), eq(metaobjects.type, type), sql`lower(${metaobjects.handle}) = ${candidate}`, selfId ? ne(metaobjects.id, selfId) : undefined));
    if (!hit) return candidate;
  }
}

function capabilityErrors(def: MetaobjectDefinition, c: EntryCapabilitiesInput | null | undefined): MoError[] {
  const errors: MoError[] = [];
  if (c?.publishable) {
    if (!def.capPublishable) errors.push(moErr(['metaobject', 'capabilities', 'publishable'], 'The publishable capability is not enabled for this definition.', 'CAPABILITY_NOT_ENABLED'));
    else if (!['ACTIVE', 'DRAFT'].includes(c.publishable.status)) errors.push(moErr(['metaobject', 'capabilities', 'publishable', 'status'], 'Status is invalid.', 'INVALID'));
  }
  if (c?.onlineStore && !def.capOnlineStore) errors.push(moErr(['metaobject', 'capabilities', 'onlineStore'], 'The online store capability is not enabled for this definition.', 'CAPABILITY_NOT_ENABLED'));
  return errors;
}

function inputsOf(i: { fields?: EntryFieldInput[] | null; values?: Record<string, unknown> | null }): Result<EntryFieldInput[]> {
  if (i.fields && i.values) return moFail(moErr(['metaobject'], 'Provide either fields or values, not both.', 'INVALID'));
  return okR(i.fields ?? (i.values ? storedValues(i.values) : []));
}

export async function createMetaobject(db: Db, shopId: number, i: EntryCreateInput, actor: Actor = {}): Promise<Result<Metaobject>> {
  const def = await getMetaobjectDefinitionByType(db, shopId, i.type);
  if (!def) return moFail(moErr(['metaobject', 'type'], `No metaobject definition with type '${i.type}' exists.`, 'UNDEFINED_OBJECT_TYPE'));
  const inp = inputsOf(i);
  if (!inp.ok) return inp;
  const capErrors = capabilityErrors(def, i.capabilities);
  if (capErrors.length) return { ok: false, errors: capErrors };
  const handleIn = i.handle?.trim().toLowerCase();
  if (handleIn && !HANDLE_RE.test(handleIn)) return moFail(moErr(['metaobject', 'handle'], 'Handle is invalid (lowercase letters, digits, - and _).', 'INVALID'));
  return txResult(db, async (tx) => {
    if (def.entryCount >= MAX_ENTRIES) return moFail(moErr(['metaobject'], 'The maximum number of entries was reached.', 'MAX_OBJECTS_EXCEEDED'));
    const vals = await applyFields(tx, shopId, def, {}, inp.value);
    if (!vals.ok) return vals;
    let handle: string;
    if (handleIn) {
      if (await getMetaobjectByHandle(tx, shopId, def.type, handleIn)) return moFail(moErr(['metaobject', 'handle'], 'Handle has already been taken.', 'TAKEN'));
      handle = handleIn;
    } else handle = await freeHandle(tx, shopId, def.type, entryDisplayName(def, vals.value, '') || def.type);
    const [row] = await tx.insert(metaobjects).values({
      shopId, definitionId: def.id, type: def.type, handle, status: def.capPublishable ? (i.capabilities?.publishable?.status ?? 'ACTIVE') : 'ACTIVE', displayName: entryDisplayName(def, vals.value, handle), values: vals.value,
      templateSuffix: i.capabilities?.onlineStore?.templateSuffix || null, createdByStaffId: actor.staffId ?? null, createdByApp: actor.app ?? null,
    }).returning();
    await writeRefs(tx, shopId, def, row!.id, vals.value);
    await recount(tx, def.id);
    await emit(tx, shopId, 'metaobject', row!.id, 'metaobjects/create', { type: def.type, handle });
    return okR(row!);
  });
}

export async function updateMetaobject(db: Db, shopId: number, id: number, i: EntryUpdateInput): Promise<Result<Metaobject>> {
  const cur = await getMetaobject(db, shopId, id);
  if (!cur) return moFail(moErr(['id'], 'Record not found.', 'RECORD_NOT_FOUND'));
  const def = (await getMetaobjectDefinition(db, shopId, cur.definitionId))!;
  const inp = inputsOf(i);
  if (!inp.ok) return inp;
  const capErrors = capabilityErrors(def, i.capabilities);
  if (capErrors.length) return { ok: false, errors: capErrors };
  const handleIn = i.handle?.trim().toLowerCase();
  if (handleIn && !HANDLE_RE.test(handleIn)) return moFail(moErr(['metaobject', 'handle'], 'Handle is invalid (lowercase letters, digits, - and _).', 'INVALID'));
  return txResult(db, async (tx) => {
    const vals = await applyFields(tx, shopId, def, cur.values, inp.value);
    if (!vals.ok) return vals;
    let handle = cur.handle;
    if (handleIn && handleIn !== cur.handle.toLowerCase()) {
      if (await getMetaobjectByHandle(tx, shopId, def.type, handleIn)) return moFail(moErr(['metaobject', 'handle'], 'Handle has already been taken.', 'TAKEN'));
      handle = handleIn;
      if (i.redirectNewHandle && def.capOnlineStore && def.onlineStoreUrlHandle) {
        const path = `/pages/${def.onlineStoreUrlHandle}/${cur.handle}`;
        await tx.insert(urlRedirects).values({ shopId, path, target: `/pages/${def.onlineStoreUrlHandle}/${handle}` }).onConflictDoUpdate({ target: [urlRedirects.shopId, urlRedirects.path], set: { target: `/pages/${def.onlineStoreUrlHandle}/${handle}` } });
      }
    }
    const [row] = await tx.update(metaobjects).set({
      handle, values: vals.value, displayName: entryDisplayName(def, vals.value, handle), updatedAt: new Date(),
      ...(i.capabilities?.publishable && def.capPublishable && { status: i.capabilities.publishable.status }),
      ...(i.capabilities?.onlineStore && { templateSuffix: i.capabilities.onlineStore.templateSuffix || null }),
    }).where(eq(metaobjects.id, id)).returning();
    await writeRefs(tx, shopId, def, id, vals.value);
    await emit(tx, shopId, 'metaobject', id, 'metaobjects/update', { type: def.type, handle });
    return okR(row!);
  });
}

/** Create the entry when the handle is free, else update only the provided fields. */
export async function upsertMetaobject(db: Db, shopId: number, key: { type: string; handle: string }, i: { fields?: EntryFieldInput[] | null; values?: Record<string, unknown> | null; capabilities?: EntryCapabilitiesInput | null }, actor: Actor = {}): Promise<Result<Metaobject>> {
  const cur = await getMetaobjectByHandle(db, shopId, key.type, key.handle);
  if (cur) return updateMetaobject(db, shopId, cur.id, { fields: i.fields, values: i.values, capabilities: i.capabilities });
  return createMetaobject(db, shopId, { type: key.type, handle: key.handle, fields: i.fields, values: i.values, capabilities: i.capabilities }, actor);
}

/**
 * Delete entries. References held by other entries and by metafields are emptied (a required field refuses with REFERENCE_EXISTS_ERROR,
 * unless the referencing entry is deleted in the same call).
 */
export async function removeEntriesTx(tx: Executor, shopId: number, ids: number[], o: { ignoreRequired?: boolean } = {}): Promise<Result<number[]>> {
  if (!ids.length) return okR([]);
  const doomed = new Set(ids);
  const refs = await tx.select().from(metaobjectReferences).where(and(eq(metaobjectReferences.shopId, shopId), inArray(metaobjectReferences.targetId, ids)));
  const defCache = new Map<number, MetaobjectDefinition | null>();
  const defOf = async (id: number) => { if (!defCache.has(id)) defCache.set(id, await getMetaobjectDefinition(tx, shopId, id)); return defCache.get(id)!; };
  const touchedDefs = new Set<number>();
  const errors: MoError[] = [];

  const cleaned = (type: string, value: string): string | null => {
    const gids = (itemsOf(type, value) ?? []);
    const keep = gids.filter((g) => !doomed.has(Number(/(\d+)$/.exec(g)?.[1])));
    if (!isListType(type)) return keep.length ? value : null;
    return keep.length ? JSON.stringify(keep) : null;
  };

  const entryRefs = new Map<number, Set<string>>();
  const metaRefs = new Map<number, Set<string>>();
  for (const r of refs) {
    const m = r.sourceKind === 'METAOBJECT' ? entryRefs : metaRefs;
    if (r.sourceKind === 'METAOBJECT' && doomed.has(r.sourceId)) continue;
    (m.get(r.sourceId) ?? m.set(r.sourceId, new Set()).get(r.sourceId)!).add(r.fieldKey);
  }
  for (const [sourceId, keys] of entryRefs) {
    const src = await tx.select().from(metaobjects).where(eq(metaobjects.id, sourceId)).then((r) => r[0]);
    if (!src) continue;
    const def = await defOf(src.definitionId);
    if (!def) continue;
    const values = { ...src.values };
    for (const key of keys) {
      const fd = def.fieldDefinitions.find((f) => f.key === key);
      if (!fd || values[key] === undefined) continue;
      const next = cleaned(fd.type, values[key]!);
      if (next === null) {
        if (fd.required && !o.ignoreRequired) { errors.push(moErr(['id'], `The entry is referenced by the required field '${fd.name}' of '${src.displayName}'.`, 'REFERENCE_EXISTS_ERROR', { elementKey: key })); continue; }
        delete values[key];
      } else values[key] = next;
    }
    if (errors.length) continue;
    await tx.update(metaobjects).set({ values, displayName: entryDisplayName(def, values, src.handle), updatedAt: new Date() }).where(eq(metaobjects.id, sourceId));
    await writeRefs(tx, shopId, def, sourceId, values);
  }
  if (errors.length) return { ok: false, errors };
  for (const [mfId] of metaRefs) {
    const [mf] = await tx.select().from(metafields).where(eq(metafields.id, mfId));
    if (!mf) continue;
    const next = cleaned(mf.type, mf.value);
    if (next === null) await tx.delete(metafields).where(eq(metafields.id, mfId));
    else {
      await tx.update(metafields).set({ value: next }).where(eq(metafields.id, mfId));
      await syncReferences(tx, shopId, 'METAFIELD', mfId, [{ fieldKey: `${mf.namespace}.${mf.key}`, targetIds: metaobjectTargets(mf.type, next) }]);
    }
  }
  const gone = await tx.select({ id: metaobjects.id, definitionId: metaobjects.definitionId }).from(metaobjects).where(and(eq(metaobjects.shopId, shopId), inArray(metaobjects.id, ids)));
  for (const g of gone) touchedDefs.add(g.definitionId);
  // The reverse index of the doomed entries' own fields goes with them.
  await tx.delete(metaobjectReferences).where(and(eq(metaobjectReferences.shopId, shopId), eq(metaobjectReferences.sourceKind, 'METAOBJECT'), inArray(metaobjectReferences.sourceId, ids)));
  await tx.delete(metaobjects).where(and(eq(metaobjects.shopId, shopId), inArray(metaobjects.id, ids)));
  for (const d of touchedDefs) await recount(tx, d);
  for (const g of gone) await emit(tx, shopId, 'metaobject', g.id, 'metaobjects/delete');
  return okR(gone.map((g) => g.id));
}

export async function deleteMetaobject(db: Db, shopId: number, id: number): Promise<Result<number>> {
  if (!(await getMetaobject(db, shopId, id))) return moFail(moErr(['id'], 'Record not found.', 'RECORD_NOT_FOUND'));
  return txResult(db, async (tx) => { const r = await removeEntriesTx(tx, shopId, [id]); return r.ok ? okR(id) : r; });
}

/** Delete up to 250 entries by id, or every entry of a type (the work runs inline and the job is already done when this returns). */
export async function bulkDeleteMetaobjects(db: Db, shopId: number, where: { type?: string | null; ids?: number[] | null }): Promise<Result<{ count: number }>> {
  if ((where.type ? 1 : 0) + (where.ids ? 1 : 0) !== 1) return moFail(moErr(['where'], 'Exactly one of type or ids is required.', 'INVALID'));
  let ids: number[];
  if (where.type) {
    const def = await getMetaobjectDefinitionByType(db, shopId, where.type);
    if (!def) return moFail(moErr(['where', 'type'], `No metaobject definition with type '${where.type}' exists.`, 'UNDEFINED_OBJECT_TYPE'));
    ids = (await db.select({ id: metaobjects.id }).from(metaobjects).where(eq(metaobjects.definitionId, def.id))).map((r) => r.id);
  } else {
    if (where.ids!.length > MAX_BULK) return moFail(moErr(['where', 'ids'], `At most ${MAX_BULK} ids per call.`, 'INPUT_LIMIT_EXCEEDED'));
    ids = (await db.select({ id: metaobjects.id }).from(metaobjects).where(and(eq(metaobjects.shopId, shopId), inArray(metaobjects.id, where.ids!)))).map((r) => r.id);
  }
  return txResult(db, async (tx) => {
    const r = await removeEntriesTx(tx, shopId, ids);
    return r.ok ? okR({ count: r.value.length }) : r;
  });
}

/** Set many entries active or draft at once (admin bulk action). */
export async function setMetaobjectStatus(db: Db, shopId: number, ids: number[], status: 'ACTIVE' | 'DRAFT'): Promise<number> {
  if (!ids.length) return 0;
  const rows = await db.update(metaobjects).set({ status, updatedAt: new Date() }).where(and(eq(metaobjects.shopId, shopId), inArray(metaobjects.id, ids))).returning({ id: metaobjects.id });
  return rows.length;
}

export interface EntryReference { sourceKind: string; sourceId: number; fieldKey: string }
/** Where an entry is referenced from (other entries and metafields). */
export async function referencedBy(db: Executor, shopId: number, entryId: number): Promise<EntryReference[]> {
  const rows = await db.select().from(metaobjectReferences).where(and(eq(metaobjectReferences.shopId, shopId), eq(metaobjectReferences.targetId, entryId))).orderBy(asc(metaobjectReferences.id));
  return rows.map((r) => ({ sourceKind: r.sourceKind, sourceId: r.sourceId, fieldKey: r.fieldKey }));
}
