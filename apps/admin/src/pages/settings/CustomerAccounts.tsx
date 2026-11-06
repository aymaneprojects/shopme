import { Banner, Button, Checkbox, Input, Modal, Skeleton, Switch, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { KeyRound, LayoutTemplate, LogIn, Package, Wallet, Link as LinkIcon } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { useState } from 'react';
import { UserErrors, gql, mutate } from '../../api';
import { RowCard, Section } from '../../components/SettingsKit';
import { CHECKOUT_CONFIGURATIONS, CUSTOMER_ACCOUNTS_SETTINGS, CUSTOMER_ACCOUNTS_SETTINGS_UPDATE } from '../../graphql';
import { useI18n } from '../../i18n';

type Mode = 'DISABLED' | 'OPTIONAL' | 'REQUIRED';
interface AccountsSettings {
  mode: Mode; loginLinksVisible: boolean; signIn: { password: boolean; emailCode: boolean };
  orderActions: { reorder: boolean; returns: boolean; cancellations: boolean; cancellationWindowHours: number }; storeCredit: boolean; url: string | null; accountUrl: string;
}
type Input = Partial<{
  mode: Mode; loginLinksVisible: boolean; signIn: Partial<AccountsSettings['signIn']>; orderActions: Partial<AccountsSettings['orderActions']>; storeCredit: boolean; url: string;
}>;

function useAccounts() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['customer-accounts'], queryFn: () => gql<{ shopmeCustomerAccountsSettings: AccountsSettings }>(CUSTOMER_ACCOUNTS_SETTINGS) });
  const save = useMutation({
    mutationFn: (input: Input) => mutate(CUSTOMER_ACCOUNTS_SETTINGS_UPDATE, { input }, 'shopmeCustomerAccountsSettingsUpdate'),
    onSuccess: () => { toast(t('settings.saved')); void qc.invalidateQueries({ queryKey: ['customer-accounts'] }); void qc.invalidateQueries({ queryKey: ['checkout-settings'] }); },
    onError: (e) => toast(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message, 'critical'),
  });
  return { q, save };
}

/** A row of the accounts cards: icon, title, description and a small control on the right. */
function ControlRow({ icon: Icon, title, description, control }: { icon: ComponentType<{ className?: string }>; title: ReactNode; description: ReactNode; control: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Icon className="size-4 shrink-0 text-muted" />
      <div className="min-w-0 flex-1"><p className="text-[13px] font-medium">{title}</p><p className="text-[13px] text-muted">{description}</p></div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

/** Opens the checkout and customer accounts editor of the active configuration on the sign-in page (its page selector lists the other account pages). */
function useCustomizeAccountPages() {
  const toast = useToast();
  const nav = useNavigate();
  return useMutation({
    mutationFn: async () => (await gql<{ shopmeCheckoutConfigurations: Array<{ id: string; active: boolean }> }>(CHECKOUT_CONFIGURATIONS)).shopmeCheckoutConfigurations.find((c) => c.active) ?? null,
    onSuccess: (config) => nav(config ? `/settings/checkout/${encodeURIComponent(config.id)}?page=login` : '/settings/checkout'),
    onError: (e) => toast(e.message, 'critical'),
  });
}

/** Settings > Customer accounts. */
export function CustomerAccountsSettings() {
  const { t } = useI18n();
  const { q, save } = useAccounts();
  const customize = useCustomizeAccountPages();
  const [dialog, setDialog] = useState<'orders' | 'auth' | 'url' | null>(null);
  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  const s = q.data!.shopmeCustomerAccountsSettings;
  const off = s.mode === 'DISABLED';
  return (
    <div className="flex flex-col gap-6">
      {off && <Banner tone="warning">{t('acct.disabledNotice')}</Banner>}
      <Section title={t('acct.links')}>
        <RowCard>
          <ControlRow icon={LogIn} title={t('acct.showLinks')} description={t('acct.showLinksDesc')}
            control={<Switch checked={s.loginLinksVisible} onChange={(v) => save.mutate({ loginLinksVisible: v })} label={<span className="sr-only">{t('acct.showLinks')}</span>} />} />
        </RowCard>
      </Section>
      <Section title={t('acct.title')} description={t('acct.titleDesc')}>
        <RowCard>
          <ControlRow icon={LayoutTemplate} title={t('acct.pages')} description={t('acct.pagesDesc')}
            control={<Button size="sm" loading={customize.isPending} onClick={() => customize.mutate()}>{t('acct.customize')}</Button>} />
          <ControlRow icon={Package} title={t('acct.orderActions')} description={<>{t('acct.orderActionsDesc')} <Link className="underline" to="/settings/policies">{t('acct.returnRules')}</Link>.</>}
            control={<Button size="sm" onClick={() => setDialog('orders')}>{t('acct.manage')}</Button>} />
        </RowCard>
        <RowCard>
          <ControlRow icon={KeyRound} title={t('acct.auth')} description={t('acct.authDesc')} control={<Button size="sm" onClick={() => setDialog('auth')}>{t('acct.manage')}</Button>} />
          <ControlRow icon={Wallet} title={t('acct.credit')} description={t('acct.creditDesc')}
            control={<Switch checked={s.storeCredit} onChange={(v) => save.mutate({ storeCredit: v })} label={<span className="sr-only">{t('acct.credit')}</span>} />} />
          <div>
            <ControlRow icon={LinkIcon} title={t('acct.url')} description={t('acct.urlDesc')} control={<Button size="sm" onClick={() => setDialog('url')}>{t('acct.manage')}</Button>} />
            <div className="px-4 pb-3"><div className="truncate rounded-md bg-surface px-3 py-2 text-[13px] text-muted" data-testid="account-url">{s.accountUrl}</div></div>
          </div>
        </RowCard>
      </Section>
      <OrderActionsDialog open={dialog === 'orders'} onClose={() => setDialog(null)} s={s} save={(i) => save.mutate(i, { onSuccess: () => setDialog(null) })} saving={save.isPending} />
      <AuthDialog open={dialog === 'auth'} onClose={() => setDialog(null)} s={s} save={(i) => save.mutate(i, { onSuccess: () => setDialog(null) })} saving={save.isPending} />
      <UrlDialog open={dialog === 'url'} onClose={() => setDialog(null)} s={s} save={(i) => save.mutate(i, { onSuccess: () => setDialog(null) })} saving={save.isPending} />
    </div>
  );
}

interface DialogProps { open: boolean; onClose: () => void; s: AccountsSettings; save: (i: Input) => void; saving: boolean }

function OrderActionsDialog(p: DialogProps) {
  const { t } = useI18n();
  return <OrderActionsBody key={String(p.open)} {...p} t={t} />;
}
function OrderActionsBody({ open, onClose, s, save, saving, t }: DialogProps & { t: ReturnType<typeof useI18n>['t'] }) {
  const [a, setA] = useState(s.orderActions);
  return (
    <Modal open={open} onClose={onClose} title={t('acct.orderActions')} closeLabel={t('common.close')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={saving} onClick={() => save({ orderActions: a })}>{t('save.save')}</Button></>}>
      <div className="flex flex-col gap-3">
        <Checkbox label={t('acct.oa.reorder')} checked={a.reorder} onChange={(e) => setA({ ...a, reorder: e.target.checked })} />
        <Checkbox label={t('acct.oa.returns')} checked={a.returns} onChange={(e) => setA({ ...a, returns: e.target.checked })} />
        <Checkbox label={t('acct.oa.cancellations')} checked={a.cancellations} onChange={(e) => setA({ ...a, cancellations: e.target.checked })} />
        {a.cancellations && (
          <Input type="number" min={1} max={720} className="max-w-48" label={t('acct.oa.window')} help={t('acct.oa.windowHelp')} value={a.cancellationWindowHours}
            onChange={(e) => setA({ ...a, cancellationWindowHours: Number(e.target.value) })} />
        )}
        <p className="text-[13px] text-muted">{t('acct.oa.rules')} <Link className="underline" to="/settings/policies">{t('acct.returnRules')}</Link></p>
      </div>
    </Modal>
  );
}

function AuthDialog(p: DialogProps) {
  const { t } = useI18n();
  return <AuthBody key={String(p.open)} {...p} t={t} />;
}
function AuthBody({ open, onClose, s, save, saving, t }: DialogProps & { t: ReturnType<typeof useI18n>['t'] }) {
  const [mode, setMode] = useState<Mode>(s.mode);
  const [signIn, setSignIn] = useState(s.signIn);
  const none = !signIn.password && !signIn.emailCode;
  const modes: Array<{ id: Mode; label: string; help: string }> = [
    { id: 'DISABLED', label: t('acct.mode.disabled'), help: t('acct.mode.disabledHelp') },
    { id: 'OPTIONAL', label: t('acct.mode.optional'), help: t('acct.mode.optionalHelp') },
    { id: 'REQUIRED', label: t('acct.mode.required'), help: t('acct.mode.requiredHelp') },
  ];
  return (
    <Modal open={open} onClose={onClose} title={t('acct.auth')} closeLabel={t('common.close')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" disabled={none} loading={saving} onClick={() => save({ mode, signIn })}>{t('save.save')}</Button></>}>
      <div className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-1 text-[13px] font-semibold">{t('acct.signInMethods')}</legend>
          <Checkbox label={t('acct.method.password')} checked={signIn.password} onChange={(e) => setSignIn({ ...signIn, password: e.target.checked })} />
          <Checkbox label={t('acct.method.code')} checked={signIn.emailCode} onChange={(e) => setSignIn({ ...signIn, emailCode: e.target.checked })} />
          <p className="text-[13px] text-muted">{none ? t('acct.method.none') : t('acct.method.help')}</p>
        </fieldset>
        <div role="radiogroup" aria-label={t('acct.accessLabel')} className="flex flex-col gap-2.5">
          <p className="text-[13px] font-semibold">{t('acct.accessLabel')}</p>
          {modes.map((m) => (
            <label key={m.id} className="flex cursor-pointer items-start gap-2.5 text-[13px]">
              <input type="radio" name="accounts-mode" checked={mode === m.id} onChange={() => setMode(m.id)} className="mt-0.5 size-4 accent-[var(--color-primary,#1E40AF)]" />
              <span><span className="block font-medium">{m.label}</span><span className="block text-muted">{m.help}</span></span>
            </label>
          ))}
        </div>
        <p className="text-[13px] text-muted">{t('acct.mode.checkoutNote')} <Link className="underline" to="/settings/checkout">{t('settings.checkout')}</Link></p>
      </div>
    </Modal>
  );
}

function UrlDialog(p: DialogProps) {
  const { t } = useI18n();
  return <UrlBody key={String(p.open)} {...p} t={t} />;
}
function UrlBody({ open, onClose, s, save, saving, t }: DialogProps & { t: ReturnType<typeof useI18n>['t'] }) {
  const [url, setUrl] = useState(s.url ?? '');
  return (
    <Modal open={open} onClose={onClose} title={t('acct.url')} closeLabel={t('common.close')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={saving} onClick={() => save({ url })}>{t('save.save')}</Button></>}>
      <Input label={t('acct.url.custom')} help={t('acct.url.help')} placeholder="/account" value={url} onChange={(e) => setUrl(e.target.value)} />
    </Modal>
  );
}
