import { Banner, Button, Card, Dropdown, ImageUploader, Input, Skeleton, Switch, Textarea, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, ExternalLink, KeyRound, MoreHorizontal, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { UserErrors, gql, mutate } from '../../api';
import { SaveBar } from '../../components/SaveBar';
import { STORE_ACCESS_UPDATE, STORE_PREFERENCES } from '../../graphql';
import { useI18n } from '../../i18n';
import { StoreActions } from './Themes';

interface Access { shop: { id: string; name: string; description: string | null; shopmeStorefront: { passwordEnabled: boolean; password: string; passwordMessage: string | null; b2bOnly: boolean; homepageTitle: string; socialSharingImage: string } } }
interface Form { enabled: boolean; password: string; message: string; description: string; homepageTitle: string; socialImage: string; b2bOnly: boolean }

export function PreferencesPage() {
  const q = useQuery({ queryKey: ['store-preferences'], queryFn: () => gql<Access>(STORE_PREFERENCES) });
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  const s = q.data!.shop;
  const st = s.shopmeStorefront;
  return <PreferencesForm key={q.dataUpdatedAt} shopName={s.name} initial={{ enabled: st.passwordEnabled, password: st.password, message: st.passwordMessage ?? '', description: s.description ?? '', homepageTitle: st.homepageTitle, socialImage: st.socialSharingImage, b2bOnly: st.b2bOnly }} />;
}

function PreferencesForm({ initial, shopName }: { initial: Form; shopName: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));
  const save = useMutation({
    mutationFn: () => mutate(STORE_ACCESS_UPDATE, { input: {
      storefrontPasswordEnabled: f.enabled, storefrontPassword: f.password, storefrontPasswordMessage: f.message, description: f.description, homepageTitle: f.homepageTitle, socialSharingImage: f.socialImage, b2bOnly: f.b2bOnly,
    } }, 'shopmeShopUpdate'),
    onSuccess: () => { toast(t('prefs.saved')); setError(null); void qc.invalidateQueries({ queryKey: ['store-preferences'] }); void qc.invalidateQueries({ queryKey: ['store-access'] }); void qc.invalidateQueries({ queryKey: ['shop'] }); },
    onError: (e) => setError(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message),
  });
  const storeUrl = location.origin;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <StoreActions>
        <Dropdown align="right" variant="secondary" icon label={t('common.moreActions')} trigger={<MoreHorizontal className="size-4" />} items={[
          { key: 'view', label: t('bc.prefs.viewStore'), icon: <ExternalLink className="size-4" />, onSelect: () => window.open('/', '_blank', 'noopener') },
          { key: 'copy', label: t('bc.prefs.copyUrl'), icon: <Copy className="size-4" />, onSelect: () => { void navigator.clipboard?.writeText(storeUrl); toast(t('bc.prefs.copied')); } },
          { key: 'password', label: t(initial.enabled ? 'bc.prefs.passwordOff' : 'bc.prefs.passwordOn'), icon: <KeyRound className="size-4" />, separatorBefore: true, disabled: !initial.enabled && !f.password, onSelect: () => { set({ enabled: !f.enabled }); } },
        ]} />
      </StoreActions>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => { setF(initial); setError(null); }} />
      {error && <Banner>{error}</Banner>}
      <h2 className="-mb-2 text-[13px] font-semibold">{t('prefs.access')}</h2>
      <Card>
        <div className="flex flex-col gap-3">
          <Switch checked={f.enabled} onChange={(v) => set({ enabled: v })} label={t('prefs.passwordMode')} />
          <p className="text-[13px] text-muted">{t('prefs.passwordModeHelp')}</p>
          {f.enabled && (
            <div className="flex flex-col gap-3 rounded-lg bg-surface p-3">
              <Input label={t('field.password')} maxLength={100} help={t('prefs.charsUsed', { n: f.password.length, max: 100 })} value={f.password} onChange={(e) => set({ password: e.target.value })} />
              <Textarea label={t('prefs.message')} maxLength={5000} rows={4} help={t('prefs.charsUsed', { n: f.message.length, max: 5000 })} value={f.message} onChange={(e) => set({ message: e.target.value })} />
            </div>
          )}
          <div className="border-t border-line pt-3">
            <Switch checked={f.b2bOnly} onChange={(v) => set({ b2bOnly: v })} label={t('bc.prefs.b2bOnly')} description={t('bc.prefs.b2bOnlyHelp')} />
            <Link to="/customers/companies" className="mt-2 inline-flex items-center gap-1.5 text-[13px] text-accent hover:underline"><Users className="size-4" />{t('bc.prefs.manageCompanies')}</Link>
          </div>
        </div>
      </Card>
      <h2 className="-mb-2 mt-2 text-[13px] font-semibold">{t('prefs.seo')}</h2>
      <Card>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium">{t('bc.prefs.shareImage')}</span>
            {f.socialImage ? (
              <div className="flex flex-wrap items-start gap-3">
                <img src={f.socialImage} alt="" className="h-24 w-auto rounded-md border border-line object-contain" />
                <Button size="sm" onClick={() => set({ socialImage: '' })}>{t('common.remove')}</Button>
              </div>
            ) : <ImageUploader multiple={false} compact label={t('bc.prefs.addShareImage')} onUploaded={(files) => set({ socialImage: files[0]!.url })} onError={(m) => toast(m, 'critical')} />}
            <p className="text-xs text-muted">{t('bc.prefs.shareImageHelp')}</p>
          </div>
          <Input label={t('bc.prefs.homeTitle')} maxLength={70} placeholder={shopName} help={t('prefs.charsUsed', { n: f.homepageTitle.length, max: 70 })} value={f.homepageTitle} onChange={(e) => set({ homepageTitle: e.target.value })} />
          <Textarea label={t('prefs.homeDescription')} rows={3} help={t('prefs.homeDescriptionHelp')} value={f.description} onChange={(e) => set({ description: e.target.value })} />
        </div>
      </Card>
    </div>
  );
}
