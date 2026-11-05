import { Banner, Button, Card, Checkbox, Input, Select, Skeleton, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Inbox } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { gql, mutate } from '../../api';
import { IconHeading, PageTitle, SideSection, TopBar, TwoColumn } from '../../components/OrderChrome';
import { useFormat } from '../../components/shared';
import type { MoneySet } from '../../components/shared';
import { numToGid, parseDecimal } from '../../format';
import { ORDER, REFUND_CREATE } from '../../graphql';
import { useT } from '../../i18n';
import { calcRefund, clampQuantity, fromCents, toCents, unitCents } from '../../lib/refund';
import type { RefundLine } from '../../lib/refund';
import { Thumb } from '../Products';
import type { OrderLine } from './OrderDialogs';

interface RefundOrder {
  id: string; name: string; cancelledAt: string | null; customer: { id: string } | null;
  lineItems: { nodes: OrderLine[] };
  totalShippingPriceSet: MoneySet; totalRefundedSet: MoneySet;
  transactions: Array<{ kind: string; status: string; gateway: string; formattedGateway: string | null; amountSet: MoneySet }>;
}

/** Refund page: pick quantities, shipping and a reason on the left; summary, amount and the refund button on the right. */
export function RefundPage() {
  const { id = '' } = useParams();
  const t = useT();
  const gid = numToGid('Order', id);
  const q = useQuery({ queryKey: ['order', gid], queryFn: () => gql<{ order: RefundOrder | null }>(ORDER, { id: gid }) });
  if (q.isLoading) return <div className="grid gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64" /></div>;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  if (!q.data?.order) return <Banner>{t('order.notFound')}</Banner>;
  return <RefundForm order={q.data.order} routeId={id} />;
}

function RefundForm({ order: o, routeId }: { order: RefundOrder; routeId: string }) {
  const t = useT();
  const fmt = useFormat();
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [ship, setShip] = useState('0');
  const [restock, setRestock] = useState(true);
  const [notify, setNotify] = useState(true);
  const [reason, setReason] = useState('');
  const [dest, setDest] = useState<'original' | 'credit'>('original');
  const [creditAmt, setCreditAmt] = useState('');
  const [creditExpiry, setCreditExpiry] = useState('');
  const lines = o.lineItems.nodes.filter((l) => l.refundableQuantity > 0);
  const cur = o.totalShippingPriceSet.shopMoney.currencyCode;
  const paidCents = o.transactions.filter((x) => x.status === 'SUCCESS' && (x.kind === 'SALE' || x.kind === 'CAPTURE')).reduce((s, x) => s + toCents(x.amountSet.shopMoney.amount), 0);
  const refundableCents = Math.max(0, paidCents - toCents(o.totalRefundedSet.shopMoney.amount));
  const shippingCents = toCents(o.totalShippingPriceSet.shopMoney.amount);
  const rl: RefundLine[] = o.lineItems.nodes.map((l) => ({ id: l.id, quantity: l.quantity, refundableQuantity: l.refundableQuantity, discountedTotalCents: toCents(l.discountedTotalSet.shopMoney.amount) }));
  const r = calcRefund({ lines: rl, quantities: qty, shippingRefundCents: Math.round((parseDecimal(ship) ?? 0) * 100), shippingCents, refundableCents });
  const money = (c: number) => fmt.money({ amount: fromCents(c), currencyCode: cur });
  const picked = lines.filter((l) => clampQuantity(rl.find((x) => x.id === l.id)!, qty[l.id] ?? 0) > 0);
  const gateway = o.transactions.find((x) => x.status === 'SUCCESS' && (x.kind === 'SALE' || x.kind === 'CAPTURE') && x.gateway !== 'gift_card')?.gateway ?? o.transactions.find((x) => x.status === 'SUCCESS' && x.kind === 'SALE')?.gateway;
  // Where the money goes: the card/gateway payment first, whatever is left is credited back to the gift cards that paid part of the order.
  const sum = (pred: (x: RefundOrder['transactions'][number]) => boolean) => o.transactions.filter((x) => x.status === 'SUCCESS' && pred(x)).reduce((n, x) => n + toCents(x.amountSet.shopMoney.amount), 0);
  const giftPaid = sum((x) => x.kind === 'SALE' && x.gateway === 'gift_card');
  const cashLeft = Math.max(0, sum((x) => (x.kind === 'SALE' || x.kind === 'CAPTURE') && x.gateway !== 'gift_card') - sum((x) => x.kind === 'REFUND' && x.gateway !== 'gift_card'));
  const giftLeft = Math.max(0, giftPaid - sum((x) => x.kind === 'REFUND' && x.gateway === 'gift_card'));
  const toCash = Math.min(r.totalCents, cashLeft);
  const toGift = giftPaid > 0 ? Math.min(giftLeft, r.totalCents - toCash) : 0;
  const creditCents = dest === 'credit' ? Math.min(r.totalCents, Math.max(0, Math.round((parseDecimal(creditAmt) ?? r.totalCents / 100) * 100))) : 0;
  const back = `/orders/${routeId}`;
  const lineTotal = (id: string) => calcRefund({ lines: [rl.find((x) => x.id === id)!], quantities: { [id]: qty[id] ?? 0 }, shippingRefundCents: 0, shippingCents: 0, refundableCents: Number.MAX_SAFE_INTEGER }).itemsCents;

  const m = useMutation({
    mutationFn: () => mutate(REFUND_CREATE, {
      input: {
        orderId: o.id, note: reason.trim() || null, notify,
        refundLineItems: picked.map((l) => ({ lineItemId: l.id, quantity: qty[l.id], restockType: restock ? 'RETURN' : 'NO_RESTOCK' })),
        ...(r.shippingCents > 0 && { shipping: { amount: fromCents(r.shippingCents) } }),
        ...(creditCents > 0 && { refundMethods: [{ storeCreditRefund: { amount: { amount: fromCents(creditCents), currencyCode: cur }, ...(creditExpiry && { expiresAt: new Date(`${creditExpiry}T23:59:59`).toISOString() }) } }] }),
      },
    }, 'refundCreate'),
    onSuccess: async () => { toast(t('order.refunded')); await qc.invalidateQueries({ queryKey: ['order'] }); await qc.invalidateQueries({ queryKey: ['orders'] }); nav(back); },
    onError: (e: Error) => toast(e.message, 'critical'),
  });

  return (
    <>
      <TopBar back={back} icon={<Inbox />} crumbs={[{ label: t('nav.orders'), to: '/orders' }, { label: o.name }]} />
      <TwoColumn
        main={<>
          <PageTitle>{t('refund.pageTitle')}</PageTitle>
          {o.cancelledAt && <Banner tone="warning">{t('order.cancelledBadge')}</Banner>}
          <section>
            <IconHeading icon={<Inbox />} tone="attention">{t('order.refundItems')}</IconHeading>
            <Card className="!p-0">
              {lines.length === 0 ? <p className="p-4 text-[13px] text-muted">{t('order.nothingToRefund')}</p> : (
                <ul className="divide-y divide-line px-4">
                  {lines.map((l) => (
                    <li key={l.id} className="flex items-center gap-3 py-3 text-[13px]">
                      <Thumb url={l.variant?.image?.url} className="size-9" />
                      <span className="min-w-0 flex-1"><span className="block font-medium">{l.title}</span>{(l.variantTitle || l.sku) && <span className="mt-0.5 flex flex-wrap gap-1 text-xs text-muted">{[l.variantTitle, l.sku].filter(Boolean).map((x) => <span key={x} className="rounded-md bg-surface px-1.5">{x}</span>)}</span>}</span>
                      <span className="text-accent">{money(unitCents(rl.find((x) => x.id === l.id)!))}</span>
                      <span className="field-control flex w-24 items-center gap-1 !py-0">
                        <input type="number" aria-label={`${t('order.quantity')} ${l.title}`} min={0} max={l.refundableQuantity} value={qty[l.id] ?? 0}
                          onChange={(e) => setQty({ ...qty, [l.id]: Math.max(0, Math.min(l.refundableQuantity, Math.floor(Number(e.target.value) || 0))) })} className="h-8 w-10 min-w-0 flex-1 border-0 bg-transparent p-0 outline-none" />
                        <span className="text-muted">/ {l.refundableQuantity}</span>
                      </span>
                      <span className="w-20 text-right">{money(lineTotal(l.id))}</span>
                    </li>
                  ))}
                </ul>
              )}
              {shippingCents > 0 && (
                <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-[13px]">
                  <span>{t('order.shipping')} <span className="text-muted">({t('order.refundShippingMax', { max: money(shippingCents) })})</span></span>
                  <Input aria-label={t('order.shipping')} inputMode="decimal" className="w-28" value={ship} onChange={(e) => setShip(e.target.value)} />
                </div>
              )}
            </Card>
          </section>
          <section>
            <h2 className="mb-2 text-sm font-semibold">{t('order.refundReason')}</h2>
            <Card>
              <Input aria-label={t('order.refundReason')} value={reason} onChange={(e) => setReason(e.target.value)} />
              <p className="mt-2 text-xs text-muted">{t('order.refundReasonHelp')}</p>
            </Card>
          </section>
        </>}
        side={<>
          <SideSection title={t('orderEdit.summary')}>
            {picked.length === 0 && r.shippingCents === 0 ? <p className="text-muted">{t('order.noItemSelected')}</p> : (
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
                <dt className="text-muted">{t('order.itemsSubtotal')}</dt><dd className="text-right">{money(r.itemsCents)}</dd>
                <dt className="text-muted">{t('order.shipping')}</dt><dd className="text-right">{money(r.shippingCents)}</dd>
              </dl>
            )}
            <div className="mt-3 flex flex-col gap-2">
              <Checkbox label={t('order.restock')} checked={restock} onChange={(e) => setRestock(e.target.checked)} />
              <Checkbox label={t('order.notifyCustomer')} checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            </div>
          </SideSection>
          <SideSection title={t('order.refundAmountTitle')}>
            <p className="text-muted">{t('order.refundMethod')}{gateway && giftPaid === 0 && dest === 'original' ? `: ${gateway}` : ''}</p>
            <p className="mt-1 text-lg font-semibold">{money(r.totalCents)}</p>
            {o.customer && (
              <div className="mt-2 flex flex-col gap-2">
                <Select label={t('refund.destination')} value={dest} onChange={(e) => setDest(e.target.value as 'original' | 'credit')}>
                  <option value="original">{t('refund.original')}</option><option value="credit">{t('refund.storeCredit')}</option>
                </Select>
                {dest === 'credit' && (
                  <>
                    <Input label={t('refund.creditAmount')} inputMode="decimal" placeholder={fromCents(r.totalCents)} value={creditAmt} onChange={(e) => setCreditAmt(e.target.value)} help={t('refund.creditRest', { amount: money(r.totalCents - creditCents) })} />
                    <Input type="date" label={t('refund.creditExpiry')} min={new Date().toISOString().slice(0, 10)} value={creditExpiry} onChange={(e) => setCreditExpiry(e.target.value)} help={t('credit.expiryHelp')} />
                  </>
                )}
              </div>
            )}
            {giftPaid > 0 && r.totalCents > 0 && (
              <>
                <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
                  {toCash > 0 && <><dt className="text-muted">{t('order.refundGateway', { gateway: gateway === 'gift_card' ? '' : gateway ?? '' })}</dt><dd className="text-right">{money(toCash)}</dd></>}
                  {toGift > 0 && <><dt className="text-muted">{t('order.refundGiftCard')}</dt><dd className="text-right">{money(toGift)}</dd></>}
                </dl>
                <p className="mt-1 text-xs text-muted">{t('order.giftCardRefundNote')}</p>
              </>
            )}
            <p className="text-xs text-muted">{t('order.availableToRefund', { amount: money(refundableCents) })}</p>
            {r.capped && <p className="mt-1 text-xs text-warning">{t('order.refundCapped', { max: money(refundableCents) })}</p>}
            <Button variant="primary" className="mt-3 w-full" loading={m.isPending} disabled={r.totalCents <= 0} onClick={() => m.mutate()}>{t('order.refundAmount', { amount: money(r.totalCents) })}</Button>
          </SideSection>
        </>} />
    </>
  );
}
