import { Badge, Banner, Button, ButtonGroup, Card, Dropdown, Skeleton, TagInput, Textarea, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Ban, ChevronDown, ChevronUp, Copy, CornerUpLeft, MapPin, MoreHorizontal, Truck, User } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { gql, mutate } from '../api';
import { AddressBlock, FinancialBadge, FulfillmentBadge, useFormat } from '../components/shared';
import type { Money, MoneySet } from '../components/shared';
import { PageHeader } from '../components/PageHeader';
import { gidToNum, numToGid } from '../format';
import { ORDER, ORDERS, ORDER_CLOSE, ORDER_MARK_AS_PAID, ORDER_OPEN, ORDER_TIMELINE_COMMENT_CREATE, ORDER_UPDATE, TAGS_ADD, TAGS_REMOVE } from '../graphql';
import { useT } from '../i18n';
import { toCents } from '../lib/refund';
import { MetafieldsEditor } from '../components/MetafieldsEditor';
import { IssuedGiftCardsCard } from '../components/IssuedGiftCards';
import { AddressDialog, CancelDialog, FulfillDialog } from './orders/OrderDialogs';
import { ReturnDialog, ReturnsCard } from './orders/Returns';
import type { OrderLine } from './orders/OrderDialogs';
import { Thumb } from './Products';

type Addr = Parameters<typeof AddressBlock>[0]['a'];
interface OrderData {
  id: string; name: string; createdAt: string; email: string | null; note: string | null; tags: string[]; cancelledAt: string | null; closedAt: string | null;
  displayFinancialStatus: string; displayFulfillmentStatus: string;
  lineItems: { nodes: OrderLine[] };
  subtotalPriceSet: MoneySet; totalShippingPriceSet: MoneySet; totalTaxSet: MoneySet; totalDiscountsSet: MoneySet; totalPriceSet: MoneySet; totalRefundedSet: MoneySet;
  shippingAddress: Addr; billingAddress: Addr;
  shippingLines: { nodes: Array<{ title: string; originalPriceSet: MoneySet }> };
  discountApplications: { nodes: Array<{ __typename: string; code?: string }> };
  transactions: Array<{ id: string; kind: string; status: string; gateway: string; createdAt: string; amountSet: MoneySet }>;
  fulfillments: Array<{ id: string; status: string; createdAt: string; trackingInfo: Array<{ company: string | null; number: string | null; url: string | null }> }>;
  refunds: Array<{ id: string; createdAt: string; note: string | null; totalRefundedSet: MoneySet }>;
  customer: { id: string; displayName: string; defaultEmailAddress: { emailAddress: string } | null; numberOfOrders: number } | null;
  events: { nodes: Array<{ id: string; message: string; createdAt: string }> };
}

export function OrderDetailPage() {
  const { id = '' } = useParams();
  const t = useT();
  const gid = numToGid('Order', id);
  const q = useQuery({ queryKey: ['order', gid], queryFn: () => gql<{ order: OrderData | null }>(ORDER, { id: gid }) });
  if (q.isLoading) return <div className="grid gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64" /></div>;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  if (!q.data?.order) return <Banner>{t('order.notFound')}</Banner>;
  return <OrderView key={q.dataUpdatedAt} order={q.data.order} />;
}

function OrderView({ order: o }: { order: OrderData }) {
  const t = useT();
  const fmt = useFormat();
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [dialog, setDialog] = useState<'fulfill' | 'cancel' | 'return' | 'address' | null>(null);
  const [note, setNote] = useState(o.note ?? '');
  const [comment, setComment] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['order'] }).then(() => qc.invalidateQueries({ queryKey: ['orders'] }));
  const fail = (e: Error) => toast(e.message, 'critical');

  const act = useMutation({
    mutationFn: async (a: 'close' | 'open' | 'paid') => {
      if (a === 'close') await mutate(ORDER_CLOSE, { input: { id: o.id } }, 'orderClose');
      else if (a === 'open') await mutate(ORDER_OPEN, { input: { id: o.id } }, 'orderOpen');
      else await mutate(ORDER_MARK_AS_PAID, { input: { id: o.id } }, 'orderMarkAsPaid');
    },
    onSuccess: () => { toast(t('order.updated')); void refresh(); }, onError: fail,
  });
  const saveNote = useMutation({ mutationFn: () => mutate(ORDER_UPDATE, { input: { id: o.id, note } }, 'orderUpdate'), onSuccess: () => { toast(t('order.updated')); void refresh(); }, onError: fail });
  const post = useMutation({
    mutationFn: () => mutate(ORDER_TIMELINE_COMMENT_CREATE, { id: o.id, message: comment.trim() }, 'orderTimelineCommentCreate'),
    onSuccess: () => { setComment(''); void refresh(); }, onError: fail,
  });
  const tags = useMutation({
    mutationFn: async (next: string[]) => {
      const add = next.filter((x) => !o.tags.includes(x)), remove = o.tags.filter((x) => !next.includes(x));
      if (add.length) await mutate(TAGS_ADD, { id: o.id, tags: add }, 'tagsAdd');
      if (remove.length) await mutate(TAGS_REMOVE, { id: o.id, tags: remove }, 'tagsRemove');
    },
    onSuccess: () => void refresh(), onError: fail,
  });

  const lines = o.lineItems.nodes;
  const unfulfilled = lines.filter((l) => l.unfulfilledQuantity > 0);
  const cur = o.totalPriceSet.shopMoney.currencyCode;
  const paidCents = o.transactions.filter((x) => x.status === 'SUCCESS' && (x.kind === 'SALE' || x.kind === 'CAPTURE')).reduce((s, x) => s + toCents(x.amountSet.shopMoney.amount), 0);
  const refundedCents = toCents(o.totalRefundedSet.shopMoney.amount);
  const refundableCents = Math.max(0, paidCents - refundedCents);
  const canMarkPaid = ['PENDING', 'AUTHORIZED', 'PARTIALLY_PAID'].includes(o.displayFinancialStatus) && !o.cancelledAt;
  const canRefund = refundableCents > 0 && !o.cancelledAt;
  const isClosed = !!o.closedAt;
  const row = (label: string, m: Money | MoneySet, strong = false) => <><dt className={strong ? 'font-semibold' : 'text-muted'}>{label}</dt><dd className={strong ? 'text-right font-semibold' : 'text-right'}>{fmt.money(m)}</dd></>;
  const events = [...o.events.nodes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <>
      <PageHeader back="/orders" title={<span className="flex flex-wrap items-center gap-2">{o.name}<FinancialBadge status={o.displayFinancialStatus} /><FulfillmentBadge status={o.displayFulfillmentStatus} />{o.cancelledAt && <Badge tone="critical">{t('order.cancelledBadge')}</Badge>}{isClosed && !o.cancelledAt && <Badge>{t('order.archived')}</Badge>}</span>}
        actions={<>
          <Button disabled={!canRefund} onClick={() => nav(`/orders/${gidToNum(o.id)}/refund`)}>{t('order.refund')}</Button>
          <Button disabled={!!o.cancelledAt} onClick={() => nav(`/orders/${gidToNum(o.id)}/edit`)}>{t('order.edit')}</Button>
          <Dropdown align="right" chevron label={t('common.moreActions')} trigger={t('common.moreActions')} items={[
            { key: 'return', icon: <CornerUpLeft />, label: t('returns.createTitle'), disabled: !!o.cancelledAt || !lines.some((l) => l.quantity > l.unfulfilledQuantity), onSelect: () => setDialog('return') },
            { key: 'close', icon: isClosed ? <ArchiveRestore /> : <Archive />, label: isClosed ? t('order.reopen') : t('order.archive'), onSelect: () => act.mutate(isClosed ? 'open' : 'close') },
            { key: 'cancel', icon: <Ban />, label: t('order.cancel'), danger: true, disabled: !!o.cancelledAt, onSelect: () => setDialog('cancel') },
          ]} />
          <OrderNeighbours id={o.id} />
        </>} />
      <p className="-mt-3 mb-4 text-[13px] text-muted">{fmt.dateTime(o.createdAt)}</p>
      {o.cancelledAt && <div className="mb-4"><Banner tone="warning">{t('order.cancelledOn', { date: fmt.dateTime(o.cancelledAt) })}</Banner></div>}
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-4">
          {unfulfilled.length > 0 && (
            <Card title={<span className="flex items-center gap-2"><Badge tone="warning">{t('ful.UNFULFILLED')}</Badge>{t('order.itemsCount', { n: unfulfilled.reduce((s, l) => s + l.unfulfilledQuantity, 0) })}</span>}
              actions={!o.cancelledAt && <Button variant="primary" size="sm" onClick={() => setDialog('fulfill')}>{t('order.markFulfilled')}</Button>}>
              <LineList lines={unfulfilled} qty={(l) => l.unfulfilledQuantity} />
              {o.shippingLines.nodes[0] && <p className="mt-2 text-xs text-muted">{t('order.shippingMethod')}: {o.shippingLines.nodes[0].title}</p>}
            </Card>
          )}
          {o.fulfillments.map((f) => (
            <Card key={f.id} title={<span className="flex items-center gap-2"><Badge tone="success">{t('ful.FULFILLED')}</Badge>{fmt.date(f.createdAt)}</span>}>
              {f.trackingInfo.length === 0 ? <p className="text-[13px] text-muted">{t('order.noTracking')}</p> : f.trackingInfo.map((tr, i) => (
                <p key={i} className="flex items-center gap-2 text-[13px]"><Truck className="size-4 text-muted" />{tr.company}{' '}{tr.url ? <a href={tr.url} target="_blank" rel="noreferrer" className="text-accent underline">{tr.number}</a> : tr.number}</p>
              ))}
            </Card>
          ))}
          {unfulfilled.length === 0 && o.fulfillments.length === 0 && <Card title={t('order.items')}><LineList lines={lines} qty={(l) => l.quantity} /></Card>}

          <ReturnsCard orderId={o.id} />
          <IssuedGiftCardsCard orderId={o.id} />

          <Card title={<span className="flex items-center gap-2"><FinancialBadge status={o.displayFinancialStatus} />{t('order.payment')}</span>}
            actions={<span className="flex gap-2">{canMarkPaid && <Button size="sm" variant="primary" loading={act.isPending} onClick={() => act.mutate('paid')}>{t('order.markPaid')}</Button>}</span>}>
            <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-[13px]">
              <dt className="flex gap-6"><span className="text-muted">{t('order.subtotal')}</span><span>{t('order.itemsCount', { n: lines.reduce((n, l) => n + l.quantity, 0) })}</span></dt><dd className="text-right">{fmt.money(o.subtotalPriceSet)}</dd>
              {toCents(o.totalDiscountsSet.shopMoney.amount) > 0 && <>{row(t('order.discount'), { amount: `-${o.totalDiscountsSet.shopMoney.amount}`, currencyCode: cur })}</>}
              {row(t('order.shipping'), o.totalShippingPriceSet)}
              {row(t('order.taxes'), o.totalTaxSet)}
              {row(t('order.total'), o.totalPriceSet, true)}
              {row(t('order.paid'), { amount: (paidCents / 100).toFixed(2), currencyCode: cur })}
              {refundedCents > 0 && row(t('order.refunded'), o.totalRefundedSet)}
            </dl>
            {o.discountApplications.nodes.some((d) => d.code) && <p className="mt-2 text-xs text-muted">{t('order.discountCodes')}: {o.discountApplications.nodes.map((d) => d.code).filter(Boolean).join(', ')}</p>}
          </Card>

          <Card title={t('order.timeline')}>
            <div className="mb-4 flex flex-col gap-2">
              <Textarea aria-label={t('order.comment')} placeholder={t('order.commentPlaceholder')} value={comment} onChange={(e) => setComment(e.target.value)} />
              <div className="flex justify-end"><Button size="sm" variant="primary" disabled={!comment.trim()} loading={post.isPending} onClick={() => post.mutate()}>{t('order.postComment')}</Button></div>
            </div>
            <ol className="flex flex-col gap-3 border-l border-line pl-4">
              {events.map((e) => <li key={e.id} className="text-[13px]"><p>{e.message}</p><p className="text-xs text-muted">{fmt.dateTime(e.createdAt)}</p></li>)}
              {events.length === 0 && <li className="text-[13px] text-muted">{t('order.noEvents')}</li>}
            </ol>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card title={t('order.notes')}>
            <Textarea aria-label={t('order.notes')} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('order.notesPlaceholder')} />
            <div className="mt-2 flex justify-end"><Button size="sm" disabled={note === (o.note ?? '')} loading={saveNote.isPending} onClick={() => saveNote.mutate()}>{t('save.save')}</Button></div>
          </Card>
          <Card title={t('order.customer')} actions={o.customer && <Dropdown align="right" variant="plain" size="sm" icon label={t('common.moreActions')} trigger={<MoreHorizontal className="size-4" />} items={[
            { key: 'view', icon: <User />, label: t('order.viewCustomer'), onSelect: () => nav(`/customers/${gidToNum(o.customer!.id)}`) },
            { key: 'copy', icon: <Copy />, label: t('order.copyEmail'), onSelect: () => { void navigator.clipboard?.writeText(o.email ?? o.customer?.defaultEmailAddress?.emailAddress ?? '').then(() => toast(t('abandoned.copied'))); } },
          ]} />}>
            {o.customer ? (
              <div className="flex flex-col gap-1 text-[13px]">
                <Link to={`/customers/${gidToNum(o.customer.id)}`} className="font-medium text-accent hover:underline">{o.customer.displayName}</Link>
                <span className="text-muted">{t('customers.orderCount', { n: o.customer.numberOfOrders })}</span>
                <span>{o.email ?? o.customer.defaultEmailAddress?.emailAddress}</span>
              </div>
            ) : <p className="text-[13px] text-muted">{o.email ?? t('orders.noCustomer')}</p>}
          </Card>
          <Card title={t('order.shippingAddress')} actions={<Dropdown align="right" variant="plain" size="sm" icon label={t('common.moreActions')} trigger={<MoreHorizontal className="size-4" />} items={[
            { key: 'edit', icon: <MapPin />, label: t('order.editAddress'), disabled: !!o.cancelledAt, onSelect: () => setDialog('address') },
            { key: 'copy', icon: <Copy />, label: t('order.copyAddress'), disabled: !o.shippingAddress, onSelect: () => { const a = o.shippingAddress; void navigator.clipboard?.writeText([[a?.firstName, a?.lastName].filter(Boolean).join(' '), a?.address1, a?.address2, [a?.zip, a?.city].filter(Boolean).join(' '), a?.country].filter(Boolean).join('\n')).then(() => toast(t('abandoned.copied'))); } },
          ]} />}><AddressBlock a={o.shippingAddress} /></Card>
          <Card title={t('order.billingAddress')}><AddressBlock a={o.billingAddress} /></Card>
          <MetafieldsEditor ownerId={o.id} ownerType="ORDER" />
          <Card title={t('field.tags')}><TagInput value={o.tags} onChange={(v) => tags.mutate(v)} removeLabel={t('common.remove')} /></Card>
        </div>
      </div>
      {dialog === 'fulfill' && <FulfillDialog open onClose={() => setDialog(null)} orderId={o.id} lines={unfulfilled} onDone={() => void refresh()} />}
      {dialog === 'address' && <AddressDialog open onClose={() => setDialog(null)} orderId={o.id} value={o.shippingAddress as never} onDone={() => void refresh()} />}
      {dialog === 'return' && <ReturnDialog open onClose={() => setDialog(null)} orderId={o.id} onDone={() => void refresh()} />}
      {dialog === 'cancel' && <CancelDialog open onClose={() => setDialog(null)} orderId={o.id} onDone={() => void refresh()} />}
    </>
  );
}

function LineList({ lines, qty }: { lines: OrderLine[]; qty: (l: OrderLine) => number }) {
  const fmt = useFormat();
  return (
    <ul className="divide-y divide-line">
      {lines.map((l) => (
        <li key={l.id} className="flex items-center gap-3 py-2 text-[13px]">
          <Thumb url={l.variant?.image?.url} />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{l.title}</p>
            <p className="text-xs text-muted">{[l.variantTitle, l.sku].filter(Boolean).join(' · ')}</p>
          </div>
          <span className="text-muted">{fmt.money(l.originalUnitPriceSet)} × {qty(l)}</span>
          <span className="w-24 text-right">{fmt.money(l.discountedTotalSet)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Previous / next order (newest first), taken from the most recent orders. */
function OrderNeighbours({ id }: { id: string }) {
  const t = useT();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['orders-neighbours'], staleTime: 30_000, queryFn: () => gql<{ orders: { nodes: Array<{ id: string }> } }>(ORDERS, { query: null, sortKey: 'CREATED_AT', reverse: true, first: 100 }) });
  const ids = q.data?.orders.nodes.map((n) => n.id) ?? [];
  const i = ids.indexOf(id);
  const go = (to?: string) => to && nav(`/orders/${gidToNum(to)}`);
  return (
    <ButtonGroup>
      <Button icon aria-label={t('order.newer')} disabled={i <= 0} onClick={() => go(ids[i - 1])}><ChevronUp className="size-4" /></Button>
      <Button icon aria-label={t('order.older')} disabled={i < 0 || i >= ids.length - 1} onClick={() => go(ids[i + 1])}><ChevronDown className="size-4" /></Button>
    </ButtonGroup>
  );
}
