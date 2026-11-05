import { and, eq } from 'drizzle-orm';
import { shippingLabelDocuments, shippingLabels, shippingPackages } from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { errR, okR, type Result } from '../catalog/common';
import { defaultLocationId, getLocation } from '../catalog/inventory';
import { addEvent } from '../events';
import { voidShippingLabel, type ShippingLabel } from '../orders-ops';
import { cancelFulfillment, createFulfillment, getFulfillment, updateTracking } from '../orders/fulfillments';
import { getOrder, getOrderDetail, type OrderAddress } from '../orders/orders';
import { configOf } from '../settings/config';
import { getShop, type Shop } from '../shops';
import { CarrierError, accountSellsLabels, carrierProvider, type CarrierAccount, type LabelAddress, type LabelRateOffer, type LabelShipment } from './carriers';

/**
 * Buying postage: the label rates of every carrier account that sells labels, the purchase of one (its tracking goes on the order's
 * fulfillment, its cost and document on the label) and the void of a bought label (the carrier is asked for a refund and the fulfillment
 * is cancelled, so the items can be shipped again). Recording a label bought elsewhere stays in orders-ops (`createShippingLabel`).
 */

export interface LabelParcelInput { packageId?: number | null; weightGrams: number }
export interface LabelPurchaseInput { orderId: number; fulfillmentId?: number | null; parcel: LabelParcelInput; accountId: string; rateId: string; notifyCustomer?: boolean; staffId?: number | null }
export interface LabelRateQuote { accountId: string; accountName: string; test: boolean; rate: LabelRateOffer }
export interface LabelRatesResult { rates: LabelRateQuote[]; errors: Array<{ accountId: string; accountName: string; message: string }> }

const MAX_GRAMS = 150_000;

/** Carrier accounts of Settings > Shipping that can sell postage. */
export const labelAccounts = (shop: Pick<Shop, 'settings'>): CarrierAccount[] => configOf(shop, 'SHIPPING').carrierAccounts.filter(accountSellsLabels);

const toLabelAddress = (a: Pick<OrderAddress, 'firstName' | 'lastName' | 'company' | 'address1' | 'address2' | 'city' | 'provinceCode' | 'zip' | 'countryCode' | 'phone'>): LabelAddress => ({
  name: [a.firstName, a.lastName].filter(Boolean).join(' '), company: a.company || null, address1: a.address1 || null, address2: a.address2 || null, city: a.city || null,
  provinceCode: a.provinceCode || null, zip: a.zip || null, countryCode: a.countryCode || null, phone: a.phone || null,
});

/** Ship-from address: the fulfilment's location (else the first active one), else the business address of Settings > General. */
async function shipFrom(db: Executor, shop: Shop, locationId: number | null): Promise<LabelAddress> {
  const loc = await getLocation(db, shop.id, locationId ?? (await defaultLocationId(db, shop.id)) ?? 0);
  const biz = configOf(shop, 'GENERAL').businessEntity;
  if (loc?.address1 || !biz.address1) {
    return { name: shop.name, company: biz.legalName || null, address1: loc?.address1 ?? null, address2: loc?.address2 ?? null, city: loc?.city ?? null, provinceCode: loc?.provinceCode ?? null, zip: loc?.zip ?? null, countryCode: loc?.countryCode ?? shop.country ?? null, phone: loc?.phone ?? null };
  }
  return { name: shop.name, company: biz.legalName || null, address1: biz.address1, address2: biz.address2 || null, city: biz.city || null, provinceCode: null, zip: biz.zip || null, countryCode: biz.countryCode || shop.country || null, phone: null };
}

/** The shipment sent to carriers: what is still to ship (or what a fulfilment holds), to the order's shipping address, in the chosen package. */
async function buildShipment(db: Executor, shop: Shop, orderId: number, fulfillmentId: number | null | undefined, parcel: LabelParcelInput): Promise<Result<LabelShipment>> {
  const order = await getOrder(db, shop.id, orderId);
  if (!order) return errR(['orderId'], 'Order does not exist', 'NOT_FOUND');
  if (order.cancelledAt) return errR(['orderId'], 'Cannot ship a cancelled order', 'INVALID');
  const box = await parcelOf(db, shop, parcel);
  if (!box.ok) return box;
  const d = await getOrderDetail(db, shop.id, orderId);
  if (!d.shippingAddress?.countryCode) return errR(['orderId'], 'The order has no shipping address', 'INVALID');
  let picks: Array<{ lineId: number; quantity: number }>;
  let locationId: number | null = null;
  if (fulfillmentId) {
    const f = d.fulfillments.find((x) => x.id === fulfillmentId);
    if (!f || f.status === 'CANCELLED') return errR(['fulfillmentId'], 'Fulfillment does not exist', 'NOT_FOUND');
    picks = f.lines.map((l) => ({ lineId: l.orderLineId, quantity: l.quantity }));
    locationId = f.locationId;
  } else {
    picks = d.lines.filter((l) => l.requiresShipping && l.currentQuantity > l.fulfilledQuantity).map((l) => ({ lineId: l.id, quantity: l.currentQuantity - l.fulfilledQuantity }));
    if (!picks.length) return errR(['orderId'], 'There is nothing left to ship on this order', 'INVALID');
  }
  const items = picks.flatMap((p) => {
    const l = d.lines.find((x) => x.id === p.lineId);
    return l ? [{ title: l.title + (l.variantTitle ? ` - ${l.variantTitle}` : ''), sku: l.sku ?? null, quantity: p.quantity, grams: l.weightGrams ?? 0, price: l.unitPrice }] : [];
  });
  return okR({
    reference: order.name, currency: order.currency, shipFrom: await shipFrom(db, shop, locationId), shipTo: toLabelAddress(d.shippingAddress),
    parcel: box.value, items,
  });
}

/** The parcel sent to carriers: the weight (packaging included) and the dimensions of the chosen package, else of the default one. */
async function parcelOf(db: Executor, shop: Shop, parcel: LabelParcelInput): Promise<Result<LabelShipment['parcel']>> {
  const grams = Math.round(Number(parcel.weightGrams));
  if (!Number.isFinite(grams) || grams <= 0) return errR(['parcel', 'weightGrams'], 'Enter the weight of the package', 'INVALID');
  if (grams > MAX_GRAMS) return errR(['parcel', 'weightGrams'], 'A package cannot weigh more than 150 kg', 'INVALID');
  const pkg = parcel.packageId
    ? (await db.select().from(shippingPackages).where(and(eq(shippingPackages.shopId, shop.id), eq(shippingPackages.id, parcel.packageId))).limit(1))[0]
    : (await db.select().from(shippingPackages).where(and(eq(shippingPackages.shopId, shop.id), eq(shippingPackages.isDefault, true))).limit(1))[0];
  if (parcel.packageId && !pkg) return errR(['parcel', 'packageId'], 'Package does not exist', 'NOT_FOUND');
  return okR({ weightGrams: grams, length: pkg?.length ?? null, width: pkg?.width ?? null, height: pkg?.height ?? null, dimensionUnit: pkg?.dimensionUnit ?? 'CENTIMETERS', packageType: pkg?.type ?? null });
}

const carrierMessage = (e: unknown) => (e instanceof CarrierError ? e.message : `The carrier could not be reached (${e instanceof Error ? e.message : String(e)})`);

/** Postage offers of every carrier account that sells labels, cheapest first. One failing carrier does not hide the others. */
export async function labelRates(db: Db, shopId: number, input: { orderId: number; fulfillmentId?: number | null; parcel: LabelParcelInput }): Promise<Result<LabelRatesResult>> {
  const shop = await getShop(db, shopId);
  if (!shop) return errR(['shop'], 'Shop not found', 'NOT_FOUND');
  const accounts = labelAccounts(shop);
  if (!accounts.length) return errR(['accountId'], 'No carrier account can sell labels. Add one in Settings > Shipping.', 'NO_CARRIER');
  const shipment = await buildShipment(db, shop, input.orderId, input.fulfillmentId, input.parcel);
  return shipment.ok ? okR(await quoteAll(accounts, shipment.value)) : shipment;
}

/**
 * Label rates for a parcel to a destination, without an order (the "Calculate rates" button of Settings > Shipping): sent from the first
 * active location to a placeholder recipient in that country.
 */
export async function estimateLabelRates(db: Db, shopId: number, input: { countryCode: string; zip?: string | null; parcel: LabelParcelInput }): Promise<Result<LabelRatesResult>> {
  const shop = await getShop(db, shopId);
  if (!shop) return errR(['shop'], 'Shop not found', 'NOT_FOUND');
  const accounts = labelAccounts(shop);
  if (!accounts.length) return errR(['accountId'], 'No carrier account can sell labels. Add one in Settings > Shipping.', 'NO_CARRIER');
  const country = input.countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return errR(['countryCode'], 'Choose a destination country', 'INVALID');
  const box = await parcelOf(db, shop, input.parcel);
  if (!box.ok) return box;
  const shipTo: LabelAddress = { name: 'Rate estimate', company: null, address1: null, address2: null, city: null, provinceCode: null, zip: input.zip?.trim().slice(0, 20) || null, countryCode: country, phone: null };
  return okR(await quoteAll(accounts, { reference: 'ESTIMATE', currency: shop.currency, shipFrom: await shipFrom(db, shop, null), shipTo, parcel: box.value, items: [] }));
}

async function quoteAll(accounts: CarrierAccount[], shipment: LabelShipment): Promise<LabelRatesResult> {
  const answers = await Promise.all(accounts.map(async (account) => {
    const provider = carrierProvider(account.provider)!;
    try { return { account, test: !!provider.test, rates: await provider.labels!.rates(account, shipment), error: null }; } catch (e) { return { account, test: !!provider.test, rates: [], error: carrierMessage(e) }; }
  }));
  return {
    rates: answers.flatMap((a) => a.rates.map((rate) => ({ accountId: a.account.id, accountName: a.account.name, test: a.test, rate }))).sort((a, b) => a.rate.price - b.rate.price || a.accountName.localeCompare(b.accountName)),
    errors: answers.filter((a) => a.error).map((a) => ({ accountId: a.account.id, accountName: a.account.name, message: a.error! })),
  };
}

/**
 * Buy a label from a carrier account. The carrier answers with the tracking number, the price charged and the label; the tracking goes on
 * the fulfilment (a new one for the items still to ship, or the given existing one) and the label is stored with its cost and document.
 */
export async function purchaseLabel(db: Db, shopId: number, i: LabelPurchaseInput): Promise<Result<ShippingLabel>> {
  const shop = await getShop(db, shopId);
  if (!shop) return errR(['shop'], 'Shop not found', 'NOT_FOUND');
  const account = labelAccounts(shop).find((a) => a.id === i.accountId);
  if (!account) return errR(['accountId'], 'This carrier account cannot sell labels', 'NO_CARRIER');
  if (!i.rateId.trim()) return errR(['rateId'], 'Choose a rate', 'BLANK');
  const order = await getOrder(db, shopId, i.orderId);
  if (!order) return errR(['orderId'], 'Order does not exist', 'NOT_FOUND');
  if (!i.fulfillmentId && order.heldAt) return errR(['orderId'], 'This order is on hold: release the hold before buying a label', 'INVALID');
  if (i.fulfillmentId) {
    const taken = await db.select({ id: shippingLabels.id }).from(shippingLabels).where(and(eq(shippingLabels.shopId, shopId), eq(shippingLabels.fulfillmentId, i.fulfillmentId), eq(shippingLabels.status, 'ACTIVE'))).limit(1);
    if (taken.length) return errR(['fulfillmentId'], 'This fulfillment already has a label: void it first', 'TAKEN');
  }
  const shipment = await buildShipment(db, shop, i.orderId, i.fulfillmentId, i.parcel);
  if (!shipment.ok) return shipment;
  const provider = carrierProvider(account.provider)!;
  let bought;
  try { bought = await provider.labels!.purchase(account, shipment.value, i.rateId.trim()); } catch (e) { return errR(['rateId'], carrierMessage(e), 'CARRIER_ERROR'); }

  const tracking = { company: account.name, numbers: [bought.trackingNumber], urls: bought.trackingUrl ? [bought.trackingUrl] : [] };
  let fulfillmentId = i.fulfillmentId ?? null;
  if (fulfillmentId) {
    const r = await updateTracking(db, shopId, fulfillmentId, tracking, !!i.notifyCustomer);
    if (!r.ok) { await provider.labels!.void(account, { labelId: bought.labelId, trackingNumber: bought.trackingNumber }).catch(() => null); return r; }
  } else {
    const d = await getOrderDetail(db, shopId, i.orderId);
    const lines = d.lines.filter((l) => l.requiresShipping && l.currentQuantity > l.fulfilledQuantity).map((l) => ({ orderLineId: l.id, quantity: l.currentQuantity - l.fulfilledQuantity }));
    const f = await createFulfillment(db, shopId, i.orderId, { lines, tracking, notifyCustomer: !!i.notifyCustomer, staffId: i.staffId });
    // The postage is paid but the items could not be fulfilled: give the label back rather than leave a paid label with nothing on it.
    if (!f.ok) { await provider.labels!.void(account, { labelId: bought.labelId, trackingNumber: bought.trackingNumber }).catch(() => null); return f; }
    fulfillmentId = f.value.fulfillment.id;
  }
  const [row] = await db.insert(shippingLabels).values({
    shopId, orderId: i.orderId, fulfillmentId, carrier: account.name, service: bought.name, trackingNumber: bought.trackingNumber, trackingUrl: bought.trackingUrl, cost: bought.price, weightGrams: shipment.value.parcel.weightGrams,
    source: 'PURCHASED', carrierAccountId: account.id, providerRef: bought.labelId, currency: bought.currency, labelFormat: bought.label.format, labelUrl: bought.label.url,
  }).returning();
  if (bought.label.data) await db.insert(shippingLabelDocuments).values({ labelId: row!.id, shopId, contentType: bought.label.format === 'PNG' ? 'image/png' : bought.label.format === 'ZPL' ? 'application/zpl' : 'application/pdf', data: bought.label.data });
  await addEvent(db, shopId, {
    subjectType: 'order', subjectId: i.orderId, verb: 'order.label_purchased', message: `Shipping label bought from ${account.name} (${bought.name} ${bought.trackingNumber})${provider.test ? ' in test mode' : ''}`,
    authorStaffUserId: i.staffId, data: { labelId: row!.id, carrier: account.name, service: bought.name, trackingNumber: bought.trackingNumber, cost: bought.price, currency: bought.currency, test: !!provider.test },
  });
  return okR(row!);
}

/**
 * Void a label. A label bought through a carrier account is voided at the carrier first (which refunds the postage when it can), then its
 * fulfilment is cancelled so the items go back to "unfulfilled". A label recorded by hand is only marked voided.
 */
export async function voidLabel(db: Db, shopId: number, id: number, staffId?: number | null): Promise<Result<ShippingLabel>> {
  const [l] = await db.select().from(shippingLabels).where(and(eq(shippingLabels.shopId, shopId), eq(shippingLabels.id, id))).limit(1);
  if (!l) return errR(['id'], 'Label does not exist', 'NOT_FOUND');
  if (l.source !== 'PURCHASED') return voidShippingLabel(db, shopId, id, staffId);
  if (l.status === 'VOIDED') return errR(['id'], 'Label is already voided', 'INVALID');
  const shop = await getShop(db, shopId);
  const account = shop ? configOf(shop, 'SHIPPING').carrierAccounts.find((a) => a.id === l.carrierAccountId) : undefined;
  const provider = account ? carrierProvider(account.provider) : null;
  if (!account || !provider?.labels) return errR(['id'], 'The carrier account of this label no longer exists: void it on the carrier\'s site', 'NO_CARRIER');
  let refunded: boolean;
  try { refunded = (await provider.labels.void(account, { labelId: l.providerRef ?? l.trackingNumber ?? '', trackingNumber: l.trackingNumber })).refunded; } catch (e) { return errR(['id'], carrierMessage(e), 'CARRIER_ERROR'); }
  const [row] = await db.update(shippingLabels).set({ status: 'VOIDED', voidedAt: new Date(), refundStatus: refunded ? 'REFUNDED' : 'NOT_REFUNDED', updatedAt: new Date() }).where(eq(shippingLabels.id, id)).returning();
  if (l.fulfillmentId) {
    const f = await getFulfillment(db, shopId, l.fulfillmentId);
    if (f && f.status !== 'CANCELLED') await cancelFulfillment(db, shopId, f.id, staffId);
  }
  await addEvent(db, shopId, {
    subjectType: 'order', subjectId: l.orderId, verb: 'order.label_voided', message: `Shipping label voided (${l.carrier}${l.trackingNumber ? ` ${l.trackingNumber}` : ''})${refunded ? ', postage refunded' : ''}`,
    authorStaffUserId: staffId, data: { labelId: id, refunded },
  });
  return okR(row!);
}

/** The stored document of a purchased label (staff only), or null when the carrier hosts it (see `labelUrl`) or there is none. */
export async function labelDocument(db: Executor, shopId: number, id: number): Promise<{ contentType: string; data: Buffer; label: ShippingLabel } | null> {
  const [r] = await db.select({ d: shippingLabelDocuments, l: shippingLabels }).from(shippingLabelDocuments).innerJoin(shippingLabels, eq(shippingLabels.id, shippingLabelDocuments.labelId))
    .where(and(eq(shippingLabelDocuments.shopId, shopId), eq(shippingLabelDocuments.labelId, id))).limit(1);
  return r ? { contentType: r.d.contentType, data: Buffer.from(r.d.data, 'base64'), label: r.l } : null;
}

/** Labels of an order's fulfilments (any status), for the order page. */
export async function labelsOfOrder(db: Executor, shopId: number, orderId: number): Promise<Array<ShippingLabel & { hasDocument: boolean }>> {
  const rows = await db.select({ l: shippingLabels, doc: shippingLabelDocuments.labelId }).from(shippingLabels).leftJoin(shippingLabelDocuments, eq(shippingLabelDocuments.labelId, shippingLabels.id))
    .where(and(eq(shippingLabels.shopId, shopId), eq(shippingLabels.orderId, orderId)));
  return rows.map((r) => ({ ...r.l, hasDocument: r.doc != null }));
}

/** Weight of what a label would cover (the items still to ship, or a fulfillment's), from the weights stored on the order lines. */
export async function labelItemsWeight(db: Executor, shopId: number, orderId: number, fulfillmentId?: number | null): Promise<number> {
  const d = await getOrderDetail(db, shopId, orderId);
  const f = fulfillmentId ? d.fulfillments.find((x) => x.id === fulfillmentId) : null;
  const picks = f ? f.lines.map((l) => ({ id: l.orderLineId, q: l.quantity })) : d.lines.filter((l) => l.requiresShipping).map((l) => ({ id: l.id, q: Math.max(0, l.currentQuantity - l.fulfilledQuantity) }));
  return picks.reduce((n, p) => n + (d.lines.find((l) => l.id === p.id)?.weightGrams ?? 0) * p.q, 0);
}
