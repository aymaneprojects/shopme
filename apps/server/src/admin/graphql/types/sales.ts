/**
 * Shared building blocks of the sales modules (orders, customers, discounts, settings): countries, mailing addresses,
 * staff members, timeline events, and the generic `tagsAdd` / `tagsRemove` dispatcher.
 */
import { getStaff, type Customer, type Order, type StaffMemberRow } from '@shopme/core';
import type { UserError as UserErrorShape } from '@shopme/shopify-compat';
import { fromGid } from '@shopme/shopify-compat';
import { builder } from '../builder';
import type { GraphQLContext } from '../context';
import { defineConnection } from './connection';
import { DisplayableError } from './errors';
import { Node, registerNode } from './node';

/* ------------------------------ scalars and enums ------------------------------ */

/** Plain string scalar for event messages (the real schema's `FormattedString`). */
export const FormattedString = builder.scalarType('FormattedString' as 'JSON', { serialize: (v) => String(v), parseValue: (v) => v });

const regionNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
const regions: string[] = [];
for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
  const code = String.fromCharCode(a, b);
  if (regionNames.of(code)) regions.push(code);
}
export const COUNTRY_CODES = new Set(regions);
/** ISO 3166-1 alpha-2 codes known to the runtime's CLDR data. */
export const CountryCode = builder.enumType('CountryCode', { values: regions as [string, ...string[]] });
export const countryName = (code: string | null) => (code ? regionNames.of(code) ?? null : null);

/* ------------------------------ mailing address ------------------------------ */

export interface AddressShape {
  id: number; firstName: string | null; lastName: string | null; company: string | null; address1: string | null; address2: string | null; city: string | null;
  province: string | null; provinceCode: string | null; zip: string | null; country: string | null; countryCode: string | null; phone: string | null;
}

const fullName = (a: { firstName: string | null; lastName: string | null }) => [a.firstName, a.lastName].filter(Boolean).join(' ') || null;
const area = (a: AddressShape) => [a.city, a.provinceCode, countryName(a.countryCode) ?? a.country].filter(Boolean).join(', ') || null;

export const MailingAddress = builder.objectRef<AddressShape>('MailingAddress').implement({
  interfaces: [Node],
  fields: (t) => ({
    address1: t.exposeString('address1', { nullable: true }),
    address2: t.exposeString('address2', { nullable: true }),
    city: t.exposeString('city', { nullable: true }),
    company: t.exposeString('company', { nullable: true }),
    coordinatesValidated: t.boolean({ resolve: () => false }),
    country: t.string({ nullable: true, resolve: (a) => countryName(a.countryCode) ?? a.country }),
    countryCodeV2: t.field({ type: CountryCode, nullable: true, resolve: (a) => (a.countryCode && COUNTRY_CODES.has(a.countryCode) ? a.countryCode : null) }),
    firstName: t.exposeString('firstName', { nullable: true }),
    lastName: t.exposeString('lastName', { nullable: true }),
    name: t.string({ nullable: true, resolve: fullName }),
    phone: t.exposeString('phone', { nullable: true }),
    province: t.string({ nullable: true, resolve: (a) => a.province ?? a.provinceCode }),
    provinceCode: t.exposeString('provinceCode', { nullable: true }),
    zip: t.exposeString('zip', { nullable: true }),
    latitude: t.float({ nullable: true, resolve: () => null }),
    longitude: t.float({ nullable: true, resolve: () => null }),
    timeZone: t.string({ nullable: true, resolve: () => null }),
    formattedArea: t.string({ nullable: true, resolve: area }),
    formatted: t.stringList({
      args: { withName: t.arg.boolean({ defaultValue: false }), withCompany: t.arg.boolean({ defaultValue: true }) },
      resolve: (a, args) => [args.withName ? fullName(a) : null, args.withCompany ? a.company : null, a.address1, a.address2, [a.zip, a.city].filter(Boolean).join(' '), countryName(a.countryCode) ?? a.country]
        .filter((x): x is string => !!x),
    }),
  }),
});
export const MailingAddressConnection = defineConnection('MailingAddress', MailingAddress);

export const MailingAddressInput = builder.inputType('MailingAddressInput', {
  fields: (t) => ({
    address1: t.string(), address2: t.string(), city: t.string(), company: t.string(), countryCode: t.field({ type: CountryCode }),
    firstName: t.string(), lastName: t.string(), phone: t.string(), provinceCode: t.string(), zip: t.string(),
  }),
});

/* ------------------------------ staff members ------------------------------ */

export const StaffMember = builder.objectRef<StaffMemberRow>('StaffMember').implement({
  interfaces: [Node],
  fields: (t) => ({
    email: t.exposeString('email'),
    firstName: t.exposeString('firstName', { nullable: true }),
    lastName: t.exposeString('lastName', { nullable: true }),
    name: t.string({ resolve: (s) => fullName(s) ?? s.email }),
    initials: t.stringList({ nullable: true, resolve: (s) => [((s.firstName?.[0] ?? '') + (s.lastName?.[0] ?? '')) || (s.email[0] ?? '').toUpperCase()] }),
    active: t.exposeBoolean('active'),
    exists: t.boolean({ resolve: () => true }),
    isShopOwner: t.boolean({ resolve: (s) => s.role === 'owner' }),
    locale: t.string({ resolve: () => 'en' }),
    phone: t.string({ nullable: true, resolve: () => null }),
  }),
});
registerNode('StaffMember', (ctx, id) => getStaff(ctx.db, ctx.shopId, id));
export const StaffMemberConnection = defineConnection('StaffMember', StaffMember);

/* ------------------------------ timeline events ------------------------------ */

export interface EventRow { id: number; subjectType: string; subjectId: number | null; kind: string; verb: string | null; message: string | null; authorStaffUserId: number | null; data?: Record<string, unknown> | null; createdAt: Date }

const SUBJECT_TYPES = ['COMPANY_LOCATION', 'COMPANY', 'CUSTOMER', 'DRAFT_ORDER', 'INVENTORY_TRANSFER', 'COLLECTION', 'PRODUCT', 'PRODUCT_VARIANT', 'ARTICLE', 'BLOG', 'COMMENT', 'PAGE',
  'DISCOUNT_AUTOMATIC_BXGY', 'DISCOUNT_AUTOMATIC_NODE', 'DISCOUNT_CODE_NODE', 'DISCOUNT_NODE', 'PRICE_RULE', 'ORDER', 'UNKNOWN'] as const;
const EventSubjectType = builder.enumType('EventSubjectType', { values: SUBJECT_TYPES });
const subjectOf = (e: EventRow) => ((SUBJECT_TYPES as readonly string[]).includes(e.subjectType.toUpperCase()) ? e.subjectType.toUpperCase() : 'UNKNOWN') as (typeof SUBJECT_TYPES)[number];

export const Event = builder.interfaceRef<EventRow>('Event').implement({
  fields: (t) => ({
    action: t.string({ resolve: (e) => e.verb ?? 'update' }),
    appTitle: t.string({ nullable: true, resolve: () => null }),
    attributeToApp: t.boolean({ resolve: () => false }),
    attributeToUser: t.boolean({ resolve: (e) => e.authorStaffUserId != null }),
    createdAt: t.field({ type: 'DateTime', resolve: (e) => e.createdAt }),
    criticalAlert: t.boolean({ resolve: () => false }),
    message: t.field({ type: FormattedString, resolve: (e) => e.message ?? '' }),
  }),
  resolveType: (e) => (e.kind === 'comment' ? 'CommentEvent' : 'BasicEvent'),
});
export const BasicEvent = builder.objectRef<EventRow>('BasicEvent').implement({
  interfaces: [Event, Node],
  fields: (t) => ({
    subjectId: t.id({ resolve: (e) => String(e.subjectId ?? 0) }),
    subjectType: t.field({ type: EventSubjectType, resolve: subjectOf }),
    author: t.string({ nullable: true, resolve: async (e, _a, ctx) => (e.authorStaffUserId ? (await getStaff(ctx.db, ctx.shopId, e.authorStaffUserId))?.email ?? null : null) }),
    arguments: t.field({ type: 'JSON', nullable: true, resolve: (e) => { if (!e.data || !('html' in e.data)) return e.data ?? null; const { html: _html, ...rest } = e.data; return rest; } }),
    /** ShopMe: the body of an email sent to the customer ("Show email"); read only when asked for. */
    shopmeEmailHtml: t.string({ nullable: true, resolve: (e) => (typeof e.data?.html === 'string' ? e.data.html : null) }),
    additionalContent: t.field({ type: 'JSON', nullable: true, resolve: () => null }),
    additionalData: t.field({ type: 'JSON', nullable: true, resolve: () => null }),
    hasAdditionalContent: t.boolean({ resolve: () => false }),
    secondaryMessage: t.field({ type: FormattedString, nullable: true, resolve: () => null }),
  }),
});
export const CommentEvent = builder.objectRef<EventRow>('CommentEvent').implement({
  interfaces: [Event, Node],
  fields: (t) => ({
    author: t.field({
      type: StaffMember,
      resolve: async (e, _a, ctx) => (e.authorStaffUserId ? await getStaff(ctx.db, ctx.shopId, e.authorStaffUserId) : null) ?? { id: 0, email: '', firstName: 'Staff', lastName: null, role: 'staff', active: false, permissions: [], invitePending: false, lastLoginAt: null },
    }),
    rawMessage: t.string({ resolve: (e) => e.message ?? '' }),
    canDelete: t.boolean({ resolve: (e, _a, ctx) => ctx.auth.kind === 'session' && e.authorStaffUserId != null && ctx.auth.user.id === e.authorStaffUserId }),
    canEdit: t.boolean({ resolve: () => false }),
    edited: t.boolean({ resolve: () => false }),
    attachments: t.stringList({ resolve: (e) => (Array.isArray(e.data?.attachments) ? (e.data!.attachments as unknown[]).filter((x): x is string => typeof x === 'string') : []) }),
  }),
});
export const EventConnection = defineConnection<EventRow>('Event', Event as never);
export const EventSortKeys = builder.enumType('EventSortKeys', { values: ['CREATED_AT', 'ID'] as const });

/* ------------------------------ tags ------------------------------ */

export type TagResult = { ok: true; value: { id: number } } | { ok: false; errors: UserErrorShape[] };
type Taggable = (ctx: GraphQLContext, id: number, mode: 'add' | 'remove', tags: string[]) => Promise<TagResult>;
const taggables = new Map<string, Taggable>();

/** Make a GID type usable with `tagsAdd` / `tagsRemove` (`Product` is handled in the products module itself). */
export const registerTaggable = (type: string, fn: Taggable) => { taggables.set(type, fn); };

/** `tagsAdd` / `tagsRemove` for types registered via `registerTaggable`; null when the type is not one of them. */
export async function changeTagsOf(ctx: GraphQLContext, rawId: string, tags: string[], mode: 'add' | 'remove') {
  const gid = fromGid(String(rawId));
  const fn = gid && taggables.get(gid.type);
  if (!gid || !fn) return null;
  const r = await fn(ctx, gid.id, mode, tags);
  return r.ok ? { node: Object.assign({}, r.value, { __typename: gid.type }), userErrors: [] } : { node: null, userErrors: r.errors };
}

/** Refs shared by the orders and customers modules (each implements its own). */
export const Customer_ = builder.objectRef<Customer>('Customer');
export const Order_ = builder.objectRef<Order>('Order');
export const CustomerConnection = defineConnection('Customer', Customer_);
export const OrderConnection = defineConnection('Order', Order_);

/** `<name> implements DisplayableError { code field message }` with `<name>Code` enum; unknown service codes serialise as null. */
export function typedUserError(name: string, values: readonly [string, ...string[]]) {
  const Code = builder.enumType(`${name}Code`, { values });
  const ref = builder.objectRef<UserErrorShape>(name);
  ref.implement({ interfaces: [DisplayableError], fields: (t) => ({ code: t.field({ type: Code, nullable: true, resolve: (e) => (e.code && values.includes(e.code) ? e.code : null) as never }) }) });
  return ref;
}

/** Payload object `{ ...fields, userErrors: [<error>!]! }`. */
export function payloadWith<Shape extends object>(
  name: string, err: ReturnType<typeof typedUserError>,
  fields: (t: PothosSchemaTypes.ObjectFieldBuilder<PothosSchemaTypes.ExtendDefaultTypes<import('../builder').SchemaTypes>, Shape & { userErrors: UserErrorShape[] }>) => Record<string, any>,
) {
  const ref = builder.objectRef<Shape & { userErrors: UserErrorShape[] }>(name);
  ref.implement({ fields: (t) => ({ ...fields(t as never), userErrors: t.field({ type: [err], resolve: (p) => p.userErrors }) }) });
  return ref;
}

export const notFound =(what: string, field: string[] = ['id']): UserErrorShape => ({ field, message: `${what} does not exist` });
