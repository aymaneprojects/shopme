import { Badge, Banner, Button, ConfirmDialog, Dropdown, Input, Modal, Select, Skeleton, useToast } from '@shopme/ui';
import { SettingsActions } from '../../components/SettingsKit';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { UserErrors, gql, mutate } from '../../api';
import { LOCALE_DOMAIN_UPDATE, MARKETS_COUNTRIES, SHOP_LOCALES, SHOP_LOCALE_DISABLE, SHOP_LOCALE_ENABLE, SHOP_LOCALE_UPDATE } from '../../graphql';
import { useI18n } from '../../i18n';

export interface ShopLocale { locale: string; name: string; primary: boolean; published: boolean; domain?: string | null }
export const useShopLocales = () => useQuery({ queryKey: ['shop-locales'], queryFn: async () => (await gql<{ shopLocales: ShopLocale[] }>(SHOP_LOCALES)).shopLocales });

const SUGGESTED = ['fr', 'en', 'es', 'de', 'it', 'pt', 'pt-BR', 'nl', 'sv', 'da', 'nb', 'fi', 'pl', 'cs', 'ro', 'hu', 'el', 'tr', 'ru', 'uk', 'ar', 'he', 'ja', 'ko', 'zh-CN', 'zh-TW'];
/** Main languages of a country, used to suggest languages for the markets of the store. */
const COUNTRY_LANGS: Record<string, string[]> = {
  FR: ['fr'], BE: ['fr', 'nl'], LU: ['fr', 'de'], CH: ['de', 'fr', 'it'], DE: ['de'], AT: ['de'], ES: ['es'], MX: ['es'], AR: ['es'], CO: ['es'], CL: ['es'], IT: ['it'], PT: ['pt'], BR: ['pt-BR'], NL: ['nl'],
  SE: ['sv'], DK: ['da'], NO: ['nb'], FI: ['fi'], PL: ['pl'], CZ: ['cs'], RO: ['ro'], HU: ['hu'], GR: ['el'], TR: ['tr'], UA: ['uk'], JP: ['ja'], KR: ['ko'], CN: ['zh-CN'], TW: ['zh-TW'], SA: ['ar'], AE: ['ar'], MA: ['ar', 'fr'], DZ: ['ar', 'fr'], TN: ['ar', 'fr'], IL: ['he'], RU: ['ru'], CA: ['fr', 'en'], US: ['en'], GB: ['en'], IE: ['en'], AU: ['en'],
};
const nameOf = (code: string, lang: string) => { try { return new Intl.DisplayNames([lang], { type: 'language' }).of(code) ?? code; } catch { return code; } };

export function LanguagesSettings() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
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
  const [addOpen, setAddOpen] = useState(false);
  const [domainFor, setDomainFor] = useState<{ locale: string; domain: string } | null>(null);
  const markets = useQuery({ queryKey: ['markets-countries'], queryFn: async () => (await gql<{ markets: { nodes: Array<{ name: string; regions: { nodes: Array<{ code?: string }> } }> } }>(MARKETS_COUNTRIES)).markets.nodes });
  const setDomain = useMutation({
    mutationFn: (v: { locale: string; domain: string }) => mutate(LOCALE_DOMAIN_UPDATE, { locale: v.locale, domain: v.domain || null }, 'shopmeLocaleDomainUpdate'),
    onSuccess: () => { toast(t('lang.updated')); setDomainFor(null); setError(null); refresh(); }, onError: (e) => setError(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message),
  });
  // Languages the store's markets speak and that are not on the store yet, with the market that suggests them.
  const suggestions = [...new Map((markets.data ?? []).flatMap((m) => m.regions.nodes.flatMap((r) => (r.code ? (COUNTRY_LANGS[r.code] ?? []).map((l) => [l, m.name] as const) : []))).filter(([l]) => !taken.has(l))).entries()].slice(0, 6);
  return (
    <>
      <SettingsActions><Button variant="primary" onClick={() => { setError(null); setAddOpen(true); }}>{t('lang.add')}</Button></SettingsActions>
      <p className="-mt-3 mb-4 text-[13px] text-muted">{t('lang.help')}</p>
      {q.isLoading && <Skeleton className="h-24" />}
      {q.error && <Banner>{q.error.message}</Banner>}
      {error && <div className="mb-3"><Banner>{error}</Banner></div>}
      <div className="overflow-hidden rounded-lg bg-canvas shadow-card">
        <div className="grid grid-cols-[1fr_10rem_8rem_2.5rem] gap-3 border-b border-line bg-surface px-4 py-2 text-[13px] text-muted"><span>{t('lang.col.language')}</span><span>{t('bs.domain')}</span><span>{t('field.status')}</span><span /></div>
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.locale} className="grid grid-cols-[1fr_10rem_8rem_2.5rem] items-center gap-3 px-4 py-3 text-[13px]">
              <span><span className="block font-medium first-letter:uppercase">{nameOf(r.locale, lang)}</span><span className="block text-xs text-muted">{r.primary ? t('lang.primary') : r.locale}</span></span>
              <span className="truncate text-muted" title={r.domain ?? undefined}>{r.domain ?? '—'}</span>
              <span><Badge tone={r.published || r.primary ? 'success' : 'neutral'}>{t(r.published || r.primary ? 'lang.published' : 'lang.unpublished')}</Badge></span>
              <span>
                {r.primary ? (
                  <Dropdown align="right" icon label={t('common.moreActions')} variant="plain" trigger={<MoreHorizontal className="size-4" />} items={[
                    { key: 'domain', label: t('bs.setDomain'), onSelect: () => setDomainFor({ locale: r.locale, domain: r.domain ?? '' }) },
                    { key: 'markets', label: t('bs.openMarkets'), onSelect: () => navigate('/markets') },
                  ]} />
                ) : (
                  <Dropdown align="right" icon label={t('common.moreActions')} variant="plain" trigger={<MoreHorizontal className="size-4" />} items={[
                    { key: 'domain', label: t('bs.setDomain'), onSelect: () => setDomainFor({ locale: r.locale, domain: r.domain ?? '' }) },
                    { key: 'translate', label: t('lang.translate'), onSelect: () => navigate(`/settings/languages/translate?locale=${encodeURIComponent(r.locale)}`) },
                    { key: 'publish', label: t(r.published ? 'lang.unpublish' : 'lang.publish'), onSelect: () => publish.mutate({ locale: r.locale, published: !r.published }) },
                    { key: 'remove', label: t('lang.remove'), danger: true, onSelect: () => setRemoving(r) },
                  ]} />
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {suggestions.length > 0 && (
        <div className="mt-4 rounded-lg bg-canvas p-4 shadow-card">
          <p className="text-[13px] font-medium">{t('bs.langSuggest')}</p>
          <p className="mb-2 text-[13px] text-muted">{t('bs.langSuggestDesc')}</p>
          <div className="flex flex-wrap gap-2">{suggestions.map(([code, market]) => <Button key={code} size="sm" loading={add.isPending && add.variables === code} onClick={() => add.mutate(code)}>{t('bs.langAddFor', { language: nameOf(code, lang), market })}</Button>)}</div>
        </div>
      )}
      {others.length > 0 && <div className="mt-3 flex justify-center"><Link to="/settings/languages/translate" className="btn btn-secondary">{t('lang.translate')}</Link></div>}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} closeLabel={t('common.close')} title={t('lang.add')}
        footer={<><Button onClick={() => setAddOpen(false)}>{t('common.cancel')}</Button><Button variant="primary" disabled={!adding} loading={add.isPending} onClick={() => add.mutate(adding, { onSuccess: () => setAddOpen(false) })}>{t('lang.add')}</Button></>}>
        <Select label={t('lang.choose')} value={adding} onChange={(e) => setAdding(e.target.value)}>
          <option value="">—</option>
          {options.map((c) => <option key={c} value={c}>{nameOf(c, lang)} ({c})</option>)}
        </Select>
      </Modal>
      <Modal open={!!domainFor} onClose={() => setDomainFor(null)} closeLabel={t('common.close')} title={t('bs.setDomain')}
        footer={<><Button onClick={() => setDomainFor(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={setDomain.isPending} onClick={() => domainFor && setDomain.mutate(domainFor)}>{t('save.save')}</Button></>}>
        {domainFor && <div className="flex flex-col gap-3">{error && <Banner>{error}</Banner>}<p className="text-[13px] text-muted">{t('bs.domainHelp', { language: nameOf(domainFor.locale, lang) })}</p><Input label={t('bs.domain')} placeholder="fr.example.com" value={domainFor.domain} onChange={(e) => setDomainFor({ ...domainFor, domain: e.target.value.trim().toLowerCase() })} /></div>}
      </Modal>
      <ConfirmDialog open={!!removing} danger onClose={() => setRemoving(null)} title={t('lang.removeTitle', { name: removing ? nameOf(removing.locale, lang) : '' })} message={t('lang.removeBody')}
        confirmLabel={t('lang.remove')} cancelLabel={t('common.cancel')} onConfirm={() => removing && remove.mutate(removing.locale)} />
    </>
  );
}
