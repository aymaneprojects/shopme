/**
 * Shared building blocks of the catalog modules (products, collections, inventory, locations, metafields, files):
 * type refs (so modules can reference each other without import cycles), common enums/inputs, helpers.
 * Each module calls `.implement()` on the refs it owns.
 */
import { GraphQLError } from 'graphql';
import type { UserError as UserErrorShape } from '@shopme/shopify-compat';
import { parseId } from '@shopme/shopify-compat';
import { getShop, type Shop } from '@shopme/core';
import type { Collection, InventoryItem, InventoryLevel, Location, Media, Metafield, OptionWithValues, Product, Variant } from '@shopme/core';
import { builder } from '../builder';
import type { GraphQLContext } from '../context';
import { PageInfo, defineConnection, type Connection } from './connection';
import { DisplayableError } from './errors';
import { CODE_FALLBACKS, ERROR_CODES } from './error-codes';

export const Product_ = builder.objectRef<Product>('Product');
export const ProductVariant = builder.objectRef<Variant>('ProductVariant');
export const ProductOption = builder.objectRef<OptionWithValues>('ProductOption');
export const ProductOptionValue = builder.objectRef<{ id: number; name: string; hasVariants: boolean }>('ProductOptionValue');
export const Collection_ = builder.objectRef<Collection>('Collection');
export const Location_ = builder.objectRef<Location>('Location');
export const InventoryItem_ = builder.objectRef<InventoryItem>('InventoryItem');
export const InventoryLevel_ = builder.objectRef<InventoryLevel>('InventoryLevel');
export const Metafield_ = builder.objectRef<Metafield>('Metafield');
export const Media_ = builder.interfaceRef<Media>('Media');
export const File_ = builder.interfaceRef<Media>('File');

export const ProductConnection = defineConnection('Product', Product_);
export const ProductVariantConnection = defineConnection('ProductVariant', ProductVariant);
export const CollectionConnection = defineConnection('Collection', Collection_);
export const LocationConnection = defineConnection('Location', Location_);
export const InventoryItemConnection = defineConnection('InventoryItem', InventoryItem_);
export const InventoryLevelConnection = defineConnection('InventoryLevel', InventoryLevel_);
export const MetafieldConnection = defineConnection('Metafield', Metafield_);
export const MediaConnection = defineConnection<Media>('Media', Media_ as never);

export const MetafieldInput = builder.inputType('MetafieldInput', {
  fields: (t) => ({ id: t.id(), namespace: t.string(), key: t.string(), value: t.string(), type: t.string() }),
});
export const SEOInput = builder.inputType('SEOInput', { fields: (t) => ({ title: t.string(), description: t.string() }) });
export const SEO = builder.objectRef<{ title: string | null; description: string | null }>('SEO').implement({
  fields: (t) => ({ title: t.exposeString('title', { nullable: true }), description: t.exposeString('description', { nullable: true }) }),
});
export const Job = builder.objectRef<{ id: string; done: boolean }>('Job').implement({
  fields: (t) => ({ id: t.exposeID('id'), done: t.exposeBoolean('done') }),
});

/** Connection of plain strings (`StringConnection`, e.g. productTypes/productVendors/productTags). */
export const StringEdge = builder.objectRef<{ cursor: string; node: string }>('StringEdge').implement({
  fields: (t) => ({ cursor: t.exposeString('cursor'), node: t.exposeString('node') }),
});
export const StringConnection = builder.objectRef<Connection<string>>('StringConnection').implement({
  fields: (t) => ({
    edges: t.field({ type: [StringEdge], resolve: (c) => c.edges }),
    nodes: t.stringList({ resolve: (c) => c.nodes }),
    pageInfo: t.field({ type: PageInfo, resolve: (c) => c.pageInfo }),
  }),
});

/** `WeightUnit` is registered by the shop module; referenced by name here. */
export const WEIGHT_UNIT = 'WeightUnit' as never;

/* ------------------------------ helpers ------------------------------ */

const shops = new WeakMap<GraphQLContext, Promise<Shop>>();
/** The caller's shop row, loaded once per request. */
export function shopOf(ctx: GraphQLContext): Promise<Shop> {
  let p = shops.get(ctx);
  if (!p) { p = getShop(ctx.db, ctx.shopId).then((s) => { if (!s) throw new GraphQLError('Shop not found'); return s; }); shops.set(ctx, p); }
  return p;
}

/** Make a stored `/files/...` path absolute. */
export const absUrl = (ctx: GraphQLContext, url: string | null): string | null => (url && url.startsWith('/') ? ctx.storeUrl + url : url);

/** Offset/limit for connection resolvers that page with the shared `paginate` helper. */
export const asId = (value: string, type: string): number | null => parseId(value, type);

export const badId = (field: string[], type: string): UserErrorShape => ({ field, message: `Invalid id: ${type}`, code: 'INVALID' });

/** Prefix the field path of service errors (service paths are relative to the input object). */
export const prefixed = (errors: UserErrorShape[], prefix: string[]): UserErrorShape[] =>
  errors.map((e) => ({ ...e, field: e.field ? [...prefix, ...e.field] : prefix.length ? prefix : null }));

/* ------------------------------ typed payload errors ------------------------------ */

type FieldBuilder<Shape extends object> = PothosSchemaTypes.ObjectFieldBuilder<PothosSchemaTypes.ExtendDefaultTypes<import('../builder').SchemaTypes>, Shape>;
type ErrorName = keyof typeof ERROR_CODES;
const errorTypes = new Map<string, ReturnType<typeof builder.objectRef<UserErrorShape>>>();

/** `<Name>UserError implements DisplayableError { code field message }` with its `<Name>UserErrorCode` enum (created once). */
export function typedError(name: ErrorName) {
  const typeName = `${name}`;
  let ref = errorTypes.get(typeName);
  if (!ref) {
    const values = ERROR_CODES[name] as readonly string[];
    const Code = builder.enumType(`${typeName}Code`, { values: values as readonly [string, ...string[]] });
    ref = builder.objectRef<UserErrorShape>(typeName);
    ref.implement({
      interfaces: [DisplayableError],
      fields: (t) => ({ code: t.field({ type: Code, nullable: true, resolve: (e) => (e.code && values.includes(e.code) ? e.code : e.code && CODE_FALLBACKS[e.code] && values.includes(CODE_FALLBACKS[e.code]!) ? CODE_FALLBACKS[e.code] : null) as never }) }),
    });
    errorTypes.set(typeName, ref);
  }
  return ref;
}

/** Payload object whose `userErrors` use a typed error object (`code` included). */
export function defineTypedPayload<Shape extends object>(
  name: string, errorName: ErrorName, fields: (t: FieldBuilder<Shape & { userErrors: UserErrorShape[] }>) => Record<string, any>,
) {
  const Err = typedError(errorName);
  const ref = builder.objectRef<Shape & { userErrors: UserErrorShape[] }>(name);
  ref.implement({ fields: (t) => ({ ...fields(t as never), userErrors: t.field({ type: [Err], resolve: (p) => p.userErrors }) }) });
  return ref;
}
