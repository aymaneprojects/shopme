import type { UserError } from '@shopme/shopify-compat';
import type { Db, Executor, Tx } from '../../db/client';
import { addEvent } from '../events';

/** Service result: validation problems come back as data (userErrors at the API edge). Field paths are relative to the input. */
export type Result<T> = { ok: true; value: T } | { ok: false; errors: UserError[] };
export const okR = <T>(value: T): Result<T> => ({ ok: true, value });
export const errR = (field: string | string[] | null, message: string, code?: string): Result<never> => ({
  ok: false,
  errors: [{ field: field === null ? null : Array.isArray(field) ? field : field.split('.'), message, ...(code ? { code } : {}) }],
});

/** Conversion factors to kilograms. */
export const WEIGHT_KG: Record<string, number> = { KILOGRAMS: 1, GRAMS: 0.001, POUNDS: 0.45359237, OUNCES: 0.028349523125 };

/** Trim, drop empties, dedupe case-insensitively, sort (the Admin API returns tags alphabetically). */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Map<string, string>();
  for (const t of tags.flatMap((x) => x.split(','))) {
    const v = t.trim();
    if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v.slice(0, 255));
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** Domain event for later webhook delivery (topic style verb, e.g. `products/create`). Stored in the events table. */
export function emit(db: Executor, shopId: number, subjectType: string, subjectId: number, verb: string, data: Record<string, unknown> = {}) {
  return addEvent(db, shopId, { subjectType, subjectId, verb, data });
}

class Rollback extends Error { constructor(readonly result: Result<never>) { super('rollback'); } }

/** Run `fn` in a transaction; a failed Result rolls everything back and is returned as data. */
export async function txResult<T>(db: Db, fn: (tx: Tx) => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await db.transaction(async (tx) => {
      const r = await fn(tx);
      if (!r.ok) throw new Rollback(r);
      return r;
    });
  } catch (e) {
    if (e instanceof Rollback) return e.result;
    throw e;
  }
}
