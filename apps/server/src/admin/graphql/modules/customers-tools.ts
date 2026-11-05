/**
 * Customer tools: merge (with preview), bulk edit, data request and data erasure.
 * `customerMerge`, `customerRequestDataErasure` and `customerCancelDataErasure` use the Shopify names; the preview, the bulk edit and the
 * data export are ShopMe extensions (`shopme*`). Customer ONE is merged into customer TWO, which is kept.
 */
import {
  addEvent, bulkUpdateCustomers, getEvent, cancelCustomerErasure, customerDataExport, getCustomer, listCustomerAddresses, mergeCustomers, previewCustomerMerge, requestCustomerErasure,
  ERASURE_DELAY_DAYS, type MergeChoices,
} from '@shopme/core';
import { parseId, toGid } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { definePayload } from '../types/errors';
import { Customer_, MailingAddress } from '../types/sales';
import { registerNode } from '../types/node';

const staffId = (ctx: GraphQLContext) => (ctx.auth.kind === 'session' ? ctx.auth.user.id : null);
const cid = (v: unknown) => parseId(String(v), 'Customer');
const missing = (field: string) => [{ field: [field], message: "Customer can't be found", code: 'INVALID_CUSTOMER_ID' }];

/** Lets the admin load one timeline event by id (the body of an email, shown on demand). */
registerNode('BasicEvent', async (ctx, id) => { const e = await getEvent(ctx.db, ctx.shopId, id); return e && e.kind === 'system' ? e : null; });

/* ------------------------------ erasure ------------------------------ */

builder.objectFields(Customer_, (t) => ({
  shopmeErasureScheduledAt: t.field({ type: 'DateTime', nullable: true, description: `When the personal data will be anonymized (${ERASURE_DELAY_DAYS} days after the request).`, resolve: (c) => c.erasureScheduledAt }),
  shopmeErasedAt: t.field({ type: 'DateTime', nullable: true, resolve: (c) => c.erasedAt }),
}));

const ErasurePayload = (name: string) => definePayload<{ customerId: string | null }>(name, (t) => ({ customerId: t.id({ nullable: true, resolve: (p) => p.customerId }) }));
const RequestErasurePayload = ErasurePayload('CustomerRequestDataErasurePayload');
const CancelErasurePayload = ErasurePayload('CustomerCancelDataErasurePayload');

/* ------------------------------ merge ------------------------------ */

const OverrideFields = builder.inputType('CustomerMergeOverrideFields', {
  fields: (t) => ({
    customerIdOfFirstNameToKeep: t.id(), customerIdOfLastNameToKeep: t.id(), customerIdOfEmailToKeep: t.id(), customerIdOfPhoneNumberToKeep: t.id(), customerIdOfDefaultAddressToKeep: t.id(),
    note: t.string(), tags: t.stringList(),
  }),
});

function choicesOf(o: typeof OverrideFields.$inferInput | null | undefined, one: number, two: number): MergeChoices {
  const from = (v: unknown): 'ONE' | 'TWO' | undefined => { if (v == null) return undefined; const id = cid(v); return id === one ? 'ONE' : id === two ? 'TWO' : undefined; };
  return {
    firstNameFrom: from(o?.customerIdOfFirstNameToKeep), lastNameFrom: from(o?.customerIdOfLastNameToKeep), emailFrom: from(o?.customerIdOfEmailToKeep),
    phoneFrom: from(o?.customerIdOfPhoneNumberToKeep), defaultAddressFrom: from(o?.customerIdOfDefaultAddressToKeep),
    ...(o?.tags != null && { tags: o.tags }), ...(o?.note !== undefined && { note: o.note }),
  };
}

type Preview = NonNullable<Awaited<ReturnType<typeof previewCustomerMerge>> extends infer R ? (R extends { ok: true; value: infer V } ? V : never) : never>;
const MergeFields = builder.objectRef<Preview>('ShopmeCustomerMergeFields').implement({
  fields: (t) => ({
    firstName: t.string({ nullable: true, resolve: (p) => p.fields.firstName }), lastName: t.string({ nullable: true, resolve: (p) => p.fields.lastName }),
    email: t.string({ nullable: true, resolve: (p) => p.fields.email }), phone: t.string({ nullable: true, resolve: (p) => p.fields.phone }),
    tags: t.stringList({ resolve: (p) => p.fields.tags }), note: t.string({ nullable: true, resolve: (p) => p.fields.note }),
    defaultAddress: t.field({
      type: MailingAddress, nullable: true,
      resolve: async (p, _a, ctx) => (p.fields.defaultAddressId ? (await listCustomerAddresses(ctx.db, ctx.shopId, p.fields.defaultAddressId === p.keep.defaultAddressId ? p.keep.id : p.drop.id, { offset: 0, limit: 250 })).find((a) => a.id === p.fields.defaultAddressId) ?? null : null),
    }),
  }),
});
const MergeMoves = builder.objectRef<Preview['moves']>('ShopmeCustomerMergeMoves').implement({
  fields: (t) => ({
    orders: t.exposeInt('orders'), draftOrders: t.exposeInt('draftOrders'), addresses: t.exposeInt('addresses'), storeCreditAccounts: t.exposeInt('storeCreditAccounts'),
    giftCards: t.exposeInt('giftCards'), timelineEvents: t.exposeInt('timelineEvents'), companyContacts: t.exposeInt('companyContacts'),
  }),
});
const MergePreview = builder.objectRef<Preview>('ShopmeCustomerMergePreview').implement({
  fields: (t) => ({
    resultingCustomerId: t.id({ resolve: (p) => toGid('Customer', p.keep.id) }),
    customerOne: t.field({ type: Customer_, resolve: (p) => p.drop }), customerTwo: t.field({ type: Customer_, resolve: (p) => p.keep }),
    fields: t.field({ type: MergeFields, resolve: (p) => p }), moves: t.field({ type: MergeMoves, resolve: (p) => p.moves }),
    blockers: t.stringList({ resolve: (p) => p.blockers }),
  }),
});
const MergePayload = definePayload<{ resultingCustomerId: string | null }>('CustomerMergePayload', (t) => ({ resultingCustomerId: t.id({ nullable: true, resolve: (p) => p.resultingCustomerId }) }));

/* ------------------------------ bulk edit ------------------------------ */

const ConsentChange = builder.enumType('ShopmeBulkConsentChange', { values: ['SUBSCRIBE', 'UNSUBSCRIBE'] as const });
const NoteMode = builder.enumType('ShopmeBulkNoteMode', { values: ['REPLACE', 'APPEND', 'CLEAR'] as const });
const BulkInput = builder.inputType('ShopmeCustomerBulkInput', {
  fields: (t) => ({
    addTags: t.stringList(), removeTags: t.stringList(), taxExempt: t.boolean(), emailMarketing: t.field({ type: ConsentChange }), smsMarketing: t.field({ type: ConsentChange }), whatsappMarketing: t.field({ type: ConsentChange }),
    noteMode: t.field({ type: NoteMode }), note: t.string(),
  }),
});
const BulkError = builder.objectRef<{ id: number; message: string }>('ShopmeCustomerBulkError').implement({ fields: (t) => ({ customerId: t.id({ resolve: (e) => toGid('Customer', e.id) }), message: t.exposeString('message') }) });
const BulkPayload = definePayload<{ updatedCount: number; failures: Array<{ id: number; message: string }> }>('ShopmeCustomerBulkUpdatePayload', (t) => ({
  updatedCount: t.exposeInt('updatedCount'), failures: t.field({ type: [BulkError], resolve: (p) => p.failures }),
}));

/* ------------------------------ data request ------------------------------ */

const DataPayload = definePayload<{ data: unknown }>('ShopmeCustomerDataRequestPayload', (t) => ({ data: t.field({ type: 'JSON', nullable: true, resolve: (p) => p.data }) }));

builder.queryFields((t) => ({
  shopmeCustomerMergePreview: t.field({
    type: MergePreview, nullable: true, args: { customerOneId: t.arg.id({ required: true }), customerTwoId: t.arg.id({ required: true }), overrideFields: t.arg({ type: OverrideFields }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'read_customers');
      const one = cid(a.customerOneId), two = cid(a.customerTwoId);
      if (!one || !two) return null;
      const r = await previewCustomerMerge(ctx.db, ctx.shopId, one, two, choicesOf(a.overrideFields, one, two));
      return r.ok ? r.value : null;
    },
  }),
}));

builder.mutationFields((t) => ({
  customerMerge: t.field({
    type: MergePayload, args: { customerOneId: t.arg.id({ required: true }), customerTwoId: t.arg.id({ required: true }), overrideFields: t.arg({ type: OverrideFields }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_customers');
      const one = cid(a.customerOneId), two = cid(a.customerTwoId);
      if (!one) return { resultingCustomerId: null, userErrors: missing('customerOneId') };
      if (!two) return { resultingCustomerId: null, userErrors: missing('customerTwoId') };
      const r = await mergeCustomers(ctx.db, ctx.shopId, one, two, choicesOf(a.overrideFields, one, two), staffId(ctx));
      return r.ok ? { resultingCustomerId: toGid('Customer', r.value.id), userErrors: [] } : { resultingCustomerId: null, userErrors: r.errors };
    },
  }),
  customerRequestDataErasure: t.field({
    type: RequestErasurePayload, args: { customerId: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_customers');
      const id = cid(a.customerId);
      if (!id) return { customerId: null, userErrors: missing('customerId') };
      const r = await requestCustomerErasure(ctx.db, ctx.shopId, id, staffId(ctx));
      return r.ok ? { customerId: toGid('Customer', id), userErrors: [] } : { customerId: null, userErrors: r.errors };
    },
  }),
  customerCancelDataErasure: t.field({
    type: CancelErasurePayload, args: { customerId: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_customers');
      const id = cid(a.customerId);
      if (!id) return { customerId: null, userErrors: missing('customerId') };
      const r = await cancelCustomerErasure(ctx.db, ctx.shopId, id, staffId(ctx));
      return r.ok ? { customerId: toGid('Customer', id), userErrors: [] } : { customerId: null, userErrors: r.errors };
    },
  }),
  shopmeCustomerBulkUpdate: t.field({
    type: BulkPayload, args: { customerIds: t.arg.idList({ required: true }), input: t.arg({ type: BulkInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_customers');
      const ids = a.customerIds.map(cid).filter((x): x is number => !!x);
      if (!ids.length) return { updatedCount: 0, failures: [], userErrors: [{ field: ['customerIds'], message: 'Select at least one customer' }] };
      if (ids.length > 250) return { updatedCount: 0, failures: [], userErrors: [{ field: ['customerIds'], message: 'You can edit at most 250 customers at once' }] };
      const i = a.input;
      const r = await bulkUpdateCustomers(ctx.db, ctx.shopId, ids, {
        addTags: i.addTags ?? undefined, removeTags: i.removeTags ?? undefined, taxExempt: i.taxExempt,
        emailMarketingState: i.emailMarketing ? (i.emailMarketing === 'SUBSCRIBE' ? 'SUBSCRIBED' : 'UNSUBSCRIBED') : undefined, smsMarketingState: i.smsMarketing ? (i.smsMarketing === 'SUBSCRIBE' ? 'SUBSCRIBED' : 'UNSUBSCRIBED') : undefined,
        whatsappMarketingState: i.whatsappMarketing ? (i.whatsappMarketing === 'SUBSCRIBE' ? 'SUBSCRIBED' : 'UNSUBSCRIBED') : undefined,
        noteMode: i.noteMode, note: i.note,
      }, staffId(ctx));
      return { updatedCount: r.updated, failures: r.errors, userErrors: [] };
    },
  }),
  shopmeCustomerDataRequest: t.field({
    type: DataPayload, args: { customerId: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'read_customers');
      requireScope(ctx, 'read_orders');
      const id = cid(a.customerId);
      const c = id ? await getCustomer(ctx.db, ctx.shopId, id) : null;
      if (!id || !c) return { data: null, userErrors: missing('customerId') };
      const data = await customerDataExport(ctx.db, ctx.shopId, id);
      await addEvent(ctx.db, ctx.shopId, { subjectType: 'customer', subjectId: id, verb: 'customers/data_requested', message: 'Customer data was exported', authorStaffUserId: staffId(ctx) });
      return { data, userErrors: [] };
    },
  }),
}));
