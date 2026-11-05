import { and, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { hash, verify } from '@node-rs/argon2';
import { customerAddresses, customerTokens, customers, orders, sessions } from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { errR, normalizeTags, okR, txResult, type Result } from '../catalog/common';
import { addEvent } from '../events';
import { addressColumns, getOrderDetail, type AddressInput, type Order, type OrderDetail } from '../orders/orders';
import { MIN_PASSWORD_LENGTH } from '../auth';
import { randomToken, sha256 } from '../crypto';
import type { Customer, CustomerAddress } from '../customers/customers';
import { emailConsentColumns, subscribedColumns } from '../privacy/marketing-columns';

/** Storefront accounts: registration, sign-in sessions, password reset / activation tokens, address book, order history, newsletter. */

export const CUSTOMER_SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
export const RESET_TOKEN_TTL_MS = 24 * 3600 * 1000;
export const ACTIVATE_TOKEN_TTL_MS = 7 * 24 * 3600 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DUMMY_HASH = hash('shopme-dummy-customer-password');

export const isValidEmail = (e: string) => EMAIL_RE.test(e.trim());
const lc = (e: string) => e.trim().toLowerCase();

const passwordProblem = (p: string | undefined | null): Result<never> | null =>
  !p ? errR(['password'], "Password can't be blank", 'BLANK') : p.length < MIN_PASSWORD_LENGTH ? errR(['password'], `Password is too short (minimum is ${MIN_PASSWORD_LENGTH} characters)`, 'TOO_SHORT') : p.length > 200 ? errR(['password'], 'Password is too long', 'TOO_LONG') : null;

async function byEmail(db: Executor, shopId: number, email: string): Promise<Customer | null> {
  const [c] = await db.select().from(customers).where(and(eq(customers.shopId, shopId), eq(customers.email, lc(email)))).limit(1);
  return c ?? null;
}

// --- registration & sign-in --------------------------------------------------------------------------------------------

export interface RegisterInput { email?: string; password?: string; firstName?: string | null; lastName?: string | null; acceptsMarketing?: boolean }
/** `activation` is set instead of an account when the email already belongs to a guest customer (they must prove ownership by email). */
export type RegisterOutcome = { customer: Customer; activationToken: null } | { customer: Customer; activationToken: string };

export async function registerCustomer(db: Db, shopId: number, input: RegisterInput): Promise<Result<RegisterOutcome>> {
  const email = lc(input.email ?? '');
  if (!email) return errR(['email'], "Email can't be blank", 'BLANK');
  if (!isValidEmail(email)) return errR(['email'], 'Email is invalid', 'INVALID');
  const pw = passwordProblem(input.password);
  if (pw) return pw;
  const existing = await byEmail(db, shopId, email);
  if (existing?.passwordHash) return errR(['email'], 'Email has already been taken', 'TAKEN');
  if (existing) return okR({ customer: existing, activationToken: await createCustomerToken(db, shopId, existing.id, 'activate') });
  return txResult(db, async (tx) => {
    const [row] = await tx.insert(customers).values({
      shopId, email, firstName: input.firstName?.trim() || null, lastName: input.lastName?.trim() || null, ...subscribedColumns(!!input.acceptsMarketing),
      state: 'ENABLED', passwordHash: await hash(input.password!), verifiedEmail: false,
    }).returning();
    await addEvent(tx, shopId, { subjectType: 'customer', subjectId: row!.id, verb: 'customers/create', message: 'Customer registered an account' });
    return okR({ customer: row!, activationToken: null });
  });
}

/** Verify email + password. Runs a dummy hash for unknown emails (uniform timing). */
export async function authenticateCustomer(db: Executor, shopId: number, email: string, password: string): Promise<Customer | null> {
  const c = email.trim() ? await byEmail(db, shopId, email) : null;
  if (!c?.passwordHash) { await verify(await DUMMY_HASH, password).catch(() => false); return null; }
  if (!(await verify(c.passwordHash, password).catch(() => false))) return null;
  await db.update(customers).set({ lastLoginAt: new Date() }).where(eq(customers.id, c.id));
  return c;
}

export async function createCustomerSession(db: Executor, input: { shopId: number; customerId: number; ip?: string; userAgent?: string }) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + CUSTOMER_SESSION_TTL_MS);
  await db.insert(sessions).values({ id: sha256(token), shopId: input.shopId, kind: 'customer', customerId: input.customerId, expiresAt, ip: input.ip, userAgent: input.userAgent?.slice(0, 255) });
  return { token, expiresAt };
}

export async function resolveCustomerSession(db: Executor, shopId: number, token: string): Promise<Customer | null> {
  const [r] = await db.select({ c: customers }).from(sessions).innerJoin(customers, eq(customers.id, sessions.customerId))
    .where(and(eq(sessions.id, sha256(token)), eq(sessions.kind, 'customer'), eq(sessions.shopId, shopId), gt(sessions.expiresAt, new Date()))).limit(1);
  return r?.c ?? null;
}

/** Drop every session of a customer (after a password change). */
export const destroyCustomerSessions = (db: Executor, customerId: number) => db.delete(sessions).where(and(eq(sessions.customerId, customerId), eq(sessions.kind, 'customer')));

// --- tokens: password reset and activation -----------------------------------------------------------------------------

/** New one-time token (earlier unused tokens of the same kind stop working). Returns the plaintext once. */
export async function createCustomerToken(db: Executor, shopId: number, customerId: number, kind: 'reset' | 'activate' | 'subscribe'): Promise<string> {
  const token = randomToken(24);
  await db.update(customerTokens).set({ usedAt: new Date() }).where(and(eq(customerTokens.customerId, customerId), eq(customerTokens.kind, kind), isNull(customerTokens.usedAt)));
  await db.insert(customerTokens).values({ shopId, customerId, kind, tokenHash: sha256(token), expiresAt: new Date(Date.now() + (kind === 'reset' ? RESET_TOKEN_TTL_MS : ACTIVATE_TOKEN_TTL_MS)) });
  return token;
}

async function validToken(db: Executor, shopId: number, customerId: number, kind: 'reset' | 'activate' | 'subscribe', token: string) {
  const [t] = await db.select().from(customerTokens).where(and(
    eq(customerTokens.shopId, shopId), eq(customerTokens.customerId, customerId), eq(customerTokens.kind, kind), eq(customerTokens.tokenHash, sha256(token)),
    isNull(customerTokens.usedAt), gt(customerTokens.expiresAt, new Date()),
  )).limit(1);
  return t ?? null;
}

export const isCustomerTokenValid = async (db: Executor, shopId: number, customerId: number, kind: 'reset' | 'activate' | 'subscribe', token: string) => !!(await validToken(db, shopId, customerId, kind, token));

/** Start a password reset. Null when the email has no account (callers answer the same either way). */
export async function requestPasswordReset(db: Executor, shopId: number, email: string): Promise<{ customer: Customer; token: string } | null> {
  const c = email.trim() ? await byEmail(db, shopId, email) : null;
  if (!c || !c.passwordHash) return null;
  return { customer: c, token: await createCustomerToken(db, shopId, c.id, 'reset') };
}

/** Set a new password with a reset or activation token; the customer is returned signed-in-ready. */
export async function setPasswordWithToken(db: Db, shopId: number, kind: 'reset' | 'activate', customerId: number, token: string, password: string, confirmation?: string | null): Promise<Result<Customer>> {
  const pw = passwordProblem(password);
  if (pw) return pw;
  if (confirmation != null && confirmation !== password) return errR(['password_confirmation'], "Password confirmation doesn't match", 'CONFIRMATION');
  const t = await validToken(db, shopId, customerId, kind, token);
  if (!t) return errR(['token'], 'This link is invalid or has expired', 'INVALID_TOKEN');
  return txResult(db, async (tx) => {
    await tx.update(customerTokens).set({ usedAt: new Date() }).where(eq(customerTokens.id, t.id));
    const [row] = await tx.update(customers).set({ passwordHash: await hash(password), state: 'ENABLED', verifiedEmail: true, updatedAt: new Date() }).where(eq(customers.id, customerId)).returning();
    await destroyCustomerSessions(tx, customerId);
    await addEvent(tx, shopId, { subjectType: 'customer', subjectId: customerId, verb: kind === 'reset' ? 'customers/password_reset' : 'customers/activate', message: kind === 'reset' ? 'Customer reset their password' : 'Customer activated their account' });
    return okR(row!);
  });
}

/** Merchant-side: invite a customer to create their account. Returns the activation token. */
export async function inviteCustomer(db: Db, shopId: number, customerId: number): Promise<Result<{ customer: Customer; token: string }>> {
  const [c] = await db.select().from(customers).where(and(eq(customers.shopId, shopId), eq(customers.id, customerId))).limit(1);
  if (!c) return errR(['id'], 'Customer does not exist', 'NOT_FOUND');
  if (!c.email) return errR(['email'], "Email can't be blank", 'BLANK');
  const token = await createCustomerToken(db, shopId, customerId, 'activate');
  if (!c.passwordHash) await db.update(customers).set({ state: 'INVITED' }).where(eq(customers.id, customerId));
  return okR({ customer: c, token });
}

// --- profile -----------------------------------------------------------------------------------------------------------

export async function updateOwnProfile(db: Db, shopId: number, customerId: number, input: { firstName?: string | null; lastName?: string | null; acceptsMarketing?: boolean }): Promise<Customer> {
  const [row] = await db.update(customers).set({
    ...(input.firstName !== undefined && { firstName: input.firstName?.trim() || null }), ...(input.lastName !== undefined && { lastName: input.lastName?.trim() || null }),
    ...(input.acceptsMarketing !== undefined && subscribedColumns(input.acceptsMarketing, undefined)), updatedAt: new Date(),
  }).where(and(eq(customers.shopId, shopId), eq(customers.id, customerId))).returning();
  return row!;
}

// --- address book ------------------------------------------------------------------------------------------------------

export interface CustomerAddressInput extends AddressInput { province?: string | null; country?: string | null }

function checkAddress(a: CustomerAddressInput): Result<null> {
  if (!a.address1?.trim()) return errR(['address1'], "Address can't be blank", 'BLANK');
  if (!a.city?.trim()) return errR(['city'], "City can't be blank", 'BLANK');
  if (!a.countryCode?.trim()) return errR(['country'], "Country can't be blank", 'BLANK');
  return okR(null);
}

const trimAll = (a: CustomerAddressInput): CustomerAddressInput => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, typeof v === 'string' ? v.trim().slice(0, 255) || null : v]));

export const listAddressBook = (db: Executor, shopId: number, customerId: number) =>
  db.select().from(customerAddresses).where(and(eq(customerAddresses.shopId, shopId), eq(customerAddresses.customerId, customerId))).orderBy(customerAddresses.id);

async function ownedAddress(db: Executor, shopId: number, customerId: number, id: number): Promise<CustomerAddress | null> {
  const [a] = await db.select().from(customerAddresses).where(and(eq(customerAddresses.shopId, shopId), eq(customerAddresses.customerId, customerId), eq(customerAddresses.id, id))).limit(1);
  return a ?? null;
}

const columns = (a: CustomerAddressInput) => ({ ...addressColumns(a), ...(a.province ? { province: a.province } : {}), ...(a.country ? { country: a.country } : {}) });

export async function addCustomerAddress(db: Db, shopId: number, customerId: number, input: CustomerAddressInput, makeDefault = false): Promise<Result<CustomerAddress>> {
  const a = trimAll(input);
  const v = checkAddress(a);
  if (!v.ok) return v;
  return txResult(db, async (tx) => {
    const [row] = await tx.insert(customerAddresses).values({ shopId, customerId, ...columns(a) }).returning();
    const [c] = await tx.select({ d: customers.defaultAddressId }).from(customers).where(eq(customers.id, customerId));
    if (makeDefault || !c?.d) await tx.update(customers).set({ defaultAddressId: row!.id }).where(eq(customers.id, customerId));
    return okR(row!);
  });
}

export async function updateCustomerAddress(db: Db, shopId: number, customerId: number, id: number, input: CustomerAddressInput, makeDefault = false): Promise<Result<CustomerAddress>> {
  if (!(await ownedAddress(db, shopId, customerId, id))) return errR(['id'], 'Address does not exist', 'NOT_FOUND');
  const a = trimAll(input);
  const v = checkAddress(a);
  if (!v.ok) return v;
  const [row] = await db.update(customerAddresses).set({ ...columns(a), updatedAt: new Date() }).where(eq(customerAddresses.id, id)).returning();
  if (makeDefault) await db.update(customers).set({ defaultAddressId: id }).where(eq(customers.id, customerId));
  return okR(row!);
}

export async function deleteCustomerAddress(db: Db, shopId: number, customerId: number, id: number): Promise<Result<number>> {
  if (!(await ownedAddress(db, shopId, customerId, id))) return errR(['id'], 'Address does not exist', 'NOT_FOUND');
  await db.update(customers).set({ defaultAddressId: null }).where(and(eq(customers.id, customerId), eq(customers.defaultAddressId, id)));
  await db.delete(customerAddresses).where(eq(customerAddresses.id, id));
  const [c] = await db.select({ d: customers.defaultAddressId }).from(customers).where(eq(customers.id, customerId));
  if (!c?.d) {
    const [next] = await listAddressBook(db, shopId, customerId);
    if (next) await db.update(customers).set({ defaultAddressId: next.id }).where(eq(customers.id, customerId));
  }
  return okR(id);
}

// --- order history -----------------------------------------------------------------------------------------------------

export const listCustomerOrders = (db: Executor, shopId: number, customerId: number, o: { offset?: number; limit?: number } = {}): Promise<Order[]> =>
  db.select().from(orders).where(and(eq(orders.shopId, shopId), eq(orders.customerId, customerId))).orderBy(desc(orders.processedAt), desc(orders.id)).limit(o.limit ?? 100).offset(o.offset ?? 0);

/** One order of the signed-in customer (never another customer's, whatever the email). */
export async function getCustomerOrder(db: Executor, shopId: number, customerId: number, orderId: number): Promise<{ order: Order; detail: OrderDetail } | null> {
  const [order] = await db.select().from(orders).where(and(eq(orders.shopId, shopId), eq(orders.customerId, customerId), eq(orders.id, orderId))).limit(1);
  return order ? { order, detail: await getOrderDetail(db, shopId, order.id) } : null;
}

export async function countCustomerOrders(db: Executor, shopId: number, customerId: number): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(orders).where(and(eq(orders.shopId, shopId), eq(orders.customerId, customerId), ne(orders.financialStatus, 'VOIDED')));
  return r?.n ?? 0;
}

// --- newsletter --------------------------------------------------------------------------------------------------------

/** `form 'customer'`: subscribe an email to marketing. Creates the customer (tagged `newsletter`) or just flips the consent flag. */
export async function subscribeNewsletter(db: Db, shopId: number, input: { email?: string; tags?: string[]; firstName?: string | null; lastName?: string | null }): Promise<Result<Customer>> {
  const email = lc(input.email ?? '');
  if (!email) return errR(['email'], "Email can't be blank", 'BLANK');
  if (!isValidEmail(email)) return errR(['email'], 'Email is invalid', 'INVALID');
  const tags = normalizeTags(input.tags?.length ? input.tags : ['newsletter']);
  const cur = await byEmail(db, shopId, email);
  if (cur) {
    const [row] = await db.update(customers).set({ ...(cur.emailMarketingState === 'SUBSCRIBED' ? {} : emailConsentColumns('SUBSCRIBED', 'SINGLE_OPT_IN')), tags: normalizeTags([...cur.tags, ...tags]), updatedAt: new Date() }).where(eq(customers.id, cur.id)).returning();
    return okR(row!);
  }
  const [row] = await db.insert(customers).values({ shopId, email, firstName: input.firstName?.trim() || null, lastName: input.lastName?.trim() || null, ...emailConsentColumns('SUBSCRIBED', 'SINGLE_OPT_IN'), tags }).returning();
  await addEvent(db, shopId, { subjectType: 'customer', subjectId: row!.id, verb: 'customers/create', message: 'Customer subscribed to the newsletter' });
  return okR(row!);
}
