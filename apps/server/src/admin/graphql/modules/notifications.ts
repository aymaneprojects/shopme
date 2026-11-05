import {
  getShop, isNotificationKey, liquidError, listNotificationTemplates, notificationSettingsOf, renderNotification, resetNotificationTemplate, sampleVars, saveNotificationTemplate,
  sendNotification, updateNotificationSettings, type Rendered, type TemplateView,
} from '@shopme/core';
import type { UserError } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { definePayload } from '../types/errors';

/** Notification email templates (Liquid subject + HTML body, overridable per shop) and the sender settings. */

const Template = builder.objectRef<TemplateView>('ShopmeNotificationTemplate').implement({
  fields: (t) => ({
    key: t.exposeString('key', { description: 'order_confirmation, staff_new_order, shipping_confirmation, shipping_update, order_cancelled, refund, customer_account_welcome, customer_account_invite, password_reset, draft_order_invoice, contact_form, staff_invite' }),
    name: t.exposeString('name'),
    description: t.exposeString('description'),
    audience: t.exposeString('audience', { description: 'customer | staff' }),
    variables: t.exposeStringList('variables', { description: 'Liquid variables available to the template.' }),
    subject: t.exposeString('subject'),
    body: t.field({ type: 'HTML', resolve: (v) => v.body }),
    defaultSubject: t.exposeString('defaultSubject'),
    defaultBody: t.field({ type: 'HTML', resolve: (v) => v.defaultBody }),
    customized: t.exposeBoolean('customized'),
    updatedAt: t.field({ type: 'DateTime', nullable: true, resolve: (v) => v.updatedAt }),
  }),
});
const Preview = builder.objectRef<Rendered>('ShopmeNotificationPreview').implement({
  fields: (t) => ({ subject: t.exposeString('subject'), html: t.field({ type: 'HTML', resolve: (r) => r.html }), text: t.exposeString('text') }),
});
const Settings = builder.objectRef<{ senderName: string; senderEmail: string }>('ShopmeNotificationSettings').implement({
  fields: (t) => ({ senderName: t.exposeString('senderName'), senderEmail: t.exposeString('senderEmail', { description: 'Empty: the server default sender (MAIL_FROM) is used.' }) }),
});

const TemplatePayload = definePayload<{ template: TemplateView | null }>('ShopmeNotificationTemplatePayload', (t) => ({ template: t.field({ type: Template, nullable: true, resolve: (p) => p.template }) }));
const PreviewPayload = definePayload<{ preview: Rendered | null }>('ShopmeNotificationPreviewPayload', (t) => ({ preview: t.field({ type: Preview, nullable: true, resolve: (p) => p.preview }) }));
const SettingsPayload = definePayload<{ settings: { senderName: string; senderEmail: string } | null }>('ShopmeNotificationSettingsUpdatePayload', (t) => ({ settings: t.field({ type: Settings, nullable: true, resolve: (p) => p.settings }) }));

const unknownKey: UserError[] = [{ field: ['key'], message: 'Unknown notification template' }];
const templateOf = async (ctx: GraphQLContext, key: string) => {
  const shop = (await getShop(ctx.db, ctx.shopId))!;
  return { shop, view: (await listNotificationTemplates(ctx.db, shop)).find((t) => t.key === key)! };
};

builder.queryFields((t) => ({
  shopmeNotificationTemplates: t.field({
    type: [Template], resolve: async (_r, _a, ctx) => { requireScope(ctx, 'read_shop'); return listNotificationTemplates(ctx.db, (await getShop(ctx.db, ctx.shopId))!); },
  }),
  shopmeNotificationSettings: t.field({ type: Settings, resolve: async (_r, _a, ctx) => { requireScope(ctx, 'read_shop'); return notificationSettingsOf((await getShop(ctx.db, ctx.shopId))!); } }),
}));

builder.mutationFields((t) => ({
  shopmeNotificationTemplateUpdate: t.field({
    type: TemplatePayload, args: { key: t.arg.string({ required: true }), subject: t.arg.string({ required: true }), body: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_shop');
      if (!isNotificationKey(a.key)) return { template: null, userErrors: unknownKey };
      if (!a.subject.trim()) return { template: null, userErrors: [{ field: ['subject'], message: "Subject can't be blank" }] };
      if (!a.body.trim()) return { template: null, userErrors: [{ field: ['body'], message: "Body can't be blank" }] };
      if (a.subject.length > 500 || a.body.length > 100_000) return { template: null, userErrors: [{ field: ['body'], message: 'Template is too long' }] };
      for (const [field, src] of [['subject', a.subject], ['body', a.body]] as const) {
        const err = liquidError(src);
        if (err) return { template: null, userErrors: [{ field: [field], message: `Liquid syntax error: ${err}` }] };
      }
      await saveNotificationTemplate(ctx.db, ctx.shopId, a.key, a.subject.trim(), a.body);
      return { template: (await templateOf(ctx, a.key)).view, userErrors: [] };
    },
  }),
  shopmeNotificationTemplateReset: t.field({
    type: TemplatePayload, args: { key: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_shop');
      if (!isNotificationKey(a.key)) return { template: null, userErrors: unknownKey };
      await resetNotificationTemplate(ctx.db, ctx.shopId, a.key);
      return { template: (await templateOf(ctx, a.key)).view, userErrors: [] };
    },
  }),
  shopmeNotificationPreview: t.field({
    type: PreviewPayload, description: 'Render a template with sample data. Pass subject/body to preview unsaved edits.',
    args: { key: t.arg.string({ required: true }), subject: t.arg.string(), body: t.arg.string() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'read_shop');
      if (!isNotificationKey(a.key)) return { preview: null, userErrors: unknownKey };
      const { shop, view } = await templateOf(ctx, a.key);
      const subject = a.subject ?? view.subject; const body = a.body ?? view.body;
      for (const src of [subject, body]) { const err = liquidError(src); if (err) return { preview: null, userErrors: [{ field: null, message: `Liquid syntax error: ${err}` }] }; }
      return { preview: await renderNotification(ctx.db, shop, ctx.app.config.appUrl, a.key, sampleVars(shop, ctx.app.config.appUrl), { subject, body }), userErrors: [] };
    },
  }),
  shopmeNotificationSendTest: t.field({
    type: PreviewPayload, description: 'Email the current (saved) template, rendered with sample data, to an address (default: the shop contact email).',
    args: { key: t.arg.string({ required: true }), to: t.arg.string() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_shop');
      if (!isNotificationKey(a.key)) return { preview: null, userErrors: unknownKey };
      const { shop } = await templateOf(ctx, a.key);
      const to = (a.to ?? shop.email ?? '').trim();
      if (!/^[^@\s]+@[^@\s]+$/.test(to)) return { preview: null, userErrors: [{ field: ['to'], message: 'Enter a valid email address.' }] };
      await sendNotification(ctx.db, ctx.app.mailer, shop, ctx.app.config.appUrl, a.key, to, sampleVars(shop, ctx.app.config.appUrl));
      return { preview: await renderNotification(ctx.db, shop, ctx.app.config.appUrl, a.key, sampleVars(shop, ctx.app.config.appUrl)), userErrors: [] };
    },
  }),
  shopmeNotificationSettingsUpdate: t.field({
    type: SettingsPayload, args: { senderName: t.arg.string(), senderEmail: t.arg.string() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_shop');
      const r = await updateNotificationSettings(ctx.db, (await getShop(ctx.db, ctx.shopId))!, { senderName: a.senderName ?? undefined, senderEmail: a.senderEmail ?? undefined });
      return 'error' in r ? { settings: null, userErrors: [{ field: ['senderEmail'], message: r.error }] } : { settings: r, userErrors: [] };
    },
  }),
}));
