import {
  countSubscriptions, createSubscription, deleteSubscription, getShop, getSubscription, getWebhookSecret, listDeliveries, listSubscriptions, topicFromWire, updateSubscription, SHOPIFY_WEBHOOK_TOPICS, WEBHOOK_TOPICS,
  type WebhookDelivery, type WebhookSubscription as SubRow,
} from '@shopme/core';
import { parseId, toGid } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope } from '../context';
import { ConnectionArgs, defineConnection, paginate } from '../types/connection';
import { definePayload } from '../types/errors';
import { Count } from '../types/money';
import { Node, legacyId, registerNode } from '../types/node';

/** Outbound webhooks: subscriptions (Shopify's `webhookSubscription*` API), signing secret and the delivery log (ShopMe). */

// The full Shopify topic list; only the ones in WEBHOOK_TOPICS are ever delivered (see docs/spec/admin-api-mvp.md).
const ALL_TOPICS = [...new Set([...SHOPIFY_WEBHOOK_TOPICS, ...WEBHOOK_TOPICS])] as [string, ...string[]];
const Topic = builder.enumType('WebhookSubscriptionTopic', { values: ALL_TOPICS });
const SortKeys = builder.enumType('WebhookSubscriptionSortKeys', { values: ['CREATED_AT', 'ID'] as const });
const Format = builder.enumType('WebhookSubscriptionFormat', { values: ['JSON', 'XML'] as const });
const HttpEndpoint = builder.objectRef<{ callbackUrl: string }>('WebhookHttpEndpoint').implement({ fields: (t) => ({ callbackUrl: t.field({ type: 'URL', resolve: (e) => e.callbackUrl }) }) });
const Endpoint = builder.unionType('WebhookSubscriptionEndpoint', { types: [HttpEndpoint], resolveType: () => HttpEndpoint });
const ApiVersion = builder.objectRef<{ handle: string }>('ApiVersion').implement({
  fields: (t) => ({ handle: t.exposeString('handle'), displayName: t.string({ resolve: (v) => v.handle }), supported: t.boolean({ resolve: () => true }) }),
});

export const WebhookSubscription = builder.objectRef<SubRow>('WebhookSubscription');
WebhookSubscription.implement({
  interfaces: [Node],
  fields: (t) => ({
    legacyResourceId: t.field({ type: 'UnsignedInt64', resolve: legacyId }),
    topic: t.field({ type: Topic, resolve: (s) => s.topic }),
    format: t.field({ type: Format, resolve: () => 'JSON' as const }),
    endpoint: t.field({ type: Endpoint, resolve: (s) => ({ callbackUrl: s.endpointUrl }) }),
    callbackUrl: t.field({ type: 'URL', resolve: (s) => s.endpointUrl }),
    uri: t.string({ resolve: (s) => s.endpointUrl }),
    includeFields: t.stringList({ resolve: (s) => s.includeFields }),
    metafieldNamespaces: t.stringList({ resolve: (s) => s.metafieldNamespaces }),
    filter: t.string({ nullable: true, resolve: (s) => s.filter }),
    name: t.string({ nullable: true, resolve: (s) => s.name }),
    apiVersion: t.field({ type: ApiVersion, resolve: (s) => ({ handle: s.apiVersion }) }),
    createdAt: t.field({ type: 'DateTime', resolve: (s) => s.createdAt }),
    updatedAt: t.field({ type: 'DateTime', resolve: (s) => s.updatedAt }),
  }),
});
registerNode('WebhookSubscription', (ctx, id) => getSubscription(ctx.db, ctx.shopId, id));
const Connection = defineConnection('WebhookSubscription', WebhookSubscription);

const Input = builder.inputType('WebhookSubscriptionInput', {
  fields: (t) => ({
    callbackUrl: t.field({ type: 'URL' }), uri: t.string(), format: t.field({ type: Format }),
    includeFields: t.stringList(), metafieldNamespaces: t.stringList(), filter: t.string(), name: t.string(),
  }),
});

const Delivery = builder.objectRef<WebhookDelivery>('ShopmeWebhookDelivery').implement({
  fields: (t) => ({
    id: t.id({ resolve: (d) => toGid('ShopmeWebhookDelivery', d.id) }),
    topic: t.field({ type: Topic, resolve: (d) => topicFromWire(d.topic) }),
    wireTopic: t.string({ description: 'Value of the X-Shopify-Topic header.', resolve: (d) => d.topic }),
    subscriptionId: t.id({ nullable: true, resolve: (d) => (d.subscriptionId ? toGid('WebhookSubscription', d.subscriptionId) : null) }),
    status: t.string({ description: 'PENDING | SUCCESS | FAILED', resolve: (d) => d.status }),
    attempts: t.exposeInt('attempts'),
    nextAttemptAt: t.field({ type: 'DateTime', nullable: true, resolve: (d) => d.nextAttemptAt }),
    responseCode: t.int({ nullable: true, resolve: (d) => d.responseCode }),
    lastError: t.string({ nullable: true, resolve: (d) => d.lastError }),
    payload: t.field({ type: 'JSON', resolve: (d) => d.payload }),
    createdAt: t.field({ type: 'DateTime', resolve: (d) => d.createdAt }),
  }),
});
const DeliveryConnection = defineConnection('ShopmeWebhookDelivery', Delivery);

const Created = definePayload<{ webhookSubscription: SubRow | null }>('WebhookSubscriptionCreatePayload', (t) => ({ webhookSubscription: t.field({ type: WebhookSubscription, nullable: true, resolve: (p) => p.webhookSubscription }) }));
const Updated = definePayload<{ webhookSubscription: SubRow | null }>('WebhookSubscriptionUpdatePayload', (t) => ({ webhookSubscription: t.field({ type: WebhookSubscription, nullable: true, resolve: (p) => p.webhookSubscription }) }));
const Deleted = definePayload<{ deletedWebhookSubscriptionId: string | null }>('WebhookSubscriptionDeletePayload', (t) => ({ deletedWebhookSubscriptionId: t.id({ nullable: true, resolve: (p) => p.deletedWebhookSubscriptionId }) }));
const Secret = builder.objectRef<{ signingSecret: string }>('ShopmeWebhookSettings').implement({
  fields: (t) => ({ signingSecret: t.exposeString('signingSecret', { description: 'Key of the X-Shopify-Hmac-Sha256 signature (base64 HMAC-SHA256 of the raw body).' }) }),
});
const SecretPayload = definePayload<{ settings: { signingSecret: string } | null }>('ShopmeWebhookSecretRotatePayload', (t) => ({ settings: t.field({ type: Secret, nullable: true, resolve: (p) => p.settings }) }));

const sid = (v: string) => parseId(String(v), 'WebhookSubscription');
const urlOf = (i: { callbackUrl?: string | null; uri?: string | null }) => i.callbackUrl ?? i.uri ?? null;
type In = typeof Input.$inferInput;
const toService = (i: In) => ({ callbackUrl: urlOf(i), format: i.format, includeFields: i.includeFields, metafieldNamespaces: i.metafieldNamespaces, filter: i.filter, name: i.name });

builder.queryFields((t) => ({
  webhookSubscriptions: t.field({
    type: Connection,
    args: {
      ...ConnectionArgs, topics: t.arg({ type: [Topic] }), callbackUrl: t.arg({ type: 'URL', deprecationReason: 'Use `uri` instead.' }), uri: t.arg.string(), format: t.arg({ type: Format }),
      sortKey: t.arg({ type: SortKeys, defaultValue: 'CREATED_AT' }), query: t.arg.string(),
    },
    resolve: (_r, a, ctx) => {
      requireScope(ctx, 'read_webhooks');
      const filter = { topics: a.topics ?? undefined, format: a.format, uri: a.uri ?? a.callbackUrl, query: a.query };
      return paginate(a, {
        fetch: ({ offset, limit }) => listSubscriptions(ctx.db, ctx.shopId, { ...filter, sortKey: a.sortKey ?? 'CREATED_AT', reverse: !!a.reverse, offset, limit }),
        total: async () => (await countSubscriptions(ctx.db, ctx.shopId, filter)).count,
      });
    },
  }),
  webhookSubscriptionsCount: t.field({
    type: Count, nullable: true, args: { query: t.arg.string(), limit: t.arg.int({ defaultValue: 10000 }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_webhooks'); return countSubscriptions(ctx.db, ctx.shopId, { query: a.query, limit: a.limit ?? 10000 }); },
  }),
  webhookSubscription: t.field({
    type: WebhookSubscription, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_webhooks'); const id = sid(a.id); return id ? getSubscription(ctx.db, ctx.shopId, id) : null; },
  }),
  shopmeWebhookSettings: t.field({ type: Secret, resolve: async (_r, _a, ctx) => { requireScope(ctx, 'write_webhooks'); return { signingSecret: await getWebhookSecret(ctx.db, (await getShop(ctx.db, ctx.shopId))!) }; } }),
  shopmeWebhookDeliveries: t.field({
    type: DeliveryConnection, description: 'Delivery log, newest first.', args: { ...ConnectionArgs, subscriptionId: t.arg.id(), status: t.arg.string({ description: 'PENDING | SUCCESS | FAILED' }) },
    resolve: (_r, a, ctx) => {
      requireScope(ctx, 'read_webhooks');
      const subscriptionId = a.subscriptionId ? sid(a.subscriptionId) : null;
      return paginate(a, { fetch: ({ offset, limit }) => listDeliveries(ctx.db, ctx.shopId, { subscriptionId, status: a.status?.toUpperCase(), offset, limit }) });
    },
  }),
}));

builder.mutationFields((t) => ({
  webhookSubscriptionCreate: t.field({
    type: Created, args: { topic: t.arg({ type: Topic, required: true }), webhookSubscription: t.arg({ type: Input, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_webhooks');
      const r = await createSubscription(ctx.db, ctx.shopId, a.topic, toService(a.webhookSubscription));
      return r.ok ? { webhookSubscription: r.value, userErrors: [] } : { webhookSubscription: null, userErrors: r.errors };
    },
  }),
  webhookSubscriptionUpdate: t.field({
    type: Updated, args: { id: t.arg.id({ required: true }), webhookSubscription: t.arg({ type: Input, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_webhooks');
      const id = sid(a.id);
      if (!id) return { webhookSubscription: null, userErrors: [{ field: ['id'], message: 'Webhook subscription does not exist' }] };
      const r = await updateSubscription(ctx.db, ctx.shopId, id, toService(a.webhookSubscription));
      return r.ok ? { webhookSubscription: r.value, userErrors: [] } : { webhookSubscription: null, userErrors: r.errors };
    },
  }),
  webhookSubscriptionDelete: t.field({
    type: Deleted, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_webhooks');
      const id = sid(a.id);
      const r = id ? await deleteSubscription(ctx.db, ctx.shopId, id) : null;
      return r?.ok ? { deletedWebhookSubscriptionId: toGid('WebhookSubscription', id!), userErrors: [] } : { deletedWebhookSubscriptionId: null, userErrors: r && !r.ok ? r.errors : [{ field: ['id'], message: 'Webhook subscription does not exist' }] };
    },
  }),
  shopmeWebhookSecretRotate: t.field({
    type: SecretPayload, description: 'Generate a new signing secret. Existing receivers must be updated.',
    resolve: async (_r, _a, ctx) => { requireScope(ctx, 'write_webhooks'); return { settings: { signingSecret: await getWebhookSecret(ctx.db, (await getShop(ctx.db, ctx.shopId))!, true) }, userErrors: [] }; },
  }),
}));
