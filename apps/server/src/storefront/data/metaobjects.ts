import { and, asc, eq, inArray } from 'drizzle-orm';
import { entryPublishStatus, getMetaobjectDefinitionByType, schema as s, type Db, type MetaobjectDefinition, type Translator } from '@shopme/core';
import { toGid } from '@shopme/shopify-compat';
import { lazyMap } from '../objects';
import { collectRefs, emptyRefIds, loadRefLookups, valueObject } from './metafields';
import type { MetafieldObject } from './metafields';

type EntryRow = typeof s.metaobjects.$inferSelect;

/** Entries nested deeper than this read as nil (cycles are legal in the data). */
export const MAX_DEPTH = 5;

/** What themes see for an entry: `entry.<field>` (typed value objects), `entry.system`, `entry.handle`, `entry.type`, `entry.url`. */
export interface EntryDrop {
  id: string; handle: string; type: string; display_name: string; url: string | null; system: { id: string; handle: string; type: string; url: string | null; updated_at: string; created_at: string };
  [field: string]: unknown;
}

export const isVisible = (def: MetaobjectDefinition, e: EntryRow) => def.accessStorefront === 'PUBLIC_READ' && entryPublishStatus(def, e) === 'ACTIVE';
export const entryUrl = (def: MetaobjectDefinition, e: Pick<EntryRow, 'handle'>) => (def.capOnlineStore && def.onlineStoreUrlHandle ? `/pages/${def.onlineStoreUrlHandle}/${e.handle}` : null);

/** Entries by id as drops; hidden (draft, no storefront access, missing) and too deep ones map to null. */
export async function loadEntryDrops(db: Db, shopId: number, ids: number[], depth = MAX_DEPTH, tr?: Translator): Promise<Map<number, EntryDrop | null>> {
  const out = new Map<number, EntryDrop | null>(ids.map((id) => [id, null]));
  if (!ids.length || depth <= 0) return out;
  const rows = await db.select({ e: s.metaobjects, d: s.metaobjectDefinitions }).from(s.metaobjects)
    .innerJoin(s.metaobjectDefinitions, eq(s.metaobjectDefinitions.id, s.metaobjects.definitionId)).where(and(eq(s.metaobjects.shopId, shopId), inArray(s.metaobjects.id, ids)));
  return buildDrops(db, shopId, rows.filter((r) => isVisible(r.d, r.e)), depth, out, tr);
}

async function buildDrops(db: Db, shopId: number, rows: { e: EntryRow; d: MetaobjectDefinition }[], depth: number, out: Map<number, EntryDrop | null>, tr?: Translator): Promise<Map<number, EntryDrop | null>> {
  const refs = emptyRefIds();
  for (const { e, d } of rows) for (const f of d.fieldDefinitions) { const v = e.values[f.key]; if (v) collectRefs(refs, f.type, v); }
  const lookup = await loadRefLookups(db, shopId, refs, depth - 1, tr);
  for (const { e, d } of rows) {
    const url = entryUrl(d, e);
    const system = { id: toGid('Metaobject', e.id), handle: e.handle, type: e.type, url, updated_at: e.updatedAt.toISOString(), created_at: e.createdAt.toISOString() };
    const drop: EntryDrop = { id: system.id, handle: e.handle, type: e.type, display_name: e.displayName, url, system };
    for (const f of d.fieldDefinitions) {
      let raw = e.values[f.key];
      if (raw === undefined || raw === '') continue;
      if (tr?.active && d.capTranslatable) raw = tr.get('METAOBJECT', e.id, f.key) ?? raw;
      if (f.key in drop && f.key !== 'url') continue;
      const mf: MetafieldObject = { ...valueObject(f.type, raw, lookup), namespace: e.type, key: f.key };
      drop[f.key] = mf;
    }
    drop.toString = () => e.displayName;
    out.set(e.id, drop);
  }
  return out;
}

/** `metaobjects` Liquid global: `metaobjects.<type>.<handle>` and `metaobjects.<type>.values`. */
export function metaobjectsGlobal(db: Db, shopId: number, tr?: Translator): unknown {
  return lazyMap(true, async (type) => {
    const def = await getMetaobjectDefinitionByType(db, shopId, type);
    if (!def || def.accessStorefront !== 'PUBLIC_READ') return null;
    const base: Record<string, unknown> = {};
    let list: Promise<(EntryDrop | null)[]> | null = null;
    Object.defineProperty(base, 'values', {
      enumerable: false,
      get: () => (list ??= (async () => {
        const rows = await db.select().from(s.metaobjects).where(and(eq(s.metaobjects.definitionId, def.id), def.capPublishable ? eq(s.metaobjects.status, 'ACTIVE') : undefined)).orderBy(asc(s.metaobjects.id)).limit(250);
        const drops = await loadEntryDrops(db, shopId, rows.map((r) => r.id), MAX_DEPTH, tr);
        return rows.map((r) => drops.get(r.id) ?? null).filter((x) => x != null);
      })()),
    });
    return lazyMap(true, async (handle) => {
      const [row] = await db.select().from(s.metaobjects).where(and(eq(s.metaobjects.definitionId, def.id), eq(s.metaobjects.handle, handle.toLowerCase())));
      return row ? (await loadEntryDrops(db, shopId, [row.id], MAX_DEPTH, tr)).get(row.id) ?? null : null;
    }, base);
  });
}

/** Parse a theme setting value (`shopify://metaobjects/<type>/<handle>`, `<type>/<handle>` or a GID) to an entry drop. */
export async function entryFromSetting(db: Db, shopId: number, value: string, tr?: Translator): Promise<EntryDrop | null> {
  const gid = /^gid:\/\/shopify\/Metaobject\/(\d+)$/.exec(value);
  if (gid) { const id = Number(gid[1]); return (await loadEntryDrops(db, shopId, [id], MAX_DEPTH, tr)).get(id) ?? null; }
  const m = /^(?:shopify:\/\/metaobjects\/)?([^/]+)\/([^/]+)$/.exec(value.trim());
  if (!m) return null;
  const def = await getMetaobjectDefinitionByType(db, shopId, m[1]!);
  if (!def) return null;
  const [row] = await db.select().from(s.metaobjects).where(and(eq(s.metaobjects.definitionId, def.id), eq(s.metaobjects.handle, m[2]!.toLowerCase())));
  return row ? (await loadEntryDrops(db, shopId, [row.id], MAX_DEPTH, tr)).get(row.id) ?? null : null;
}
