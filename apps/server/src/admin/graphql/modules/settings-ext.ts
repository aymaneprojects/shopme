/**
 * Settings extensions (ShopMe-specific, no Shopify equivalent): validated configuration blocks (order ID format, payments, shipping rules,
 * taxes, notifications, checkout, gift cards, returns, documents), custom staff roles and staff import, tax presets and customs defaults,
 * carrier providers, local delivery follow-up, language domains and store deletion.
 */
import {
  applyCustomsDefaults, shippingByMarket, generatePolicies, applyTaxPreset, carrierProviders, configOf, createRole, deleteRole, getShop, getStaff, importStaff, listLocalDeliveries, listRoles, markLocalDelivery, sendNotification,
  setLocaleDomain, smsTemplateError, sendSms, TAX_PRESETS, taxRegions, updateConfig, updateRole, writeBackup, schema, type ConfigKey, CONFIG_KEYS,
} from '@shopme/core';
import { eq } from 'drizzle-orm';
import { parseId, toGid } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { definePayload } from '../types/errors';

const actor = (ctx: GraphQLContext) => (ctx.auth.kind === 'session' ? ctx.auth.user : null);
const oid = (v: string, type = 'StaffMember') => parseId(v, type);

const JsonPayload = definePayload<{ value: unknown }>('ShopmeJsonPayload', (t) => ({ value: t.field({ type: 'JSON', nullable: true, resolve: (p) => p.value }) }));

builder.queryFields((t) => ({
  shopmeConfig: t.field({
    type: 'JSON', description: `A settings block with defaults: ${CONFIG_KEYS.join(', ')}.`, args: { key: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'read_shop');
      const key = a.key.toUpperCase() as ConfigKey;
      if (!CONFIG_KEYS.includes(key)) throw new Error('Unknown configuration block');
      return configOf((await getShop(ctx.db, ctx.shopId))!, key);
    },
  }),
  shopmeStaffRoles: t.field({ type: 'JSON', resolve: async (_r, _a, ctx) => { requireScope(ctx, 'read_users'); return (await listRoles(ctx.db, ctx.shopId)).map((r) => ({ ...r, id: toGid('ShopmeStaffRole', r.id) })); } }),
  shopmeTaxRegions: t.field({ type: 'JSON', resolve: async (_r, _a, ctx) => { requireScope(ctx, 'read_shop'); return taxRegions(ctx.db, ctx.shopId); } }),
  shopmeTaxPresets: t.field({ type: 'JSON', resolve: (_r, _a, ctx) => { requireScope(ctx, 'read_shop'); return TAX_PRESETS.map((p) => ({ id: p.id, countries: p.countries, rows: p.rows.length })); } }),
  shopmeShippingByMarket: t.field({ type: 'JSON', resolve: async (_r, _a, ctx) => { requireScope(ctx, 'read_shipping'); return shippingByMarket(ctx.db, ctx.shopId); } }),
  shopmeCarrierProviders: t.field({ type: 'JSON', resolve: (_r, _a, ctx) => { requireScope(ctx, 'read_shipping'); return carrierProviders().map((p) => ({ id: p.id, name: p.name, needsAccount: p.needsAccount, params: p.params })); } }),
  shopmeLocalDeliveries: t.field({ type: 'JSON', resolve: async (_r, _a, ctx) => { requireScope(ctx, 'read_orders'); return (await listLocalDeliveries(ctx.db, ctx.shopId)).map((r) => ({ ...r, orderId: toGid('Order', r.orderId) })); } }),
}));

builder.mutationFields((t) => ({
  shopmeConfigUpdate: t.field({
    type: JsonPayload, args: { key: t.arg.string({ required: true }), value: t.arg({ type: 'JSON', required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_shop');
      const shop = (await getShop(ctx.db, ctx.shopId))!;
      if (a.key.toUpperCase() === 'NOTIFICATIONS') {
        const sms = ((a.value as { sms?: { templates?: Record<string, { body?: string }> } } | null)?.sms?.templates) ?? {};
        for (const [k, v] of Object.entries(sms)) { const e = smsTemplateError(v?.body ?? ''); if (e) return { value: null, userErrors: [{ field: ['value', 'sms', 'templates', k, 'body'], message: e }] }; }
      }
      const r = await updateConfig(ctx.db, shop, a.key, a.value, actor(ctx)?.id);
      return r.ok ? { value: r.value, userErrors: [] } : { value: null, userErrors: r.errors };
    },
  }),

  shopmeTaxPresetApply: t.field({
    type: JsonPayload, args: { id: t.arg.string({ required: true }), replace: t.arg.boolean() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_shop');
      const r = await applyTaxPreset(ctx.db, ctx.shopId, a.id, { replace: !!a.replace });
      return r.ok ? { value: r.value, userErrors: [] } : { value: null, userErrors: r.errors };
    },
  }),
  shopmeCustomsApply: t.field({
    type: JsonPayload, description: 'Fill the origin country and HS code of every inventory item that has none from the customs defaults.',
    resolve: async (_r, _a, ctx) => { requireScope(ctx, 'write_shop'); return { value: await applyCustomsDefaults(ctx.db, (await getShop(ctx.db, ctx.shopId))!), userErrors: [] }; },
  }),

  shopmeStaffRoleCreate: t.field({
    type: JsonPayload, args: { name: t.arg.string({ required: true }), description: t.arg.string(), permissions: t.arg.stringList({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_users');
      const r = await createRole(ctx.db, ctx.shopId, { name: a.name, description: a.description, permissions: a.permissions.map((p) => p.toLowerCase()) });
      return r.ok ? { value: { ...r.value, id: toGid('ShopmeStaffRole', r.value.id) }, userErrors: [] } : { value: null, userErrors: r.errors };
    },
  }),
  shopmeStaffRoleUpdate: t.field({
    type: JsonPayload, args: { id: t.arg.id({ required: true }), name: t.arg.string(), description: t.arg.string(), permissions: t.arg.stringList() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_users');
      const id = oid(String(a.id), 'ShopmeStaffRole');
      if (!id) return { value: null, userErrors: [{ field: ['id'], message: 'Role does not exist' }] };
      const r = await updateRole(ctx.db, ctx.shopId, id, { name: a.name, description: a.description, permissions: a.permissions?.map((p) => p.toLowerCase()) });
      return r.ok ? { value: { ...r.value, id: toGid('ShopmeStaffRole', r.value.id) }, userErrors: [] } : { value: null, userErrors: r.errors };
    },
  }),
  shopmeStaffRoleDelete: t.field({
    type: JsonPayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_users');
      const id = oid(String(a.id), 'ShopmeStaffRole');
      if (!id) return { value: null, userErrors: [{ field: ['id'], message: 'Role does not exist' }] };
      const r = await deleteRole(ctx.db, ctx.shopId, id);
      return r.ok ? { value: { id: String(a.id) }, userErrors: [] } : { value: null, userErrors: r.errors };
    },
  }),
  shopmeStaffImport: t.field({
    type: JsonPayload, description: 'Invite staff members from CSV text (columns email, first_name, last_name, role). Each row succeeds or fails on its own.', args: { csv: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_users');
      if (a.csv.length > 500_000) return { value: null, userErrors: [{ field: ['csv'], message: 'The file is too large' }] };
      const me = actor(ctx);
      const rows = await importStaff(ctx.db, ctx.shopId, a.csv, { allowAdmin: !me || me.role === 'owner' });
      const shop = (await getShop(ctx.db, ctx.shopId))!;
      for (const r of rows) {
        if (!r.ok || !r.token || !r.staff) continue;
        try {
          await sendNotification(ctx.db, ctx.app.mailer, shop, ctx.app.config.appUrl, 'staff_invite', r.staff.email, {
            invite: { url: `${ctx.app.config.appUrl.replace(/\/$/, '')}/admin/invite/${r.token}`, email: r.staff.email, role: r.staff.role, inviter: me ? [me.firstName, me.lastName].filter(Boolean).join(' ') || me.email : null },
          });
        } catch (e) { ctx.app.log.error({ err: e }, 'staff import invite email failed'); }
      }
      return { value: { invited: rows.filter((r) => r.ok).length, failed: rows.filter((r) => !r.ok).length, rows: rows.map((r) => ({ line: r.line, email: r.email, ok: r.ok, message: r.message })) }, userErrors: [] };
    },
  }),
  shopmeStaffRoleAssign: t.field({
    type: JsonPayload, description: 'Give a staff member a custom role (roleId null: back to hand-picked permissions).', args: { id: t.arg.id({ required: true }), roleId: t.arg.id() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_users');
      const id = oid(String(a.id));
      if (!id) return { value: null, userErrors: [{ field: ['id'], message: 'Staff member does not exist' }] };
      const me = actor(ctx);
      const target = await getStaff(ctx.db, ctx.shopId, id);
      if (me && me.role !== 'owner' && target?.role === 'admin') return { value: null, userErrors: [{ field: ['id'], message: 'Only the shop owner can manage administrators' }] };
      const { updateStaff } = await import('@shopme/core');
      const rid = a.roleId ? oid(String(a.roleId), 'ShopmeStaffRole') : 0;
      if (rid === null) return { value: null, userErrors: [{ field: ['roleId'], message: 'Role does not exist' }] };
      const r = await updateStaff(ctx.db, ctx.shopId, id, { roleId: rid }, me?.id);
      return r.ok ? { value: { id: String(a.id) }, userErrors: [] } : { value: null, userErrors: r.errors };
    },
  }),

  shopmeLocalDeliveryUpdate: t.field({
    type: JsonPayload, args: { orderId: t.arg.id({ required: true }), status: t.arg.string({ required: true, description: 'DELIVERED | MISSED' }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_orders');
      const id = oid(String(a.orderId), 'Order');
      const status = a.status.toUpperCase();
      if (!id || (status !== 'DELIVERED' && status !== 'MISSED')) return { value: null, userErrors: [{ field: ['status'], message: 'Status must be DELIVERED or MISSED' }] };
      const r = await markLocalDelivery(ctx.db, ctx.shopId, id, status, actor(ctx)?.id);
      return r.ok ? { value: { ...r.value, orderId: toGid('Order', r.value.orderId) }, userErrors: [] } : { value: null, userErrors: r.errors };
    },
  }),

  shopmePoliciesGenerate: t.field({
    type: JsonPayload, description: 'Fill the written policies that are empty (or all with overwrite) from templates using the store details.',
    args: { types: t.arg.stringList(), overwrite: t.arg.boolean() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_shop');
      const written = await generatePolicies(ctx.db, (await getShop(ctx.db, ctx.shopId))!, a.types ?? null, !!a.overwrite);
      return { value: { written }, userErrors: [] };
    },
  }),

  shopmeSmsTest: t.field({
    type: JsonPayload, args: { key: t.arg.string({ required: true }), to: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_shop');
      const shop = (await getShop(ctx.db, ctx.shopId))!;
      const { sampleVars } = await import('@shopme/core');
      const ok = await sendSms(shop, a.key, a.to, sampleVars(shop, ctx.app.config.appUrl));
      return ok ? { value: { sent: true }, userErrors: [] } : { value: null, userErrors: [{ field: ['to'], message: 'The SMS was not sent: check the gateway URL, the phone number and that this SMS is switched on' }] };
    },
  }),

  shopmeLocaleDomainUpdate: t.field({
    type: JsonPayload, args: { locale: t.arg.string({ required: true }), domain: t.arg.string() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_locales');
      const r = await setLocaleDomain(ctx.db, ctx.shopId, a.locale, a.domain ?? null);
      if (r.ok) await ctx.app.locales.refresh(ctx.db);
      return r.ok ? { value: r.value, userErrors: [] } : { value: null, userErrors: r.errors };
    },
  }),

  shopmeShopDelete: t.field({
    type: JsonPayload,
    description: 'Delete the store and all its data. Owner only. A full export is written to the server backups folder first; the store name must be typed to confirm.',
    args: { confirmName: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_shop');
      const me = actor(ctx);
      if (!me || me.role !== 'owner') return { value: null, userErrors: [{ field: null, message: 'Only the shop owner can delete the store' }] };
      const shop = (await getShop(ctx.db, ctx.shopId))!;
      if (a.confirmName.trim() !== shop.name) return { value: null, userErrors: [{ field: ['confirmName'], message: 'The name does not match the store name' }] };
      const name = `final-${new Date().toISOString().replace(/[:.]/g, '-')}.shopme`;
      try { await writeBackup(ctx.db, ctx.app.storage, ctx.shopId, ctx.app.config.dataDir, name, ctx.app.appVersion); }
      catch (e) { ctx.app.log.error({ err: e }, 'final export failed'); return { value: null, userErrors: [{ field: null, message: 'The final export failed, so nothing was deleted' }] }; }
      await ctx.db.delete(schema.shops).where(eq(schema.shops.id, ctx.shopId));
      await ctx.app.locales.refresh(ctx.db).catch(() => undefined);
      return { value: { deleted: true, backup: name }, userErrors: [] };
    },
  }),
}));
