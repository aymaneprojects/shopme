import { Badge, Banner, Button, ConfirmDialog, Input, Modal, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound } from 'lucide-react';
import { useState } from 'react';
import { ApiError, rest } from '../api';
import { useI18n } from '../i18n';

interface StripeStatus { configured: boolean; publishableKey: string | null; secretKeyLast4: string | null; webhookSecretSet: boolean; testMode: boolean; webhookUrl: string; installationDefault: boolean }

/**
 * The store's own Stripe account (Settings > Payments): publishable key, secret key and webhook signing secret. Without them the
 * store uses the installation's keys (STRIPE_* variables), when there are any. Secrets are write-only: only their end is shown.
 */
export function StripeKeys({ canEdit }: { canEdit: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['stripe-keys'], queryFn: () => rest<StripeStatus>('/store/payments/stripe') });
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [f, setF] = useState({ publishableKey: '', secretKey: '', webhookSecret: '' });
  const [error, setError] = useState<string | null>(null);
  const done = (msg: string) => { toast(msg); void qc.invalidateQueries({ queryKey: ['stripe-keys'] }); void qc.invalidateQueries({ queryKey: ['payment-settings'] }); };
  const save = useMutation({
    mutationFn: () => rest<StripeStatus>('/store/payments/stripe', { method: 'PUT', body: f }),
    onSuccess: () => { setOpen(false); setF({ publishableKey: '', secretKey: '', webhookSecret: '' }); done(t('stripeKeys.saved')); },
    onError: (e) => setError(e instanceof ApiError ? e.message : String(e)),
  });
  const clear = useMutation({ mutationFn: () => rest<StripeStatus>('/store/payments/stripe', { method: 'DELETE' }), onSuccess: () => { setConfirm(false); done(t('stripeKeys.removed')); } });
  const s = q.data;
  if (!s) return null;
  const copy = () => { void navigator.clipboard?.writeText(s.webhookUrl).then(() => toast(t('stripeKeys.copied'))).catch(() => undefined); };
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3" data-testid="stripe-keys">
      <div className="flex flex-wrap items-center gap-2">
        <KeyRound className="size-4 text-muted" aria-hidden />
        <span className="text-[13px] font-medium">{t('stripeKeys.title')}</span>
        {s.configured && <Badge tone={s.testMode ? 'attention' : 'success'}>{t(s.testMode ? 'stripeKeys.test' : 'stripeKeys.live')}</Badge>}
        {canEdit && <span className="ml-auto flex gap-2">
          <Button size="sm" onClick={() => { setError(null); setOpen(true); }}>{t(s.configured ? 'stripeKeys.replace' : 'stripeKeys.add')}</Button>
          {s.configured && <Button size="sm" variant="plain" onClick={() => setConfirm(true)}>{t('stripeKeys.remove')}</Button>}
        </span>}
      </div>
      <p className="text-[13px] text-muted">
        {s.configured ? t('stripeKeys.own', { key: s.publishableKey ?? '', last4: s.secretKeyLast4 ?? '' }) : t(s.installationDefault ? 'stripeKeys.fallback' : 'stripeKeys.none')}
      </p>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-muted">{t('stripeKeys.webhook')}</span>
        <code className="min-w-0 break-all rounded bg-surface px-1.5 py-0.5 text-xs">{s.webhookUrl}</code>
        <Button size="sm" variant="plain" icon aria-label={t('stripeKeys.copy')} onClick={copy}><Copy className="size-3.5" /></Button>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} closeLabel={t('common.close')} title={t('stripeKeys.modalTitle')}
        footer={<><Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button><Button variant="primary" loading={save.isPending} disabled={!f.publishableKey.trim() || !f.secretKey.trim()} onClick={() => save.mutate()}>{t('stripeKeys.save')}</Button></>}>
        <div className="flex flex-col gap-3">
          {error && <Banner>{error}</Banner>}
          <p className="text-[13px] text-muted">{t('stripeKeys.modalHelp')}</p>
          <Input label={t('stripeKeys.publishable')} placeholder="pk_test_…" autoComplete="off" spellCheck={false} value={f.publishableKey} onChange={(e) => setF({ ...f, publishableKey: e.target.value })} />
          <Input label={t('stripeKeys.secret')} type="password" placeholder="sk_test_…" autoComplete="new-password" spellCheck={false} value={f.secretKey} onChange={(e) => setF({ ...f, secretKey: e.target.value })} />
          <Input label={t('stripeKeys.signing')} type="password" placeholder="whsec_…" autoComplete="new-password" spellCheck={false} help={t('stripeKeys.signingHelp', { url: s.webhookUrl })} value={f.webhookSecret} onChange={(e) => setF({ ...f, webhookSecret: e.target.value })} />
        </div>
      </Modal>
      <ConfirmDialog open={confirm} danger title={t('stripeKeys.removeTitle')} message={t(s.installationDefault ? 'stripeKeys.removeFallback' : 'stripeKeys.removeNone')} confirmLabel={t('stripeKeys.remove')} cancelLabel={t('common.cancel')} closeLabel={t('common.close')} loading={clear.isPending} onConfirm={() => clear.mutate()} onClose={() => setConfirm(false)} />
    </div>
  );
}
