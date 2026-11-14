import {
  captureTransaction, collectVia, voidTransaction, changeDraftTags, createDraftFromOrder, deleteDraftOrder, duplicateDraftOrder, getAbandonedCheckout, getCustomer, getDraftTag, getSavedSearch, listDraftTags, matchingDraftIds, recoveryUrl, schema,
} from '@shopme/core';
import { and, count, eq, gt } from 'drizzle-orm';
import { parseId, parseMoney, type UserError } from '@shopme/shopify-compat';
import { gatewaysFor } from '../../../payments-gateways';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { DisplayableError, definePayload } from '../types/errors';
import { Node, registerNode } from '../types/node';
import { Job } from '../types/catalog';
import { Customer_, registerTaggable } from '../types/sales';
import { AbandonedCheckout, load as loadCheckout, type Shape as CheckoutShape } from './abandoned';
import { DraftOrder, asView, did, shopFor, staffId } from './draft-orders';
import { completedJob } from './jobs';
import { OrderTransaction } from './orders';

/** Orders and drafts parity: draft bulk edits and copies, draft order tags, `orderCapture` and the `abandonment` reads. */

/* ------------------------------ draft orders ------------------------------ */

registerTaggable('DraftOrder', async (ctx, id, mode, tags) => { requireScope(ctx, 'write_draft_orders'); return changeDraftTags(ctx.db, ctx.shopId, id, mode, tags); });

const DraftOrderTag = builder.objectRef<{ id: number; title: string; handle: string }>('DraftOrderTag').implement({
  interfaces: [Node], fields: (t) => ({ title: t.exposeString('title'), handle: t.exposeString('handle') }),
});
registerNode('DraftOrderTag', (ctx, id) => getDraftTag(ctx.db, ctx.shopId, id));

const JobPayload = (name: string) => definePayload<{ job: { id: string; done: boolean } | null }>(name, (t) => ({ job: t.field({ type: Job, nullable: true, resolve: (p) => p.job }) }));
const BulkAddTags = JobPayload('DraftOrderBulkAddTagsPayload');
const BulkRemoveTags = JobPayload('DraftOrderBulkRemoveTagsPayload');
const BulkDelete = JobPayload('DraftOrderBulkDeletePayload');
const FromOrder = definePayload<{ draftOrder: Awaited<ReturnType<typeof asView>> | null }>('DraftOrderCreateFromOrderPayload', (t) => ({ draftOrder: t.field({ type: DraftOrder, nullable: true, resolve: (p) => p.draftOrder }) }));
const Duplicate = definePayload<{ draftOrder: Awaited<ReturnType<typeof asView>> | null }>('DraftOrderDuplicatePayload', (t) => ({ draftOrder: t.field({ type: DraftOrder, nullable: true, resolve: (p) => p.draftOrder }) }));

type Sel = { ids?: (string | number)[] | null; search?: string | null; savedSearchId?: string | number | null };
const missingArg: UserError[] = [{ field: null, message: 'One of IDs, search argument or saved search ID is required.' }];
const tooMany: UserError[] = [{ field: null, message: 'Only one of IDs, search argument or saved search ID is allowed.' }];

/** Exactly one of `ids`, `search`, `savedSearchId` selects the drafts. */
async function selectDrafts(ctx: GraphQLContext, a: Sel): Promise<{ ids: number[] } | { errors: UserError[] }> {
  const given = [a.ids != null, a.search != null, a.savedSearchId != null].filter(Boolean).length;
  if (given === 0) return { errors: missingArg };
  if (given > 1) return { errors: tooMany };
  if (a.ids != null) {
    const parsed = a.ids.map((x) => did(String(x)));
    if (parsed.some((i) => i == null)) return { errors: [{ field: ['ids'], message: 'Draft order does not exist' }] };
    const found = await matchingDraftIds(ctx.db, ctx.shopId, { ids: parsed as number[] });
    if (found.length !== new Set(parsed).size) return { errors: [{ field: ['ids'], message: 'Draft order does not exist' }] };
    return { ids: found };
  }
  let query = a.search ?? '';
  if (a.savedSearchId != null) {
    const sid = parseId(String(a.savedSearchId), 'SavedSearch');
    const saved = sid ? await getSavedSearch(ctx.db, ctx.shopId, sid) : null;
    if (!saved) return { errors: [{ field: ['savedSearchId'], message: 'Saved search does not exist' }] };
    query = saved.query;
  }
  return { ids: await matchingDraftIds(ctx.db, ctx.shopId, { query }) };
}

async function bulkDrafts(ctx: GraphQLContext, a: Sel, type: string, work: (ids: number[]) => Promise<void>) {
  requireScope(ctx, 'write_draft_orders');
  const s = await selectDrafts(ctx, a);
  if ('errors' in s) return { job: null, userErrors: s.errors };
  await work(s.ids);
  return { job: await completedJob(ctx, type), userErrors: [] as UserError[] };
}

builder.queryFields((t) => ({
  draftOrderTag: t.field({
    type: DraftOrderTag, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'read_draft_orders'); const id = parseId(String(a.id), 'DraftOrderTag'); return id ? getDraftTag(ctx.db, ctx.shopId, id) : null; },
  }),
}));

builder.mutationFields((t) => {
  const sel = () => ({ search: t.arg.string(), savedSearchId: t.arg.id(), ids: t.arg.idList() });
  const tagsCheck = (tags: string[]): UserError[] => (tags.some((x) => x.trim()) ? [] : [{ field: ['tags'], message: "Tags can't be blank" }]);
  return {
    draftOrderBulkAddTags: t.field({
      type: BulkAddTags, args: { ...sel(), tags: t.arg.stringList({ required: true }) },
      resolve: async (_r, a, ctx) => {
        const bad = tagsCheck(a.tags);
        if (bad.length) { requireScope(ctx, 'write_draft_orders'); return { job: null, userErrors: bad }; }
        return bulkDrafts(ctx, a, 'draft-order.bulk-add-tags', async (ids) => { for (const id of ids) await changeDraftTags(ctx.db, ctx.shopId, id, 'add', a.tags); });
      },
    }),
    draftOrderBulkRemoveTags: t.field({
      type: BulkRemoveTags, args: { ...sel(), tags: t.arg.stringList({ required: true }) },
      resolve: async (_r, a, ctx) => {
        const bad = tagsCheck(a.tags);
        if (bad.length) { requireScope(ctx, 'write_draft_orders'); return { job: null, userErrors: bad }; }
        return bulkDrafts(ctx, a, 'draft-order.bulk-remove-tags', async (ids) => { for (const id of ids) await changeDraftTags(ctx.db, ctx.shopId, id, 'remove', a.tags); });
      },
    }),
    draftOrderBulkDelete: t.field({
      type: BulkDelete, args: sel(),
      resolve: (_r, a, ctx) => bulkDrafts(ctx, a, 'draft-order.bulk-delete', async (ids) => { for (const id of ids) await deleteDraftOrder(ctx.db, ctx.shopId, id, staffId(ctx)); }),
    }),
    draftOrderCreateFromOrder: t.field({
      type: FromOrder, args: { orderId: t.arg.id({ required: true }) },
      resolve: async (_r, a, ctx) => {
        requireScope(ctx, 'write_draft_orders');
        const orderId = parseId(String(a.orderId), 'Order');
        if (!orderId) return { draftOrder: null, userErrors: [{ field: ['orderId'], message: 'Order does not exist' }] };
        const r = await createDraftFromOrder(ctx.db, await shopFor(ctx), orderId, staffId(ctx));
        return r.ok ? { draftOrder: await asView(ctx, r.value), userErrors: [] } : { draftOrder: null, userErrors: r.errors };
      },
    }),
    draftOrderDuplicate: t.field({
      type: Duplicate, args: { draftOrderId: t.arg.id({ deprecationReason: 'Use `id` instead.' }), id: t.arg.id() },
      resolve: async (_r, a, ctx) => {
        requireScope(ctx, 'write_draft_orders');
        const raw = a.id ?? a.draftOrderId;
        const id = raw != null ? did(raw) : null;
        if (!id) return { draftOrder: null, userErrors: [{ field: [a.id != null ? 'id' : 'draftOrderId'], message: 'Draft order does not exist' }] };
        const r = await duplicateDraftOrder(ctx.db, await shopFor(ctx), id, staffId(ctx));
        return r.ok ? { draftOrder: await asView(ctx, r.value), userErrors: [] } : { draftOrder: null, userErrors: r.errors };
      },
    }),
  };
});

/* ------------------------------ orderCapture ------------------------------ */

const CaptureInput = builder.inputType('OrderCaptureInput', {
  fields: (t) => ({ id: t.id({ required: true }), parentTransactionId: t.id({ required: true }), amount: t.field({ type: 'Money', required: true }), currency: t.string(), finalCapture: t.boolean({ defaultValue: false }) }),
});
const CapturePayload = definePayload<{ transaction: { id: number } | null }>('OrderCapturePayload', (t) => ({ transaction: t.field({ type: OrderTransaction, nullable: true, resolve: (p) => p.transaction as never }) }));

builder.mutationFields((t) => ({
  orderCapture: t.field({
    type: CapturePayload, args: { input: t.arg({ type: CaptureInput, required: true }) },
    description: 'Captures money from an authorization transaction. Orders paid through checkout are already captured; use this on orders that carry an AUTHORIZATION transaction.',
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_orders');
      const orderId = parseId(String(input.id), 'Order');
      const parentId = parseId(String(input.parentTransactionId), 'OrderTransaction');
      if (!orderId) return { transaction: null, userErrors: [{ field: ['input', 'id'], message: 'Order does not exist' }] };
      if (!parentId) return { transaction: null, userErrors: [{ field: ['input', 'parentTransactionId'], message: 'Transaction does not exist' }] };
      const order = await ctx.db.select({ currency: schema.orders.currency }).from(schema.orders).where(and(eq(schema.orders.shopId, ctx.shopId), eq(schema.orders.id, orderId))).limit(1);
      if (!order[0]) return { transaction: null, userErrors: [{ field: ['input', 'id'], message: 'Order does not exist' }] };
      let amount: number | null = null;
      try { amount = parseMoney(String(input.amount), order[0].currency); } catch { /* invalid */ }
      if (amount == null) return { transaction: null, userErrors: [{ field: ['input', 'amount'], message: 'Amount is invalid' }] };
      // The store's gateways are looked up before the capture runs (the capture holds a database transaction).
      const gateways = await gatewaysFor(ctx.request.server, ctx.shopId);
      const r = await captureTransaction(ctx.db, ctx.shopId, { orderId, parentTransactionId: parentId, amount, currency: input.currency, finalCapture: input.finalCapture, staffId: staffId(ctx), collect: collectVia(gateways) });
      if (!r.ok) return { transaction: null, userErrors: r.errors };
      const full = await ctx.db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
      return { transaction: { ...r.value, order: full[0]! }, userErrors: [] };
    },
  }),
}));

/* ------------------------------ transactionVoid ------------------------------ */

const VoidErrorCode = builder.enumType('TransactionVoidUserErrorCode', { values: ['TRANSACTION_NOT_FOUND', 'AUTH_NOT_SUCCESSFUL', 'AUTH_NOT_VOIDABLE', 'GENERIC_ERROR'] as const });
const VoidUserError = builder.objectRef<UserError>('TransactionVoidUserError').implement({
  interfaces: [DisplayableError],
  fields: (t) => ({ code: t.field({ type: VoidErrorCode, nullable: true, resolve: (e) => (e.code as 'GENERIC_ERROR') ?? null }) }),
});
const VoidPayload = builder.objectRef<{ transaction: { id: number } | null; userErrors: UserError[] }>('TransactionVoidPayload').implement({
  fields: (t) => ({
    transaction: t.field({ type: OrderTransaction, nullable: true, resolve: (p) => p.transaction as never }),
    userErrors: t.field({ type: [VoidUserError], resolve: (p) => p.userErrors }),
  }),
});

builder.mutationFields((t) => ({
  transactionVoid: t.field({
    type: VoidPayload, args: { parentTransactionId: t.arg.id({ required: true }) },
    description: 'Voids an uncaptured authorization: the hold is released at the payment provider and the order becomes voided.',
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_orders');
      const parentId = parseId(String(a.parentTransactionId), 'OrderTransaction');
      if (!parentId) return { transaction: null, userErrors: [{ field: ['parentTransactionId'], message: 'Transaction does not exist', code: 'TRANSACTION_NOT_FOUND' }] };
      const r = await voidTransaction(ctx.db, ctx.shopId, { parentTransactionId: parentId, gateways: await gatewaysFor(ctx.request.server, ctx.shopId), staffId: staffId(ctx) });
      if (!r.ok) return { transaction: null, userErrors: r.errors };
      const [order] = await ctx.db.select().from(schema.orders).where(eq(schema.orders.id, r.value.orderId)).limit(1);
      return { transaction: { ...r.value, order: order! }, userErrors: [] };
    },
  }),
}));

/* ------------------------------ abandonment ------------------------------ */

const AbandonmentType = builder.enumType('AbandonmentAbandonmentType', { values: ['BROWSE', 'CART', 'CHECKOUT'] as const });
const EmailState = builder.enumType('AbandonmentEmailState', { values: ['NOT_SENT', 'SENT', 'SCHEDULED'] as const });

/** An abandonment is the customer-level view of an abandoned checkout (one per checkout; browse and cart steps are not tracked). */
interface AbandonmentShape { id: number; checkout: CheckoutShape; customerId: number }
const Abandonment = builder.objectRef<AbandonmentShape>('Abandonment').implement({
  interfaces: [Node],
  fields: (t) => ({
    abandonmentType: t.field({ type: AbandonmentType, resolve: () => 'CHECKOUT' as const }),
    mostRecentStep: t.field({ type: AbandonmentType, resolve: () => 'CHECKOUT' as const }),
    abandonedCheckoutPayload: t.field({ type: AbandonedCheckout, nullable: true, resolve: (a) => a.checkout }),
    cartUrl: t.field({ type: 'URL', nullable: true, resolve: (a, _x, ctx) => recoveryUrl(a.checkout.shop, ctx.storeUrl, a.checkout.row.token) }),
    createdAt: t.field({ type: 'DateTime', resolve: (a) => a.checkout.row.createdAt }),
    customer: t.field({ type: Customer_, resolve: async (a, _x, ctx) => (await getCustomer(ctx.db, ctx.shopId, a.customerId))! }),
    emailState: t.field({ type: EmailState, nullable: true, resolve: (a) => (a.checkout.row.recoverySentAt ? 'SENT' : 'NOT_SENT') }),
    emailSentAt: t.field({ type: 'DateTime', nullable: true, resolve: (a) => a.checkout.row.recoverySentAt }),
    daysSinceLastAbandonmentEmail: t.int({ resolve: (a) => (a.checkout.row.recoverySentAt ? Math.floor((Date.now() - a.checkout.row.recoverySentAt.getTime()) / 86400_000) : 0) }),
    hoursSinceLastAbandonedCheckout: t.float({ nullable: true, resolve: (a) => (Date.now() - a.checkout.row.updatedAt.getTime()) / 3600_000 }),
    lastBrowseAbandonmentDate: t.field({ type: 'DateTime', resolve: (a) => a.checkout.row.updatedAt }),
    lastCartAbandonmentDate: t.field({ type: 'DateTime', resolve: (a) => a.checkout.row.updatedAt }),
    lastCheckoutAbandonmentDate: t.field({ type: 'DateTime', resolve: (a) => a.checkout.row.updatedAt }),
    visitStartedAt: t.field({ type: 'DateTime', nullable: true, resolve: (a) => a.checkout.row.createdAt }),
    customerHasNoOrderSinceAbandonment: t.boolean({
      resolve: async (a, _x, ctx) => !(await ctx.db.select({ n: count() }).from(schema.orders).where(and(eq(schema.orders.shopId, ctx.shopId), eq(schema.orders.customerId, a.customerId), gt(schema.orders.createdAt, a.checkout.row.createdAt))))[0]!.n,
    }),
    customerHasNoDraftOrderSinceAbandonment: t.boolean({
      resolve: async (a, _x, ctx) => !(await ctx.db.select({ n: count() }).from(schema.draftOrders).where(and(eq(schema.draftOrders.shopId, ctx.shopId), eq(schema.draftOrders.customerId, a.customerId), gt(schema.draftOrders.createdAt, a.checkout.row.createdAt))))[0]!.n,
    }),
    inventoryAvailable: t.boolean({ resolve: () => true }),
    isFromOnlineStore: t.boolean({ resolve: () => true }),
    isFromCustomStorefront: t.boolean({ resolve: () => false }),
    isFromShopApp: t.boolean({ resolve: () => false }),
    isFromShopPay: t.boolean({ resolve: () => false }),
    isMostSignificantAbandonment: t.boolean({ resolve: () => true }),
  }),
});

/** The abandonment of a checkout, or null when the checkout is unknown or its buyer has no customer record. */
async function abandonmentOf(ctx: GraphQLContext, checkoutId: number | null): Promise<AbandonmentShape | null> {
  const row = checkoutId ? await getAbandonedCheckout(ctx.db, ctx.shopId, checkoutId) : null;
  const checkout = row ? await loadCheckout(ctx, row) : null;
  if (!checkout || !row?.email) return null;
  const [c] = await ctx.db.select({ id: schema.customers.id }).from(schema.customers).where(and(eq(schema.customers.shopId, ctx.shopId), eq(schema.customers.email, row.email.toLowerCase()))).limit(1);
  return c ? { id: row.id, checkout, customerId: c.id } : null;
}
registerNode('Abandonment', (ctx, id) => abandonmentOf(ctx, id));

builder.queryFields((t) => ({
  abandonment: t.field({
    type: Abandonment, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_orders'); return abandonmentOf(ctx, parseId(String(a.id), 'Abandonment')); },
  }),
  abandonmentByAbandonedCheckoutId: t.field({
    type: Abandonment, nullable: true, args: { abandonedCheckoutId: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_orders'); return abandonmentOf(ctx, parseId(String(a.abandonedCheckoutId), 'AbandonedCheckout')); },
  }),
}));
