import { Badge, Banner, Button, Card, Checkbox, ConfirmDialog, Dropdown, Input, Modal, Select, Skeleton, Switch, Textarea, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { gql, mutate } from '../../api';
import { RowCard, Section } from '../../components/SettingsKit';
import { SaveBar } from '../../components/SaveBar';
import { PAYMENT_SETTINGS, PAYMENT_SETTINGS_UPDATE, SHOPME_CONFIG_UPDATE } from '../../graphql';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';
import { countryOptions } from '../../lib/countries';
import { errText, major, minor, newId, useConfig, useSaveConfig } from '../../lib/config';
import type { GiftCardsConfig, PaymentRule, PaymentsConfig } from '../../lib/config';
import { useShop } from '../../session';
import { PaymentLogos } from '../../components/PaymentLogos';

interface Payments { bankTransfer: { enabled: boolean; instructions: string }; cod: { enabled: boolean }; stripe: { enabled: boolean; stripeConfigured: boolean } }
const BRANDS: Array<[string, string]> = [['visa', 'Visa'], ['mastercard', 'Mastercard'], ['amex', 'American Express'], ['discover', 'Discover'], ['diners', 'Diners Club'], ['jcb', 'JCB'], ['unionpay', 'UnionPay'], ['cartes_bancaires', 'Cartes Bancaires']];
const EXPIRY = [null, 6, 12, 24, 36, 60];

export function PaymentsSettings() {
  const q = useQuery({ queryKey: ['payment-settings'], queryFn: () => gql<{ shopmePaymentSettings: Payments }>(PAYMENT_SETTINGS) });
  const cfg = useConfig<PaymentsConfig>('PAYMENTS');
  const gift = useConfig<GiftCardsConfig>('GIFT_CARDS');
  if (q.isLoading || cfg.isLoading || gift.isLoading) return <Skeleton className="h-64" />;
  const err = q.error ?? cfg.error ?? gift.error;
  if (err) return <Banner>{err.message}</Banner>;
  return <PaymentsForm key={`${q.dataUpdatedAt}-${cfg.dataUpdatedAt}-${gift.dataUpdatedAt}`} data={q.data!.shopmePaymentSettings} cfg={cfg.data!} gift={gift.data!} />;
}

function PaymentsForm({ data, cfg, gift }: { data: Payments; cfg: PaymentsConfig; gift: GiftCardsConfig }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const init = { bank: data.bankTransfer.enabled, instructions: data.bankTransfer.instructions, cod: data.cod.enabled, stripe: data.stripe.enabled, test: cfg.testGateway, capture: cfg.captureMethod, brands: cfg.cardBrands, months: gift.defaultExpirationMonths };
  const [f, setF] = useState(init);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<null | 'custom' | 'gateway' | 'rule'>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [del, setDel] = useState<{ kind: 'custom' | 'gateway' | 'rule'; id: string; name: string } | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['payment-settings'] }); void qc.invalidateQueries({ queryKey: ['config'] }); };
  const save = useMutation({
    mutationFn: async () => {
      await mutate(PAYMENT_SETTINGS_UPDATE, { input: { bankTransfer: { enabled: f.bank, instructions: f.instructions }, cod: { enabled: f.cod }, stripe: { enabled: f.stripe } } }, 'shopmePaymentSettingsUpdate');
      await mutate(SHOPME_CONFIG_UPDATE, { key: 'PAYMENTS', value: { ...cfg, testGateway: f.test, captureMethod: f.capture, cardBrands: f.brands } }, 'shopmeConfigUpdate');
      if (f.months !== init.months) await mutate(SHOPME_CONFIG_UPDATE, { key: 'GIFT_CARDS', value: { defaultExpirationMonths: f.months } }, 'shopmeConfigUpdate');
    },
    onSuccess: () => { toast(t('settings.saved')); setError(null); refresh(); },
    onError: (e) => setError(errText(e)),
  });
  const saveList = useSaveConfig<PaymentsConfig>('PAYMENTS', () => { setModal(null); setEdit(null); setDel(null); refresh(); });
  const replace = (patch: Partial<PaymentsConfig>) => saveList.mutate({ ...cfg, ...patch });

  const methodName = (id: string) => (id === 'bank_transfer' ? t('payments.bankEnable') : id === 'cod' ? t('payments.codEnable') : id === 'stripe' ? t('payments.stripe') : id === 'test' ? t('bs.testGateway')
    : cfg.customMethods.find((m) => `manual:${m.id}` === id)?.name ?? cfg.redirectGateways.find((g) => `redirect:${g.id}` === id)?.name ?? id);

  return (
    <>
      <SaveBar dirty={JSON.stringify(f) !== JSON.stringify(init)} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => setF(init)} />
      {error && <div className="mb-4"><Banner>{error}</Banner></div>}
      <div className="flex flex-col gap-6">
        <Section title={t('pay.logos.title')} description={t('pay.logos.desc')}>
          <Card>
            <PaymentLogos stripe={f.stripe} brands={f.brands} methods={[
              ...(f.bank ? [t('pay.logos.bank')] : []), ...(f.cod ? [t('pay.logos.cod')] : []), ...(f.test ? [t('pay.logos.test')] : []),
              ...cfg.customMethods.filter((m) => m.enabled).map((m) => m.name), ...cfg.redirectGateways.filter((g) => g.enabled).map((g) => g.name),
            ]} />
          </Card>
        </Section>
        <Section title={t('payments.stripe')} description={t('payments.cardDesc')} action={<a href="https://docs.stripe.com/payments" target="_blank" rel="noreferrer" className="btn btn-secondary">{t('payments.learnMore')}</a>}>
          <Card>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2"><Switch placement="end" checked={f.stripe} onChange={(v) => setF({ ...f, stripe: v })} label={t('payments.stripeEnable')} /><Badge tone={data.stripe.stripeConfigured ? 'success' : 'warning'}>{data.stripe.stripeConfigured ? t('payments.configured') : t('payments.notConfigured')}</Badge></div>
              {!data.stripe.stripeConfigured && <p className="text-[13px] text-muted">{t('payments.stripeHint')}</p>}
              <fieldset className="border-t border-line pt-3">
                <legend className="mb-2 text-[13px] font-medium">{t('bs.cardBrands')}</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {BRANDS.map(([id, label]) => <Checkbox key={id} label={label} checked={f.brands.includes(id)} onChange={(e) => setF({ ...f, brands: e.target.checked ? [...f.brands, id] : f.brands.filter((b) => b !== id) })} />)}
                </div>
                <p className="mt-2 text-[13px] text-muted">{t('bs.cardBrandsHelp')}</p>
              </fieldset>
              <Select label={t('bs.captureMethod')} help={t('bs.captureHelp')} value={f.capture} onChange={(e) => setF({ ...f, capture: e.target.value as PaymentsConfig['captureMethod'] })}>
                <option value="automatic">{t('bs.captureAuto')}</option><option value="manual">{t('bs.captureManual')}</option>
              </Select>
            </div>
          </Card>
        </Section>

        <Section title={t('bs.testGateway')} description={t('bs.testGatewayDesc')}>
          <Card><Switch placement="end" checked={f.test} onChange={(v) => setF({ ...f, test: v })} label={t('bs.testGatewayEnable')} /></Card>
        </Section>

        <Section title={t('bs.otherMethods')} description={t('bs.otherMethodsDesc')} action={<Button onClick={() => { setEdit(null); setModal('gateway'); }}><Plus className="size-4" />{t('bs.addMethod')}</Button>}>
          {cfg.redirectGateways.length === 0 ? <Card><p className="text-[13px] text-muted">{t('bs.otherMethodsEmpty')}</p></Card> : (
            <RowCard>
              {cfg.redirectGateways.map((g) => (
                <div key={g.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{g.name}</span><span className="block truncate text-xs text-muted">{g.redirectUrl}</span></span>
                  <Switch label={<span className="sr-only">{g.name}</span>} checked={g.enabled} onChange={(v) => replace({ redirectGateways: cfg.redirectGateways.map((x) => (x.id === g.id ? { ...x, enabled: v } : x)) })} />
                  <Dropdown align="right" variant="plain" size="sm" icon label={t('common.moreActions')} trigger={<MoreHorizontal className="size-4" />} items={[
                    { key: 'edit', icon: <Pencil />, label: t('common.edit'), onSelect: () => { setEdit(g.id); setModal('gateway'); } },
                    { key: 'del', icon: <Trash2 />, label: t('common.delete'), danger: true, onSelect: () => setDel({ kind: 'gateway', id: g.id, name: g.name }) },
                  ]} />
                </div>
              ))}
            </RowCard>
          )}
        </Section>

        <Section title={t('payments.manual')} description={t('payments.manualDesc')} action={<Button onClick={() => { setEdit(null); setModal('custom'); }}><Plus className="size-4" />{t('bs.addManual')}</Button>}>
          <Card>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3">
                <Switch placement="end" checked={f.bank} onChange={(v) => setF({ ...f, bank: v })} label={t('payments.bankEnable')} />
                {f.bank && <Textarea label={t('payments.instructions')} help={t('payments.instructionsHelp')} rows={4} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} />}
              </div>
              <div className="border-t border-line pt-4"><Switch placement="end" checked={f.cod} onChange={(v) => setF({ ...f, cod: v })} label={t('payments.codEnable')} /></div>
              {cfg.customMethods.map((m) => (
                <div key={m.id} className="flex items-center gap-3 border-t border-line pt-4">
                  <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{m.name}</span>{m.instructions && <span className="block truncate text-xs text-muted">{m.instructions}</span>}</span>
                  <Switch label={<span className="sr-only">{m.name}</span>} checked={m.enabled} onChange={(v) => replace({ customMethods: cfg.customMethods.map((x) => (x.id === m.id ? { ...x, enabled: v } : x)) })} />
                  <Dropdown align="right" variant="plain" size="sm" icon label={t('common.moreActions')} trigger={<MoreHorizontal className="size-4" />} items={[
                    { key: 'edit', icon: <Pencil />, label: t('common.edit'), onSelect: () => { setEdit(m.id); setModal('custom'); } },
                    { key: 'del', icon: <Trash2 />, label: t('common.delete'), danger: true, onSelect: () => setDel({ kind: 'custom', id: m.id, name: m.name }) },
                  ]} />
                </div>
              ))}
            </div>
          </Card>
        </Section>

        <Section title={t('bs.customizations')} description={t('bs.customizationsDesc')} action={<Button onClick={() => { setEdit(null); setModal('rule'); }}><Plus className="size-4" />{t('bs.addRule')}</Button>}>
          {cfg.customizations.length === 0 ? <Card><p className="text-[13px] text-muted">{t('bs.customizationsEmpty')}</p></Card> : (
            <RowCard>
              {cfg.customizations.map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{r.name}</span><span className="block truncate text-xs text-muted">{t(`bs.action.${r.action}` as Key)} · {methodName(r.method)}{r.countries.length ? ` · ${r.countries.join(', ')}` : ''}</span></span>
                  <Switch label={<span className="sr-only">{r.name}</span>} checked={r.enabled} onChange={(v) => replace({ customizations: cfg.customizations.map((x) => (x.id === r.id ? { ...x, enabled: v } : x)) })} />
                  <Dropdown align="right" variant="plain" size="sm" icon label={t('common.moreActions')} trigger={<MoreHorizontal className="size-4" />} items={[
                    { key: 'edit', icon: <Pencil />, label: t('common.edit'), onSelect: () => { setEdit(r.id); setModal('rule'); } },
                    { key: 'del', icon: <Trash2 />, label: t('common.delete'), danger: true, onSelect: () => setDel({ kind: 'rule', id: r.id, name: r.name }) },
                  ]} />
                </div>
              ))}
            </RowCard>
          )}
        </Section>

        <Section title={t('bs.giftCards')} description={t('bs.giftCardsDesc')}>
          <Card>
            <Select label={t('bs.giftExpiry')} value={f.months === null ? '' : String(f.months)} onChange={(e) => setF({ ...f, months: e.target.value === '' ? null : Number(e.target.value) })}>
              {EXPIRY.map((m) => <option key={m ?? 'none'} value={m === null ? '' : String(m)}>{m === null ? t('bs.giftNever') : t('bs.giftMonths', { n: m })}</option>)}
            </Select>
          </Card>
        </Section>
      </div>

      <CustomMethodModal open={modal === 'custom'} cfg={cfg} id={edit} saving={saveList.isPending} onClose={() => setModal(null)} onSave={(list) => replace({ customMethods: list })} />
      <GatewayModal open={modal === 'gateway'} cfg={cfg} id={edit} saving={saveList.isPending} onClose={() => setModal(null)} onSave={(list) => replace({ redirectGateways: list })} />
      <RuleModal open={modal === 'rule'} cfg={cfg} id={edit} saving={saveList.isPending} methodName={methodName} onClose={() => setModal(null)} onSave={(list) => replace({ customizations: list })} />
      <ConfirmDialog open={!!del} danger onClose={() => setDel(null)} title={t('bs.deleteItemTitle', { name: del?.name ?? '' })} message={t('bs.deleteItemBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')}
        onConfirm={() => {
          if (!del) return;
          if (del.kind === 'custom') replace({ customMethods: cfg.customMethods.filter((m) => m.id !== del.id), customizations: cfg.customizations.filter((r) => r.method !== `manual:${del.id}`) });
          else if (del.kind === 'gateway') replace({ redirectGateways: cfg.redirectGateways.filter((g) => g.id !== del.id), customizations: cfg.customizations.filter((r) => r.method !== `redirect:${del.id}`) });
          else replace({ customizations: cfg.customizations.filter((r) => r.id !== del.id) });
        }} />
    </>
  );
}

function CustomMethodModal({ open, cfg, id, saving, onClose, onSave }: { open: boolean; cfg: PaymentsConfig; id: string | null; saving: boolean; onClose: () => void; onSave: (l: PaymentsConfig['customMethods']) => void }) {
  const { t } = useI18n();
  const cur = cfg.customMethods.find((m) => m.id === id);
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [seen, setSeen] = useState<string | null | undefined>(undefined);
  if (open && seen !== (id ?? '')) { setSeen(id ?? ''); setName(cur?.name ?? ''); setInstructions(cur?.instructions ?? ''); }
  if (!open && seen !== undefined) setSeen(undefined);
  return (
    <Modal open={open} onClose={onClose} closeLabel={t('common.close')} title={t(cur ? 'bs.editManual' : 'bs.addManual')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={saving} disabled={!name.trim()} onClick={() => onSave(cur ? cfg.customMethods.map((m) => (m.id === cur.id ? { ...m, name: name.trim(), instructions } : m)) : [...cfg.customMethods, { id: newId(cfg.customMethods.map((m) => m.id), name), name: name.trim(), instructions, enabled: true }])}>{t('save.save')}</Button></>}>
      <div className="flex flex-col gap-3">
        <Input label={t('bs.methodName')} placeholder={t('bs.methodNameExample')} value={name} onChange={(e) => setName(e.target.value)} />
        <Textarea label={t('payments.instructions')} help={t('bs.manualInstructionsHelp')} rows={4} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
      </div>
    </Modal>
  );
}

function GatewayModal({ open, cfg, id, saving, onClose, onSave }: { open: boolean; cfg: PaymentsConfig; id: string | null; saving: boolean; onClose: () => void; onSave: (l: PaymentsConfig['redirectGateways']) => void }) {
  const { t } = useI18n();
  const cur = cfg.redirectGateways.find((g) => g.id === id);
  const [f, setF] = useState({ name: '', redirectUrl: '', secret: '' });
  const [seen, setSeen] = useState<string | null | undefined>(undefined);
  const secretOf = () => Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => b.toString(16).padStart(2, '0')).join('');
  if (open && seen !== (id ?? '')) { setSeen(id ?? ''); setF({ name: cur?.name ?? '', redirectUrl: cur?.redirectUrl ?? '', secret: cur?.secret ?? secretOf() }); }
  if (!open && seen !== undefined) setSeen(undefined);
  const gid = cur?.id ?? newId(cfg.redirectGateways.map((g) => g.id), f.name);
  return (
    <Modal open={open} onClose={onClose} closeLabel={t('common.close')} title={t(cur ? 'bs.editGateway' : 'bs.addGateway')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={saving} disabled={!f.name.trim() || !/^https?:\/\//.test(f.redirectUrl)} onClick={() => onSave(cur ? cfg.redirectGateways.map((g) => (g.id === cur.id ? { ...g, ...f, name: f.name.trim() } : g)) : [...cfg.redirectGateways, { id: gid, ...f, name: f.name.trim(), enabled: true }])}>{t('save.save')}</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-muted">{t('bs.gatewayIntro')}</p>
        <Input label={t('bs.methodName')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Input label={t('bs.redirectUrl')} help={t('bs.redirectUrlHelp')} placeholder="https://pay.example.com/checkout?ref={reference}&amount={amount}&currency={currency}&return={return_url}" value={f.redirectUrl} onChange={(e) => setF({ ...f, redirectUrl: e.target.value.trim() })} />
        <Input label={t('bs.signingSecret')} help={t('bs.signingSecretHelp')} value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value.trim() })} />
        <div className="rounded-md bg-surface p-3 text-[13px]">
          <p className="font-medium">{t('bs.webhookTitle')}</p>
          <code className="block break-all text-xs">POST {window.location.origin}/webhooks/payments/{gid}</code>
          <p className="mt-1 text-muted">{t('bs.webhookHelp')}</p>
        </div>
      </div>
    </Modal>
  );
}

function RuleModal({ open, cfg, id, saving, methodName, onClose, onSave }: { open: boolean; cfg: PaymentsConfig; id: string | null; saving: boolean; methodName: (id: string) => string; onClose: () => void; onSave: (l: PaymentRule[]) => void }) {
  const { t, lang } = useI18n();
  const { shop } = useShop();
  const cur = cfg.customizations.find((r) => r.id === id);
  const blank = { name: '', action: 'hide' as PaymentRule['action'], method: '', newName: '', countries: '' as string, min: '', max: '' };
  const [f, setF] = useState(blank);
  const [seen, setSeen] = useState<string | null | undefined>(undefined);
  if (open && seen !== (id ?? '')) { setSeen(id ?? ''); setF(cur ? { name: cur.name, action: cur.action, method: cur.method, newName: cur.newName, countries: cur.countries.join(', '), min: major(cur.minTotal), max: major(cur.maxTotal) } : blank); }
  if (!open && seen !== undefined) setSeen(undefined);
  const ids = ['stripe', 'bank_transfer', 'cod', ...(cfg.testGateway ? ['test'] : []), ...cfg.customMethods.map((m) => `manual:${m.id}`), ...cfg.redirectGateways.map((g) => `redirect:${g.id}`)];
  const codes = f.countries.split(/[,\s]+/).map((c) => c.toUpperCase()).filter(Boolean);
  const valid = f.name.trim() && f.method && (f.action !== 'rename' || f.newName.trim());
  const build = (): PaymentRule => ({ id: cur?.id ?? newId(cfg.customizations.map((r) => r.id), f.name), name: f.name.trim(), enabled: cur?.enabled ?? true, action: f.action, method: f.method, newName: f.action === 'rename' ? f.newName.trim() : '', countries: codes, minTotal: minor(f.min), maxTotal: minor(f.max) });
  const names = new Map(countryOptions(lang).map((c) => [c.code, c.name]));
  return (
    <Modal open={open} onClose={onClose} closeLabel={t('common.close')} title={t(cur ? 'bs.editRule' : 'bs.addRule')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={saving} disabled={!valid} onClick={() => onSave(cur ? cfg.customizations.map((r) => (r.id === cur.id ? build() : r)) : [...cfg.customizations, build()])}>{t('save.save')}</Button></>}>
      <div className="flex flex-col gap-3">
        <Input label={t('bs.ruleName')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={t('bs.ruleAction')} value={f.action} onChange={(e) => setF({ ...f, action: e.target.value as PaymentRule['action'] })}>
            <option value="hide">{t('bs.action.hide')}</option><option value="rename">{t('bs.action.rename')}</option><option value="move_first">{t('bs.action.move_first')}</option>
          </Select>
          <Select label={t('bs.ruleMethod')} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
            <option value="" />{ids.map((m) => <option key={m} value={m}>{methodName(m)}</option>)}
          </Select>
        </div>
        {f.action === 'rename' && <Input label={t('bs.ruleNewName')} value={f.newName} onChange={(e) => setF({ ...f, newName: e.target.value })} />}
        <Input label={t('bs.ruleCountries')} help={t('bs.ruleCountriesHelp', { example: names.get('FR') ?? 'FR' })} placeholder="FR, BE" value={f.countries} onChange={(e) => setF({ ...f, countries: e.target.value })} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('bs.ruleMinTotal', { currency: shop.currency })} inputMode="decimal" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} />
          <Input label={t('bs.ruleMaxTotal', { currency: shop.currency })} inputMode="decimal" value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} />
        </div>
      </div>
    </Modal>
  );
}
