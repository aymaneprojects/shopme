import { Banner, Button, Card, Input, Select, Switch, useToast } from '@shopme/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { UserErrors, mutate } from '../../api';
import { Section } from '../../components/SettingsKit';
import { useI18n } from '../../i18n';
import { CHECKOUT_CONFIGURATION_UPDATE } from '../../graphql';
import type { CheckoutConfig } from '../../lib/config';

const radius = { pill: '999px', rounded: '8px', square: '2px' } as const;

/** Checkout look (colours, logo, button shape, header and footer text) and browser address autofill. Saved on its own, applied to the storefront checkout. */
export function CheckoutExtras({ id, config }: { id: string; config: CheckoutConfig }) {
  const { t } = useI18n();
  return <ExtrasForm key={JSON.stringify(config)} id={id} initial={config} t={t} />;
}

function ExtrasForm({ id, initial, t }: { id: string; initial: CheckoutConfig; t: ReturnType<typeof useI18n>['t'] }) {
  const [f, setF] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (value: CheckoutConfig) => mutate(CHECKOUT_CONFIGURATION_UPDATE, { id, config: value }, 'shopmeCheckoutConfigurationUpdate'),
    onSuccess: () => { toast(t('settings.saved')); setError(null); void qc.invalidateQueries({ queryKey: ['checkout-configurations'] }); void qc.invalidateQueries({ queryKey: ['config', 'CHECKOUT'] }); },
    onError: (e) => setError(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message),
  });
  const b = f.branding;
  const setB = (p: Partial<CheckoutConfig['branding']>) => setF({ ...f, branding: { ...b, ...p } });
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const accent = b.accentColor || '#1E40AF';
  const bg = b.backgroundColor || '#ffffff';
  const colorField = (label: string, key: 'accentColor' | 'backgroundColor', fallback: string) => (
    <div className="flex items-end gap-2">
      <Input className="flex-1" label={label} placeholder={fallback} value={b[key]} onChange={(e) => setB({ [key]: e.target.value.trim() })} error={b[key] && !/^#[0-9a-fA-F]{6}$/.test(b[key]) ? t('bs.colorInvalid') : null} />
      <input type="color" aria-label={label} value={b[key] || fallback} onChange={(e) => setB({ [key]: e.target.value })} className="h-10 w-12 cursor-pointer rounded-md border border-line bg-transparent p-1" />
    </div>
  );
  return (
    <>
      <Section title={t('bs.autofill')} description={t('bs.autofillDesc')}>
        <Card>
          <Switch placement="end" checked={f.addressAutocomplete} onChange={(v) => setF({ ...f, addressAutocomplete: v })} label={t('bs.autofillEnable')} />
        </Card>
      </Section>
      <Section title={t('bs.branding')} description={t('bs.brandingDesc')}>
        <Card>
          <div className="flex flex-col gap-4">
            {error && <Banner>{error}</Banner>}
            <div className="grid gap-3 sm:grid-cols-2">
              {colorField(t('bs.accentColor'), 'accentColor', '#1E40AF')}
              {colorField(t('bs.backgroundColor'), 'backgroundColor', '#ffffff')}
              <Input label={t('bs.logoUrl')} help={t('bs.logoUrlHelp')} placeholder="https://" value={b.logoUrl} onChange={(e) => setB({ logoUrl: e.target.value.trim() })} />
              <Select label={t('bs.buttonShape')} value={b.buttonShape} onChange={(e) => setB({ buttonShape: e.target.value as CheckoutConfig['branding']['buttonShape'] })}>
                <option value="pill">{t('bs.shape.pill')}</option><option value="rounded">{t('bs.shape.rounded')}</option><option value="square">{t('bs.shape.square')}</option>
              </Select>
              <Input label={t('bs.headerText')} maxLength={160} value={b.headerText} onChange={(e) => setB({ headerText: e.target.value })} />
              <Input label={t('bs.footerText')} maxLength={300} value={b.footerText} onChange={(e) => setB({ footerText: e.target.value })} />
            </div>
            <div aria-label={t('bs.brandingPreview')} className="overflow-hidden rounded-lg border border-line" style={{ background: bg }}>
              <div className="flex items-center gap-3 border-b border-black/10 px-4 py-3">
                {/^https?:\/\//.test(b.logoUrl) ? <img src={b.logoUrl} alt="" className="max-h-8" /> : <span className="font-semibold" style={{ color: accent }}>{t('bs.previewStore')}</span>}
                {b.headerText && <span className="text-xs text-neutral-500">{b.headerText}</span>}
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-4">
                <span className="text-[13px] text-neutral-700">{t('bs.previewTotal')}</span>
                <span className="px-5 py-2 text-[13px] font-medium text-white" style={{ background: accent, borderRadius: radius[b.buttonShape] }}>{t('bs.previewPay')}</span>
              </div>
              {b.footerText && <p className="border-t border-black/10 px-4 py-2 text-center text-xs text-neutral-500">{b.footerText}</p>}
            </div>
            <div className="flex justify-end gap-2">
              <Button disabled={!dirty} onClick={() => setF(initial)}>{t('save.discard')}</Button>
              <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(f)}>{t('bs.saveBranding')}</Button>
            </div>
          </div>
        </Card>
      </Section>
    </>
  );
}
