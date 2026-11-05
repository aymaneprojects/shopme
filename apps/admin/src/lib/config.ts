import { useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserErrors, gql, mutate } from '../api';
import { SHOPME_CONFIG, SHOPME_CONFIG_UPDATE } from '../graphql';
import { useT } from '../i18n';

/** Settings blocks stored by the server (shopmeConfig); the shapes mirror packages/core/src/services/settings/config.ts. */
export interface PaymentRule { id: string; name: string; enabled: boolean; action: 'hide' | 'rename' | 'move_first'; method: string; newName: string; countries: string[]; minTotal: number | null; maxTotal: number | null }
export interface PaymentsConfig {
  testGateway: boolean; captureMethod: 'automatic' | 'manual';
  customMethods: Array<{ id: string; name: string; instructions: string; enabled: boolean }>;
  redirectGateways: Array<{ id: string; name: string; redirectUrl: string; secret: string; enabled: boolean }>;
  customizations: PaymentRule[]; cardBrands: string[];
}
export interface ShipRule { id: string; name: string; enabled: boolean; action: 'hide' | 'rename' | 'move_first'; optionName: string; newName: string; countries: string[]; minSubtotal: number | null; maxSubtotal: number | null }
export interface RoutingRule { id: string; name: string; enabled: boolean; countries: string[]; locationIds: number[] }
/** `http`: a carrier fronted by a small service (labels when `labels` is on); `test`: the built-in test carrier. */
export interface CarrierAccount { id: string; provider: 'http' | 'test'; name: string; endpoint: string; secret: string; labels: boolean }
export interface ShippingConfig {
  handlingDays: number; pickupFromOtherLocations: boolean; routing: RoutingRule[]; customizations: ShipRule[];
  fulfillmentServices: Array<{ id: string; name: string; email: string; notes: string }>;
  carrierAccounts: CarrierAccount[];
}
export interface TaxesConfig { digitalVat: boolean; customs: { originCountry: string; hsCode: string }; duties: { enabled: boolean; rules: Array<{ countryCode: string; rate: number; label: string }> } }
export interface GeneralConfig { businessEntity: { legalName: string; address1: string; address2: string; city: string; zip: string; countryCode: string; taxId: string }; backupRegion: string }
export interface OrdersConfig { idPrefix: string; idSuffix: string; autoArchive: boolean; autoFulfillGiftCards: boolean }
export interface NotificationsConfig { fulfillmentRequest: { enabled: boolean }; sms: { gatewayUrl: string; secret: string; templates: Record<string, { enabled: boolean; body: string }> } }
export interface CheckoutConfig { addressAutocomplete: boolean; branding: { accentColor: string; backgroundColor: string; logoUrl: string; buttonShape: 'pill' | 'rounded' | 'square'; headerText: string; footerText: string } }
export interface GiftCardsConfig { defaultExpirationMonths: number | null }
export interface ReturnSet { id: string; name: string; collectionIds: number[]; windowDays: number | null; shippingCost: 'free' | 'customer_fixed' | 'customer_pays'; shippingFee: number; restockingFeePercent: number }
export interface ReturnsConfig { ruleSets: ReturnSet[] }
export interface DocConf { enabled: boolean; title: string; notes: string; showPrices: boolean; showImages: boolean }
export interface DocumentsConfig { companyNote: string; invoice: DocConf; packingSlip: DocConf; pickList: DocConf }

export const errText = (e: unknown) => (e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e instanceof Error ? e.message : String(e));

export function useConfig<T>(key: string) {
  return useQuery({ queryKey: ['config', key], queryFn: async () => (await gql<{ shopmeConfig: T }>(SHOPME_CONFIG, { key })).shopmeConfig });
}

/** Saves a whole block; refreshes it and runs `onDone` with the stored value. */
export function useSaveConfig<T>(key: string, onDone?: (v: T) => void, onFail?: (message: string) => void) {
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();
  return useMutation({
    mutationFn: async (value: T) => (await mutate<{ value: T }>(SHOPME_CONFIG_UPDATE, { key, value }, 'shopmeConfigUpdate')).value,
    onSuccess: (v) => { toast(t('settings.saved')); void qc.invalidateQueries({ queryKey: ['config', key] }); onDone?.(v); },
    onError: (e) => { if (onFail) onFail(errText(e)); else toast(errText(e), 'critical'); },
  });
}

export const minor = (decimal: string, fractionDigits = 2): number | null => {
  const n = Number(decimal.replace(',', '.'));
  return decimal.trim() !== '' && Number.isFinite(n) && n >= 0 ? Math.round(n * 10 ** fractionDigits) : null;
};
export const major = (minorUnits: number | null | undefined, fractionDigits = 2): string => (minorUnits == null ? '' : (minorUnits / 10 ** fractionDigits).toFixed(fractionDigits));
export const newId = (taken: string[], base: string): string => {
  const slug = base.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
  let id = slug; let i = 2;
  while (taken.includes(id)) id = `${slug}-${i++}`;
  return id;
};
