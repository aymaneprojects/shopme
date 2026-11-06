import { and, asc, count, eq } from 'drizzle-orm';
import { accountPasskeys } from '../db/schema';
import type { Executor } from '../db/client';

export type Passkey = typeof accountPasskeys.$inferSelect;
/** What the settings page shows about a passkey (never the key material). */
export interface PasskeySummary { id: number; name: string; createdAt: Date; lastUsedAt: Date | null; deviceType: string; backedUp: boolean }

export const MAX_PASSKEYS = 10;

export const publicPasskey = (p: Passkey): PasskeySummary => ({ id: p.id, name: p.name, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt, deviceType: p.deviceType, backedUp: p.backedUp });

export async function listPasskeys(db: Executor, accountId: number): Promise<Passkey[]> {
  return db.select().from(accountPasskeys).where(eq(accountPasskeys.accountId, accountId)).orderBy(asc(accountPasskeys.id));
}

export async function addPasskey(db: Executor, accountId: number, input: { credentialId: string; publicKey: string; counter: number; transports?: string[]; deviceType: string; backedUp: boolean; name: string }): Promise<Passkey | null> {
  const [row] = await db.insert(accountPasskeys).values({
    accountId, credentialId: input.credentialId, publicKey: input.publicKey, counter: input.counter, transports: input.transports ?? [],
    deviceType: input.deviceType, backedUp: input.backedUp, name: input.name.trim().slice(0, 60),
  }).onConflictDoNothing().returning();
  return row ?? null;
}

export async function findPasskey(db: Executor, credentialId: string): Promise<Passkey | null> {
  const [row] = await db.select().from(accountPasskeys).where(eq(accountPasskeys.credentialId, credentialId));
  return row ?? null;
}

export async function touchPasskey(db: Executor, id: number, counter: number, backedUp: boolean): Promise<void> {
  await db.update(accountPasskeys).set({ counter, backedUp, lastUsedAt: new Date() }).where(eq(accountPasskeys.id, id));
}

export async function deletePasskey(db: Executor, accountId: number, id: number): Promise<boolean> {
  return (await db.delete(accountPasskeys).where(and(eq(accountPasskeys.accountId, accountId), eq(accountPasskeys.id, id))).returning({ id: accountPasskeys.id })).length > 0;
}

export async function renamePasskey(db: Executor, accountId: number, id: number, name: string): Promise<boolean> {
  return (await db.update(accountPasskeys).set({ name: name.trim().slice(0, 60) }).where(and(eq(accountPasskeys.accountId, accountId), eq(accountPasskeys.id, id))).returning({ id: accountPasskeys.id })).length > 0;
}

export async function countPasskeys(db: Executor, accountId: number | null): Promise<number> {
  if (accountId == null) return 0;
  const [r] = await db.select({ n: count() }).from(accountPasskeys).where(eq(accountPasskeys.accountId, accountId));
  return Number(r?.n ?? 0);
}
