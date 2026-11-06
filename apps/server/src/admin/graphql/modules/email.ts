import { builder } from '../builder';
import { requireScope } from '../context';
import { definePayload } from '../types/errors';
import type { EmailInput } from '../../../email/service';

/**
 * E-mail sending of the store (Settings > E-mails): how mail leaves the server (direct from this server by default, or an SMTP relay),
 * the DNS records to publish, live checks, DKIM rotation, a test e-mail and the outbox. Views are JSON: the admin page and the
 * platform routes share their shape. Secrets (relay password, DKIM private keys) are never returned.
 */

const EmailInputType = builder.inputType('ShopmeEmailInput', {
  fields: (t) => ({
    mode: t.string({ description: 'direct | relay. Empty string: back to the default.' }), preset: t.string(), host: t.string(), port: t.int(), security: t.string({ description: 'tls | starttls | none' }),
    username: t.string(), password: t.string({ description: 'Write-only. Omit to keep the saved one.' }), clearPassword: t.boolean(), manualPublicIp: t.string(), dmarcReportEmail: t.string(),
  }),
});
const SettingsPayload = definePayload<{ settings: unknown }>('ShopmeEmailSettingsPayload', (t) => ({ settings: t.field({ type: 'JSON', nullable: true, resolve: (p) => p.settings }) }));
const CheckPayload = definePayload<{ check: unknown }>('ShopmeEmailCheckPayload', (t) => ({ check: t.field({ type: 'JSON', nullable: true, resolve: (p) => p.check }) }));
const RecordsPayload = definePayload<{ records: unknown }>('ShopmeEmailRecordsPayload', (t) => ({ records: t.field({ type: 'JSON', nullable: true, resolve: (p) => p.records }) }));
const TestPayload = definePayload<{ result: unknown }>('ShopmeEmailTestPayload', (t) => ({ result: t.field({ type: 'JSON', nullable: true, resolve: (p) => p.result }) }));

builder.queryFields((t) => ({
  shopmeEmailSettings: t.field({ type: 'JSON', resolve: async (_r, _a, ctx) => { requireScope(ctx, 'read_shop'); return ctx.app.email.view(ctx.shopId); } }),
  shopmeEmailRecords: t.field({ type: 'JSON', description: 'DNS records to publish (SPF merged with the one already there), with the detected public IP.', resolve: async (_r, _a, ctx) => { requireScope(ctx, 'read_shop'); return ctx.app.email.records(ctx.shopId); } }),
  shopmeEmailOutbox: t.field({ type: 'JSON', args: { first: t.arg.int() }, resolve: async (_r, a, ctx) => { requireScope(ctx, 'read_shop'); return ctx.app.email.outbox(ctx.shopId, a.first ?? 25); } }),
  shopmeEmailHealth: t.field({ type: 'JSON', description: 'Can the store deliver e-mail? { status: ok | unchecked | problem, reasons, effectiveMode, fromKind }', resolve: async (_r, _a, ctx) => { requireScope(ctx, 'read_shop'); return ctx.app.email.health(ctx.shopId); } }),
}));

builder.mutationFields((t) => ({
  shopmeEmailSettingsUpdate: t.field({
    type: SettingsPayload, args: { input: t.arg({ type: EmailInputType, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_shop');
      const i = a.input;
      const input: EmailInput = {
        mode: i.mode === undefined ? undefined : i.mode === '' || i.mode === null ? null : (i.mode as 'direct' | 'relay'), preset: i.preset, host: i.host, port: i.port, security: i.security, username: i.username,
        password: i.password, clearPassword: i.clearPassword, manualPublicIp: i.manualPublicIp, dmarcReportEmail: i.dmarcReportEmail,
      };
      if (input.mode !== undefined && input.mode !== null && !['direct', 'relay'].includes(input.mode)) return { settings: null, userErrors: [{ field: ['mode'], message: 'Mode must be direct or relay' }] };
      const r = await ctx.app.email.updateSettings(ctx.shopId, input);
      if ('errors' in r) return { settings: null, userErrors: r.errors };
      return { settings: await ctx.app.email.view(ctx.shopId), userErrors: [] };
    },
  }),
  shopmeEmailCheck: t.field({
    type: CheckPayload, description: 'Run the live DNS and server checks and keep their outcome.',
    resolve: async (_r, _a, ctx) => { requireScope(ctx, 'write_shop'); return { check: await ctx.app.email.check(ctx.shopId), userErrors: [] }; },
  }),
  shopmeEmailDkimRotate: t.field({
    type: RecordsPayload, description: 'Create a new DKIM key. It signs nothing until activated, so its DNS record can be published first.',
    resolve: async (_r, _a, ctx) => {
      requireScope(ctx, 'write_shop');
      if (!(await ctx.app.email.rotateKey(ctx.shopId))) return { records: null, userErrors: [{ field: null, message: 'The store has no sending domain yet' }] };
      return { records: await ctx.app.email.records(ctx.shopId), userErrors: [] };
    },
  }),
  shopmeEmailDkimActivate: t.field({
    type: RecordsPayload, description: 'Switch to the pending DKIM key; the previous one is retired.',
    resolve: async (_r, _a, ctx) => {
      requireScope(ctx, 'write_shop');
      if (!(await ctx.app.email.activateKey(ctx.shopId))) return { records: null, userErrors: [{ field: null, message: 'There is no pending key to activate' }] };
      return { records: await ctx.app.email.records(ctx.shopId), userErrors: [] };
    },
  }),
  shopmeEmailSendTest: t.field({
    type: TestPayload, description: 'Send a test e-mail now and return the delivery result and the remote server response. Limited to 5 per 10 minutes.',
    args: { to: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_shop');
      const to = a.to.trim();
      if (!/^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/.test(to)) return { result: null, userErrors: [{ field: ['to'], message: 'Enter a valid email address.' }] };
      const wait = ctx.app.email.testRateLimit(ctx.shopId);
      if (wait) return { result: null, userErrors: [{ field: ['to'], message: `Too many test e-mails. Try again in ${Math.ceil(wait / 60)} minute(s).` }] };
      return { result: await ctx.app.email.sendTest(ctx.shopId, to), userErrors: [] };
    },
  }),
}));
