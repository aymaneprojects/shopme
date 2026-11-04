import { getShop, type Shop as ShopRow } from '@shopme/core';
import { builder } from '../builder';
import { requireScope } from '../context';
import { CurrencyCode } from '../types/money';
import { Node, legacyId, registerNode } from '../types/node';

const WeightUnit = builder.enumType('WeightUnit', { values: ['KILOGRAMS', 'GRAMS', 'POUNDS', 'OUNCES'] as const });

interface Formats { moneyFormat: string; moneyWithCurrencyFormat: string }
const CurrencyFormats = builder.objectRef<Formats>('CurrencyFormats').implement({
  fields: (t) => ({
    moneyFormat: t.exposeString('moneyFormat'),
    moneyWithCurrencyFormat: t.exposeString('moneyWithCurrencyFormat'),
    moneyInEmailsFormat: t.string({ resolve: (f) => f.moneyFormat }),
    moneyWithCurrencyInEmailsFormat: t.string({ resolve: (f) => f.moneyWithCurrencyFormat }),
  }),
});

interface DomainShape { host: string; url: string; sslEnabled: boolean }
const Domain = builder.objectRef<DomainShape>('Domain').implement({
  fields: (t) => ({ host: t.exposeString('host'), url: t.field({ type: 'URL', resolve: (d) => d.url }), sslEnabled: t.exposeBoolean('sslEnabled') }),
});

/** Example Node type: shape = DB row; `id` comes from the Node interface. */
export const Shop = builder.objectRef<ShopRow>('Shop');
Shop.implement({
  interfaces: [Node],
  fields: (t) => ({
    legacyResourceId: t.field({ type: 'UnsignedInt64', resolve: legacyId }),
    name: t.exposeString('name'),
    email: t.exposeString('email'),
    contactEmail: t.exposeString('email'),
    description: t.string({ nullable: true, resolve: (s) => (s.settings.description as string | undefined) ?? null }),
    currencyCode: t.field({ type: CurrencyCode, resolve: (s) => s.currency }),
    ianaTimezone: t.exposeString('timezone'),
    weightUnit: t.field({ type: WeightUnit, resolve: (s) => s.weightUnit as 'KILOGRAMS' }),
    taxesIncluded: t.exposeBoolean('taxesIncluded'),
    currencyFormats: t.field({ type: CurrencyFormats, resolve: (s) => s }),
    primaryDomain: t.field({
      type: Domain,
      resolve: (s, _a, ctx) => {
        const url = s.primaryDomain ? `https://${s.primaryDomain}` : ctx.app.config.appUrl;
        return { host: new URL(url).host, url, sslEnabled: url.startsWith('https://') };
      },
    }),
    myshopifyDomain: t.string({ resolve: (_s, _a, ctx) => new URL(ctx.app.config.appUrl).host }),
    url: t.field({ type: 'URL', resolve: (s, _a, ctx) => (s.primaryDomain ? `https://${s.primaryDomain}` : ctx.app.config.appUrl) }),
    createdAt: t.field({ type: 'DateTime', resolve: (s) => s.createdAt }),
  }),
});

registerNode('Shop', (ctx, id) => (id === ctx.shopId ? getShop(ctx.db, id) : Promise.resolve(null)));

builder.queryFields((t) => ({
  shop: t.field({
    type: Shop,
    resolve: async (_r, _a, ctx) => {
      requireScope(ctx, 'read_shop');
      const shop = await getShop(ctx.db, ctx.shopId);
      if (!shop) throw new Error('Shop not found');
      return shop;
    },
  }),
}));
