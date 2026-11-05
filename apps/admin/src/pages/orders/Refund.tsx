import { Banner, Button, Card, Checkbox, Input, Skeleton, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { gql, mutate } from '../../api';
import { PageHeader } from '../../components/PageHeader';
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
  id: string; name: string; cancelledAt: string | null;
  lineItems: { nodes: OrderLine[] };
  totalShippingPriceSet: MoneySet; totalRefundedSet: MoneySet;
  transactions: Array<{ kind: string; status: string; gateway: string; amountSet: MoneySet }>;
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
  const lines = o.lineItems.nodes.filter((l) => l.refundableQuantity > 0);
  const cur = o.totalShippingPriceSet.shopMoney.currencyCode;
  const paidCents = o.transactions.filter((x) => x.status === 'SUCCESS' && (x.kind === 'SALE' || x.kind === 'CAPTURE')).reduce((s, x) => s + toCents(x.amountSet.shopMoney.amount), 0);
  const refundableCents = Math.max(0, paidCents - toCents(o.totalRefundedSet.shopMoney.amount));
  const shippingCents = toCents(o.totalShippingPriceSet.shopMoney.amount);
  const rl: RefundLine[] = o.lineItems.nodes.map((l) => ({ id: l.id, quantity: l.quantity, refundableQuantity: l.refundableQuantity, discountedTotalCents: toCents(l.discountedTotalSet.shopMoney.amount) }));
  const r = calcRefund({ lines: rl, quantities: qty, shippingRefundCents: Math.round((parseDecimal(ship) ?? 0) * 100), shippingCents, refundableCents });
  const money = (c: number) => fmt.money({ amount: fromCents(c), currencyCode: cur });
  const picked = lines.filter((l) => clampQuantity(rl.find((x) => x.id === l.id)!, qty[l.id] ?? 0) > 0);
  const gateway = o.transactions.find((x) => x.status === 'SUCCESS' && (x.kind === 'SALE' || x.kind === 'CAPTURE'))?.gateway;
  const back = `/orders/${routeId}`;
  const lineTotal = (id: string) => calcRefund({ lines: [rl.find((x) => x.id === id)!], quantities: { [id]: qty[id] ?? 0 }, shippingRefundCents: 0, shippingCents: 0, refundableCents: Number.MAX_SAFE_INTEGER }).itemsCents;

  const m = useMutation({
    mutationFn: () => mutate(REFUND_CREATE, {
      input: {
        orderId: o.id, note: reason.trim() || null, notify,
        refundLineItems: picked.map((l) => ({ lineItemId: l.id, quantity: qty[l.id], restockType: restock ? 'RETURN' : 'NO_RESTOCK' })),
        ...(r.shippingCents > 0 && { shipping: { amount: fromCents(r.shippingCents) } }),
      },
    }, 'refundCreate'),
    onSuccess: async () => { toast(t('order.refunded')); await qc.invalidateQueries({ queryKey: ['order'] }); await qc.invalidateQueries({ queryKey: ['orders'] }); nav(back); },
    onError: (e: Error) => toast(e.message, 'critical'),
  });

  return (
    <>
      <PageHeader back={back} title={t('refund.pageTitle')} subtitle={o.name} />
      {o.cancelledAt && <div className="mb-4"><Banner tone="warning">{t('order.cancelledBadge')}</Banner></div>}
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-4">
          <Card title={t('order.refundItems')}>
            {lines.length === 0 ? <p className="text-[13px] text-muted">{t('order.nothingToRefund')}</p> : (
              <ul className="divide-y divide-line">
                {lines.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 py-2 text-[13px]">
                    <Thumb url={l.variant?.image?.url} />
                    <span className="min-w-0 flex-1"><span className="block font-medium">{l.title}</span><span className="text-xs text-muted">{[l.variantTitle, l.sku].filter(Boolean).join(' · ')}</span></span>
                    <span className="text-accent">{money(unitCents(rl.find((x) => x.id === l.id)!))}</span>
                    <span className="flex items-center gap-1.5">
                      <input type="number" aria-label={`${t('order.quantity')} ${l.title}`} min={0} max={l.refundableQuantity} value={qty[l.id] ?? 0}
                        onChange={(e) => setQty({ ...qty, [l.id]: Math.max(0, Math.min(l.refundableQuantity, Math.floor(Number(e.target.value) || 0))) })} className="field-control w-16" />
                      <span className="text-muted">/ {l.refundableQuantity}</span>
                    </span>
                    <span className="w-20 text-right">{money(lineTotal(l.id))}</span>
                  </li>
                ))}
              </ul>
            )}
            {shippingCents > 0 && (
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3 text-[13px]">
                <span>{t('order.shipping')} <span className="text-muted">({t('order.refundShippingMax', { max: money(shippingCents) })})</span></span>
                <Input aria-label={t('order.shipping')} inputMode="decimal" className="w-28" value={ship} onChange={(e) => setShip(e.target.value)} />
              </div>
            )}
          </Card>
          <Card title={t('order.refundReason')}>
            <Input aria-label={t('order.refundReason')} value={reason} onChange={(e) => setReason(e.target.value)} />
            <p className="mt-2 text-xs text-muted">{t('order.refundReasonHelp')}</p>
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card title={t('orderEdit.summary')}>
            {picked.length === 0 && r.shippingCents === 0 ? <p className="text-[13px] text-muted">{t('order.noItemSelected')}</p> : (
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-[13px]">
                <dt className="text-muted">{t('order.itemsSubtotal')}</dt><dd className="text-right">{money(r.itemsCents)}</dd>
                <dt className="text-muted">{t('order.shipping')}</dt><dd className="text-right">{money(r.shippingCents)}</dd>
              </dl>
            )}
            <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
              <Checkbox label={t('order.restock')} checked={restock} onChange={(e) => setRestock(e.target.checked)} />
              <Checkbox label={t('order.notifyCustomer')} checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            </div>
          </Card>
          <Card title={t('order.refundAmountTitle')}>
            <p className="text-[13px] text-muted">{t('order.refundMethod')}{gateway ? `: ${gateway}` : ''}</p>
            <p className="mt-1 text-lg font-semibold">{money(r.totalCents)}</p>
            <p className="text-xs text-muted">{t('order.availableToRefund', { amount: money(refundableCents) })}</p>
            {r.capped && <p className="mt-1 text-xs text-warning">{t('order.refundCapped', { max: money(refundableCents) })}</p>}
            <Button variant="primary" className="mt-3 w-full" loading={m.isPending} disabled={r.totalCents <= 0} onClick={() => m.mutate()}>{t('order.refundAmount', { amount: money(r.totalCents) })}</Button>
          </Card>
        </div>
      </div>
    </>
  );
}
