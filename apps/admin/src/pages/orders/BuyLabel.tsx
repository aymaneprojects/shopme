import { Badge, Banner, Button, Checkbox, ConfirmDialog, Input, Modal, Select, Skeleton, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer, Tag } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { gql, mutate } from '../../api';
import { AddressBlock, useFormat } from '../../components/shared';
import { LABEL_ITEMS_WEIGHT, LABEL_PURCHASE, LABEL_RATES, LABEL_VOID, ORDER_LABELS } from '../../graphql';
import { useI18n } from '../../i18n';
import { GRAMS_PER, WEIGHT_ABBR } from '../../lib/shipping';
import { RatesList, useWeight, type LabelRate, type PackageOption, type RatesAnswer } from '../settings/ShippingCarriers';

/** A label of the order as the API returns it. */
export interface OrderLabel {
  id: string; carrier: string; service: string | null; trackingNumber: string | null; trackingUrl: string | null; cost: string; currencyCode: string; status: string; source: string;
  fulfillmentId: string | null; labelUrl: string | null; refundStatus: string | null; test: boolean; createdAt: string;
}
interface OrderLabelsData { shopmeShippingLabels: OrderLabel[]; shopmeLabelCarriers: Array<{ id: string; name: string; test: boolean }>; shopmeShippingPackages: PackageOption[] }

/** Labels of an order, the carriers that sell labels and the saved packages (one request for the order page). */
export const useOrderLabels = (orderId: string) => useQuery({ queryKey: ['order-labels', orderId], queryFn: () => gql<OrderLabelsData>(ORDER_LABELS, { orderId }) });

/** The active bought label of a fulfillment, if any. */
export const labelOf = (labels: OrderLabel[] | undefined, fulfillmentId: string) => labels?.find((l) => l.fulfillmentId === fulfillmentId && l.status === 'ACTIVE' && l.source === 'PURCHASED') ?? null;

const openLabel = (l: OrderLabel) => { if (l.labelUrl) window.open(l.labelUrl, '_blank', 'noopener'); };

/** The label line of a fulfilled card: carrier, service, postage, test mode, and the print button. */
export function LabelLine({ label }: { label: OrderLabel }) {
  const { t } = useI18n();
  const fmt = useFormat();
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-[13px]" data-testid="label-line">
      <Tag className="size-4 shrink-0 text-muted" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="font-medium">{t('postage.label')}</span>
        <span className="text-muted"> · {[label.service, fmt.money({ amount: label.cost, currencyCode: label.currencyCode })].filter(Boolean).join(' · ')}</span>
      </span>
      {label.test && <Badge tone="attention">{t('postage.testBadge')}</Badge>}
      {label.labelUrl && <Button size="sm" onClick={() => openLabel(label)}><Printer className="size-3.5" />{t('postage.print')}</Button>}
    </div>
  );
}

/** Confirm, then void a bought label at its carrier (the fulfillment is cancelled by the server). */
export function VoidLabelDialog({ label, onClose, onDone }: { label: { id: string }; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const run = useMutation({
    mutationFn: () => mutate<{ label: OrderLabel }>(LABEL_VOID, { id: label.id }, 'shopmeShippingLabelVoid'),
    onSuccess: (r) => { toast(r.label.refundStatus === 'REFUNDED' ? t('postage.voidedRefunded') : t('postage.voided')); onClose(); onDone(); },
    onError: (e: Error) => { toast(e.message, 'critical'); onClose(); },
  });
  return <ConfirmDialog open danger loading={run.isPending} onClose={onClose} closeLabel={t('common.close')} title={t('postage.voidTitle')} message={t('postage.voidBody')} confirmLabel={t('postage.void')} cancelLabel={t('postage.keep')} onConfirm={() => run.mutate()} />;
}

type Address = Parameters<typeof AddressBlock>[0]['a'];

/**
 * "Buy shipping label": package and weight, then the rates of every carrier account that sells labels, then the purchase. The label's
 * tracking goes on the fulfillment (a new one for the items still to ship, or `fulfillmentId`); the last step offers to print it.
 */
export function BuyLabelDialog({ orderId, orderName, fulfillmentId, shipTo, onClose, onDone }: { orderId: string; orderName: string; fulfillmentId?: string | null; shipTo: Address; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const qc = useQueryClient();
  const data = useOrderLabels(orderId);
  const items = useQuery({ queryKey: ['label-items-weight', orderId, fulfillmentId ?? null], queryFn: async () => (await gql<{ shopmeShippingLabelItemsWeight: number }>(LABEL_ITEMS_WEIGHT, { orderId, fulfillmentId: fulfillmentId ?? null })).shopmeShippingLabelItemsWeight });
  const [pkg, setPkg] = useState('');
  const weight = useWeight(null);
  const [answer, setAnswer] = useState<RatesAnswer | null>(null);
  const [picked, setPicked] = useState<LabelRate | null>(null);
  const [notify, setNotify] = useState(true);
  const [bought, setBought] = useState<OrderLabel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const packages = data.data?.shopmeShippingPackages ?? [];
  const def = packages.find((p) => p.default);
  const chosenPkg = packages.find((p) => p.id === pkg) ?? def;
  // Suggested weight: the items plus the package, once both are known (the merchant can change it).
  useEffect(() => {
    if (items.data == null || !data.data || weight.text) return;
    const pkgGrams = chosenPkg?.weight ? chosenPkg.weight.value * (GRAMS_PER[chosenPkg.weight.unit] ?? 1) : 0;
    const total = items.data + pkgGrams;
    if (total > 0) weight.setText(String(Math.round((total / GRAMS_PER[weight.unit]!) * 1000) / 1000));
  }, [items.data, data.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const input = () => ({ orderId, fulfillmentId: fulfillmentId ?? null, parcel: { packageId: pkg || null, weightGrams: weight.grams } });
  const rates = useMutation({
    mutationFn: async () => (await gql<{ shopmeShippingLabelRates: RatesAnswer }>(LABEL_RATES, { input: input() })).shopmeShippingLabelRates,
    onSuccess: (r) => { setError(r.userErrors.length ? r.userErrors.map((e) => e.message).join(' · ') : null); setAnswer(r.userErrors.length ? null : r); setPicked(r.rates[0] ?? null); },
    onError: (e: Error) => setError(e.message),
  });
  const buy = useMutation({
    mutationFn: () => mutate<{ label: OrderLabel }>(LABEL_PURCHASE, { input: { ...input(), accountId: picked!.accountId, rateId: picked!.rateId, notifyCustomer: notify } }, 'shopmeShippingLabelPurchase'),
    // The order page is refreshed when the dialog closes: refreshing it now would remount the page and drop this last step (print).
    onSuccess: (r) => { setBought(r.label); setError(null); void qc.invalidateQueries({ queryKey: ['shipping-labels'] }); },
    onError: (e: Error) => setError(e.message),
  });
  const carriers = data.data?.shopmeLabelCarriers ?? [];
  const pickedKey = picked ? `${picked.accountId}:${picked.rateId}` : null;
  const itemsWeight = items.data ? `${Math.round((items.data / GRAMS_PER[weight.unit]!) * 1000) / 1000} ${WEIGHT_ABBR[weight.unit] ?? ''}` : null;

  const close = () => { onClose(); if (bought) onDone(); };
  const footer = bought
    ? <><Button onClick={close}>{t('common.close')}</Button>{bought.labelUrl && <Button variant="primary" onClick={() => openLabel(bought)}><Printer className="size-4" />{t('postage.print')}</Button>}</>
    : !carriers.length && data.data ? <Button onClick={onClose}>{t('common.close')}</Button>
      : answer
        ? <><Button onClick={() => { setAnswer(null); setPicked(null); }}>{t('postage.back')}</Button><Button variant="primary" disabled={!picked} loading={buy.isPending} onClick={() => { setError(null); buy.mutate(); }}>{picked ? t('postage.buyFor', { price: fmt.money({ amount: picked.price, currencyCode: picked.currencyCode }) }) : t('postage.buy')}</Button></>
        : <><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" disabled={!weight.grams || !shipTo} loading={rates.isPending} onClick={() => { setError(null); rates.mutate(); }}>{t('postage.getRates')}</Button></>;

  return (
    <Modal open onClose={close} closeLabel={t('common.close')} title={t('postage.titleFor', { name: orderName })} wide footer={footer}>
      {data.isLoading ? <Skeleton className="h-40" /> : (
        <div className="flex flex-col gap-4" data-testid="buy-label">
          {error && <Banner>{error}</Banner>}
          {!carriers.length ? (
            <Banner tone="info">{t('postage.noCarrier')} <Link className="underline" to="/settings/shipping" onClick={onClose}>{t('postage.setup')}</Link></Banner>
          ) : bought ? (
            <div className="flex flex-col gap-3">
              <Banner tone="success">{t('postage.bought')}</Banner>
              <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1.5 text-[13px]">
                <dt className="text-muted">{t('btn.labels.carrier')}</dt><dd>{bought.carrier}{bought.service ? ` · ${bought.service}` : ''} {bought.test && <Badge tone="attention">{t('postage.testBadge')}</Badge>}</dd>
                <dt className="text-muted">{t('btn.labels.tracking')}</dt><dd className="font-mono">{bought.trackingNumber}</dd>
                <dt className="text-muted">{t('postage.cost')}</dt><dd>{fmt.money({ amount: bought.cost, currencyCode: bought.currencyCode })}</dd>
              </dl>
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                <div>
                  <p className="mb-1 text-[13px] font-medium">{t('postage.shipTo')}</p>
                  {shipTo ? <AddressBlock a={shipTo} /> : <p className="text-[13px] text-critical">{t('postage.noAddress')}</p>}
                </div>
                <div className="flex flex-col gap-3">
                  <Select label={t('postage.package')} value={pkg} disabled={!!answer} onChange={(e) => setPkg(e.target.value)}>
                    <option value="">{def ? t('postage.defaultPackage', { name: def.name }) : t('postage.customPackage')}</option>
                    {packages.filter((p) => !p.default).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                  <Input label={`${t('postage.weight')} (${weight.abbr})`} inputMode="decimal" value={weight.text} disabled={!!answer} onChange={(e) => weight.setText(e.target.value)}
                    help={itemsWeight ? t('postage.weightHelp', { weight: itemsWeight }) : t('postage.weightNone')} />
                </div>
              </div>
              {answer && (
                <div className="flex flex-col gap-3">
                  <p className="text-[13px] font-medium">{t('postage.rates')}</p>
                  <RatesList answer={answer} selected={pickedKey} onSelect={setPicked} />
                  {picked?.test && <Banner tone="warning">{t('postage.testNotice')}</Banner>}
                  {answer.rates.length > 0 && <Checkbox label={t('postage.notify')} checked={notify} onChange={(e) => setNotify(e.target.checked)} />}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
