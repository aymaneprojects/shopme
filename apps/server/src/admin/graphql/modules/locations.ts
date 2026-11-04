import { addLocation, editLocation, getLocation, listInventoryLevels, listLocations, type Location } from '@shopme/core';
import { parseId } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope } from '../context';
import { ConnectionArgs, paginate } from '../types/connection';
import { Node, legacyId, registerNode } from '../types/node';
import { InventoryLevelConnection, Location_, LocationConnection, MetafieldInput, defineTypedPayload } from '../types/catalog';
import { setMetafields } from '@shopme/core';

const LocationSortKeys = builder.enumType('LocationSortKeys', { values: ['CREATED_AT', 'ID', 'NAME', 'RELEVANCE'] as const });

const LocationAddress = builder.objectRef<Location>('LocationAddress').implement({
  fields: (t) => ({
    address1: t.exposeString('address1', { nullable: true }),
    address2: t.exposeString('address2', { nullable: true }),
    city: t.exposeString('city', { nullable: true }),
    zip: t.exposeString('zip', { nullable: true }),
    countryCode: t.exposeString('countryCode', { nullable: true }),
    country: t.string({ nullable: true, resolve: (l) => (l.countryCode ? (new Intl.DisplayNames(['en'], { type: 'region' }).of(l.countryCode) ?? null) : null) }),
    province: t.exposeString('provinceCode', { nullable: true }),
    provinceCode: t.exposeString('provinceCode', { nullable: true }),
    phone: t.exposeString('phone', { nullable: true }),
    formatted: t.stringList({ resolve: (l) => [l.address1, l.address2, [l.zip, l.city].filter(Boolean).join(' '), l.countryCode].filter((x): x is string => !!x) }),
  }),
});

Location_.implement({
  interfaces: [Node],
  fields: (t) => ({
    legacyResourceId: t.field({ type: 'UnsignedInt64', resolve: legacyId }),
    name: t.exposeString('name'),
    isActive: t.exposeBoolean('isActive'),
    isFulfillmentService: t.boolean({ resolve: () => false }),
    fulfillsOnlineOrders: t.exposeBoolean('fulfillsOnlineOrders'),
    shipsInventory: t.boolean({ resolve: (l) => l.fulfillsOnlineOrders }),
    hasActiveInventory: t.boolean({
      resolve: async (l, _a, ctx) => (await listInventoryLevels(ctx.db, ctx.shopId, { locationId: l.id })).some((x) => x.available > 0 || x.onHand > 0),
    }),
    address: t.field({ type: LocationAddress, resolve: (l) => l }),
    createdAt: t.field({ type: 'DateTime', resolve: (l) => l.createdAt }),
    updatedAt: t.field({ type: 'DateTime', resolve: (l) => l.updatedAt }),
    inventoryLevels: t.field({
      type: InventoryLevelConnection, args: { ...ConnectionArgs, includeInactive: t.arg.boolean({ defaultValue: false }), query: t.arg.string() },
      resolve: async (l, a, ctx) => {
        const all = await listInventoryLevels(ctx.db, ctx.shopId, { locationId: l.id, includeInactive: !!a.includeInactive });
        return paginate(a, { fetch: async ({ offset, limit }) => (a.reverse ? [...all].reverse() : all).slice(offset, offset + limit), total: async () => all.length });
      },
    }),
  }),
});

registerNode('Location', (ctx, id) => getLocation(ctx.db, ctx.shopId, id));

const AddressInput = (name: string, required: boolean) => builder.inputType(name, {
  fields: (t) => ({ address1: t.string(), address2: t.string(), city: t.string(), phone: t.string(), zip: t.string(), countryCode: t.string({ required }), provinceCode: t.string() }),
});
const LocationAddInput = builder.inputType('LocationAddInput', {
  fields: (t) => ({
    name: t.string({ required: true }), address: t.field({ type: AddressInput('LocationAddAddressInput', true), required: true }),
    fulfillsOnlineOrders: t.boolean({ defaultValue: true }), metafields: t.field({ type: [MetafieldInput] }),
  }),
});
const LocationEditInput = builder.inputType('LocationEditInput', {
  fields: (t) => ({ name: t.string(), address: t.field({ type: AddressInput('LocationEditAddressInput', false) }), fulfillsOnlineOrders: t.boolean(), metafields: t.field({ type: [MetafieldInput] }) }),
});

const AddPayload = defineTypedPayload<{ location: Location | null }>('LocationAddPayload', 'LocationAddUserError', (t) => ({ location: t.field({ type: Location_, nullable: true, resolve: (p) => p.location }) }));
const EditPayload = defineTypedPayload<{ location: Location | null }>('LocationEditPayload', 'LocationEditUserError', (t) => ({ location: t.field({ type: Location_, nullable: true, resolve: (p) => p.location }) }));

builder.queryFields((t) => ({
  location: t.field({
    type: Location_, nullable: true, args: { id: t.arg.id() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'read_locations');
      if (!a.id) return null;
      const id = parseId(String(a.id), 'Location');
      return id ? getLocation(ctx.db, ctx.shopId, id) : null;
    },
  }),
  locations: t.field({
    type: LocationConnection,
    args: { ...ConnectionArgs, includeLegacy: t.arg.boolean({ defaultValue: false }), includeInactive: t.arg.boolean({ defaultValue: false }), sortKey: t.arg({ type: LocationSortKeys, defaultValue: 'NAME' }), query: t.arg.string() },
    resolve: (_r, a, ctx) => {
      requireScope(ctx, 'read_locations');
      const fetch = (offset: number, limit: number) => listLocations(ctx.db, ctx.shopId, { includeInactive: !!a.includeInactive, query: a.query, sortKey: a.sortKey ?? 'NAME', reverse: !!a.reverse, offset, limit });
      return paginate(a, { fetch: ({ offset, limit }) => fetch(offset, limit), total: async () => (await fetch(0, 10000)).length });
    },
  }),
}));

builder.mutationFields((t) => ({
  locationAdd: t.field({
    type: AddPayload, args: { input: t.arg({ type: LocationAddInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_locations');
      const r = await addLocation(ctx.db, ctx.shopId, { name: input.name, address: input.address, fulfillsOnlineOrders: input.fulfillsOnlineOrders });
      if (!r.ok) return { location: null, userErrors: r.errors.map((e) => ({ ...e, field: ['input', ...(e.field ?? [])] })) };
      if (input.metafields?.length) {
        await setMetafields(ctx.db, ctx.shopId, input.metafields.map((m) => ({ ownerType: 'LOCATION', ownerId: r.value.id, namespace: m.namespace, key: m.key ?? '', value: m.value ?? '', type: m.type })));
      }
      return { location: r.value, userErrors: [] };
    },
  }),
  locationEdit: t.field({
    type: EditPayload, args: { id: t.arg.id({ required: true }), input: t.arg({ type: LocationEditInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_locations');
      const id = parseId(String(a.id), 'Location');
      if (!id) return { location: null, userErrors: [{ field: ['id'], message: 'Location not found.', code: 'NOT_FOUND' }] };
      const r = await editLocation(ctx.db, ctx.shopId, id, { name: a.input.name, address: a.input.address, fulfillsOnlineOrders: a.input.fulfillsOnlineOrders });
      if (!r.ok) return { location: null, userErrors: r.errors.map((e) => ({ ...e, field: e.field?.[0] === 'id' ? e.field : ['input', ...(e.field ?? [])] })) };
      if (a.input.metafields?.length) {
        await setMetafields(ctx.db, ctx.shopId, a.input.metafields.map((m) => ({ ownerType: 'LOCATION', ownerId: id, namespace: m.namespace, key: m.key ?? '', value: m.value ?? '', type: m.type })));
      }
      return { location: r.value, userErrors: [] };
    },
  }),
}));
