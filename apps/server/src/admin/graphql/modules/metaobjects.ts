import { randomUUID } from 'node:crypto';
import {
  bulkDeleteMetaobjects, countMetaobjects, createMetaobject, createMetaobjectDefinition, deleteMetaobject, deleteMetaobjectDefinition, getMetaobject, getMetaobjectByHandle,
  getMetaobjectDefinition, getMetaobjectDefinitionByType, getMetafieldById, getPage, isListType, listMetaobjectDefinitions, listMetaobjects, metaobjectSummary, recentMetaobjects, referencedBy,
  schema as s, updateMetaobject, updateMetaobjectDefinition, upsertMetaobject, supportedValidations,
  type Metaobject, type MetaobjectDefinition,
} from '@shopme/core';
import { parseId, toGid } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { ConnectionArgs, PageInfo, defineConnection, paginate } from '../types/connection';
import { Node, loadNode, registerNode } from '../types/node';
import { File_, Collection_, Job, Location_, ProductVariant, Product_, Metafield_, defineTypedPayload, typedError } from '../types/catalog';
import { Customer_, Order_ } from '../types/sales';
import { DefinitionType, Validation, ValidationInput } from './metafield-definitions';
import { Page } from './content';
import { MediaImage } from './files';
import { Shop } from './shop';

type Row = Metaobject;
type MetaobjectFieldDef = MetaobjectDefinition['fieldDefinitions'][number];
type FieldShape = { entry: Row; def: MetaobjectFieldDef; value: string | null };

const Status = builder.enumType('MetaobjectStatus', { values: ['DRAFT', 'ACTIVE'] as const });
const AdminAccess = builder.enumType('MetaobjectAdminAccess', { values: ['PRIVATE', 'MERCHANT_READ', 'MERCHANT_READ_WRITE', 'PUBLIC_READ', 'PUBLIC_READ_WRITE'] as const });
const AdminAccessInput = builder.enumType('MetaobjectAdminAccessInput', { values: ['MERCHANT_READ', 'MERCHANT_READ_WRITE'] as const });
const StorefrontAccess = builder.enumType('MetaobjectStorefrontAccess', { values: ['NONE', 'PUBLIC_READ'] as const });
const CustomerAccess = builder.enumType('MetaobjectCustomerAccountAccess', { values: ['NONE', 'READ'] as const });

const gidOf = (type: string, id: number) => toGid(type, id);
const gidId = (v: unknown, type: string) => parseId(String(v), type);

/* ---------------------------------------------------------------- references (union) */

export const MetafieldReference = builder.unionType('MetafieldReference', {
  types: () => [Product_, ProductVariant, Collection_, Page, MediaImage, Metaobject_],
  resolveType: (n) => {
    const t = (n as { __typename?: string }).__typename;
    return t === 'ProductVariant' ? ProductVariant : t === 'Collection' ? Collection_ : t === 'Page' ? Page : t === 'Metaobject' ? Metaobject_ : t === 'MediaImage' ? MediaImage : Product_;
  },
});
const ReferenceConnection = builder.objectRef<{ edges: { cursor: string; node: unknown }[]; nodes: unknown[]; pageInfo: import('../types/connection').PageInfoShape }>('MetafieldReferenceConnection');
const ReferenceEdge = builder.objectRef<{ cursor: string; node: unknown }>('MetafieldReferenceEdge');

/** Load a referenced record (admin sees drafts too). Missing records read as null. */
async function loadRef(ctx: GraphQLContext, gid: string): Promise<unknown | null> {
  if (!/^gid:\/\/shopify\/(Product|ProductVariant|Collection|Page|MediaImage|Metaobject)\/\d+$/.test(gid)) {
    if (/^gid:\/\/shopify\/(GenericFile|Video|File)\/\d+$/.test(gid)) return loadNode(ctx, gid.replace(/\/(GenericFile|Video|File)\//, '/MediaImage/'));
    return null;
  }
  return loadNode(ctx, gid);
}
const itemsOf = (type: string, value: string | null): string[] => {
  if (!value) return [];
  if (!isListType(type)) return [value];
  try { const a = JSON.parse(value) as unknown; return Array.isArray(a) ? a.map(String) : []; } catch { return []; }
};
async function resolveRefs(ctx: GraphQLContext, type: string, value: string | null): Promise<unknown[]> {
  const out = await Promise.all(itemsOf(type, value).map((g) => loadRef(ctx, g)));
  return out.filter((x) => x != null);
}

/** `MetafieldReferenceConnection` over an in-memory list. */
const refConnection = (nodes: unknown[]) => ({
  nodes, edges: nodes.map((node, i) => ({ cursor: Buffer.from(`c:${i}`).toString('base64url'), node })),
  pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: nodes.length ? Buffer.from('c:0').toString('base64url') : null, endCursor: nodes.length ? Buffer.from(`c:${nodes.length - 1}`).toString('base64url') : null },
});
ReferenceEdge.implement({ fields: (t) => ({ cursor: t.exposeString('cursor'), node: t.field({ type: MetafieldReference, nullable: true, resolve: (e) => e.node as never }) }) });
ReferenceConnection.implement({
  fields: (t) => ({
    edges: t.field({ type: [ReferenceEdge], resolve: (c) => c.edges }),
    nodes: t.field({ type: [MetafieldReference], resolve: (c) => c.nodes as never }),
    pageInfo: t.field({ type: PageInfo, resolve: (c) => c.pageInfo }),
  }),
});

/* ---------------------------------------------------------------- field definitions */

const FieldDefinition = builder.objectRef<MetaobjectFieldDef>('MetaobjectFieldDefinition');
const AdminFilterable = builder.objectRef<{ enabled: boolean }>('MetaobjectFieldCapabilityAdminFilterable').implement({
  fields: (t) => ({ eligible: t.boolean({ resolve: (c) => !c.enabled || true }), enabled: t.exposeBoolean('enabled') }),
});
const FieldDefCapabilities = builder.objectRef<MetaobjectFieldDef>('MetaobjectFieldDefinitionCapabilities').implement({
  fields: (t) => ({ adminFilterable: t.field({ type: AdminFilterable, resolve: (f) => ({ enabled: !!f.adminFilterable }) }) }),
});
FieldDefinition.implement({
  fields: (t) => ({
    key: t.exposeString('key'), name: t.exposeString('name'), description: t.exposeString('description', { nullable: true }), required: t.exposeBoolean('required'),
    type: t.field({ type: DefinitionType, resolve: (f) => ({ name: f.type }) }),
    validations: t.field({ type: [Validation], resolve: (f) => f.validations.map((v: { name: string; value: string }) => ({ name: v.name, value: v.value })) }),
    capabilities: t.field({ type: FieldDefCapabilities, resolve: (f) => f }),
  }),
});

/* ---------------------------------------------------------------- definition */

const Definition_ = builder.objectRef<MetaobjectDefinition>('MetaobjectDefinition');
const Metaobject_ = builder.objectRef<Row>('Metaobject');
const MetaobjectConnection = defineConnection('Metaobject', Metaobject_);
const Access = builder.objectRef<MetaobjectDefinition>('MetaobjectAccess').implement({
  fields: (t) => ({
    admin: t.field({ type: AdminAccess, resolve: (d) => d.accessAdmin as 'PRIVATE' }),
    storefront: t.field({ type: StorefrontAccess, resolve: (d) => d.accessStorefront as 'NONE' }),
    customerAccount: t.field({ type: CustomerAccess, resolve: (d) => d.accessCustomerAccount as 'NONE' }),
  }),
});
const Enabled = builder.objectRef<{ enabled: boolean }>('MetaobjectCapabilitiesPublishable').implement({ fields: (t) => ({ enabled: t.exposeBoolean('enabled') }) });
const EnabledTr = builder.objectRef<{ enabled: boolean }>('MetaobjectCapabilitiesTranslatable').implement({ fields: (t) => ({ enabled: t.exposeBoolean('enabled') }) });
const RenderableData = builder.objectRef<MetaobjectDefinition>('MetaobjectCapabilityDefinitionDataRenderable').implement({
  fields: (t) => ({ metaTitleKey: t.exposeString('renderableMetaTitleKey', { nullable: true }), metaDescriptionKey: t.exposeString('renderableMetaDescKey', { nullable: true }) }),
});
const Renderable = builder.objectRef<MetaobjectDefinition>('MetaobjectCapabilitiesRenderable').implement({
  fields: (t) => ({ enabled: t.boolean({ resolve: (d) => d.capRenderable }), data: t.field({ type: RenderableData, nullable: true, resolve: (d) => (d.capRenderable ? d : null) }) }),
});
const OnlineStoreData = builder.objectRef<MetaobjectDefinition>('MetaobjectCapabilityDefinitionDataOnlineStore').implement({
  fields: (t) => ({ urlHandle: t.string({ resolve: (d) => d.onlineStoreUrlHandle ?? '' }), canCreateRedirects: t.boolean({ resolve: (d) => d.onlineStoreCreateRedirects }) }),
});
const OnlineStore = builder.objectRef<MetaobjectDefinition>('MetaobjectCapabilitiesOnlineStore').implement({
  fields: (t) => ({ enabled: t.boolean({ resolve: (d) => d.capOnlineStore }), data: t.field({ type: OnlineStoreData, nullable: true, resolve: (d) => (d.capOnlineStore ? d : null) }) }),
});
const Capabilities = builder.objectRef<MetaobjectDefinition>('MetaobjectCapabilities').implement({
  fields: (t) => ({
    publishable: t.field({ type: Enabled, resolve: (d) => ({ enabled: d.capPublishable }) }),
    translatable: t.field({ type: EnabledTr, resolve: (d) => ({ enabled: d.capTranslatable }) }),
    renderable: t.field({ type: Renderable, nullable: true, resolve: (d) => d }),
    onlineStore: t.field({ type: OnlineStore, nullable: true, resolve: (d) => d }),
  }),
});

Definition_.implement({
  interfaces: [Node],
  fields: (t) => ({
    type: t.exposeString('type'), name: t.exposeString('name'), description: t.exposeString('description', { nullable: true }), displayNameKey: t.exposeString('displayNameKey', { nullable: true }),
    fieldDefinitions: t.field({ type: [FieldDefinition], resolve: (d) => d.fieldDefinitions }),
    access: t.field({ type: Access, resolve: (d) => d }), capabilities: t.field({ type: Capabilities, resolve: (d) => d }),
    hasThumbnailField: t.boolean({ resolve: (d) => d.fieldDefinitions.some((f) => f.type === 'file_reference' || f.type === 'color') }),
    metaobjectsCount: t.int({ resolve: (d) => d.entryCount }),
    metaobjects: t.field({
      type: MetaobjectConnection, args: ConnectionArgs,
      resolve: (d, a, ctx) => {
        requireScope(ctx, 'read_metaobjects');
        return paginate(a, { fetch: ({ offset, limit }) => listMetaobjects(ctx.db, ctx.shopId, { type: d.type, definition: d, reverse: !!a.reverse, offset, limit }), total: async () => d.entryCount });
      },
    }),
    createdAt: t.field({ type: 'DateTime', resolve: (d) => d.createdAt }), updatedAt: t.field({ type: 'DateTime', resolve: (d) => d.updatedAt }),
  }),
});
registerNode('MetaobjectDefinition', (ctx, id) => getMetaobjectDefinition(ctx.db, ctx.shopId, id));
const DefinitionConnection = defineConnection('MetaobjectDefinition', Definition_);

/* ---------------------------------------------------------------- entry */

const Thumbnail = builder.objectRef<{ file: unknown | null; hex: string | null }>('MetaobjectThumbnail').implement({
  fields: (t) => ({ file: t.field({ type: File_, nullable: true, resolve: (x) => x.file as never }), hex: t.string({ nullable: true, resolve: (x) => x.hex }) }),
});
const Field_ = builder.objectRef<FieldShape>('MetaobjectField');
Field_.implement({
  fields: (t) => ({
    key: t.string({ resolve: (f) => f.def.key }), type: t.string({ resolve: (f) => f.def.type }), value: t.string({ nullable: true, resolve: (f) => f.value }),
    jsonValue: t.field({ type: 'JSON', nullable: true, resolve: (f) => jsonOf(f.def.type, f.value) }),
    definition: t.field({ type: FieldDefinition, resolve: (f) => f.def }),
    reference: t.field({ type: MetafieldReference, nullable: true, resolve: async (f, _a, ctx) => (isListType(f.def.type) ? null : ((await resolveRefs(ctx, f.def.type, f.value))[0] ?? null)) as never }),
    references: t.field({
      type: ReferenceConnection, nullable: true, args: { first: t.arg.int(), after: t.arg.string(), last: t.arg.int(), before: t.arg.string() },
      resolve: async (f, _a, ctx) => (isListType(f.def.type) && /reference$/.test(f.def.type) ? refConnection(await resolveRefs(ctx, f.def.type, f.value)) : null),
    }),
    thumbnail: t.field({ type: Thumbnail, nullable: true, resolve: async (f, _a, ctx) => thumbOf(ctx, f) }),
  }),
});

function jsonOf(type: string, value: string | null): unknown {
  if (value === null) return null;
  try {
    if (isListType(type)) return JSON.parse(value) as unknown;
    if (type === 'number_integer' || type === 'number_decimal') return Number(value);
    if (type === 'boolean') return value === 'true';
    if (['json', 'weight', 'volume', 'dimension', 'money', 'rating'].includes(type)) return JSON.parse(value) as unknown;
  } catch { /* fall through */ }
  return value;
}
async function thumbOf(ctx: GraphQLContext, f: FieldShape) {
  if (!f.value) return null;
  if (f.def.type === 'color') return { file: null, hex: f.value };
  if (f.def.type === 'file_reference') return { file: await loadRef(ctx, f.value), hex: null };
  return null;
}
const fieldsOf = (e: Row, def: MetaobjectDefinition): FieldShape[] => def.fieldDefinitions.map((d) => ({ entry: e, def: d, value: e.values[d.key] ?? null }));
const defOf = (ctx: GraphQLContext, e: Row) => getMetaobjectDefinition(ctx.db, ctx.shopId, e.definitionId) as Promise<MetaobjectDefinition>;

const PublishableData = builder.objectRef<{ status: string }>('MetaobjectCapabilityDataPublishable').implement({ fields: (t) => ({ status: t.field({ type: Status, resolve: (x) => x.status as 'ACTIVE' }) }) });
const OnlineStoreEntryData = builder.objectRef<{ templateSuffix: string | null }>('MetaobjectCapabilityDataOnlineStore').implement({ fields: (t) => ({ templateSuffix: t.exposeString('templateSuffix', { nullable: true }) }) });
const EntryCaps = builder.objectRef<{ publishable: { status: string } | null; onlineStore: { templateSuffix: string | null } | null }>('MetaobjectCapabilityData').implement({
  fields: (t) => ({ publishable: t.field({ type: PublishableData, nullable: true, resolve: (c) => c.publishable }), onlineStore: t.field({ type: OnlineStoreEntryData, nullable: true, resolve: (c) => c.onlineStore }) }),
});

/** Where an entry is used: `MetafieldRelation` with a referencer union. */
const Referencer = builder.unionType('MetafieldReferencer', {
  types: () => [Metaobject_, Product_, ProductVariant, Collection_, Page, Customer_, Order_, Location_, Shop],
  resolveType: (n) => {
    const t = (n as { __typename?: string }).__typename;
    return ({ Metaobject: Metaobject_, ProductVariant, Collection: Collection_, Page, Customer: Customer_, Order: Order_, Location: Location_, Shop } as unknown as Record<string, never>)[t ?? ''] ?? Product_;
  },
});
const Relation = builder.objectRef<{ key: string; name: string; namespace: string; referencer: unknown }>('MetafieldRelation').implement({
  fields: (t) => ({
    key: t.exposeString('key'), name: t.exposeString('name'), namespace: t.exposeString('namespace'),
    referencer: t.field({ type: Referencer, resolve: (r) => r.referencer as never }),
  }),
});
const RelationConnection = defineConnection('MetafieldRelation', Relation);
const OWNER_GID: Record<string, string> = { PRODUCT: 'Product', PRODUCTVARIANT: 'ProductVariant', COLLECTION: 'Collection', CUSTOMER: 'Customer', ORDER: 'Order', LOCATION: 'Location', SHOP: 'Shop' };

async function relations(ctx: GraphQLContext, e: Row) {
  const refs = await referencedBy(ctx.db, ctx.shopId, e.id);
  const out: { key: string; name: string; namespace: string; referencer: unknown }[] = [];
  for (const r of refs) {
    if (r.sourceKind === 'METAOBJECT') {
      const src = await getMetaobject(ctx.db, ctx.shopId, r.sourceId);
      if (!src) continue;
      const node = await loadNode(ctx, gidOf('Metaobject', src.id));
      const def = await defOf(ctx, src);
      if (node) out.push({ key: r.fieldKey, name: def.fieldDefinitions.find((f) => f.key === r.fieldKey)?.name ?? r.fieldKey, namespace: `${src.type}`, referencer: node });
    } else {
      const mf = await getMetafieldById(ctx.db, ctx.shopId, r.sourceId);
      const type = mf && OWNER_GID[mf.ownerType];
      if (!mf || !type) continue;
      const node = await loadNode(ctx, gidOf(type, mf.ownerId));
      if (node) out.push({ key: mf.key, name: mf.key, namespace: mf.namespace, referencer: node });
    }
  }
  return out;
}

Metaobject_.implement({
  interfaces: [Node],
  fields: (t) => ({
    type: t.exposeString('type'), handle: t.exposeString('handle'), displayName: t.exposeString('displayName'), shopmeExternalId: t.exposeString('externalId', { nullable: true }),
    fields: t.field({ type: [Field_], resolve: async (e, _a, ctx) => fieldsOf(e, await defOf(ctx, e)) }),
    field: t.field({ type: Field_, nullable: true, args: { key: t.arg.string({ required: true }) }, resolve: async (e, a, ctx) => fieldsOf(e, await defOf(ctx, e)).find((f) => f.def.key === a.key) ?? null }),
    values: t.field({ type: 'JSON', resolve: (e) => e.values }),
    definition: t.field({ type: Definition_, resolve: (e, _a, ctx) => defOf(ctx, e) }),
    capabilities: t.field({
      type: EntryCaps,
      resolve: async (e, _a, ctx) => { const d = await defOf(ctx, e); return { publishable: d.capPublishable ? { status: e.status } : null, onlineStore: d.capOnlineStore ? { templateSuffix: e.templateSuffix } : null }; },
    }),
    thumbnailField: t.field({
      type: Field_, nullable: true,
      resolve: async (e, _a, ctx) => { const d = await defOf(ctx, e); const f = fieldsOf(e, d).find((x) => (x.def.type === 'file_reference' || x.def.type === 'color') && x.value); return f ?? null; },
    }),
    referencedBy: t.field({
      type: RelationConnection, args: ConnectionArgs,
      resolve: async (e, a, ctx) => { const all = await relations(ctx, e); return paginate(a, { fetch: async ({ offset, limit }) => (a.reverse ? [...all].reverse() : all).slice(offset, offset + limit), total: async () => all.length }); },
    }),
    createdAt: t.field({ type: 'DateTime', resolve: (e) => e.createdAt }), updatedAt: t.field({ type: 'DateTime', resolve: (e) => e.updatedAt }),
  }),
});
registerNode('Metaobject', (ctx, id) => getMetaobject(ctx.db, ctx.shopId, id));

// Reference accessors on metafields (the type is part of the stored row).
builder.objectFields(Metafield_, (t) => ({
  reference: t.field({
    type: MetafieldReference, nullable: true,
    resolve: async (m, _a, ctx) => (isListType(m.type) ? null : ((await resolveRefs(ctx, m.type, m.value))[0] ?? null)) as never,
  }),
  references: t.field({
    type: ReferenceConnection, nullable: true, args: { first: t.arg.int(), after: t.arg.string(), last: t.arg.int(), before: t.arg.string() },
    resolve: async (m, _a, ctx) => (isListType(m.type) && /reference$/.test(m.type) ? refConnection(await resolveRefs(ctx, m.type, m.value)) : null),
  }),
}));

/* ---------------------------------------------------------------- inputs and payloads */

const FieldInput = builder.inputType('MetaobjectFieldInput', { fields: (t) => ({ key: t.string({ required: true }), value: t.string({ required: true }) }) });
const AccessInputT = builder.inputType('MetaobjectAccessInput', { fields: (t) => ({ admin: t.field({ type: AdminAccessInput }), storefront: t.field({ type: StorefrontAccess }), customerAccount: t.field({ type: CustomerAccess }) }) });
const FilterableInput = builder.inputType('MetaobjectFieldCapabilityAdminFilterableInput', { fields: (t) => ({ enabled: t.boolean({ required: true }) }) });
const FieldCapsInput = builder.inputType('MetaobjectFieldDefinitionCapabilityCreateInput', { fields: (t) => ({ adminFilterable: t.field({ type: FilterableInput }) }) });
const FieldDefCreateInput = builder.inputType('MetaobjectFieldDefinitionCreateInput', {
  fields: (t) => ({
    key: t.string({ required: true }), type: t.string({ required: true }), name: t.string(), description: t.string(), required: t.boolean({ defaultValue: false }),
    validations: t.field({ type: [ValidationInput] }), capabilities: t.field({ type: FieldCapsInput }),
  }),
});
const FieldDefUpdateInput = builder.inputType('MetaobjectFieldDefinitionUpdateInput', {
  fields: (t) => ({ key: t.string({ required: true }), name: t.string(), description: t.string(), required: t.boolean(), validations: t.field({ type: [ValidationInput] }), capabilities: t.field({ type: FieldCapsInput }) }),
});
const FieldDefDeleteInput = builder.inputType('MetaobjectFieldDefinitionDeleteInput', { fields: (t) => ({ key: t.string({ required: true }) }) });
const FieldDefOpInput = builder.inputType('MetaobjectFieldDefinitionOperationInput', {
  fields: (t) => ({ create: t.field({ type: FieldDefCreateInput }), update: t.field({ type: FieldDefUpdateInput }), delete: t.field({ type: FieldDefDeleteInput }) }),
});
const Enabled_ = (name: string) => builder.inputType(name, { fields: (t) => ({ enabled: t.boolean({ required: true }) }) });
const CapPublishableInput = Enabled_('MetaobjectCapabilityPublishableInput');
const CapTranslatableInput = Enabled_('MetaobjectCapabilityTranslatableInput');
const RenderableDataInput = builder.inputType('MetaobjectCapabilityDefinitionDataRenderableInput', { fields: (t) => ({ metaTitleKey: t.string(), metaDescriptionKey: t.string() }) });
const CapRenderableInput = builder.inputType('MetaobjectCapabilityRenderableInput', { fields: (t) => ({ enabled: t.boolean({ required: true }), data: t.field({ type: RenderableDataInput }) }) });
const OnlineStoreDataInput = builder.inputType('MetaobjectCapabilityDefinitionDataOnlineStoreInput', { fields: (t) => ({ urlHandle: t.string({ required: true }), createRedirects: t.boolean({ defaultValue: false }) }) });
const CapOnlineStoreInput = builder.inputType('MetaobjectCapabilityOnlineStoreInput', { fields: (t) => ({ enabled: t.boolean({ required: true }), data: t.field({ type: OnlineStoreDataInput }) }) });
const capFields = (t: PothosSchemaTypes.InputFieldBuilder<PothosSchemaTypes.ExtendDefaultTypes<import('../builder').SchemaTypes>, 'InputObject'>) => ({
  publishable: t.field({ type: CapPublishableInput }), translatable: t.field({ type: CapTranslatableInput }), renderable: t.field({ type: CapRenderableInput }), onlineStore: t.field({ type: CapOnlineStoreInput }),
});
const CapCreateInput = builder.inputType('MetaobjectCapabilityCreateInput', { fields: capFields });
const CapUpdateInput = builder.inputType('MetaobjectCapabilityUpdateInput', { fields: capFields });
const DefinitionCreateInput = builder.inputType('MetaobjectDefinitionCreateInput', {
  fields: (t) => ({
    name: t.string(), description: t.string(), type: t.string({ required: true }), fieldDefinitions: t.field({ type: [FieldDefCreateInput] }), access: t.field({ type: AccessInputT }),
    displayNameKey: t.string(), capabilities: t.field({ type: CapCreateInput }),
  }),
});
const DefinitionUpdateInput = builder.inputType('MetaobjectDefinitionUpdateInput', {
  fields: (t) => ({
    name: t.string(), description: t.string(), fieldDefinitions: t.field({ type: [FieldDefOpInput] }), access: t.field({ type: AccessInputT }), displayNameKey: t.string(),
    resetFieldOrder: t.boolean({ defaultValue: false }), capabilities: t.field({ type: CapUpdateInput }),
  }),
});
const PublishableDataInput = builder.inputType('MetaobjectCapabilityDataPublishableInput', { fields: (t) => ({ status: t.field({ type: Status, required: true }) }) });
const OnlineStoreEntryInput = builder.inputType('MetaobjectCapabilityDataOnlineStoreInput', { fields: (t) => ({ templateSuffix: t.string() }) });
const EntryCapsInput = builder.inputType('MetaobjectCapabilityDataInput', { fields: (t) => ({ publishable: t.field({ type: PublishableDataInput }), onlineStore: t.field({ type: OnlineStoreEntryInput }) }) });
const CreateInput = builder.inputType('MetaobjectCreateInput', {
  fields: (t) => ({ type: t.string({ required: true }), handle: t.string(), shopmeExternalId: t.string(), fields: t.field({ type: [FieldInput] }), capabilities: t.field({ type: EntryCapsInput }), values: t.field({ type: 'JSON' }) }),
});
const UpdateInput = builder.inputType('MetaobjectUpdateInput', {
  fields: (t) => ({ handle: t.string(), shopmeExternalId: t.string(), fields: t.field({ type: [FieldInput] }), capabilities: t.field({ type: EntryCapsInput }), redirectNewHandle: t.boolean({ defaultValue: false }), values: t.field({ type: 'JSON' }) }),
});
const UpsertInput = builder.inputType('MetaobjectUpsertInput', { fields: (t) => ({ handle: t.string(), fields: t.field({ type: [FieldInput] }), capabilities: t.field({ type: EntryCapsInput }) }) });
const HandleInput = builder.inputType('MetaobjectHandleInput', { fields: (t) => ({ type: t.string({ required: true }), handle: t.string({ required: true }) }) });
const BulkWhereInput = builder.inputType('MetaobjectBulkDeleteWhereCondition', { fields: (t) => ({ type: t.string(), ids: t.idList() }) });

builder.objectFields(typedError('MetaobjectUserError'), (t) => ({
  elementKey: t.string({ nullable: true, resolve: (e) => (e as { elementKey?: string }).elementKey ?? null }),
  elementIndex: t.int({ nullable: true, resolve: (e) => (e as { elementIndex?: number }).elementIndex ?? null }),
}));

const DefCreatePayload = defineTypedPayload<{ metaobjectDefinition: MetaobjectDefinition | null }>('MetaobjectDefinitionCreatePayload', 'MetaobjectUserError', (t) => ({ metaobjectDefinition: t.field({ type: Definition_, nullable: true, resolve: (p) => p.metaobjectDefinition }) }));
const DefUpdatePayload = defineTypedPayload<{ metaobjectDefinition: MetaobjectDefinition | null }>('MetaobjectDefinitionUpdatePayload', 'MetaobjectUserError', (t) => ({ metaobjectDefinition: t.field({ type: Definition_, nullable: true, resolve: (p) => p.metaobjectDefinition }) }));
const DefDeletePayload = defineTypedPayload<{ deletedId: string | null }>('MetaobjectDefinitionDeletePayload', 'MetaobjectUserError', (t) => ({ deletedId: t.id({ nullable: true, resolve: (p) => p.deletedId }) }));
const EntryPayload = (name: string) => defineTypedPayload<{ metaobject: Row | null }>(name, 'MetaobjectUserError', (t) => ({ metaobject: t.field({ type: Metaobject_, nullable: true, resolve: (p) => p.metaobject }) }));
const CreatePayload = EntryPayload('MetaobjectCreatePayload');
const UpdatePayload = EntryPayload('MetaobjectUpdatePayload');
const UpsertPayload = EntryPayload('MetaobjectUpsertPayload');
const DeletePayload = defineTypedPayload<{ deletedId: string | null }>('MetaobjectDeletePayload', 'MetaobjectUserError', (t) => ({ deletedId: t.id({ nullable: true, resolve: (p) => p.deletedId }) }));
const BulkPayload = defineTypedPayload<{ job: { id: string; done: boolean } | null }>('MetaobjectBulkDeletePayload', 'MetaobjectUserError', (t) => ({ job: t.field({ type: Job, nullable: true, resolve: (p) => p.job }) }));

const caps = (c: { publishable?: { status: string } | null; onlineStore?: { templateSuffix?: string | null } | null } | null | undefined) => c ?? undefined;
const staffOf = (ctx: GraphQLContext) => ({ staffId: (ctx.auth as { staffId?: number | null }).staffId ?? null });

/* ---------------------------------------------------------------- summary for the admin landing page */

const Summary = builder.objectRef<{ active: number; draft: number; webPages: number; webEntries: number; total: number; recent: Row[] }>('ShopmeMetaobjectsSummary').implement({
  fields: (t) => ({
    activeCount: t.int({ resolve: (x) => x.active }), draftCount: t.int({ resolve: (x) => x.draft }), webPageCount: t.int({ resolve: (x) => x.webPages }), webPageEntryCount: t.int({ resolve: (x) => x.webEntries }), totalCount: t.int({ resolve: (x) => x.total }),
    recent: t.field({ type: [Metaobject_], resolve: (x) => x.recent }),
  }),
});

/* ---------------------------------------------------------------- root fields */

builder.queryFields((t) => ({
  metaobject: t.field({ type: Metaobject_, nullable: true, args: { id: t.arg.id({ required: true }) }, resolve: (_r, a, ctx) => { requireScope(ctx, 'read_metaobjects'); const id = gidId(a.id, 'Metaobject'); return id ? getMetaobject(ctx.db, ctx.shopId, id) : null; } }),
  metaobjectByHandle: t.field({ type: Metaobject_, nullable: true, args: { handle: t.arg({ type: HandleInput, required: true }) }, resolve: (_r, a, ctx) => { requireScope(ctx, 'read_metaobjects'); return getMetaobjectByHandle(ctx.db, ctx.shopId, a.handle.type, a.handle.handle); } }),
  metaobjects: t.field({
    type: MetaobjectConnection, args: { ...ConnectionArgs, type: t.arg.string({ required: true }), sortKey: t.arg.string(), query: t.arg.string() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'read_metaobjects');
      const def = await getMetaobjectDefinitionByType(ctx.db, ctx.shopId, a.type);
      if (!def) return paginate(a, { fetch: async () => [], total: async () => 0 });
      return paginate(a, { fetch: ({ offset, limit }) => listMetaobjects(ctx.db, ctx.shopId, { type: def.type, definition: def, query: a.query, sortKey: a.sortKey, reverse: !!a.reverse, offset, limit }), total: () => countMetaobjects(ctx.db, ctx.shopId, { type: def.type, definition: def, query: a.query }) });
    },
  }),
  metaobjectDefinition: t.field({ type: Definition_, nullable: true, args: { id: t.arg.id({ required: true }) }, resolve: (_r, a, ctx) => { requireScope(ctx, 'read_metaobjects'); const id = gidId(a.id, 'MetaobjectDefinition'); return id ? getMetaobjectDefinition(ctx.db, ctx.shopId, id) : null; } }),
  metaobjectDefinitionByType: t.field({ type: Definition_, nullable: true, args: { type: t.arg.string({ required: true }) }, resolve: (_r, a, ctx) => { requireScope(ctx, 'read_metaobjects'); return getMetaobjectDefinitionByType(ctx.db, ctx.shopId, a.type); } }),
  metaobjectDefinitions: t.field({
    type: DefinitionConnection, args: { ...ConnectionArgs, query: t.arg.string() },
    resolve: (_r, a, ctx) => {
      requireScope(ctx, 'read_metaobjects');
      return paginate(a, { fetch: ({ offset, limit }) => listMetaobjectDefinitions(ctx.db, ctx.shopId, { offset, limit, reverse: !!a.reverse, query: a.query }), total: async () => (await listMetaobjectDefinitions(ctx.db, ctx.shopId, { offset: 0, limit: 1000, query: a.query })).length });
    },
  }),
  shopmeMetaobjects: t.field({
    type: MetaobjectConnection, args: { ...ConnectionArgs, sortKey: t.arg.string(), query: t.arg.string() },
    resolve: (_r, a, ctx) => {
      requireScope(ctx, 'read_metaobjects');
      return paginate(a, { fetch: ({ offset, limit }) => listMetaobjects(ctx.db, ctx.shopId, { query: a.query, sortKey: a.sortKey ?? 'updated_at', reverse: a.sortKey ? !!a.reverse : !a.reverse, offset, limit }), total: () => countMetaobjects(ctx.db, ctx.shopId, { query: a.query }) });
    },
  }),
  shopmeMetaobjectsSummary: t.field({
    type: Summary,
    resolve: async (_r, _a, ctx) => { requireScope(ctx, 'read_metaobjects'); return { ...(await metaobjectSummary(ctx.db, ctx.shopId)), recent: await recentMetaobjects(ctx.db, ctx.shopId, 5) }; },
  }),
}));

const fieldInputs = (f: { key: string; type: string; name?: string | null; description?: string | null; required?: boolean | null; validations?: { name: string; value: string }[] | null; capabilities?: { adminFilterable?: { enabled: boolean } | null } | null }) =>
  ({ key: f.key, type: f.type, name: f.name, description: f.description, required: f.required, validations: f.validations, adminFilterable: f.capabilities?.adminFilterable?.enabled });

builder.mutationFields((t) => ({
  metaobjectDefinitionCreate: t.field({
    type: DefCreatePayload, args: { definition: t.arg({ type: DefinitionCreateInput, required: true }) },
    resolve: async (_r, { definition: d }, ctx) => {
      requireScope(ctx, 'write_metaobjects');
      const r = await createMetaobjectDefinition(ctx.db, ctx.shopId, {
        type: d.type, name: d.name, description: d.description, displayNameKey: d.displayNameKey, access: d.access, capabilities: d.capabilities,
        fieldDefinitions: d.fieldDefinitions?.map(fieldInputs),
      });
      return r.ok ? { metaobjectDefinition: r.value, userErrors: [] } : { metaobjectDefinition: null, userErrors: r.errors };
    },
  }),
  metaobjectDefinitionUpdate: t.field({
    type: DefUpdatePayload, args: { id: t.arg.id({ required: true }), definition: t.arg({ type: DefinitionUpdateInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_metaobjects');
      const id = gidId(a.id, 'MetaobjectDefinition');
      const d = a.definition;
      const r = id ? await updateMetaobjectDefinition(ctx.db, ctx.shopId, id, {
        name: d.name, description: d.description, displayNameKey: d.displayNameKey, access: d.access, resetFieldOrder: d.resetFieldOrder, capabilities: d.capabilities,
        fieldDefinitions: d.fieldDefinitions?.map((op) => ({ create: op.create ? fieldInputs(op.create) : null, update: op.update ? fieldInputs({ ...op.update, type: '' }) : null, delete: op.delete })) as never,
      }) : { ok: false as const, errors: [{ field: ['id'], message: 'Definition not found.', code: 'RECORD_NOT_FOUND' }] };
      return r.ok ? { metaobjectDefinition: r.value, userErrors: [] } : { metaobjectDefinition: null, userErrors: r.errors };
    },
  }),
  metaobjectDefinitionDelete: t.field({
    type: DefDeletePayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_metaobjects');
      const id = gidId(a.id, 'MetaobjectDefinition');
      const r = id ? await deleteMetaobjectDefinition(ctx.db, ctx.shopId, id) : { ok: false as const, errors: [{ field: ['id'], message: 'Definition not found.', code: 'RECORD_NOT_FOUND' }] };
      return r.ok ? { deletedId: gidOf('MetaobjectDefinition', r.value), userErrors: [] } : { deletedId: null, userErrors: r.errors };
    },
  }),
  metaobjectCreate: t.field({
    type: CreatePayload, args: { metaobject: t.arg({ type: CreateInput, required: true }) },
    resolve: async (_r, { metaobject: m }, ctx) => {
      requireScope(ctx, 'write_metaobjects');
      const r = await createMetaobject(ctx.db, ctx.shopId, { type: m.type, handle: m.handle, externalId: m.shopmeExternalId, fields: m.fields, values: m.values as Record<string, unknown> | null, capabilities: caps(m.capabilities) }, staffOf(ctx));
      return r.ok ? { metaobject: r.value, userErrors: [] } : { metaobject: null, userErrors: r.errors };
    },
  }),
  metaobjectUpdate: t.field({
    type: UpdatePayload, args: { id: t.arg.id({ required: true }), metaobject: t.arg({ type: UpdateInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_metaobjects');
      const id = gidId(a.id, 'Metaobject');
      const m = a.metaobject;
      const r = id ? await updateMetaobject(ctx.db, ctx.shopId, id, { handle: m.handle, externalId: m.shopmeExternalId, fields: m.fields, values: m.values as Record<string, unknown> | null, capabilities: caps(m.capabilities), redirectNewHandle: m.redirectNewHandle })
        : { ok: false as const, errors: [{ field: ['id'], message: 'Record not found.', code: 'RECORD_NOT_FOUND' }] };
      return r.ok ? { metaobject: r.value, userErrors: [] } : { metaobject: null, userErrors: r.errors };
    },
  }),
  metaobjectUpsert: t.field({
    type: UpsertPayload, args: { handle: t.arg({ type: HandleInput, required: true }), metaobject: t.arg({ type: UpsertInput }), values: t.arg({ type: 'JSON' }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_metaobjects');
      const r = await upsertMetaobject(ctx.db, ctx.shopId, a.handle, { fields: a.metaobject?.fields, values: a.values as Record<string, unknown> | null, capabilities: caps(a.metaobject?.capabilities) }, staffOf(ctx));
      return r.ok ? { metaobject: r.value, userErrors: [] } : { metaobject: null, userErrors: r.errors };
    },
  }),
  metaobjectDelete: t.field({
    type: DeletePayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_metaobjects');
      const id = gidId(a.id, 'Metaobject');
      const r = id ? await deleteMetaobject(ctx.db, ctx.shopId, id) : { ok: false as const, errors: [{ field: ['id'], message: 'Record not found.', code: 'RECORD_NOT_FOUND' }] };
      return r.ok ? { deletedId: gidOf('Metaobject', r.value), userErrors: [] } : { deletedId: null, userErrors: r.errors };
    },
  }),
  metaobjectBulkDelete: t.field({
    type: BulkPayload, args: { where: t.arg({ type: BulkWhereInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_metaobjects');
      const ids = a.where.ids?.map((x) => gidId(x, 'Metaobject')).filter((x): x is number => x != null) ?? null;
      const r = await bulkDeleteMetaobjects(ctx.db, ctx.shopId, { type: a.where.type, ids });
      return r.ok ? { job: { id: toGid('Job', randomUUID()), done: true }, userErrors: [] } : { job: null, userErrors: r.errors };
    },
  }),
}));
