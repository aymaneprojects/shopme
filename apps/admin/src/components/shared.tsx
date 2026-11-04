import { Badge } from '@shopme/ui';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { formatMoney } from '../format';
import { useI18n } from '../i18n';
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

const finTone: Record<string, 'success' | 'warning' | 'neutral' | 'critical' | 'info'> = {
  PAID: 'success', PENDING: 'warning', AUTHORIZED: 'info', PARTIALLY_PAID: 'warning', PARTIALLY_REFUNDED: 'neutral', REFUNDED: 'neutral', VOIDED: 'neutral', EXPIRED: 'critical',
};
const fulTone: Record<string, 'success' | 'warning' | 'neutral' | 'critical' | 'info'> = {
  FULFILLED: 'success', UNFULFILLED: 'warning', PARTIALLY_FULFILLED: 'info', SCHEDULED: 'info', ON_HOLD: 'critical', RESTOCKED: 'neutral', IN_PROGRESS: 'info',
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

export const selectCls = 'rounded-md border border-line bg-canvas px-2 py-1.5 text-sm';
export const searchCls = 'w-full rounded-md border border-line bg-canvas py-2 pl-8 pr-3 text-sm';

export function AddressBlock({ a }: { a: { firstName?: string | null; lastName?: string | null; company?: string | null; address1?: string | null; address2?: string | null; city?: string | null; province?: string | null; zip?: string | null; country?: string | null; phone?: string | null } | null }) {
  if (!a) return <p className="text-sm text-muted">—</p>;
  const lines = [[a.firstName, a.lastName].filter(Boolean).join(' '), a.company, a.address1, a.address2, [a.zip, a.city].filter(Boolean).join(' '), a.province, a.country, a.phone].filter(Boolean);
  return <address className="text-sm not-italic leading-relaxed">{lines.map((l, i) => <div key={i}>{l}</div>)}</address>;
}
