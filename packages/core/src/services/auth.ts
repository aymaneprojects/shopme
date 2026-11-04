import { and, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { hash, verify } from '@node-rs/argon2';
import { apiTokens, sessions, staffUsers } from '../db/schema';
import type { Executor } from '../db/client';
import { randomToken, sha256 } from './crypto';

export type StaffUser = typeof staffUsers.$inferSelect;
export type PublicStaffUser = Pick<StaffUser, 'id' | 'shopId' | 'email' | 'firstName' | 'lastName' | 'role'>;

export const SESSION_TTL_MS = 14 * 24 * 3600 * 1000;
export const MIN_PASSWORD_LENGTH = 8;

export const hashPassword = (password: string) => hash(password);
export const verifyPassword = (hashed: string, password: string) => verify(hashed, password).catch(() => false);
const DUMMY_HASH_PROMISE = hash('shopme-dummy-password');

export const publicStaff = (u: StaffUser): PublicStaffUser => ({ id: u.id, shopId: u.shopId, email: u.email, firstName: u.firstName, lastName: u.lastName, role: u.role });

export async function createStaffUser(db: Executor, input: { shopId: number; email: string; password: string; firstName?: string | null; lastName?: string | null; role?: 'owner' | 'admin' | 'staff' }) {
  const [row] = await db.insert(staffUsers).values({
    shopId: input.shopId,
    email: input.email.trim().toLowerCase(),
    passwordHash: await hashPassword(input.password),
    firstName: input.firstName ?? null,
    lastName: input.lastName ?? null,
    role: input.role ?? 'staff',
  }).returning();
  return row!;
}

/** Verify credentials. Runs a dummy hash when the user does not exist (uniform timing). */
export async function authenticateStaff(db: Executor, email: string, password: string): Promise<StaffUser | null> {
  const [user] = await db.select().from(staffUsers).where(and(eq(staffUsers.email, email.trim().toLowerCase()), eq(staffUsers.active, true))).limit(1);
  if (!user) {
    await verifyPassword(await DUMMY_HASH_PROMISE, password);
    return null;
  }
  if (!(await verifyPassword(user.passwordHash, password))) return null;
  await db.update(staffUsers).set({ lastLoginAt: new Date() }).where(eq(staffUsers.id, user.id));
  return user;
}

export async function createSession(db: Executor, input: { shopId: number; staffUserId: number; ip?: string; userAgent?: string; ttlMs?: number }) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + (input.ttlMs ?? SESSION_TTL_MS));
  await db.insert(sessions).values({ id: sha256(token), shopId: input.shopId, kind: 'staff', staffUserId: input.staffUserId, expiresAt, ip: input.ip, userAgent: input.userAgent?.slice(0, 255) });
  return { token, expiresAt };
}

/** Resolve a session token to an active staff user, or null. */
export async function resolveSession(db: Executor, token: string): Promise<StaffUser | null> {
  const rows = await db
    .select({ user: staffUsers })
    .from(sessions)
    .innerJoin(staffUsers, eq(sessions.staffUserId, staffUsers.id))
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, new Date()), eq(staffUsers.active, true)))
    .limit(1);
  return rows[0]?.user ?? null;
}

export async function destroySession(db: Executor, token: string) {
  await db.delete(sessions).where(eq(sessions.id, sha256(token)));
}

export const purgeExpiredSessions = (db: Executor) => db.delete(sessions).where(lt(sessions.expiresAt, new Date()));

export const API_TOKEN_PREFIX = 'shpme_';

/** Create an Admin API token. The plaintext is returned once; only its hash is stored. */
export async function createApiToken(db: Executor, input: { shopId: number; name: string; scopes?: string[]; expiresAt?: Date | null; createdByStaffId?: number }) {
  const token = API_TOKEN_PREFIX + randomToken(24);
  const [row] = await db.insert(apiTokens).values({
    shopId: input.shopId, name: input.name, tokenHash: sha256(token), tokenPrefix: token.slice(0, 10),
    scopes: input.scopes ?? ['*'], expiresAt: input.expiresAt ?? null, createdByStaffId: input.createdByStaffId,
  }).returning();
  return { token, record: row! };
}

export async function resolveApiToken(db: Executor, token: string) {
  const [row] = await db.select().from(apiTokens).where(and(
    eq(apiTokens.tokenHash, sha256(token)), isNull(apiTokens.revokedAt), or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, new Date())),
  )).limit(1);
  if (row) await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.id));
  return row ?? null;
}
