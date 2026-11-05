import { PickupCard } from '../components/PickupCard';
import { Badge, Banner, Button, ButtonGroup, Card, Checkbox, ConfirmDialog, Dropdown, Modal, Skeleton, SplitButton, TagInput, Textarea, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Ban, ChevronDown, ChevronUp, CircleDollarSign, Copy, CopyPlus, CornerUpLeft, Eye, Inbox, MapPin, MoreHorizontal, Pause, Pencil, Plus, Printer, Tag, Truck, User, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { gql, mutate } from '../api';
import { AddressBlock, FinancialBadge, FulfillmentBadge, useFormat } from '../components/shared';
import type { MoneySet } from '../components/shared';
import { IconHeading, PageTitle, QtyChip, SideSection, TopBar, TwoColumn, nowrapItems } from '../components/OrderChrome';
import { OrderCompanySection } from '../components/CompanyOrderCards';
import { gidToNum, numToGid } from '../format';
import { ORDERS_CAPTURE, ORDER, ORDERS, ORDER_CLOSE, ORDER_MARK_AS_PAID, ORDER_OPEN, ORDER_UPDATE, TAGS_ADD, TAGS_REMOVE, DRAFT_ORDER_CREATE, FULFILLMENT_CANCEL, FULFILLMENT_ORDER_RELEASE_HOLD } from '../graphql';
import { Timeline } from '../components/Timeline';
import { printDocuments, printHtml, type PrintDoc } from '../lib/print';
import { useI18n, useT } from '../i18n';
import type { Key } from '../i18n';
import { toCents } from '../lib/refund';
import { MetafieldsEditor } from '../components/MetafieldsEditor';
import { IssuedGiftCardsCard } from '../components/IssuedGiftCards';
import { AddressDialog, CancelDialog, FulfillDialog, HoldDialog, TrackingDialog, type FulfillmentValue } from './orders/OrderDialogs';
import { ReturnDialog, ReturnsCard } from './orders/Returns';
import type { OrderLine } from './orders/OrderDialogs';
import { Thumb } from './Products';
import { AddressProblemsText, ConversionSection, FulfilmentFields, RiskSection, useOrderExtras } from './orders/OrderExtras';
import { BuyLabelDialog, LabelLine, VoidLabelDialog, labelOf, useOrderLabels, type OrderLabel } from './orders/BuyLabel';

type Addr = Parameters<typeof AddressBlock>[0]['a'];
interface OrderData {
  id: string; name: string; createdAt: string; email: string | null; note: string | null; tags: string[]; cancelledAt: string | null; closedAt: string | null;
  sourceName: string | null;   displayFinancialStatus: string; displayFulfillmentStatus: string;
  lineItems: { nodes: OrderLine[] };
  subtotalPriceSet: MoneySet; totalShippingPriceSet: MoneySet; totalTaxSet: MoneySet; totalDiscountsSet: MoneySet; totalPriceSet: MoneySet; totalRefundedSet: MoneySet;
  shippingAddress: Addr; billingAddress: Addr;
  shippingLines: { nodes: Array<{ title: string; originalPriceSet: MoneySet }> };
  discountApplications: { nodes: Array<{ __typename: string; code?: string }> };
  transactions: Array<{ id: string; kind: string; status: string; gateway: string; createdAt: string; amountSet: MoneySet }>;
  statusPageUrl: string;
  shopmeFulfillmentHold: { reason: string; reasonNotes: string | null } | null;
  fulfillments: Array<FulfillmentValue & { status: string; createdAt: string; fulfillmentLineItems: { nodes: Array<{ quantity: number; lineItem: { title: string; variantTitle: string | null } }> } }>;
  refunds: Array<{ id: string; createdAt: string; note: string | null; totalRefundedSet: MoneySet }>;
  customer: { id: string; displayName: string; defaultEmailAddress: { emailAddress: string } | null; numberOfOrders: number } | null;
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
  const [dialog, setDialog] = useState<'fulfill' | 'cancel' | 'return' | 'address' | 'billing' | 'hold' | 'print' | null>(null);
  const [tracking, setTracking] = useState<FulfillmentValue | null>(null);
  const [cancelling, setCancelling] = useState<FulfillmentValue | null>(null);
  const [buying, setBuying] = useState<{ fulfillmentId: string | null } | null>(null);
  const [voiding, setVoiding] = useState<OrderLabel | null>(null);
  const labels = useOrderLabels(o.id);
  const [note, setNote] = useState(o.note ?? '');
  const [editNote, setEditNote] = useState(false);
  const { lang } = useI18n();
  const extrasQ = useOrderExtras(o.id);
  const extras = extrasQ.data ?? null;
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['timeline'] }), qc.invalidateQueries({ queryKey: ['order'] }), qc.invalidateQueries({ queryKey: ['order-extras'] }), qc.invalidateQueries({ queryKey: ['order-labels'] })]).then(() => qc.invalidateQueries({ queryKey: ['orders'] }));
  const fail = (e: Error) => toast(e.message, 'critical');

  const act = useMutation({
    mutationFn: async (a: 'close' | 'open' | 'paid') => {
      if (a === 'close') await mutate(ORDER_CLOSE, { input: { id: o.id } }, 'orderClose');
      else if (a === 'open') await mutate(ORDER_OPEN, { input: { id: o.id } }, 'orderOpen');
      else await mutate(ORDER_MARK_AS_PAID, { input: { id: o.id } }, 'orderMarkAsPaid');
    },
    onSuccess: () => { toast(t('order.updated')); void refresh(); }, onError: fail,
  });
  const capture = useMutation({
    mutationFn: () => mutate<{ succeeded: number; results: Array<{ message: string | null }> }>(ORDERS_CAPTURE, { ids: [o.id] }, 'shopmeOrdersCapture'),
    onSuccess: (r) => { if (r.succeeded) toast(t('btn.order.captured')); else toast(r.results[0]?.message ?? t('btn.order.captureFailed'), 'critical'); void refresh(); }, onError: fail,
  });
  const saveNote = useMutation({ mutationFn: () => mutate(ORDER_UPDATE, { input: { id: o.id, note } }, 'orderUpdate'), onSuccess: () => { toast(t('order.updated')); void refresh(); }, onError: fail });
  const release = useMutation({ mutationFn: () => mutate(FULFILLMENT_ORDER_RELEASE_HOLD, { id: o.id }, 'fulfillmentOrderReleaseHold'), onSuccess: () => { toast(t('hold.released')); void refresh(); }, onError: fail });
  const cancelFul = useMutation({
    mutationFn: (id: string) => mutate(FULFILLMENT_CANCEL, { id }, 'fulfillmentCancel'),
    onSuccess: () => { setCancelling(null); toast(t('ful.cancelled')); void refresh(); }, onError: (e: Error) => { setCancelling(null); fail(e); },
  });
  const duplicate = useMutation({
    mutationFn: async () => {
      const r = await mutate<{ draftOrder: { id: string } }>(DRAFT_ORDER_CREATE, { input: {
        email: o.email, note: o.note, tags: o.tags,
        lineItems: o.lineItems.nodes.map((l) => (l.variant ? { variantId: l.variant.id, quantity: l.quantity } : { title: l.title, quantity: l.quantity, originalUnitPrice: l.originalUnitPriceSet.shopMoney.amount })),
      } }, 'draftOrderCreate');
      return r.draftOrder.id;
    },
    onSuccess: (id) => nav(`/orders/drafts/${gidToNum(id)}`), onError: fail,
  });
  const tags = useMutation({
    mutationFn: async (next: string[]) => {
      const add = next.filter((x) => !o.tags.includes(x)), remove = o.tags.filter((x) => !next.includes(x));
      if (add.length) await mutate(TAGS_ADD, { id: o.id, tags: add }, 'tagsAdd');
      if (remove.length) await mutate(TAGS_REMOVE, { id: o.id, tags: remove }, 'tagsRemove');
    },
    onSuccess: () => void refresh(), onError: fail,
  });

  const print = (docs: PrintDoc[]) => {
    const addr = (a: Addr) => (a ? [[a.firstName, a.lastName].filter(Boolean).join(' '), a.company, a.address1, a.address2, [a.zip, a.city].filter(Boolean).join(' '), a.country].filter((x): x is string => !!x) : []);
    const html = printHtml({
      name: o.name, createdAt: o.createdAt, email: o.email,
      lines: o.lineItems.nodes.map((l) => ({ title: l.title, variantTitle: l.variantTitle, sku: l.sku, quantity: l.quantity, unitPrice: fmt.money(l.originalUnitPriceSet), total: fmt.money(l.discountedTotalSet) })),
      totals: [[t('order.subtotal'), fmt.money(o.subtotalPriceSet)], [t('order.shipping'), fmt.money(o.totalShippingPriceSet)], [t('order.taxes'), fmt.money(o.totalTaxSet)], [t('order.total'), fmt.money(o.totalPriceSet)]],
      shipping: addr(o.shippingAddress), billing: addr(o.billingAddress),
    }, docs, { order: t('order.printOrderTitle'), packing: t('order.printPackingTitle'), date: t('orders.date'), item: t('order.items'), sku: 'SKU', quantity: t('order.quantity'), price: t('order.price'), total: t('order.total'), shipTo: t('order.shippingAddress'), billTo: t('order.billingAddress'), blocked: '' }, lang);
    if (!printDocuments(html)) toast(t('order.printFailed'), 'critical');
  };
  const lines = o.lineItems.nodes;
  const unfulfilled = lines.filter((l) => l.unfulfilledQuantity > 0);
  const cur = o.totalPriceSet.shopMoney.currencyCode;
  const paidCents = o.transactions.filter((x) => x.status === 'SUCCESS' && (x.kind === 'SALE' || x.kind === 'CAPTURE')).reduce((s, x) => s + toCents(x.amountSet.shopMoney.amount), 0);
  const refundedCents = toCents(o.totalRefundedSet.shopMoney.amount);
  const refundableCents = Math.max(0, paidCents - refundedCents);
  const canMarkPaid = ['PENDING', 'AUTHORIZED', 'PARTIALLY_PAID'].includes(o.displayFinancialStatus) && !o.cancelledAt;
  const canRefund = refundableCents > 0 && !o.cancelledAt;
  const isClosed = !!o.closedAt;
  const held = o.shopmeFulfillmentHold;
  const needsShipping = lines.some((l) => l.requiresShipping);
  const channel = ({ web: t('qa.channel.web'), draft: t('qa.channel.draft'), draft_order: t('qa.channel.draft'), shopify_draft_order: t('qa.channel.draft'), manual: t('qa.channel.manual'), pos: t('qa.channel.pos') } as Record<string, string>)[o.sourceName ?? ''] ?? o.sourceName ?? t('qa.channel.web');
  const liveFulfillments = o.fulfillments.filter((f) => f.status !== 'CANCELLED');

  return (
    <>
      <TopBar back="/orders" icon={<Inbox />} crumbs={[{ label: t('nav.orders') }]}
        actions={<>
          <Button disabled={!canRefund} onClick={() => nav(`/orders/${gidToNum(o.id)}/refund`)}>{t('order.refund')}</Button>
          <Button disabled={!!o.cancelledAt} onClick={() => nav(`/orders/${gidToNum(o.id)}/edit`)}>{t('order.edit')}</Button>
          <Dropdown align="right" chevron label={t('qa.moreActions')} trigger={t('qa.moreActions')} items={nowrapItems([
            { key: 'duplicate', icon: <CopyPlus />, label: t('order.duplicate'), onSelect: () => duplicate.mutate() },
            { key: 'return', icon: <CornerUpLeft />, label: t('returns.createTitle'), disabled: !!o.cancelledAt || !lines.some((l) => l.quantity > l.unfulfilledQuantity), onSelect: () => setDialog('return') },
            { key: 'cancel', icon: <Ban />, label: t('order.cancel'), disabled: !!o.cancelledAt, onSelect: () => setDialog('cancel') },
            { key: 'close', icon: isClosed ? <ArchiveRestore /> : <Archive />, label: isClosed ? t('order.reopen') : t('order.archive'), onSelect: () => act.mutate(isClosed ? 'open' : 'close') },
            { key: 'status', icon: <Eye />, label: t('order.statusPage'), onSelect: () => { window.open(o.statusPageUrl, '_blank', 'noopener'); } },
            { key: 'print-many', icon: <Printer />, label: t('order.printMany'), onSelect: () => setDialog('print') },
            { key: 'print-order', icon: <Printer />, label: t('order.printOrder'), onSelect: () => print(['order']) },
            { key: 'print-packing', icon: <Printer />, label: t('order.printPacking'), onSelect: () => print(['packing']) },
          ])} />
          <OrderNeighbours id={o.id} />
        </>} />
      <TwoColumn
        main={<>
          <PageTitle badges={<><FinancialBadge status={o.displayFinancialStatus} /><FulfillmentBadge status={o.displayFulfillmentStatus} />{o.cancelledAt && <Badge tone="critical">{t('order.cancelledBadge')}</Badge>}{isClosed && !o.cancelledAt && <Badge>{t('order.archived')}</Badge>}</>}
            subtitle={t('qa.fromChannel', { date: fmt.dateTime(o.createdAt), channel })}>{o.name}</PageTitle>
          {extras?.test && <Banner tone="info">{t('btn.order.testBanner')}</Banner>}
          {!!extras?.shopmeAddressProblems.length && !o.cancelledAt && <Banner tone="warning"><AddressProblemsText problems={extras.shopmeAddressProblems} onReview={() => setDialog('address')} /></Banner>}
          {o.cancelledAt && <Banner tone="warning">{t('order.cancelledOn', { date: fmt.dateTime(o.cancelledAt) })}</Banner>}
          {unfulfilled.length > 0 && (
            <section>
              <IconHeading icon={<Inbox />} tone="attention"
                actions={!o.cancelledAt && <>
                  <Dropdown align="right" variant="plain" size="sm" icon label={t('ful.cardMenu')} trigger={<MoreHorizontal className="size-4" />} items={[{ key: 'loc', icon: <MapPin />, label: t('ful.changeLocation'), disabled: !!held, onSelect: () => setDialog('fulfill') }]} />
                  {needsShipping && !held && <Button size="sm" onClick={() => setBuying({ fulfillmentId: null })}><Tag className="size-3.5" />{t('postage.buy')}</Button>}
                  {held
                    ? <Button size="sm" variant="primary" loading={release.isPending} onClick={() => release.mutate()}>{t('hold.release')}</Button>
                    : <SplitButton size="sm" menuLabel={t('hold.menu')} onClick={() => setDialog('fulfill')} items={[{ key: 'hold', icon: <Pause />, label: t('hold.mark'), onSelect: () => setDialog('hold') }]}>{t('order.markFulfilled')}</SplitButton>}
                </>}>{t(`ful.${o.displayFulfillmentStatus}` as Key)}</IconHeading>
              <Card className="!p-0">
                <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3 text-[13px] text-muted">
                  <span className="flex items-center gap-2">{needsShipping ? <Truck className="size-4" /> : <Ban className="size-4" />}{needsShipping ? (o.shippingLines.nodes[0]?.title ?? t('order.shipping')) : t('qa.noShipping')}</span>
                  {extras?.shopmeLocation && <span className="inline-flex items-center gap-1 rounded-full border border-line bg-canvas px-2 py-0.5 text-xs text-fg" title={t('btn.order.shipsFrom')}><MapPin className="size-3" aria-hidden />{extras.shopmeLocation.name}</span>}
                </div>
                {held && <div className="px-4 pt-3"><Banner tone="warning">{t('hold.banner', { reason: t(`hold.reason.${held.reason}` as Key) })}{held.reasonNotes ? ` — ${held.reasonNotes}` : ''}</Banner></div>}
                <div className="px-4"><LineList lines={unfulfilled} qty={(l) => l.unfulfilledQuantity} /></div>
              </Card>
            </section>
          )}
          {liveFulfillments.map((f) => (
            <section key={f.id}>
              <IconHeading icon={<Truck />} tone="success" actions={<Dropdown align="right" variant="plain" size="sm" icon label={t('ful.cardMenu')} trigger={<MoreHorizontal className="size-4" />} items={[
                ...(labelOf(labels.data?.shopmeShippingLabels, f.id)
                  ? [{ key: 'void-label', icon: <Tag />, label: t('postage.void'), danger: true, onSelect: () => setVoiding(labelOf(labels.data?.shopmeShippingLabels, f.id)) }]
                  : f.trackingInfo.length === 0 && !o.cancelledAt ? [{ key: 'buy-label', icon: <Tag />, label: t('postage.buy'), onSelect: () => setBuying({ fulfillmentId: f.id }) }] : []),
                { key: 'track', icon: <Pencil />, label: t('ful.editTracking'), onSelect: () => setTracking(f) },
                { key: 'cancel', icon: <X />, label: t('ful.cancel'), danger: true, onSelect: () => setCancelling(f) },
              ]} />}>{t('ful.FULFILLED')} <span className="font-normal text-muted">{f.name} · {fmt.date(f.createdAt)}</span></IconHeading>
              <Card>
                <ul className="mb-2 text-[13px]">{f.fulfillmentLineItems.nodes.map((n, i) => <li key={i}>{n.lineItem.title}{n.lineItem.variantTitle ? <span className="text-muted"> · {n.lineItem.variantTitle}</span> : null} <span className="text-muted">× {n.quantity}</span></li>)}</ul>
                {f.trackingInfo.length === 0 ? <p className="text-[13px] text-muted">{t('order.noTracking')}</p> : f.trackingInfo.map((tr, i) => (
                  <p key={i} className="flex items-center gap-2 text-[13px]"><Truck className="size-4 text-muted" />{tr.company}{' '}{tr.url ? <a href={tr.url} target="_blank" rel="noreferrer" className="text-accent underline">{tr.number}</a> : tr.number}</p>
                ))}
                {labelOf(labels.data?.shopmeShippingLabels, f.id) && <LabelLine label={labelOf(labels.data?.shopmeShippingLabels, f.id)!} />}
              </Card>
            </section>
          ))}
          {unfulfilled.length === 0 && liveFulfillments.length === 0 && <Card className="!p-0"><div className="px-4"><LineList lines={lines} qty={(l) => l.quantity} /></div></Card>}

          <ReturnsCard orderId={o.id} />
          <IssuedGiftCardsCard orderId={o.id} />

          <section>
            <IconHeading icon={<CircleDollarSign />} actions={<>{extras?.capturable && !o.cancelledAt && <Button size="sm" loading={capture.isPending} onClick={() => capture.mutate()}>{t('btn.order.capture')}</Button>}{canMarkPaid && <Button size="sm" variant="primary" loading={act.isPending} onClick={() => act.mutate('paid')}>{t('order.markPaid')}</Button>}</>}>{t(`fin.${o.displayFinancialStatus}` as Key)}</IconHeading>
            <Card className="!p-0">
              <dl className="grid grid-cols-[7rem_1fr_auto] gap-x-4 gap-y-2 px-4 py-3.5 text-[13px]">
                <dt>{t('order.subtotal')}</dt><dd className="text-muted">{t('order.itemsCount', { n: lines.reduce((n, l) => n + l.quantity, 0) })}</dd><dd className="text-right text-muted">{fmt.money(o.subtotalPriceSet)}</dd>
                {toCents(o.totalDiscountsSet.shopMoney.amount) > 0 && <><dt>{t('order.discount')}</dt><dd className="text-muted">{o.discountApplications.nodes.map((d) => d.code).filter(Boolean).join(', ')}</dd><dd className="text-right text-muted">{fmt.money({ amount: `-${o.totalDiscountsSet.shopMoney.amount}`, currencyCode: cur })}</dd></>}
                {(needsShipping || toCents(o.totalShippingPriceSet.shopMoney.amount) > 0) && <><dt>{t('order.shipping')}</dt><dd className="text-muted">{o.shippingLines.nodes[0]?.title}</dd><dd className="text-right text-muted">{fmt.money(o.totalShippingPriceSet)}</dd></>}
                {toCents(o.totalTaxSet.shopMoney.amount) > 0 && <><dt>{t('order.taxes')}</dt><dd /><dd className="text-right text-muted">{fmt.money(o.totalTaxSet)}</dd></>}
                <dt className="font-semibold">{t('order.total')}</dt><dd /><dd className="text-right font-semibold">{fmt.money(o.totalPriceSet)}</dd>
              </dl>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 border-t border-line px-4 py-3.5 text-[13px]">
                <dt>{t('order.paid')}</dt><dd className="text-right text-muted">{fmt.money({ amount: (paidCents / 100).toFixed(2), currencyCode: cur })}</dd>
                {refundedCents > 0 && <><dt>{t('order.refunded')}</dt><dd className="text-right text-muted">{fmt.money(o.totalRefundedSet)}</dd></>}
              </dl>
            </Card>
          </section>

          <Timeline kind="order" id={o.id} confirmationNumber={extras?.confirmationNumber ?? null} transactions={o.transactions} />
        </>}
        side={<>
          <SideSection title={t('order.notes')} action={<button type="button" className="btn btn-plain btn-icon btn-sm" aria-label={o.note ? t('qa.editNote') : t('qa.addNote')} onClick={() => setEditNote(!editNote)}>{o.note ? <Pencil className="size-4" /> : <Plus className="size-4" />}</button>}>
            {editNote ? (
              <>
                <Textarea aria-label={t('order.notes')} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('order.notesPlaceholder')} />
                <div className="mt-2 flex justify-end"><Button size="sm" disabled={note === (o.note ?? '')} loading={saveNote.isPending} onClick={() => saveNote.mutate()}>{t('save.save')}</Button></div>
              </>
            ) : o.note ? <p className="whitespace-pre-wrap">{o.note}</p> : null}
          </SideSection>
          <SideSection title={t('qa.channelInfo')}>
            <p className="text-muted">{t('qa.channel')}</p>
            <p>{channel}</p>
          </SideSection>
          {extras && <FulfilmentFields key={`${extras.shopmeFulfillBy}|${extras.poNumber}`} orderId={o.id} extras={extras} disabled={!!o.cancelledAt} />}
          <SideSection title={t('order.customer')} action={o.customer && <Dropdown align="right" variant="plain" size="sm" icon label={t('common.moreActions')} trigger={<MoreHorizontal className="size-4" />} items={[
            { key: 'view', icon: <User />, label: t('order.viewCustomer'), onSelect: () => nav(`/customers/${gidToNum(o.customer!.id)}`) },
            { key: 'copy', icon: <Copy />, label: t('order.copyEmail'), onSelect: () => { void navigator.clipboard?.writeText(o.email ?? o.customer?.defaultEmailAddress?.emailAddress ?? '').then(() => toast(t('abandoned.copied'))); } },
          ]} />}>
            {o.customer ? (
              <div className="flex flex-col gap-1">
                <Link to={`/customers/${gidToNum(o.customer.id)}`} className="text-accent hover:underline">{o.customer.displayName}</Link>
                <span className="text-muted">{t('customers.orderCount', { n: o.customer.numberOfOrders })}</span>
                <a href={`mailto:${o.email ?? o.customer.defaultEmailAddress?.emailAddress}`} className="mt-1 break-all text-accent hover:underline">{o.email ?? o.customer.defaultEmailAddress?.emailAddress}</a>
              </div>
            ) : <p className="text-muted">{o.email ?? t('orders.noCustomer')}</p>}
          </SideSection>
          <PickupCard orderId={o.id} onChange={() => void refresh()} />
          <OrderCompanySection orderId={o.id} />
          <SideSection title={t('order.shippingAddress')} action={<Dropdown align="right" variant="plain" size="sm" icon label={t('common.moreActions')} trigger={<MoreHorizontal className="size-4" />} items={[
            { key: 'edit', icon: <MapPin />, label: t('order.shippingEdit'), disabled: !!o.cancelledAt, onSelect: () => setDialog('address') },
            { key: 'copy', icon: <Copy />, label: t('order.copyAddress'), disabled: !o.shippingAddress, onSelect: () => { const a = o.shippingAddress; void navigator.clipboard?.writeText([[a?.firstName, a?.lastName].filter(Boolean).join(' '), a?.address1, a?.address2, [a?.zip, a?.city].filter(Boolean).join(' '), a?.country].filter(Boolean).join('\n')).then(() => toast(t('abandoned.copied'))); } },
          ]} />}><AddressBlock a={o.shippingAddress} /></SideSection>
          <SideSection title={t('order.billingAddress')} action={<Dropdown align="right" variant="plain" size="sm" icon label={t('common.moreActions')} trigger={<MoreHorizontal className="size-4" />} items={[
            { key: 'edit', icon: <MapPin />, label: t('order.billingEdit'), disabled: !!o.cancelledAt, onSelect: () => setDialog('billing') },
          ]} />}><AddressBlock a={o.billingAddress} /></SideSection>
          {extras && <ConversionSection c={extras.shopmeConversion} />}
          {extras && <RiskSection risk={extras.shopmeRisk} />}
          <div className="border-b border-line py-3.5"><MetafieldsEditor ownerId={o.id} ownerType="ORDER" /></div>
          <SideSection title={t('field.tags')}><TagInput value={o.tags} onChange={(v) => tags.mutate(v)} removeLabel={t('common.remove')} /></SideSection>
        </>} />
      {buying && <BuyLabelDialog orderId={o.id} orderName={o.name} fulfillmentId={buying.fulfillmentId} shipTo={o.shippingAddress} onClose={() => setBuying(null)} onDone={() => void refresh()} />}
      {voiding && <VoidLabelDialog label={voiding} onClose={() => setVoiding(null)} onDone={() => void refresh()} />}
      {dialog === 'fulfill' && <FulfillDialog open onClose={() => setDialog(null)} orderId={o.id} lines={unfulfilled} onDone={() => void refresh()} />}
      {dialog === 'address' && <AddressDialog open onClose={() => setDialog(null)} orderId={o.id} value={o.shippingAddress as never} onDone={() => void refresh()} />}
      {dialog === 'billing' && <AddressDialog open kind="billing" onClose={() => setDialog(null)} orderId={o.id} value={o.billingAddress as never} onDone={() => void refresh()} />}
      {dialog === 'hold' && <HoldDialog open onClose={() => setDialog(null)} orderId={o.id} onDone={() => void refresh()} />}
      {dialog === 'print' && <PrintDialog onClose={() => setDialog(null)} onPrint={print} />}
      {tracking && <TrackingDialog open fulfillment={tracking} onClose={() => setTracking(null)} onDone={() => void refresh()} />}
      <ConfirmDialog open={!!cancelling} danger loading={cancelFul.isPending} onClose={() => setCancelling(null)} closeLabel={t('common.close')} title={t('ful.cancelTitle', { name: cancelling?.name ?? '' })}
        message={t('ful.cancelBody')} confirmLabel={t('ful.cancel')} cancelLabel={t('ful.cancelKeep')} onConfirm={() => cancelling && cancelFul.mutate(cancelling.id)} />
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
        <li key={l.id} className="flex items-center gap-3 py-3 text-[13px]">
          <Thumb url={l.variant?.image?.url} className="size-9" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{l.title}</p>
            {(l.variantTitle || l.sku) && <p className="mt-0.5 flex flex-wrap gap-1 text-xs text-muted">{[l.variantTitle, l.sku].filter(Boolean).map((x) => <span key={x} className="rounded-md bg-surface px-1.5">{x}</span>)}</p>}
          </div>
          <span className="flex items-center gap-1.5 text-muted">{fmt.money(l.originalUnitPriceSet)} × <QtyChip n={qty(l)} /></span>
          <span className="w-20 text-right">{fmt.money(l.discountedTotalSet)}</span>
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

function PrintDialog({ onClose, onPrint }: { onClose: () => void; onPrint: (docs: PrintDoc[]) => void }) {
  const t = useT();
  const [docs, setDocs] = useState<PrintDoc[]>(['order', 'packing']);
  const toggle = (d: PrintDoc) => setDocs(docs.includes(d) ? docs.filter((x) => x !== d) : [...docs, d]);
  return (
    <Modal open onClose={onClose} title={t('order.printMany')} closeLabel={t('common.close')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" disabled={!docs.length} onClick={() => { onPrint(docs); onClose(); }}>{t('order.print')}</Button></>}>
      <div className="flex flex-col gap-2">
        <Checkbox label={t('order.printOrder')} checked={docs.includes('order')} onChange={() => toggle('order')} />
        <Checkbox label={t('order.printPacking')} checked={docs.includes('packing')} onChange={() => toggle('packing')} />
      </div>
    </Modal>
  );
}
