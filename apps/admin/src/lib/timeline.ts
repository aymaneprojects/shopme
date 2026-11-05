import { formatMoney } from '../format';
import type { Key } from '../i18n';

export interface TimelineEvent {
  __typename: 'BasicEvent' | 'CommentEvent';
  id: string; action: string; message: string; createdAt: string;
  arguments?: Record<string, unknown> | null; authorEmail?: string | null; author?: { name: string } | null;
  rawMessage?: string; canDelete?: boolean; attachments?: string[];
}

export interface DayGroup { day: string; events: TimelineEvent[] }

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Events (newest first) grouped by local calendar day, keeping their order. */
export function groupByDay(events: TimelineEvent[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const e of events) {
    const day = dayKey(new Date(e.createdAt));
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.events.push(e);
    else groups.push({ day, events: [e] });
  }
  return groups;
}

/** `today`, `yesterday` or the day itself (a `YYYY-MM-DD` key), relative to `now`. */
export function dayLabel(day: string, now = new Date()): 'today' | 'yesterday' | null {
  if (day === dayKey(now)) return 'today';
  const y = new Date(now); y.setDate(y.getDate() - 1);
  return day === dayKey(y) ? 'yesterday' : null;
}

const exponent = (currency: string) => { try { return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2; } catch { return 2; } };
const minor = (n: unknown, currency: string, lang: string) => formatMoney(Number(n ?? 0) / 10 ** exponent(currency), currency, lang);

type T = (key: Key, vars?: Record<string, string | number>) => string;

/** Translated text of a system event; falls back to the message the server recorded. */
export function eventText(e: TimelineEvent, t: T, lang: string, order?: { name: string; currencyCode: string } | null): string {
  const a = e.arguments ?? {};
  const s = (k: string) => (a[k] == null ? '' : String(a[k]));
  const reason = (r: string) => t(`timeline.reason.${r}` as Key);
  const note = (text: string, n: string) => (n ? `${text}: ${n}` : text);
  switch (e.action) {
    case 'order.created': return t('timeline.ev.order.created', { name: order?.name ?? '', gateway: s('gateway') });
    case 'order.paid': return t('timeline.ev.order.paid');
    case 'order.confirmation_number': return t('btn.timeline.confirmation', { number: s('number') });
    case 'order.delivered': return t('btn.timeline.delivered');
    case 'order.payment_failed': return t('timeline.ev.order.payment_failed');
    case 'order.fulfilled': return t('timeline.ev.order.fulfilled', { n: Number(a.quantity ?? 0), name: s('name') });
    case 'order.tracking_updated': return t('timeline.ev.order.tracking_updated', { name: s('name') });
    case 'order.fulfillment_cancelled': return t('timeline.ev.order.fulfillment_cancelled', { name: s('name') });
    case 'order.held': return note(t('timeline.ev.order.held', { reason: reason(s('reason') || 'OTHER') }), s('note'));
    case 'order.hold_released': return t('timeline.ev.order.hold_released');
    case 'order.refunded': {
      const cur = s('currency') || order?.currencyCode || 'USD';
      const base = note(t('timeline.ev.order.refunded', { amount: minor(a.total, cur, lang) }), s('note'));
      return Number(a.giftCard ?? 0) > 0 ? `${base} (${t('timeline.ev.giftCardRestored', { amount: minor(a.giftCard, cur, lang) })})` : base;
    }
    case 'order.cancelled': return note(t('timeline.ev.order.cancelled', { reason: s('reason') ? t(`order.reason.${s('reason')}` as Key) : '' }), s('note'));
    case 'order.updated': return e.message === 'Billing address was updated' ? t('timeline.ev.order.billing') : e.message === 'Shipping address was updated' ? t('timeline.ev.order.shipping') : t('timeline.ev.order.updated');
    case 'order.edited': return t('timeline.ev.order.edited');
    case 'order.closed': return t('timeline.ev.order.closed');
    case 'order.opened': return t('timeline.ev.order.opened');
    case 'order.email_sent': return t('timeline.ev.order.email_sent', { template: s('template').replace(/_/g, ' '), to: s('to') });
    case 'customers/create': return t('timeline.ev.customer.created');
    case 'customers/update': return t('timeline.ev.customer.updated');
    case 'customer.order_placed': return t('timeline.ev.customer.order_placed', { name: s('name') });
    case 'customer.subscription_created': return t('sub.tl.created', { sub: `#${s('contractId')}`, order: s('name') });
    case 'customer.subscription_paused': case 'customer.subscription_activated': case 'customer.subscription_cancelled': {
      const what = e.action.slice('customer.subscription_'.length) as 'paused' | 'activated' | 'cancelled';
      return t(`sub.tl.${what}` as Key, { sub: `#${s('contractId')}` }) + (s('actor') === 'customer' ? ` ${t('sub.ev.byCustomer')}` : '');
    }
    default: return e.message;
  }
}
