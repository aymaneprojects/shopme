import { Button, Select } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { gql } from '../../api';
import { THEME_SETTING_RESOURCES } from '../../graphql';
import { useI18n } from '../../i18n';

type Kind = 'collection' | 'product' | 'page' | 'blog';
const FIELD: Record<Kind, 'collections' | 'products' | 'pages' | 'blogs'> = { collection: 'collections', product: 'products', page: 'pages', blog: 'blogs' };
interface Res { collections: Page; products: Page; pages: Page; blogs: Page }
interface Page { nodes: Array<{ handle: string; title: string }> }

/** A theme setting that points at a collection, product, page or blog: a list of the store's own, stored by handle. */
export function ResourceSelect({ kind, label, info, value, onChange }: { kind: Kind; label: string; info?: string; value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const q = useQuery({ queryKey: ['theme-setting-resources'], staleTime: 60_000, retry: false, queryFn: () => gql<Res>(THEME_SETTING_RESOURCES) });
  const rows = q.data?.[FIELD[kind]].nodes ?? [];
  const known = rows.some((r) => r.handle === value);
  return (
    <div className="flex flex-col gap-1.5">
      <Select label={label} help={info} error={q.isError ? t('bs.pick.loadError') : undefined} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('bs.pick.none')}</option>
        {rows.map((r) => <option key={r.handle} value={r.handle}>{r.title}</option>)}
        {value && !known && <option value={value}>{value}</option>}
      </Select>
      {q.isError && <Button size="sm" variant="plain" className="self-start" aria-label={t('bs.pick.retry', { label })} loading={q.isFetching} onClick={() => { void q.refetch(); }}>{t('bs.pick.retryAction')}</Button>}
    </div>
  );
}
