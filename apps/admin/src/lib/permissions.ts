// Staff roles and permissions (owner/admin: everything; staff: the listed areas only).
import { useQuery } from '@tanstack/react-query';
import { gql } from '../api';
import { CURRENT_STAFF_MEMBER } from '../graphql';

export const PERMISSIONS = ['products', 'orders', 'customers', 'discounts', 'online_store', 'settings', 'staff'] as const;
export type Permission = (typeof PERMISSIONS)[number];
export const ROLES = ['owner', 'admin', 'staff'] as const;
export type Role = (typeof ROLES)[number];

export interface StaffAccess { role?: string | null; isShopOwner?: boolean; permissions?: string[] | null }

/** Whether the staff member may see an area. Unknown access (API missing) allows everything so the admin stays usable. */
export function can(access: StaffAccess | null | undefined, permission: Permission | undefined): boolean {
  if (!permission || !access) return true;
  if (access.isShopOwner || access.role === 'owner' || access.role === 'admin') return true;
  return !!access.permissions?.includes(permission);
}

/** Nav item id -> permission needed to see it (`home` is always visible). */
export const NAV_PERMISSION: Record<string, Permission> = {
  orders: 'orders', analytics: 'orders', abandoned: 'orders', drafts: 'orders', 'gift-cards': 'products', products: 'products', collections: 'products', inventory: 'products', customers: 'customers', segments: 'customers', discounts: 'discounts', markets: 'settings', catalogs: 'settings', 'online-store': 'online_store', content: 'online_store', metaobjects: 'online_store', settings: 'settings',
};

export function useStaffAccess() {
  const q = useQuery({ queryKey: ['current-staff'], staleTime: 60_000, retry: false, queryFn: () => gql<{ currentStaffMember: StaffAccess | null }>(CURRENT_STAFF_MEMBER) });
  const access = q.data?.currentStaffMember ?? null;
  return (permission: Permission | undefined) => can(access, permission);
}
