import { and, asc, eq } from 'drizzle-orm';
import { schema as s, type Db, type Translator } from '@shopme/core';
import { entryUrl, isVisible, loadEntryDrops } from './metaobjects';

/** The entry behind `/pages/<urlHandle>/<handle>` (online store capability, visible entries only) with its SEO fields. */
export async function metaobjectPage(db: Db, shopId: number, urlHandle: string, handle: string, tr?: Translator) {
  const [def] = await db.select().from(s.metaobjectDefinitions).where(and(eq(s.metaobjectDefinitions.shopId, shopId), eq(s.metaobjectDefinitions.onlineStoreUrlHandle, urlHandle), eq(s.metaobjectDefinitions.capOnlineStore, true)));
  if (!def) return null;
  const [row] = await db.select().from(s.metaobjects).where(and(eq(s.metaobjects.definitionId, def.id), eq(s.metaobjects.handle, handle.toLowerCase())));
  if (!row || !isVisible(def, row)) return null;
  const drop = (await loadEntryDrops(db, shopId, [row.id], undefined, tr)).get(row.id);
  if (!drop) return null;
  const text = (key: string | null) => (key && row.values[key] ? String(row.values[key]).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '');
  return { def, drop, templateSuffix: row.templateSuffix, title: text(def.renderableMetaTitleKey) || row.displayName, description: text(def.renderableMetaDescKey) };
}

/** Sitemap rows of published entries. */
export async function metaobjectSitemapEntries(db: Db, shopId: number) {
  const rows = await db.select({ e: s.metaobjects, d: s.metaobjectDefinitions }).from(s.metaobjects).innerJoin(s.metaobjectDefinitions, eq(s.metaobjectDefinitions.id, s.metaobjects.definitionId))
    .where(and(eq(s.metaobjects.shopId, shopId), eq(s.metaobjectDefinitions.capOnlineStore, true))).orderBy(asc(s.metaobjects.id));
  return rows.filter((r) => isVisible(r.d, r.e)).map((r) => ({ loc: entryUrl(r.d, r.e)!, lastmod: r.e.updatedAt }));
}
