import {
  ABANDONED_DELAYS, abandonedSettingsOf, abandonedView, countAbandonedCheckouts, findAbandonedCheckouts, getAbandonedCheckout, getCustomer, getProduct, getVariant, recoveryUrl, sendRecoveryEmail,
  schema, updateAbandonedSettings, type AbandonedRow, type CartLineView, type CheckoutView, type Shop,
} from '@shopme/core';
import { and, eq } from 'drizzle-orm';
import { fromGid, parseId, toGid, type UserError } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { ConnectionArgs, defineConnection, paginate, paginateArray } from '../types/connection';
import { definePayload } from '../types/errors';
import { Count, MoneyBag, moneyBag } from '../types/money';
import { Node, registerNode } from '../types/node';
import { Product_, ProductVariant, shopOf } from '../types/catalog';
import { Customer_, MailingAddress, type AddressShape } from '../types/sales';
import { Attribute } from './orders';
import { Image } from './files';

/** Abandoned checkouts: `abandonedCheckouts` (Shopify shape) plus ShopMe's recovery settings and the manual recovery email. */

interface Shape { id: number; row: AbandonedRow; view: CheckoutView; shop: Shop }
interface LineShape { id: number; checkout: Shape; line: CartLineView }

const SortKeys = builder.enumType('AbandonedCheckoutSortKeys', { values: ['CHECKOUT_ID', 'CREATED_AT', 'CUSTOMER_NAME', 'ID', 'RELEVANCE', 'TOTAL_PRICE'] as const });
const money = (c: Shape, minor: number) => moneyBag(minor, c.row.currency);
const address = (a: CheckoutView['address']): AddressShape | null => (a && (a.address1 || a.countryCode) ? { id: 0, firstName: a.firstName ?? null, lastName: a.lastName ?? null, company: a.company ?? null, address1: a.address1 ?? null, address2: a.address2 ?? null, city: a.city ?? null, province: a.province ?? null, provinceCode: a.provinceCode ?? null, zip: a.zip ?? null, country: a.country ?? null, countryCode: a.countryCode ?? null, phone: a.phone ?? null } : null);

const LineItem = builder.objectRef<LineShape>('AbandonedCheckoutLineItem').implement({
  interfaces: [Node],
  fields: (t) => ({
    id: t.id({ resolve: (l) => toGid('AbandonedCheckoutLineItem', l.line.lineId) }),
    title: t.string({ nullable: true, resolve: (l) => l.line.product.title }),
    variantTitle: t.string({ nullable: true, resolve: (l) => (l.line.hasOnlyDefaultVariant ? null : l.line.variantTitle) }),
    sku: t.string({ nullable: true, resolve: (l) => l.line.sku || null }),
    quantity: t.int({ resolve: (l) => l.line.quantity }),
    customAttributes: t.field({ type: [Attribute], resolve: (l) => Object.entries(l.line.properties).map(([key, value]) => ({ key, value })) }),
    image: t.field({ type: Image, nullable: true, resolve: (l) => (l.line.image ? { id: null, url: l.line.image.url, altText: l.line.image.alt, width: l.line.image.width, height: l.line.image.height } : null) }),
    product: t.field({ type: Product_, nullable: true, resolve: (l, _a, ctx) => getProduct(ctx.db, ctx.shopId, l.line.productId) }),
    variant: t.field({ type: ProductVariant, nullable: true, resolve: (l, _a, ctx) => getVariant(ctx.db, ctx.shopId, l.line.variantId) }),
    originalUnitPriceSet: t.field({ type: MoneyBag, resolve: (l) => money(l.checkout, l.line.price) }),
    originalTotalPriceSet: t.field({ type: MoneyBag, resolve: (l) => money(l.checkout, l.line.price * l.line.quantity) }),
    discountedUnitPriceSet: t.field({ type: MoneyBag, resolve: (l) => money(l.checkout, Math.round(priced(l).total / Math.max(1, l.line.quantity))) }),
    discountedTotalPriceSet: t.field({ type: MoneyBag, resolve: (l) => money(l.checkout, priced(l).total) }),
  }),
});
const priced = (l: LineShape) => l.checkout.view.pricing.lines.find((p) => p.id === l.line.lineId) ?? { total: l.line.price * l.line.quantity };
const LineItemConnection = defineConnection('AbandonedCheckoutLineItem', LineItem);

const AbandonedCheckout = builder.objectRef<Shape>('AbandonedCheckout');
AbandonedCheckout.implement({
  interfaces: [Node],
  fields: (t) => ({
    id: t.id({ resolve: (c) => toGid('AbandonedCheckout', c.row.id) }),
    name: t.string({ resolve: (c) => `#${c.row.id}` }),
    abandonedCheckoutUrl: t.field({ type: 'URL', resolve: (c, _a, ctx) => recoveryUrl(c.shop, ctx.app.config.appUrl, c.row.token) }),
    completedAt: t.field({ type: 'DateTime', nullable: true, resolve: (c) => c.row.completedAt }),
    createdAt: t.field({ type: 'DateTime', resolve: (c) => c.row.createdAt }),
    updatedAt: t.field({ type: 'DateTime', resolve: (c) => c.row.updatedAt }),
    defaultCursor: t.string({ resolve: (c) => Buffer.from(`c:${c.row.id}`).toString('base64url') }),
    customAttributes: t.field({ type: [Attribute], resolve: (c) => Object.entries(c.row.attributes).map(([key, value]) => ({ key, value })) }),
    note: t.string({ resolve: (c) => c.row.note ?? '' }),
    discountCodes: t.stringList({ resolve: (c) => c.view.appliedDiscounts.flatMap((d) => (d.code ? [d.code] : [])) }),
    taxesIncluded: t.boolean({ resolve: (c) => c.view.taxesIncluded }),
    customer: t.field({ type: Customer_, nullable: true, resolve: async (c, _a, ctx) => {
      const [r] = c.row.email ? await ctx.db.select({ id: schema.customers.id }).from(schema.customers).where(and(eq(schema.customers.shopId, ctx.shopId), eq(schema.customers.email, c.row.email.toLowerCase()))).limit(1) : [];
      return r ? getCustomer(ctx.db, ctx.shopId, r.id) : null;
    } }),
    shippingAddress: t.field({ type: MailingAddress, nullable: true, resolve: (c) => address(c.view.address) }),
    billingAddress: t.field({ type: MailingAddress, nullable: true, resolve: (c) => address(c.view.address) }),
    lineItemsQuantity: t.int({ resolve: (c) => c.view.lines.reduce((n, l) => n + l.quantity, 0) }),
    lineItems: t.field({ type: LineItemConnection, args: ConnectionArgs, resolve: (c, a) => paginateArray(a, c.view.lines.map((line) => ({ id: line.lineId, checkout: c, line }))) }),
    totalLineItemsPriceSet: t.field({ type: MoneyBag, resolve: (c) => money(c, c.view.pricing.subtotal) }),
    subtotalPriceSet: t.field({ type: MoneyBag, resolve: (c) => money(c, c.view.pricing.subtotal - c.view.pricing.lines.reduce((n, l) => n + l.discount, 0)) }),
    totalDiscountSet: t.field({ type: MoneyBag, resolve: (c) => money(c, c.view.pricing.totalDiscounts) }),
    totalTaxSet: t.field({ type: MoneyBag, nullable: true, resolve: (c) => money(c, c.view.pricing.totalTax) }),
    totalPriceSet: t.field({ type: MoneyBag, resolve: (c) => money(c, c.view.pricing.total) }),
    totalDutiesSet: t.field({ type: MoneyBag, nullable: true, resolve: () => null }),
    shopmeEmail: t.string({ nullable: true, description: 'Email entered at checkout (guests have no customer record).', resolve: (c) => c.row.email }),
    shopmeRecoveryEmailsSent: t.int({ resolve: (c) => c.row.recoveryEmailCount }),
    shopmeRecoveryEmailSentAt: t.field({ type: 'DateTime', nullable: true, resolve: (c) => c.row.recoverySentAt }),
  }),
});
const Connection = defineConnection('AbandonedCheckout', AbandonedCheckout);

async function load(ctx: GraphQLContext, row: AbandonedRow | null): Promise<Shape | null> {
  if (!row) return null;
  const shop = await shopOf(ctx);
  const view = await abandonedView(ctx.db, shop, row);
  return view ? { id: row.id, row, view, shop } : null;
}
registerNode('AbandonedCheckout', async (ctx, id) => load(ctx, await getAbandonedCheckout(ctx.db, ctx.shopId, id)));

builder.queryFields((t) => ({
  abandonedCheckouts: t.field({
    type: Connection, args: { ...ConnectionArgs, sortKey: t.arg({ type: SortKeys, defaultValue: 'ID' }), query: t.arg.string(), savedSearchId: t.arg.id() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'read_orders');
      const shop = await shopOf(ctx);
      return paginate(a, {
        fetch: async ({ offset, limit }) => (await Promise.all((await findAbandonedCheckouts(ctx.db, shop, { query: a.query, sortKey: (a.sortKey ?? 'ID') as 'ID', reverse: !!a.reverse, offset, limit })).map((r) => load(ctx, r)))).filter((x): x is Shape => !!x),
        total: async () => (await countAbandonedCheckouts(ctx.db, shop, a.query)).count,
      });
    },
  }),
  abandonedCheckoutsCount: t.field({
    type: Count, nullable: true, args: { query: t.arg.string(), savedSearchId: t.arg.id(), limit: t.arg.int({ defaultValue: 10000 }) },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'read_orders'); return countAbandonedCheckouts(ctx.db, await shopOf(ctx), a.query, a.limit ?? 10000); },
  }),
}));

/* ------------------------------ ShopMe extensions: recovery settings and manual email ------------------------------ */

const Settings = builder.objectRef<{ enabled: boolean; delayHours: number }>('ShopmeAbandonedCheckoutSettings').implement({
  description: `Automatic recovery emails. delayHours is one of ${ABANDONED_DELAYS.join(', ')}.`,
  fields: (t) => ({ enabled: t.exposeBoolean('enabled'), delayHours: t.exposeInt('delayHours') }),
});
const SettingsPayload = definePayload<{ settings: { enabled: boolean; delayHours: number } | null }>('ShopmeAbandonedCheckoutSettingsUpdatePayload', (t) => ({ settings: t.field({ type: Settings, nullable: true, resolve: (p) => p.settings }) }));
const SendPayload = definePayload<{ abandonedCheckout: Shape | null }>('ShopmeAbandonedCheckoutRecoveryEmailSendPayload', (t) => ({ abandonedCheckout: t.field({ type: AbandonedCheckout, nullable: true, resolve: (p) => p.abandonedCheckout }) }));

builder.queryFields((t) => ({
  shopmeAbandonedCheckoutSettings: t.field({ type: Settings, resolve: async (_r, _a, ctx) => { requireScope(ctx, 'read_orders'); return abandonedSettingsOf(await shopOf(ctx)); } }),
}));
builder.mutationFields((t) => ({
  shopmeAbandonedCheckoutSettingsUpdate: t.field({
    type: SettingsPayload, args: { enabled: t.arg.boolean(), delayHours: t.arg.int() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_orders');
      const r = await updateAbandonedSettings(ctx.db, await shopOf(ctx), { ...(a.enabled != null && { enabled: a.enabled }), ...(a.delayHours != null && { delayHours: a.delayHours }) });
      return 'error' in r ? { settings: null, userErrors: [{ field: ['delayHours'], message: r.error }] as UserError[] } : { settings: r, userErrors: [] };
    },
  }),
  shopmeAbandonedCheckoutRecoveryEmailSend: t.field({
    type: SendPayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_orders');
      const id = parseId(String(a.id), 'AbandonedCheckout') ?? fromGid(String(a.id))?.id ?? null;
      const row = id ? await getAbandonedCheckout(ctx.db, ctx.shopId, id) : null;
      if (!row) return { abandonedCheckout: null, userErrors: [{ field: ['id'], message: 'Checkout does not exist' }] };
      const shop = await shopOf(ctx);
      if (!(await sendRecoveryEmail(ctx.db, ctx.app.mailer, shop, ctx.app.config.appUrl, row))) return { abandonedCheckout: await load(ctx, row), userErrors: [{ field: ['id'], message: 'This checkout cannot be emailed (no email, no items or already completed)' }] };
      return { abandonedCheckout: await load(ctx, (await getAbandonedCheckout(ctx.db, ctx.shopId, row.id))!), userErrors: [] };
    },
  }),
}));
