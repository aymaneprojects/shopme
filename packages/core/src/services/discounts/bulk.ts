import { randomInt } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { discountCodeBulkCreations, discountCodes, discountExtensions, discounts } from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { buildSearch, compare, idTerm, likeCi } from '../catalog/search';
import { errR, okR, type Result } from '../catalog/common';
import { getCodeDiscount, type CodeDiscount } from './discounts';
import { cleanTags } from './eligibility';

export type DiscountCodeBulkCreation = typeof discountCodeBulkCreations.$inferSelect;
export type RedeemCodeRow = typeof discountCodes.$inferSelect;

/** `discountRedeemCodeBulkAdd` accepts at most this many codes per call. */
export const REDEEM_CODES_PER_CALL = 250;
/** Upper bound of one "generate codes" request. */
export const MAX_GENERATED_CODES = 10_000;
const MAX_CODE_LENGTH = 255;

export type CodeCharacterSet = 'ALPHANUMERIC' | 'LETTERS' | 'DIGITS' | 'UNAMBIGUOUS';
export const CODE_CHARACTER_SETS: Record<CodeCharacterSet, string> = {
  ALPHANUMERIC: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  LETTERS: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  DIGITS: '0123456789',
  /** No 0/O, 1/I/L: safe to read out loud or print on a card. */
  UNAMBIGUOUS: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',
};

export interface GenerateCodesInput { count: number; length: number; prefix?: string | null; suffix?: string | null; characterSet?: CodeCharacterSet | null }

/** Check a generation request. Field paths are the argument names of `shopmeDiscountCodesGenerate`. */
export function validateGenerateInput(i: GenerateCodesInput): Result<null> {
  const affix = /^[A-Za-z0-9_-]*$/;
  if (!Number.isInteger(i.count) || i.count < 1) return errR(['count'], 'Count must be greater than 0', 'GREATER_THAN');
  if (i.count > MAX_GENERATED_CODES) return errR(['count'], `Count must be at most ${MAX_GENERATED_CODES}`, 'EXCEEDED_MAX');
  if (!Number.isInteger(i.length) || i.length < 4) return errR(['length'], 'Length must be at least 4', 'TOO_SHORT');
  if (i.length > 32) return errR(['length'], 'Length must be at most 32', 'TOO_LONG');
  if (!affix.test(i.prefix ?? '')) return errR(['prefix'], 'Prefix can only contain letters, digits, hyphens and underscores', 'INVALID');
  if (!affix.test(i.suffix ?? '')) return errR(['suffix'], 'Suffix can only contain letters, digits, hyphens and underscores', 'INVALID');
  if ((i.prefix?.length ?? 0) + (i.suffix?.length ?? 0) + i.length > 64) return errR(['prefix'], 'Prefix, random part and suffix are too long together (maximum is 64 characters)', 'TOO_LONG');
  const set = CODE_CHARACTER_SETS[i.characterSet ?? 'ALPHANUMERIC'];
  // The pool must be comfortably larger than the request or collisions would make generation crawl.
  if (set.length ** i.length < i.count * 4) return errR(['length'], 'Length is too short to generate that many unique codes', 'TOO_SHORT');
  return okR(null);
}

/** `count` distinct upper-case codes: prefix + random characters + suffix. `taken` codes are never produced. */
export function generateCodes(i: GenerateCodesInput, taken: ReadonlySet<string> = new Set(), rand: (n: number) => number = randomInt): string[] {
  const set = CODE_CHARACTER_SETS[i.characterSet ?? 'ALPHANUMERIC'];
  const out = new Set<string>();
  const prefix = (i.prefix ?? '').toUpperCase();
  const suffix = (i.suffix ?? '').toUpperCase();
  while (out.size < i.count) {
    let body = '';
    for (let k = 0; k < i.length; k++) body += set[rand(set.length)];
    const code = `${prefix}${body}${suffix}`;
    if (!taken.has(code)) out.add(code);
  }
  return [...out];
}

type CodeError = { field: string[]; message: string; code: string };
const normalize = (raw: string) => raw.trim().toUpperCase();

function checkCode(code: string): CodeError | null {
  if (!code) return { field: ['code'], message: "Code can't be blank", code: 'BLANK' };
  if (code.length > MAX_CODE_LENGTH) return { field: ['code'], message: `Code is too long (maximum is ${MAX_CODE_LENGTH} characters)`, code: 'TOO_LONG' };
  if (/\s{2,}|[\r\n]/.test(code)) return { field: ['code'], message: 'Code is invalid', code: 'INVALID' };
  return null;
}

/**
 * Add many redeem codes to a code discount and record the per-code outcome (`discountRedeemCodeBulkCreation`). Invalid or
 * already used codes are reported on their row; the rest are inserted. Work is done in the call, so the record is `done` on return.
 */
export async function addRedeemCodes(db: Db, shopId: number, discountId: number, rawCodes: string[], max = REDEEM_CODES_PER_CALL): Promise<Result<DiscountCodeBulkCreation>> {
  const d = await getCodeDiscount(db, shopId, discountId, 'CODE');
  if (!d) return errR(['discountId'], 'Discount does not exist', 'INVALID');
  if (!rawCodes.length) return errR(['codes'], 'At least one code is required', 'BLANK');
  if (rawCodes.length > max) return errR(['codes'], `A maximum of ${max} codes can be added at once`, 'EXCEEDED_MAX');

  const codes = rawCodes.map(normalize);
  const existing = new Set<string>();
  const valid = [...new Set(codes.filter((c) => !checkCode(c)))];
  for (let i = 0; i < valid.length; i += 1000) {
    const rows = await db.select({ code: discountCodes.code }).from(discountCodes).where(and(eq(discountCodes.shopId, shopId), inArray(discountCodes.code, valid.slice(i, i + 1000))));
    for (const r of rows) existing.add(r.code);
  }
  const seen = new Set<string>();
  const results: DiscountCodeBulkCreation['results'] = [];
  const toInsert: string[] = [];
  for (const code of codes) {
    const bad = checkCode(code);
    if (bad) results.push({ code, codeId: null, errors: [bad] });
    else if (existing.has(code) || seen.has(code)) results.push({ code, codeId: null, errors: [{ field: ['code'], message: 'Discount code must be unique. Please try a different code.', code: 'TAKEN' }] });
    else { seen.add(code); toInsert.push(code); results.push({ code, codeId: null, errors: [] }); }
  }
  const ids = new Map<string, number>();
  for (let i = 0; i < toInsert.length; i += 500) {
    const rows = await db.insert(discountCodes).values(toInsert.slice(i, i + 500).map((code) => ({ shopId, discountId, code }))).onConflictDoNothing().returning({ id: discountCodes.id, code: discountCodes.code });
    for (const r of rows) ids.set(r.code, r.id);
  }
  for (const r of results) {
    if (r.errors.length) continue;
    const id = ids.get(r.code);
    if (id) r.codeId = id;
    else r.errors.push({ field: ['code'], message: 'Discount code must be unique. Please try a different code.', code: 'TAKEN' });
  }
  const failed = results.filter((r) => r.errors.length).length;
  const [row] = await db.insert(discountCodeBulkCreations).values({
    shopId, discountId, codesCount: results.length, importedCount: results.length - failed, failedCount: failed, done: true, results, completedAt: new Date(),
  }).returning();
  await db.update(discounts).set({ updatedAt: new Date() }).where(eq(discounts.id, discountId));
  return okR(row!);
}

/** Generate and add codes (admin "Generate codes"). */
export async function generateRedeemCodes(db: Db, shopId: number, discountId: number, i: GenerateCodesInput): Promise<Result<DiscountCodeBulkCreation>> {
  const v = validateGenerateInput(i);
  if (!v.ok) return v;
  if (!(await getCodeDiscount(db, shopId, discountId, 'CODE'))) return errR(['discountId'], 'Discount does not exist', 'INVALID');
  const taken = new Set<string>();
  let codes: string[] = [];
  // Draw, drop codes that already exist, and top up until the full count is met (a few rounds at most).
  for (let round = 0; round < 5 && codes.length < i.count; round++) {
    const batch = generateCodes({ ...i, count: i.count - codes.length }, new Set([...taken, ...codes]));
    for (let k = 0; k < batch.length; k += 1000) {
      const rows = await db.select({ code: discountCodes.code }).from(discountCodes).where(and(eq(discountCodes.shopId, shopId), inArray(discountCodes.code, batch.slice(k, k + 1000))));
      for (const r of rows) taken.add(r.code);
    }
    codes = [...codes, ...batch.filter((c) => !taken.has(c))];
  }
  return addRedeemCodes(db, shopId, discountId, codes, MAX_GENERATED_CODES);
}

export async function getCodeBulkCreation(db: Executor, shopId: number, id: number): Promise<DiscountCodeBulkCreation | null> {
  const [r] = await db.select().from(discountCodeBulkCreations).where(and(eq(discountCodeBulkCreations.shopId, shopId), eq(discountCodeBulkCreations.id, id))).limit(1);
  return r ?? null;
}

export async function getRedeemCodes(db: Executor, shopId: number, ids: number[]): Promise<RedeemCodeRow[]> {
  return ids.length ? db.select().from(discountCodes).where(and(eq(discountCodes.shopId, shopId), inArray(discountCodes.id, ids))) : [];
}

const codeSearch = (q: string | null | undefined) => buildSearch(q, {
  fields: { code: (_o, v) => likeCi(discountCodes.code, v), id: (_o, v) => idTerm(discountCodes.id, v), times_used: (op, v) => (Number.isFinite(Number(v)) ? compare(discountCodes.usageCount, op, Number(v)) : null) },
  text: (v) => likeCi(discountCodes.code, v),
});

/** Redeem codes of one discount, or of every code discount when `discountId` is null. */
export async function listRedeemCodes(db: Executor, shopId: number, o: { discountId?: number | null; query?: string | null; reverse?: boolean; offset: number; limit: number }): Promise<RedeemCodeRow[]> {
  const dir = o.reverse ? desc : asc;
  return db.select().from(discountCodes)
    .where(and(eq(discountCodes.shopId, shopId), o.discountId ? eq(discountCodes.discountId, o.discountId) : undefined, codeSearch(o.query))).orderBy(dir(discountCodes.id)).limit(o.limit).offset(o.offset);
}

export async function countRedeemCodes(db: Executor, shopId: number, o: { discountId?: number | null; query?: string | null; limit?: number }): Promise<{ count: number; precision: 'EXACT' | 'AT_LEAST' }> {
  const limit = o.limit ?? 10000;
  const rows = await db.select({ id: discountCodes.id }).from(discountCodes)
    .where(and(eq(discountCodes.shopId, shopId), o.discountId ? eq(discountCodes.discountId, o.discountId) : undefined, codeSearch(o.query))).limit(limit + 1);
  return rows.length > limit ? { count: limit, precision: 'AT_LEAST' } : { count: rows.length, precision: 'EXACT' };
}

/** Delete redeem codes of a discount. At least one code must remain. Returns the number deleted. */
export async function deleteRedeemCodes(db: Db, shopId: number, discountId: number, codeIds: number[]): Promise<Result<number>> {
  const d = await getCodeDiscount(db, shopId, discountId, 'CODE');
  if (!d) return errR(['discountId'], 'Discount does not exist', 'INVALID');
  const rows = codeIds.length ? await db.select({ id: discountCodes.id }).from(discountCodes).where(and(eq(discountCodes.discountId, discountId), inArray(discountCodes.id, codeIds))) : [];
  if (!rows.length) return okR(0);
  if (rows.length >= d.codeCount) return errR(['ids'], 'A discount needs at least one code. Delete the discount instead.', 'INVALID');
  await db.delete(discountCodes).where(inArray(discountCodes.id, rows.map((r) => r.id)));
  await db.update(discounts).set({ updatedAt: new Date() }).where(eq(discounts.id, discountId));
  return okR(rows.length);
}

/** Add or remove tags on many discounts (code and automatic). */
export async function changeDiscountTags(db: Db, shopId: number, ids: number[], mode: 'add' | 'remove', tags: string[]): Promise<void> {
  const wanted = cleanTags(tags);
  for (const id of ids) {
    const cur = await getCodeDiscount(db, shopId, id, null);
    if (!cur) continue;
    const have = cur.ext.tags;
    const next = mode === 'add' ? cleanTags([...have, ...wanted]) : have.filter((t) => !wanted.some((w) => w.toLowerCase() === t.toLowerCase()));
    await db.insert(discountExtensions).values({ discountId: id, shopId, subtype: cur.ext.subtype, combinesWith: cur.ext.combinesWith, bxgy: cur.ext.bxgy, eligibility: cur.ext.eligibility, segmentIds: cur.ext.segmentIds, customerIds: cur.ext.customerIds, tags: next })
      .onConflictDoUpdate({ target: discountExtensions.discountId, set: { tags: next } });
    await db.update(discounts).set({ updatedAt: new Date() }).where(eq(discounts.id, id));
  }
}

/** Distinct discount tags, alphabetical (or by id order of first use). */
export async function listDiscountTags(db: Executor, shopId: number, q?: string | null): Promise<string[]> {
  const rows = await db.execute(sql`select distinct t as tag from discount_extensions e, unnest(e.tags) t where e.shop_id = ${shopId} ${q?.trim() ? sql`and t ilike ${`%${q.trim()}%`}` : sql``} order by 1`);
  const list = ((rows as { rows?: { tag: string }[] }).rows ?? (rows as unknown as { tag: string }[]));
  return list.map((r) => r.tag);
}

export type { CodeDiscount };
