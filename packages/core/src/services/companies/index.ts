import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { companies, companyContacts, companyLocations, customers, draftOrders, orders } from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { errR, okR, txResult, type Result } from '../catalog/common';
import { addEvent } from '../events';

export type Company = typeof companies.$inferSelect;
export type CompanyLocation = typeof companyLocations.$inferSelect;
export type CompanyContact = typeof companyContacts.$inferSelect;

export interface CompanyInput { name?: string | null; externalId?: string | null; note?: string | null }
export interface CompanyLocationInput {
  name?: string | null; phone?: string | null; externalId?: string | null; note?: string | null; taxRegistrationId?: string | null; taxExempt?: boolean | null;
  paymentTermsDays?: number | null; address1?: string | null; address2?: string | null; city?: string | null; zip?: string | null; province?: string | null; countryCode?: string | null;
}

const clean = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : v.trim() || null);

/* ------------------------------ companies ------------------------------ */

export async function getCompany(db: Executor, shopId: number, id: number): Promise<Company | null> {
  const [r] = await db.select().from(companies).where(and(eq(companies.shopId, shopId), eq(companies.id, id))).limit(1);
  return r ?? null;
}

export function listCompanies(db: Executor, shopId: number, o: { query?: string | null; reverse?: boolean; sort?: 'NAME' | 'CREATED_AT'; offset: number; limit: number }): Promise<Company[]> {
  const term = o.query?.trim();
  const where = and(eq(companies.shopId, shopId), term ? or(ilike(companies.name, `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`), ilike(companies.externalId, `%${term}%`)) : undefined);
  const col = o.sort === 'CREATED_AT' ? companies.createdAt : sql`lower(${companies.name})`;
  const dir = o.reverse ? desc : asc;
  return db.select().from(companies).where(where).orderBy(dir(col), dir(companies.id)).limit(o.limit).offset(o.offset);
}

export async function countCompanies(db: Executor, shopId: number, query?: string | null): Promise<number> {
  const term = query?.trim();
  const where = and(eq(companies.shopId, shopId), term ? or(ilike(companies.name, `%${term}%`), ilike(companies.externalId, `%${term}%`)) : undefined);
  return (await db.select({ n: sql<number>`count(*)::int` }).from(companies).where(where))[0]?.n ?? 0;
}

async function externalTaken(db: Executor, shopId: number, externalId: string | null | undefined, selfId?: number) {
  if (!externalId) return false;
  const [d] = await db.select({ id: companies.id }).from(companies).where(and(eq(companies.shopId, shopId), eq(companies.externalId, externalId)));
  return !!d && d.id !== selfId;
}

/** Create a company with its first location (named like the company unless `location` says otherwise). */
export async function createCompany(db: Db, shopId: number, input: CompanyInput, location?: CompanyLocationInput | null): Promise<Result<{ company: Company; location: CompanyLocation }>> {
  const name = input.name?.trim() ?? '';
  if (!name) return errR(['company', 'name'], "Name can't be blank", 'BLANK');
  if (name.length > 255) return errR(['company', 'name'], 'Name is too long (maximum is 255 characters)', 'TOO_LONG');
  if (await externalTaken(db, shopId, clean(input.externalId))) return errR(['company', 'externalId'], 'External ID has already been taken', 'TAKEN');
  return txResult(db, async (tx) => {
    const [company] = await tx.insert(companies).values({ shopId, name, externalId: clean(input.externalId) ?? null, note: clean(input.note) ?? null }).returning();
    const loc = await insertLocation(tx, shopId, company!.id, { ...location, name: location?.name?.trim() || name });
    await addEvent(tx, shopId, { subjectType: 'company', subjectId: company!.id, verb: 'companies/create', message: 'Company was created' });
    return okR({ company: company!, location: loc });
  });
}

export async function updateCompany(db: Db, shopId: number, id: number, input: CompanyInput): Promise<Result<Company>> {
  const cur = await getCompany(db, shopId, id);
  if (!cur) return errR(['companyId'], 'Company does not exist', 'RESOURCE_NOT_FOUND');
  if (input.name !== undefined && !(input.name ?? '').trim()) return errR(['input', 'name'], "Name can't be blank", 'BLANK');
  if (input.externalId !== undefined && (await externalTaken(db, shopId, clean(input.externalId), id))) return errR(['input', 'externalId'], 'External ID has already been taken', 'TAKEN');
  const [row] = await db.update(companies).set({
    ...(input.name !== undefined && { name: input.name!.trim() }), ...(input.externalId !== undefined && { externalId: clean(input.externalId) ?? null }), ...(input.note !== undefined && { note: clean(input.note) ?? null }), updatedAt: new Date(),
  }).where(eq(companies.id, id)).returning();
  return okR(row!);
}

/** Deleting a company removes its locations and contact links; the customers stay, and orders keep the company name through their ids only. */
export async function deleteCompany(db: Db, shopId: number, id: number): Promise<Result<number>> {
  if (!(await getCompany(db, shopId, id))) return errR(['companyId'], 'Company does not exist', 'RESOURCE_NOT_FOUND');
  await db.delete(companies).where(eq(companies.id, id));
  return okR(id);
}

/* ------------------------------ locations ------------------------------ */

async function insertLocation(db: Executor, shopId: number, companyId: number, i: CompanyLocationInput): Promise<CompanyLocation> {
  const [row] = await db.insert(companyLocations).values({
    shopId, companyId, name: (i.name ?? '').trim() || 'Location', phone: clean(i.phone) ?? null, externalId: clean(i.externalId) ?? null, note: clean(i.note) ?? null,
    taxRegistrationId: clean(i.taxRegistrationId) ?? null, taxExempt: !!i.taxExempt, paymentTermsDays: i.paymentTermsDays ?? null,
    address1: clean(i.address1) ?? null, address2: clean(i.address2) ?? null, city: clean(i.city) ?? null, zip: clean(i.zip) ?? null, province: clean(i.province) ?? null, countryCode: clean(i.countryCode)?.toUpperCase() ?? null,
  }).returning();
  return row!;
}

const checkTerms = (d: number | null | undefined) => (d != null && (!Number.isInteger(d) || d < 0 || d > 365) ? errR(['input', 'paymentTermsDays'], 'Payment terms must be between 0 and 365 days', 'INVALID') : null);

export async function getCompanyLocation(db: Executor, shopId: number, id: number): Promise<CompanyLocation | null> {
  const [r] = await db.select().from(companyLocations).where(and(eq(companyLocations.shopId, shopId), eq(companyLocations.id, id))).limit(1);
  return r ?? null;
}
export const listCompanyLocations = (db: Executor, shopId: number, companyId: number): Promise<CompanyLocation[]> =>
  db.select().from(companyLocations).where(and(eq(companyLocations.shopId, shopId), eq(companyLocations.companyId, companyId))).orderBy(asc(companyLocations.id));

export async function createCompanyLocation(db: Db, shopId: number, companyId: number, input: CompanyLocationInput): Promise<Result<CompanyLocation>> {
  if (!(await getCompany(db, shopId, companyId))) return errR(['companyId'], 'Company does not exist', 'RESOURCE_NOT_FOUND');
  if (!(input.name ?? '').trim()) return errR(['input', 'name'], "Name can't be blank", 'BLANK');
  const bad = checkTerms(input.paymentTermsDays);
  if (bad) return bad;
  return okR(await insertLocation(db, shopId, companyId, input));
}

export async function updateCompanyLocation(db: Db, shopId: number, id: number, input: CompanyLocationInput): Promise<Result<CompanyLocation>> {
  const cur = await getCompanyLocation(db, shopId, id);
  if (!cur) return errR(['companyLocationId'], 'Company location does not exist', 'RESOURCE_NOT_FOUND');
  if (input.name !== undefined && !(input.name ?? '').trim()) return errR(['input', 'name'], "Name can't be blank", 'BLANK');
  const bad = checkTerms(input.paymentTermsDays);
  if (bad) return bad;
  const [row] = await db.update(companyLocations).set({
    ...(input.name !== undefined && { name: input.name!.trim() }), ...(input.phone !== undefined && { phone: clean(input.phone) ?? null }), ...(input.externalId !== undefined && { externalId: clean(input.externalId) ?? null }),
    ...(input.note !== undefined && { note: clean(input.note) ?? null }), ...(input.taxRegistrationId !== undefined && { taxRegistrationId: clean(input.taxRegistrationId) ?? null }), ...(input.taxExempt != null && { taxExempt: input.taxExempt }),
    ...(input.paymentTermsDays !== undefined && { paymentTermsDays: input.paymentTermsDays }),
    ...(input.address1 !== undefined && { address1: clean(input.address1) ?? null }), ...(input.address2 !== undefined && { address2: clean(input.address2) ?? null }), ...(input.city !== undefined && { city: clean(input.city) ?? null }),
    ...(input.zip !== undefined && { zip: clean(input.zip) ?? null }), ...(input.province !== undefined && { province: clean(input.province) ?? null }), ...(input.countryCode !== undefined && { countryCode: clean(input.countryCode)?.toUpperCase() ?? null }),
    updatedAt: new Date(),
  }).where(eq(companyLocations.id, id)).returning();
  return okR(row!);
}

export async function deleteCompanyLocation(db: Db, shopId: number, id: number): Promise<Result<number>> {
  const cur = await getCompanyLocation(db, shopId, id);
  if (!cur) return errR(['companyLocationId'], 'Company location does not exist', 'RESOURCE_NOT_FOUND');
  if ((await listCompanyLocations(db, shopId, cur.companyId)).length <= 1) return errR(['companyLocationId'], "A company needs at least one location", 'FAILED_TO_DELETE');
  const [o] = await db.select({ n: sql<number>`count(*)::int` }).from(orders).where(and(eq(orders.shopId, shopId), eq(orders.companyLocationId, id)));
  if ((o?.n ?? 0) > 0) return errR(['companyLocationId'], "A location with orders can't be deleted", 'FAILED_TO_DELETE');
  await db.delete(companyLocations).where(eq(companyLocations.id, id));
  return okR(id);
}

/* ------------------------------ contacts ------------------------------ */

export type ContactWithCustomer = CompanyContact & { isMain: boolean };

export async function listCompanyContacts(db: Executor, shopId: number, companyId: number): Promise<ContactWithCustomer[]> {
  const rows = await db.select().from(companyContacts).where(and(eq(companyContacts.shopId, shopId), eq(companyContacts.companyId, companyId))).orderBy(asc(companyContacts.id));
  const [co] = await db.select({ main: companies.mainContactId }).from(companies).where(eq(companies.id, companyId));
  return rows.map((r) => ({ ...r, isMain: co?.main === r.id }));
}
export async function getCompanyContact(db: Executor, shopId: number, id: number): Promise<CompanyContact | null> {
  const [r] = await db.select().from(companyContacts).where(and(eq(companyContacts.shopId, shopId), eq(companyContacts.id, id))).limit(1);
  return r ?? null;
}

/** Make an existing customer a buyer of the company. The first contact becomes the main contact. */
export async function assignCustomerAsContact(db: Db, shopId: number, companyId: number, customerId: number, title?: string | null): Promise<Result<CompanyContact>> {
  const co = await getCompany(db, shopId, companyId);
  if (!co) return errR(['companyId'], 'Company does not exist', 'RESOURCE_NOT_FOUND');
  const [cu] = await db.select({ id: customers.id, erasedAt: customers.erasedAt }).from(customers).where(and(eq(customers.shopId, shopId), eq(customers.id, customerId)));
  if (!cu || cu.erasedAt) return errR(['customerId'], "Customer can't be found", 'RESOURCE_NOT_FOUND');
  const [dup] = await db.select({ id: companyContacts.id }).from(companyContacts).where(and(eq(companyContacts.companyId, companyId), eq(companyContacts.customerId, customerId)));
  if (dup) return errR(['customerId'], 'The customer is already a contact of this company', 'CUSTOMER_ALREADY_A_CONTACT');
  return txResult(db, async (tx) => {
    const [row] = await tx.insert(companyContacts).values({ shopId, companyId, customerId, title: clean(title) ?? null }).returning();
    if (!co.mainContactId) await tx.update(companies).set({ mainContactId: row!.id, updatedAt: new Date() }).where(eq(companies.id, companyId));
    await addEvent(tx, shopId, { subjectType: 'customer', subjectId: customerId, verb: 'customers/company_assigned', message: `Added to company ${co.name}`, data: { companyId } });
    return okR(row!);
  });
}

export async function updateCompanyContact(db: Db, shopId: number, id: number, input: { title?: string | null }): Promise<Result<CompanyContact>> {
  if (!(await getCompanyContact(db, shopId, id))) return errR(['companyContactId'], 'Company contact does not exist', 'RESOURCE_NOT_FOUND');
  const [row] = await db.update(companyContacts).set({ ...(input.title !== undefined && { title: clean(input.title) ?? null }), updatedAt: new Date() }).where(eq(companyContacts.id, id)).returning();
  return okR(row!);
}

export async function setMainContact(db: Db, shopId: number, companyId: number, contactId: number): Promise<Result<Company>> {
  const co = await getCompany(db, shopId, companyId);
  const ct = await getCompanyContact(db, shopId, contactId);
  if (!co || !ct || ct.companyId !== companyId) return errR(['companyContactId'], 'Company contact does not exist', 'RESOURCE_NOT_FOUND');
  const [row] = await db.update(companies).set({ mainContactId: contactId, updatedAt: new Date() }).where(eq(companies.id, companyId)).returning();
  return okR(row!);
}

/** Remove a contact; the customer stays. The main contact passes to the oldest remaining contact. */
export async function removeCompanyContact(db: Db, shopId: number, contactId: number): Promise<Result<number>> {
  const ct = await getCompanyContact(db, shopId, contactId);
  if (!ct) return errR(['companyContactId'], 'Company contact does not exist', 'RESOURCE_NOT_FOUND');
  return txResult(db, async (tx) => {
    const co = await getCompany(tx, shopId, ct.companyId);
    await tx.delete(companyContacts).where(eq(companyContacts.id, contactId));
    if (co?.mainContactId === contactId) {
      const [next] = await tx.select({ id: companyContacts.id }).from(companyContacts).where(eq(companyContacts.companyId, ct.companyId)).orderBy(asc(companyContacts.id)).limit(1);
      await tx.update(companies).set({ mainContactId: next?.id ?? null, updatedAt: new Date() }).where(eq(companies.id, ct.companyId));
    }
    return okR(contactId);
  });
}

/** The companies a customer belongs to (with the contact row). */
export async function companiesOfCustomer(db: Executor, shopId: number, customerId: number): Promise<Array<{ company: Company; contact: CompanyContact }>> {
  const rows = await db.select({ company: companies, contact: companyContacts }).from(companyContacts).innerJoin(companies, eq(companies.id, companyContacts.companyId))
    .where(and(eq(companyContacts.shopId, shopId), eq(companyContacts.customerId, customerId))).orderBy(asc(companies.name));
  return rows;
}

export async function addCustomersToCompany(db: Db, shopId: number, companyId: number, customerIds: number[]): Promise<{ added: number; errors: Array<{ id: number; message: string }> }> {
  const out = { added: 0, errors: [] as Array<{ id: number; message: string }> };
  for (const id of customerIds) {
    const r = await assignCustomerAsContact(db, shopId, companyId, id);
    if (r.ok) out.added++; else out.errors.push({ id, message: r.errors[0]!.message });
  }
  return out;
}

/* ------------------------------ orders ------------------------------ */

export interface CompanyStats { orders: number; spent: number; draftOrders: number }
export async function companyStats(db: Executor, shopId: number, companyId: number): Promise<CompanyStats> {
  const [o] = await db.select({ n: sql<number>`count(*)::int`, spent: sql<number>`coalesce(sum(case when ${orders.cancelledAt} is null then ${orders.total} - ${orders.totalRefunded} else 0 end), 0)::bigint` })
    .from(orders).where(and(eq(orders.shopId, shopId), eq(orders.companyId, companyId)));
  const [d] = await db.select({ n: sql<number>`count(*)::int` }).from(draftOrders).where(and(eq(draftOrders.shopId, shopId), eq(draftOrders.companyId, companyId), eq(draftOrders.status, 'OPEN')));
  return { orders: o?.n ?? 0, spent: Number(o?.spent ?? 0), draftOrders: d?.n ?? 0 };
}

/** Validate a purchasing entity: the location and contact must belong to the company. */
export async function resolvePurchasingEntity(db: Executor, shopId: number, e: { companyId: number; companyContactId?: number | null; companyLocationId?: number | null }): Promise<Result<{ companyId: number; companyContactId: number | null; companyLocationId: number | null }>> {
  if (!(await getCompany(db, shopId, e.companyId))) return errR(['purchasingEntity', 'companyId'], 'Company does not exist', 'RESOURCE_NOT_FOUND');
  let contact: number | null = null, location: number | null = null;
  if (e.companyContactId) {
    const ct = await getCompanyContact(db, shopId, e.companyContactId);
    if (!ct || ct.companyId !== e.companyId) return errR(['purchasingEntity', 'companyContactId'], 'The contact does not belong to the company', 'INVALID');
    contact = ct.id;
  }
  if (e.companyLocationId) {
    const loc = await getCompanyLocation(db, shopId, e.companyLocationId);
    if (!loc || loc.companyId !== e.companyId) return errR(['purchasingEntity', 'companyLocationId'], 'The location does not belong to the company', 'INVALID');
    location = loc.id;
  } else {
    const [first] = await listCompanyLocations(db, shopId, e.companyId);
    location = first?.id ?? null;
  }
  return okR({ companyId: e.companyId, companyContactId: contact, companyLocationId: location });
}

export const companiesByIds = (db: Executor, shopId: number, ids: number[]) =>
  ids.length ? db.select().from(companies).where(and(eq(companies.shopId, shopId), inArray(companies.id, ids))) : Promise.resolve([] as Company[]);
