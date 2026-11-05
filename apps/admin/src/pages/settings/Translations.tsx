import { Badge, Banner, Button, Card, Select, Skeleton, Textarea, cx, useToast } from '@shopme/ui';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { UserErrors, gql, mutate } from '../../api';
import { TRANSLATABLE_RESOURCES, TRANSLATIONS_REGISTER, TRANSLATIONS_REMOVE } from '../../graphql';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';
import { useShopLocales } from './Languages';

const TYPES = ['PRODUCT', 'COLLECTION', 'PAGE', 'ARTICLE', 'MENU', 'LINK', 'ONLINE_STORE_THEME'] as const;
interface Content { key: string; value: string | null; digest: string | null; type: string }
interface Resource { resourceId: string; translatableContent: Content[]; translations: Array<{ key: string; value: string | null; outdated: boolean }> }
interface Page { translatableResources: { nodes: Resource[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }

const titleOf = (r: Resource, fallback: string) => r.translatableContent.find((c) => c.key === 'title')?.value ?? r.translatableContent[0]?.value?.slice(0, 60) ?? fallback;

/** Side-by-side editor: original text on the left, translation on the right, for every translatable field of a resource. */
function Editor({ resource, locale, primary, onSaved }: { resource: Resource; locale: string; primary: string; onSaved: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const saved = new Map(resource.translations.map((x) => [x.key, x]));
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const value = (k: string) => draft[k] ?? saved.get(k)?.value ?? '';
  const changed = resource.translatableContent.filter((c) => c.key in draft && draft[c.key] !== (saved.get(c.key)?.value ?? ''));
  const save = useMutation({
    mutationFn: async () => {
      const set = changed.filter((c) => draft[c.key]!.trim());
      const clear = changed.filter((c) => !draft[c.key]!.trim() && saved.has(c.key));
      if (set.length) await mutate(TRANSLATIONS_REGISTER, { resourceId: resource.resourceId, translations: set.map((c) => ({ locale, key: c.key, value: draft[c.key], translatableContentDigest: c.digest })) }, 'translationsRegister');
      if (clear.length) await mutate(TRANSLATIONS_REMOVE, { resourceId: resource.resourceId, translationKeys: clear.map((c) => c.key), locales: [locale] }, 'translationsRemove');
    },
    onSuccess: () => { toast(t('tr.saved')); setDraft({}); setError(null); onSaved(); },
    onError: (e) => setError(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message),
  });
  return (
    <div className="flex flex-col gap-3">
      {error && <Banner>{error}</Banner>}
      <div className="hidden grid-cols-2 gap-3 text-xs font-medium text-muted md:grid"><span>{t('tr.source', { locale: primary })}</span><span>{t('tr.translation', { locale })}</span></div>
      {resource.translatableContent.map((c) => (
        <div key={c.key} className="grid gap-3 border-b border-line pb-3 last:border-0 md:grid-cols-2">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs text-muted"><code>{c.key}</code>{saved.get(c.key)?.outdated && <Badge tone="warning">{t('tr.outdated')}</Badge>}</div>
            <div className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface p-2 text-sm">{c.value}</div>
          </div>
          <Textarea label={t('tr.translation', { locale })} className="[&_label]:md:sr-only" rows={c.type === 'SINGLE_LINE_TEXT_FIELD' ? 2 : 6} value={value(c.key)} onChange={(e) => setDraft((d) => ({ ...d, [c.key]: e.target.value }))} />
        </div>
      ))}
      <div className="sticky bottom-0 flex justify-end bg-canvas py-2"><Button variant="primary" disabled={!changed.length} loading={save.isPending} onClick={() => save.mutate()}>{t('tr.save')}</Button></div>
    </div>
  );
}

export function TranslationsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const locales = useShopLocales();
  const [sp, setSp] = useSearchParams();
  const others = (locales.data ?? []).filter((l) => !l.primary);
  const primary = locales.data?.find((l) => l.primary)?.locale ?? 'en';
  const locale = sp.get('locale') && others.some((l) => l.locale === sp.get('locale')) ? sp.get('locale')! : others[0]?.locale ?? '';
  const type = (TYPES as readonly string[]).includes(sp.get('type') ?? '') ? sp.get('type')! : 'PRODUCT';
  const [selected, setSelected] = useState<string | null>(null);
  const q = useInfiniteQuery({
    queryKey: ['translatable', type, locale], enabled: !!locale, initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => gql<Page>(TRANSLATABLE_RESOURCES, { resourceType: type, first: 50, after: pageParam, locale }),
    getNextPageParam: (p) => (p.translatableResources.pageInfo.hasNextPage ? p.translatableResources.pageInfo.endCursor : undefined),
  });
  const resources = q.data?.pages.flatMap((p) => p.translatableResources.nodes) ?? [];
  const current = resources.find((r) => r.resourceId === selected) ?? null;
  const patch = (k: string, v: string) => { const n = new URLSearchParams(sp); n.set(k, v); setSp(n, { replace: true }); setSelected(null); };

  if (locales.isLoading) return <Skeleton className="h-40" />;
  if (!locale) return <Card title={t('tr.title')}><p className="mb-3 text-sm text-muted">{t('tr.noLocales')}</p><Link to="/settings/languages" className="text-sm text-primary underline">{t('tr.addLanguage')}</Link></Card>;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <h2 className="mr-auto text-lg font-semibold">{t('tr.title')}</h2>
        <Select className="w-auto" label={t('tr.locale')} value={locale} onChange={(e) => patch('locale', e.target.value)}>{others.map((l) => <option key={l.locale} value={l.locale}>{l.name} ({l.locale})</option>)}</Select>
        <Select className="w-auto" label={t('tr.resources')} value={type} onChange={(e) => patch('type', e.target.value)}>{TYPES.map((x) => <option key={x} value={x}>{t(`tr.type.${x}` as Key)}</option>)}</Select>
      </div>
      {q.error && <Banner>{q.error.message}</Banner>}
      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <Card title={t('tr.resources')}>
          {q.isLoading && <Skeleton className="h-32" />}
          {q.data && resources.length === 0 && <p className="text-sm text-muted">{t('tr.empty')}</p>}
          <ul className="flex max-h-[32rem] flex-col gap-0.5 overflow-y-auto">
            {resources.map((r) => (
              <li key={r.resourceId}>
                <button type="button" onClick={() => setSelected(r.resourceId)} aria-current={r.resourceId === selected}
                  className={cx('flex w-full flex-col rounded-md px-2 py-1.5 text-left text-sm', r.resourceId === selected ? 'bg-primary-subtle text-primary' : 'hover:bg-surface')}>
                  <span className="truncate">{titleOf(r, t('tr.untitled'))}</span>
                  <span className="text-xs text-muted">{t('tr.translated', { done: r.translations.length, total: r.translatableContent.length })}</span>
                </button>
              </li>
            ))}
          </ul>
          {q.hasNextPage && <div className="mt-2"><Button size="sm" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>{t('tr.more')}</Button></div>}
        </Card>
        <Card title={current ? titleOf(current, t('tr.untitled')) : undefined}>
          {current ? <Editor key={`${current.resourceId}:${locale}`} resource={current} locale={locale} primary={primary} onSaved={() => void qc.invalidateQueries({ queryKey: ['translatable', type, locale] })} /> : <p className="py-8 text-center text-sm text-muted">{t('tr.select')}</p>}
        </Card>
      </div>
    </div>
  );
}
