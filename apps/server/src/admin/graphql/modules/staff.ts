import { deactivateStaff, deleteStaff, getShop, getStaff, inviteStaff, sendNotification, updateStaff, type StaffMemberRow } from '@shopme/core';
import { toGid, parseId, type UserError } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { definePayload } from '../types/errors';
import { StaffMember } from '../types/sales';

/**
 * Staff management (ShopMe mutations; Shopify has no equivalent) and the missing standard queries.
 * Roles: owner | admin | staff. `staff` members hold only the permission areas granted to them; owner and admin hold all.
 */

builder.objectFields(StaffMember, (t) => ({
  shopmeRole: t.string({ description: 'owner | admin | staff', resolve: (s) => s.role }),
  shopmePermissions: t.stringList({ description: 'Permission areas: products, orders, customers, discounts, online_store, settings, staff.', resolve: (s) => s.permissions }),
  shopmeTwoFactorEnabled: t.boolean({ description: 'True when the member has two-step authentication on.', resolve: (s) => !!s.twoFactor }),
  shopmeRoleId: t.id({ nullable: true, description: 'Custom role of the member.', resolve: (s) => (s.roleId ? toGid('ShopmeStaffRole', s.roleId) : null) }),
  shopmeRoleName: t.string({ nullable: true, resolve: (s) => s.roleName ?? null }),
  shopmeInvitePending: t.boolean({ resolve: (s) => s.invitePending }),
  shopmeLastLoginAt: t.field({ type: 'DateTime', nullable: true, resolve: (s) => s.lastLoginAt }),
}));

const Payload = definePayload<{ staffMember: StaffMemberRow | null; inviteUrl?: string | null }>('ShopmeStaffPayload', (t) => ({
  staffMember: t.field({ type: StaffMember, nullable: true, resolve: (p) => p.staffMember }),
  inviteUrl: t.string({ nullable: true, description: 'Accept link of a pending invitation (also emailed). Only returned by shopmeStaffInvite.', resolve: (p) => p.inviteUrl ?? null }),
}));
const DeletePayload = definePayload<{ deletedStaffMemberId: string | null }>('ShopmeStaffDeletePayload', (t) => ({ deletedStaffMemberId: t.id({ nullable: true, resolve: (p) => p.deletedStaffMemberId }) }));

const actor = (ctx: GraphQLContext) => (ctx.auth.kind === 'session' ? ctx.auth.user : null);
const lower = (v?: string[] | null) => v?.map((x) => x.toLowerCase());

/** Only the owner manages admins; admins manage `staff` members. */
async function mayManage(ctx: GraphQLContext, id: number, role?: string | null): Promise<UserError | null> {
  const me = actor(ctx);
  if (!me || me.role === 'owner') return null;
  const target = await getStaff(ctx.db, ctx.shopId, id);
  if (target?.role === 'admin' || role === 'admin') return { field: ['id'], message: 'Only the shop owner can manage administrators' };
  return null;
}

builder.queryFields((t) => ({
  staffMember: t.field({
    type: StaffMember, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_users'); const id = parseId(String(a.id), 'StaffMember'); return id ? getStaff(ctx.db, ctx.shopId, id) : null; },
  }),
  currentStaffMember: t.field({
    type: StaffMember, nullable: true, description: 'The signed-in staff member (null for API tokens).',
    resolve: (_r, _a, ctx) => { const me = actor(ctx); return me ? getStaff(ctx.db, ctx.shopId, me.id) : null; },
  }),
}));

builder.mutationFields((t) => ({
  shopmeStaffInvite: t.field({
    type: Payload,
    args: { email: t.arg.string({ required: true }), role: t.arg.string({ required: true }), roleId: t.arg.id(), permissions: t.arg.stringList(), firstName: t.arg.string(), lastName: t.arg.string() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_users');
      const denied = await mayManage(ctx, 0, a.role.toLowerCase());
      if (denied) return { staffMember: null, userErrors: [{ field: ['role'], message: denied.message }] };
      const r = await inviteStaff(ctx.db, ctx.shopId, { email: a.email, role: a.role.toLowerCase(), roleId: a.roleId ? parseId(String(a.roleId), 'ShopmeStaffRole') : null, permissions: lower(a.permissions), firstName: a.firstName, lastName: a.lastName });
      if (!r.ok) return { staffMember: null, userErrors: r.errors };
      const shop = (await getShop(ctx.db, ctx.shopId))!;
      const inviteUrl = `${ctx.app.config.appUrl.replace(/\/$/, '')}/admin/invite/${r.value.token}`;
      const me = actor(ctx);
      try {
        await sendNotification(ctx.db, ctx.app.mailer, shop, ctx.app.config.appUrl, 'staff_invite', r.value.staff.email, {
          invite: { url: inviteUrl, email: r.value.staff.email, role: r.value.staff.role, inviter: me ? [me.firstName, me.lastName].filter(Boolean).join(' ') || me.email : null },
        });
      } catch (e) {
        ctx.app.log.error({ err: e }, 'staff invite email failed');
        return { staffMember: r.value.staff, inviteUrl, userErrors: [{ field: null, message: 'The invitation was created but the email could not be sent. Share the invite link manually.' }] };
      }
      return { staffMember: r.value.staff, inviteUrl, userErrors: [] };
    },
  }),
  shopmeStaffUpdate: t.field({
    type: Payload,
    args: { id: t.arg.id({ required: true }), role: t.arg.string(), permissions: t.arg.stringList(), firstName: t.arg.string(), lastName: t.arg.string(), active: t.arg.boolean() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_users');
      const id = parseId(String(a.id), 'StaffMember');
      if (!id) return { staffMember: null, userErrors: [{ field: ['id'], message: 'Staff member does not exist' }] };
      const denied = await mayManage(ctx, id, a.role?.toLowerCase());
      if (denied) return { staffMember: null, userErrors: [denied] };
      const r = await updateStaff(ctx.db, ctx.shopId, id, { role: a.role?.toLowerCase(), permissions: lower(a.permissions), firstName: a.firstName, lastName: a.lastName, active: a.active }, actor(ctx)?.id);
      return r.ok ? { staffMember: r.value, userErrors: [] } : { staffMember: null, userErrors: r.errors };
    },
  }),
  shopmeStaffDeactivate: t.field({
    type: Payload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_users');
      const id = parseId(String(a.id), 'StaffMember');
      if (!id) return { staffMember: null, userErrors: [{ field: ['id'], message: 'Staff member does not exist' }] };
      const denied = await mayManage(ctx, id);
      if (denied) return { staffMember: null, userErrors: [denied] };
      const r = await deactivateStaff(ctx.db, ctx.shopId, id, actor(ctx)?.id);
      return r.ok ? { staffMember: r.value, userErrors: [] } : { staffMember: null, userErrors: r.errors };
    },
  }),
  shopmeStaffDelete: t.field({
    type: DeletePayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_users');
      const id = parseId(String(a.id), 'StaffMember');
      if (!id) return { deletedStaffMemberId: null, userErrors: [{ field: ['id'], message: 'Staff member does not exist' }] };
      const denied = await mayManage(ctx, id);
      if (denied) return { deletedStaffMemberId: null, userErrors: [denied] };
      const r = await deleteStaff(ctx.db, ctx.shopId, id, actor(ctx)?.id);
      return r.ok ? { deletedStaffMemberId: toGid('StaffMember', id), userErrors: [] } : { deletedStaffMemberId: null, userErrors: r.errors };
    },
  }),
}));
