import {
  createDefinition, definitionValuesCount, deleteDefinition, findDefinition, getDefinition, listDefinitions, updateDefinition, type MetafieldDefinition,
} from '@shopme/core';
import { parseId, toGid } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope } from '../context';
import { ConnectionArgs, defineConnection, paginate } from '../types/connection';
import { Node, legacyId, registerNode } from '../types/node';
import { defineTypedPayload } from '../types/catalog';
import { MetafieldOwnerType } from './metafields';

const CATEGORY: Record<string, string> = {
  single_line_text_field: 'TEXT', multi_line_text_field: 'TEXT', rich_text_field: 'TEXT', number_integer: 'NUMBER', number_decimal: 'NUMBER', rating: 'NUMBER', boolean: 'TRUE_FALSE',
  date: 'DATE_TIME', date_time: 'DATE_TIME', url: 'TEXT', color: 'COLOR', json: 'JSON', weight: 'MEASUREMENT', volume: 'MEASUREMENT', dimension: 'MEASUREMENT', money: 'MONEY', id: 'ID',
  file_reference: 'REFERENCE', product_reference: 'REFERENCE', variant_reference: 'REFERENCE', collection_reference: 'REFERENCE', page_reference: 'REFERENCE', customer_reference: 'REFERENCE',
  metaobject_reference: 'REFERENCE', mixed_reference: 'REFERENCE',
};

export const DefinitionType = builder.objectRef<{ name: string }>('MetafieldDefinitionType').implement({
  fields: (t) => ({
    name: t.exposeString('name'), category: t.string({ resolve: (x) => CATEGORY[x.name.replace(/^list\./, '')] ?? 'TEXT' }),
    supportedValidations: t.field({ type: [SupportedValidation], resolve: () => [] }), supportsDefinitionMigrations: t.boolean({ resolve: () => false }),
    valueType: t.string({ deprecationReason: '`valueType` is deprecated and `name` should be used for type information.', resolve: (x) => (x.name.includes('number_integer') ? 'INTEGER' : 'STRING') }),
  }),
});
const SupportedValidation = builder.objectRef<{ name: string; type: string }>('MetafieldDefinitionSupportedValidation').implement({ fields: (t) => ({ name: t.exposeString('name'), type: t.exposeString('type') }) });
export const Validation = builder.objectRef<{ name: string; value: string | null }>('MetafieldDefinitionValidation').implement({
  fields: (t) => ({ name: t.exposeString('name'), type: t.string({ resolve: () => 'single_line_text_field' }), value: t.exposeString('value', { nullable: true }) }),
});
export const ValidationInput = builder.inputType('MetafieldDefinitionValidationInput', { fields: (t) => ({ name: t.string({ required: true }), value: t.string({ required: true }) }) });
const AccessInput = builder.inputType('MetafieldAccessInput', { fields: (t) => ({ admin: t.string(), storefront: t.string(), customerAccount: t.string() }) });
const AccessUpdateInput = builder.inputType('MetafieldAccessUpdateInput', { fields: (t) => ({ admin: t.string(), storefront: t.string(), customerAccount: t.string() }) });
const Access = builder.objectRef<{ storefront: string }>('MetafieldAccess').implement({
  fields: (t) => ({ admin: t.string({ nullable: true, resolve: () => 'PUBLIC_READ_WRITE' }), storefront: t.string({ nullable: true, resolve: (a) => a.storefront }), customerAccount: t.string({ nullable: true, resolve: () => 'NONE' }) }),
});
const Capability = builder.objectRef<{ eligible: boolean; enabled: boolean }>('MetafieldCapabilityStatus').implement({
  fields: (t) => ({ eligible: t.exposeBoolean('eligible'), enabled: t.exposeBoolean('enabled'), status: t.string({ nullable: true, resolve: (c) => (c.enabled ? 'FILTERABLE' : 'NOT_FILTERABLE') }) }),
});
const Capabilities = builder.objectRef<Record<string, never>>('MetafieldCapabilities').implement({
  fields: (t) => ({
    adminFilterable: t.field({ type: Capability, resolve: () => ({ eligible: true, enabled: false }) }),
    smartCollectionCondition: t.field({ type: Capability, resolve: () => ({ eligible: false, enabled: false }) }),
    uniqueValues: t.field({ type: Capability, resolve: () => ({ eligible: false, enabled: false }) }),
  }),
});

const Definition = builder.objectRef<MetafieldDefinition>('MetafieldDefinition');
Definition.implement({
  interfaces: [Node],
  fields: (t) => ({
    name: t.exposeString('name'), namespace: t.exposeString('namespace'), key: t.exposeString('key'), description: t.exposeString('description', { nullable: true }),
    ownerType: t.field({ type: MetafieldOwnerType, resolve: (d) => d.ownerType as 'PRODUCT' }),
    type: t.field({ type: DefinitionType, resolve: (d) => ({ name: d.type }) }),
    validations: t.field({ type: [Validation], resolve: (d) => (d.validations as { name: string; value: string }[]) ?? [] }),
    pinnedPosition: t.int({ nullable: true, resolve: (d) => (d.pinned ? 1 : null) }),
    metafieldsCount: t.int({ args: { validationStatus: t.arg.string() }, resolve: (d, _a, ctx) => definitionValuesCount(ctx.db, ctx.shopId, d) }),
    useAsCollectionCondition: t.boolean({ resolve: () => false }),
    validationStatus: t.string({ resolve: () => 'ALL_VALID' }),
    access: t.field({ type: Access, resolve: (d) => ({ storefront: d.storefrontVisible ? 'PUBLIC_READ' : 'NONE' }) }),
    capabilities: t.field({ type: Capabilities, resolve: () => ({}) }),
    standardTemplate: t.string({ nullable: true, resolve: () => null }),
    constraints: t.string({ nullable: true, resolve: () => null }),
    legacyResourceId: t.field({ type: 'UnsignedInt64', resolve: legacyId }),
  }),
});
registerNode('MetafieldDefinition', (ctx, id) => getDefinition(ctx.db, ctx.shopId, id));
const DefinitionConnection = defineConnection('MetafieldDefinition', Definition);

const Identifier = builder.inputType('MetafieldDefinitionIdentifierInput', { fields: (t) => ({ ownerType: t.field({ type: MetafieldOwnerType, required: true }), namespace: t.string(), key: t.string({ required: true }) }) });
const DefinitionInput = builder.inputType('MetafieldDefinitionInput', {
  fields: (t) => ({
    namespace: t.string(), key: t.string({ required: true }), name: t.string({ required: true }), description: t.string(), ownerType: t.field({ type: MetafieldOwnerType, required: true }),
    type: t.string({ required: true }), validations: t.field({ type: [ValidationInput] }), pin: t.boolean({ defaultValue: false }), access: t.field({ type: AccessInput }),
  }),
});
const UpdateInput = builder.inputType('MetafieldDefinitionUpdateInput', {
  fields: (t) => ({
    namespace: t.string(), key: t.string({ required: true }), name: t.string(), description: t.string(), ownerType: t.field({ type: MetafieldOwnerType, required: true }),
    validations: t.field({ type: [ValidationInput] }), pin: t.boolean(), access: t.field({ type: AccessUpdateInput }),
  }),
});

const CreatePayload = defineTypedPayload<{ createdDefinition: MetafieldDefinition | null }>('MetafieldDefinitionCreatePayload', 'MetafieldDefinitionCreateUserError', (t) => ({
  createdDefinition: t.field({ type: Definition, nullable: true, resolve: (p) => p.createdDefinition }),
}));
const UpdatePayload = defineTypedPayload<{ updatedDefinition: MetafieldDefinition | null }>('MetafieldDefinitionUpdatePayload', 'MetafieldDefinitionUpdateUserError', (t) => ({
  updatedDefinition: t.field({ type: Definition, nullable: true, resolve: (p) => p.updatedDefinition }),
  validationJob: t.string({ nullable: true, resolve: () => null }),
}));
const DeletedIdentifier = builder.objectRef<{ ownerType: string; namespace: string; key: string }>('MetafieldDefinitionIdentifier').implement({
  fields: (t) => ({ ownerType: t.field({ type: MetafieldOwnerType, resolve: (d) => d.ownerType as 'PRODUCT' }), namespace: t.exposeString('namespace'), key: t.exposeString('key') }),
});
const DeletePayload = defineTypedPayload<{ deletedDefinitionId: string | null; deletedDefinition: { ownerType: string; namespace: string; key: string } | null }>('MetafieldDefinitionDeletePayload', 'MetafieldDefinitionDeleteUserError', (t) => ({
  deletedDefinitionId: t.id({ nullable: true, resolve: (p) => p.deletedDefinitionId }),
  deletedDefinition: t.field({ type: DeletedIdentifier, nullable: true, resolve: (p) => p.deletedDefinition }),
}));

const validationsOf = (v: { name: string; value: string }[] | null | undefined) => v?.map((x) => ({ name: x.name, value: x.value }));
const storefrontOf = (a: { storefront?: string | null } | null | undefined) => (a?.storefront === undefined || a?.storefront === null ? undefined : a.storefront !== 'NONE');

builder.queryFields((t) => ({
  metafieldDefinitions: t.field({
    type: DefinitionConnection,
    args: { ...ConnectionArgs, ownerType: t.arg({ type: MetafieldOwnerType, required: true }), namespace: t.arg.string(), key: t.arg.string(), pinnedStatus: t.arg.string({ defaultValue: 'ANY' }), query: t.arg.string(), sortKey: t.arg.string() },
    resolve: (_r, a, ctx) => {
      requireScope(ctx, 'read_products');
      const pinned = a.pinnedStatus === 'PINNED' ? true : a.pinnedStatus === 'UNPINNED' ? false : null;
      const q = a.query?.trim().toLowerCase();
      const fetch = async (offset: number, limit: number) => (await listDefinitions(ctx.db, ctx.shopId, { ownerType: a.ownerType, namespace: a.namespace, pinned, offset: 0, limit: 1000, reverse: !!a.reverse }))
        .filter((d) => (!a.key || d.key === a.key) && (!q || `${d.name} ${d.namespace}.${d.key}`.toLowerCase().includes(q))).slice(offset, offset + limit);
      return paginate(a, { fetch: ({ offset, limit }) => fetch(offset, limit), total: async () => (await fetch(0, 1000)).length });
    },
  }),
  metafieldDefinition: t.field({
    type: Definition, nullable: true, args: { id: t.arg.id(), identifier: t.arg({ type: Identifier }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'read_products');
      if (a.identifier) return findDefinition(ctx.db, ctx.shopId, a.identifier.ownerType, a.identifier.namespace ?? 'custom', a.identifier.key);
      const id = a.id ? parseId(String(a.id), 'MetafieldDefinition') : null;
      return id ? getDefinition(ctx.db, ctx.shopId, id) : null;
    },
  }),
}));

builder.mutationFields((t) => ({
  metafieldDefinitionCreate: t.field({
    type: CreatePayload, args: { definition: t.arg({ type: DefinitionInput, required: true }) },
    resolve: async (_r, { definition: d }, ctx) => {
      requireScope(ctx, 'write_products');
      const r = await createDefinition(ctx.db, ctx.shopId, { ownerType: d.ownerType, namespace: d.namespace, key: d.key, name: d.name, description: d.description, type: d.type, validations: validationsOf(d.validations), pin: d.pin, storefrontVisible: storefrontOf(d.access) });
      return r.ok ? { createdDefinition: r.value, userErrors: [] } : { createdDefinition: null, userErrors: r.errors.map((e) => ({ ...e, field: ['definition', ...(e.field ?? [])] })) };
    },
  }),
  metafieldDefinitionUpdate: t.field({
    type: UpdatePayload, args: { definition: t.arg({ type: UpdateInput, required: true }) },
    resolve: async (_r, { definition: d }, ctx) => {
      requireScope(ctx, 'write_products');
      const r = await updateDefinition(ctx.db, ctx.shopId, { ownerType: d.ownerType, namespace: d.namespace, key: d.key, name: d.name, description: d.description, validations: validationsOf(d.validations), pin: d.pin, storefrontVisible: storefrontOf(d.access) });
      return r.ok ? { updatedDefinition: r.value, userErrors: [] } : { updatedDefinition: null, userErrors: r.errors.map((e) => ({ ...e, field: ['definition', ...(e.field ?? [])] })) };
    },
  }),
  metafieldDefinitionDelete: t.field({
    type: DeletePayload, args: { id: t.arg.id(), identifier: t.arg({ type: Identifier }), deleteAllAssociatedMetafields: t.arg.boolean({ defaultValue: false }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_products');
      const cur = a.identifier ? await findDefinition(ctx.db, ctx.shopId, a.identifier.ownerType, a.identifier.namespace ?? 'custom', a.identifier.key) : a.id ? await getDefinition(ctx.db, ctx.shopId, parseId(String(a.id), 'MetafieldDefinition') ?? 0) : null;
      if (!cur) return { deletedDefinitionId: null, deletedDefinition: null, userErrors: [{ field: ['id'], message: 'Definition not found.', code: 'NOT_FOUND' }] };
      const r = await deleteDefinition(ctx.db, ctx.shopId, cur.id, !!a.deleteAllAssociatedMetafields);
      return r.ok ? { deletedDefinitionId: toGid('MetafieldDefinition', cur.id), deletedDefinition: { ownerType: cur.ownerType, namespace: cur.namespace, key: cur.key }, userErrors: [] } : { deletedDefinitionId: null, deletedDefinition: null, userErrors: r.errors };
    },
  }),
}));
