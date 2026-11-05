import { Badge, Banner, Button, Card, ConfirmDialog, EmptyState, IndexTable, ListToolbar, Pagination, Skeleton, useToast } from '@shopme/ui';
import type { Column } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CreditCard, Pause, Play, Repeat, Search, SkipForward, XCircle, Zap } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { UserErrors, gql, mutate } from '../api';
import { PageHeader } from '../components/PageHeader';
import { FinancialBadge, FulfillmentBadge, useFormat, useListParams } from '../components/shared';
import type { Money } from '../components/shared';
import { gidToNum, numToGid } from '../format';
import {
  SUBSCRIPTION_BILLING_ATTEMPT_CREATE, SUBSCRIPTION_BILLING_CYCLE_SKIP, SUBSCRIPTION_CONTRACT, SUBSCRIPTION_CONTRACTS, SUBSCRIPTION_CONTRACT_ACTIVATE, SUBSCRIPTION_CONTRACT_CANCEL, SUBSCRIPTION_CONTRACT_PAUSE,
} from '../graphql';
import { useI18n } from '../i18n';
import type { Key } from '../i18n';
import { useDebounced } from '../lib/hooks';
import type { Connection } from '../lib/hooks';
import emptyOrders from '../assets/empty/empty-orders.webp';

/** Subscriptions (Orders > Subscriptions): the list of subscription contracts and a contract page with its history and actions. */

export type SubStatus = 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'EXPIRED' | 'FAILED';
type Interval = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';
export interface ContractRow {
  id: string; status: SubStatus; createdAt: string; nextBillingDate: string | null; lastPaymentStatus: 'SUCCEEDED' | 'FAILED' | null; currencyCode: string;
  customer: { id: string; displayName: string; email: string | null } | null;
  billingPolicy: { interval: Interval; intervalCount: number };
  lines: { nodes: Array<{ title: string; variantTitle: string | null; quantity: number; sellingPlanName: string | null; variantImage: { url: string } | null }> };
  linesCount: { count: number } | null;
  shopmeNextOrderTotal: Money | null;
}

const TONE: Record<SubStatus, 'success' | 'attention' | 'neutral' | 'critical' | 'info'> = { ACTIVE: 'success', PAUSED: 'attention', CANCELLED: 'neutral', EXPIRED: 'neutral', FAILED: 'critical' };
export function SubscriptionBadge({ status }: { status: SubStatus }) {
  const { t } = useI18n();
  return <Badge tone={TONE[status] ?? 'neutral'}>{t(`sub.status.${status}` as Key)}</Badge>;
}
type T = (k: Key, v?: Record<string, string | number>) => string;
export const everyLabel = (t: T, p: { interval: Interval; intervalCount: number }) => t(`sub.every.${p.interval}` as Key, { n: p.intervalCount });
export const contractName = (id: string) => `#${gidToNum(id)}`;
const errText = (e: unknown) => (e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : (e as Error).message);

const PAGE_SIZE = 25;
const TABS = ['all', 'ACTIVE', 'PAUSED', 'FAILED', 'CANCELLED', 'EXPIRED'] as const;
type Tab = (typeof TABS)[number];

export function SubscriptionsPage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const fmt = useFormat();
  const L = useListParams();
  const tab = (TABS.includes(L.get('tab') as Tab) ? L.get('tab') : 'all') as Tab;
  const [search, setSearch] = useState(L.get('q'));
  const term = useDebounced(search);
  const terms = [term.trim(), tab !== 'all' && `status:${tab}`].filter(Boolean).join(' ');
  const list = useQuery({
    queryKey: ['subscriptions', terms, L.get('after'), L.get('before')],
    queryFn: () => gql<{ subscriptionContracts: Connection<ContractRow> }>(SUBSCRIPTION_CONTRACTS, { query: terms || null, ...L.page(PAGE_SIZE) }),
    placeholderData: (p) => p,
  });
  const rows = list.data?.subscriptionContracts.nodes ?? [];
  const pi = list.data?.subscriptionContracts.pageInfo;
  const columns: Array<Column<ContractRow>> = [
    { key: 'name', header: t('sub.col.subscription'), cell: (c) => <span className="font-medium">{contractName(c.id)}</span> },
    { key: 'customer', header: t('sub.col.customer'), cell: (c) => c.customer ? <span className="block max-w-48 truncate">{c.customer.displayName}</span> : <span className="text-muted">—</span> },
    {
      key: 'products', header: t('sub.col.products'), cell: (c) => {
        const first = c.lines.nodes[0];
        const more = (c.linesCount?.count ?? c.lines.nodes.length) - 1;
        return first ? <span className="flex min-w-0 max-w-72 items-center gap-2">
          {first.variantImage?.url ? <img src={first.variantImage.url} alt="" className="size-8 shrink-0 rounded-md border border-line object-cover" /> : <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-md border border-line text-muted"><Repeat className="size-4" /></span>}
          <span className="min-w-0"><span className="block truncate">{first.title}{first.quantity > 1 ? ` × ${first.quantity}` : ''}</span>{more > 0 && <span className="text-xs text-muted">{t('sub.list.more', { n: more })}</span>}</span>
        </span> : '—';
      },
    },
    { key: 'frequency', header: t('sub.col.frequency'), cell: (c) => <span className="whitespace-nowrap">{everyLabel(t, c.billingPolicy)}</span> },
    { key: 'next', header: t('sub.col.next'), cell: (c) => <span className="whitespace-nowrap text-muted">{c.status === 'ACTIVE' ? fmt.date(c.nextBillingDate) : '—'}</span> },
    { key: 'status', header: t('sub.col.status'), cell: (c) => <SubscriptionBadge status={c.status} /> },
    { key: 'amount', header: t('sub.col.amount'), className: 'text-right', cell: (c) => <span className="whitespace-nowrap">{c.shopmeNextOrderTotal ? fmt.money(c.shopmeNextOrderTotal) : '—'}</span> },
  ];
  return (
    <>
      <PageHeader icon={<Repeat className="size-4" />} title={t('sub.list.title')} />
      <Card className="!p-0">
        <ListToolbar
          className="!rounded-b-none !shadow-none border-b border-line" viewsLabel={t('list.views')}
          views={TABS.map((id) => ({ id, label: id === 'all' ? t('sub.tab.all') : t(`sub.status.${id}` as Key) }))} view={tab} onView={(v) => L.patch({ tab: v === 'all' ? '' : v })}
          query={search} onQuery={(v) => { setSearch(v); L.patch({ q: v }); }} placeholder={t('sub.list.search')}
        />
        {list.isError && <div className="p-3"><Banner>{(list.error as Error).message}</Banner></div>}
        <IndexTable rows={rows} rowId={(r) => r.id} columns={columns} loading={list.isLoading} onRowClick={(r) => nav(`/orders/subscriptions/${gidToNum(r.id)}`)}
          selected={[]} onSelectedChange={() => {}} selectedLabel={(n) => t('common.selected', { n })} selectAllLabel={t('common.selectAll')}
          empty={list.isError ? null : terms
            ? <EmptyState icon={<Search className="size-10" />} title={t('products.noResults')} description={t('products.noResultsBody')} />
            : <EmptyState image={emptyOrders} title={t('sub.list.emptyTitle')} description={t('sub.list.emptyBody')} action={<Button onClick={() => nav('/products')}>{t('sub.list.emptyAction')}</Button>} />} />
        <Pagination hasPrevious={L.get('before') ? !!pi?.hasPreviousPage : !!L.get('after')} hasNext={L.get('before') ? true : !!pi?.hasNextPage}
          previousLabel={t('common.previous')} nextLabel={t('common.next')}
          onPrevious={() => L.patch({ before: pi?.startCursor ?? '', after: '' }, true)} onNext={() => L.patch({ after: pi?.endCursor ?? '', before: '' }, true)} />
      </Card>
    </>
  );
}

/* ------------------------------ contract page ------------------------------ */

interface Detail extends Omit<ContractRow, 'lines'> {
  updatedAt: string; lastBillingAttemptErrorType: string | null; note: string | null;
  shopmePaymentGateway: string; shopmeHasSavedPaymentMethod: boolean; shopmeCyclesCompleted: number; shopmeFailedAttempts: number; shopmeRetryAt: string | null; shopmePausedAt: string | null; shopmeCancelledAt: string | null;
  billingPolicy: { interval: Interval; intervalCount: number; minCycles: number | null; maxCycles: number | null };
  deliveryPolicy: { interval: Interval; intervalCount: number };
  deliveryPrice: Money;
  deliveryMethod: { address: { name: string | null; address1: string | null; address2: string | null; city: string | null; zip: string | null; province: string | null; country: string | null; phone: string | null }; shippingOption: { title: string } } | null;
  customer: { id: string; displayName: string; email: string | null; phone?: string | null } | null;
  originOrder: { id: string; name: string } | null;
  lines: { nodes: Array<{
    id: string; title: string; variantTitle: string | null; sku: string | null; quantity: number; sellingPlanName: string | null; productId: string | null; variantId: string | null;
    currentPrice: Money; lineDiscountedPrice: Money; variantImage: { url: string } | null;
    pricingPolicy: { basePrice: Money; cycleDiscounts: Array<{ adjustmentType: string; afterCycle: number; computedPrice: Money }> } | null;
  }> };
  orders: { nodes: Array<{ id: string; name: string; createdAt: string; displayFinancialStatus: string; displayFulfillmentStatus: string; totalPriceSet: { shopMoney: Money } }> };
  billingAttempts: { nodes: Array<{ id: string; createdAt: string; ready: boolean; errorCode: string | null; errorMessage: string | null; order: { id: string; name: string } | null }> };
  shopmeDiscounts: Array<{ title: string; code: string | null; remainingCycles: number | null; valueType: string; percentage: number | null; amount: Money | null }>;
  shopmeEvents: { nodes: Array<{ __typename: string; id?: string; action: string; message: string; createdAt: string; arguments?: Record<string, unknown> | null }> };
}

export function SubscriptionDetailPage() {
  const { id = '' } = useParams();
  const { t } = useI18n();
  const gid = numToGid('SubscriptionContract', id);
  const q = useQuery({ queryKey: ['subscription', gid], queryFn: () => gql<{ subscriptionContract: Detail | null }>(SUBSCRIPTION_CONTRACT, { id: gid }) });
  if (q.isLoading) return <div className="grid gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64" /></div>;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  if (!q.data?.subscriptionContract) return <Banner>{t('sub.notFound')}</Banner>;
  return <ContractView c={q.data.subscriptionContract} />;
}

function eventText(t: T, fmtDate: (iso: string) => string, e: Detail['shopmeEvents']['nodes'][number]): string {
  const a = e.arguments ?? {};
  const by = a.actor === 'customer' ? ` ${t('sub.ev.byCustomer')}` : '';
  switch (e.action) {
    case 'subscription_contracts/create': return t('sub.ev.create', { name: String(a.name ?? '') });
    case 'subscription_contracts/billed': return t(a.paid ? 'sub.ev.billed' : 'sub.ev.billedPending', { name: String(a.name ?? '') });
    case 'subscription_contracts/billing_failed': return t('sub.ev.billingFailed', { n: Number(a.attempt ?? 1) });
    case 'subscription_contracts/paused': return t('sub.ev.paused') + by;
    case 'subscription_contracts/activated': return t('sub.ev.activated') + by;
    case 'subscription_contracts/cancelled': return t('sub.ev.cancelled') + by;
    case 'subscription_contracts/skipped': return t('sub.ev.skipped', { date: a.skippedDate ? fmtDate(String(a.skippedDate)) : '' }) + by;
    case 'subscription_contracts/expired': return t('sub.ev.expired');
    case 'subscription_contracts/failed': return t('sub.ev.failed');
    default: return e.message;
  }
}

function ContractView({ c }: { c: Detail }) {
  const { t, lang } = useI18n();
  const fmt = useFormat();
  const toast = useToast();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<'cancel' | 'skip' | 'bill' | null>(null);
  const name = contractName(c.id);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['subscription', c.id] }); void qc.invalidateQueries({ queryKey: ['subscriptions'] }); };
  const act = useMutation({
    mutationFn: async (kind: 'pause' | 'resume' | 'cancel' | 'skip' | 'bill') => {
      if (kind === 'pause') return mutate(SUBSCRIPTION_CONTRACT_PAUSE, { id: c.id }, 'subscriptionContractPause');
      if (kind === 'resume') return mutate(SUBSCRIPTION_CONTRACT_ACTIVATE, { id: c.id }, 'subscriptionContractActivate');
      if (kind === 'cancel') return mutate(SUBSCRIPTION_CONTRACT_CANCEL, { id: c.id }, 'subscriptionContractCancel');
      if (kind === 'skip') return mutate(SUBSCRIPTION_BILLING_CYCLE_SKIP, { input: { contractId: c.id, selector: { index: c.shopmeCyclesCompleted + 1 } } }, 'subscriptionBillingCycleSkip');
      return mutate<{ subscriptionBillingAttempt: { errorCode: string | null; errorMessage: string | null; order: { name: string } | null } }>(SUBSCRIPTION_BILLING_ATTEMPT_CREATE, { id: c.id, input: { idempotencyKey: `admin-${Date.now()}` } }, 'subscriptionBillingAttemptCreate');
    },
    onSuccess: (r, kind) => {
      setConfirm(null);
      refresh();
      if (kind === 'bill') {
        const a = (r as { subscriptionBillingAttempt: { errorMessage: string | null; order: { name: string } | null } | null }).subscriptionBillingAttempt;
        if (a?.order) toast(t('sub.toast.billed', { name: a.order.name })); else toast(t('sub.toast.billFailed', { error: a?.errorMessage ?? '' }), 'critical');
        void qc.invalidateQueries({ queryKey: ['orders'] });
        return;
      }
      toast(t(({ pause: 'sub.toast.paused', resume: 'sub.toast.resumed', cancel: 'sub.toast.cancelled', skip: 'sub.toast.skipped' } as const)[kind]));
    },
    onError: (e) => { setConfirm(null); toast(errText(e), 'critical'); },
  });
  const ended = c.status === 'CANCELLED' || c.status === 'EXPIRED';
  const nextAfterSkip = (() => {
    if (!c.nextBillingDate) return '';
    const d = new Date(c.nextBillingDate);
    const n = c.billingPolicy.intervalCount;
    if (c.billingPolicy.interval === 'DAY') d.setUTCDate(d.getUTCDate() + n);
    else if (c.billingPolicy.interval === 'WEEK') d.setUTCDate(d.getUTCDate() + 7 * n);
    else if (c.billingPolicy.interval === 'MONTH') d.setUTCMonth(d.getUTCMonth() + n);
    else d.setUTCFullYear(d.getUTCFullYear() + n);
    return fmt.date(d.toISOString());
  })();
  const gatewayLabel = (g: string) => (['stripe', 'bank_transfer', 'cod', 'test', 'free'].includes(g) ? t(`sub.gateway.${g}` as Key) : g.replace(/^(manual|redirect):/, ''));
  const more = [
    ...(c.status === 'ACTIVE' ? [{ key: 'skip', icon: <SkipForward className="size-4" />, label: t('sub.action.skip'), onSelect: () => setConfirm('skip') }, { key: 'bill', icon: <Zap className="size-4" />, label: t('sub.action.billNow'), onSelect: () => setConfirm('bill') }] : []),
    ...(!ended ? [{ key: 'cancel', icon: <XCircle className="size-4" />, label: t('sub.action.cancel'), danger: true, separatorBefore: c.status === 'ACTIVE', onSelect: () => setConfirm('cancel') }] : []),
  ];
  const subtotal = c.lines.nodes.reduce((n, l) => n + Number(l.lineDiscountedPrice.amount), 0);
  const days = groupEvents(c.shopmeEvents.nodes, lang);
  const addr = c.deliveryMethod?.address;
  const addressLines = addr ? [addr.name, addr.address1, addr.address2, [addr.zip, addr.city].filter(Boolean).join(' '), addr.province, addr.country, addr.phone].filter(Boolean) as string[] : [];

  return (
    <>
      <PageHeader large back="/orders/subscriptions" breadcrumb={{ icon: <Repeat className="size-4" />, label: t('nav.subscriptions'), to: '/orders/subscriptions' }}
        title={t('sub.name', { name })} badges={<SubscriptionBadge status={c.status} />} subtitle={t('sub.since', { date: fmt.date(c.createdAt) })} more={more}
        actions={<>
          {c.status === 'ACTIVE' && <Button loading={act.isPending && act.variables === 'pause'} onClick={() => act.mutate('pause')}><Pause className="size-4" />{t('sub.action.pause')}</Button>}
          {(c.status === 'PAUSED' || c.status === 'FAILED') && <Button variant="primary" loading={act.isPending && act.variables === 'resume'} onClick={() => act.mutate('resume')}><Play className="size-4" />{t('sub.action.resume')}</Button>}
        </>} />
      {c.status === 'FAILED' && <div className="mb-4"><Banner>{t('sub.failedBanner')}</Banner></div>}
      {c.status === 'PAUSED' && <div className="mb-4"><Banner tone="warning">{t('sub.pausedBanner')}</Banner></div>}
      <div className="grid gap-x-6 gap-y-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title={t('sub.products')}>
            <ul className="divide-y divide-line">
              {c.lines.nodes.map((l) => {
                const later = l.pricingPolicy?.cycleDiscounts.find((d) => d.afterCycle > 0);
                return (
                  <li key={l.id} className="flex items-start gap-3 py-3 text-[13px] first:pt-0">
                    {l.variantImage?.url ? <img src={l.variantImage.url} alt="" className="size-10 shrink-0 rounded-md border border-line object-cover" /> : <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-md border border-line text-muted"><Repeat className="size-4" /></span>}
                    <div className="min-w-0 flex-1">
                      {l.productId ? <Link to={`/products/${gidToNum(l.productId)}`} className="font-medium hover:underline">{l.title}</Link> : <span className="font-medium">{l.title}</span>}
                      {l.variantTitle && <p className="text-muted">{l.variantTitle}</p>}
                      {l.sellingPlanName && <p className="mt-1 inline-flex items-center gap-1 rounded-md bg-surface px-2 py-0.5 text-xs"><Repeat className="size-3" />{l.sellingPlanName}</p>}
                      {later && <p className="mt-1 text-xs text-muted">{t('sub.priceFrom', { n: later.afterCycle + 1, price: fmt.money(later.computedPrice) })}</p>}
                    </div>
                    <span className="whitespace-nowrap text-muted">{fmt.money(l.currentPrice)} × {l.quantity}</span>
                    <span className="w-20 whitespace-nowrap text-right font-medium">{fmt.money(l.lineDiscountedPrice)}</span>
                  </li>
                );
              })}
            </ul>
            <dl className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3 text-[13px]">
              <div className="flex justify-between gap-3"><dt>{t('sub.subtotal')}</dt><dd>{fmt.money({ amount: String(subtotal), currencyCode: c.currencyCode })}</dd></div>
              {c.shopmeDiscounts.map((d, i) => (
                <div key={i} className="flex justify-between gap-3"><dt className="min-w-0">{t('sub.kept')}: {d.code ?? d.title} <span className="text-muted">({d.remainingCycles == null ? t('sub.remainingAll') : t('sub.remaining', { n: d.remainingCycles })})</span></dt><dd className="whitespace-nowrap">{d.percentage != null ? `-${d.percentage}%` : d.amount ? `-${fmt.money(d.amount)}` : ''}</dd></div>
              ))}
              {c.deliveryMethod && <div className="flex justify-between gap-3"><dt>{t('sub.deliveryPrice')} <span className="text-muted">({c.deliveryMethod.shippingOption.title})</span></dt><dd>{fmt.money(c.deliveryPrice)}</dd></div>}
              {c.shopmeNextOrderTotal && <div className="flex justify-between gap-3 font-semibold"><dt>{t('sub.nextTotal')}</dt><dd>{fmt.money(c.shopmeNextOrderTotal)}</dd></div>}
            </dl>
          </Card>

          <Card title={t('sub.billing')}>
            <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
              <div><dt className="text-muted">{t('sub.nextOrder')}</dt><dd className="mt-0.5 flex items-center gap-1.5 font-medium"><CalendarClock className="size-4 text-muted" />
                {ended ? (c.shopmeCancelledAt ? t('sub.cancelledOn', { date: fmt.date(c.shopmeCancelledAt) }) : t('sub.endedNote')) : c.status === 'PAUSED' ? t('sub.pausedSince', { date: fmt.date(c.shopmePausedAt) }) : fmt.date(c.nextBillingDate)}</dd></div>
              <div><dt className="text-muted">{t('sub.frequency')}</dt><dd className="mt-0.5 font-medium">{everyLabel(t, c.billingPolicy)}</dd></div>
              <div><dt className="text-muted">{t('sub.cycles')}</dt><dd className="mt-0.5 font-medium">{c.billingPolicy.maxCycles ? t('sub.cyclesOf', { n: c.shopmeCyclesCompleted, max: c.billingPolicy.maxCycles }) : c.shopmeCyclesCompleted}</dd></div>
              <div><dt className="text-muted">{t('sub.lastPayment')}</dt><dd className="mt-0.5 font-medium">{c.lastPaymentStatus ? <Badge tone={c.lastPaymentStatus === 'SUCCEEDED' ? 'success' : 'critical'}>{t(`sub.lastPayment.${c.lastPaymentStatus}` as Key)}</Badge> : <span className="text-muted">{t('sub.lastPayment.none')}</span>}</dd></div>
            </dl>
            {c.shopmeFailedAttempts > 0 && c.status === 'ACTIVE' && c.shopmeRetryAt && (
              <p className="mt-3 rounded-lg bg-surface px-3 py-2 text-[13px]">{t('sub.retry', { n: c.shopmeFailedAttempts, error: c.billingAttempts.nodes.find((a) => a.errorMessage)?.errorMessage ?? c.lastBillingAttemptErrorType ?? '', date: fmt.dateTime(c.shopmeRetryAt) })}</p>
            )}
          </Card>

          <Card title={t('sub.orders')}>
            {c.orders.nodes.length === 0 ? <p className="text-[13px] text-muted">{t('sub.noOrders')}</p> : (
              <ul className="divide-y divide-line text-[13px]">
                {c.orders.nodes.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-2 py-2 first:pt-0 last:pb-0">
                    <Link to={`/orders/${gidToNum(o.id)}`} className="font-medium hover:underline">{o.name}</Link>
                    <span className="text-xs text-muted">{o.id === c.originOrder?.id ? t('sub.firstOrder') : t('sub.renewal')}</span>
                    <span className="flex flex-wrap gap-1"><FinancialBadge status={o.displayFinancialStatus} /><FulfillmentBadge status={o.displayFulfillmentStatus} /></span>
                    <span className="ml-auto text-muted">{fmt.date(o.createdAt)}</span>
                    <span className="w-20 text-right">{fmt.money(o.totalPriceSet.shopMoney)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <section aria-labelledby="sub-history">
            <h2 id="sub-history" className="mb-3 text-[15px] font-semibold">{t('sub.history')}</h2>
            {days.length === 0 ? <p className="text-[13px] text-muted">{t('sub.ev.empty')}</p> : (
              <ol className="relative ml-3 border-l border-line pl-5">
                {days.map(([day, evs]) => (
                  <li key={day} className="pb-4 last:pb-0">
                    <p className="mb-2 text-xs font-medium text-muted">{day}</p>
                    <ul className="flex flex-col gap-2.5">
                      {evs.map((e, i) => (
                        <li key={e.id ?? `${day}-${i}`} className="relative flex items-start justify-between gap-3 text-[13px]">
                          <span aria-hidden className="absolute -left-[27px] top-1.5 size-2.5 rounded-full border-2 border-canvas bg-muted" />
                          <span className="min-w-0">{eventText(t, (iso) => fmt.date(iso), e)}</span>
                          <time className="shrink-0 text-xs text-muted" dateTime={e.createdAt}>{new Intl.DateTimeFormat(lang, { timeStyle: 'short' }).format(new Date(e.createdAt))}</time>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside className="flex flex-col gap-4">
          <Card title={t('sub.customer')}>
            {c.customer ? (
              <div className="flex flex-col gap-0.5 text-[13px]">
                <Link to={`/customers/${gidToNum(c.customer.id)}`} className="text-accent hover:underline">{c.customer.displayName}</Link>
                {c.customer.email && <a className="truncate text-accent hover:underline" href={`mailto:${c.customer.email}`}>{c.customer.email}</a>}
                {c.customer.phone && <span className="text-muted">{c.customer.phone}</span>}
              </div>
            ) : <p className="text-[13px] text-muted">—</p>}
          </Card>
          <Card title={t('sub.delivery')}>
            <div className="flex flex-col gap-1 text-[13px]">
              {addressLines.length ? addressLines.map((x, i) => <span key={i}>{x}</span>) : <span className="text-muted">{t('sub.noAddress')}</span>}
              {c.deliveryMethod && <span className="mt-1 text-muted">{c.deliveryMethod.shippingOption.title} · {everyLabel(t, c.deliveryPolicy)}</span>}
            </div>
          </Card>
          <Card title={t('sub.payment')}>
            <div className="flex flex-col gap-1 text-[13px]">
              <span className="flex items-center gap-1.5 font-medium"><CreditCard className="size-4 text-muted" />{c.shopmePaymentGateway === 'stripe' ? t(c.shopmeHasSavedPaymentMethod ? 'sub.payment.card' : 'sub.payment.cardMissing') : gatewayLabel(c.shopmePaymentGateway)}</span>
              {c.shopmePaymentGateway !== 'stripe' && c.shopmePaymentGateway !== 'test' && <span className="text-xs text-muted">{t('sub.payment.manualNote')}</span>}
            </div>
          </Card>
          {c.originOrder && (() => {
            const [before, after] = t('sub.startedWith', { name: '\u0000' }).split('\u0000');
            return <p className="px-1 text-[13px] text-muted">{before}<Link to={`/orders/${gidToNum(c.originOrder.id)}`} className="text-accent hover:underline">{c.originOrder.name}</Link>{after}</p>;
          })()}
        </aside>
      </div>

      <ConfirmDialog open={confirm === 'cancel'} danger title={t('sub.confirm.cancelTitle')} message={t('sub.confirm.cancelBody')} confirmLabel={t('sub.action.cancel')} cancelLabel={t('sub.confirm.keep')} closeLabel={t('common.close')}
        loading={act.isPending} onClose={() => setConfirm(null)} onConfirm={() => act.mutate('cancel')} />
      <ConfirmDialog open={confirm === 'skip'} title={t('sub.confirm.skipTitle')} message={t('sub.confirm.skipBody', { date: fmt.date(c.nextBillingDate), next: nextAfterSkip })} confirmLabel={t('sub.action.skip')} cancelLabel={t('common.cancel')} closeLabel={t('common.close')}
        loading={act.isPending} onClose={() => setConfirm(null)} onConfirm={() => act.mutate('skip')} />
      <ConfirmDialog open={confirm === 'bill'} title={t('sub.confirm.billTitle')} message={t('sub.confirm.billBody')} confirmLabel={t('sub.action.billNow')} cancelLabel={t('common.cancel')} closeLabel={t('common.close')}
        loading={act.isPending} onClose={() => setConfirm(null)} onConfirm={() => act.mutate('bill')} />
    </>
  );
}

/** Events newest first, grouped by day label. */
function groupEvents<E extends { createdAt: string }>(events: E[], lang: string): Array<[string, E[]]> {
  const sorted = [...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const out = new Map<string, E[]>();
  const f = new Intl.DateTimeFormat(lang, { dateStyle: 'long' });
  for (const e of sorted) { const k = f.format(new Date(e.createdAt)); out.set(k, [...(out.get(k) ?? []), e]); }
  return [...out];
}
