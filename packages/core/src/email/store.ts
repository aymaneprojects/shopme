import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { emailDkimKeys, emailOutbox, emailSettings } from '../db/schema';
import { decryptSecret, encryptSecret } from '../services/two-factor';
import { generateDkimKey, nextSelector } from './dkim';
import type { RelaySecurity } from './presets';

/** Scope of e-mail data: a store id, or null for the installation's own (platform) identity. */
export type EmailScope = number | null;
const scopeIs = <T extends { shopId: Parameters<typeof eq>[0] }>(t: T, scope: EmailScope) => (scope == null ? isNull(t.shopId) : eq(t.shopId, scope));

export type EmailSettingsRow = typeof emailSettings.$inferSelect;
export type DkimKeyRow = typeof emailDkimKeys.$inferSelect;
export type OutboxRow = typeof emailOutbox.$inferSelect;

export async function getEmailSettings(db: Executor, scope: EmailScope): Promise<EmailSettingsRow | null> {
  const [r] = await db.select().from(emailSettings).where(scopeIs(emailSettings, scope)).limit(1);
  return r ?? null;
}

export type EmailSettingsPatch = Partial<Omit<typeof emailSettings.$inferInsert, 'id' | 'shopId' | 'createdAt' | 'updatedAt'>>;
/** Create or update the scope's settings row. */
export async function saveEmailSettings(db: Executor, scope: EmailScope, patch: EmailSettingsPatch): Promise<EmailSettingsRow> {
  const cur = await getEmailSettings(db, scope);
  if (cur) {
    const [r] = await db.update(emailSettings).set({ ...patch, updatedAt: new Date() }).where(eq(emailSettings.id, cur.id)).returning();
    return r!;
  }
  const [r] = await db.insert(emailSettings).values({ shopId: scope, ...patch }).returning();
  return r!;
}

export interface RelayConfig { host: string; port: number; security: RelaySecurity; username: string; password: string }
/** The relay of a scope with the password decrypted, or null when it is not fully configured. */
export function relayOf(row: EmailSettingsRow | null, key: string): RelayConfig | null {
  if (!row?.relayHost || !row.relayPort) return null;
  const password = row.relayPasswordEnc ? decryptSecret(row.relayPasswordEnc, key) : null;
  return { host: row.relayHost, port: row.relayPort, security: (row.relaySecurity as RelaySecurity | null) ?? 'starttls', username: row.relayUsername ?? '', password: password ?? '' };
}
export const encryptRelayPassword = (plain: string, key: string) => encryptSecret(plain, key);

// ---- DKIM keys ---------------------------------------------------------------------------------------------------------------

export async function listDkimKeys(db: Executor, scope: EmailScope, domain: string): Promise<DkimKeyRow[]> {
  return db.select().from(emailDkimKeys).where(and(scopeIs(emailDkimKeys, scope), eq(emailDkimKeys.domain, domain))).orderBy(emailDkimKeys.id);
}

async function insertKey(db: Executor, scope: EmailScope, domain: string, status: 'active' | 'pending', secret: string): Promise<DkimKeyRow> {
  const used = (await listDkimKeys(db, scope, domain)).map((k) => k.selector);
  const kp = generateDkimKey();
  const [r] = await db.insert(emailDkimKeys).values({ shopId: scope, domain, selector: nextSelector(used), publicKey: kp.publicKey, privateKeyEnc: encryptSecret(kp.privateKeyPem, secret), status, activatedAt: status === 'active' ? new Date() : null }).returning();
  return r!;
}

/** The active key of a domain; one is generated when the domain has none yet. */
export async function ensureActiveKey(db: Executor, scope: EmailScope, domain: string, secret: string): Promise<DkimKeyRow> {
  const keys = await listDkimKeys(db, scope, domain);
  return keys.find((k) => k.status === 'active') ?? insertKey(db, scope, domain, 'active', secret);
}

/** Rotation, step 1: a new `pending` key (replacing an older pending one). It signs nothing until activated, so its DNS record can be published first. */
export async function rotateDkimKey(db: Executor, scope: EmailScope, domain: string, secret: string): Promise<DkimKeyRow> {
  await db.delete(emailDkimKeys).where(and(scopeIs(emailDkimKeys, scope), eq(emailDkimKeys.domain, domain), eq(emailDkimKeys.status, 'pending')));
  return insertKey(db, scope, domain, 'pending', secret);
}

/** Rotation, step 2: the pending key becomes the signing key and the previous one is retired. Returns null when nothing is pending. */
export async function activateDkimKey(db: Executor, scope: EmailScope, domain: string): Promise<DkimKeyRow | null> {
  const keys = await listDkimKeys(db, scope, domain);
  const pending = keys.find((k) => k.status === 'pending');
  if (!pending) return null;
  const now = new Date();
  await db.update(emailDkimKeys).set({ status: 'retired', retiredAt: now }).where(and(scopeIs(emailDkimKeys, scope), eq(emailDkimKeys.domain, domain), eq(emailDkimKeys.status, 'active')));
  const [r] = await db.update(emailDkimKeys).set({ status: 'active', activatedAt: now }).where(eq(emailDkimKeys.id, pending.id)).returning();
  return r!;
}

/** Selector and PEM private key used to sign mail of `domain` (creates the key when the domain has none). */
export async function signingKey(db: Executor, scope: EmailScope, domain: string, secret: string): Promise<{ selector: string; privateKey: string } | null> {
  const k = await ensureActiveKey(db, scope, domain, secret);
  const pem = decryptSecret(k.privateKeyEnc, secret);
  return pem ? { selector: k.selector, privateKey: pem } : null;
}

// ---- outbox ------------------------------------------------------------------------------------------------------------------

export const EMAIL_MAX_ATTEMPTS = 5;
/** Wait after failed attempt n (1-based): 15 min, 1 h, 4 h, 18 h: five attempts over about 23 hours. */
export const EMAIL_RETRY_DELAYS_MS = [15 * 60_000, 60 * 60_000, 4 * 3_600_000, 18 * 3_600_000];

export interface OutboxPayload {
  from: string; to: string; replyTo?: string; subject: string; text: string; html?: string;
  envelopeFrom: string; list?: { unsubscribe: string[]; oneClick: boolean };
  /** DKIM domain (the From domain) and the scope whose key signs. */
  dkim?: { domain: string; scope: EmailScope } | null;
}

export async function insertOutbox(db: Executor, row: { shopId: EmailScope; messageId: string; to: string; from: string; subject: string; mode: string; payload: OutboxPayload; status?: 'queued' | 'sending' }): Promise<number> {
  const [r] = await db.insert(emailOutbox).values({ shopId: row.shopId, messageId: row.messageId, toAddress: row.to, fromAddress: row.from, subject: row.subject.slice(0, 500), mode: row.mode, status: row.status ?? 'queued', nextAttemptAt: new Date(), payload: row.payload }).returning({ id: emailOutbox.id });
  return r!.id;
}

/** Atomically take a due row for delivery (queued or retry, or a `sending` one a crashed process left behind). */
export async function claimOutbox(db: Executor, id: number, now = new Date()): Promise<OutboxRow | null> {
  const stale = new Date(now.getTime() - 10 * 60_000);
  const [r] = await db.update(emailOutbox).set({ status: 'sending', attempts: sql`${emailOutbox.attempts} + 1`, updatedAt: now })
    .where(and(eq(emailOutbox.id, id), sql`(${emailOutbox.status} in ('queued','retry') or (${emailOutbox.status} = 'sending' and ${emailOutbox.updatedAt} < ${stale.toISOString()}))`)).returning();
  return r ?? null;
}

export async function dueOutboxIds(db: Executor, now = new Date(), limit = 50): Promise<number[]> {
  const stale = new Date(now.getTime() - 10 * 60_000);
  const rows = await db.select({ id: emailOutbox.id }).from(emailOutbox)
    .where(sql`(${emailOutbox.status} in ('queued','retry') and ${emailOutbox.nextAttemptAt} <= ${now.toISOString()}) or (${emailOutbox.status} = 'sending' and ${emailOutbox.updatedAt} < ${stale.toISOString()})`)
    .orderBy(emailOutbox.id).limit(limit);
  return rows.map((r) => r.id);
}

export interface Attempt { ok: boolean; permanent: boolean; response: string | null; error: string | null; mxHost: string | null }

/** Record the outcome of attempt `row.attempts`: sent, failed for good, or scheduled for a retry (temporary failure with attempts left). */
export async function recordAttempt(db: Executor, row: OutboxRow, a: Attempt, opts: { retry?: boolean; now?: Date } = {}): Promise<OutboxRow['status']> {
  const now = opts.now ?? new Date();
  const base = { lastResponse: a.response?.slice(0, 500) ?? null, mxHost: a.mxHost, updatedAt: now };
  if (a.ok) { await db.update(emailOutbox).set({ ...base, status: 'sent', sentAt: now, lastError: null, payload: null, nextAttemptAt: null }).where(eq(emailOutbox.id, row.id)); return 'sent'; }
  const err = a.error?.slice(0, 500) ?? 'Delivery failed';
  const retry = (opts.retry ?? true) && !a.permanent && row.attempts < EMAIL_MAX_ATTEMPTS;
  if (retry) {
    const wait = EMAIL_RETRY_DELAYS_MS[Math.min(row.attempts, EMAIL_RETRY_DELAYS_MS.length) - 1] ?? EMAIL_RETRY_DELAYS_MS[EMAIL_RETRY_DELAYS_MS.length - 1]!;
    await db.update(emailOutbox).set({ ...base, status: 'retry', lastError: err, nextAttemptAt: new Date(now.getTime() + wait) }).where(eq(emailOutbox.id, row.id));
    return 'retry';
  }
  await db.update(emailOutbox).set({ ...base, status: 'failed', lastError: err, payload: null, nextAttemptAt: null }).where(eq(emailOutbox.id, row.id));
  return 'failed';
}

export async function listOutbox(db: Executor, scope: EmailScope, limit = 25): Promise<OutboxRow[]> {
  return db.select().from(emailOutbox).where(scopeIs(emailOutbox, scope)).orderBy(desc(emailOutbox.id)).limit(Math.min(Math.max(limit, 1), 100));
}

/** Messages that failed for good in the last day with nothing delivered since: the signal the admin banner uses. */
export async function recentFailureCount(db: Executor, scope: EmailScope, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 24 * 3_600_000);
  const rows = await db.select({ status: emailOutbox.status, at: emailOutbox.updatedAt }).from(emailOutbox).where(and(scopeIs(emailOutbox, scope), sql`${emailOutbox.updatedAt} > ${since.toISOString()}`, inArray(emailOutbox.status, ['failed', 'sent'])));
  const lastSent = Math.max(0, ...rows.filter((r) => r.status === 'sent').map((r) => r.at.getTime()));
  return rows.filter((r) => r.status === 'failed' && r.at.getTime() > lastSent).length;
}

/** Drop outbox rows older than `days` (their bodies are already gone). */
export async function purgeOutbox(db: Executor, days = 30, now = new Date()): Promise<void> {
  await db.delete(emailOutbox).where(and(lt(emailOutbox.createdAt, new Date(now.getTime() - days * 86_400_000)), inArray(emailOutbox.status, ['sent', 'failed'])));
}
