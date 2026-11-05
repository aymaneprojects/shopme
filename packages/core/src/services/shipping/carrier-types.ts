import type { ShippingConfig } from '../settings/config';

/** Types of carrier label purchase, shared by the providers (kept apart so providers can import them without a cycle). */

export type CarrierAccount = ShippingConfig['carrierAccounts'][number];

/** An address on a label (ship from / ship to). Only what a carrier needs to deliver: no email address. */
export interface LabelAddress { name: string; company: string | null; address1: string | null; address2: string | null; city: string | null; provinceCode: string | null; zip: string | null; countryCode: string | null; phone: string | null }
/** What is shipped: sent to the carrier when asking for label rates and when buying one. Money in minor units of `currency`. */
export interface LabelShipment {
  reference: string; currency: string; shipFrom: LabelAddress; shipTo: LabelAddress;
  parcel: { weightGrams: number; length: number | null; width: number | null; height: number | null; dimensionUnit: string; packageType: string | null };
  items: Array<{ title: string; sku: string | null; quantity: number; grams: number; price: number }>;
}
/** One postage offer of a carrier for a shipment. `id` is the carrier's, sent back to buy that offer. */
export interface LabelRateOffer { id: string; service: string; name: string; price: number; currency: string; estimatedDays: number | null }
/** A bought label: tracking, what was charged, and the document (a link the carrier hosts and/or the bytes, base64). */
export interface PurchasedLabel {
  labelId: string; trackingNumber: string; trackingUrl: string | null; service: string; name: string; price: number; currency: string;
  label: { format: 'PDF' | 'PNG' | 'ZPL'; url: string | null; data: string | null };
}
/** Optional postage purchase of a provider. Failures are thrown as {@link CarrierError} with a message for the merchant. */
export interface CarrierLabelSupport {
  rates(account: CarrierAccount, shipment: LabelShipment): Promise<LabelRateOffer[]>;
  purchase(account: CarrierAccount, shipment: LabelShipment, rateId: string): Promise<PurchasedLabel>;
  void(account: CarrierAccount, label: { labelId: string; trackingNumber: string | null }): Promise<{ refunded: boolean }>;
}
export class CarrierError extends Error {}

