import { cookieBannerOf, getShop, policiesOf, POLICY_TYPE_KEYS, shopUrl, updateCookieBanner, updatePolicy, type PolicyView } from '@shopme/core';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { definePayload } from '../types/errors';
import { Node, registerNode } from '../types/node';
import { Shop } from './shop';

/** Store policies (stored in `shops.settings.policies`, served by the storefront at `/policies/<handle>`) and the cookie banner setting. */

const ShopPolicyType = builder.enumType('ShopPolicyType', { values: POLICY_TYPE_KEYS });
const ShopPolicyInput = builder.inputType('ShopPolicyInput', { fields: (t) => ({ type: t.field({ type: ShopPolicyType, required: true }), body: t.string({ required: true }) }) });

type Policy = PolicyView & { baseUrl: string };
export const ShopPolicy = builder.objectRef<Policy>('ShopPolicy');
ShopPolicy.implement({
  interfaces: [Node],
  description: 'A store policy. All five supported types are always listed; an unset policy has an empty body and is not served by the storefront.',
  fields: (t) => ({
    type: t.field({ type: ShopPolicyType, resolve: (p) => p.type }),
    title: t.exposeString('title'),
    body: t.field({ type: 'HTML', resolve: (p) => p.body }),
    url: t.field({ type: 'URL', resolve: (p) => `${p.baseUrl}${p.url}` }),
    createdAt: t.field({ type: 'DateTime', resolve: (p) => p.createdAt }),
    updatedAt: t.field({ type: 'DateTime', resolve: (p) => p.updatedAt }),
  }),
});

const policiesFor = async (ctx: GraphQLContext): Promise<Policy[]> => {
  const shop = (await getShop(ctx.db, ctx.shopId))!;
  const baseUrl = shopUrl(shop, ctx.app.config.appUrl);
  return policiesOf(shop).map((p) => ({ ...p, baseUrl }));
};
registerNode('ShopPolicy', async (ctx, id) => (await policiesFor(ctx)).find((p) => p.id === id) ?? null);

const CookieBanner = builder.objectRef<{ enabled: boolean; message: string }>('ShopmeCookieBanner').implement({
  fields: (t) => ({ enabled: t.exposeBoolean('enabled'), message: t.exposeString('message') }),
});

builder.objectFields(Shop, (t) => ({
  shopPolicies: t.field({ type: [ShopPolicy], resolve: (_s, _a, ctx) => { requireScope(ctx, 'read_shop'); return policiesFor(ctx); } }),
  shopmeCookieBanner: t.field({
    type: CookieBanner, description: 'Cookie consent banner setting (`shop.settings.cookieBanner`).',
    resolve: (s) => cookieBannerOf(s),
  }),
}));

const UpdatePayload = definePayload<{ shopPolicy: Policy | null }>('ShopPolicyUpdatePayload', (t) => ({ shopPolicy: t.field({ type: ShopPolicy, nullable: true, resolve: (p) => p.shopPolicy }) }));
const CookiePayload = definePayload<{ cookieBanner: { enabled: boolean; message: string } | null }>('ShopmeCookieBannerUpdatePayload', (t) => ({
  cookieBanner: t.field({ type: CookieBanner, nullable: true, resolve: (p) => p.cookieBanner }),
}));

builder.mutationFields((t) => ({
  shopPolicyUpdate: t.field({
    type: UpdatePayload, args: { shopPolicy: t.arg({ type: ShopPolicyInput, required: true }) },
    resolve: async (_r, { shopPolicy }, ctx) => {
      requireScope(ctx, 'write_shop');
      const shop = (await getShop(ctx.db, ctx.shopId))!;
      const r = await updatePolicy(ctx.db, shop, shopPolicy.type, shopPolicy.body);
      return r.ok ? { shopPolicy: { ...r.value, baseUrl: shopUrl(shop, ctx.app.config.appUrl) }, userErrors: [] } : { shopPolicy: null, userErrors: r.errors };
    },
  }),
  shopmeCookieBannerUpdate: t.field({
    type: CookiePayload, args: { enabled: t.arg.boolean(), message: t.arg.string() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_shop');
      const shop = (await getShop(ctx.db, ctx.shopId))!;
      return { cookieBanner: await updateCookieBanner(ctx.db, shop, { enabled: a.enabled ?? undefined, message: a.message ?? undefined }), userErrors: [] };
    },
  }),
}));
