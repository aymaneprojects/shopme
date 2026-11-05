import { Badge, Button, Input, Popover, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { useState } from 'react';
import { gql, mutate } from '../../api';
import { SideSection } from '../../components/OrderChrome';
import { useFormat } from '../../components/shared';
import { ORDER_EXTRAS, ORDER_SET_FULFILL_BY } from '../../graphql';
import { useT } from '../../i18n';
import type { Key } from '../../i18n';

export interface OrderExtras {
  id: string; test: boolean; confirmationNumber: string | null; capturable: boolean; poNumber: string | null; shopmeFulfillBy: string | null; shopmeAddressProblems: string[];
  shopmeRisk: { level: 'LOW' | 'MEDIUM' | 'HIGH'; score: number; signals: Array<{ code: string; weight: number; detail: string | null }> };
  shopmeConversion: { visits: number; firstVisitAt: string; landingPath: string; lastVisitPath: string; referrer: string | null; utmSource: string | null; utmMedium: string | null; utmCampaign: string | null } | null;
  shopmeLocation: { id: string; name: string } | null; shopmeBatch: { id: string; name: string } | null; shopmeDeliveryStatus: string;
}

/** Test flag, address problems, risk, conversion and fulfilment details that are not part of the main order query. */
export function useOrderExtras(id: string) {
  return useQuery({ queryKey: ['order-extras', id], queryFn: async () => (await gql<{ order: OrderExtras | null }>(ORDER_EXTRAS, { id })).order });
}

const TONE = { LOW: 'success', MEDIUM: 'attention', HIGH: 'critical' } as const;

/** What we know about the buyer's visit before the order: where they came from and what they looked at first. */
export function ConversionSection({ c }: { c: OrderExtras['shopmeConversion'] }) {
  const t = useT();
  const fmt = useFormat();
  return (
    <SideSection title={t('btn.order.conversion')} action={<a href="https://github.com/aymaneprojects/shopme#readme" target="_blank" rel="noreferrer" className="text-xs text-accent underline">{t('btn.order.learn')}</a>}>
      {!c ? <p className="text-muted">{t('btn.order.conversionNone')}</p> : (
        <dl className="grid gap-1">
          <div><dt className="text-muted">{t('btn.order.firstVisit')}</dt><dd>{fmt.dateTime(c.firstVisitAt)}</dd></div>
          <div><dt className="text-muted">{t('btn.order.landing')}</dt><dd className="break-all">{c.landingPath}</dd></div>
          <div><dt className="text-muted">{t('btn.order.referrer')}</dt><dd className="break-all">{c.referrer ?? t('btn.order.direct')}</dd></div>
          {(c.utmSource || c.utmMedium || c.utmCampaign) && <div><dt className="text-muted">{t('btn.mkt.utm')}</dt><dd className="break-all">{[c.utmSource, c.utmMedium, c.utmCampaign].filter(Boolean).join(' / ')}</dd></div>}
          <div><dt className="text-muted">{t('btn.order.pageViews')}</dt><dd>{c.visits}</dd></div>
        </dl>
      )}
    </SideSection>
  );
}

/** A simple risk read from the shop's own data; each signal is listed so the merchant can judge. */
export function RiskSection({ risk }: { risk: OrderExtras['shopmeRisk'] }) {
  const t = useT();
  const Icon = risk.level === 'HIGH' ? ShieldAlert : risk.level === 'LOW' ? ShieldCheck : ShieldQuestion;
  return (
    <SideSection title={t('btn.order.risk')} action={
      <Popover label={t('btn.order.riskInfo')} align="right" className="w-64" triggerVariant="plain" triggerClassName="btn-icon !size-6" trigger={<Icon className="size-4" />}>
        <p className="text-[13px]">{t('btn.order.riskHelp')}</p>
      </Popover>}>
      <p className="flex items-center gap-2"><Badge tone={TONE[risk.level]}>{t(`btn.order.risk.${risk.level}` as Key)}</Badge><span className="text-muted">{t('btn.order.riskScore', { n: risk.score })}</span></p>
      {risk.signals.length > 0 && (
        <ul className="mt-2 list-disc pl-4 text-muted">{risk.signals.map((s) => <li key={s.code}>{t(`btn.order.signal.${s.code}` as Key)}{s.detail ? ` (${s.detail})` : ''}</li>)}</ul>
      )}
    </SideSection>
  );
}

/** Batch, fulfil-by date and purchase order number of the order, editable in place. */
export function FulfilmentFields({ orderId, extras, disabled }: { orderId: string; extras: OrderExtras; disabled: boolean }) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const [by, setBy] = useState(extras.shopmeFulfillBy?.slice(0, 10) ?? '');
  const [po, setPo] = useState(extras.poNumber ?? '');
  const save = useMutation({
    mutationFn: (input: Record<string, unknown>) => mutate(ORDER_SET_FULFILL_BY, { input: { id: orderId, ...input } }, 'orderUpdate'),
    onSuccess: () => { toast(t('order.updated')); void qc.invalidateQueries({ queryKey: ['order-extras', orderId] }); void qc.invalidateQueries({ queryKey: ['orders'] }); },
    onError: (e: Error) => toast(e.message, 'critical'),
  });
  return (
    <SideSection title={t('btn.order.fulfilment')}>
      <div className="grid gap-2">
        <Input label={t('btn.orders.col.fulfillBy')} type="date" disabled={disabled} value={by} onChange={(e) => setBy(e.target.value)}
          onBlur={() => { if (by !== (extras.shopmeFulfillBy?.slice(0, 10) ?? '')) save.mutate({ shopmeFulfillBy: by ? `${by}T12:00:00Z` : null }); }} />
        <Input label={t('btn.orders.col.po')} disabled={disabled} maxLength={100} value={po} onChange={(e) => setPo(e.target.value)}
          onBlur={() => { if (po.trim() !== (extras.poNumber ?? '')) save.mutate({ poNumber: po.trim() }); }} />
        {extras.shopmeBatch && <p><span className="text-muted">{t('btn.orders.col.batch')}: </span>{extras.shopmeBatch.name}</p>}
        <p><span className="text-muted">{t('btn.orders.col.deliveryStatus')}: </span>{t(`btn.delivery.${extras.shopmeDeliveryStatus}` as Key)}</p>
      </div>
    </SideSection>
  );
}

/** "Review address problems" banner content: the list of problems and a button that opens the address editor. */
export function AddressProblemsText({ problems, onReview }: { problems: string[]; onReview: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="min-w-0 flex-1"><strong>{t('btn.order.addressProblems')}</strong><ul className="mt-1 list-disc pl-4">{problems.map((p) => <li key={p}>{t(`btn.order.addrProblem.${p}` as Key)}</li>)}</ul></div>
      <Button size="sm" onClick={onReview}>{t('btn.order.reviewAddress')}</Button>
    </div>
  );
}
