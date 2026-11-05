import { and, eq, gt } from 'drizzle-orm';
import { PERMISSION_AREAS, sessions, shops, staffUsers } from '../db/schema';
import type { Db, Executor } from '../db/client';
import { errR, okR, type Result } from './catalog/common';
import { hashPassword, MIN_PASSWORD_LENGTH, type StaffUser } from './auth';
import { randomToken, sha256 } from './crypto';

export { PERMISSION_AREAS };
export type PermissionArea = (typeof PERMISSION_AREAS)[number];
export const INVITABLE_ROLES = ['admin', 'staff'] as const;
export const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

/** Area -> API scope families (`read_x` / `write_x`) it unlocks. Every scope the Admin API checks belongs to exactly one area. */
const AREA_SCOPES: Record<PermissionArea, string[]> = {
  products: ['products', 'inventory', 'locations', 'files'],
  orders: ['orders', 'fulfillments', 'draft_orders', 'reports'],
  customers: ['customers'],
  discounts: ['discounts'],
  online_store: ['themes', 'online_store_pages', 'online_store_navigation'],
  settings: ['shop', 'shipping', 'webhooks'],
  staff: ['users'],
};

export const isArea = (v: string): v is PermissionArea => (PERMISSION_AREAS as readonly string[]).includes(v);
export const normalizePermissions = (v: readonly string[]): PermissionArea[] => PERMISSION_AREAS.filter((a) => v.includes(a));

/** Areas a user may use: owner/admin all, staff the granted ones. */
export const permissionsOf = (u: Pick<StaffUser, 'role' | 'permissions'>): PermissionArea[] => (u.role === 'staff' ? normalizePermissions(u.permissions) : [...PERMISSION_AREAS]);
export const hasPermission = (u: Pick<StaffUser, 'role' | 'permissions'>, area: PermissionArea) => permissionsOf(u).includes(area);

/** Scopes of a signed-in staff user: `*` for owner/admin, else `read_`/`write_` for each granted area. */
export function scopesFor(u: Pick<StaffUser, 'role' | 'permissions'>): string[] {
  if (u.role !== 'staff') return ['*'];
  return permissionsOf(u).flatMap((a) => AREA_SCOPES[a].flatMap((s) => [`read_${s}`, `write_${s}`]));
}

// ---- reading ----------------------------------------------------------------------------------------------------------------

const cols = { id: staffUsers.id, email: staffUsers.email, firstName: staffUsers.firstName, lastName: staffUsers.lastName, role: staffUsers.role, active: staffUsers.active, permissions: staffUsers.permissions, invitePending: staffUsers.inviteTokenHash, lastLoginAt: staffUsers.lastLoginAt };
type Row = Pick<StaffUser, 'id' | 'email' | 'firstName' | 'lastName' | 'role' | 'active' | 'permissions' | 'lastLoginAt'> & { invitePending: string | null };
export type StaffMemberRow = Omit<Row, 'invitePending' | 'permissions'> & { invitePending: boolean; permissions: PermissionArea[] };
const shape = (r: Row): StaffMemberRow => ({ ...r, invitePending: !!r.invitePending, permissions: permissionsOf(r) });

export async function listStaff(db: Executor, shopId: number): Promise<StaffMemberRow[]> {
  return (await db.select(cols).from(staffUsers).where(eq(staffUsers.shopId, shopId)).orderBy(staffUsers.id)).map(shape);
}
export async function getStaff(db: Executor, shopId: number, id: number): Promise<StaffMemberRow | null> {
  const r = (await db.select(cols).from(staffUsers).where(and(eq(staffUsers.shopId, shopId), eq(staffUsers.id, id))))[0];
  return r ? shape(r) : null;
}

// ---- invitations ------------------------------------------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Not a valid argon2 hash: nobody can log in until the invitation is accepted. */
const NO_PASSWORD = '!invited';

export interface StaffInviteInput { email: string; role: string; permissions?: string[] | null; firstName?: string | null; lastName?: string | null }

/** Create (or re-send) an invitation. Returns the member and the plaintext accept token (shown once, mailed by the caller). */
export async function inviteStaff(db: Db, shopId: number, input: StaffInviteInput): Promise<Result<{ staff: StaffMemberRow; token: string }>> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return errR(['email'], 'Email is invalid', 'INVALID');
  if (!(INVITABLE_ROLES as readonly string[]).includes(input.role)) return errR(['role'], 'Role must be admin or staff', 'INVALID');
  const bad = (input.permissions ?? []).find((p) => !isArea(p));
  if (bad) return errR(['permissions'], `Unknown permission ${bad}`, 'INVALID');
  const token = randomToken(32);
  const fields = { role: input.role, permissions: normalizePermissions(input.permissions ?? []), inviteTokenHash: sha256(token), inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS), ...(input.firstName != null && { firstName: input.firstName }), ...(input.lastName != null && { lastName: input.lastName }) };
  const [existing] = await db.select().from(staffUsers).where(and(eq(staffUsers.shopId, shopId), eq(staffUsers.email, email))).limit(1);
  let id: number;
  if (existing) {
    if (!existing.inviteTokenHash) return errR(['email'], 'A staff member with this email already exists', 'TAKEN');
    await db.update(staffUsers).set({ ...fields, active: true, updatedAt: new Date() }).where(eq(staffUsers.id, existing.id));
    id = existing.id;
  } else {
    [{ id }] = (await db.insert(staffUsers).values({ shopId, email, passwordHash: NO_PASSWORD, ...fields }).returning({ id: staffUsers.id })) as [{ id: number }];
  }
  return okR({ staff: (await getStaff(db, shopId, id))!, token });
}

export interface InviteInfo { email: string; firstName: string | null; shopName: string }

export async function getInvite(db: Executor, token: string): Promise<InviteInfo | null> {
  const [r] = await db.select({ email: staffUsers.email, firstName: staffUsers.firstName, shopName: shops.name }).from(staffUsers).innerJoin(shops, eq(shops.id, staffUsers.shopId))
    .where(and(eq(staffUsers.inviteTokenHash, sha256(token)), eq(staffUsers.active, true), gt(staffUsers.inviteExpiresAt, new Date()))).limit(1);
  return r ?? null;
}

/** Set the password for a pending invitation (single use). Returns the activated user. */
export async function acceptInvite(db: Db, token: string, input: { password: string; firstName?: string | null; lastName?: string | null }): Promise<Result<StaffUser>> {
  if (input.password.length < MIN_PASSWORD_LENGTH) return errR(['password'], `Password must be at least ${MIN_PASSWORD_LENGTH} characters`, 'TOO_SHORT');
  const passwordHash = await hashPassword(input.password);
  const [u] = await db.update(staffUsers).set({
    passwordHash, inviteTokenHash: null, inviteExpiresAt: null, updatedAt: new Date(),
    ...(input.firstName?.trim() && { firstName: input.firstName.trim() }), ...(input.lastName?.trim() && { lastName: input.lastName.trim() }),
  }).where(and(eq(staffUsers.inviteTokenHash, sha256(token)), eq(staffUsers.active, true), gt(staffUsers.inviteExpiresAt, new Date()))).returning();
  return u ? okR(u) : errR(['token'], 'This invitation is invalid or has expired', 'INVALID_TOKEN');
}

// ---- updates ----------------------------------------------------------------------------------------------------------------

export interface StaffUpdateInput { role?: string | null; permissions?: string[] | null; firstName?: string | null; lastName?: string | null; active?: boolean | null }

async function target(db: Executor, shopId: number, id: number, actorId: number | null | undefined): Promise<Result<StaffUser>> {
  const [u] = await db.select().from(staffUsers).where(and(eq(staffUsers.shopId, shopId), eq(staffUsers.id, id))).limit(1);
  if (!u) return errR(['id'], 'Staff member does not exist', 'NOT_FOUND');
  if (u.role === 'owner') return errR(['id'], 'The shop owner cannot be changed or removed', 'OWNER');
  if (actorId === id) return errR(['id'], 'You cannot change or remove your own account', 'SELF');
  return okR(u);
}

export async function updateStaff(db: Db, shopId: number, id: number, input: StaffUpdateInput, actorId?: number | null): Promise<Result<StaffMemberRow>> {
  const [cur] = await db.select().from(staffUsers).where(and(eq(staffUsers.shopId, shopId), eq(staffUsers.id, id))).limit(1);
  if (!cur) return errR(['id'], 'Staff member does not exist', 'NOT_FOUND');
  const touchesAccess = input.role != null || input.permissions != null || input.active != null;
  if (touchesAccess) {
    const t = await target(db, shopId, id, actorId);
    if (!t.ok) return t;
  }
  if (input.role != null && !(INVITABLE_ROLES as readonly string[]).includes(input.role)) return errR(['role'], 'Role must be admin or staff', 'INVALID');
  const bad = (input.permissions ?? []).find((p) => !isArea(p));
  if (bad) return errR(['permissions'], `Unknown permission ${bad}`, 'INVALID');
  await db.update(staffUsers).set({
    ...(input.role != null && { role: input.role }), ...(input.permissions != null && { permissions: normalizePermissions(input.permissions) }),
    ...(input.firstName !== undefined && { firstName: input.firstName }), ...(input.lastName !== undefined && { lastName: input.lastName }),
    ...(input.active != null && { active: input.active }), updatedAt: new Date(),
  }).where(eq(staffUsers.id, id));
  if (input.active === false) await db.delete(sessions).where(eq(sessions.staffUserId, id));
  return okR((await getStaff(db, shopId, id))!);
}

export async function deactivateStaff(db: Db, shopId: number, id: number, actorId?: number | null): Promise<Result<StaffMemberRow>> {
  const t = await target(db, shopId, id, actorId);
  if (!t.ok) return t;
  await db.update(staffUsers).set({ active: false, inviteTokenHash: null, inviteExpiresAt: null, updatedAt: new Date() }).where(eq(staffUsers.id, id));
  await db.delete(sessions).where(eq(sessions.staffUserId, id));
  return okR((await getStaff(db, shopId, id))!);
}

export async function deleteStaff(db: Db, shopId: number, id: number, actorId?: number | null): Promise<Result<number>> {
  const t = await target(db, shopId, id, actorId);
  if (!t.ok) return t;
  await db.delete(staffUsers).where(eq(staffUsers.id, id));
  return okR(id);
}
