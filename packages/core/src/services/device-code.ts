import { createHmac, randomInt } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { accountLoginCodes } from '../db/schema';
import type { Executor } from '../db/client';
import { safeEqual, sha256 } from './crypto';

/** E-mail sign-in code: 6 random digits, stored hashed, single use. */
export const DEVICE_CODE_TTL_MS = 10 * 60 * 1000;
export const DEVICE_CODE_MAX_TRIES = 5;
/** Minimum time between two codes sent to the same account. */
export const DEVICE_CODE_RESEND_MS = 30 * 1000;
/** How long a browser stays trusted after a successful code. */
export const TRUSTED_DEVICE_TTL_MS = 90 * 24 * 3600 * 1000;

const hashOf = (accountId: number, code: string) => sha256(`login-code:${accountId}:${code}`);

export type IssuedCode = { ok: true; code: string; expiresAt: Date } | { ok: false; retryAfter: number };

/** Create a fresh code (replacing any live one), unless one was sent less than `DEVICE_CODE_RESEND_MS` ago. */
export async function issueDeviceCode(db: Executor, accountId: number, now = new Date()): Promise<IssuedCode> {
  const [cur] = await db.select().from(accountLoginCodes).where(eq(accountLoginCodes.accountId, accountId));
  if (cur && now.getTime() - cur.sentAt.getTime() < DEVICE_CODE_RESEND_MS) return { ok: false, retryAfter: Math.ceil((DEVICE_CODE_RESEND_MS - (now.getTime() - cur.sentAt.getTime())) / 1000) };
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const expiresAt = new Date(now.getTime() + DEVICE_CODE_TTL_MS);
  const values = { codeHash: hashOf(accountId, code), expiresAt, attempts: 0, sentAt: now };
  await db.insert(accountLoginCodes).values({ accountId, ...values }).onConflictDoUpdate({ target: accountLoginCodes.accountId, set: values });
  return { ok: true, code, expiresAt };
}

export type CodeCheck = 'ok' | 'invalid' | 'expired' | 'locked';

/** Check a code. A right code is consumed; a wrong one counts as a try, and after `DEVICE_CODE_MAX_TRIES` the code is dead (a new one is needed). */
export async function verifyDeviceCode(db: Executor, accountId: number, input: string, now = new Date()): Promise<CodeCheck> {
  const [row] = await db.select().from(accountLoginCodes).where(eq(accountLoginCodes.accountId, accountId));
  if (!row) return 'expired';
  if (row.expiresAt <= now) { await db.delete(accountLoginCodes).where(eq(accountLoginCodes.accountId, accountId)); return 'expired'; }
  if (row.attempts >= DEVICE_CODE_MAX_TRIES) return 'locked';
  const code = input.replace(/\s/g, '');
  if (/^\d{6}$/.test(code) && safeEqual(row.codeHash, hashOf(accountId, code))) {
    await db.delete(accountLoginCodes).where(eq(accountLoginCodes.accountId, accountId));
    return 'ok';
  }
  await db.update(accountLoginCodes).set({ attempts: row.attempts + 1 }).where(eq(accountLoginCodes.accountId, accountId));
  return row.attempts + 1 >= DEVICE_CODE_MAX_TRIES ? 'locked' : 'invalid';
}

// ---- trusted devices (signed cookie value, bound to the current password) -------------------------------------------------------------

/** Value of the trusted-device cookie of an account. It stops matching when the password changes, which revokes every trusted browser. */
export const trustedDeviceValue = (account: { id: number; passwordHash: string }) => `td1.${account.id}.${createHmac('sha256', account.passwordHash).update(`trusted-device:${account.id}`).digest('base64url').slice(0, 22)}`;
export const isTrustedDevice = (account: { id: number; passwordHash: string }, value: string | undefined | null) => !!value && safeEqual(value, trustedDeviceValue(account));
