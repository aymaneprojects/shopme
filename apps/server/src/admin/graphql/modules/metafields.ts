import { digest, getMetafield, getMetafieldById, jsonValue, listMetafields, OWNER_TYPE_BY_GID, setMetafields, type Metafield } from '@shopme/core';
import { fromGid } from '@shopme/shopify-compat';
import type { ObjectRef } from '@pothos/core';
import { builder } from '../builder';
import { requireScope } from '../context';
import { ConnectionArgs, paginate } from '../types/connection';
import { Node, legacyId, registerNode } from '../types/node';
import { Collection_, Location_, Metafield_, MetafieldConnection, Product_, ProductVariant, defineTypedPayload, typedError } from '../types/catalog';

const MetafieldOwnerType = builder.enumType('MetafieldOwnerType', {
  values: [
    'API_PERMISSION', 'COMPANY', 'COMPANY_LOCATION', 'PAYMENT_CUSTOMIZATION', 'VALIDATION', 'CUSTOMER', 'DELIVERY_CUSTOMIZATION', 'DRAFTORDER', 'GIFT_CARD_TRANSACTION', 'TRANSFER',
    'MARKET', 'CARTTRANSFORM', 'COLLECTION', 'MEDIA_IMAGE', 'PRODUCT', 'PRODUCTVARIANT', 'SELLING_PLAN', 'ARTICLE', 'BLOG', 'PAGE', 'FULFILLMENT_CONSTRAINT_RULE',
    'ORDER_ROUTING_LOCATION_RULE', 'DISCOUNT', 'ORDER', 'LOCATION', 'SHOP',
  ] as const,
});

Metafield_.implement({
  interfaces: [Node],
  fields: (t) => ({
    legacyResourceId: t.field({ type: 'UnsignedInt64', resolve: legacyId }),
    namespace: t.exposeString('namespace'),
    key: t.exposeString('key'),
    value: t.exposeString('value'),
    type: t.exposeString('type'),
    jsonValue: t.field({ type: 'JSON', resolve: (m) => jsonValue(m) }),
    compareDigest: t.string({ nullable: true, resolve: (m) => digest(m) }),
    ownerType: t.field({ type: MetafieldOwnerType, resolve: (m) => m.ownerType as 'PRODUCT' }),
    createdAt: t.field({ type: 'DateTime', resolve: (m) => m.createdAt }),
    updatedAt: t.field({ type: 'DateTime', resolve: (m) => m.updatedAt }),
  }),
});
registerNode('Metafield', (ctx, id) => getMetafieldById(ctx.db, ctx.shopId, id));

/** Add `metafield` / `metafields` to an owner type. */
function withMetafields<T extends { id: number }>(ref: ObjectRef<any, T>, ownerType: string) {
  builder.objectFields(ref as never, (t: any) => ({
    metafield: t.field({
      type: Metafield_, nullable: true, args: { namespace: t.arg.string(), key: t.arg.string({ required: true }) },
      resolve: (o: T, a: { namespace?: string | null; key: string }, ctx: any) => getMetafield(ctx.db, ctx.shopId, ownerType, o.id, a.namespace, a.key),
    }),
    metafields: t.field({
      type: MetafieldConnection, args: { ...ConnectionArgs, namespace: t.arg.string(), keys: t.arg.stringList() },
      resolve: (o: T, a: any, ctx: any) => {
        const fetch = (offset: number, limit: number) => listMetafields(ctx.db, ctx.shopId, ownerType, o.id, { namespace: a.namespace, keys: a.keys, reverse: !!a.reverse, offset, limit });
        return paginate(a, { fetch: ({ offset, limit }) => fetch(offset, limit), total: async () => (await fetch(0, 10000)).length });
      },
    }),
  }));
}
withMetafields(Product_, 'PRODUCT');
withMetafields(ProductVariant, 'PRODUCTVARIANT');
withMetafields(Collection_, 'COLLECTION');
withMetafields(Location_, 'LOCATION');

const MetafieldsSetInput = builder.inputType('MetafieldsSetInput', {
  fields: (t) => ({ ownerId: t.id({ required: true }), namespace: t.string(), key: t.string({ required: true }), value: t.string({ required: true }), compareDigest: t.string(), type: t.string() }),
});
const SetPayload = defineTypedPayload<{ metafields: Metafield[] | null }>('MetafieldsSetPayload', 'MetafieldsSetUserError', (t) => ({
  metafields: t.field({ type: [Metafield_], nullable: true, resolve: (p) => p.metafields }),
}));
builder.objectFields(typedError('MetafieldsSetUserError'), (t) => ({
  elementIndex: t.int({ nullable: true, resolve: (e) => (e.field?.[0] === 'metafields' && e.field[1] !== undefined ? Number(e.field[1]) : null) }),
}));

builder.mutationFields((t) => ({
  metafieldsSet: t.field({
    type: SetPayload, args: { metafields: t.arg({ type: [MetafieldsSetInput], required: true }) },
    resolve: async (_r, a, ctx) => {
      // Owners can be any resource; the owning area's scope applies (staff sessions hold all).
      requireScope(ctx, 'write_products');
      const inputs: Parameters<typeof setMetafields>[2] = [];
      for (const [i, m] of a.metafields.entries()) {
        const gid = fromGid(String(m.ownerId));
        const ownerType = gid ? OWNER_TYPE_BY_GID[gid.type] : undefined;
        if (!gid || !ownerType) return { metafields: null, userErrors: [{ field: ['metafields', String(i), 'ownerId'], message: 'Owner type is not supported or the id is invalid.', code: 'INVALID' }] };
        inputs.push({ ownerType, ownerId: gid.id, namespace: m.namespace, key: m.key, value: m.value, type: m.type, compareDigest: m.compareDigest });
      }
      const r = await setMetafields(ctx.db, ctx.shopId, inputs);
      return r.ok ? { metafields: r.value, userErrors: [] } : { metafields: null, userErrors: r.errors };
    },
  }),
}));
