import { and, asc, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import { media } from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { errR, okR, txResult, type Result } from './common';
import type { Media } from './products';

const esc = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/** The Files library: every media row (product images included), newest first by default. */
export function listFiles(db: Executor, shopId: number, o: { query?: string | null; reverse?: boolean; offset: number; limit: number }): Promise<Media[]> {
  const terms = (o.query ?? '').trim();
  const mediaType = /(?:^|\s)media_type:(\w+)/i.exec(terms)?.[1]?.toUpperCase();
  const free = terms.replace(/(?:^|\s)\w+:\S+/g, ' ').trim();
  return db.select().from(media).where(and(
    eq(media.shopId, shopId), mediaType ? eq(media.type, mediaType) : undefined,
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
