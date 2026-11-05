import { Badge, Banner, Button, Card, Dropdown, EmptyState, IndexTable, Input, Modal, useToast } from '@shopme/ui';
import type { Column } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Coins, Globe, ListFilter, Network, PanelRight, Plus, Rocket, Search, ArrowUpDown, List as ListIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { gql, mutate } from '../../api';
import { LearnMore } from '../../components/LearnMore';
import { PageHeader } from '../../components/PageHeader';
import { searchCls, useListParams } from '../../components/shared';
import { gidToNum } from '../../format';
import { MARKETS_LIST, MARKET_CREATE } from '../../graphql';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';
import { useDebounced } from '../../lib/hooks';
import { countriesOf, CountryChip, CountryPicker, errText, type MarketRow } from './shared';
import { MarketGraph, MarketsSidePanel } from './MarketGraph';

type SortKey = 'NAME' | 'STATUS' | 'CREATED_AT';
const SORTS: SortKey[] = ['NAME', 'STATUS', 'CREATED_AT'];

export function MarketsPage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const L = useListParams();
  const [search, setSearch] = useState(L.get('q'));
  const term = useDebounced(search).trim();
  const status = L.get('status');
  const sortKey = (SORTS.includes(L.get('sort') as SortKey) ? L.get('sort') : 'NAME') as SortKey;
  const reverse = L.get('dir') === 'desc';
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<'list' | 'graph'>(() => { try { return localStorage.getItem('shopme.markets.view') === 'graph' ? 'graph' : 'list'; } catch { return 'list'; } });
  const [side, setSide] = useState(() => { try { return localStorage.getItem('shopme.markets.side') !== 'off'; } catch { return true; } });
  const remember = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };
  const query = [term, status && `status:${status.toLowerCase()}`].filter(Boolean).join(' ');

  const list = useQuery({
    queryKey: ['markets', query, sortKey, reverse],
    queryFn: () => gql<{ markets: { nodes: MarketRow[] }; shop: { currencyCode: string } }>(MARKETS_LIST, { query: query || null, sortKey, reverse }),
    placeholderData: (p) => p,
  });
  const rows = list.data?.markets.nodes ?? [];
  const columns: Array<Column<MarketRow>> = [
    { key: 'name', header: t('markets.col.market'), cell: (m) => <span className="flex items-center gap-2 font-medium"><Globe className="size-4 text-muted" aria-hidden />{m.name}{m.primary && <Badge tone="info">{t('markets.primary')}</Badge>}</span> },
    { key: 'status', header: t('markets.col.status'), cell: (m) => <Badge tone={m.status === 'ACTIVE' ? 'success' : 'neutral'}>{t(`markets.status.${m.status}` as Key)}</Badge> },
    {
      key: 'conditions', header: t('markets.col.conditions'), cell: (m) => {
        const cs = countriesOf(m);
        if (!cs.length) return <span className="text-muted">{t('markets.noCountries')}</span>;
        return <span className="flex flex-wrap items-center gap-1.5">{cs.slice(0, 3).map((c) => <CountryChip key={c.id} code={c.code} name={c.name} />)}{cs.length > 3 && <span className="text-[13px] text-muted">{t('markets.more', { n: cs.length - 3 })}</span>}</span>;
      },
    },
    {
      key: 'custom', header: t('markets.col.customizations'), cell: (m) => (
        <span className="flex items-center gap-2 text-muted">
          {(m.catalogsCount?.count ?? 0) > 0 && <span title={t('markets.customizationCatalog')}><BookOpen className="size-4" aria-label={t('markets.customizationCatalog')} /></span>}
          {!m.primary && m.currencySettings && m.currencySettings.baseCurrency.currencyCode !== list.data?.shop.currencyCode && <span title={t('markets.customizationCurrency')}><Coins className="size-4" aria-label={t('markets.customizationCurrency')} /></span>}
        </span>
      ),
    },
  ];
  const create = <Button variant="primary" onClick={() => setCreating(true)}><Plus className="size-4" />{t('markets.create')}</Button>;
  const filterItems = [{ key: '', label: t('markets.allStatuses') }, { key: 'ACTIVE', label: t('markets.status.ACTIVE') }, { key: 'DRAFT', label: t('markets.status.DRAFT') }]
    .map((o) => ({ key: o.key || 'all', label: <span className={status === o.key ? 'font-semibold' : ''}>{o.label}</span>, onSelect: () => L.patch({ status: o.key }) }));
  const sortItems = SORTS.flatMap((k) => (['asc', 'desc'] as const).map((d) => ({
    key: `${k}-${d}`, label: <span className={sortKey === k && reverse === (d === 'desc') ? 'font-semibold' : ''}>{t(`markets.sort.${k}` as Key)} · {t(`markets.sort.${d}` as Key)}</span>, onSelect: () => L.patch({ sort: k, dir: d === 'desc' ? 'desc' : '' }),
  })));

  const createMarket = useMutation({
    mutationFn: ({ name, countries }: { name: string; countries: string[] }) => mutate<{ market: { id: string } }>(MARKET_CREATE, {
      input: { name, status: 'DRAFT', conditions: { regionsCondition: { regions: countries.map((countryCode) => ({ countryCode })) } } },
    }, 'marketCreate'),
    onSuccess: (r) => { toast(t('markets.created')); void qc.invalidateQueries({ queryKey: ['markets'] }); setCreating(false); nav(`/markets/${gidToNum(r.market.id)}`); },
    onError: (e) => toast(errText(e), 'critical'),
  });

  return (
    <>
      <PageHeader icon={<Globe className="size-4" />} title={t('markets.title')} actions={<>
        <Link to="/markets/rollouts" className="btn btn-secondary"><Rocket className="size-4" />{t('bp.markets.rollouts')}</Link>
        <Button icon aria-label={t('bp.markets.toggleSide')} aria-pressed={side} onClick={() => { setSide(!side); remember('shopme.markets.side', side ? 'off' : 'on'); }}><PanelRight className="size-4" /></Button>
        {create}</>} />
      <div className={side ? 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]' : ''}>
      <div className="min-w-0">
      <Card className="!p-0">
        <div className="flex items-center gap-2 border-b border-line p-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
            <input type="search" value={search} onChange={(e) => { setSearch(e.target.value); L.patch({ q: e.target.value }); }} placeholder={t('markets.search')} aria-label={t('markets.search')} className={searchCls} />
          </div>
          <Button icon aria-label={t(view === 'list' ? 'bp.markets.graphView' : 'bp.markets.listView')} aria-pressed={view === 'graph'} onClick={() => { const next = view === 'list' ? 'graph' : 'list'; setView(next); remember('shopme.markets.view', next); }}>{view === 'list' ? <Network className="size-4" /> : <ListIcon className="size-4" />}</Button>
          <Dropdown align="right" label={t('markets.filter')} trigger={<ListFilter className="size-4" />} items={filterItems} />
          <Dropdown align="right" label={t('markets.sort')} trigger={<ArrowUpDown className="size-4" />} items={sortItems} />
        </div>
        {list.isError && <div className="p-3"><Banner>{(list.error as Error).message}</Banner></div>}
        {view === 'graph' ? <MarketGraph rows={rows} shopName={list.data?.shop.currencyCode ?? ''} onOpen={(id) => nav(`/markets/${gidToNum(id)}`)} /> : <IndexTable rows={rows} rowId={(r) => r.id} columns={columns} loading={list.isLoading} onRowClick={(r) => nav(`/markets/${gidToNum(r.id)}`)}
          empty={list.isError ? null : query ? <EmptyState icon={<Search className="size-10" />} title={t('markets.noResults')} /> : <EmptyState icon={<Globe className="size-10" />} title={t('markets.emptyTitle')} description={t('markets.emptyBody')} action={create} />} />}
      </Card>
      </div>
      {side && <MarketsSidePanel rows={rows} />}
      </div>
      <LearnMore topic={t('qaf.learn.markets')} />
      {creating && <CreateDialog busy={createMarket.isPending} onClose={() => setCreating(false)} onCreate={(name, countries) => createMarket.mutate({ name, countries })} taken={rows.filter((m) => !m.primary).flatMap((m) => countriesOf(m).map((c) => ({ code: c.code, market: m.name })))} />}
    </>
  );
}

function CreateDialog({ busy, onClose, onCreate, taken }: { busy: boolean; onClose: () => void; onCreate: (name: string, countries: string[]) => void; taken: Array<{ code: string; market: string }> }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [picking, setPicking] = useState(false);
  const [countries, setCountries] = useState<string[]>([]);
  const { lang } = useI18n();
  const names = (code: string) => { try { return new Intl.DisplayNames([lang], { type: 'region' }).of(code) ?? code; } catch { return code; } };
  return (
    <>
      <Modal open={!picking} onClose={onClose} title={t('markets.create.title')} closeLabel={t('common.close')}
        footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => onCreate(name.trim(), countries)}>{t('markets.create.submit')}</Button></>}>
        <div className="flex flex-col gap-3">
          <Input label={t('markets.create.name')} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <div>
            <p className="mb-1.5 text-[13px] font-medium">{t('markets.create.countries')}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {countries.map((c) => <CountryChip key={c} code={c} name={names(c)} />)}
              <Button size="sm" onClick={() => setPicking(true)}>{t('markets.editCountries')}</Button>
            </div>
          </div>
        </div>
      </Modal>
      {picking && <CountryPicker open title={t('markets.create.countries')} value={countries} taken={taken} onClose={() => setPicking(false)} onDone={(c) => { setCountries(c); setPicking(false); }} />}
    </>
  );
}
