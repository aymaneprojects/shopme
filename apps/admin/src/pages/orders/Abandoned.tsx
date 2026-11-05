import { Badge, Banner, Button, Card, EmptyState, IndexTable, Pagination, Select, Skeleton, Switch, useToast } from '@shopme/ui';
import type { Column } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Search, ShoppingCart } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { gql, mutate } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { AddressBlock, searchCls, useFormat, useListParams } from '../../components/shared';
import type { Money, MoneySet } from '../../components/shared';
import { gidToNum, numToGid } from '../../format';
import { ABANDONED_CHECKOUT, ABANDONED_CHECKOUTS, ABANDONED_SEND_EMAIL, ABANDONED_SETTINGS, ABANDONED_SETTINGS_UPDATE } from '../../graphql';
import { useT } from '../../i18n';
import { useDebounced } from '../../lib/hooks';
import type { Connection } from '../../lib/hooks';
import { Thumb } from '../Products';

interface Row {
  id: string; name: string; createdAt: string; updatedAt: string; lineItemsQuantity: number; shopmeEmail: string | null; shopmeRecoveryEmailsSent: number; shopmeRecoveryEmailSentAt: string | null;
  customer: { id: string; displayName: string; defaultEmailAddress: { emailAddress: string } | null } | null; totalPriceSet: MoneySet;
}
interface Detail extends Omit<Row, 'lineItemsQuantity'> {
  abandonedCheckoutUrl: string; discountCodes: string[]; taxesIncluded: boolean;
  shippingAddress: Parameters<typeof AddressBlock>[0]['a'];
  lineItems: { nodes: Array<{ id: string; title: string | null; variantTitle: string | null; sku: string | null; quantity: number; image: { url: string } | null; originalUnitPriceSet: MoneySet; discountedTotalPriceSet: MoneySet }> };
  totalLineItemsPriceSet: MoneySet; totalDiscountSet: MoneySet; totalTaxSet: MoneySet | null; totalPriceSet: MoneySet;
}
const PAGE_SIZE = 25;
const DELAYS = [1, 6, 10, 24];

function RecoverySettings() {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['abandoned-settings'], queryFn: () => gql<{ shopmeAbandonedCheckoutSettings: { enabled: boolean; delayHours: number } }>(ABANDONED_SETTINGS) });
  const save = useMutation({
    mutationFn: (v: { enabled?: boolean; delayHours?: number }) => mutate(ABANDONED_SETTINGS_UPDATE, v, 'shopmeAbandonedCheckoutSettingsUpdate'),
    onSuccess: () => { toast(t('abandoned.settingsSaved')); void qc.invalidateQueries({ queryKey: ['abandoned-settings'] }); void qc.invalidateQueries({ queryKey: ['abandoned'] }); }, onError: (e) => toast(e.message, 'critical'),
  });
  const s = q.data?.shopmeAbandonedCheckoutSettings;
  return (
    <Card title={t('abandoned.settings')}>
      {q.error ? <Banner>{q.error.message}</Banner> : (
        <div className="flex flex-wrap items-end gap-6">
          <Switch checked={save.isPending && save.variables?.enabled !== undefined ? !!save.variables.enabled : !!s?.enabled} onChange={(v) => save.mutate({ enabled: v })} label={t('abandoned.autoSend')} />
          <Select label={t('abandoned.delay')} value={String(s?.delayHours ?? 10)} onChange={(e) => save.mutate({ delayHours: Number(e.target.value) })}>
            {DELAYS.map((h) => <option key={h} value={h}>{t('abandoned.hours', { n: h })}</option>)}
          </Select>
          <p className="max-w-md text-xs text-muted">{t('abandoned.settingsHelp')}</p>
        </div>
      )}
    </Card>
  );
}

const emailOf = (r: { shopmeEmail: string | null; customer: Row['customer'] }) => r.shopmeEmail ?? r.customer?.defaultEmailAddress?.emailAddress ?? '—';

export function AbandonedPage() {
  const t = useT();
  const nav = useNavigate();
  const fmt = useFormat();
  const L = useListParams();
  const [search, setSearch] = useState(L.get('q'));
  const term = useDebounced(search);
  const list = useQuery({
    queryKey: ['abandoned', term, L.get('after'), L.get('before')],
    queryFn: () => gql<{ abandonedCheckouts: Connection<Row> }>(ABANDONED_CHECKOUTS, { query: term.trim() ? `email:${term.trim()}*` : null, reverse: true, ...L.page(PAGE_SIZE) }),
    placeholderData: (p) => p,
  });
  const rows = list.data?.abandonedCheckouts.nodes ?? [];
  const pi = list.data?.abandonedCheckouts.pageInfo;
  const columns: Array<Column<Row>> = [
    { key: 'name', header: t('abandoned.checkout'), cell: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'date', header: t('abandoned.date'), cell: (r) => <span className="text-muted">{fmt.dateTime(r.updatedAt)}</span> },
    { key: 'customer', header: t('order.customer'), cell: (r) => <div><p>{r.customer?.displayName ?? emailOf(r)}</p>{r.customer && <p className="text-xs text-muted">{emailOf(r)}</p>}</div> },
    { key: 'items', header: t('abandoned.items'), cell: (r) => r.lineItemsQuantity },
    { key: 'total', header: t('order.total'), cell: (r) => fmt.money(r.totalPriceSet) },
    { key: 'recovery', header: t('abandoned.recovery'), cell: (r) => (r.shopmeRecoveryEmailsSent ? <Badge tone="info">{t('abandoned.emailSent')}</Badge> : <Badge>{t('abandoned.notSent')}</Badge>) },
  ];
  return (
    <>
      <PageHeader back="/orders" title={t('nav.abandoned')} />
      <div className="mb-4"><RecoverySettings /></div>
      <Card className="!p-0">
        <div className="border-b border-line p-3">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
            <input type="search" value={search} onChange={(e) => { setSearch(e.target.value); L.patch({ q: e.target.value }); }} placeholder={t('abandoned.search')} aria-label={t('abandoned.search')} className={searchCls} />
          </div>
        </div>
        {list.isError && <div className="p-3"><Banner>{(list.error as Error).message}</Banner></div>}
        <IndexTable rows={rows} rowId={(r) => r.id} columns={columns} loading={list.isLoading} onRowClick={(r) => nav(`/orders/abandoned/${gidToNum(r.id)}`)}
          selected={[]} onSelectedChange={() => {}} selectedLabel={(n) => t('common.selected', { n })} selectAllLabel={t('common.selectAll')}
          empty={list.isError ? null : term ? <EmptyState icon={<Search className="size-10" />} title={t('products.noResults')} description={t('products.noResultsBody')} />
            : <EmptyState icon={<ShoppingCart className="size-10" />} title={t('abandoned.emptyTitle')} description={t('abandoned.emptyBody')} />} />
        <Pagination hasPrevious={L.get('before') ? !!pi?.hasPreviousPage : !!L.get('after')} hasNext={L.get('before') ? true : !!pi?.hasNextPage}
          previousLabel={t('common.previous')} nextLabel={t('common.next')}
          onPrevious={() => L.patch({ before: pi?.startCursor ?? '', after: '' }, true)} onNext={() => L.patch({ after: pi?.endCursor ?? '', before: '' }, true)} />
      </Card>
    </>
  );
}

export function AbandonedDetailPage() {
  const { id = '' } = useParams();
  const t = useT();
  const gid = numToGid('AbandonedCheckout', id);
  const q = useQuery({ queryKey: ['abandoned-detail', gid], queryFn: () => gql<{ node: Detail | null }>(ABANDONED_CHECKOUT, { id: gid }) });
  if (q.isLoading) return <div className="grid gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64" /></div>;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  if (!q.data?.node) return <Banner>{t('abandoned.notFound')}</Banner>;
  return <DetailView key={q.dataUpdatedAt} c={q.data.node} />;
}

function DetailView({ c }: { c: Detail }) {
  const t = useT();
  const fmt = useFormat();
  const toast = useToast();
  const qc = useQueryClient();
  const send = useMutation({
    mutationFn: () => mutate(ABANDONED_SEND_EMAIL, { id: c.id }, 'shopmeAbandonedCheckoutRecoveryEmailSend'),
    onSuccess: () => { toast(t('abandoned.sent')); void qc.invalidateQueries({ queryKey: ['abandoned-detail'] }); void qc.invalidateQueries({ queryKey: ['abandoned'] }); }, onError: (e) => toast(e.message, 'critical'),
  });
  const copy = () => { void navigator.clipboard?.writeText(c.abandonedCheckoutUrl).then(() => toast(t('abandoned.copied'))); };
  const cur = c.totalPriceSet.shopMoney.currencyCode;
  const row = (label: string, m: Money | MoneySet | null, strong = false) => m && <><dt className={strong ? 'font-semibold' : 'text-muted'}>{label}</dt><dd className={strong ? 'text-right font-semibold' : 'text-right'}>{fmt.money(m)}</dd></>;
  const email = emailOf(c);
  return (
    <>
      <PageHeader back="/orders/abandoned" title={<span className="flex items-center gap-2">{c.name}{c.shopmeRecoveryEmailsSent > 0 && <Badge tone="info">{t('abandoned.emailSent')}</Badge>}</span>}
        actions={<Button variant="primary" loading={send.isPending} disabled={email === '—'} onClick={() => send.mutate()}>{c.shopmeRecoveryEmailsSent ? t('abandoned.resend') : t('abandoned.sendEmail')}</Button>} />
      <p className="-mt-3 mb-4 text-[13px] text-muted">{t('abandoned.lastActivity', { date: fmt.dateTime(c.updatedAt) })}</p>
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-4">
          <Card title={t('order.items')}>
            <ul className="divide-y divide-line">
              {c.lineItems.nodes.map((l) => (
                <li key={l.id} className="flex items-center gap-3 py-2 text-[13px]">
                  <Thumb url={l.image?.url} />
                  <div className="min-w-0 flex-1"><p className="font-medium">{l.title}</p><p className="text-xs text-muted">{[l.variantTitle, l.sku].filter(Boolean).join(' · ')}</p></div>
                  <span className="text-muted">{fmt.money(l.originalUnitPriceSet)} × {l.quantity}</span>
                  <span className="w-24 text-right">{fmt.money(l.discountedTotalPriceSet)}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title={t('order.payment')}>
            <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-[13px]">
              {row(t('order.subtotal'), c.totalLineItemsPriceSet)}
              {Number(c.totalDiscountSet.shopMoney.amount) > 0 && row(t('order.discount'), { amount: `-${c.totalDiscountSet.shopMoney.amount}`, currencyCode: cur })}
              {row(t('order.taxes'), c.totalTaxSet)}
              {row(t('order.total'), c.totalPriceSet, true)}
            </dl>
            {c.discountCodes.length > 0 && <p className="mt-2 text-xs text-muted">{t('order.discountCodes')}: {c.discountCodes.join(', ')}</p>}
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card title={t('order.customer')}><div className="text-[13px]"><p className="font-medium">{c.customer?.displayName ?? email}</p>{c.customer && <p className="text-muted">{email}</p>}</div></Card>
          <Card title={t('order.shippingAddress')}><AddressBlock a={c.shippingAddress} /></Card>
          <Card title={t('abandoned.recoveryLink')}>
            <p className="break-all text-xs text-muted">{c.abandonedCheckoutUrl}</p>
            <div className="mt-2 flex items-center justify-between gap-2"><Button size="sm" onClick={copy}><Copy className="size-4" />{t('abandoned.copy')}</Button>
              <span className="text-xs text-muted">{c.shopmeRecoveryEmailSentAt ? t('abandoned.lastEmail', { date: fmt.dateTime(c.shopmeRecoveryEmailSentAt) }) : t('abandoned.notSent')}</span></div>
          </Card>
        </div>
      </div>
    </>
  );
}
