import { Badge, Banner, Button, Card, ConfirmDialog, Input, Modal, Select, Skeleton, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { UserErrors, gql, mutate } from '../../api';
import { useFormat } from '../../components/shared';
import { WEBHOOKS, WEBHOOK_CREATE, WEBHOOK_DELETE, WEBHOOK_DELIVERIES } from '../../graphql';
import { useI18n } from '../../i18n';

const TOPICS = ['ORDERS_CREATE', 'ORDERS_PAID', 'ORDERS_UPDATED', 'ORDERS_CANCELLED', 'REFUNDS_CREATE', 'FULFILLMENTS_CREATE', 'DRAFT_ORDERS_CREATE', 'PRODUCTS_CREATE', 'PRODUCTS_UPDATE', 'PRODUCTS_DELETE', 'CUSTOMERS_CREATE', 'CUSTOMERS_UPDATE'];
interface Hook { id: string; topic: string; format: string; createdAt: string; endpoint: { __typename: string; callbackUrl?: string } | null }
interface Delivery { id: string; status: string; responseCode: number | null; createdAt: string; lastError: string | null }

export function WebhooksSettings() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['webhooks'], queryFn: () => gql<{ webhookSubscriptions: { nodes: Hook[] }; shopmeWebhookSettings: { signingSecret: string } }>(WEBHOOKS) });
  const [creating, setCreating] = useState<{ topic: string; callbackUrl: string } | null>(null);
  const [del, setDel] = useState<Hook | null>(null);
  const [log, setLog] = useState<Hook | null>(null);
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const done = (msg: string) => { toast(msg); setCreating(null); setDel(null); setError(null); void qc.invalidateQueries({ queryKey: ['webhooks'] }); };
  const create = useMutation({
    mutationFn: () => mutate(WEBHOOK_CREATE, { topic: creating!.topic, webhookSubscription: { callbackUrl: creating!.callbackUrl.trim(), format: 'JSON' } }, 'webhookSubscriptionCreate'),
    onSuccess: () => done(t('hooks.created')), onError: (e) => setError(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message),
  });
  const remove = useMutation({ mutationFn: (id: string) => mutate(WEBHOOK_DELETE, { id }, 'webhookSubscriptionDelete'), onSuccess: () => done(t('hooks.deleted')), onError: (e) => { setDel(null); toast(e.message, 'critical'); } });
  const hooks = q.data?.webhookSubscriptions.nodes ?? [];
  const add = <Button variant="primary" onClick={() => { setError(null); setCreating({ topic: TOPICS[0]!, callbackUrl: '' }); }}><Plus className="size-4" />{t('hooks.add')}</Button>;
  return (
    <Card title={t('settings.webhooks')} actions={add}>
      <p className="mb-3 text-sm text-muted">{t('hooks.intro')}</p>
      {q.isLoading && <Skeleton className="h-24" />}
      {q.error && <Banner>{q.error.message}</Banner>}
      {q.data && hooks.length === 0 && <p className="py-4 text-sm text-muted">{t('hooks.empty')}</p>}
      <ul className="divide-y divide-line">
        {hooks.map((h) => (
          <li key={h.id} className="flex flex-col gap-2 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">{h.topic}</Badge><span className="min-w-0 flex-1 truncate font-mono text-xs">{h.endpoint?.callbackUrl}</span>
              <Button size="sm" onClick={() => setShown((s) => ({ ...s, [h.id]: !s[h.id] }))}>{t(shown[h.id] ? 'hooks.hideSecret' : 'hooks.showSecret')}</Button>
              <Button size="sm" onClick={() => setLog(h)}>{t('hooks.deliveries')}</Button>
              <Button size="sm" variant="danger" onClick={() => setDel(h)}>{t('common.delete')}</Button>
            </div>
            {shown[h.id] && <p className="text-xs"><span className="text-muted">{t('hooks.secret')}:</span> <code className="select-all break-all rounded bg-surface px-1.5 py-0.5">{q.data?.shopmeWebhookSettings.signingSecret ?? '—'}</code></p>}
          </li>
        ))}
      </ul>
      <Modal open={!!creating} onClose={() => setCreating(null)} closeLabel={t('common.close')} title={t('hooks.add')}
        footer={<><Button onClick={() => setCreating(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={create.isPending} disabled={!/^https?:\/\//.test(creating?.callbackUrl ?? '')} onClick={() => create.mutate()}>{t('hooks.create')}</Button></>}>
        <div className="flex flex-col gap-3">
          {error && <Banner>{error}</Banner>}
          <Select label={t('hooks.topic')} value={creating?.topic ?? ''} onChange={(e) => setCreating((s) => s && { ...s, topic: e.target.value })}>{TOPICS.map((x) => <option key={x}>{x}</option>)}</Select>
          <Input label={t('hooks.url')} type="url" placeholder="https://example.com/webhooks" value={creating?.callbackUrl ?? ''} onChange={(e) => setCreating((s) => s && { ...s, callbackUrl: e.target.value })} />
          <p className="text-xs text-muted">{t('hooks.signHelp')}</p>
        </div>
      </Modal>
      <ConfirmDialog open={!!del} danger onClose={() => setDel(null)} title={t('hooks.deleteTitle')} message={del ? `${del.topic} → ${del.endpoint?.callbackUrl ?? ''}` : ''} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => del && remove.mutate(del.id)} />
      <DeliveryLog hook={log} onClose={() => setLog(null)} />
    </Card>
  );
}

function DeliveryLog({ hook, onClose }: { hook: Hook | null; onClose: () => void }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const q = useQuery({ queryKey: ['webhook-deliveries', hook?.id], enabled: !!hook, retry: false, queryFn: () => gql<{ shopmeWebhookDeliveries: { nodes: Delivery[] } }>(WEBHOOK_DELIVERIES, { subscriptionId: hook!.id }) });
  const rows = q.data?.shopmeWebhookDeliveries.nodes ?? [];
  return (
    <Modal open={!!hook} onClose={onClose} closeLabel={t('common.close')} wide title={t('hooks.deliveriesTitle', { topic: hook?.topic ?? '' })}>
      {q.isLoading && <Skeleton className="h-24" />}
      {q.error && <Banner>{q.error.message}</Banner>}
      {q.data && rows.length === 0 && <p className="text-sm text-muted">{t('hooks.noDeliveries')}</p>}
      <ul className="divide-y divide-line text-sm">
        {rows.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-3 py-2">
            <Badge tone={/success|delivered/i.test(d.status) ? 'success' : /pending|retry/i.test(d.status) ? 'warning' : 'critical'}>{d.status}</Badge>
            <span className="font-mono text-xs">{d.responseCode ?? '—'}</span><span className="text-muted">{fmt.dateTime(d.createdAt)}</span>{d.lastError && <span className="text-xs text-critical">{d.lastError}</span>}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
