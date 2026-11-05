import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { urlRedirects } from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { buildSearch, dateCompare, idTerm, likeCi } from '../catalog/search';
import { errR, okR, type Result } from '../catalog/common';

export type UrlRedirect = typeof urlRedirects.$inferSelect;

const search = (q?: string | null) => buildSearch(q, {
  fields: { path: (_o, v) => likeCi(urlRedirects.path, v), target: (_o, v) => likeCi(urlRedirects.target, v), id: (_o, v) => idTerm(urlRedirects.id, v), created_at: (op, v) => dateCompare(urlRedirects.createdAt, op, v) },
  text: (v) => sql`(${likeCi(urlRedirects.path, v)} or ${likeCi(urlRedirects.target, v)})`,
});

export async function getUrlRedirect(db: Executor, shopId: number, id: number): Promise<UrlRedirect | null> {
  return (await db.select().from(urlRedirects).where(and(eq(urlRedirects.shopId, shopId), eq(urlRedirects.id, id))))[0] ?? null;
}

export function listUrlRedirects(db: Executor, shopId: number, o: { query?: string | null; sortKey?: string; reverse?: boolean; offset: number; limit: number }): Promise<UrlRedirect[]> {
  const col = ({ CREATED_AT: urlRedirects.createdAt, PATH: sql`lower(${urlRedirects.path})` } as Record<string, unknown>)[o.sortKey ?? 'ID'] ?? urlRedirects.id;
  const dir = o.reverse ? desc : asc;
  return db.select().from(urlRedirects).where(and(eq(urlRedirects.shopId, shopId), search(o.query))).orderBy(dir(col as never), dir(urlRedirects.id)).limit(o.limit).offset(o.offset);
}

export async function countUrlRedirects(db: Executor, shopId: number, query?: string | null, limit = 10000): Promise<{ count: number; precision: 'EXACT' | 'AT_LEAST' }> {
  const rows = await db.select({ id: urlRedirects.id }).from(urlRedirects).where(and(eq(urlRedirects.shopId, shopId), search(query))).limit(limit + 1);
  return rows.length > limit ? { count: limit, precision: 'AT_LEAST' } : { count: rows.length, precision: 'EXACT' };
}

export interface UrlRedirectInput { path?: string | null; target?: string | null }

const ABSOLUTE = /^https?:\/\/\S+$/i;
const normPath = (p: string) => (p.startsWith('/') ? p : `/${p}`).trim();

function validate(i: UrlRedirectInput, creating: boolean): Result<{ path?: string; target?: string }> {
  const out: { path?: string; target?: string } = {};
  if (creating || i.path !== undefined) {
    if (!i.path?.trim()) return errR(['path'], "Path can't be blank", 'CREATE_FAILED');
    const p = normPath(i.path.trim());
    if (/\s/.test(p) || p.length > 1024) return errR(['path'], 'Path is invalid', 'CREATE_FAILED');
    out.path = p;
  }
  if (creating || i.target !== undefined) {
    if (!i.target?.trim()) return errR(['target'], "Target can't be blank", 'CREATE_FAILED');
    const t = i.target.trim();
    if (!t.startsWith('/') && !ABSOLUTE.test(t)) return errR(['target'], 'Target must start with / or be a full URL', 'CREATE_FAILED');
    out.target = t;
  }
  if (out.path && out.target && out.path.toLowerCase() === out.target.toLowerCase()) return errR(['target'], 'Target cannot be the same as the path', 'CREATE_FAILED');
  return okR(out);
}

const taken = async (db: Executor, shopId: number, path: string, exceptId?: number) => {
  const [r] = await db.select({ id: urlRedirects.id }).from(urlRedirects).where(and(eq(urlRedirects.shopId, shopId), sql`lower(${urlRedirects.path}) = ${path.toLowerCase()}`)).limit(1);
  return !!r && r.id !== exceptId;
};

export async function createUrlRedirect(db: Db, shopId: number, i: UrlRedirectInput): Promise<Result<UrlRedirect>> {
  const v = validate(i, true);
  if (!v.ok) return v;
  if (await taken(db, shopId, v.value.path!)) return errR(['path'], 'Path has already been taken', 'CREATE_FAILED');
  const [row] = await db.insert(urlRedirects).values({ shopId, path: v.value.path!, target: v.value.target! }).returning();
  return okR(row!);
}

export async function updateUrlRedirect(db: Db, shopId: number, id: number, i: UrlRedirectInput): Promise<Result<UrlRedirect>> {
  const cur = await getUrlRedirect(db, shopId, id);
  if (!cur) return errR(['id'], 'Redirect does not exist', 'DOES_NOT_EXIST');
  const v = validate({ path: i.path ?? cur.path, target: i.target ?? cur.target }, false);
  if (!v.ok) return { ok: false, errors: v.errors.map((e) => ({ ...e, code: 'UPDATE_FAILED' })) };
  if (i.path != null && (await taken(db, shopId, v.value.path!, id))) return errR(['path'], 'Path has already been taken', 'UPDATE_FAILED');
  const [row] = await db.update(urlRedirects).set({ ...(i.path != null && { path: v.value.path }), ...(i.target != null && { target: v.value.target }) }).where(eq(urlRedirects.id, id)).returning();
  return okR(row!);
}

export async function deleteUrlRedirect(db: Db, shopId: number, id: number): Promise<Result<number>> {
  if (!(await getUrlRedirect(db, shopId, id))) return errR(['id'], 'Redirect does not exist', 'DOES_NOT_EXIST');
  await db.delete(urlRedirects).where(eq(urlRedirects.id, id));
  return okR(id);
}

/** The redirect for a request path (case-insensitive), or null. */
export async function findRedirect(db: Executor, shopId: number, path: string): Promise<UrlRedirect | null> {
  const [r] = await db.select().from(urlRedirects).where(and(eq(urlRedirects.shopId, shopId), sql`lower(${urlRedirects.path}) = ${path.toLowerCase()}`)).limit(1);
  return r ?? null;
}

/**
 * Called by services when a handle changes: `/products/old` -> `/products/new`. Earlier redirects that pointed at the old
 * path are re-pointed (no chains), and a redirect that would shadow the new path is dropped.
 */
export async function redirectPathChange(db: Executor, shopId: number, from: string, to: string): Promise<void> {
  if (from === to) return;
  await db.delete(urlRedirects).where(and(eq(urlRedirects.shopId, shopId), sql`lower(${urlRedirects.path}) = ${to.toLowerCase()}`));
  await db.update(urlRedirects).set({ target: to }).where(and(eq(urlRedirects.shopId, shopId), eq(urlRedirects.target, from)));
  await db.insert(urlRedirects).values({ shopId, path: from, target: to }).onConflictDoUpdate({ target: [urlRedirects.shopId, urlRedirects.path], set: { target: to } });
}
