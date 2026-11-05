import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { customerAddresses, customers, orders } from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { subscribedColumns } from '../privacy/marketing-columns';
import { buildSearch, compare, dateCompare, idTerm, likeCi } from '../catalog/search';
import { errR, normalizeTags, okR, txResult, type Result } from '../catalog/common';
import { addComment, addEvent } from '../events';
import { addressColumns, type AddressInput } from '../orders/orders';

export type Customer = typeof customers.$inferSelect;
export type CustomerAddress = typeof customerAddresses.$inferSelect;

export async function getCustomer(db: Executor, shopId: number, id: number): Promise<Customer | null> {
  const [r] = await db.select().from(customers).where(and(eq(customers.shopId, shopId), eq(customers.id, id))).limit(1);
  return r ?? null;
}

export async function addCustomerComment(db: Db, shopId: number, id: number, message: string, staffId: number | null) {
  if (!(await getCustomer(db, shopId, id))) return errR(['id'], 'Customer does not exist');
  return addComment(db, shopId, 'customer', id, message, staffId);
}

export function listCustomerAddresses(db: Executor, shopId: number, customerId: number, o: { reverse?: boolean; offset: number; limit: number }): Promise<CustomerAddress[]> {
  return db.select().from(customerAddresses).where(and(eq(customerAddresses.shopId, shopId), eq(customerAddresses.customerId, customerId)))
    .orderBy(o.reverse ? desc(customerAddresses.id) : asc(customerAddresses.id)).limit(o.limit).offset(o.offset);
}

export async function getDefaultAddress(db: Executor, shopId: number, c: Customer): Promise<CustomerAddress | null> {
  if (c.defaultAddressId) {
    const [a] = await db.select().from(customerAddresses).where(and(eq(customerAddresses.shopId, shopId), eq(customerAddresses.id, c.defaultAddressId)));
    if (a) return a;
  }
  return (await listCustomerAddresses(db, shopId, c.id, { offset: 0, limit: 1 }))[0] ?? null;
}

/** Order count and net amount spent, computed from the orders table (cancelled and test orders excluded from spend). */
export async function customerStats(db: Executor, shopId: number, customerId: number): Promise<{ numberOfOrders: number; amountSpent: number }> {
  const [r] = await db.select({
    n: sql<number>`count(*)::int`,
    spent: sql<number>`coalesce(sum(case when ${orders.cancelledAt} is null and ${orders.financialStatus} in ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'PARTIALLY_PAID') then ${orders.total} - ${orders.totalRefunded} else 0 end), 0)::bigint`,
  }).from(orders).where(and(eq(orders.shopId, shopId), eq(orders.customerId, customerId)));
  return { numberOfOrders: r?.n ?? 0, amountSpent: Number(r?.spent ?? 0) };
}

const customerSearch = (q: string | null | undefined) => buildSearch(q, {
  fields: {
    email: (_o, v) => likeCi(customers.email, v, true),
    first_name: (_o, v) => likeCi(customers.firstName, v),
    last_name: (_o, v) => likeCi(customers.lastName, v),
    phone: (_o, v) => likeCi(customers.phone, v),
    id: (_o, v) => idTerm(customers.id, v),
    state: (_o, v) => sql`${customers.state} = ${v.toUpperCase()}`,
    tag: (_o, v) => sql`exists (select 1 from unnest(${customers.tags}) t where lower(t) = ${v.toLowerCase()})`,
    accepts_marketing: (_o, v) => sql`${customers.acceptsMarketing} = ${v === 'true'}`,
    verified_email: (_o, v) => sql`${customers.verifiedEmail} = ${v === 'true'}`,
    orders_count: (op, v) => (Number.isFinite(Number(v)) ? compare(sql`(select count(*) from orders o where o.customer_id = ${customers.id})`, op, Number(v)) : null),
    country: (_o, v) => sql`exists (select 1 from customer_addresses a where a.customer_id = ${customers.id} and (a.country_code ilike ${v} or a.country ilike ${v}))`,
    created_at: (op, v) => dateCompare(customers.createdAt, op, v),
    updated_at: (op, v) => dateCompare(customers.updatedAt, op, v),
  },
  text: (v) => {
    const like = `%${v.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return sql`(${customers.email} ilike ${like} or ${customers.firstName} ilike ${like} or ${customers.lastName} ilike ${like} or concat_ws(' ', ${customers.firstName}, ${customers.lastName}) ilike ${like} or ${customers.phone} ilike ${like})`;
  },
});

/** Whether one customer matches a saved customer search (a segment query). An empty query matches everyone. */
export async function customerMatchesQuery(db: Executor, shopId: number, customerId: number, query: string): Promise<boolean> {
  const rows = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.shopId, shopId), eq(customers.id, customerId), customerSearch(query))).limit(1);
  return rows.length > 0;
}

export type CustomerSortKey = 'CREATED_AT' | 'ID' | 'LOCATION' | 'NAME' | 'RELEVANCE' | 'UPDATED_AT';

export function listCustomers(db: Executor, shopId: number, o: { query?: string | null; sortKey?: CustomerSortKey; reverse?: boolean; offset: number; limit: number }): Promise<Customer[]> {
  const col = o.sortKey === 'CREATED_AT' ? customers.createdAt : o.sortKey === 'UPDATED_AT' ? customers.updatedAt
    : o.sortKey === 'NAME' ? sql`lower(concat_ws(' ', ${customers.lastName}, ${customers.firstName}))`
      : o.sortKey === 'LOCATION' ? sql`(select a.country from customer_addresses a where a.customer_id = ${customers.id} order by a.id limit 1)` : customers.id;
  const dir = o.reverse ? desc : asc;
  return db.select().from(customers).where(and(eq(customers.shopId, shopId), customerSearch(o.query))).orderBy(dir(col), dir(customers.id)).limit(o.limit).offset(o.offset);
}

export async function countCustomers(db: Executor, shopId: number, query?: string | null, limit = 10000): Promise<{ count: number; precision: 'EXACT' | 'AT_LEAST' }> {
  const rows = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.shopId, shopId), customerSearch(query))).limit(limit + 1);
  return rows.length > limit ? { count: limit, precision: 'AT_LEAST' } : { count: rows.length, precision: 'EXACT' };
}

export interface CustomerInput {
  email?: string | null; firstName?: string | null; lastName?: string | null; locale?: string | null; note?: string | null; phone?: string | null;
  tags?: string[] | null; taxExempt?: boolean | null; acceptsMarketing?: boolean | null;
  /** ShopMe extension: replaces the customer's addresses (the first one becomes the default). */
  addresses?: AddressInput[] | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9][0-9 ()./-]{4,19}$/;

async function validate(db: Executor, shopId: number, input: CustomerInput, selfId?: number): Promise<Result<null>> {
  const email = input.email?.trim().toLowerCase();
  if (email) {
    if (!EMAIL_RE.test(email)) return errR(['email'], 'Email is invalid', 'INVALID');
    const [dup] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.shopId, shopId), eq(customers.email, email)));
    if (dup && dup.id !== selfId) return errR(['email'], 'Email has already been taken', 'TAKEN');
  }
  if (input.phone && !PHONE_RE.test(input.phone.trim())) return errR(['phone'], 'Phone is invalid', 'INVALID');
  if (input.tags && normalizeTags(input.tags).length > 250) return errR(['tags'], 'Too many tags (maximum is 250)', 'INVALID');
  return okR(null);
}

async function replaceAddresses(tx: Executor, shopId: number, customerId: number, addresses: AddressInput[]) {
  await tx.update(customers).set({ defaultAddressId: null }).where(eq(customers.id, customerId));
  await tx.delete(customerAddresses).where(eq(customerAddresses.customerId, customerId));
  if (!addresses.length) return;
  const rows = await tx.insert(customerAddresses).values(addresses.map((a) => ({ shopId, customerId, ...addressColumns(a) }))).returning();
  await tx.update(customers).set({ defaultAddressId: rows[0]!.id }).where(eq(customers.id, customerId));
}

export async function createCustomer(db: Db, shopId: number, input: CustomerInput, staffId?: number | null): Promise<Result<Customer>> {
  if (!input.email?.trim() && !input.phone?.trim() && !input.firstName?.trim() && !input.lastName?.trim()) return errR(null, 'A name, phone number, or email address must be present');
  const v = await validate(db, shopId, input);
  if (!v.ok) return v;
  return txResult(db, async (tx) => {
    const [row] = await tx.insert(customers).values({
      shopId, email: input.email?.trim().toLowerCase() || null, firstName: input.firstName?.trim() || null, lastName: input.lastName?.trim() || null,
      phone: input.phone?.trim() || null, locale: input.locale ?? 'en', note: input.note ?? null, tags: normalizeTags(input.tags ?? []),
      taxExempt: !!input.taxExempt, ...subscribedColumns(!!input.acceptsMarketing), state: 'DISABLED',
    }).returning();
    if (input.addresses?.length) await replaceAddresses(tx, shopId, row!.id, input.addresses);
    await addEvent(tx, shopId, { subjectType: 'customer', subjectId: row!.id, verb: 'customers/create', message: 'Customer was created', authorStaffUserId: staffId });
    return okR((await getCustomer(tx, shopId, row!.id))!);
  });
}

export async function updateCustomer(db: Db, shopId: number, id: number, input: CustomerInput, staffId?: number | null): Promise<Result<Customer>> {
  const cur = await getCustomer(db, shopId, id);
  if (!cur) return errR(['id'], 'Customer does not exist');
  const v = await validate(db, shopId, input, id);
  if (!v.ok) return v;
  return txResult(db, async (tx) => {
    await tx.update(customers).set({
      ...(input.email !== undefined && { email: input.email?.trim().toLowerCase() || null }),
      ...(input.firstName !== undefined && { firstName: input.firstName?.trim() || null }), ...(input.lastName !== undefined && { lastName: input.lastName?.trim() || null }),
      ...(input.phone !== undefined && { phone: input.phone?.trim() || null }), ...(input.locale && { locale: input.locale }), ...(input.note !== undefined && { note: input.note }),
      ...(input.tags && { tags: normalizeTags(input.tags) }), ...(input.taxExempt != null && { taxExempt: input.taxExempt }),
      ...(input.acceptsMarketing != null && subscribedColumns(input.acceptsMarketing, cur?.emailMarketingState)), updatedAt: new Date(),
    }).where(eq(customers.id, id));
    if (input.addresses) await replaceAddresses(tx, shopId, id, input.addresses);
    await addEvent(tx, shopId, { subjectType: 'customer', subjectId: id, verb: 'customers/update', message: 'Customer was updated', authorStaffUserId: staffId });
    return okR((await getCustomer(tx, shopId, id))!);
  });
}

export async function deleteCustomer(db: Db, shopId: number, id: number): Promise<Result<number>> {
  if (!(await getCustomer(db, shopId, id))) return errR(['id'], "Customer can't be found");
  const [o] = await db.select({ n: sql<number>`count(*)::int` }).from(orders).where(and(eq(orders.shopId, shopId), eq(orders.customerId, id)));
  if ((o?.n ?? 0) > 0) return errR(null, "Customer can't be deleted because they have associated orders");
  await db.delete(customers).where(eq(customers.id, id));
  await addEvent(db, shopId, { subjectType: 'customer', subjectId: id, verb: 'customers/delete', message: 'Customer was deleted' });
  return okR(id);
}

export async function changeCustomerTags(db: Db, shopId: number, id: number, mode: 'add' | 'remove', tags: string[]): Promise<Result<Customer>> {
  const cur = await getCustomer(db, shopId, id);
  if (!cur) return errR(['id'], 'Customer does not exist');
  const drop = new Set(tags.flatMap((t) => t.split(',')).map((t) => t.trim().toLowerCase()));
  const next = mode === 'add' ? normalizeTags([...cur.tags, ...tags]) : cur.tags.filter((t) => !drop.has(t.toLowerCase()));
  if (next.length > 250) return errR(['tags'], 'Too many tags (maximum is 250)');
  const [row] = await db.update(customers).set({ tags: next, updatedAt: new Date() }).where(eq(customers.id, id)).returning();
  return okR(row!);
}

/* ------------------------------ address book ------------------------------ */

const noCustomer = errR(['customerId'], "Customer can't be found", 'CUSTOMER_DOES_NOT_EXIST');
const noAddress = errR(['addressId'], 'Address does not exist', 'ADDRESS_DOES_NOT_EXIST');

async function addressOf(db: Executor, customerId: number, addressId: number): Promise<CustomerAddress | null> {
  const [a] = await db.select().from(customerAddresses).where(and(eq(customerAddresses.customerId, customerId), eq(customerAddresses.id, addressId)));
  return a ?? null;
}

export async function addressBookAdd(db: Db, shopId: number, customerId: number, input: AddressInput, setAsDefault = false): Promise<Result<CustomerAddress>> {
  const c = await getCustomer(db, shopId, customerId);
  if (!c) return noCustomer;
  return txResult(db, async (tx) => {
    const [row] = await tx.insert(customerAddresses).values({ shopId, customerId, ...addressColumns(input) }).returning();
    if (setAsDefault || !c.defaultAddressId) await tx.update(customers).set({ defaultAddressId: row!.id, updatedAt: new Date() }).where(eq(customers.id, customerId));
    return okR(row!);
  });
}

export async function addressBookUpdate(db: Db, shopId: number, customerId: number, addressId: number, input: AddressInput, setAsDefault = false): Promise<Result<CustomerAddress>> {
  if (!(await getCustomer(db, shopId, customerId))) return noCustomer;
  if (!(await addressOf(db, customerId, addressId))) return noAddress;
  return txResult(db, async (tx) => {
    const [row] = await tx.update(customerAddresses).set({ ...addressColumns(input), updatedAt: new Date() }).where(eq(customerAddresses.id, addressId)).returning();
    if (setAsDefault) await tx.update(customers).set({ defaultAddressId: addressId, updatedAt: new Date() }).where(eq(customers.id, customerId));
    return okR(row!);
  });
}

/** Deleting the default address promotes the oldest remaining one. */
export async function addressBookDelete(db: Db, shopId: number, customerId: number, addressId: number): Promise<Result<number>> {
  const c = await getCustomer(db, shopId, customerId);
  if (!c) return noCustomer;
  if (!(await addressOf(db, customerId, addressId))) return noAddress;
  return txResult(db, async (tx) => {
    await tx.update(customers).set({ defaultAddressId: null }).where(and(eq(customers.id, customerId), eq(customers.defaultAddressId, addressId)));
    await tx.delete(customerAddresses).where(eq(customerAddresses.id, addressId));
    if (c.defaultAddressId === addressId) {
      const [next] = await tx.select({ id: customerAddresses.id }).from(customerAddresses).where(eq(customerAddresses.customerId, customerId)).orderBy(customerAddresses.id).limit(1);
      await tx.update(customers).set({ defaultAddressId: next?.id ?? null, updatedAt: new Date() }).where(eq(customers.id, customerId));
    }
    return okR(addressId);
  });
}

export async function addressBookSetDefault(db: Db, shopId: number, customerId: number, addressId: number): Promise<Result<Customer>> {
  if (!(await getCustomer(db, shopId, customerId))) return noCustomer;
  if (!(await addressOf(db, customerId, addressId))) return noAddress;
  await db.update(customers).set({ defaultAddressId: addressId, updatedAt: new Date() }).where(eq(customers.id, customerId));
  return okR((await getCustomer(db, shopId, customerId))!);
}

/** Last order of a customer (by creation). */
export async function lastOrderOf(db: Executor, shopId: number, customerId: number) {
  const [o] = await db.select().from(orders).where(and(eq(orders.shopId, shopId), eq(orders.customerId, customerId))).orderBy(sql`${orders.createdAt} desc`, sql`${orders.id} desc`).limit(1);
  return o ?? null;
}

export const customersByIds =(db: Executor, shopId: number, ids: number[]) =>
  ids.length ? db.select().from(customers).where(and(eq(customers.shopId, shopId), inArray(customers.id, ids))) : Promise.resolve([] as Customer[]);
