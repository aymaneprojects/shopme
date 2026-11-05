import { and, asc, eq, sql } from 'drizzle-orm';
import { staffRoles, staffUsers } from '../db/schema';
import type { Db, Executor } from '../db/client';
import { errR, okR, type Result } from './catalog/common';
import { parseCsvObjects } from './csv';
import { inviteStaff, isArea, normalizePermissions, type StaffMemberRow } from './staff';

export type StaffRole = typeof staffRoles.$inferSelect & { members: number };

const NAME_MAX = 60;

/** Custom roles with the number of members holding each. */
export async function listRoles(db: Executor, shopId: number): Promise<StaffRole[]> {
  return db.select({
    id: staffRoles.id, shopId: staffRoles.shopId, name: staffRoles.name, description: staffRoles.description, permissions: staffRoles.permissions, createdAt: staffRoles.createdAt, updatedAt: staffRoles.updatedAt,
    members: sql<number>`(select count(*)::int from staff_users su where su.role_id = staff_roles.id)`,
  }).from(staffRoles).where(eq(staffRoles.shopId, shopId)).orderBy(asc(staffRoles.name));
}

export interface RoleInput { name?: string | null; description?: string | null; permissions?: string[] | null }

function check(i: RoleInput, creating: boolean): Result<null> {
  if ((creating || i.name !== undefined) && !i.name?.trim()) return errR(['name'], "Name can't be blank");
  if (i.name && i.name.trim().length > NAME_MAX) return errR(['name'], `Name is too long (maximum is ${NAME_MAX} characters)`);
  if (['owner', 'admin', 'staff'].includes((i.name ?? '').trim().toLowerCase())) return errR(['name'], 'This name is reserved', 'TAKEN');
  const bad = (i.permissions ?? []).find((p) => !isArea(p));
  if (bad) return errR(['permissions'], `Unknown permission ${bad}`, 'INVALID');
  return okR(null);
}

const taken = async (db: Executor, shopId: number, name: string, selfId: number | null) =>
  (await db.select({ id: staffRoles.id }).from(staffRoles).where(and(eq(staffRoles.shopId, shopId), sql`lower(${staffRoles.name}) = ${name.trim().toLowerCase()}`))).some((r) => r.id !== selfId);

export async function createRole(db: Db, shopId: number, i: RoleInput): Promise<Result<StaffRole>> {
  const v = check(i, true);
  if (!v.ok) return v;
  if (await taken(db, shopId, i.name!, null)) return errR(['name'], 'Name has already been taken', 'TAKEN');
  const [row] = await db.insert(staffRoles).values({ shopId, name: i.name!.trim(), description: i.description?.trim() || null, permissions: normalizePermissions(i.permissions ?? []) }).returning();
  return okR({ ...row!, members: 0 });
}

/** Changing a role's permissions updates every member who holds it. */
export async function updateRole(db: Db, shopId: number, id: number, i: RoleInput): Promise<Result<StaffRole>> {
  const [cur] = await db.select().from(staffRoles).where(and(eq(staffRoles.shopId, shopId), eq(staffRoles.id, id))).limit(1);
  if (!cur) return errR(['id'], 'Role does not exist', 'NOT_FOUND');
  const v = check(i, false);
  if (!v.ok) return v;
  if (i.name && (await taken(db, shopId, i.name, id))) return errR(['name'], 'Name has already been taken', 'TAKEN');
  const permissions = i.permissions != null ? normalizePermissions(i.permissions) : cur.permissions;
  await db.transaction(async (tx) => {
    await tx.update(staffRoles).set({ ...(i.name != null && { name: i.name.trim() }), ...(i.description !== undefined && { description: i.description?.trim() || null }), permissions, updatedAt: new Date() }).where(eq(staffRoles.id, id));
    if (i.permissions != null) await tx.update(staffUsers).set({ permissions, updatedAt: new Date() }).where(and(eq(staffUsers.shopId, shopId), eq(staffUsers.roleId, id)));
  });
  return okR((await listRoles(db, shopId)).find((r) => r.id === id)!);
}

/** Deleting a role keeps its members' current permissions; they simply no longer follow the role. */
export async function deleteRole(db: Db, shopId: number, id: number): Promise<Result<number>> {
  const [cur] = await db.select({ id: staffRoles.id }).from(staffRoles).where(and(eq(staffRoles.shopId, shopId), eq(staffRoles.id, id))).limit(1);
  if (!cur) return errR(['id'], 'Role does not exist', 'NOT_FOUND');
  await db.delete(staffRoles).where(eq(staffRoles.id, id));
  return okR(id);
}

export interface StaffImportRow { line: number; email: string; ok: boolean; message: string | null; token?: string; staff?: StaffMemberRow }

/**
 * Invite staff members from CSV text. Columns: `email` (required), `first_name`, `last_name`, `role` (`admin`, `staff` or the name of a custom role).
 * Each row is independent: a bad row is reported and the others still go through. Existing members and the owner are skipped.
 */
export async function importStaff(db: Db, shopId: number, csv: string, opts: { allowAdmin: boolean }): Promise<StaffImportRow[]> {
  const roles = await listRoles(db, shopId);
  const out: StaffImportRow[] = [];
  let count = 0;
  for await (const { line, row: raw } of parseCsvObjects([csv])) {
    const row: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) row[k.trim().toLowerCase().replace(/[\s-]+/g, '_')] = v.trim();
    if (!Object.values(row).some(Boolean)) continue;
    if (++count > 200) { out.push({ line, email: row.email ?? '', ok: false, message: 'Too many rows: import at most 200 users at a time' }); break; }
    const email = row.email ?? '';
    const wanted = (row.role ?? '').toLowerCase();
    const custom = wanted && !['admin', 'staff', 'administrator'].includes(wanted) ? roles.find((r) => r.name.toLowerCase() === wanted) : undefined;
    if (wanted && !custom && !['admin', 'staff', 'administrator'].includes(wanted)) { out.push({ line, email, ok: false, message: `Unknown role "${row.role}"` }); continue; }
    const role = wanted === 'admin' || wanted === 'administrator' ? 'admin' : 'staff';
    if (role === 'admin' && !opts.allowAdmin) { out.push({ line, email, ok: false, message: 'Only the shop owner can invite administrators' }); continue; }
    const r = await inviteStaff(db, shopId, { email, role, roleId: custom?.id ?? null, permissions: custom ? undefined : role === 'staff' ? ['products', 'orders'] : [], firstName: row.first_name || null, lastName: row.last_name || null });
    out.push(r.ok ? { line, email: r.value.staff.email, ok: true, message: null, token: r.value.token, staff: r.value.staff } : { line, email, ok: false, message: r.errors[0]?.message ?? 'Invalid row' });
  }
  return out;
}
