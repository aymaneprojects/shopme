import { and, asc, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm';
import { hash, verify } from '@node-rs/argon2';
import { accountTwoFactor, apiTokens, PERMISSION_AREAS, platformAccounts, sessions, staffUsers } from '../db/schema';
import type { Executor } from '../db/client';
import { randomToken, sha256 } from './crypto';

export type StaffUser = typeof staffUsers.$inferSelect;
export type PublicStaffUser = Pick<StaffUser, 'id' | 'shopId' | 'email' | 'firstName' | 'lastName' | 'role'> & { permissions: string[] };
export const publicAccount = (a: Account) => ({ id: a.id, email: a.email, firstName: a.firstName, lastName: a.lastName, platformOwner: a.platformOwner });

export const SESSION_TTL_MS = 14 * 24 * 3600 * 1000;
export const MIN_PASSWORD_LENGTH = 8;

export const hashPassword = (password: string) => hash(password);
export const verifyPassword = (hashed: string, password: string) => verify(hashed, password).catch(() => false);
const DUMMY_HASH_PROMISE = hash('shopme-dummy-password');

export const publicStaff = (u: StaffUser): PublicStaffUser => ({ id: u.id, shopId: u.shopId, email: u.email, firstName: u.firstName, lastName: u.lastName, role: u.role, permissions: u.role === 'staff' ? u.permissions : [...PERMISSION_AREAS] });

export type Account = typeof platformAccounts.$inferSelect;

/** A new sign-in identity. The e-mail is lower-cased; the password is hashed like every staff password. */
export async function createAccount(db: Executor, input: { email: string; password: string; firstName?: string | null; lastName?: string | null; platformOwner?: boolean }): Promise<Account> {
  const [row] = await db.insert(platformAccounts).values({
    email: input.email.trim().toLowerCase(), passwordHash: await hashPassword(input.password),
    firstName: input.firstName ?? null, lastName: input.lastName ?? null, platformOwner: input.platformOwner ?? false,
  }).returning();
  return row!;
}

export async function getAccount(db: Executor, id: number): Promise<Account | null> {
  const [a] = await db.select().from(platformAccounts).where(eq(platformAccounts.id, id)).limit(1);
  return a ?? null;
}

/**
 * Add a staff member. With `accountId` the member signs in with that existing account (multi-store: the account that creates a
 * store becomes its owner); otherwise a new account is created from `email` and `password`.
 */
export async function createStaffUser(db: Executor, input: { shopId: number; email: string; password?: string; accountId?: number; firstName?: string | null; lastName?: string | null; role?: 'owner' | 'admin' | 'staff' }) {
  let accountId = input.accountId;
  if (accountId == null) {
    if (!input.password) throw new Error('A password or an account is required');
    accountId = (await createAccount(db, { email: input.email, password: input.password, firstName: input.firstName, lastName: input.lastName })).id;
  }
  const [row] = await db.insert(staffUsers).values({
    shopId: input.shopId,
    email: input.email.trim().toLowerCase(),
    accountId,
    firstName: input.firstName ?? null,
    lastName: input.lastName ?? null,
    role: input.role ?? 'staff',
  }).returning();
  return row!;
}

/**
 * Verify an account's credentials. Runs a dummy hash when no account matches (uniform timing). Several accounts can share an
 * e-mail (members migrated from separate stores): those whose password matches are merged into the oldest one, since the
 * person just proved they hold each of them, unless one of them uses two-step verification (then nothing is merged).
 */
export async function authenticateAccount(db: Executor, email: string, password: string): Promise<Account | null> {
  const rows = await db.select().from(platformAccounts).where(and(eq(platformAccounts.email, email.trim().toLowerCase()), eq(platformAccounts.active, true))).orderBy(asc(platformAccounts.id));
  if (!rows.length) {
    await verifyPassword(await DUMMY_HASH_PROMISE, password);
    return null;
  }
  const matches: Account[] = [];
  for (const a of rows) if (await verifyPassword(a.passwordHash, password)) matches.push(a);
  if (!matches.length) return null;
  const [keep, ...others] = matches as [Account, ...Account[]];
  if (others.length) {
    const ids = matches.map((m) => m.id);
    const with2fa = await db.select({ id: accountTwoFactor.accountId }).from(accountTwoFactor).where(and(inArray(accountTwoFactor.accountId, ids), eq(accountTwoFactor.enabled, true)));
    if (!with2fa.length) {
      const otherIds = others.map((o) => o.id);
      await db.update(staffUsers).set({ accountId: keep.id }).where(inArray(staffUsers.accountId, otherIds));
      await db.update(sessions).set({ accountId: keep.id }).where(inArray(sessions.accountId, otherIds));
      if (others.some((o) => o.platformOwner)) await db.update(platformAccounts).set({ platformOwner: true }).where(eq(platformAccounts.id, keep.id));
      await db.delete(platformAccounts).where(inArray(platformAccounts.id, otherIds));
    }
  }
  await db.update(platformAccounts).set({ lastLoginAt: new Date() }).where(eq(platformAccounts.id, keep.id));
  return keep;
}

/** Active staff memberships of an account, oldest store first. */
export async function staffOfAccount(db: Executor, accountId: number): Promise<StaffUser[]> {
  return db.select().from(staffUsers).where(and(eq(staffUsers.accountId, accountId), eq(staffUsers.active, true))).orderBy(asc(staffUsers.shopId));
}

/** The account's active staff membership in one store, or null. */
export async function staffInShop(db: Executor, accountId: number, shopId: number): Promise<StaffUser | null> {
  const [u] = await db.select().from(staffUsers).where(and(eq(staffUsers.accountId, accountId), eq(staffUsers.shopId, shopId), eq(staffUsers.active, true))).limit(1);
  return u ?? null;
}

/** Verify credentials and return the account's staff membership (its first store). Runs a dummy hash when the user does not exist. */
export async function authenticateStaff(db: Executor, email: string, password: string): Promise<StaffUser | null> {
  const account = await authenticateAccount(db, email, password);
  if (!account) return null;
  const [user] = await staffOfAccount(db, account.id);
  if (!user) return null;
  await db.update(staffUsers).set({ lastLoginAt: new Date() }).where(eq(staffUsers.id, user.id));
  return user;
}

/** True when `password` is the password of the staff member's account. */
export async function verifyStaffPassword(db: Executor, user: Pick<StaffUser, 'accountId'>, password: string): Promise<boolean> {
  const account = user.accountId != null ? await getAccount(db, user.accountId) : null;
  return !!account && verifyPassword(account.passwordHash, password);
}

/**
 * Open a staff session. It belongs to the account (taken from the staff member when not given); `shopId`/`staffUserId` record the
 * store it was opened in, which multi-store mode uses when a request names no store. An account with no store yet passes nulls.
 */
export async function createSession(db: Executor, input: { shopId: number | null; staffUserId: number | null; accountId?: number | null; ip?: string; userAgent?: string; ttlMs?: number }) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + (input.ttlMs ?? SESSION_TTL_MS));
  let accountId = input.accountId ?? null;
  if (accountId == null && input.staffUserId != null) accountId = (await db.select({ a: staffUsers.accountId }).from(staffUsers).where(eq(staffUsers.id, input.staffUserId)))[0]?.a ?? null;
  await db.insert(sessions).values({ id: sha256(token), shopId: input.shopId, kind: 'staff', staffUserId: input.staffUserId, accountId, expiresAt, ip: input.ip, userAgent: input.userAgent?.slice(0, 255) });
  return { token, expiresAt };
}

/** A staff session's account and the store it was opened in (multi-store mode), or null when expired or the account is disabled. */
export async function resolveAccountSession(db: Executor, token: string): Promise<{ account: Account; shopId: number | null } | null> {
  const rows = await db.select({ account: platformAccounts, shopId: sessions.shopId }).from(sessions)
    .innerJoin(platformAccounts, eq(sessions.accountId, platformAccounts.id))
    .where(and(eq(sessions.id, sha256(token)), eq(sessions.kind, 'staff'), gt(sessions.expiresAt, new Date()), eq(platformAccounts.active, true)))
    .limit(1);
  return rows[0] ?? null;
}

/** Remember the store a session last used (multi-store: where `/admin` opens when the URL names no store). */
export async function setSessionShop(db: Executor, token: string, shopId: number, staffUserId: number): Promise<void> {
  await db.update(sessions).set({ shopId, staffUserId }).where(eq(sessions.id, sha256(token)));
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

/** Set a new password on an account and sign it out everywhere (its trusted browsers stop matching too, they are bound to the password). */
export async function setAccountPassword(db: Executor, accountId: number, password: string): Promise<void> {
  await db.update(platformAccounts).set({ passwordHash: await hashPassword(password), updatedAt: new Date() }).where(eq(platformAccounts.id, accountId));
  await db.delete(sessions).where(and(eq(sessions.accountId, accountId), eq(sessions.kind, 'staff')));
}
