import { and, asc, eq, ne } from 'drizzle-orm';
import { locationLocalDelivery, locationPickupSettings, locations, orderAddresses, orderDeliveries, shippingPackages, PICKUP_TIMES, PACKAGE_TYPES } from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { errR, okR, type Result } from '../catalog/common';
import { addEvent } from '../events';
import { createFulfillment } from '../orders/fulfillments';
import { getOrder, type Order } from '../orders/orders';
import type { PricingShippingRate } from '../pricing';

export type PickupSettings = typeof locationPickupSettings.$inferSelect;
export type LocalDeliverySettings = typeof locationLocalDelivery.$inferSelect;
export type ShippingPackage = typeof shippingPackages.$inferSelect;
export type OrderDelivery = typeof orderDeliveries.$inferSelect;

// ---------------------------------------------------------------------------------------------------------------------
// Local pickup
// ---------------------------------------------------------------------------------------------------------------------

export async function listPickupSettings(db: Executor, shopId: number): Promise<Map<number, PickupSettings>> {
  return new Map((await db.select().from(locationPickupSettings).where(eq(locationPickupSettings.shopId, shopId))).map((r) => [r.locationId, r]));
}
export async function getPickupSettings(db: Executor, shopId: number, locationId: number): Promise<PickupSettings | null> {
  return (await db.select().from(locationPickupSettings).where(and(eq(locationPickupSettings.shopId, shopId), eq(locationPickupSettings.locationId, locationId))))[0] ?? null;
}

async function activeLocation(db: Executor, shopId: number, id: number) {
  const [l] = await db.select().from(locations).where(and(eq(locations.shopId, shopId), eq(locations.id, id)));
  return l?.isActive ? l : null;
}

export interface PickupInput { locationId: number; pickupTime?: string | null; instructions?: string | null }

export async function enablePickup(db: Db, shopId: number, i: PickupInput): Promise<Result<PickupSettings>> {
  if (!(await activeLocation(db, shopId, i.locationId))) return errR(['localPickupSettings', 'locationId'], 'Active location not found', 'ACTIVE_LOCATION_NOT_FOUND');
  const time = i.pickupTime ?? 'TWO_TO_FOUR_DAYS';
  if (time === 'CUSTOM') return errR(['localPickupSettings', 'pickupTime'], 'A custom pickup time cannot be set', 'CUSTOM_PICKUP_TIME_NOT_ALLOWED');
  if (!PICKUP_TIMES.includes(time as never)) return errR(['localPickupSettings', 'pickupTime'], 'Pickup time is invalid', 'GENERIC_ERROR');
  const values = { enabled: true, pickupTime: time, instructions: (i.instructions ?? '').trim(), customPickupTime: null };
  const [row] = await db.insert(locationPickupSettings).values({ shopId, locationId: i.locationId, ...values }).onConflictDoUpdate({ target: locationPickupSettings.locationId, set: values }).returning();
  return okR(row!);
}

export async function disablePickup(db: Db, shopId: number, locationId: number): Promise<Result<number>> {
  const [l] = await db.select({ id: locations.id }).from(locations).where(and(eq(locations.shopId, shopId), eq(locations.id, locationId)));
  if (!l) return errR(['locationId'], 'Location not found', 'ACTIVE_LOCATION_NOT_FOUND');
  await db.update(locationPickupSettings).set({ enabled: false }).where(eq(locationPickupSettings.locationId, locationId));
  return okR(locationId);
}

// ---------------------------------------------------------------------------------------------------------------------
// Local delivery
// ---------------------------------------------------------------------------------------------------------------------

export async function listLocalDelivery(db: Executor, shopId: number): Promise<Map<number, LocalDeliverySettings>> {
  return new Map((await db.select().from(locationLocalDelivery).where(eq(locationLocalDelivery.shopId, shopId))).map((r) => [r.locationId, r]));
}
export async function getLocalDelivery(db: Executor, shopId: number, locationId: number): Promise<LocalDeliverySettings | null> {
  return (await db.select().from(locationLocalDelivery).where(and(eq(locationLocalDelivery.shopId, shopId), eq(locationLocalDelivery.locationId, locationId))))[0] ?? null;
}

export interface LocalDeliveryInput {
  enabled?: boolean | null; areaType?: string | null; postalCodes?: string[] | null;
  /** Minor units. */
  price?: number | null; minimumOrder?: number | null; freeOverAmount?: number | null; info?: string | null; phone?: string | null;
}

export async function updateLocalDelivery(db: Db, shopId: number, locationId: number, i: LocalDeliveryInput): Promise<Result<LocalDeliverySettings>> {
  if (!(await activeLocation(db, shopId, locationId))) return errR(['locationId'], 'Active location not found');
  if (i.areaType && i.areaType !== 'POSTAL_CODES') return errR(['areaType'], 'Only postal code areas are supported for now');
  for (const [k, v] of [['price', i.price], ['minimumOrder', i.minimumOrder], ['freeOverAmount', i.freeOverAmount]] as const) if (v != null && v < 0) return errR([k], `${k} must be greater than or equal to 0`);
  const cur = await getLocalDelivery(db, shopId, locationId);
  const postalCodes = i.postalCodes ? [...new Set(i.postalCodes.map((p) => p.trim()).filter(Boolean))] : (cur?.postalCodes ?? []);
  const enabled = i.enabled ?? cur?.enabled ?? false;
  if (enabled && !postalCodes.length) return errR(['postalCodes'], 'Add at least one postal code to deliver locally');
  const values = {
    enabled, areaType: 'POSTAL_CODES', postalCodes,
    price: i.price != null ? Math.round(i.price) : (cur?.price ?? 0),
    minimumOrder: i.minimumOrder !== undefined ? (i.minimumOrder != null ? Math.round(i.minimumOrder) : null) : (cur?.minimumOrder ?? null),
    freeOverAmount: i.freeOverAmount !== undefined ? (i.freeOverAmount != null ? Math.round(i.freeOverAmount) : null) : (cur?.freeOverAmount ?? null),
    info: i.info !== undefined ? (i.info?.trim() || null) : (cur?.info ?? null), phone: i.phone !== undefined ? (i.phone?.trim() || null) : (cur?.phone ?? null),
  };
  const [row] = await db.insert(locationLocalDelivery).values({ shopId, locationId, ...values }).onConflictDoUpdate({ target: locationLocalDelivery.locationId, set: values }).returning();
  return okR(row!);
}

// ---------------------------------------------------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------------------------------------------------

export interface PackageInput {
  name?: string | null; type?: string | null; length?: number | null; width?: number | null; height?: number | null; dimensionUnit?: string | null;
  weight?: number | null; weightUnit?: string | null; default?: boolean | null;
}
const DIM_UNITS = ['MILLIMETERS', 'CENTIMETERS', 'METERS', 'INCHES', 'FEET', 'YARDS'];
const W_UNITS = ['GRAMS', 'KILOGRAMS', 'OUNCES', 'POUNDS'];

export const listPackages = (db: Executor, shopId: number) => db.select().from(shippingPackages).where(eq(shippingPackages.shopId, shopId)).orderBy(asc(shippingPackages.id));
export async function getPackage(db: Executor, shopId: number, id: number): Promise<ShippingPackage | null> {
  return (await db.select().from(shippingPackages).where(and(eq(shippingPackages.shopId, shopId), eq(shippingPackages.id, id))))[0] ?? null;
}

function checkPackage(i: PackageInput, creating: boolean): Result<null> {
  if ((creating || i.name !== undefined) && !i.name?.trim()) return errR(['name'], "Name can't be blank");
  if (i.type && !PACKAGE_TYPES.includes(i.type as never)) return errR(['type'], 'Type is invalid');
  if (i.dimensionUnit && !DIM_UNITS.includes(i.dimensionUnit)) return errR(['dimensions', 'unit'], 'Unit is invalid');
  if (i.weightUnit && !W_UNITS.includes(i.weightUnit)) return errR(['weight', 'unit'], 'Unit is invalid');
  for (const [k, v] of [['length', i.length], ['width', i.width], ['height', i.height], ['weight', i.weight]] as const) if (v != null && !(v >= 0)) return errR([k], `${k} must be greater than or equal to 0`);
  return okR(null);
}
const packageValues = (i: PackageInput) => ({
  ...(i.name != null && { name: i.name.trim() }), ...(i.type && { type: i.type }),
  ...(i.length !== undefined && { length: i.length }), ...(i.width !== undefined && { width: i.width }), ...(i.height !== undefined && { height: i.height }), ...(i.dimensionUnit && { dimensionUnit: i.dimensionUnit }),
  ...(i.weight !== undefined && { weight: i.weight }), ...(i.weightUnit && { weightUnit: i.weightUnit }),
});

export async function createPackage(db: Db, shopId: number, i: PackageInput): Promise<Result<ShippingPackage>> {
  const v = checkPackage(i, true);
  if (!v.ok) return v;
  return db.transaction(async (tx) => {
    const first = (await tx.select({ id: shippingPackages.id }).from(shippingPackages).where(eq(shippingPackages.shopId, shopId)).limit(1)).length === 0;
    const makeDefault = !!i.default || first;
    if (makeDefault) await tx.update(shippingPackages).set({ isDefault: false }).where(eq(shippingPackages.shopId, shopId));
    const [row] = await tx.insert(shippingPackages).values({ shopId, name: i.name!.trim(), ...packageValues(i), isDefault: makeDefault }).returning();
    return okR(row!);
  });
}

export async function updatePackage(db: Db, shopId: number, id: number, i: PackageInput): Promise<Result<ShippingPackage>> {
  if (!(await getPackage(db, shopId, id))) return errR(['id'], 'Package not found');
  const v = checkPackage(i, false);
  if (!v.ok) return v;
  return db.transaction(async (tx) => {
    if (i.default) await tx.update(shippingPackages).set({ isDefault: false }).where(and(eq(shippingPackages.shopId, shopId), ne(shippingPackages.id, id)));
    const set = { ...packageValues(i), ...(i.default ? { isDefault: true } : {}), updatedAt: new Date() };
    const [row] = await tx.update(shippingPackages).set(set).where(eq(shippingPackages.id, id)).returning();
    return okR(row!);
  });
}

export async function makeDefaultPackage(db: Db, shopId: number, id: number): Promise<Result<ShippingPackage>> {
  return updatePackage(db, shopId, id, { default: true });
}

/** Deleting the default package makes the oldest remaining one the default. */
export async function deletePackage(db: Db, shopId: number, id: number): Promise<Result<number>> {
  const cur = await getPackage(db, shopId, id);
  if (!cur) return errR(['id'], 'Package not found');
  await db.transaction(async (tx) => {
    await tx.delete(shippingPackages).where(eq(shippingPackages.id, id));
    if (cur.isDefault) {
      const [next] = await tx.select({ id: shippingPackages.id }).from(shippingPackages).where(eq(shippingPackages.shopId, shopId)).orderBy(asc(shippingPackages.id)).limit(1);
      if (next) await tx.update(shippingPackages).set({ isDefault: true }).where(eq(shippingPackages.id, next.id));
    }
  });
  return okR(id);
}

// ---------------------------------------------------------------------------------------------------------------------
// Orders: delivery method and pickup progress
// ---------------------------------------------------------------------------------------------------------------------

/** Remember how an order is delivered. Pickup orders ship to the location address (the buyer's address stays as billing). */
export async function recordOrderDelivery(db: Executor, shopId: number, orderId: number, option: Pick<PricingShippingRate, 'type' | 'locationId'> | null): Promise<void> {
  const type = option?.type ?? 'SHIPPING';
  const locationId = option?.locationId ?? null;
  await db.insert(orderDeliveries).values({ shopId, orderId, methodType: option ? type : 'NONE', locationId }).onConflictDoNothing();
  if (type === 'PICK_UP' && locationId) {
    const [loc] = await db.select().from(locations).where(eq(locations.id, locationId));
    if (loc) {
      await db.update(orderAddresses).set({
        company: loc.name, address1: loc.address1, address2: loc.address2, city: loc.city, provinceCode: loc.provinceCode, province: loc.provinceCode, zip: loc.zip, countryCode: loc.countryCode, country: loc.countryCode,
      }).where(and(eq(orderAddresses.orderId, orderId), eq(orderAddresses.kind, 'shipping')));
    }
  }
}

export async function getOrderDelivery(db: Executor, shopId: number, orderId: number): Promise<OrderDelivery | null> {
  return (await db.select().from(orderDeliveries).where(and(eq(orderDeliveries.shopId, shopId), eq(orderDeliveries.orderId, orderId))))[0] ?? null;
}

async function pickupOrder(db: Executor, shopId: number, orderId: number): Promise<Result<{ order: Order; delivery: OrderDelivery }>> {
  const order = await getOrder(db, shopId, orderId);
  if (!order) return errR(['orderId'], 'Order does not exist');
  const delivery = await getOrderDelivery(db, shopId, orderId);
  if (!delivery || delivery.methodType !== 'PICK_UP') return errR(['orderId'], 'This order is not a pickup order');
  if (order.cancelledAt) return errR(['orderId'], 'This order is cancelled');
  return okR({ order, delivery });
}

/** The items are prepared and waiting at the location. */
export async function markPickupReady(db: Db, shopId: number, orderId: number, staffId?: number | null): Promise<Result<OrderDelivery>> {
  const o = await pickupOrder(db, shopId, orderId);
  if (!o.ok) return o;
  if (o.value.delivery.pickedUpAt) return errR(['orderId'], 'This order has already been picked up');
  if (o.value.delivery.pickupReadyAt) return okR(o.value.delivery);
  const [row] = await db.update(orderDeliveries).set({ pickupReadyAt: new Date() }).where(eq(orderDeliveries.orderId, orderId)).returning();
  await addEvent(db, shopId, { subjectType: 'order', subjectId: orderId, verb: 'order.pickup_ready', message: 'Marked as ready for pickup', authorStaffUserId: staffId, data: { locationId: row!.locationId } });
  return okR(row!);
}

/** The buyer collected the order: fulfills the remaining items from the pickup location. */
export async function markPickedUp(db: Db, shopId: number, orderId: number, staffId?: number | null): Promise<Result<OrderDelivery>> {
  const o = await pickupOrder(db, shopId, orderId);
  if (!o.ok) return o;
  if (o.value.delivery.pickedUpAt) return okR(o.value.delivery);
  if (o.value.order.fulfillmentStatus !== 'FULFILLED') {
    const f = await createFulfillment(db, shopId, orderId, { locationId: o.value.delivery.locationId, staffId, notifyCustomer: false });
    if (!f.ok && !f.errors.some((e) => e.message.includes('no items left'))) return f;
  }
  const now = new Date();
  const [row] = await db.update(orderDeliveries).set({ pickedUpAt: now, pickupReadyAt: o.value.delivery.pickupReadyAt ?? now }).where(eq(orderDeliveries.orderId, orderId)).returning();
  await addEvent(db, shopId, { subjectType: 'order', subjectId: orderId, verb: 'order.picked_up', message: 'Marked as picked up', authorStaffUserId: staffId, data: { locationId: row!.locationId } });
  return okR(row!);
}
