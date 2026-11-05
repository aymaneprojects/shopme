import { randomInt } from 'node:crypto';
import { and, desc, eq, isNull, lt } from 'drizzle-orm';
import { customerLoginCodes, customers } from '../../db/schema';
import type { Db } from '../../db/client';
import { addEvent } from '../events';
import { safeEqual, sha256 } from '../crypto';
import type { Customer } from '../customers/customers';

/** Passwordless sign-in: a 6-digit code mailed to the customer. 10 minutes, 5 attempts, one new code every 30 seconds. */
export const LOGIN_CODE_TTL_MS = 10 * 60 * 1000;
export const LOGIN_CODE_RESEND_MS = 30 * 1000;
export const LOGIN_CODE_MAX_ATTEMPTS = 5;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const lc = (e: string) => e.trim().toLowerCase();
const hashOf = (shopId: number, email: string, code: string) => sha256(`${shopId}:${email}:${code}`);

export type LoginCodeRequest = { ok: true; email: string; code: string; expiresAt: Date } | { ok: false; reason: 'invalid_email' | 'too_soon' };

/** Issue a code for an email (earlier unused codes stop working). Nothing is created for the customer until the code is proven. */
export async function requestLoginCode(db: Db, shopId: number, rawEmail: string, now = new Date()): Promise<LoginCodeRequest> {
  const email = lc(rawEmail);
  if (!EMAIL_RE.test(email)) return { ok: false, reason: 'invalid_email' };
  const [last] = await db.select().from(customerLoginCodes).where(and(eq(customerLoginCodes.shopId, shopId), eq(customerLoginCodes.email, email))).orderBy(desc(customerLoginCodes.id)).limit(1);
  if (last && !last.consumedAt && now.getTime() - last.createdAt.getTime() < LOGIN_CODE_RESEND_MS) return { ok: false, reason: 'too_soon' };
  await db.update(customerLoginCodes).set({ consumedAt: now }).where(and(eq(customerLoginCodes.shopId, shopId), eq(customerLoginCodes.email, email), isNull(customerLoginCodes.consumedAt)));
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const expiresAt = new Date(now.getTime() + LOGIN_CODE_TTL_MS);
  await db.insert(customerLoginCodes).values({ shopId, email, codeHash: hashOf(shopId, email, code), expiresAt, createdAt: now });
  return { ok: true, email, code, expiresAt };
}

export type LoginCodeResult = { ok: true; customer: Customer } | { ok: false; reason: 'invalid' | 'expired' | 'locked' };

/** Check a code. Success finds or creates the customer (their email is now verified) and burns the code. */
export async function verifyLoginCode(db: Db, shopId: number, rawEmail: string, rawCode: string, now = new Date()): Promise<LoginCodeResult> {
  const email = lc(rawEmail);
  const code = rawCode.replace(/\s+/g, '');
  const [row] = await db.select().from(customerLoginCodes).where(and(eq(customerLoginCodes.shopId, shopId), eq(customerLoginCodes.email, email), isNull(customerLoginCodes.consumedAt)))
    .orderBy(desc(customerLoginCodes.id)).limit(1);
  if (!row) return { ok: false, reason: 'invalid' };
  if (row.expiresAt <= now) return { ok: false, reason: 'expired' };
  if (row.attempts >= LOGIN_CODE_MAX_ATTEMPTS) return { ok: false, reason: 'locked' };
  if (!/^\d{6}$/.test(code) || !safeEqual(row.codeHash, hashOf(shopId, email, code))) {
    const attempts = row.attempts + 1;
    await db.update(customerLoginCodes).set({ attempts, ...(attempts >= LOGIN_CODE_MAX_ATTEMPTS ? { consumedAt: now } : {}) }).where(eq(customerLoginCodes.id, row.id));
    return { ok: false, reason: attempts >= LOGIN_CODE_MAX_ATTEMPTS ? 'locked' : 'invalid' };
  }
  const burned = await db.update(customerLoginCodes).set({ consumedAt: now }).where(and(eq(customerLoginCodes.id, row.id), isNull(customerLoginCodes.consumedAt))).returning({ id: customerLoginCodes.id });
  if (!burned.length) return { ok: false, reason: 'invalid' };
  const [existing] = await db.select().from(customers).where(and(eq(customers.shopId, shopId), eq(customers.email, email))).limit(1);
  if (existing) {
    const [row2] = await db.update(customers).set({ verifiedEmail: true, state: 'ENABLED', lastLoginAt: now, updatedAt: now }).where(eq(customers.id, existing.id)).returning();
    return { ok: true, customer: row2! };
  }
  const [created] = await db.insert(customers).values({ shopId, email, state: 'ENABLED', verifiedEmail: true, lastLoginAt: now }).returning();
  await addEvent(db, shopId, { subjectType: 'customer', subjectId: created!.id, verb: 'customers/create', message: 'Customer signed in with an email code' });
  return { ok: true, customer: created! };
}

/** Delete codes that can no longer be used (called by the hourly maintenance job). */
export async function purgeLoginCodes(db: Db, now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - 24 * 3600 * 1000);
  await db.delete(customerLoginCodes).where(lt(customerLoginCodes.expiresAt, cutoff));
}
