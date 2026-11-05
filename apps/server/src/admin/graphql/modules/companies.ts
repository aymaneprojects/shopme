/**
 * B2B companies (first version): a company has locations (address, tax and payment terms) and contacts (customers). Shopify names for
 * the objects and mutations; the `purchasingEntity` of orders and drafts carries the company, contact and location. Not built: catalogs
 * per location, ordering approval and company-level store credit.
 */
import {
  addCustomersToCompany, assignCustomerAsContact, companiesOfCustomer, companyStats, countCompanies, createCompany, createCompanyLocation, deleteCompany, deleteCompanyLocation, getCompany, getCompanyContact,
  getCompanyLocation, getCustomer, getDraftOrder, getShop, listCompanies, listCompanyContacts, listCompanyLocations, listOrders, countOrders, removeCompanyContact, resolvePurchasingEntity, setMainContact,
  updateCompany, updateCompanyContact, updateCompanyLocation, updateDraftOrder,
  schema, type Company, type CompanyContact, type CompanyLocation,
} from '@shopme/core';
import { eq } from 'drizzle-orm';
import { parseId, toGid } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { ConnectionArgs, defineConnection, paginate, paginateArray } from '../types/connection';
import { definePayload } from '../types/errors';
import { Count, MoneyV2, moneyV2 } from '../types/money';
import { Node, legacyId, registerNode } from '../types/node';
import { shopOf } from '../types/catalog';
import { Customer_, OrderConnection, Order_ } from '../types/sales';
import { DraftOrder } from './draft-orders';

const staffId = (ctx: GraphQLContext) => (ctx.auth.kind === 'session' ? ctx.auth.user.id : null);
const gid = (type: string) => (v: unknown) => parseId(String(v), type);
const notFound = (field: string, message: string) => [{ field: [field], message, code: 'RESOURCE_NOT_FOUND' }];

const Company_ = builder.objectRef<Company>('Company');
const Location_ = builder.objectRef<CompanyLocation>('CompanyLocation');
const Contact_ = builder.objectRef<CompanyContact & { isMain?: boolean }>('CompanyContact');
const ContactConnection = defineConnection('CompanyContact', Contact_);
const LocationConnection = defineConnection('CompanyLocation', Location_);
const CompanyConnection = defineConnection('Company', Company_);

const PaymentTerms = builder.objectRef<{ days: number }>('ShopmePaymentTerms').implement({
  fields: (t) => ({ days: t.exposeInt('days'), name: t.string({ resolve: (p) => (p.days === 0 ? 'Due on receipt' : `Net ${p.days}`) }) }),
});

Company_.implement({
  interfaces: [Node],
  fields: (t) => ({
    legacyResourceId: t.field({ type: 'UnsignedInt64', resolve: legacyId }),
    name: t.exposeString('name'), externalId: t.exposeString('externalId', { nullable: true }), note: t.exposeString('note', { nullable: true }),
    createdAt: t.field({ type: 'DateTime', resolve: (c) => c.createdAt }), updatedAt: t.field({ type: 'DateTime', resolve: (c) => c.updatedAt }),
    customerSince: t.field({ type: 'DateTime', resolve: (c) => c.createdAt }),
    mainContact: t.field({ type: Contact_, nullable: true, resolve: (c, _a, ctx) => (c.mainContactId ? getCompanyContact(ctx.db, ctx.shopId, c.mainContactId) : null) }),
    contacts: t.field({ type: ContactConnection, args: ConnectionArgs, resolve: async (c, a, ctx) => paginateArray(a, await listCompanyContacts(ctx.db, ctx.shopId, c.id)) }),
    contactsCount: t.field({ type: Count, nullable: true, resolve: async (c, _a, ctx) => ({ count: (await listCompanyContacts(ctx.db, ctx.shopId, c.id)).length, precision: 'EXACT' as const }) }),
    locations: t.field({ type: LocationConnection, args: ConnectionArgs, resolve: async (c, a, ctx) => paginateArray(a, await listCompanyLocations(ctx.db, ctx.shopId, c.id)) }),
    locationsCount: t.field({ type: Count, nullable: true, resolve: async (c, _a, ctx) => ({ count: (await listCompanyLocations(ctx.db, ctx.shopId, c.id)).length, precision: 'EXACT' as const }) }),
    ordersCount: t.field({ type: Count, nullable: true, resolve: async (c, _a, ctx) => ({ count: (await companyStats(ctx.db, ctx.shopId, c.id)).orders, precision: 'EXACT' as const }) }),
    totalSpent: t.field({ type: MoneyV2, resolve: async (c, _a, ctx) => moneyV2((await companyStats(ctx.db, ctx.shopId, c.id)).spent, (await shopOf(ctx)).currency) }),
    draftOrdersCount: t.field({ type: Count, nullable: true, resolve: async (c, _a, ctx) => ({ count: (await companyStats(ctx.db, ctx.shopId, c.id)).draftOrders, precision: 'EXACT' as const }) }),
    orders: t.field({
      type: OrderConnection, args: { ...ConnectionArgs, query: t.arg.string() },
      resolve: (c, a, ctx) => {
        requireScope(ctx, 'read_orders');
        const query = `company_id:${c.id}${a.query ? ` ${a.query}` : ''}`;
        return paginate(a, { fetch: ({ offset, limit }) => listOrders(ctx.db, ctx.shopId, { query, sortKey: 'ID', reverse: true, offset, limit }), total: async () => (await countOrders(ctx.db, ctx.shopId, query)).count });
      },
    }),
  }),
});
registerNode('Company', (ctx, id) => getCompany(ctx.db, ctx.shopId, id));

const Address = builder.objectRef<CompanyLocation>('ShopmeCompanyAddress').implement({
  fields: (t) => ({
    address1: t.exposeString('address1', { nullable: true }), address2: t.exposeString('address2', { nullable: true }), city: t.exposeString('city', { nullable: true }),
    zip: t.exposeString('zip', { nullable: true }), province: t.exposeString('province', { nullable: true }), countryCode: t.exposeString('countryCode', { nullable: true }),
  }),
});
Location_.implement({
  interfaces: [Node],
  fields: (t) => ({
    legacyResourceId: t.field({ type: 'UnsignedInt64', resolve: legacyId }),
    name: t.exposeString('name'), phone: t.exposeString('phone', { nullable: true }), externalId: t.exposeString('externalId', { nullable: true }), note: t.exposeString('note', { nullable: true }),
    taxRegistrationId: t.exposeString('taxRegistrationId', { nullable: true }), taxExempt: t.field({ type: 'Boolean', resolve: (l) => l.taxExempt, description: 'ShopMe: orders for this location charge no tax.' }),
    createdAt: t.field({ type: 'DateTime', resolve: (l) => l.createdAt }), updatedAt: t.field({ type: 'DateTime', resolve: (l) => l.updatedAt }),
    company: t.field({ type: Company_, resolve: async (l, _a, ctx) => (await getCompany(ctx.db, ctx.shopId, l.companyId))! }),
    billingAddress: t.field({ type: Address, nullable: true, resolve: (l) => (l.address1 || l.city || l.countryCode ? l : null) }),
    shippingAddress: t.field({ type: Address, nullable: true, resolve: (l) => (l.address1 || l.city || l.countryCode ? l : null) }),
    buyerExperienceConfiguration: t.field({
      type: builder.objectRef<CompanyLocation>('BuyerExperienceConfiguration').implement({
        fields: (t2) => ({ paymentTermsTemplate: t2.field({ type: PaymentTerms, nullable: true, resolve: (l) => (l.paymentTermsDays == null ? null : { days: l.paymentTermsDays }) }) }),
      }),
      nullable: true, resolve: (l) => l,
    }),
    ordersCount: t.field({
      type: Count, nullable: true, resolve: async (l, _a, ctx) => ({ count: (await listOrdersAt(ctx, l.id)).length, precision: 'EXACT' as const }),
    }),
  }),
});
registerNode('CompanyLocation', (ctx, id) => getCompanyLocation(ctx.db, ctx.shopId, id));
/** Orders of one location (the search syntax only filters on the company, so filter the company's orders). */
async function listOrdersAt(ctx: GraphQLContext, locationId: number) {
  const rows = await listOrders(ctx.db, ctx.shopId, { query: `company_id:${(await getCompanyLocation(ctx.db, ctx.shopId, locationId))!.companyId}`, sortKey: 'ID', reverse: true, offset: 0, limit: 250 });
  return rows.filter((o) => o.companyLocationId === locationId);
}

Contact_.implement({
  interfaces: [Node],
  fields: (t) => ({
    title: t.exposeString('title', { nullable: true }), isMainContact: t.boolean({ resolve: async (c, _a, ctx) => (await getCompany(ctx.db, ctx.shopId, c.companyId))?.mainContactId === c.id }),
    createdAt: t.field({ type: 'DateTime', resolve: (c) => c.createdAt }),
    customer: t.field({ type: Customer_, resolve: async (c, _a, ctx) => (await getCustomer(ctx.db, ctx.shopId, c.customerId))! }),
    company: t.field({ type: Company_, resolve: async (c, _a, ctx) => (await getCompany(ctx.db, ctx.shopId, c.companyId))! }),
  }),
});
registerNode('CompanyContact', (ctx, id) => getCompanyContact(ctx.db, ctx.shopId, id));

/* ------------------------------ on customers, orders and drafts ------------------------------ */

builder.objectFields(Customer_, (t) => ({
  shopmeCompanies: t.field({
    type: [Contact_], description: 'ShopMe: the companies this customer buys for (one contact per company).',
    resolve: async (c, _a, ctx) => (await companiesOfCustomer(ctx.db, ctx.shopId, c.id)).map((x) => x.contact),
  }),
}));

const PurchasingCompany = builder.objectRef<{ companyId: number; contactId: number | null; locationId: number | null }>('PurchasingCompany').implement({
  fields: (t) => ({
    company: t.field({ type: Company_, nullable: true, resolve: (p, _a, ctx) => getCompany(ctx.db, ctx.shopId, p.companyId) }),
    contact: t.field({ type: Contact_, nullable: true, resolve: (p, _a, ctx) => (p.contactId ? getCompanyContact(ctx.db, ctx.shopId, p.contactId) : null) }),
    location: t.field({ type: Location_, nullable: true, resolve: (p, _a, ctx) => (p.locationId ? getCompanyLocation(ctx.db, ctx.shopId, p.locationId) : null) }),
  }),
});
builder.objectFields(Order_, (t) => ({
  shopmePurchasingCompany: t.field({
    type: PurchasingCompany, nullable: true, description: 'ShopMe: the B2B company, contact and location this order was placed for.',
    resolve: (o) => (o.companyId ? { companyId: o.companyId, contactId: o.companyContactId, locationId: o.companyLocationId } : null),
  }),
}));
builder.objectFields(DraftOrder, (t) => ({
  shopmePurchasingCompany: t.field({
    type: PurchasingCompany, nullable: true, description: 'ShopMe: the B2B company, contact and location of this draft.',
    resolve: async (v, _a, ctx) => { const d = await getDraftOrder(ctx.db, ctx.shopId, v.id); return d?.companyId ? { companyId: d.companyId, contactId: d.companyContactId, locationId: d.companyLocationId } : null; },
  }),
}));

/* ------------------------------ queries ------------------------------ */

const SortKeys = builder.enumType('CompanySortKeys', { values: ['NAME', 'CREATED_AT', 'ID', 'RELEVANCE', 'UPDATED_AT'] as const });

builder.queryFields((t) => ({
  company: t.field({ type: Company_, nullable: true, args: { id: t.arg.id({ required: true }) }, resolve: (_r, a, ctx) => { requireScope(ctx, 'read_companies'); const id = gid('Company')(a.id); return id ? getCompany(ctx.db, ctx.shopId, id) : null; } }),
  companyLocation: t.field({ type: Location_, nullable: true, args: { id: t.arg.id({ required: true }) }, resolve: (_r, a, ctx) => { requireScope(ctx, 'read_companies'); const id = gid('CompanyLocation')(a.id); return id ? getCompanyLocation(ctx.db, ctx.shopId, id) : null; } }),
  companies: t.field({
    type: CompanyConnection, args: { ...ConnectionArgs, query: t.arg.string(), sortKey: t.arg({ type: SortKeys, defaultValue: 'NAME' }) },
    resolve: (_r, a, ctx) => {
      requireScope(ctx, 'read_companies');
      const sort = a.sortKey === 'CREATED_AT' || a.sortKey === 'ID' || a.sortKey === 'UPDATED_AT' ? 'CREATED_AT' : 'NAME';
      return paginate(a, { fetch: ({ offset, limit }) => listCompanies(ctx.db, ctx.shopId, { query: a.query, sort, reverse: !!a.reverse, offset, limit }), total: () => countCompanies(ctx.db, ctx.shopId, a.query) });
    },
  }),
  companiesCount: t.field({
    type: Count, nullable: true, args: { limit: t.arg.int() },
    resolve: async (_r, _a, ctx) => { requireScope(ctx, 'read_companies'); return { count: await countCompanies(ctx.db, ctx.shopId), precision: 'EXACT' as const }; },
  }),
}));

/* ------------------------------ mutations ------------------------------ */

const CompanyInput = builder.inputType('CompanyInput', { fields: (t) => ({ name: t.string(), note: t.string(), externalId: t.string() }) });
const LocationInput = builder.inputType('CompanyLocationInput', {
  fields: (t) => ({
    name: t.string(), phone: t.string(), externalId: t.string(), note: t.string(), taxRegistrationId: t.string(), taxExempt: t.boolean(),
    paymentTermsDays: t.int({ description: 'ShopMe: net days (0 = due on receipt); empty for no terms.' }),
    address1: t.string(), address2: t.string(), city: t.string(), zip: t.string(), province: t.string(), countryCode: t.string(),
  }),
});
const CompanyCreateInput = builder.inputType('CompanyCreateInput', { fields: (t) => ({ company: t.field({ type: CompanyInput, required: true }), companyLocation: t.field({ type: LocationInput }), customerId: t.id({ description: 'ShopMe: make this customer the first contact.' }) }) });
const ContactInput = builder.inputType('CompanyContactInput', { fields: (t) => ({ title: t.string() }) });

const CompanyPayload = (name: string) => definePayload<{ company: Company | null }>(name, (t) => ({ company: t.field({ type: Company_, nullable: true, resolve: (p) => p.company }) }));
const LocationPayload = (name: string) => definePayload<{ companyLocation: CompanyLocation | null }>(name, (t) => ({ companyLocation: t.field({ type: Location_, nullable: true, resolve: (p) => p.companyLocation }) }));
const CreatePayload = CompanyPayload('CompanyCreatePayload');
const UpdatePayload = CompanyPayload('CompanyUpdatePayload');
const DeletePayload = definePayload<{ deletedCompanyId: string | null }>('CompanyDeletePayload', (t) => ({ deletedCompanyId: t.id({ nullable: true, resolve: (p) => p.deletedCompanyId }) }));
const BulkDeletePayload = definePayload<{ deletedCompanyIds: string[] }>('CompaniesDeletePayload', (t) => ({ deletedCompanyIds: t.idList({ resolve: (p) => p.deletedCompanyIds }) }));
const LocCreatePayload = LocationPayload('CompanyLocationCreatePayload');
const LocUpdatePayload = LocationPayload('CompanyLocationUpdatePayload');
const LocDeletePayload = definePayload<{ deletedCompanyLocationId: string | null }>('CompanyLocationDeletePayload', (t) => ({ deletedCompanyLocationId: t.id({ nullable: true, resolve: (p) => p.deletedCompanyLocationId }) }));
const AssignPayload = definePayload<{ companyContact: CompanyContact | null }>('CompanyAssignCustomerAsContactPayload', (t) => ({ companyContact: t.field({ type: Contact_, nullable: true, resolve: (p) => p.companyContact }) }));
const ContactUpdatePayload = definePayload<{ companyContact: CompanyContact | null }>('CompanyContactUpdatePayload', (t) => ({ companyContact: t.field({ type: Contact_, nullable: true, resolve: (p) => p.companyContact }) }));
const RemovePayload = definePayload<{ removedCompanyContactId: string | null }>('CompanyContactRemoveFromCompanyPayload', (t) => ({ removedCompanyContactId: t.id({ nullable: true, resolve: (p) => p.removedCompanyContactId }) }));
const MainPayload = CompanyPayload('CompanyAssignMainContactPayload');
const AddCustomersPayload = definePayload<{ addedCount: number; failures: Array<{ id: number; message: string }> }>('ShopmeCompanyAddCustomersPayload', (t) => ({
  addedCount: t.exposeInt('addedCount'),
  failures: t.field({ type: [builder.objectRef<{ id: number; message: string }>('ShopmeCompanyAddFailure').implement({ fields: (t2) => ({ customerId: t2.id({ resolve: (e) => toGid('Customer', e.id) }), message: t2.exposeString('message') }) })], resolve: (p) => p.failures }),
}));
const DraftCompanyPayload = definePayload<{ draftOrderId: string | null }>('ShopmeDraftOrderSetCompanyPayload', (t) => ({ draftOrderId: t.id({ nullable: true, resolve: (p) => p.draftOrderId }) }));

const withPrefix = <T extends { field?: string[] | null }>(errs: T[], prefix: string[]) => errs.map((e) => ({ ...e, field: [...prefix, ...(e.field ?? []).filter((f) => f !== prefix[prefix.length - 1])] }));

builder.mutationFields((t) => ({
  companyCreate: t.field({
    type: CreatePayload, args: { input: t.arg({ type: CompanyCreateInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_companies');
      const r = await createCompany(ctx.db, ctx.shopId, input.company, input.companyLocation);
      if (!r.ok) return { company: null, userErrors: withPrefix(r.errors, ['input']) };
      const customer = input.customerId ? gid('Customer')(input.customerId) : null;
      if (customer) await assignCustomerAsContact(ctx.db, ctx.shopId, r.value.company.id, customer);
      return { company: (await getCompany(ctx.db, ctx.shopId, r.value.company.id))!, userErrors: [] };
    },
  }),
  companyUpdate: t.field({
    type: UpdatePayload, args: { companyId: t.arg.id({ required: true }), input: t.arg({ type: CompanyInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_companies');
      const id = gid('Company')(a.companyId);
      if (!id) return { company: null, userErrors: notFound('companyId', 'Company does not exist') };
      const r = await updateCompany(ctx.db, ctx.shopId, id, a.input);
      return r.ok ? { company: r.value, userErrors: [] } : { company: null, userErrors: r.errors };
    },
  }),
  companyDelete: t.field({
    type: DeletePayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_companies');
      const id = gid('Company')(a.id);
      const r = id ? await deleteCompany(ctx.db, ctx.shopId, id) : null;
      return r?.ok ? { deletedCompanyId: toGid('Company', id!), userErrors: [] } : { deletedCompanyId: null, userErrors: r && !r.ok ? r.errors : notFound('id', 'Company does not exist') };
    },
  }),
  companiesDelete: t.field({
    type: BulkDeletePayload, args: { companyIds: t.arg.idList({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_companies');
      const done: string[] = [];
      for (const raw of a.companyIds) { const id = gid('Company')(raw); if (id && (await deleteCompany(ctx.db, ctx.shopId, id)).ok) done.push(toGid('Company', id)); }
      return { deletedCompanyIds: done, userErrors: [] };
    },
  }),
  companyLocationCreate: t.field({
    type: LocCreatePayload, args: { companyId: t.arg.id({ required: true }), input: t.arg({ type: LocationInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_companies');
      const id = gid('Company')(a.companyId);
      if (!id) return { companyLocation: null, userErrors: notFound('companyId', 'Company does not exist') };
      const r = await createCompanyLocation(ctx.db, ctx.shopId, id, a.input);
      return r.ok ? { companyLocation: r.value, userErrors: [] } : { companyLocation: null, userErrors: r.errors };
    },
  }),
  companyLocationUpdate: t.field({
    type: LocUpdatePayload, args: { companyLocationId: t.arg.id({ required: true }), input: t.arg({ type: LocationInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_companies');
      const id = gid('CompanyLocation')(a.companyLocationId);
      if (!id) return { companyLocation: null, userErrors: notFound('companyLocationId', 'Company location does not exist') };
      const r = await updateCompanyLocation(ctx.db, ctx.shopId, id, a.input);
      return r.ok ? { companyLocation: r.value, userErrors: [] } : { companyLocation: null, userErrors: r.errors };
    },
  }),
  companyLocationDelete: t.field({
    type: LocDeletePayload, args: { companyLocationId: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_companies');
      const id = gid('CompanyLocation')(a.companyLocationId);
      const r = id ? await deleteCompanyLocation(ctx.db, ctx.shopId, id) : null;
      return r?.ok ? { deletedCompanyLocationId: toGid('CompanyLocation', id!), userErrors: [] } : { deletedCompanyLocationId: null, userErrors: r && !r.ok ? r.errors : notFound('companyLocationId', 'Company location does not exist') };
    },
  }),
  companyAssignCustomerAsContact: t.field({
    type: AssignPayload, args: { companyId: t.arg.id({ required: true }), customerId: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_companies');
      const co = gid('Company')(a.companyId), cu = gid('Customer')(a.customerId);
      if (!co) return { companyContact: null, userErrors: notFound('companyId', 'Company does not exist') };
      if (!cu) return { companyContact: null, userErrors: notFound('customerId', "Customer can't be found") };
      const r = await assignCustomerAsContact(ctx.db, ctx.shopId, co, cu);
      return r.ok ? { companyContact: r.value, userErrors: [] } : { companyContact: null, userErrors: r.errors };
    },
  }),
  companyContactUpdate: t.field({
    type: ContactUpdatePayload, args: { companyContactId: t.arg.id({ required: true }), input: t.arg({ type: ContactInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_companies');
      const id = gid('CompanyContact')(a.companyContactId);
      if (!id) return { companyContact: null, userErrors: notFound('companyContactId', 'Company contact does not exist') };
      const r = await updateCompanyContact(ctx.db, ctx.shopId, id, a.input);
      return r.ok ? { companyContact: r.value, userErrors: [] } : { companyContact: null, userErrors: r.errors };
    },
  }),
  companyContactRemoveFromCompany: t.field({
    type: RemovePayload, args: { companyContactId: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_companies');
      const id = gid('CompanyContact')(a.companyContactId);
      const r = id ? await removeCompanyContact(ctx.db, ctx.shopId, id) : null;
      return r?.ok ? { removedCompanyContactId: toGid('CompanyContact', id!), userErrors: [] } : { removedCompanyContactId: null, userErrors: r && !r.ok ? r.errors : notFound('companyContactId', 'Company contact does not exist') };
    },
  }),
  companyAssignMainContact: t.field({
    type: MainPayload, args: { companyId: t.arg.id({ required: true }), companyContactId: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_companies');
      const co = gid('Company')(a.companyId), ct = gid('CompanyContact')(a.companyContactId);
      if (!co || !ct) return { company: null, userErrors: notFound(co ? 'companyContactId' : 'companyId', 'Not found') };
      const r = await setMainContact(ctx.db, ctx.shopId, co, ct);
      return r.ok ? { company: r.value, userErrors: [] } : { company: null, userErrors: r.errors };
    },
  }),
  shopmeCompanyAddCustomers: t.field({
    type: AddCustomersPayload, args: { companyId: t.arg.id({ required: true }), customerIds: t.arg.idList({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_companies');
      const co = gid('Company')(a.companyId);
      if (!co || !(await getCompany(ctx.db, ctx.shopId, co))) return { addedCount: 0, failures: [], userErrors: notFound('companyId', 'Company does not exist') };
      const r = await addCustomersToCompany(ctx.db, ctx.shopId, co, a.customerIds.map(gid('Customer')).filter((x): x is number => !!x));
      return { addedCount: r.added, failures: r.errors, userErrors: [] };
    },
  }),
  shopmeDraftOrderSetCompany: t.field({
    type: DraftCompanyPayload, description: 'ShopMe: set (or clear, with no companyId) the B2B company, contact and location of a draft order.',
    args: { draftOrderId: t.arg.id({ required: true }), companyId: t.arg.id(), companyContactId: t.arg.id(), companyLocationId: t.arg.id() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_draft_orders');
      const id = gid('DraftOrder')(a.draftOrderId);
      const draft = id ? await getDraftOrder(ctx.db, ctx.shopId, id) : null;
      if (!id || !draft) return { draftOrderId: null, userErrors: notFound('draftOrderId', 'Draft order does not exist') };
      if (draft.status === 'COMPLETED') return { draftOrderId: null, userErrors: [{ field: ['draftOrderId'], message: 'Draft order is already completed' }] };
      let entity: { companyId: number | null; companyContactId: number | null; companyLocationId: number | null } = { companyId: null, companyContactId: null, companyLocationId: null };
      let exempt: boolean | null = null;
      if (a.companyId) {
        const co = gid('Company')(a.companyId);
        if (!co) return { draftOrderId: null, userErrors: notFound('companyId', 'Company does not exist') };
        const r = await resolvePurchasingEntity(ctx.db, ctx.shopId, { companyId: co, companyContactId: a.companyContactId ? gid('CompanyContact')(a.companyContactId) : null, companyLocationId: a.companyLocationId ? gid('CompanyLocation')(a.companyLocationId) : null });
        if (!r.ok) return { draftOrderId: null, userErrors: r.errors };
        entity = r.value;
        const loc = entity.companyLocationId ? await getCompanyLocation(ctx.db, ctx.shopId, entity.companyLocationId) : null;
        exempt = loc?.taxExempt ? true : null;
        const contact = entity.companyContactId ? await getCompanyContact(ctx.db, ctx.shopId, entity.companyContactId) : null;
        if (contact && !draft.customerId) await updateDraftOrder(ctx.db, (await getShop(ctx.db, ctx.shopId))!, id, { customerId: contact.customerId });
      }
      await ctx.db.update(schema.draftOrders).set({ companyId: entity.companyId, companyContactId: entity.companyContactId, companyLocationId: entity.companyLocationId, updatedAt: new Date() }).where(eq(schema.draftOrders.id, id));
      if (exempt) await updateDraftOrder(ctx.db, (await getShop(ctx.db, ctx.shopId))!, id, { taxExempt: true }, staffId(ctx));
      return { draftOrderId: toGid('DraftOrder', id), userErrors: [] };
    },
  }),
}));
void Order_;
