/** Languages and translations: Shopify's `shopLocales`, `shopLocale*`, `translatableResource(s)`, `translationsRegister|Remove`. */
import { GraphQLError } from 'graphql';
import {
  countTranslatable, disableShopLocale, enableShopLocale, getTranslatableResource, getTranslations, listShopLocales, listTranslatableResources, registerTranslations, removeTranslations,
  TRANSLATABLE_TYPES, updateShopLocale, type ShopLocaleRow, type TranslatableResourceRow, type TranslatableType, type TranslationRow,
} from '@shopme/core';
import { fromGid, toGid, type UserError as UserErrorShape } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { ConnectionArgs, defineConnection, paginate } from '../types/connection';
import { DisplayableError, definePayload } from '../types/errors';

const GID_TYPE: Record<TranslatableType, string> = { PRODUCT: 'Product', COLLECTION: 'Collection', PAGE: 'OnlineStorePage', ARTICLE: 'OnlineStoreArticle', MENU: 'Menu', LINK: 'Link', ONLINE_STORE_THEME: 'OnlineStoreTheme', METAOBJECT: 'Metaobject' };
const TYPE_OF_GID = new Map(Object.entries(GID_TYPE).map(([k, v]) => [v, k as TranslatableType]));
// Pages and articles use their Online Store GID names in Shopify; accept the plain ones as well.
TYPE_OF_GID.set('Page', 'PAGE').set('Article', 'ARTICLE');
const parseResource = (gid: string): { type: TranslatableType; id: string } | null => {
  const g = fromGid(gid);
  const type = g && TYPE_OF_GID.get(g.type);
  return g && type ? { type, id: String(g.id) } : null;
};
const gidOf = (r: TranslatableResourceRow) => toGid(GID_TYPE[r.type], Number(r.id));

const ResourceType = builder.enumType('TranslatableResourceType', { values: TRANSLATABLE_TYPES });
const ContentType = builder.enumType('LocalizableContentType', { values: ['SINGLE_LINE_TEXT_FIELD', 'MULTI_LINE_TEXT_FIELD', 'HTML'] as const });
const ErrorCode = builder.enumType('TranslationErrorCode', {
  values: ['BLANK', 'INVALID', 'RESOURCE_NOT_FOUND', 'RESOURCE_NOT_TRANSLATABLE', 'TOO_MANY_KEYS_FOR_RESOURCE', 'INVALID_KEY_FOR_MODEL', 'INVALID_TRANSLATABLE_CONTENT', 'INVALID_LOCALE_FOR_SHOP'] as const,
});

const ShopLocale = builder.objectRef<ShopLocaleRow>('ShopLocale').implement({
  fields: (t) => ({ locale: t.exposeString('locale'), name: t.exposeString('name'), primary: t.exposeBoolean('primary'), published: t.exposeBoolean('published'), shopmeDomain: t.string({ nullable: true, description: 'ShopMe: host serving this language.', resolve: (r) => r.domain }) }),
});

const Translation = builder.objectRef<TranslationRow>('Translation').implement({
  fields: (t) => ({
    key: t.exposeString('key'), locale: t.exposeString('locale'), value: t.exposeString('value', { nullable: true }), outdated: t.exposeBoolean('outdated'),
    updatedAt: t.field({ type: 'DateTime', nullable: true, resolve: (r) => r.updatedAt }),
  }),
});
const Content = builder.objectRef<TranslatableResourceRow['content'][number] & { locale: string }>('TranslatableContent').implement({
  fields: (t) => ({
    key: t.exposeString('key'), value: t.exposeString('value', { nullable: true }), digest: t.exposeString('digest', { nullable: true }), locale: t.exposeString('locale'),
    type: t.field({ type: ContentType, resolve: (c) => c.type }),
  }),
});
const Resource = builder.objectRef<TranslatableResourceRow & { primary: string }>('TranslatableResource').implement({
  fields: (t) => ({
    resourceId: t.id({ resolve: (r) => gidOf(r) }),
    resourceType: t.field({ type: ResourceType, description: 'ShopMe extension.', resolve: (r) => r.type }),
    translatableContent: t.field({ type: [Content], resolve: (r) => r.content.map((c) => ({ ...c, locale: r.primary })) }),
    translations: t.field({
      type: [Translation], args: { locale: t.arg.string({ required: true }), outdated: t.arg.boolean() },
      resolve: async (r, a, ctx) => (await getTranslations(ctx.db, ctx.shopId, r.type, r.id, a.locale)).filter((x) => a.outdated == null || x.outdated === a.outdated),
    }),
  }),
});
const ResourceConnection = defineConnection('TranslatableResource', Resource);

const TranslationUserError = builder.objectRef<UserErrorShape>('TranslationUserError').implement({
  interfaces: [DisplayableError],
  fields: (t) => ({ code: t.field({ type: ErrorCode, nullable: true, resolve: (e) => (e.code ?? 'INVALID') as never }) }),
});
const TranslationInput = builder.inputType('TranslationInput', {
  fields: (t) => ({ locale: t.string({ required: true }), key: t.string({ required: true }), value: t.string({ required: true }), translatableContentDigest: t.string({ required: true }), marketId: t.id() }),
});

const translationsPayload = (name: string) => builder.objectRef<{ translations: TranslationRow[] | null; userErrors: UserErrorShape[] }>(name).implement({
  fields: (t) => ({
    translations: t.field({ type: [Translation], nullable: true, resolve: (p) => p.translations }),
    userErrors: t.field({ type: [TranslationUserError], resolve: (p) => p.userErrors }),
  }),
});
const RegisterPayload = translationsPayload('TranslationsRegisterPayload');
const RemovePayload = translationsPayload('TranslationsRemovePayload');
const LocalePayload = (name: string) => definePayload<{ shopLocale: ShopLocaleRow | null }>(name, (t) => ({ shopLocale: t.field({ type: ShopLocale, nullable: true, resolve: (p) => p.shopLocale }) }));
const EnablePayload = LocalePayload('ShopLocaleEnablePayload');
const UpdatePayload = LocalePayload('ShopLocaleUpdatePayload');
const DisablePayload = definePayload<{ locale: string | null }>('ShopLocaleDisablePayload', (t) => ({ locale: t.string({ nullable: true, resolve: (p) => p.locale }) }));
const LocaleInput = builder.inputType('ShopLocaleInput', { fields: (t) => ({ published: t.boolean(), marketWebPresenceIds: t.idList() }) });

const primaryOf = async (ctx: GraphQLContext) => (await listShopLocales(ctx.db, ctx.shopId)).find((l) => l.primary)?.locale ?? 'en';

builder.queryFields((t) => ({
  shopLocales: t.field({
    type: [ShopLocale], args: { published: t.arg.boolean() },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'read_locales'); return (await listShopLocales(ctx.db, ctx.shopId)).filter((l) => a.published == null || l.published === a.published); },
  }),
  translatableResources: t.field({
    type: ResourceConnection, args: { ...ConnectionArgs, resourceType: t.arg({ type: ResourceType, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'read_translations');
      const primary = await primaryOf(ctx);
      return paginate(a, {
        total: () => countTranslatable(ctx.db, ctx.shopId, a.resourceType),
        fetch: async ({ offset, limit }) => (await listTranslatableResources(ctx.db, ctx.shopId, a.resourceType, offset, limit)).map((r) => ({ ...r, primary })),
      });
    },
  }),
  translatableResource: t.field({
    type: Resource, nullable: true, args: { resourceId: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'read_translations');
      const p = parseResource(a.resourceId);
      if (!p) throw new GraphQLError(`Invalid global id '${a.resourceId}'`, { extensions: { code: 'INVALID_GLOBAL_ID' } });
      const r = await getTranslatableResource(ctx.db, ctx.shopId, p.type, p.id);
      return r ? { ...r, primary: await primaryOf(ctx) } : null;
    },
  }),
}));

const notFound = (field: string[]): UserErrorShape => ({ field, message: 'Resource does not exist', code: 'RESOURCE_NOT_FOUND' });

builder.mutationFields((t) => ({
  shopLocaleEnable: t.field({
    type: EnablePayload, args: { locale: t.arg.string({ required: true }), marketWebPresenceIds: t.arg.idList() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_locales');
      const r = await enableShopLocale(ctx.db, ctx.shopId, a.locale);
      if (r.ok) await ctx.app.locales.refresh(ctx.db);
      return r.ok ? { shopLocale: r.value, userErrors: [] } : { shopLocale: null, userErrors: r.errors };
    },
  }),
  shopLocaleUpdate: t.field({
    type: UpdatePayload, args: { locale: t.arg.string({ required: true }), shopLocale: t.arg({ type: LocaleInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_locales');
      const r = await updateShopLocale(ctx.db, ctx.shopId, a.locale, { published: a.shopLocale.published });
      if (r.ok) await ctx.app.locales.refresh(ctx.db);
      return r.ok ? { shopLocale: r.value, userErrors: [] } : { shopLocale: null, userErrors: r.errors };
    },
  }),
  shopLocaleDisable: t.field({
    type: DisablePayload, args: { locale: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_locales');
      const r = await disableShopLocale(ctx.db, ctx.shopId, a.locale);
      if (r.ok) await ctx.app.locales.refresh(ctx.db);
      return r.ok ? { locale: r.value, userErrors: [] } : { locale: null, userErrors: r.errors };
    },
  }),
  translationsRegister: t.field({
    type: RegisterPayload, args: { resourceId: t.arg.id({ required: true }), translations: t.arg({ type: [TranslationInput], required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_translations');
      const p = parseResource(a.resourceId);
      if (!p) return { translations: null, userErrors: [notFound(['resourceId'])] };
      const r = await registerTranslations(ctx.db, ctx.shopId, p.type, p.id, a.translations);
      return r.ok ? { translations: r.value, userErrors: [] } : { translations: null, userErrors: r.errors };
    },
  }),
  translationsRemove: t.field({
    type: RemovePayload, args: { resourceId: t.arg.id({ required: true }), translationKeys: t.arg.stringList({ required: true }), locales: t.arg.stringList({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_translations');
      const p = parseResource(a.resourceId);
      if (!p) return { translations: null, userErrors: [notFound(['resourceId'])] };
      const r = await removeTranslations(ctx.db, ctx.shopId, p.type, p.id, a.translationKeys, a.locales);
      return r.ok ? { translations: r.value, userErrors: [] } : { translations: null, userErrors: r.errors };
    },
  }),
}));
