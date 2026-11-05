import { and, asc, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import { articles, collections, fileFolders, files, media, productMedia, productVariants, products, themeFiles, themes } from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { errR, okR, txResult, type Result } from './common';
import type { Media } from './products';

const esc = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/** The Files library: every media row (product images included), newest first by default. */
export function listFiles(db: Executor, shopId: number, o: { query?: string | null; reverse?: boolean; offset: number; limit: number }): Promise<Media[]> {
  const terms = (o.query ?? '').trim();
  const mediaType = /(?:^|\s)media_type:(\w+)/i.exec(terms)?.[1]?.toUpperCase();
  const folder = /(?:^|\s)folder:(\w+)/i.exec(terms)?.[1]?.toLowerCase();
  const free = terms.replace(/(?:^|\s)\w+:\S+/g, ' ').trim();
  return db.select().from(media).where(and(
    eq(media.shopId, shopId), mediaType ? eq(media.type, mediaType) : undefined,
    folder === 'none' ? sql`${media.folderId} is null` : folder && /^\d+$/.test(folder) ? eq(media.folderId, Number(folder)) : undefined,
    free ? sql`(${ilike(media.alt, `%${esc(free)}%`)} or ${ilike(media.url, `%${esc(free)}%`)})` : undefined,
  )).orderBy(o.reverse ? asc(media.id) : desc(media.id)).limit(o.limit).offset(o.offset);
}

export async function updateFiles(db: Db, shopId: number, updates: { id: number; alt?: string | null; originalSource?: string | null }[]): Promise<Result<Media[]>> {
  return txResult(db, async (tx) => {
    const out: Media[] = [];
    for (const [i, u] of updates.entries()) {
      const [cur] = await tx.select().from(media).where(and(eq(media.shopId, shopId), eq(media.id, u.id)));
      if (!cur) return errR(['files', String(i), 'id'], 'File does not exist', 'FILE_DOES_NOT_EXIST');
      if (u.originalSource && !/^(https?:\/\/|\/files\/)/.test(u.originalSource)) return errR(['files', String(i), 'originalSource'], 'Invalid source URL', 'INVALID');
      const [row] = await tx.update(media).set({ ...(u.alt !== undefined && { alt: u.alt }), ...(u.originalSource && { url: u.originalSource }), updatedAt: new Date() }).where(eq(media.id, u.id)).returning();
      out.push(row!);
    }
    return okR(out);
  });
}

export async function deleteFiles(db: Db, shopId: number, ids: number[]): Promise<Result<number[]>> {
  const found = await db.select({ id: media.id }).from(media).where(and(eq(media.shopId, shopId), inArray(media.id, ids)));
  const missing = ids.findIndex((i) => !found.some((f) => f.id === i));
  if (missing >= 0) return errR(['fileIds', String(missing)], 'File does not exist', 'FILE_DOES_NOT_EXIST');
  await db.delete(media).where(and(eq(media.shopId, shopId), inArray(media.id, ids)));
  return okR(ids);
}

/* ------------------------------ size, references, folders ------------------------------ */

export type Folder = typeof fileFolders.$inferSelect;
export interface FileReference { type: 'PRODUCT' | 'COLLECTION' | 'ARTICLE' | 'THEME'; id: number | null; title: string }
export interface FileMeta { filename: string | null; byteSize: number | null; references: FileReference[] }

const lastSegment = (url: string | null) => decodeURIComponent((url ?? '').split(/[?#]/)[0]!.split('/').pop() ?? '');

/** Stored filename, byte size and the places each file is used (products, collections, articles, theme settings). */
export async function fileMeta(db: Executor, shopId: number, rows: Media[]): Promise<Map<number, FileMeta>> {
  const ids = rows.map((r) => r.id);
  const out = new Map<number, FileMeta>();
  if (!ids.length) return out;
  const fileIds = [...new Set(rows.flatMap((r) => (r.fileId ? [r.fileId] : [])))];
  const stored = fileIds.length ? await db.select().from(files).where(and(eq(files.shopId, shopId), inArray(files.id, fileIds))) : [];
  for (const r of rows) {
    const f = stored.find((x) => x.id === r.fileId);
    out.set(r.id, { filename: f?.filename ?? (lastSegment(r.url) || null), byteSize: f?.byteSize ?? null, references: [] });
  }
  const add = (mediaId: number, ref: FileReference) => {
    const refs = out.get(mediaId)!.references;
    if (!refs.some((x) => x.type === ref.type && x.id === ref.id)) refs.push(ref);
  };
  const [pm, vm, cm, am, themeBodies] = await Promise.all([
    db.select({ m: productMedia.mediaId, id: products.id, title: products.title }).from(productMedia).innerJoin(products, eq(products.id, productMedia.productId)).where(inArray(productMedia.mediaId, ids)),
    db.select({ m: productVariants.mediaId, id: products.id, title: products.title }).from(productVariants).innerJoin(products, eq(products.id, productVariants.productId)).where(inArray(productVariants.mediaId, ids)),
    db.select({ m: collections.imageMediaId, id: collections.id, title: collections.title }).from(collections).where(inArray(collections.imageMediaId, ids)),
    db.select({ m: articles.imageMediaId, id: articles.id, title: articles.title }).from(articles).where(inArray(articles.imageMediaId, ids)),
    db.select({ path: themeFiles.path, body: themeFiles.body }).from(themeFiles).innerJoin(themes, eq(themes.id, themeFiles.themeId))
      .where(and(eq(themeFiles.shopId, shopId), eq(themes.role, 'MAIN'), sql`(${themeFiles.path} = 'config/settings_data.json' or ${themeFiles.path} like 'templates/%.json' or ${themeFiles.path} like 'sections/%.json')`)),
  ]);
  for (const x of [...pm, ...vm]) if (x.m) add(x.m, { type: 'PRODUCT', id: x.id, title: x.title });
  for (const x of cm) if (x.m) add(x.m, { type: 'COLLECTION', id: x.id, title: x.title });
  for (const x of am) if (x.m) add(x.m, { type: 'ARTICLE', id: x.id, title: x.title });
  for (const r of rows) {
    const name = lastSegment(r.url);
    if (!name || (!r.url?.startsWith('/files/') && !r.fileId)) continue;
    for (const t of themeBodies) if (t.body?.includes(name)) add(r.id, { type: 'THEME', id: null, title: t.path });
  }
  return out;
}

export async function listFolders(db: Executor, shopId: number): Promise<Array<Folder & { fileCount: number }>> {
  const rows = await db.select().from(fileFolders).where(eq(fileFolders.shopId, shopId)).orderBy(asc(sql`lower(${fileFolders.name})`));
  const counts = await db.select({ id: media.folderId, n: sql<number>`count(*)::int` }).from(media).where(and(eq(media.shopId, shopId), sql`${media.folderId} is not null`)).groupBy(media.folderId);
  return rows.map((r) => ({ ...r, fileCount: counts.find((c) => c.id === r.id)?.n ?? 0 }));
}

export async function getFolder(db: Executor, shopId: number, id: number): Promise<Folder | null> {
  return (await db.select().from(fileFolders).where(and(eq(fileFolders.shopId, shopId), eq(fileFolders.id, id))))[0] ?? null;
}

const folderName = async (db: Executor, shopId: number, name: string, selfId?: number): Promise<Result<string>> => {
  const n = name.trim().replace(/\s+/g, ' ');
  if (!n) return errR(['name'], "Name can't be blank", 'BLANK');
  if (n.length > 100) return errR(['name'], 'Name is too long (maximum is 100 characters)', 'TOO_LONG');
  const [dup] = await db.select({ id: fileFolders.id }).from(fileFolders).where(and(eq(fileFolders.shopId, shopId), sql`lower(${fileFolders.name}) = ${n.toLowerCase()}`));
  return dup && dup.id !== selfId ? errR(['name'], 'A folder with this name already exists', 'TAKEN') : okR(n);
};

export async function createFolder(db: Db, shopId: number, name: string): Promise<Result<Folder>> {
  const n = await folderName(db, shopId, name);
  if (!n.ok) return n;
  const [row] = await db.insert(fileFolders).values({ shopId, name: n.value }).returning();
  return okR(row!);
}

export async function renameFolder(db: Db, shopId: number, id: number, name: string): Promise<Result<Folder>> {
  if (!(await getFolder(db, shopId, id))) return errR(['id'], 'Folder does not exist', 'NOT_FOUND');
  const n = await folderName(db, shopId, name, id);
  if (!n.ok) return n;
  const [row] = await db.update(fileFolders).set({ name: n.value }).where(eq(fileFolders.id, id)).returning();
  return okR(row!);
}

/** Only an empty folder can be deleted. */
export async function deleteFolder(db: Db, shopId: number, id: number): Promise<Result<number>> {
  if (!(await getFolder(db, shopId, id))) return errR(['id'], 'Folder does not exist', 'NOT_FOUND');
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(media).where(and(eq(media.shopId, shopId), eq(media.folderId, id)));
  if ((r?.n ?? 0) > 0) return errR(['id'], 'Folder is not empty', 'NOT_EMPTY');
  await db.delete(fileFolders).where(eq(fileFolders.id, id));
  return okR(id);
}

/** Move files into a folder (`folderId` null = library root). */
export async function moveFiles(db: Db, shopId: number, ids: number[], folderId: number | null): Promise<Result<Media[]>> {
  if (folderId != null && !(await getFolder(db, shopId, folderId))) return errR(['folderId'], 'Folder does not exist', 'NOT_FOUND');
  const found = await db.select({ id: media.id }).from(media).where(and(eq(media.shopId, shopId), inArray(media.id, ids)));
  const missing = ids.findIndex((i) => !found.some((f) => f.id === i));
  if (missing >= 0) return errR(['fileIds', String(missing)], 'File does not exist', 'FILE_DOES_NOT_EXIST');
  const rows = await db.update(media).set({ folderId, updatedAt: new Date() }).where(and(eq(media.shopId, shopId), inArray(media.id, ids))).returning();
  return okR(rows);
}
