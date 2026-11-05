import { Badge, Banner, Button, Card, ConfirmDialog, Select, Skeleton, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { UserErrors, gql, mutate } from '../../api';
import { SHOP_LOCALES, SHOP_LOCALE_DISABLE, SHOP_LOCALE_ENABLE, SHOP_LOCALE_UPDATE } from '../../graphql';
import { useI18n } from '../../i18n';

export interface ShopLocale { locale: string; name: string; primary: boolean; published: boolean }
export const useShopLocales = () => useQuery({ queryKey: ['shop-locales'], queryFn: async () => (await gql<{ shopLocales: ShopLocale[] }>(SHOP_LOCALES)).shopLocales });

const SUGGESTED = ['fr', 'en', 'es', 'de', 'it', 'pt', 'pt-BR', 'nl', 'sv', 'da', 'nb', 'fi', 'pl', 'cs', 'ro', 'hu', 'el', 'tr', 'ru', 'uk', 'ar', 'he', 'ja', 'ko', 'zh-CN', 'zh-TW'];
const nameOf = (code: string, lang: string) => { try { return new Intl.DisplayNames([lang], { type: 'language' }).of(code) ?? code; } catch { return code; } };

export function LanguagesSettings() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useShopLocales();
  const [adding, setAdding] = useState('');
  const [removing, setRemoving] = useState<ShopLocale | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['shop-locales'] });
  const onError = (e: Error) => setError(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message);
  const add = useMutation({ mutationFn: (locale: string) => mutate(SHOP_LOCALE_ENABLE, { locale }, 'shopLocaleEnable'), onSuccess: () => { toast(t('lang.added')); setAdding(''); setError(null); refresh(); }, onError });
  const publish = useMutation({ mutationFn: (v: { locale: string; published: boolean }) => mutate(SHOP_LOCALE_UPDATE, v, 'shopLocaleUpdate'), onSuccess: () => { toast(t('lang.updated')); setError(null); refresh(); }, onError });
  const remove = useMutation({ mutationFn: (locale: string) => mutate(SHOP_LOCALE_DISABLE, { locale }, 'shopLocaleDisable'), onSuccess: () => { toast(t('lang.removed')); setRemoving(null); refresh(); }, onError: (e) => { setRemoving(null); onError(e); } });
  const rows = q.data ?? [];
  const taken = new Set(rows.map((r) => r.locale));
  const options = SUGGESTED.filter((c) => !taken.has(c));
  const others = rows.filter((r) => !r.primary);
  return (
    <div className="flex flex-col gap-4">
      <Card title={t('lang.title')} actions={others.length ? <Link to="/settings/languages/translate" className="btn btn-secondary btn-sm">{t('lang.translate')}</Link> : undefined}>
        <p className="mb-3 text-[13px] text-muted">{t('lang.help')}</p>
        {q.isLoading && <Skeleton className="h-24" />}
        {q.error && <Banner>{q.error.message}</Banner>}
        {error && <div className="mb-3"><Banner>{error}</Banner></div>}
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.locale} className="flex flex-wrap items-center gap-2 py-3 text-[13px]">
              <span className="font-medium">{nameOf(r.locale, lang)}</span><code className="text-xs text-muted">{r.locale}</code>
              {r.primary ? <Badge tone="info">{t('lang.primary')}</Badge> : <Badge tone={r.published ? 'success' : 'neutral'}>{t(r.published ? 'lang.published' : 'lang.unpublished')}</Badge>}
              {!r.primary && (
                <div className="ml-auto flex flex-wrap gap-2">
                  <Link to={`/settings/languages/translate?locale=${encodeURIComponent(r.locale)}`} className="rounded-md border border-line px-2.5 py-1 text-xs font-medium hover:bg-surface">{t('lang.translate')}</Link>
                  <Button size="sm" loading={publish.isPending && publish.variables?.locale === r.locale} onClick={() => publish.mutate({ locale: r.locale, published: !r.published })}>{t(r.published ? 'lang.unpublish' : 'lang.publish')}</Button>
                  <Button size="sm" variant="danger" onClick={() => setRemoving(r)}>{t('lang.remove')}</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card title={t('lang.add')}>
        <div className="flex flex-wrap items-end gap-3">
          <Select className="w-64" label={t('lang.choose')} value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">—</option>
            {options.map((c) => <option key={c} value={c}>{nameOf(c, lang)} ({c})</option>)}
          </Select>
          <Button variant="primary" disabled={!adding} loading={add.isPending} onClick={() => add.mutate(adding)}><Plus className="size-4" />{t('lang.add')}</Button>
        </div>
      </Card>
      <ConfirmDialog open={!!removing} danger onClose={() => setRemoving(null)} title={t('lang.removeTitle', { name: removing ? nameOf(removing.locale, lang) : '' })} message={t('lang.removeBody')}
        confirmLabel={t('lang.remove')} cancelLabel={t('common.cancel')} onConfirm={() => removing && remove.mutate(removing.locale)} />
    </div>
  );
}
