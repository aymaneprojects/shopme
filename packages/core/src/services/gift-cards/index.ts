import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { customers, giftCardTransactions, giftCards, orderLines, orders } from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { buildSearch, compare, dateCompare, idTerm } from '../catalog/search';
import { errR, okR, txResult, type Result } from '../catalog/common';
import { addEvent } from '../events';
import { moneyOf, shopUrl } from '../../mail/notifications';
import { getOrder } from '../orders/orders';
import type { Shop } from '../shops';

export type GiftCard = typeof giftCards.$inferSelect;
export type GiftCardTransaction = typeof giftCardTransactions.$inferSelect;

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** 16 random characters from an alphabet without look-alikes (O/0, I/1). */
export const generateGiftCardCode = (len = 16): string => Array.from(randomBytes(len), (b) => ALPHABET[b % ALPHABET.length]).join('');
export const generateGiftCardToken = (): string => randomBytes(24).toString('base64url');
/** Buyer input -> stored form: letters and digits, upper-cased (spaces and dashes are ignored). */
export const normalizeGiftCardCode = (raw: string): string => raw.replace(/[\s-]/g, '').toUpperCase();
export const lastCharacters = (code: string): string => code.slice(-4).toLowerCase();
export const maskedGiftCardCode = (code: string): string => `•••• •••• •••• ${code.slice(-4)}`;
/** `ABCD-EFGH-IJKL-MNOP` for display to the owner of the card. */
export const formatGiftCardCode = (code: string): string => code.replace(/(.{4})(?=.)/g, '$1-');

export type GiftCardState = 'ENABLED' | 'DISABLED' | 'EXPIRED';
export const giftCardState = (c: Pick<GiftCard, 'enabled' | 'expiresOn'>, now = new Date()): GiftCardState => (!c.enabled ? 'DISABLED' : c.expiresOn && c.expiresOn < now ? 'EXPIRED' : 'ENABLED');
export const isRedeemable = (c: Pick<GiftCard, 'enabled' | 'expiresOn' | 'balance'>, now = new Date()): boolean => giftCardState(c, now) === 'ENABLED' && c.balance > 0;

// ---------------------------------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------------------------------

export async function getGiftCard(db: Executor, shopId: number, id: number): Promise<GiftCard | null> {
  const [r] = await db.select().from(giftCards).where(and(eq(giftCards.shopId, shopId), eq(giftCards.id, id))).limit(1);
  return r ?? null;
}
export async function getGiftCardByCode(db: Executor, shopId: number, code: string): Promise<GiftCard | null> {
  const [r] = await db.select().from(giftCards).where(and(eq(giftCards.shopId, shopId), eq(giftCards.code, normalizeGiftCardCode(code)))).limit(1);
  return r ?? null;
}
export async function getGiftCardByToken(db: Executor, shopId: number, token: string): Promise<GiftCard | null> {
  const [r] = await db.select().from(giftCards).where(and(eq(giftCards.shopId, shopId), eq(giftCards.token, token))).limit(1);
  return r ?? null;
}
export async function listGiftCardTransactions(db: Executor, shopId: number, giftCardId: number): Promise<GiftCardTransaction[]> {
  return db.select().from(giftCardTransactions).where(and(eq(giftCardTransactions.shopId, shopId), eq(giftCardTransactions.giftCardId, giftCardId))).orderBy(desc(giftCardTransactions.processedAt), desc(giftCardTransactions.id));
}

const search = (q: string | null | undefined) => buildSearch(q, {
  fields: {
    status: (_o, v) => {
      const now = new Date().toISOString();
      switch (v.toLowerCase()) {
        case 'enabled': return sql`(${giftCards.enabled} and (${giftCards.expiresOn} is null or ${giftCards.expiresOn} >= ${now}::timestamptz))`;
        case 'disabled': return sql`(not ${giftCards.enabled})`;
        case 'expired': return sql`(${giftCards.enabled} and ${giftCards.expiresOn} < ${now}::timestamptz)`;
        default: return null;
      }
    },
    balance_status: (_o, v) => {
      switch (v.toLowerCase()) {
        case 'full': return sql`${giftCards.balance} = ${giftCards.initialValue}`;
        case 'partial': return sql`(${giftCards.balance} > 0 and ${giftCards.balance} < ${giftCards.initialValue})`;
        case 'empty': return sql`${giftCards.balance} = 0`;
        case 'full_or_partial': return sql`${giftCards.balance} > 0`;
        default: return null;
      }
    },
    source: (_o, v) => (v.toLowerCase() === 'purchased' ? sql`${giftCards.orderId} is not null` : v.toLowerCase() === 'manual' ? sql`${giftCards.orderId} is null` : null),
    id: (_o, v) => idTerm(giftCards.id, v),
    customer_id: (_o, v) => idTerm(giftCards.customerId, v),
    last_characters: (_o, v) => sql`lower(right(${giftCards.code}, 4)) = ${v.toLowerCase()}`,
    initial_value: (op, v) => (Number.isFinite(Number(v)) ? compare(giftCards.initialValue, op, Math.round(Number(v) * 100)) : null),
    balance: (op, v) => (Number.isFinite(Number(v)) ? compare(giftCards.balance, op, Math.round(Number(v) * 100)) : null),
    created_at: (op, v) => dateCompare(giftCards.createdAt, op, v),
    expires_on: (op, v) => dateCompare(giftCards.expiresOn, op, v),
  },
  text: (v) => sql`(lower(right(${giftCards.code}, 4)) = ${v.toLowerCase()} or ${giftCards.note} ilike ${`%${v}%`}
    or exists (select 1 from customers c where c.id = ${giftCards.customerId} and (c.email ilike ${`%${v}%`} or concat_ws(' ', c.first_name, c.last_name) ilike ${`%${v}%`})))`,
});

export type GiftCardSortKey = 'AMOUNT_SPENT' | 'BALANCE' | 'CODE' | 'CREATED_AT' | 'CUSTOMER_NAME' | 'DISABLED_AT' | 'EXPIRES_ON' | 'ID' | 'INITIAL_VALUE' | 'UPDATED_AT';

/** Gift cards issued for a paid order (one per unit of its gift card lines). */
export async function listGiftCardsForOrder(db: Executor, shopId: number, orderId: number): Promise<GiftCard[]> {
  return db.select().from(giftCards).where(and(eq(giftCards.shopId, shopId), eq(giftCards.orderId, orderId))).orderBy(asc(giftCards.id));
}

export async function listGiftCards(db: Executor, shopId: number, o: { query?: string | null; sortKey?: GiftCardSortKey; reverse?: boolean; offset: number; limit: number }): Promise<GiftCard[]> {
  const cols: Record<string, unknown> = {
    AMOUNT_SPENT: sql`${giftCards.initialValue} - ${giftCards.balance}`, BALANCE: giftCards.balance, CODE: giftCards.code, CREATED_AT: giftCards.createdAt, DISABLED_AT: giftCards.deactivatedAt,
    EXPIRES_ON: giftCards.expiresOn, INITIAL_VALUE: giftCards.initialValue, UPDATED_AT: giftCards.updatedAt,
    CUSTOMER_NAME: sql`(select lower(concat_ws(' ', c.first_name, c.last_name)) from ${customers} c where c.id = ${giftCards.customerId})`,
  };
  const col = cols[o.sortKey ?? 'ID'] ?? giftCards.id;
  const dir = o.reverse ? desc : asc;
  return db.select().from(giftCards).where(and(eq(giftCards.shopId, shopId), search(o.query))).orderBy(dir(col as never), dir(giftCards.id)).limit(o.limit).offset(o.offset);
}

export async function countGiftCards(db: Executor, shopId: number, query?: string | null, limit = 10000): Promise<{ count: number; precision: 'EXACT' | 'AT_LEAST' }> {
  const rows = await db.select({ id: giftCards.id }).from(giftCards).where(and(eq(giftCards.shopId, shopId), search(query))).limit(limit + 1);
  return rows.length > limit ? { count: limit, precision: 'AT_LEAST' } : { count: rows.length, precision: 'EXACT' };
}

// ---------------------------------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------------------------------

export interface GiftCardInput {
  /** Minor units. */
  initialValue: number;
  code?: string | null;
  customerId?: number | null;
  expiresOn?: Date | null;
  note?: string | null;
  templateSuffix?: string | null;
  recipientCustomerId?: number | null;
  recipientName?: string | null;
  message?: string | null;
  sendNotificationAt?: Date | null;
  orderId?: number | null;
  orderLineId?: number | null;
}

const CODE_RE = /^[A-Z0-9]{8,20}$/;
export const GIFT_CARD_LIMIT = 100_000_000; // 1,000,000.00 in minor units

async function customerExists(db: Executor, shopId: number, id: number) {
  return (await db.select({ id: customers.id }).from(customers).where(and(eq(customers.shopId, shopId), eq(customers.id, id))).limit(1)).length > 0;
}

export async function createGiftCard(db: Db, shopId: number, currency: string, i: GiftCardInput, staffId?: number | null): Promise<Result<GiftCard>> {
  if (!(i.initialValue > 0)) return errR(['initialValue'], 'Initial value must be greater than 0', 'GREATER_THAN');
  if (i.initialValue > GIFT_CARD_LIMIT) return errR(['initialValue'], 'Initial value is too big', 'TOO_BIG');
  const code = i.code ? normalizeGiftCardCode(i.code) : generateGiftCardCode();
  if (i.code && !CODE_RE.test(code)) return errR(['code'], i.code.length < 8 ? 'Code is too short (minimum is 8 characters)' : /^[A-Za-z0-9\s-]+$/.test(i.code) ? 'Code is too long (maximum is 20 characters)' : 'Code is invalid', code.length < 8 ? 'TOO_SHORT' : code.length > 20 ? 'TOO_LONG' : 'INVALID');
  if (i.expiresOn && i.expiresOn.getTime() < Date.now() - 86_400_000) return errR(['expiresOn'], 'Expiry date must be in the future', 'INVALID');
  if (i.customerId && !(await customerExists(db, shopId, i.customerId))) return errR(['customerId'], 'Customer could not be found', 'CUSTOMER_NOT_FOUND');
  if (i.recipientCustomerId && !(await customerExists(db, shopId, i.recipientCustomerId))) return errR(['recipientAttributes', 'id'], 'Recipient could not be found', 'RECIPIENT_NOT_FOUND');
  if ((await db.select({ id: giftCards.id }).from(giftCards).where(and(eq(giftCards.shopId, shopId), eq(giftCards.code, code)))).length) return errR(['code'], 'Code has already been taken', 'TAKEN');
  return txResult(db, async (tx) => {
    const [row] = await tx.insert(giftCards).values({
      shopId, code, token: generateGiftCardToken(), currency, initialValue: i.initialValue, balance: i.initialValue, customerId: i.customerId ?? null, expiresOn: i.expiresOn ?? null,
      note: i.note?.trim() || null, templateSuffix: i.templateSuffix || null, recipientCustomerId: i.recipientCustomerId ?? null, recipientName: i.recipientName?.trim() || null,
      message: i.message?.slice(0, 200) || null, sendNotificationAt: i.sendNotificationAt ?? null, orderId: i.orderId ?? null, orderLineId: i.orderLineId ?? null,
    }).returning();
    await tx.insert(giftCardTransactions).values({ shopId, giftCardId: row!.id, amount: i.initialValue, note: i.orderId ? 'Purchased' : 'Issued', orderId: i.orderId ?? null });
    await addEvent(tx, shopId, { subjectType: 'gift_card', subjectId: row!.id, verb: 'gift_cards/create', message: 'Gift card was issued', authorStaffUserId: staffId, data: { orderId: i.orderId ?? null } });
    return okR(row!);
  });
}

export type GiftCardUpdate = Partial<Pick<GiftCardInput, 'note' | 'expiresOn' | 'customerId' | 'templateSuffix' | 'recipientCustomerId' | 'recipientName' | 'message' | 'sendNotificationAt'>>;

export async function updateGiftCard(db: Db, shopId: number, id: number, i: GiftCardUpdate, staffId?: number | null): Promise<Result<GiftCard>> {
  const cur = await getGiftCard(db, shopId, id);
  if (!cur) return errR(['id'], 'Gift card does not exist', 'INVALID');
  if (i.customerId && !(await customerExists(db, shopId, i.customerId))) return errR(['customerId'], 'Customer could not be found', 'CUSTOMER_NOT_FOUND');
  if (i.recipientCustomerId && !(await customerExists(db, shopId, i.recipientCustomerId))) return errR(['recipientAttributes', 'id'], 'Recipient could not be found', 'RECIPIENT_NOT_FOUND');
  const [row] = await db.update(giftCards).set({
    ...(i.note !== undefined && { note: i.note?.trim() || null }), ...(i.expiresOn !== undefined && { expiresOn: i.expiresOn }), ...(i.customerId !== undefined && { customerId: i.customerId }),
    ...(i.templateSuffix !== undefined && { templateSuffix: i.templateSuffix || null }), ...(i.recipientCustomerId !== undefined && { recipientCustomerId: i.recipientCustomerId }),
    ...(i.recipientName !== undefined && { recipientName: i.recipientName?.trim() || null }), ...(i.message !== undefined && { message: i.message?.slice(0, 200) || null }),
    ...(i.sendNotificationAt !== undefined && { sendNotificationAt: i.sendNotificationAt }), updatedAt: new Date(),
  }).where(eq(giftCards.id, id)).returning();
  await addEvent(db, shopId, { subjectType: 'gift_card', subjectId: id, verb: 'gift_cards/update', message: 'Gift card was updated', authorStaffUserId: staffId });
  return okR(row!);
}

/** Disabling is permanent in Shopify too: the balance stays but can no longer be redeemed. */
export async function deactivateGiftCard(db: Db, shopId: number, id: number, staffId?: number | null): Promise<Result<GiftCard>> {
  const cur = await getGiftCard(db, shopId, id);
  if (!cur) return errR(['id'], 'Gift card does not exist', 'INVALID');
  if (!cur.enabled) return okR(cur);
  const now = new Date();
  const [row] = await db.update(giftCards).set({ enabled: false, deactivatedAt: now, updatedAt: now }).where(eq(giftCards.id, id)).returning();
  await addEvent(db, shopId, { subjectType: 'gift_card', subjectId: id, verb: 'gift_cards/disable', message: 'Gift card was deactivated', authorStaffUserId: staffId });
  return okR(row!);
}

/** Credit (positive) or debit (negative) in minor units. A debit cannot take the balance below zero. */
export async function adjustGiftCard(db: Db, shopId: number, id: number, amount: number, o: { note?: string | null; processedAt?: Date | null; staffId?: number | null } = {}): Promise<Result<{ giftCard: GiftCard; transaction: GiftCardTransaction }>> {
  if (!amount) return errR(['amount'], 'Amount must not be zero', 'INVALID');
  const cur = await getGiftCard(db, shopId, id);
  if (!cur) return errR(['id'], 'Gift card does not exist', 'GIFT_CARD_NOT_FOUND');
  if (!cur.enabled) return errR(['id'], 'Gift card is deactivated', 'INACTIVE_GIFT_CARD');
  if (amount < 0 && cur.balance + amount < 0) return errR(['debitAmount'], 'Insufficient balance', 'INSUFFICIENT_FUNDS');
  if (amount > 0 && cur.balance + amount > GIFT_CARD_LIMIT) return errR(['creditAmount'], 'Balance is too big', 'TOO_BIG');
  return txResult(db, async (tx) => {
    const [row] = await tx.update(giftCards).set({ balance: sql`${giftCards.balance} + ${amount}`, updatedAt: new Date() })
      .where(and(eq(giftCards.id, id), amount < 0 ? sql`${giftCards.balance} >= ${-amount}` : undefined)).returning();
    if (!row) return errR(['debitAmount'], 'Insufficient balance', 'INSUFFICIENT_FUNDS');
    const [t] = await tx.insert(giftCardTransactions).values({ shopId, giftCardId: id, amount, note: o.note?.trim() || null, processedAt: o.processedAt ?? new Date() }).returning();
    await addEvent(tx, shopId, { subjectType: 'gift_card', subjectId: id, verb: amount > 0 ? 'gift_cards/credit' : 'gift_cards/debit', message: `Gift card ${amount > 0 ? 'credited' : 'debited'} (${Math.abs(amount)} minor units)`, authorStaffUserId: o.staffId });
    return okR({ giftCard: row, transaction: t! });
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------------------------------------------------

export type GiftCardRejection = 'gc_not_found' | 'gc_disabled' | 'gc_expired' | 'gc_empty' | 'gc_currency';

/** Why a buyer-entered code cannot be used, or null when it can. */
export function giftCardRejection(c: GiftCard | null, currency: string, now = new Date()): GiftCardRejection | null {
  if (!c) return 'gc_not_found';
  if (!c.enabled) return 'gc_disabled';
  if (c.expiresOn && c.expiresOn < now) return 'gc_expired';
  if (c.balance <= 0) return 'gc_empty';
  if (c.currency !== currency) return 'gc_currency';
  return null;
}

/**
 * Spread `payable` over the cards in the order they were entered: each pays up to its balance. Pure; the order creation re-checks the
 * balance atomically.
 */
export function allocateGiftCards(cards: Pick<GiftCard, 'id' | 'balance'>[], payable: number): { giftCardId: number; amount: number }[] {
  let left = Math.max(0, payable);
  const out: { giftCardId: number; amount: number }[] = [];
  for (const c of cards) {
    const n = Math.min(left, c.balance);
    if (n > 0) { out.push({ giftCardId: c.id, amount: n }); left -= n; }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Gift card products: issuing on payment
// ---------------------------------------------------------------------------------------------------------------------

const prop = (props: Record<string, string>, ...keys: string[]) => {
  for (const [k, v] of Object.entries(props)) if (keys.includes(k.toLowerCase().replace(/^_/, '')) && v.trim()) return v.trim();
  return null;
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Issue one gift card per unit of every gift card line of a paid order (idempotent: lines that already have cards are skipped).
 * Recipient details come from the line properties `Recipient email`, `Recipient name` and `Message` (the Shopify gift card product form).
 * Returns the cards created, each with the address its email goes to (recipient, else the buyer).
 */
export async function issueGiftCardsForOrder(db: Db, shopId: number, orderId: number): Promise<{ card: GiftCard; to: string | null; buyerEmail: string | null }[]> {
  const order = await getOrder(db, shopId, orderId);
  if (!order || order.cancelledAt || order.financialStatus !== 'PAID') return [];
  const lines = await db.select().from(orderLines).where(and(eq(orderLines.orderId, orderId), eq(orderLines.isGiftCard, true)));
  if (!lines.length) return [];
  const done = await db.select({ lineId: giftCards.orderLineId }).from(giftCards).where(and(eq(giftCards.shopId, shopId), inArray(giftCards.orderLineId, lines.map((l) => l.id))));
  const out: { card: GiftCard; to: string | null; buyerEmail: string | null }[] = [];
  for (const l of lines) {
    if (done.some((d) => d.lineId === l.id) || l.unitPrice <= 0) continue;
    const email = prop(l.properties, 'recipient email', 'recipient_email', 'email');
    const recipientEmail = email && EMAIL_RE.test(email) ? email.toLowerCase() : null;
    let recipientId: number | null = null;
    if (recipientEmail) {
      const [c] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.shopId, shopId), eq(customers.email, recipientEmail))).limit(1);
      recipientId = c?.id ?? (await db.insert(customers).values({ shopId, email: recipientEmail }).returning({ id: customers.id }))[0]!.id;
    }
    for (let n = 0; n < l.quantity; n++) {
      const r = await createGiftCard(db, shopId, order.currency, {
        initialValue: l.unitPrice, customerId: order.customerId, orderId, orderLineId: l.id, recipientCustomerId: recipientId,
        recipientName: prop(l.properties, 'recipient name', 'recipient_name', 'name'), message: prop(l.properties, 'message'),
      });
      if (r.ok) out.push({ card: r.value, to: recipientEmail ?? order.email, buyerEmail: order.email });
    }
  }
  return out;
}

/** Cards whose email has not gone out yet: bought through a product, or manually issued with a recipient (and not scheduled for later). */
export async function dueGiftCardNotifications(db: Executor, shopId: number, now = new Date()): Promise<GiftCard[]> {
  return db.select().from(giftCards).where(and(eq(giftCards.shopId, shopId), isNull(giftCards.notifiedAt), eq(giftCards.enabled, true),
    sql`(${giftCards.orderId} is not null or ${giftCards.recipientCustomerId} is not null)`,
    sql`(${giftCards.sendNotificationAt} is null or ${giftCards.sendNotificationAt} <= ${now.toISOString()}::timestamptz)`));
}
export async function markGiftCardNotified(db: Executor, id: number, at = new Date()): Promise<void> {
  await db.update(giftCards).set({ notifiedAt: at }).where(eq(giftCards.id, id));
}

/** Where the card email goes (the recipient, else the buyer) and who gave it. */
export async function giftCardAddressees(db: Executor, c: GiftCard): Promise<{ to: string | null; from: string | null }> {
  const email = async (id: number | null) => (id ? (await db.select({ e: customers.email }).from(customers).where(eq(customers.id, id)).limit(1))[0]?.e ?? null : null);
  const buyer = (c.orderId ? (await db.select({ e: orders.email }).from(orders).where(eq(orders.id, c.orderId)).limit(1))[0]?.e ?? null : null) ?? (await email(c.customerId));
  const recipient = await email(c.recipientCustomerId);
  return { to: recipient ?? buyer, from: recipient && recipient !== buyer ? buyer : null };
}

/** Liquid variables of the `gift_card_issued` template. */
export function giftCardMailVars(shop: Shop, appUrl: string, c: GiftCard, from: string | null): Record<string, unknown> {
  return {
    gift_card: {
      balance: moneyOf(shop, c.balance, c.currency), initial_value: moneyOf(shop, c.initialValue, c.currency), code: formatGiftCardCode(c.code), last_characters: lastCharacters(c.code),
      url: `${shopUrl(shop, appUrl)}/gift_cards/${c.token}`, message: c.message, recipient_name: c.recipientName, sender_email: from, expires_on: c.expiresOn ? c.expiresOn.toISOString().slice(0, 10) : null,
    },
  };
}
