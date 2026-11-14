import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { shops } from '../../db/schema';
import type { Executor } from '../../db/client';
import { errR, okR, type Result } from '../catalog/common';
import { addEvent } from '../events';
import type { Shop } from '../shops';
import { decryptSecret, encryptSecret } from '../two-factor';

/**
 * Store configuration blocks of Settings (general, orders, payments, shipping, taxes, notifications, checkout, gift cards, returns,
 * documents). Each block is a validated JSON object stored under `shops.settings.config.<key>`; reading always returns the block with
 * defaults filled in, so every consumer (checkout, order creation, notifications) reads the same typed shape.
 */

const text = (max = 500) => z.string().trim().max(max);
const country = z.string().trim().toUpperCase().regex(/^([A-Z]{2})?$/, 'Country code is invalid');
const countries = z.array(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Country code is invalid')).max(300);
const money = z.number().int().min(0).max(10_000_000_000);
const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const id = z.string().trim().min(1).max(64);
const url = z.string().trim().max(2000).refine((v) => v === '' || /^https?:\/\/[^\s]+$/.test(v), 'URL must start with http:// or https://');
const color = z.string().trim().regex(/^(#[0-9a-fA-F]{6})?$/, 'Color must look like #1a2b3c');

// ---------------------------------------------------------------------------------------------------------------------

const general = z.object({
  businessEntity: z.object({ legalName: text(200).default(''), address1: text(200).default(''), address2: text(200).default(''), city: text(120).default(''), zip: text(40).default(''), countryCode: country.default(''), taxId: text(60).default('') }).default({ legalName: '', address1: '', address2: '', city: '', zip: '', countryCode: '', taxId: '' }),
  /** Country the storefront uses for visitors from countries no market covers. */
  backupRegion: country.default(''),
});

const orders = z.object({
  idPrefix: text(16).default('#'),
  idSuffix: text(16).default(''),
  /** Close an order once it is paid and fulfilled. */
  autoArchive: z.boolean().default(false),
  /** Gift card items are fulfilled as soon as the order is placed (the code is emailed). */
  autoFulfillGiftCards: z.boolean().default(true),
});

const CAPTURE = ['automatic', 'manual'] as const;
const customMethod = z.object({ id: id, name: text(80).min(1, 'Name is required'), instructions: text(2000).default(''), enabled: z.boolean().default(true) });
export const GATEWAY_SECRET_MAX = 200;
const redirectGateway = z.object({ id: id, name: text(80).min(1, 'Name is required'), redirectUrl: url, /** Stored encrypted (see `sealGatewaySecrets`); the plain secret is at most GATEWAY_SECRET_MAX characters. */ secret: text(700).default(''), enabled: z.boolean().default(true) });
const PAY_ACTIONS = ['hide', 'rename', 'move_first'] as const;
const paymentRule = z.object({
  id: id, name: text(80).min(1, 'Name is required'), enabled: z.boolean().default(true), action: z.enum(PAY_ACTIONS),
  /** Payment method id the rule acts on (`stripe`, `bank_transfer`, `cod`, `test`, `manual:<id>`, `redirect:<id>`). */
  method: text(80).min(1, 'Choose a payment method'), newName: text(80).default(''),
  countries: countries.default([]), minTotal: money.nullable().default(null), maxTotal: money.nullable().default(null),
});
const payments = z.object({
  testGateway: z.boolean().default(false),
  captureMethod: z.enum(CAPTURE).default('automatic'),
  customMethods: z.array(customMethod).max(20).default([]),
  redirectGateways: z.array(redirectGateway).max(10).default([]),
  customizations: z.array(paymentRule).max(50).default([]),
  cardBrands: z.array(z.enum(['visa', 'mastercard', 'amex', 'discover', 'diners', 'jcb', 'unionpay', 'cartes_bancaires'])).max(8).default(['visa', 'mastercard', 'amex']),
});

const SHIP_ACTIONS = ['hide', 'rename', 'move_first'] as const;
const shipRule = z.object({
  id: id, name: text(80).min(1, 'Name is required'), enabled: z.boolean().default(true), action: z.enum(SHIP_ACTIONS),
  /** Matches shipping options whose name contains this text (case-insensitive); empty = every option. */
  optionName: text(80).default(''), newName: text(80).default(''),
  countries: countries.default([]), minSubtotal: money.nullable().default(null), maxSubtotal: money.nullable().default(null),
});
const routingRule = z.object({
  id: id, name: text(80).min(1, 'Name is required'), enabled: z.boolean().default(true),
  /** Ship-to countries the rule applies to (empty = every destination). */
  countries: countries.default([]),
  /** Locations to fulfil from, in order of preference. */
  locationIds: z.array(z.number().int().positive()).min(1, 'Choose at least one location').max(50),
});
const fulfillmentService = z.object({ id: id, name: text(80).min(1, 'Name is required'), email: text(200).default(''), notes: text(500).default('') });
/**
 * A carrier account: `http` is any carrier fronted by a small service at `endpoint` (rates, and labels when `labels` is on: see
 * docs/dev/carrier-labels.md); `test` is the built-in test carrier (no endpoint, fake labels with sample tracking numbers).
 */
const carrierAccount = z.object({
  id: id, provider: z.enum(['http', 'test']), name: text(80).min(1, 'Name is required'), endpoint: url.default(''), secret: text(200).default(''),
  /** The endpoint also sells postage (label rates, purchase and void). Always on for the test carrier. */
  labels: z.boolean().default(false),
}).refine((a) => a.provider !== 'http' || a.endpoint !== '', { message: 'Endpoint URL is required', path: ['endpoint'] });
const shipping = z.object({
  /** Days between the order and the parcel leaving: added to the transit time shown at checkout. */
  handlingDays: z.number().int().min(0).max(60).default(0),
  /** Whether a pickup location can offer items that another location holds (transferred before pickup). */
  pickupFromOtherLocations: z.boolean().default(false),
  routing: z.array(routingRule).max(50).default([]),
  customizations: z.array(shipRule).max(50).default([]),
  fulfillmentServices: z.array(fulfillmentService).max(20).default([]),
  carrierAccounts: z.array(carrierAccount).max(10).default([]),
});

const taxes = z.object({
  /** Digital goods are taxed with the buyer's country VAT (built-in EU table when the store has no rate for that country). */
  digitalVat: z.boolean().default(false),
  customs: z.object({ originCountry: country.default(''), hsCode: text(20).default('') }).default({ originCountry: '', hsCode: '' }),
  /** Import duties and taxes collected at checkout (delivered duty paid). */
  duties: z.object({ enabled: z.boolean().default(false), rules: z.array(z.object({ countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Country code is invalid'), rate: z.number().min(0).max(100), label: text(60).default('Import duties') })).max(250).default([]) }).default({ enabled: false, rules: [] }),
});

const smsTemplate = z.object({ enabled: z.boolean().default(false), body: text(480).default('') });
const notifications = z.object({
  /** Email the fulfilment services of Settings > Shipping when an order is placed. */
  fulfillmentRequest: z.object({ enabled: z.boolean().default(false) }).default({ enabled: false }),
  sms: z.object({
    /** The merchant's SMS gateway: receives `POST {to, body}` as JSON (with `Authorization: Bearer <secret>`). */
    gatewayUrl: url.default(''), secret: text(200).default(''),
    templates: z.record(z.string(), smsTemplate).default({}),
  }).default({ gatewayUrl: '', secret: '', templates: {} }),
});

const checkout = z.object({
  /** Address fields carry browser autofill hints (autocomplete attributes) and the postal code narrows the province. */
  addressAutocomplete: z.boolean().default(true),
  branding: z.object({
    accentColor: color.default(''), backgroundColor: color.default(''), logoUrl: url.default(''),
    buttonShape: z.enum(['pill', 'rounded', 'square']).default('pill'), headerText: text(160).default(''), footerText: text(300).default(''),
  }).default({ accentColor: '', backgroundColor: '', logoUrl: '', buttonShape: 'pill', headerText: '', footerText: '' }),
});

const giftCards = z.object({ defaultExpirationMonths: z.number().int().min(1).max(240).nullable().default(null) });

const SHIPPING_COSTS = ['free', 'customer_fixed', 'customer_pays'] as const;
const returns = z.object({
  ruleSets: z.array(z.object({
    id: id, name: text(80).min(1, 'Name is required'), collectionIds: z.array(z.number().int().positive()).max(100).default([]),
    windowDays: z.number().int().min(0).max(3650).nullable().default(null), shippingCost: z.enum(SHIPPING_COSTS).default('free'),
    shippingFee: money.default(0), restockingFeePercent: z.number().min(0).max(100).default(0),
  })).max(20).default([]),
});

const docConf = z.object({ enabled: z.boolean().default(true), title: text(80).default(''), notes: text(1000).default(''), showPrices: z.boolean().default(true), showImages: z.boolean().default(false) });
const documents = z.object({
  companyNote: text(500).default(''),
  invoice: docConf.default({ enabled: true, title: 'Invoice', notes: '', showPrices: true, showImages: false }),
  packingSlip: docConf.default({ enabled: true, title: 'Packing slip', notes: '', showPrices: false, showImages: true }),
  pickList: docConf.default({ enabled: true, title: 'Pick list', notes: '', showPrices: false, showImages: false }),
});

export const CONFIG_SCHEMAS = { GENERAL: general, ORDERS: orders, PAYMENTS: payments, SHIPPING: shipping, TAXES: taxes, NOTIFICATIONS: notifications, CHECKOUT: checkout, GIFT_CARDS: giftCards, RETURNS: returns, DOCUMENTS: documents } as const;
export type ConfigKey = keyof typeof CONFIG_SCHEMAS;
export const CONFIG_KEYS = Object.keys(CONFIG_SCHEMAS) as ConfigKey[];
export type ConfigOf<K extends ConfigKey> = z.output<(typeof CONFIG_SCHEMAS)[K]>;
export type GeneralConfig = ConfigOf<'GENERAL'>;
export type OrdersConfig = ConfigOf<'ORDERS'>;
export type PaymentsConfig = ConfigOf<'PAYMENTS'>;
export type ShippingConfig = ConfigOf<'SHIPPING'>;
export type TaxesConfig = ConfigOf<'TAXES'>;
export type NotificationsConfig = ConfigOf<'NOTIFICATIONS'>;
export type CheckoutConfig = ConfigOf<'CHECKOUT'>;
export type GiftCardsConfig = ConfigOf<'GIFT_CARDS'>;
export type ReturnsConfig = ConfigOf<'RETURNS'>;
export type DocumentsConfig = ConfigOf<'DOCUMENTS'>;

export const isConfigKey = (k: string): k is ConfigKey => k in CONFIG_SCHEMAS;

/** The plain value of a stored redirect gateway secret: decrypted, or as is for a legacy value saved before secrets were encrypted. */
export const gatewaySecretOf = (stored: string, key: string): string => (stored ? decryptSecret(stored, key) ?? stored : '');

const mapGatewaySecrets = <T>(cfg: T, fn: (secret: string) => string): T => {
  const c = cfg as unknown as { redirectGateways?: { secret: string }[] };
  return Array.isArray(c.redirectGateways) ? { ...c, redirectGateways: c.redirectGateways.map((g) => ({ ...g, secret: fn(g.secret) })) } as unknown as T : cfg;
};
/** PAYMENTS block as stored -> with the redirect gateway secrets in the clear (for the code that uses or shows them). */
export const openGatewaySecrets = <T>(cfg: T, key: string): T => mapGatewaySecrets(cfg, (s) => gatewaySecretOf(s, key));
/** PAYMENTS block to store: redirect gateway secrets encrypted with the same helpers as the Stripe keys (idempotent). */
export const sealGatewaySecrets = <T>(cfg: T, key: string): T => mapGatewaySecrets(cfg, (s) => (s && decryptSecret(s, key) === null ? encryptSecret(s, key) : s));

/** A configuration block with defaults filled in. A stored value that no longer validates falls back to the defaults. */
export function configOf<K extends ConfigKey>(shop: Pick<Shop, 'settings'>, key: K): ConfigOf<K> {
  const stored = ((shop.settings.config ?? {}) as Record<string, unknown>)[key.toLowerCase()];
  const r = CONFIG_SCHEMAS[key].safeParse(stored ?? {});
  return (r.success ? r.data : CONFIG_SCHEMAS[key].parse({})) as ConfigOf<K>;
}

const problem = (e: z.ZodError) => { const i = e.issues[0]!; return { field: i.path.map(String), message: i.message }; };

/** Replace a block. The whole block is validated; the first problem comes back with its path. */
export async function updateConfig(db: Executor, shop: Shop, key: string, value: unknown, staffId?: number | null, secretKey?: string): Promise<Result<unknown>> {
  const k = key.toUpperCase();
  if (!isConfigKey(k)) return errR(['key'], 'Unknown configuration block', 'INVALID');
  const r = CONFIG_SCHEMAS[k].safeParse(value ?? {});
  if (!r.success) { const p = problem(r.error); return errR(['value', ...p.field], p.message, 'INVALID'); }
  const dup = findDuplicateIds(r.data as Record<string, unknown>);
  if (dup) return errR(['value', dup], 'Identifiers must be unique', 'TAKEN');
  // Redirect gateway secrets are written encrypted (when the caller has the key) and handed back in the clear.
  let stored: unknown = r.data;
  let result: unknown = r.data;
  if (k === 'PAYMENTS' && secretKey) {
    const open = openGatewaySecrets(r.data as PaymentsConfig, secretKey);
    const long = open.redirectGateways.findIndex((g) => g.secret.length > GATEWAY_SECRET_MAX);
    if (long >= 0) return errR(['value', 'redirectGateways', String(long), 'secret'], `Must be at most ${GATEWAY_SECRET_MAX} characters`, 'INVALID');
    stored = sealGatewaySecrets(open, secretKey);
    result = open;
  }
  const config = { ...((shop.settings.config ?? {}) as Record<string, unknown>), [k.toLowerCase()]: stored };
  await db.update(shops).set({ settings: { ...shop.settings, config }, updatedAt: new Date() }).where(eq(shops.id, shop.id));
  await addEvent(db, shop.id, { subjectType: 'shop', subjectId: shop.id, verb: 'shop.updated', message: `Settings were updated (${k.toLowerCase().replace('_', ' ')})`, authorStaffUserId: staffId });
  return okR(result);
}

function findDuplicateIds(v: Record<string, unknown>): string | null {
  for (const [field, list] of Object.entries(v)) {
    if (!Array.isArray(list)) continue;
    const ids = list.map((x) => (x && typeof x === 'object' ? (x as { id?: unknown }).id : undefined)).filter((x) => x !== undefined);
    if (new Set(ids).size !== ids.length) return field;
  }
  return null;
}

/** Stable id for a new list entry (merchant-visible names slugged, made unique against the existing ids). */
export function uniqueId(name: string, taken: string[]): string {
  const base = slug(name) || 'item';
  let n = base; let i = 2;
  while (taken.includes(n)) n = `${base}-${i++}`;
  return n;
}

// ---- order names ------------------------------------------------------------------------------------------------------------

/** Display name of an order number with the store's prefix and suffix (`#1001` by default). */
export const orderNameOf = (shop: Pick<Shop, 'settings'>, orderNumber: number): string => {
  const c = configOf(shop, 'ORDERS');
  return `${c.idPrefix}${orderNumber}${c.idSuffix}`;
};

// ---- order routing ------------------------------------------------------------------------------------------------------------

/** Locations an order to `country` should be fulfilled from, in order of preference: the first enabled routing rule that matches. */
export function routedLocations(shop: Pick<Shop, 'settings'>, country: string | null): number[] {
  const rules = configOf(shop, 'SHIPPING').routing;
  const cc = country?.toUpperCase() ?? '';
  return rules.find((r) => r.enabled && (!r.countries.length || (cc !== '' && r.countries.includes(cc))))?.locationIds ?? [];
}
