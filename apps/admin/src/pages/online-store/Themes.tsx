import { Badge, Banner, Button, Card, Skeleton, cx, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Palette } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { gql, mutate } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { gidToNum } from '../../format';
import { THEMES, THEME_PUBLISH } from '../../graphql';
import { useT } from '../../i18n';
import type { Key } from '../../i18n';

const TABS: Array<{ to: string; key: Key; end?: boolean }> = [
  { to: '/online-store', key: 'store.themes', end: true }, { to: '/online-store/pages', key: 'store.pages' }, { to: '/online-store/navigation', key: 'store.navigation' },
];

export function OnlineStoreLayout() {
  const t = useT();
  return (
    <>
      <PageHeader title={t('nav.onlineStore')} actions={<a href="/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-line bg-canvas px-3 py-2 text-sm font-medium hover:bg-surface"><ExternalLink className="size-4" />{t('store.view')}</a>} />
      <nav aria-label={t('nav.onlineStore')} className="mb-4 flex gap-1 border-b border-line">
        {TABS.map((x) => <NavLink key={x.to} to={x.to} end={x.end} className={({ isActive }) => cx('-mb-px border-b-2 px-3 py-2 text-sm font-medium', isActive ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-fg')}>{t(x.key)}</NavLink>)}
      </nav>
      <Outlet />
    </>
  );
}

interface Theme { id: string; name: string; role: string }

export function ThemesPage() {
  const t = useT();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['themes'], queryFn: () => gql<{ themes: { nodes: Theme[] } }>(THEMES) });
  const publish = useMutation({
    mutationFn: (id: string) => mutate(THEME_PUBLISH, { id }, 'themePublish'),
    onSuccess: () => { toast(t('themes.published')); void qc.invalidateQueries({ queryKey: ['themes'] }); }, onError: (e) => toast(e.message, 'critical'),
  });
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  const themes = q.data?.themes.nodes ?? [];
  const current = themes.find((x) => x.role === 'MAIN') ?? themes[0];
  const others = themes.filter((x) => x !== current);
  const customize = (id: string) => nav(`/online-store/themes/${gidToNum(id)}/editor`);
  return (
    <div className="flex flex-col gap-4">
      {current ? (
        <Card title={t('themes.current')}>
          <div className="flex flex-wrap items-center gap-4">
            <div className="grid size-16 place-items-center rounded-lg bg-primary-subtle text-primary"><Palette className="size-7" /></div>
            <div className="flex-1"><p className="font-medium">{current.name}</p><Badge tone="success">{t('themes.live')}</Badge></div>
            <Button variant="primary" onClick={() => customize(current.id)}>{t('themes.customize')}</Button>
          </div>
        </Card>
      ) : <Card><p className="text-sm text-muted">{t('themes.none')}</p></Card>}
      {others.length > 0 && (
        <Card title={t('themes.library')}>
          <ul className="divide-y divide-line">
            {others.map((th) => (
              <li key={th.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="flex-1 font-medium">{th.name}</span><Badge>{th.role}</Badge>
                <Button size="sm" onClick={() => customize(th.id)}>{t('themes.customize')}</Button>
                <Button size="sm" loading={publish.isPending && publish.variables === th.id} onClick={() => publish.mutate(th.id)}>{t('themes.publish')}</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
