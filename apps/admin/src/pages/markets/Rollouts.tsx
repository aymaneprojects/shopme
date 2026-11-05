import { Badge, Banner, Button, Card, EmptyState, IndexTable, Input, Modal, useToast } from '@shopme/ui';
import type { Column } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Rocket } from 'lucide-react';
import { useState } from 'react';
import { gql, mutate } from '../../api';
import { toLocalInput } from '../../components/PublishCards';
import { PageHeader } from '../../components/PageHeader';
import { useFormat } from '../../components/shared';
import { MARKETS_LIST, MARKET_LAUNCH_SCHEDULE, MARKET_UPDATE } from '../../graphql';
import { useI18n } from '../../i18n';
import { countriesOf, errText, type MarketRow } from './shared';

/** Staged rollout of the markets: every draft market can get a launch time, and goes live by itself then. */
export function RolloutsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const fmt = useFormat();
  const [planning, setPlanning] = useState<{ market: MarketRow; at: string } | null>(null);
  const list = useQuery({ queryKey: ['markets', '', 'NAME', false], queryFn: () => gql<{ markets: { nodes: MarketRow[] } }>(MARKETS_LIST, { query: null, sortKey: 'NAME', reverse: false }) });
  const rows = (list.data?.markets.nodes ?? []).filter((m) => !m.primary);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['markets'] }); void qc.invalidateQueries({ queryKey: ['market'] }); };
  const schedule = useMutation({
    mutationFn: ({ id, launchAt }: { id: string; launchAt: string | null }) => mutate(MARKET_LAUNCH_SCHEDULE, { id, launchAt }, 'shopmeMarketLaunchSchedule'),
    onSuccess: (_d, v) => { toast(t(v.launchAt ? 'bp.rollouts.planned' : 'bp.rollouts.cleared')); setPlanning(null); refresh(); },
    onError: (e) => toast(errText(e), 'critical'),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ACTIVE' | 'DRAFT' }) => mutate(MARKET_UPDATE, { id, input: { status } }, 'marketUpdate'),
    onSuccess: () => { toast(t('markets.saved')); refresh(); },
    onError: (e) => toast(errText(e), 'critical'),
  });
  const columns: Array<Column<MarketRow>> = [
    { key: 'name', header: t('markets.col.market'), cell: (m) => <span className="font-medium">{m.name}</span> },
    { key: 'countries', header: t('markets.col.conditions'), cell: (m) => <span className="text-muted">{t('bp.rollouts.countries', { n: countriesOf(m).length, $count: countriesOf(m).length })}</span> },
    { key: 'status', header: t('markets.col.status'), cell: (m) => <Badge tone={m.status === 'ACTIVE' ? 'success' : m.shopmeLaunchAt ? 'info' : 'neutral'}>{m.status === 'DRAFT' && m.shopmeLaunchAt ? t('bp.rollouts.scheduled') : t(`markets.status.${m.status}` as 'markets.status.ACTIVE')}</Badge> },
    { key: 'launch', header: t('bp.rollouts.launch'), cell: (m) => (m.shopmeLaunchAt ? fmt.dateTime(m.shopmeLaunchAt) : <span className="text-muted">—</span>) },
    {
      key: 'actions', header: '', className: 'w-72 text-right', cell: (m) => (
        <span className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          {m.status === 'DRAFT' ? (
            <>
              <Button size="sm" onClick={() => setPlanning({ market: m, at: m.shopmeLaunchAt ? toLocalInput(m.shopmeLaunchAt) : toLocalInput(new Date(Date.now() + 86_400_000).toISOString()) })}>{t(m.shopmeLaunchAt ? 'bp.rollouts.reschedule' : 'bp.rollouts.plan')}</Button>
              {m.shopmeLaunchAt && <Button size="sm" onClick={() => schedule.mutate({ id: m.id, launchAt: null })}>{t('bp.rollouts.clear')}</Button>}
              <Button size="sm" variant="primary" onClick={() => setStatus.mutate({ id: m.id, status: 'ACTIVE' })}>{t('bp.rollouts.launchNow')}</Button>
            </>
          ) : <Button size="sm" onClick={() => setStatus.mutate({ id: m.id, status: 'DRAFT' })}>{t('bp.rollouts.pause')}</Button>}
        </span>
      ),
    },
  ];
  return (
    <>
      <PageHeader large back="/markets" breadcrumb={{ icon: <Rocket className="size-4" />, label: t('markets.title'), to: '/markets' }} title={t('bp.markets.rollouts')} subtitle={t('bp.rollouts.help')} />
      {list.isError && <Banner>{(list.error as Error).message}</Banner>}
      <Card className="!p-0">
        <IndexTable rows={rows} rowId={(r) => r.id} columns={columns} loading={list.isLoading}
          empty={<EmptyState icon={<Rocket className="size-10" />} title={t('bp.rollouts.emptyTitle')} description={t('bp.rollouts.emptyBody')} />} />
      </Card>
      <Modal open={!!planning} onClose={() => setPlanning(null)} closeLabel={t('common.close')} title={t('bp.rollouts.planTitle', { name: planning?.market.name ?? '' })}
        footer={<><Button onClick={() => setPlanning(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={schedule.isPending} disabled={!planning?.at} onClick={() => planning && schedule.mutate({ id: planning.market.id, launchAt: new Date(planning.at).toISOString() })}>{t('bp.rollouts.save')}</Button></>}>
        {planning && (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-muted">{t('bp.rollouts.planHelp')}</p>
            <Input type="datetime-local" label={t('bp.rollouts.launch')} value={planning.at} onChange={(e) => setPlanning({ ...planning, at: e.target.value })} />
          </div>
        )}
      </Modal>
    </>
  );
}
