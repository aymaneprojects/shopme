import { Badge, Banner, Button, Dropdown, Input, Modal, Skeleton, useToast } from '@shopme/ui';
import { MoreHorizontal } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { UserErrors, gql, mutate } from '../../api';
import { RowCard, Section } from '../../components/SettingsKit';
import { CHECKOUT_CONFIGURATIONS, CHECKOUT_CONFIGURATION_ACTIVATE, CHECKOUT_CONFIGURATION_CREATE, CHECKOUT_CONFIGURATION_DELETE, CHECKOUT_CONFIGURATION_RENAME } from '../../graphql';
import { useI18n } from '../../i18n';
import type { CheckoutConfig } from '../../lib/config';

type Rule = 'hidden' | 'optional' | 'required';
export interface CheckoutForm {
  contactMethod: 'email' | 'email_or_phone'; accountMode: 'guest' | 'required'; nameMode: 'full' | 'last';
  company: Rule; address2: Rule; phone: Rule; marketing: 'hidden' | 'unchecked' | 'checked';
  tipping: { enabled: boolean; presets: number[] }; orderNotes: boolean;
}

export interface CheckoutConfiguration { id: string; name: string; active: boolean; settings: CheckoutForm; config: CheckoutConfig }
const CONFIGS_KEY = ['checkout-configurations'];
export const useConfigurations = () => useQuery({ queryKey: CONFIGS_KEY, queryFn: async () => (await gql<{ shopmeCheckoutConfigurations: CheckoutConfiguration[] }>(CHECKOUT_CONFIGURATIONS)).shopmeCheckoutConfigurations });

type Dialog = { kind: 'duplicate' | 'rename' | 'delete'; id: string; name: string };

/** Settings > Checkout: the checkout configurations; the active one is what the storefront checkout uses. */
export function CheckoutSettings() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useConfigurations();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: CONFIGS_KEY }); void qc.invalidateQueries({ queryKey: ['checkout-settings'] }); void qc.invalidateQueries({ queryKey: ['config', 'CHECKOUT'] }); };
  const run = useMutation({
    mutationFn: async (a: { kind: Dialog['kind'] | 'activate'; id: string; name?: string }) => {
      if (a.kind === 'duplicate') return mutate(CHECKOUT_CONFIGURATION_CREATE, { name: a.name, fromId: a.id }, 'shopmeCheckoutConfigurationCreate');
      if (a.kind === 'rename') return mutate(CHECKOUT_CONFIGURATION_RENAME, { id: a.id, name: a.name }, 'shopmeCheckoutConfigurationRename');
      if (a.kind === 'activate') return mutate(CHECKOUT_CONFIGURATION_ACTIVATE, { id: a.id }, 'shopmeCheckoutConfigurationActivate');
      return mutate(CHECKOUT_CONFIGURATION_DELETE, { id: a.id }, 'shopmeCheckoutConfigurationDelete');
    },
    onSuccess: (_r, a) => { setDialog(null); setError(null); refresh(); toast(t(a.kind === 'activate' ? 'cfg.activated' : a.kind === 'delete' ? 'cfg.deleted' : 'settings.saved')); },
    onError: (e) => setError(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message),
  });
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  const configs = q.data!;
  const open = (d: Dialog) => { setError(null); setDialog(d); };
  return (
    <div className="flex flex-col gap-6">
      <Section title={t('cfg.title')} description={t('cfg.desc')}>
        <RowCard>
          {configs.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-[13px]">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Link to={`/settings/checkout/${encodeURIComponent(c.id)}`} className="min-w-0 truncate font-medium hover:underline">{c.name}</Link>
                {c.active && <Badge tone="success">{t('ckeditor.active')}</Badge>}
              </div>
              {!c.active && <Button size="sm" loading={run.isPending && run.variables?.kind === 'activate' && run.variables.id === c.id} onClick={() => run.mutate({ kind: 'activate', id: c.id })}>{t('cfg.setActive')}</Button>}
              <Button size="sm" onClick={() => open({ kind: 'duplicate', id: c.id, name: t('cfg.copyName', { name: c.name }) })}>{t('cfg.duplicate')}</Button>
              <Button size="sm" onClick={() => nav(`/settings/checkout/${encodeURIComponent(c.id)}`)}>{t('common.edit')}</Button>
              <Dropdown align="right" icon label={t('common.moreActions')} variant="plain" trigger={<MoreHorizontal className="size-4" />} items={[
                { key: 'rename', label: t('cfg.rename'), onSelect: () => open({ kind: 'rename', id: c.id, name: c.name }) },
                ...(c.active ? [] : [{ key: 'delete', label: t('common.delete'), danger: true, separatorBefore: true, onSelect: () => open({ kind: 'delete', id: c.id, name: c.name }) }]),
              ]} />
            </div>
          ))}
        </RowCard>
      </Section>
      <Modal open={dialog !== null} onClose={() => setDialog(null)} closeLabel={t('common.close')} medium
        title={dialog?.kind === 'duplicate' ? t('cfg.duplicate') : dialog?.kind === 'rename' ? t('cfg.rename') : t('cfg.deleteTitle')}
        footer={<><Button onClick={() => setDialog(null)}>{t('common.cancel')}</Button>
          <Button variant={dialog?.kind === 'delete' ? 'danger' : 'primary'} loading={run.isPending} disabled={!dialog || (dialog.kind !== 'delete' && !dialog.name.trim())} onClick={() => dialog && run.mutate({ kind: dialog.kind, id: dialog.id, name: dialog.name })}>
            {dialog?.kind === 'delete' ? t('common.delete') : dialog?.kind === 'duplicate' ? t('cfg.duplicate') : t('save.save')}</Button></>}>
        <div className="flex flex-col gap-3">
          {error && <Banner>{error}</Banner>}
          {dialog?.kind === 'delete' ? <p className="text-[13px]">{t('cfg.deleteBody', { name: dialog.name })}</p>
            : dialog && <Input label={t('cfg.name')} maxLength={60} autoFocus value={dialog.name} onChange={(e) => setDialog({ ...dialog, name: e.target.value })} />}
        </div>
      </Modal>
    </div>
  );
}
