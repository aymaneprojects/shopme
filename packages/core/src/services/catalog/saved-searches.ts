import { and, asc, eq, sql } from 'drizzle-orm';
import { savedSearches, SAVED_SEARCH_TYPES } from '../../db/schema';
import type { Db } from '../../db/client';
import { errR, okR, type Result } from './common';

/** Saved views of the admin lists: named searches shared by every staff member of the shop. */
export type SavedSearch = typeof savedSearches.$inferSelect;
export type SavedSearchType = (typeof SAVED_SEARCH_TYPES)[number];
export const isSavedSearchType = (t: string): t is SavedSearchType => (SAVED_SEARCH_TYPES as readonly string[]).includes(t);

export interface SavedSearchInput { resourceType?: string | null; name?: string | null; query?: string | null; params?: string | null }

const MAX_VIEWS_PER_LIST = 50;

export async function listSavedSearches(db: Db, shopId: number, resourceType: SavedSearchType, o: { reverse?: boolean; offset?: number; limit?: number } = {}): Promise<SavedSearch[]> {
  const order = o.reverse ? [sql`${savedSearches.position} desc`, sql`${savedSearches.id} desc`] : [asc(savedSearches.position), asc(savedSearches.id)];
  return db.select().from(savedSearches).where(and(eq(savedSearches.shopId, shopId), eq(savedSearches.resourceType, resourceType))).orderBy(...order).offset(o.offset ?? 0).limit(o.limit ?? 250);
}

export async function getSavedSearch(db: Db, shopId: number, id: number): Promise<SavedSearch | null> {
  const [row] = await db.select().from(savedSearches).where(and(eq(savedSearches.shopId, shopId), eq(savedSearches.id, id)));
  return row ?? null;
}

function checkName(name: string | null | undefined): Result<string> {
  const v = name?.trim() ?? '';
  if (!v) return errR(['name'], "Name can't be blank", 'BLANK');
  if (v.length > 40) return errR(['name'], 'Name is too long (maximum is 40 characters)', 'TOO_LONG');
  return okR(v);
}

export async function createSavedSearch(db: Db, shopId: number, input: SavedSearchInput, staffId?: number | null): Promise<Result<SavedSearch>> {
  if (!input.resourceType || !isSavedSearchType(input.resourceType)) return errR(['resourceType'], 'Resource type is not supported', 'INVALID');
  const name = checkName(input.name);
  if (!name.ok) return name;
  const existing = await listSavedSearches(db, shopId, input.resourceType);
  if (existing.length >= MAX_VIEWS_PER_LIST) return errR(['resourceType'], `A list can have at most ${MAX_VIEWS_PER_LIST} saved views`, 'TOO_MANY');
  if (existing.some((s) => s.name.toLowerCase() === name.value.toLowerCase())) return errR(['name'], 'Name has already been taken', 'TAKEN');
  const [row] = await db.insert(savedSearches).values({
    shopId, resourceType: input.resourceType, name: name.value, query: input.query?.trim() ?? '', params: input.params ?? '',
    position: existing.reduce((n, s) => Math.max(n, s.position), 0) + 1, createdBy: staffId ?? null,
  }).returning();
  return okR(row!);
}

export async function updateSavedSearch(db: Db, shopId: number, id: number, input: Omit<SavedSearchInput, 'resourceType'>): Promise<Result<SavedSearch>> {
  const cur = await getSavedSearch(db, shopId, id);
  if (!cur) return errR(['id'], 'Saved search does not exist', 'DOES_NOT_EXIST');
  const patch: Partial<typeof savedSearches.$inferInsert> = {};
  if (input.name != null) {
    const name = checkName(input.name);
    if (!name.ok) return name;
    const clash = (await listSavedSearches(db, shopId, cur.resourceType as SavedSearchType)).some((s) => s.id !== id && s.name.toLowerCase() === name.value.toLowerCase());
    if (clash) return errR(['name'], 'Name has already been taken', 'TAKEN');
    patch.name = name.value;
  }
  if (input.query != null) patch.query = input.query.trim();
  if (input.params != null) patch.params = input.params;
  const [row] = await db.update(savedSearches).set(patch).where(and(eq(savedSearches.shopId, shopId), eq(savedSearches.id, id))).returning();
  return okR(row!);
}

export async function deleteSavedSearch(db: Db, shopId: number, id: number): Promise<Result<{ id: number }>> {
  const rows = await db.delete(savedSearches).where(and(eq(savedSearches.shopId, shopId), eq(savedSearches.id, id))).returning({ id: savedSearches.id });
  return rows.length ? okR({ id }) : errR(['id'], 'Saved search does not exist', 'DOES_NOT_EXIST');
}
