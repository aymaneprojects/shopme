import { Badge } from '@shopme/ui';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { formatMoney } from '../format';
import { useI18n } from '../i18n';
import { countryName } from '../lib/countries';
import type { Key } from '../i18n';

export interface Money { amount: string; currencyCode: string }
export interface MoneySet { shopMoney: Money }

/** Locale-aware money and date formatting. */
export function useFormat() {
  const { lang } = useI18n();
  return useMemo(() => ({
    money: (m?: Money | MoneySet | null) => { const x = m && 'shopMoney' in m ? m.shopMoney : m; return x ? formatMoney(x.amount, x.currencyCode, lang) : '—'; },
    date: (iso?: string | null) => (iso ? new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(new Date(iso)) : '—'),
    dateTime: (iso?: string | null) => (iso ? new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '—'),
  }), [lang]);
}

const finTone: Record<string, 'success' | 'attention' | 'warning' | 'neutral' | 'critical' | 'info'> = {
  PAID: 'success', PENDING: 'attention', AUTHORIZED: 'info', PARTIALLY_PAID: 'attention', PARTIALLY_REFUNDED: 'neutral', REFUNDED: 'neutral', VOIDED: 'neutral', EXPIRED: 'critical',
};
const fulTone: Record<string, 'success' | 'attention' | 'warning' | 'neutral' | 'critical' | 'info'> = {
  FULFILLED: 'success', UNFULFILLED: 'attention', PARTIALLY_FULFILLED: 'info', SCHEDULED: 'info', ON_HOLD: 'critical', RESTOCKED: 'neutral', IN_PROGRESS: 'info',
};

export function FinancialBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return <Badge tone={finTone[status] ?? 'neutral'}>{t(`fin.${status}` as Key)}</Badge>;
}
export function FulfillmentBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return <Badge tone={fulTone[status] ?? 'neutral'}>{t(`ful.${status}` as Key)}</Badge>;
}

/** URL-backed list state: filters live in the query string; cursor pagination resets when a filter changes. */
export function useListParams() {
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const patch = (changes: Record<string, string>, keepCursor = false) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) (v ? next.set(k, v) : next.delete(k));
    if (!keepCursor) { next.delete('after'); next.delete('before'); }
    setParams(next, { replace: true });
  };
  const page = (size: number) => (get('before') ? { last: size, before: get('before') } : { first: size, after: get('after') || null });
  return { params, get, patch, page, clear: () => setParams({}, { replace: true }) };
}

export const selectCls = 'field-control';
export const searchCls = 'field-control w-full pl-8';

export function AddressBlock({ a }: { a: { firstName?: string | null; lastName?: string | null; company?: string | null; address1?: string | null; address2?: string | null; city?: string | null; province?: string | null; zip?: string | null; country?: string | null; phone?: string | null; countryCodeV2?: string | null } | null }) {
  const { lang } = useI18n();
  if (!a) return <p className="text-[13px] text-muted">—</p>;
  // Countries with provinces/states write "City ST 12345"; the others "12345 City".
  const cityLine = a.province ? [a.city, a.province, a.zip].filter(Boolean).join(' ') : [a.zip, a.city].filter(Boolean).join(' ');
  const lines = [[a.firstName, a.lastName].filter(Boolean).join(' '), a.company, a.address1, a.address2, cityLine, a.countryCodeV2 ? countryName(a.countryCodeV2, lang) : a.country, a.phone].filter(Boolean);
  return <address className="text-[13px] not-italic leading-relaxed">{lines.map((l, i) => <div key={i}>{l}</div>)}</address>;
}
