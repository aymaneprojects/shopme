import { Badge, Banner, Button, Card, ConfirmDialog, Input, Skeleton, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { UserErrors, gql, mutate } from '../../api';
import { SaveBar } from '../../components/SaveBar';
import { NOTIFICATION_PREVIEW, NOTIFICATION_TEMPLATES, NOTIFICATION_TEMPLATE_RESET, NOTIFICATION_TEMPLATE_UPDATE } from '../../graphql';
import { useI18n } from '../../i18n';

interface Template { key: string; name: string; subject: string; body: string; customized: boolean }
const useTemplates = () => useQuery({ queryKey: ['notification-templates'], queryFn: () => gql<{ shopmeNotificationTemplates: Template[] }>(NOTIFICATION_TEMPLATES) });
const errText = (e: unknown) => (e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : (e as Error).message);

export function NotificationsSettings() {
  const { t } = useI18n();
  const q = useTemplates();
  return (
    <Card title={t('settings.notifications')}>
      <p className="mb-3 text-sm text-muted">{t('notif.intro')}</p>
      {q.isLoading && <Skeleton className="h-32" />}
      {q.error && <Banner>{q.error.message}</Banner>}
      <ul className="divide-y divide-line">
        {q.data?.shopmeNotificationTemplates.map((n) => (
          <li key={n.key}><Link to={`/settings/notifications/${encodeURIComponent(n.key)}`} className="flex items-center gap-3 py-2.5 text-sm hover:bg-surface">
            <span className="flex-1"><span className="block font-medium">{n.name}</span><span className="text-xs text-muted">{n.subject}</span></span>
            {n.customized && <Badge tone="info">{t('notif.customized')}</Badge>}
          </Link></li>
        ))}
      </ul>
    </Card>
  );
}

export function NotificationEditPage() {
  const { key = '' } = useParams();
  const { t } = useI18n();
  const q = useTemplates();
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  const tpl = q.data?.shopmeNotificationTemplates.find((x) => x.key === key);
  if (!tpl) return <Banner>{t('notif.notFound')}</Banner>;
  return <TemplateForm key={`${key}:${q.dataUpdatedAt}`} tpl={tpl} />;
}

function TemplateForm({ tpl }: { tpl: Template }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ subject: tpl.subject, body: tpl.body });
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const dirty = form.subject !== tpl.subject || form.body !== tpl.body;
  const preview = useQuery({ queryKey: ['notification-preview', tpl.key, tpl.subject, tpl.body], retry: false, queryFn: () => gql<{ shopmeNotificationPreview: { subject: string; html: string } }>(NOTIFICATION_PREVIEW, { key: tpl.key }) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['notification-templates'] }); void qc.invalidateQueries({ queryKey: ['notification-preview'] }); };
  const save = useMutation({
    mutationFn: () => mutate(NOTIFICATION_TEMPLATE_UPDATE, { key: tpl.key, ...form }, 'shopmeNotificationTemplateUpdate'),
    onSuccess: () => { toast(t('notif.saved')); setError(null); refresh(); }, onError: (e) => setError(errText(e)),
  });
  const reset = useMutation({
    mutationFn: () => mutate(NOTIFICATION_TEMPLATE_RESET, { key: tpl.key }, 'shopmeNotificationTemplateReset'),
    onSuccess: () => { toast(t('notif.resetDone')); setConfirm(false); refresh(); }, onError: (e) => { setConfirm(false); setError(errText(e)); },
  });
  const p = preview.data?.shopmeNotificationPreview;
  return (
    <>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => { setForm({ subject: tpl.subject, body: tpl.body }); setError(null); }} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link to="/settings/notifications" aria-label={t('common.back')} className="rounded p-1.5 hover:bg-surface"><ArrowLeft className="size-5" /></Link>
        <h2 className="text-lg font-semibold">{tpl.name}</h2>
        <Button className="ml-auto" disabled={!tpl.customized} onClick={() => setConfirm(true)}>{t('notif.reset')}</Button>
      </div>
      {error && <div className="mb-4"><Banner>{error}</Banner></div>}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title={t('notif.template')}>
          <div className="flex flex-col gap-3">
            <Input label={t('notif.subject')} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            <label className="flex flex-col gap-1 text-sm font-medium">{t('notif.body')}
              <textarea spellCheck={false} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={22} aria-label={t('notif.body')}
                onKeyDown={(e) => { if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); const el = e.currentTarget; const s = el.selectionStart; setForm({ ...form, body: `${form.body.slice(0, s)}  ${form.body.slice(el.selectionEnd)}` }); requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2)); } }}
                className="w-full resize-y rounded-md border border-line bg-surface p-3 font-mono text-[13px] font-normal leading-relaxed" />
            </label>
            <p className="text-xs text-muted">{t('notif.help')}</p>
          </div>
        </Card>
        <Card title={t('notif.preview')} actions={dirty && <span className="text-xs text-muted">{t('notif.previewSaved')}</span>}>
          {preview.isLoading && <Skeleton className="h-64" />}
          {preview.error && <Banner>{preview.error.message}</Banner>}
          {p && <><p className="mb-2 text-sm"><span className="text-muted">{t('notif.subject')}:</span> <strong>{p.subject}</strong></p>
            <iframe title={t('notif.preview')} sandbox="" srcDoc={p.html} className="h-[28rem] w-full rounded-md border border-line bg-white" /></>}
        </Card>
      </div>
      <ConfirmDialog open={confirm} danger onClose={() => setConfirm(false)} title={t('notif.resetTitle')} message={t('notif.resetBody')} confirmLabel={t('notif.reset')} cancelLabel={t('common.cancel')} onConfirm={() => reset.mutate()} />
    </>
  );
}
