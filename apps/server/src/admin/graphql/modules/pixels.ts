import {
  createAppPixel, createPixel, deletePixel, getPixel, listPixels, PIXEL_CONSENT_CATEGORIES, setPixelConnected, storefrontEventCounts, updateAppPixel, updatePixel, getAppPixel, type PixelRow,
} from '@shopme/core';
import { parseId, type UserError } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope } from '../context';
import { DisplayableError, definePayload } from '../types/errors';
import { Node, legacyId, registerNode } from '../types/node';

/**
 * Customer events: custom pixels (ShopMe extension, the reference API has none), the web pixel API (settings of an app pixel) and event counts.
 * Custom pixel code runs sandboxed in the storefront once the visitor's consent covers the pixel's required categories.
 */

const ConsentCategory = builder.enumType('ShopmePixelConsentCategory', { values: PIXEL_CONSENT_CATEGORIES });
const PixelKind = builder.enumType('ShopmePixelKind', { values: ['CUSTOM', 'APP', 'SERVER'] as const });

const CustomPixel = builder.objectRef<PixelRow>('ShopmeCustomPixel');
CustomPixel.implement({
  interfaces: [Node],
  fields: (t) => ({
    legacyResourceId: t.field({ type: 'UnsignedInt64', resolve: legacyId }),
    kind: t.field({ type: PixelKind, resolve: (p) => p.kind as 'CUSTOM' }),
    name: t.exposeString('name'), code: t.string({ nullable: true, resolve: (p) => p.code }),
    connected: t.exposeBoolean('connected'), requiredConsent: t.field({ type: [ConsentCategory], resolve: (p) => p.requiredConsent as 'analytics'[] }),
    respectSaleOptOut: t.exposeBoolean('respectSaleOptOut'), domEvents: t.exposeBoolean('domEvents'),
    createdAt: t.field({ type: 'DateTime', resolve: (p) => p.createdAt }), updatedAt: t.field({ type: 'DateTime', resolve: (p) => p.updatedAt }),
  }),
});
registerNode('ShopmeCustomPixel', (ctx, id) => getPixel(ctx.db, ctx.shopId, id));

const PixelInput = builder.inputType('ShopmeCustomPixelInput', {
  fields: (t) => ({ name: t.string(), code: t.string(), requiredConsent: t.field({ type: [ConsentCategory] }), respectSaleOptOut: t.boolean(), domEvents: t.boolean() }),
});
const PixelPayload = definePayload<{ pixel: PixelRow | null }>('ShopmeCustomPixelPayload', (t) => ({ pixel: t.field({ type: CustomPixel, nullable: true, resolve: (p) => p.pixel }) }));
const DeletePayload = definePayload<{ deletedPixelId: string | null }>('ShopmeCustomPixelDeletePayload', (t) => ({ deletedPixelId: t.id({ nullable: true, resolve: (p) => p.deletedPixelId }) }));
const EventCount = builder.objectRef<{ name: string; count: number }>('ShopmeStorefrontEventCount').implement({ fields: (t) => ({ name: t.exposeString('name'), count: t.exposeInt('count') }) });

const idOf = (raw: unknown) => parseId(String(raw), 'ShopmeCustomPixel');
const notFound = (field = ['id']): UserError[] => [{ field, message: 'Pixel does not exist', code: 'NOT_FOUND' }];

builder.queryFields((t) => ({
  shopmeCustomPixels: t.field({ type: [CustomPixel], resolve: (_r, _a, ctx) => { requireScope(ctx, 'read_pixels'); return listPixels(ctx.db, ctx.shopId); } }),
  shopmeCustomPixel: t.field({
    type: CustomPixel, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_pixels'); const id = idOf(a.id); return id ? getPixel(ctx.db, ctx.shopId, id) : null; },
  }),
  shopmeStorefrontEventCounts: t.field({
    type: [EventCount], description: 'Events recorded by the first-party stream (analytics consent only) over the last days.', args: { days: t.arg.int({ defaultValue: 7 }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_customer_events'); return storefrontEventCounts(ctx.db, ctx.shopId, Math.min(90, Math.max(1, a.days ?? 7))); },
  }),
}));

builder.mutationFields((t) => ({
  shopmeCustomPixelCreate: t.field({
    type: PixelPayload, args: { input: t.arg({ type: PixelInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_pixels');
      const r = await createPixel(ctx.db, ctx.shopId, input);
      return r.ok ? { pixel: r.value, userErrors: [] } : { pixel: null, userErrors: r.errors.map((e) => ({ ...e, field: ['input', ...(e.field ?? [])] })) };
    },
  }),
  shopmeCustomPixelUpdate: t.field({
    type: PixelPayload, args: { id: t.arg.id({ required: true }), input: t.arg({ type: PixelInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_pixels');
      const id = idOf(a.id);
      if (!id) return { pixel: null, userErrors: notFound() };
      const r = await updatePixel(ctx.db, ctx.shopId, id, a.input);
      return r.ok ? { pixel: r.value, userErrors: [] } : { pixel: null, userErrors: r.errors.map((e) => (e.field?.[0] === 'id' ? e : { ...e, field: ['input', ...(e.field ?? [])] })) };
    },
  }),
  shopmeCustomPixelConnect: t.field({
    type: PixelPayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'write_pixels'); const id = idOf(a.id); const r = id ? await setPixelConnected(ctx.db, ctx.shopId, id, true) : null; return r?.ok ? { pixel: r.value, userErrors: [] } : { pixel: null, userErrors: r ? r.errors : notFound() }; },
  }),
  shopmeCustomPixelDisconnect: t.field({
    type: PixelPayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'write_pixels'); const id = idOf(a.id); const r = id ? await setPixelConnected(ctx.db, ctx.shopId, id, false) : null; return r?.ok ? { pixel: r.value, userErrors: [] } : { pixel: null, userErrors: r ? r.errors : notFound() }; },
  }),
  shopmeCustomPixelDelete: t.field({
    type: DeletePayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_pixels');
      const id = idOf(a.id);
      const ok = id ? await deletePixel(ctx.db, ctx.shopId, id) : false;
      return ok ? { deletedPixelId: `gid://shopify/ShopmeCustomPixel/${id}`, userErrors: [] } : { deletedPixelId: null, userErrors: notFound() };
    },
  }),
}));

/* ------------------------------ web pixels (Admin API names) ------------------------------ */

const WEB_CODES = ['BLANK', 'TAKEN', 'NOT_FOUND', 'INVALID_SETTINGS', 'UNABLE_TO_DELETE', 'NO_EXTENSION', 'INVALID_CONFIGURATION_JSON', 'INVALID_SETTINGS_DEFINITION', 'UNEXPECTED_ERROR', 'INVALID_RUNTIME_CONTEXT'] as const;
const WebCode = builder.enumType('ErrorsWebPixelUserErrorCode', { values: WEB_CODES });
const WebError = builder.objectRef<UserError>('ErrorsWebPixelUserError').implement({
  interfaces: [DisplayableError],
  fields: (t) => ({ code: t.field({ type: WebCode, nullable: true, resolve: (e) => (e.code && (WEB_CODES as readonly string[]).includes(e.code) ? (e.code as 'BLANK') : null) }) }),
});
const WebPixel = builder.objectRef<PixelRow>('WebPixel').implement({
  interfaces: [Node],
  description: 'Settings of a web pixel are stored; running app pixels needs the extension runtime, which ShopMe does not have yet (custom pixels run today).',
  fields: (t) => ({ settings: t.field({ type: 'JSON', resolve: (p) => p.settings }) }),
});
registerNode('WebPixel', async (ctx, id) => { const p = await getPixel(ctx.db, ctx.shopId, id); return p?.kind === 'APP' ? p : null; });
const WebInput = builder.inputType('WebPixelInput', { fields: (t) => ({ settings: t.field({ type: 'JSON', required: true }) }) });
const webPayload = (name: string) => builder.objectRef<{ webPixel: PixelRow | null; userErrors: UserError[] }>(name).implement({
  fields: (t) => ({ webPixel: t.field({ type: WebPixel, nullable: true, resolve: (p) => p.webPixel }), userErrors: t.field({ type: [WebError], resolve: (p) => p.userErrors }) }),
});
const WebCreatePayload = webPayload('WebPixelCreatePayload');
const WebUpdatePayload = webPayload('WebPixelUpdatePayload');
const WebDeletePayload = builder.objectRef<{ deletedWebPixelId: string | null; userErrors: UserError[] }>('WebPixelDeletePayload').implement({
  fields: (t) => ({ deletedWebPixelId: t.id({ nullable: true, resolve: (p) => p.deletedWebPixelId }), userErrors: t.field({ type: [WebError], resolve: (p) => p.userErrors }) }),
});
const asSettings = (v: unknown): Record<string, unknown> | null => {
  const o = typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v;
  return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
};

builder.queryFields((t) => ({
  webPixel: t.field({
    type: WebPixel, nullable: true, args: { id: t.arg.id() },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'read_pixels'); if (a.id == null) return getAppPixel(ctx.db, ctx.shopId); const id = parseId(String(a.id), 'WebPixel'); const p = id ? await getPixel(ctx.db, ctx.shopId, id) : null; return p?.kind === 'APP' ? p : null; },
  }),
}));
builder.mutationFields((t) => ({
  webPixelCreate: t.field({
    type: WebCreatePayload, args: { webPixel: t.arg({ type: WebInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_pixels');
      const settings = asSettings(a.webPixel.settings);
      if (!settings) return { webPixel: null, userErrors: [{ field: ['webPixel', 'settings'], message: 'Settings must be a JSON object', code: 'INVALID_CONFIGURATION_JSON' }] };
      const r = await createAppPixel(ctx.db, ctx.shopId, settings);
      return r.ok ? { webPixel: r.value, userErrors: [] } : { webPixel: null, userErrors: r.errors };
    },
  }),
  webPixelUpdate: t.field({
    type: WebUpdatePayload, args: { id: t.arg.id({ required: true }), webPixel: t.arg({ type: WebInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_pixels');
      const settings = asSettings(a.webPixel.settings);
      const id = parseId(String(a.id), 'WebPixel');
      if (!settings) return { webPixel: null, userErrors: [{ field: ['webPixel', 'settings'], message: 'Settings must be a JSON object', code: 'INVALID_CONFIGURATION_JSON' }] };
      const r = id ? await updateAppPixel(ctx.db, ctx.shopId, id, settings) : null;
      return r?.ok ? { webPixel: r.value, userErrors: [] } : { webPixel: null, userErrors: r ? r.errors : [{ field: ['id'], message: 'Web pixel does not exist', code: 'NOT_FOUND' }] };
    },
  }),
  webPixelDelete: t.field({
    type: WebDeletePayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_pixels');
      const id = parseId(String(a.id), 'WebPixel');
      const p = id ? await getPixel(ctx.db, ctx.shopId, id) : null;
      if (!id || p?.kind !== 'APP') return { deletedWebPixelId: null, userErrors: [{ field: ['id'], message: 'Web pixel does not exist', code: 'NOT_FOUND' }] };
      await deletePixel(ctx.db, ctx.shopId, id);
      return { deletedWebPixelId: `gid://shopify/WebPixel/${id}`, userErrors: [] };
    },
  }),
}));
