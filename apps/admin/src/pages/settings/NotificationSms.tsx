import { Banner, Button, Card, Input, Skeleton, Switch, Textarea, useToast } from '@shopme/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { ChevronRight, Package } from 'lucide-react';
import { Link } from 'react-router';
import { mutate } from '../../api';
import { Section } from '../../components/SettingsKit';
import { SMS_TEST } from '../../graphql';
import { useI18n } from '../../i18n';
import { errText, useConfig, useSaveConfig } from '../../lib/config';
import type { NotificationsConfig } from '../../lib/config';

/** Settings > Notifications: the SMS gateway the store sends text messages through. */
export function SmsGatewayCard() {
  const { t } = useI18n();
  const cfg = useConfig<NotificationsConfig>('NOTIFICATIONS');
  const [f, setF] = useState<{ gatewayUrl: string; secret: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useSaveConfig<NotificationsConfig>('NOTIFICATIONS', () => { setF(null); setError(null); }, setError);
  if (cfg.isLoading) return <Skeleton className="h-24" />;
  if (!cfg.data) return null;
  const cur = f ?? cfg.data.sms;
  return (
    <Section title={t('bs.smsGateway')} description={t('bs.smsGatewayDesc')}>
      <Card>
        <div className="flex flex-col gap-3">
          {error && <Banner>{error}</Banner>}
          <Input label={t('bs.smsUrl')} placeholder="https://sms.example.com/send" value={cur.gatewayUrl} onChange={(e) => setF({ gatewayUrl: e.target.value.trim(), secret: cur.secret })} />
          <Input label={t('bs.smsSecret')} help={t('bs.smsSecretHelp')} value={cur.secret} onChange={(e) => setF({ gatewayUrl: cur.gatewayUrl, secret: e.target.value })} />
          <pre className="overflow-x-auto rounded-md bg-surface p-3 text-xs">{'POST {"to":"+33612345678","body":"…","from":"My store","notification":"order_confirmation"}'}</pre>
          {f && <div className="flex justify-end gap-2"><Button onClick={() => setF(null)}>{t('save.discard')}</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ ...cfg.data!, sms: { ...cfg.data!.sms, ...f } })}>{t('save.save')}</Button></div>}
        </div>
      </Card>
    </Section>
  );
}

/** Fulfilment request row on the notifications page: email the fulfilment services when an order is placed. */
export function FulfillmentRequestRow() {
  const { t } = useI18n();
  const cfg = useConfig<NotificationsConfig>('NOTIFICATIONS');
  const save = useSaveConfig<NotificationsConfig>('NOTIFICATIONS');
  if (!cfg.data) return null;
  return (
    <div className="flex items-center hover:bg-hover">
      <Link to="/settings/notifications/fulfillment_request" className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4">
        <Package className="size-4 shrink-0 text-muted" aria-hidden />
        <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium">{t('bs.fulfilRequest')}</span><span className="block text-[13px] text-muted">{t('bs.fulfilRequestDesc')}</span></span>
      </Link>
      <div className="shrink-0 pl-2"><Switch label={<span className="sr-only">{t('bs.fulfilRequest')}</span>} checked={cfg.data.fulfillmentRequest.enabled} onChange={(v) => save.mutate({ ...cfg.data!, fulfillmentRequest: { enabled: v } })} /></div>
      <Link to="/settings/notifications/fulfillment_request" tabIndex={-1} aria-hidden className="shrink-0 py-3 pl-3 pr-4"><ChevronRight className="size-4 text-muted" /></Link>
    </div>
  );
}

/** SMS tab of a notification template: switch, message and a test send. */
export function SmsPane({ notificationKey }: { notificationKey: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const cfg = useConfig<NotificationsConfig>('NOTIFICATIONS');
  const [draft, setDraft] = useState<{ enabled: boolean; body: string } | null>(null);
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useSaveConfig<NotificationsConfig>('NOTIFICATIONS', () => { setDraft(null); setError(null); }, setError);
  const test = useMutation({
    mutationFn: () => mutate(SMS_TEST, { key: notificationKey, to }, 'shopmeSmsTest'),
    onSuccess: () => toast(t('bs.smsTestSent')), onError: (e) => toast(errText(e), 'critical'),
  });
  if (cfg.isLoading) return <Skeleton className="h-40" />;
  if (!cfg.data) return null;
  const saved = cfg.data.sms.templates[notificationKey] ?? { enabled: false, body: '' };
  const cur = draft ?? saved;
  const noGateway = !cfg.data.sms.gatewayUrl;
  return (
    <Card title={t('bs.smsTab')}>
      <div className="flex flex-col gap-3">
        {noGateway && <Banner tone="warning">{t('bs.smsNoGateway')}</Banner>}
        {error && <Banner>{error}</Banner>}
        <Switch placement="end" checked={cur.enabled} onChange={(v) => setDraft({ ...cur, enabled: v })} label={t('bs.smsEnable')} />
        <Textarea label={t('bs.smsBody')} help={t('bs.smsBodyHelp', { n: cur.body.length })} rows={4} maxLength={480} value={cur.body} onChange={(e) => setDraft({ ...cur, body: e.target.value })} placeholder={t('bs.smsPlaceholder')} />
        {draft && <div className="flex justify-end gap-2"><Button onClick={() => setDraft(null)}>{t('save.discard')}</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ ...cfg.data!, sms: { ...cfg.data!.sms, templates: { ...cfg.data!.sms.templates, [notificationKey]: draft } } })}>{t('save.save')}</Button></div>}
        <div className="flex items-end gap-2 border-t border-line pt-3">
          <Input className="flex-1" label={t('bs.smsTestTo')} type="tel" value={to} onChange={(e) => setTo(e.target.value)} />
          <Button loading={test.isPending} disabled={!to.trim() || !!draft || noGateway || !saved.enabled} onClick={() => test.mutate()}>{t('bs.smsSendTest')}</Button>
        </div>
      </div>
    </Card>
  );
}
