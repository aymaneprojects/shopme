import { Badge, Button, Card, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserErrors, gql, mutate } from '../api';
import { ORDER_DELIVERY, ORDER_PICKED_UP, ORDER_PICKUP_READY } from '../graphql';
import { useI18n } from '../i18n';
import { useFormat } from './shared';

interface Delivery { methodType: string; location: { id: string; name: string; address: { address1: string | null; city: string | null; zip: string | null } } | null; pickupReadyAt: string | null; pickedUpAt: string | null }

/** Pickup and local delivery summary of an order, with the "ready for pickup" and "picked up" steps. Renders nothing for shipped orders. */
export function PickupCard({ orderId, onChange }: { orderId: string; onChange?: () => void }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const toast = useToast();
  const qc = useQueryClient();
  const key = ['order-delivery', orderId];
  const q = useQuery({ queryKey: key, queryFn: () => gql<{ order: { shopmeDelivery: Delivery | null } | null }>(ORDER_DELIVERY, { id: orderId }) });
  const d = q.data?.order?.shopmeDelivery;
  const step = useMutation({
    mutationFn: ({ query, root }: { query: string; root: string }) => mutate(query, { orderId }, root),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: key }); onChange?.(); },
    onError: (e) => toast(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : (e as Error).message, 'critical'),
  });
  if (!d || (d.methodType !== 'PICK_UP' && d.methodType !== 'LOCAL')) return null;
  if (d.methodType === 'LOCAL') return <Card title={t('delivery.orderLocal')}><p className="text-[13px] text-muted">{d.location?.name}</p></Card>;
  const a = d.location?.address;
  const status = d.pickedUpAt ? <Badge tone="success">{t('delivery.pickedUp')}</Badge> : d.pickupReadyAt ? <Badge tone="info">{t('delivery.readyForPickup')}</Badge> : <Badge tone="warning">{t('delivery.awaitingPickup')}</Badge>;
  return (
    <Card title={<span className="flex items-center gap-2">{t('delivery.orderPickup')}{status}</span>}>
      <p className="text-[13px] font-medium">{d.location?.name}</p>
      {a && <p className="text-[13px] text-muted">{[a.address1, [a.zip, a.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</p>}
      {d.pickupReadyAt && <p className="mt-1 text-xs text-muted">{t('delivery.readyAt', { date: fmt.date(d.pickupReadyAt) })}</p>}
      {d.pickedUpAt && <p className="mt-1 text-xs text-muted">{t('delivery.pickedUpAt', { date: fmt.date(d.pickedUpAt) })}</p>}
      {!d.pickedUpAt && (
        <div className="mt-3 flex flex-wrap gap-2">
          {!d.pickupReadyAt && <Button size="sm" loading={step.isPending} onClick={() => step.mutate({ query: ORDER_PICKUP_READY, root: 'shopmeOrderPickupMarkReady' })}>{t('delivery.markReady')}</Button>}
          <Button size="sm" variant="primary" loading={step.isPending} onClick={() => step.mutate({ query: ORDER_PICKED_UP, root: 'shopmeOrderPickupMarkPickedUp' })}>{t('delivery.markPickedUp')}</Button>
        </div>
      )}
    </Card>
  );
}
