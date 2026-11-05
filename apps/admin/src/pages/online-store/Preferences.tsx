import { Banner, Card, Input, Skeleton, Switch, Textarea, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { UserErrors, gql, mutate } from '../../api';
import { SaveBar } from '../../components/SaveBar';
import { STORE_ACCESS, STORE_ACCESS_UPDATE } from '../../graphql';
import { useI18n } from '../../i18n';

interface Access { shop: { id: string; name: string; description: string | null; shopmeStorefront: { passwordEnabled: boolean; password: string; passwordMessage: string | null } } }
interface Form { enabled: boolean; password: string; message: string; description: string }

export function PreferencesPage() {
  const q = useQuery({ queryKey: ['store-access'], queryFn: () => gql<Access>(STORE_ACCESS) });
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  const s = q.data!.shop;
  return <PreferencesForm key={q.dataUpdatedAt} initial={{ enabled: s.shopmeStorefront.passwordEnabled, password: s.shopmeStorefront.password, message: s.shopmeStorefront.passwordMessage ?? '', description: s.description ?? '' }} />;
}

function PreferencesForm({ initial }: { initial: Form }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));
  const save = useMutation({
    mutationFn: () => mutate(STORE_ACCESS_UPDATE, { input: { storefrontPasswordEnabled: f.enabled, storefrontPassword: f.password, storefrontPasswordMessage: f.message, description: f.description } }, 'shopmeShopUpdate'),
    onSuccess: () => { toast(t('prefs.saved')); setError(null); void qc.invalidateQueries({ queryKey: ['store-access'] }); void qc.invalidateQueries({ queryKey: ['shop'] }); },
    onError: (e) => setError(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message),
  });
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
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
        </div>
      </Card>
      <h2 className="-mb-2 mt-2 text-[13px] font-semibold">{t('prefs.seo')}</h2>
      <Card>
        <Textarea label={t('prefs.homeDescription')} rows={3} help={t('prefs.homeDescriptionHelp')} value={f.description} onChange={(e) => set({ description: e.target.value })} />
      </Card>
    </div>
  );
}
