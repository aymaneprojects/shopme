import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { and, eq, ne } from 'drizzle-orm';
import { sessions, shops, staffTwoFactor } from '../db/schema';
import type { Executor } from '../db/client';
import { safeEqual, sha256 } from './crypto';

// ---- TOTP (RFC 6238, HMAC-SHA1, 6 digits, 30 s) -------------------------------------------------------------------------------

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of s.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** The 6-digit code of `secret` (base32) at time `ms`. */
export function totpCode(secret: string, ms = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(ms / 30000)));
  const h = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1]! & 15;
  const bin = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(bin % 1_000_000).padStart(6, '0');
}
/** Accepts the current code and one step either side (clock drift). */
export function verifyTotp(secret: string, code: string, ms = Date.now()): boolean {
  const c = code.replace(/\s/g, '');
  return /^\d{6}$/.test(c) && [-1, 0, 1].some((d) => safeEqual(totpCode(secret, ms + d * 30000), c));
}
export const newTotpSecret = () => base32Encode(randomBytes(20));
export const otpauthUri = (secret: string, account: string, issuer: string) =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

// ---- secret encryption (AES-256-GCM, key derived from the session secret) -------------------------------------------------------

const keyOf = (secret: string) => createHash('sha256').update(`${secret}:2fa`).digest();
export function encryptSecret(plain: string, key: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyOf(key), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64url')).join('.');
}
export function decryptSecret(blob: string, key: string): string | null {
  try {
    const [iv, tag, enc] = blob.split('.').map((p) => Buffer.from(p, 'base64url')) as [Buffer, Buffer, Buffer];
    const d = createDecipheriv('aes-256-gcm', keyOf(key), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch { return null; }
}

// ---- enrolment ---------------------------------------------------------------------------------------------------------------------

export interface TwoFactorUser { id: number; shopId: number }
const RECOVERY_COUNT = 10;
const newRecoveryCodes = () => Array.from({ length: RECOVERY_COUNT }, () => { const r = randomBytes(5).toString('hex'); return `${r.slice(0, 5)}-${r.slice(5)}`; });
const normCode = (c: string) => c.trim().toLowerCase().replace(/\s/g, '');

export async function twoFactorStatus(db: Executor, userId: number): Promise<{ enabled: boolean; recoveryCodesLeft: number }> {
  const [r] = await db.select().from(staffTwoFactor).where(eq(staffTwoFactor.staffUserId, userId));
  return { enabled: !!r?.enabled, recoveryCodesLeft: r?.enabled ? r.recoveryCodes.length : 0 };
}
export const isTwoFactorEnabled = async (db: Executor, userId: number) => (await twoFactorStatus(db, userId)).enabled;

/** Start (or restart) enrolment: stores a fresh, not yet enabled secret. Returns the plaintext secret to show once. */
export async function beginTwoFactorSetup(db: Executor, key: string, user: TwoFactorUser): Promise<{ secret: string } | null> {
  if (await isTwoFactorEnabled(db, user.id)) return null;
  const secret = newTotpSecret();
  await db.insert(staffTwoFactor).values({ staffUserId: user.id, shopId: user.shopId, secret: encryptSecret(secret, key) })
    .onConflictDoUpdate({ target: staffTwoFactor.staffUserId, set: { secret: encryptSecret(secret, key), enabled: false, recoveryCodes: [], enabledAt: null } });
  return { secret };
}

/** Confirm enrolment with a code from the authenticator app. Returns the recovery codes (shown once) or null when the code is wrong. */
export async function confirmTwoFactor(db: Executor, key: string, userId: number, code: string): Promise<{ recoveryCodes: string[] } | null> {
  const [r] = await db.select().from(staffTwoFactor).where(eq(staffTwoFactor.staffUserId, userId));
  const secret = r && !r.enabled ? decryptSecret(r.secret, key) : null;
  if (!r || !secret || !verifyTotp(secret, code)) return null;
  const codes = newRecoveryCodes();
  await db.update(staffTwoFactor).set({ enabled: true, enabledAt: new Date(), recoveryCodes: codes.map((c) => sha256(c)) }).where(eq(staffTwoFactor.staffUserId, userId));
  return { recoveryCodes: codes };
}

/** Check a login code: a TOTP code, or an unused recovery code (which is consumed). */
export async function verifySecondFactor(db: Executor, key: string, userId: number, code: string): Promise<boolean> {
  const [r] = await db.select().from(staffTwoFactor).where(and(eq(staffTwoFactor.staffUserId, userId), eq(staffTwoFactor.enabled, true)));
  if (!r) return false;
  const secret = decryptSecret(r.secret, key);
  if (secret && verifyTotp(secret, code)) return true;
  const hash = sha256(normCode(code));
  if (!r.recoveryCodes.includes(hash)) return false;
  await db.update(staffTwoFactor).set({ recoveryCodes: r.recoveryCodes.filter((h) => h !== hash) }).where(eq(staffTwoFactor.staffUserId, userId));
  return true;
}

export async function regenerateRecoveryCodes(db: Executor, userId: number): Promise<string[] | null> {
  if (!(await isTwoFactorEnabled(db, userId))) return null;
  const codes = newRecoveryCodes();
  await db.update(staffTwoFactor).set({ recoveryCodes: codes.map((c) => sha256(c)) }).where(eq(staffTwoFactor.staffUserId, userId));
  return codes;
}

export const disableTwoFactor = (db: Executor, userId: number) => db.delete(staffTwoFactor).where(eq(staffTwoFactor.staffUserId, userId));

// ---- login challenge (signed, stateless, 5 minutes) ------------------------------------------------------------------------------------

export function signChallenge(secret: string, userId: number, ttlMs = 5 * 60 * 1000): string {
  const body = `${userId}.${Date.now() + ttlMs}`;
  return `${body}.${createHmac('sha256', secret).update(`2fa-challenge:${body}`).digest('base64url')}`;
}
export function verifyChallenge(secret: string, token: string): number | null {
  const [id, exp, sig] = token.split('.');
  if (!id || !exp || !sig) return null;
  const expect = createHmac('sha256', secret).update(`2fa-challenge:${id}.${exp}`).digest('base64url');
  return safeEqual(sig, expect) && Number(exp) > Date.now() && Number.isSafeInteger(Number(id)) ? Number(id) : null;
}

// ---- shop policy and sessions --------------------------------------------------------------------------------------------------------

interface SecuritySettings { require2fa?: boolean }
export async function getSecuritySettings(db: Executor, shopId: number): Promise<{ require2fa: boolean }> {
  const [s] = await db.select({ settings: shops.settings }).from(shops).where(eq(shops.id, shopId));
  return { require2fa: !!((s?.settings as { security?: SecuritySettings } | undefined)?.security?.require2fa) };
}
export async function setRequireTwoFactor(db: Executor, shopId: number, require2fa: boolean): Promise<void> {
  const [s] = await db.select({ settings: shops.settings }).from(shops).where(eq(shops.id, shopId));
  const settings = { ...(s?.settings ?? {}), security: { ...((s?.settings as { security?: object } | undefined)?.security ?? {}), require2fa } };
  await db.update(shops).set({ settings }).where(eq(shops.id, shopId));
}
/** True when the shop requires 2FA and this staff member has not enrolled yet. */
export async function twoFactorEnrolmentRequired(db: Executor, shopId: number, userId: number): Promise<boolean> {
  return (await getSecuritySettings(db, shopId)).require2fa && !(await isTwoFactorEnabled(db, userId));
}

export interface StaffSessionRow { id: string; ip: string | null; userAgent: string | null; createdAt: Date; expiresAt: Date; current: boolean }
export async function listStaffSessions(db: Executor, userId: number, currentToken: string | null): Promise<StaffSessionRow[]> {
  const cur = currentToken ? sha256(currentToken) : null;
  const rows = await db.select().from(sessions).where(and(eq(sessions.staffUserId, userId), eq(sessions.kind, 'staff'))).orderBy(sessions.createdAt);
  return rows.filter((r) => r.expiresAt > new Date()).reverse().map((r) => ({ id: r.id, ip: r.ip, userAgent: r.userAgent, createdAt: r.createdAt, expiresAt: r.expiresAt, current: r.id === cur }));
}
export async function revokeStaffSession(db: Executor, userId: number, id: string): Promise<boolean> {
  return (await db.delete(sessions).where(and(eq(sessions.staffUserId, userId), eq(sessions.id, id))).returning({ id: sessions.id })).length > 0;
}
export async function revokeOtherStaffSessions(db: Executor, userId: number, currentToken: string | null): Promise<number> {
  const where = currentToken ? and(eq(sessions.staffUserId, userId), ne(sessions.id, sha256(currentToken))) : eq(sessions.staffUserId, userId);
  return (await db.delete(sessions).where(where).returning({ id: sessions.id })).length;
}
