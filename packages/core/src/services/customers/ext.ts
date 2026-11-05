import { and, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import {
  carts, companyContacts, customerAddresses, customerTokens, customers, draftOrders, events, giftCards, metafields, orderAddresses, orders, sessions,
  storeCreditAccounts, storeCreditTransactions, storefrontEvents,
} from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { errR, normalizeTags, okR, txResult, type Result } from '../catalog/common';
import { addEvent } from '../events';
import { updateEmailMarketingConsent, updateSmsMarketingConsent } from '../privacy/marketing';
import { changeCustomerTags, getCustomer, updateCustomer, type Customer } from './customers';

/** Days between the erasure request and the anonymization (the merchant can cancel in between). */
export const ERASURE_DELAY_DAYS = 10;

/* ------------------------------ merge ------------------------------ */

/** Which of the two customers each field of the merged customer is taken from. */
export interface MergeChoices {
  firstNameFrom?: 'ONE' | 'TWO'; lastNameFrom?: 'ONE' | 'TWO'; emailFrom?: 'ONE' | 'TWO'; phoneFrom?: 'ONE' | 'TWO'; defaultAddressFrom?: 'ONE' | 'TWO';
  /** Replaces the union of both customers' tags. */
  tags?: string[] | null;
  /** Replaces the notes of both customers joined together. */
  note?: string | null;
}

export interface MergePreview {
  /** The customer that is kept (customer two) and the one that is merged into it and deleted (customer one). */
  keep: Customer; drop: Customer;
  fields: { firstName: string | null; lastName: string | null; email: string | null; phone: string | null; defaultAddressId: number | null; tags: string[]; note: string | null };
  moves: { orders: number; draftOrders: number; addresses: number; storeCreditAccounts: number; giftCards: number; timelineEvents: number; companyContacts: number };
  blockers: string[];
}

const count = async (db: Executor, table: any, where: any): Promise<number> => (await db.select({ n: sql<number>`count(*)::int` }).from(table).where(where))[0]?.n ?? 0;

/** What a merge would produce, without changing anything. Customer ONE is merged into customer TWO, which is kept. */
export async function previewCustomerMerge(db: Executor, shopId: number, oneId: number, twoId: number, choices: MergeChoices = {}): Promise<Result<MergePreview>> {
  if (oneId === twoId) return errR(['customerTwoId'], 'Choose two different customers', 'INVALID');
  const [one, two] = await Promise.all([getCustomer(db, shopId, oneId), getCustomer(db, shopId, twoId)]);
  if (!one) return errR(['customerOneId'], "Customer can't be found", 'INVALID_CUSTOMER_ID');
  if (!two) return errR(['customerTwoId'], "Customer can't be found", 'INVALID_CUSTOMER_ID');
  const blockers: string[] = [];
  if (one.erasedAt || two.erasedAt) blockers.push('ERASED_CUSTOMER');
  if (one.erasureScheduledAt || two.erasureScheduledAt) blockers.push('ERASURE_SCHEDULED');
  const pick = <T,>(from: 'ONE' | 'TWO' | undefined, a: T, b: T, fallbackToOther = true): T => {
    const first = from === 'ONE' ? a : b, second = from === 'ONE' ? b : a;
    return fallbackToOther && (first === null || first === '') ? second : first;
  };
  const notes = [two.note, one.note].filter((n): n is string => !!n && n.trim() !== '');
  const defaultAddressId = (choices.defaultAddressFrom === 'ONE' ? one.defaultAddressId : two.defaultAddressId) ?? one.defaultAddressId ?? two.defaultAddressId;
  const fields = {
    firstName: pick(choices.firstNameFrom, one.firstName, two.firstName), lastName: pick(choices.lastNameFrom, one.lastName, two.lastName),
    email: pick(choices.emailFrom, one.email, two.email), phone: pick(choices.phoneFrom, one.phone, two.phone), defaultAddressId,
    tags: choices.tags ? normalizeTags(choices.tags) : normalizeTags([...one.tags, ...two.tags]),
    note: choices.note !== undefined ? choices.note : notes.length ? [...new Set(notes)].join('\n\n') : null,
  };
  const moves = {
    orders: await count(db, orders, and(eq(orders.shopId, shopId), eq(orders.customerId, oneId))),
    draftOrders: await count(db, draftOrders, and(eq(draftOrders.shopId, shopId), eq(draftOrders.customerId, oneId))),
    addresses: await count(db, customerAddresses, eq(customerAddresses.customerId, oneId)),
    storeCreditAccounts: await count(db, storeCreditAccounts, eq(storeCreditAccounts.customerId, oneId)),
    giftCards: await count(db, giftCards, and(eq(giftCards.shopId, shopId), eq(giftCards.customerId, oneId))),
    timelineEvents: await count(db, events, and(eq(events.shopId, shopId), eq(events.subjectType, 'customer'), eq(events.subjectId, oneId))),
    companyContacts: await count(db, companyContacts, eq(companyContacts.customerId, oneId)),
  };
  return okR({ keep: two, drop: one, fields, moves, blockers });
}

/** Merge customer ONE into customer TWO: orders, drafts, addresses, notes, tags, store credit, gift cards and the timeline move over; ONE is deleted. */
export async function mergeCustomers(db: Db, shopId: number, oneId: number, twoId: number, choices: MergeChoices = {}, staffId?: number | null): Promise<Result<Customer>> {
  const prev = await previewCustomerMerge(db, shopId, oneId, twoId, choices);
  if (!prev.ok) return prev;
  const { keep, drop, fields, blockers } = prev.value;
  if (blockers.length) return errR(null, blockers.includes('ERASED_CUSTOMER') ? "An erased customer can't be merged" : "A customer with a scheduled data erasure can't be merged", blockers[0]);
  return txResult(db, async (tx) => {
    // Free the unique email before the kept customer may take the other one.
    await tx.update(customers).set({ email: null }).where(eq(customers.id, drop.id));
    // Orders and everything that points at the customer.
    await tx.update(orders).set({ customerId: keep.id }).where(and(eq(orders.shopId, shopId), eq(orders.customerId, drop.id)));
    await tx.update(draftOrders).set({ customerId: keep.id }).where(and(eq(draftOrders.shopId, shopId), eq(draftOrders.customerId, drop.id)));
    await tx.update(carts).set({ customerId: keep.id }).where(and(eq(carts.shopId, shopId), eq(carts.customerId, drop.id)));
    await tx.update(giftCards).set({ customerId: keep.id }).where(and(eq(giftCards.shopId, shopId), eq(giftCards.customerId, drop.id)));
    await tx.update(giftCards).set({ recipientCustomerId: keep.id }).where(and(eq(giftCards.shopId, shopId), eq(giftCards.recipientCustomerId, drop.id)));
    await tx.update(storefrontEvents).set({ customerId: keep.id }).where(and(eq(storefrontEvents.shopId, shopId), eq(storefrontEvents.customerId, drop.id)));
    await tx.update(events).set({ subjectId: keep.id }).where(and(eq(events.shopId, shopId), eq(events.subjectType, 'customer'), eq(events.subjectId, drop.id)));
    // Company memberships (skip the companies the kept customer already belongs to).
    const kept = await tx.select({ companyId: companyContacts.companyId }).from(companyContacts).where(eq(companyContacts.customerId, keep.id));
    const keptIds = kept.map((k) => k.companyId);
    await tx.update(companyContacts).set({ customerId: keep.id }).where(and(eq(companyContacts.customerId, drop.id), keptIds.length ? sql`${companyContacts.companyId} not in (${sql.join(keptIds.map((i) => sql`${i}`), sql`, `)})` : sql`true`));
    // Metafields: the kept customer's values win.
    const have = await tx.select({ ns: metafields.namespace, key: metafields.key }).from(metafields).where(and(eq(metafields.shopId, shopId), eq(metafields.ownerType, 'CUSTOMER'), eq(metafields.ownerId, keep.id)));
    const haveSet = new Set(have.map((h) => `${h.ns}.${h.key}`));
    const theirs = await tx.select().from(metafields).where(and(eq(metafields.shopId, shopId), eq(metafields.ownerType, 'CUSTOMER'), eq(metafields.ownerId, drop.id)));
    for (const m of theirs) {
      if (haveSet.has(`${m.namespace}.${m.key}`)) await tx.delete(metafields).where(eq(metafields.id, m.id));
      else await tx.update(metafields).set({ ownerId: keep.id }).where(eq(metafields.id, m.id));
    }
    // Store credit: same-currency accounts are combined, the others move over.
    const mine = await tx.select().from(storeCreditAccounts).where(eq(storeCreditAccounts.customerId, keep.id));
    for (const acc of await tx.select().from(storeCreditAccounts).where(eq(storeCreditAccounts.customerId, drop.id))) {
      const same = mine.find((m) => m.currency === acc.currency);
      if (same) {
        await tx.update(storeCreditTransactions).set({ accountId: same.id }).where(eq(storeCreditTransactions.accountId, acc.id));
        await tx.update(storeCreditAccounts).set({ balance: sql`${storeCreditAccounts.balance} + ${acc.balance}`, updatedAt: new Date() }).where(eq(storeCreditAccounts.id, same.id));
        await tx.delete(storeCreditAccounts).where(eq(storeCreditAccounts.id, acc.id));
      } else await tx.update(storeCreditAccounts).set({ customerId: keep.id }).where(eq(storeCreditAccounts.id, acc.id));
    }
    // Addresses; the kept customer keeps its default unless the choice (or an empty address book) says otherwise.
    await tx.update(customerAddresses).set({ customerId: keep.id }).where(eq(customerAddresses.customerId, drop.id));
    await tx.delete(sessions).where(eq(sessions.customerId, drop.id));
    await tx.delete(customerTokens).where(eq(customerTokens.customerId, drop.id));
    // The customer fields.
    const smsFrom = keep.smsMarketingState === 'SUBSCRIBED' || drop.smsMarketingState !== 'SUBSCRIBED' ? keep : drop;
    const emailFrom = keep.emailMarketingState === 'SUBSCRIBED' || drop.emailMarketingState !== 'SUBSCRIBED' ? keep : drop;
    await tx.update(customers).set({
      firstName: fields.firstName, lastName: fields.lastName, email: fields.email, phone: fields.phone, tags: fields.tags, note: fields.note,
      defaultAddressId: fields.defaultAddressId, taxExempt: keep.taxExempt || drop.taxExempt, verifiedEmail: keep.verifiedEmail || drop.verifiedEmail,
      acceptsMarketing: emailFrom.acceptsMarketing, emailMarketingState: emailFrom.emailMarketingState, emailMarketingOptInLevel: emailFrom.emailMarketingOptInLevel, emailMarketingUpdatedAt: emailFrom.emailMarketingUpdatedAt,
      smsMarketingState: smsFrom.smsMarketingState, smsMarketingOptInLevel: smsFrom.smsMarketingOptInLevel, smsMarketingUpdatedAt: smsFrom.smsMarketingUpdatedAt, smsMarketingCollectedFrom: smsFrom.smsMarketingCollectedFrom,
      createdAt: keep.createdAt < drop.createdAt ? keep.createdAt : drop.createdAt, updatedAt: new Date(),
    }).where(eq(customers.id, keep.id));
    await tx.delete(customers).where(eq(customers.id, drop.id));
    const name = [drop.firstName, drop.lastName].filter(Boolean).join(' ') || drop.email || `#${drop.id}`;
    await addEvent(tx, shopId, { subjectType: 'customer', subjectId: keep.id, verb: 'customers/merge', message: `Customer ${name} was merged into this customer`, authorStaffUserId: staffId ?? null, data: { mergedCustomerId: drop.id, mergedName: name } });
    return okR((await getCustomer(tx, shopId, keep.id))!);
  });
}

/* ------------------------------ bulk edit ------------------------------ */

export interface BulkCustomerPatch {
  addTags?: string[]; removeTags?: string[]; taxExempt?: boolean | null;
  emailMarketingState?: 'SUBSCRIBED' | 'UNSUBSCRIBED' | null; smsMarketingState?: 'SUBSCRIBED' | 'UNSUBSCRIBED' | null;
  /** `REPLACE` overwrites the note, `APPEND` adds a paragraph, `CLEAR` empties it. */
  noteMode?: 'REPLACE' | 'APPEND' | 'CLEAR' | null; note?: string | null;
}
export interface BulkCustomerResult { updated: number; errors: Array<{ id: number; message: string }> }

/** Apply the same change to many customers; each customer succeeds or fails on its own. */
export async function bulkUpdateCustomers(db: Db, shopId: number, ids: number[], patch: BulkCustomerPatch, staffId?: number | null): Promise<BulkCustomerResult> {
  const out: BulkCustomerResult = { updated: 0, errors: [] };
  const rows = ids.length ? await db.select().from(customers).where(and(eq(customers.shopId, shopId), inArray(customers.id, ids))) : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of [...new Set(ids)]) {
    const c = byId.get(id);
    if (!c) { out.errors.push({ id, message: "Customer can't be found" }); continue; }
    try {
      if (patch.addTags?.length) { const r = await changeCustomerTags(db, shopId, id, 'add', patch.addTags); if (!r.ok) throw new Error(r.errors[0]!.message); }
      if (patch.removeTags?.length) { const r = await changeCustomerTags(db, shopId, id, 'remove', patch.removeTags); if (!r.ok) throw new Error(r.errors[0]!.message); }
      const fields: Parameters<typeof updateCustomer>[3] = {};
      if (patch.taxExempt != null) fields.taxExempt = patch.taxExempt;
      if (patch.noteMode === 'CLEAR') fields.note = null;
      else if (patch.noteMode === 'REPLACE') fields.note = patch.note ?? '';
      else if (patch.noteMode === 'APPEND' && patch.note?.trim()) fields.note = [c.note, patch.note.trim()].filter(Boolean).join('\n\n');
      if (Object.keys(fields).length) { const r = await updateCustomer(db, shopId, id, fields, staffId); if (!r.ok) throw new Error(r.errors[0]!.message); }
      if (patch.emailMarketingState) {
        if (!c.email) throw new Error('An email address is needed to change email marketing consent');
        if (c.emailMarketingState !== patch.emailMarketingState) { const r = await updateEmailMarketingConsent(db, shopId, id, { marketingState: patch.emailMarketingState, marketingOptInLevel: patch.emailMarketingState === 'SUBSCRIBED' ? 'SINGLE_OPT_IN' : 'UNKNOWN' }); if (!r.ok) throw new Error(r.errors[0]!.message); }
      }
      if (patch.smsMarketingState) {
        if (!c.phone) throw new Error('A phone number is needed to change SMS marketing consent');
        if (c.smsMarketingState !== patch.smsMarketingState) { const r = await updateSmsMarketingConsent(db, shopId, id, { marketingState: patch.smsMarketingState, marketingOptInLevel: patch.smsMarketingState === 'SUBSCRIBED' ? 'SINGLE_OPT_IN' : 'UNKNOWN', consentCollectedFrom: 'OTHER' }); if (!r.ok) throw new Error(r.errors[0]!.message); }
      }
      out.updated++;
    } catch (e) { out.errors.push({ id, message: (e as Error).message }); }
  }
  return out;
}

/* ------------------------------ data request and erasure ------------------------------ */

/** Everything the store holds about one customer, as a JSON-ready object (a data access request). */
export async function customerDataExport(db: Executor, shopId: number, id: number): Promise<Record<string, unknown> | null> {
  const c = await getCustomer(db, shopId, id);
  if (!c) return null;
  const { passwordHash: _hash, ...customer } = c;
  const orderRows = await db.select().from(orders).where(and(eq(orders.shopId, shopId), eq(orders.customerId, id))).orderBy(orders.id);
  const orderIds = orderRows.map((o) => o.id);
  const addresses = orderIds.length ? await db.select().from(orderAddresses).where(inArray(orderAddresses.orderId, orderIds)) : [];
  const lines = orderIds.length ? await db.execute(sql`select order_id, title, variant_title, sku, quantity, unit_price, discounted_total from order_lines where order_id in (${sql.join(orderIds.map((i) => sql`${i}`), sql`, `)}) order by id`) : null;
  const lineRows = (lines ? ((lines as { rows?: unknown[] }).rows ?? (lines as unknown as unknown[])) : []) as Array<Record<string, unknown>>;
  const accounts = await db.select().from(storeCreditAccounts).where(eq(storeCreditAccounts.customerId, id));
  const credit = accounts.length ? await db.select().from(storeCreditTransactions).where(inArray(storeCreditTransactions.accountId, accounts.map((a) => a.id))) : [];
  return {
    exportedAt: new Date().toISOString(),
    customer,
    addresses: await db.select().from(customerAddresses).where(eq(customerAddresses.customerId, id)),
    orders: orderRows.map((o) => ({ ...o, addresses: addresses.filter((a) => a.orderId === o.id), lineItems: lineRows.filter((l) => Number(l.order_id) === o.id) })),
    draftOrders: await db.select().from(draftOrders).where(and(eq(draftOrders.shopId, shopId), eq(draftOrders.customerId, id))),
    storeCredit: { accounts, transactions: credit },
    giftCards: (await db.select().from(giftCards).where(and(eq(giftCards.shopId, shopId), eq(giftCards.customerId, id)))).map(({ token: _t, ...g }) => g),
    metafields: await db.select().from(metafields).where(and(eq(metafields.shopId, shopId), eq(metafields.ownerType, 'CUSTOMER'), eq(metafields.ownerId, id))),
    timeline: await db.select().from(events).where(and(eq(events.shopId, shopId), eq(events.subjectType, 'customer'), eq(events.subjectId, id))).orderBy(events.id),
    companies: await db.select().from(companyContacts).where(eq(companyContacts.customerId, id)),
  };
}

/** Schedule the anonymization of a customer's personal data (cancellable until then). */
export async function requestCustomerErasure(db: Db, shopId: number, id: number, staffId?: number | null, now = new Date()): Promise<Result<Customer>> {
  const c = await getCustomer(db, shopId, id);
  if (!c) return errR(['customerId'], "Customer can't be found", 'DOES_NOT_EXIST');
  if (c.erasedAt) return errR(['customerId'], 'Personal data of this customer was already erased', 'ALREADY_ERASED');
  if (c.erasureScheduledAt) return errR(['customerId'], 'An erasure is already scheduled for this customer', 'ALREADY_SCHEDULED');
  const at = new Date(now.getTime() + ERASURE_DELAY_DAYS * 86400_000);
  const [row] = await db.update(customers).set({ erasureScheduledAt: at, updatedAt: new Date() }).where(eq(customers.id, id)).returning();
  await addEvent(db, shopId, { subjectType: 'customer', subjectId: id, verb: 'customers/erasure_requested', message: `Erasure of personal data requested, scheduled for ${at.toISOString().slice(0, 10)}`, authorStaffUserId: staffId ?? null, data: { scheduledAt: at.toISOString() } });
  return okR(row!);
}

export async function cancelCustomerErasure(db: Db, shopId: number, id: number, staffId?: number | null): Promise<Result<Customer>> {
  const c = await getCustomer(db, shopId, id);
  if (!c) return errR(['customerId'], "Customer can't be found", 'DOES_NOT_EXIST');
  if (c.erasedAt) return errR(['customerId'], 'Personal data of this customer was already erased', 'ALREADY_ERASED');
  if (!c.erasureScheduledAt) return errR(['customerId'], 'No erasure is scheduled for this customer', 'NOT_SCHEDULED');
  const [row] = await db.update(customers).set({ erasureScheduledAt: null, updatedAt: new Date() }).where(eq(customers.id, id)).returning();
  await addEvent(db, shopId, { subjectType: 'customer', subjectId: id, verb: 'customers/erasure_cancelled', message: 'Erasure of personal data cancelled', authorStaffUserId: staffId ?? null });
  return okR(row!);
}

/**
 * Anonymize one customer now: contact details, addresses, notes, tags, consent, sign-in data and the personal timeline entries are removed.
 * Orders stay (they are accounting records) but lose the buyer's email, phone, name and street lines.
 */
export async function eraseCustomerPersonalData(db: Db, shopId: number, id: number): Promise<Result<Customer>> {
  const c = await getCustomer(db, shopId, id);
  if (!c) return errR(['customerId'], "Customer can't be found", 'DOES_NOT_EXIST');
  return txResult(db, async (tx) => {
    await tx.update(customers).set({ defaultAddressId: null }).where(eq(customers.id, id));
    await tx.delete(customerAddresses).where(eq(customerAddresses.customerId, id));
    const [row] = await tx.update(customers).set({
      email: null, firstName: null, lastName: null, phone: null, note: null, tags: [], taxExempt: false, passwordHash: null, consent: null, dataSaleOptOut: false, lastLoginAt: null, state: 'DISABLED',
      acceptsMarketing: false, emailMarketingState: 'REDACTED', emailMarketingOptInLevel: 'UNKNOWN', smsMarketingState: 'REDACTED', smsMarketingOptInLevel: 'UNKNOWN', smsMarketingCollectedFrom: null,
      erasureScheduledAt: null, erasedAt: new Date(), updatedAt: new Date(),
    }).where(eq(customers.id, id)).returning();
    const own = await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.shopId, shopId), eq(orders.customerId, id)));
    if (own.length) {
      const ids = own.map((o) => o.id);
      await tx.update(orders).set({ email: null, phone: null, note: null }).where(inArray(orders.id, ids));
      await tx.update(orderAddresses).set({ firstName: null, lastName: null, company: null, address1: null, address2: null, phone: null }).where(inArray(orderAddresses.orderId, ids));
    }
    await tx.update(draftOrders).set({ email: null, phone: null, shippingAddress: null, billingAddress: null }).where(and(eq(draftOrders.shopId, shopId), eq(draftOrders.customerId, id)));
    await tx.update(carts).set({ email: null, shippingAddress: null, billingAddress: null }).where(and(eq(carts.shopId, shopId), eq(carts.customerId, id)));
    await tx.update(storefrontEvents).set({ customerId: null }).where(and(eq(storefrontEvents.shopId, shopId), eq(storefrontEvents.customerId, id)));
    await tx.delete(metafields).where(and(eq(metafields.shopId, shopId), eq(metafields.ownerType, 'CUSTOMER'), eq(metafields.ownerId, id)));
    await tx.delete(customerTokens).where(eq(customerTokens.customerId, id));
    await tx.delete(sessions).where(eq(sessions.customerId, id));
    await tx.delete(companyContacts).where(eq(companyContacts.customerId, id));
    await tx.delete(events).where(and(eq(events.shopId, shopId), eq(events.subjectType, 'customer'), eq(events.subjectId, id)));
    await addEvent(tx, shopId, { subjectType: 'customer', subjectId: id, verb: 'customers/erased', message: 'Personal data was erased' });
    return okR(row!);
  });
}

/** The scheduled job: anonymize every customer whose erasure date has come. Returns how many were erased. */
export async function processDueCustomerErasures(db: Db, now = new Date()): Promise<number> {
  const due = await db.select({ id: customers.id, shopId: customers.shopId }).from(customers).where(and(isNotNull(customers.erasureScheduledAt), lte(customers.erasureScheduledAt, now), sql`${customers.erasedAt} is null`)).limit(200);
  let n = 0;
  for (const d of due) if ((await eraseCustomerPersonalData(db, d.shopId, d.id)).ok) n++;
  return n;
}

/** Customers with an unfinished erasure keep out of marketing lists; this helper keeps the check in one place. */
export const isErased = (c: Pick<Customer, 'erasedAt'>) => c.erasedAt != null;
