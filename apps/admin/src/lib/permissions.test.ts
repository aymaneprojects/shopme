import { describe, expect, it } from 'vitest';
import { NAV_PERMISSION, can } from './permissions';

describe('can', () => {
  it('lets owners and admins see everything', () => {
    expect(can({ role: 'owner' }, 'staff')).toBe(true);
    expect(can({ role: 'admin', permissions: [] }, 'settings')).toBe(true);
    expect(can({ isShopOwner: true }, 'settings')).toBe(true);
  });
  it('limits staff to their permissions', () => {
    const staff = { role: 'staff', permissions: ['orders', 'products'] };
    expect(can(staff, 'orders')).toBe(true);
    expect(can(staff, 'settings')).toBe(false);
    expect(can(staff, NAV_PERMISSION.collections)).toBe(true);
  });
  it('allows everything while access is unknown', () => { expect(can(null, 'settings')).toBe(true); expect(can({ role: 'staff' }, undefined)).toBe(true); });
});
