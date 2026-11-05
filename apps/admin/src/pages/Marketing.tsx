import { Badge, Banner, Button, Card, ConfirmDialog, EmptyState, IndexTable, Input, Modal, Select, Textarea, useToast } from '@shopme/ui';
import type { Column } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Megaphone, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { gql, mutate } from '../api';
import { LearnMore } from '../components/LearnMore';
import { PageHeader } from '../components/PageHeader';
import { useFormat } from '../components/shared';
import { CAMPAIGN_CREATE, CAMPAIGN_DELETE, CAMPAIGN_UPDATE, MARKETING_PAGE } from '../graphql';
import { useT } from '../i18n';
import type { Key } from '../i18n';
import { useStoreInfo } from '../lib/storeInfo';
import { useShop } from '../session';

interface Campaign { id: string; name: string; channel: string; status: 'DRAFT' | 'ACTIVE' | 'ENDED'; utmSource: string | null; utmMedium: string | null; utmCampaign: string | null; budget: string; startsAt: string | null; endsAt: string | null; notes: string | null; orders: number; sales: string }
interface Row { source: string; medium: string; campaign: string; orders: number; visits: number; sales: string }
interface Data { shopmeMarketingCampaigns: Campaign[]; shopmeAttribution: { totalOrders: number; attributedOrders: number; totalSales: string; rows: Row[] } }
const CHANNELS = ['email', 'social', 'search', 'display', 'affiliate', 'influencer', 'other'];
const STATUS_TONE = { DRAFT: 'neutral', ACTIVE: 'success', ENDED: 'attention' } as const;
const DAYS = [7, 30, 90];

interface Form { name: string; channel: string; utmSource: string; utmMedium: string; utmCampaign: string; budget: string; status: string; startsAt: string; endsAt: string; notes: string }
const blank: Form = { name: '', channel: 'email', utmSource: '', utmMedium: '', utmCampaign: '', budget: '', status: 'ACTIVE', startsAt: '', endsAt: '', notes: '' };
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

function CampaignDialog({ editing, onClose, onDone }: { editing: Campaign | null; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const store = useStoreInfo();
  const [f, setF] = useState<Form>(editing ? { name: editing.name, channel: editing.channel, utmSource: editing.utmSource ?? '', utmMedium: editing.utmMedium ?? '', utmCampaign: editing.utmCampaign ?? '', budget: Number(editing.budget) ? editing.budget : '', status: editing.status, startsAt: day(editing.startsAt), endsAt: day(editing.endsAt), notes: editing.notes ?? '' } : blank);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<Form>) => setF({ ...f, ...p });
  const link = (() => {
    if (!f.utmSource && !f.utmMedium && !f.utmCampaign) return '';
    const u = new URL(store.url || window.location.origin);
    for (const [k, v] of [['utm_source', f.utmSource], ['utm_medium', f.utmMedium], ['utm_campaign', f.utmCampaign]] as const) if (v.trim()) u.searchParams.set(k, v.trim());
    return u.toString();
  })();
  const save = useMutation({
    mutationFn: () => {
      const input = { name: f.name, channel: f.channel, utmSource: f.utmSource || null, utmMedium: f.utmMedium || null, utmCampaign: f.utmCampaign || null, budget: f.budget.trim().replace(',', '.') || '0', status: f.status, startsAt: f.startsAt ? `${f.startsAt}T00:00:00Z` : null, endsAt: f.endsAt ? `${f.endsAt}T23:59:59Z` : null, notes: f.notes || null };
      return editing ? mutate(CAMPAIGN_UPDATE, { id: editing.id, input }, 'shopmeMarketingCampaignUpdate') : mutate(CAMPAIGN_CREATE, { input }, 'shopmeMarketingCampaignCreate');
    },
    onSuccess: () => { toast(t(editing ? 'btn.mkt.saved' : 'btn.mkt.created')); onDone(); onClose(); }, onError: (e: Error) => setError(e.message),
  });
  return (
    <Modal open onClose={onClose} title={t(editing ? 'btn.mkt.editTitle' : 'btn.mkt.createTitle')} closeLabel={t('common.close')} wide
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={save.isPending} disabled={!f.name.trim()} onClick={() => { setError(null); save.mutate(); }}>{t('save.save')}</Button></>}>
      {error && <div className="mb-3"><Banner>{error}</Banner></div>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Input label={t('btn.mkt.name')} value={f.name} maxLength={200} onChange={(e) => set({ name: e.target.value })} /></div>
        <Select label={t('btn.mkt.channel')} value={f.channel} onChange={(e) => set({ channel: e.target.value })}>{CHANNELS.map((c) => <option key={c} value={c}>{t(`btn.mkt.channel.${c}` as Key)}</option>)}</Select>
        <Select label={t('field.status')} value={f.status} onChange={(e) => set({ status: e.target.value })}>{(['DRAFT', 'ACTIVE', 'ENDED'] as const).map((s) => <option key={s} value={s}>{t(`btn.mkt.status.${s}` as Key)}</option>)}</Select>
        <Input label={t('btn.mkt.utmSource')} value={f.utmSource} onChange={(e) => set({ utmSource: e.target.value })} />
        <Input label={t('btn.mkt.utmMedium')} value={f.utmMedium} onChange={(e) => set({ utmMedium: e.target.value })} />
        <div className="sm:col-span-2"><Input label={t('btn.mkt.utmCampaign')} value={f.utmCampaign} help={t('btn.mkt.utmHelp')} onChange={(e) => set({ utmCampaign: e.target.value })} /></div>
        {link && (
          <div className="sm:col-span-2 flex items-center gap-2 rounded-lg bg-surface p-2 text-xs">
            <code className="min-w-0 flex-1 break-all">{link}</code>
            <Button size="sm" icon aria-label={t('btn.mkt.copyLink')} onClick={() => { void navigator.clipboard?.writeText(link).then(() => toast(t('btn.mkt.linkCopied'))); }}><Copy className="size-4" /></Button>
          </div>
        )}
        <Input label={t('btn.mkt.budget')} inputMode="decimal" value={f.budget} onChange={(e) => set({ budget: e.target.value })} />
        <span />
        <Input type="date" label={t('btn.mkt.starts')} value={f.startsAt} onChange={(e) => set({ startsAt: e.target.value })} />
        <Input type="date" label={t('btn.mkt.ends')} value={f.endsAt} onChange={(e) => set({ endsAt: e.target.value })} />
        <div className="sm:col-span-2"><Textarea label={t('btn.mkt.notes')} value={f.notes} maxLength={2000} onChange={(e) => set({ notes: e.target.value })} /></div>
      </div>
    </Modal>
  );
}

export function MarketingPage() {
  const t = useT();
  const fmt = useFormat();
  const toast = useToast();
  const qc = useQueryClient();
  const { shop } = useShop();
  const [days, setDays] = useState(30);
  const [dialog, setDialog] = useState<Campaign | 'new' | null>(null);
  const [removing, setRemoving] = useState<Campaign | null>(null);
  const q = useQuery({
    queryKey: ['marketing', days],
    queryFn: () => gql<Data>(MARKETING_PAGE, { from: new Date(Date.now() - days * 86_400_000).toISOString(), to: new Date(Date.now() + 86_400_000).toISOString() }),
  });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['marketing'] }); void qc.invalidateQueries({ queryKey: ['home-growth'] }); };
  const del = useMutation({
    mutationFn: (id: string) => mutate(CAMPAIGN_DELETE, { id }, 'shopmeMarketingCampaignDelete'),
    onSuccess: () => { setRemoving(null); toast(t('btn.mkt.deleted')); refresh(); }, onError: (e: Error) => { setRemoving(null); toast(e.message, 'critical'); },
  });
  const d = q.data;
  const money = (amount: string) => fmt.money({ amount, currencyCode: shop.currency });
  const campaigns = d?.shopmeMarketingCampaigns ?? [];
  const tags = (c: { utmSource: string | null; utmMedium: string | null; utmCampaign: string | null }) => [c.utmSource, c.utmMedium, c.utmCampaign].filter(Boolean).join(' / ') || '—';

  const campaignCols: Array<Column<Campaign>> = [
    { key: 'name', header: t('btn.mkt.name'), cell: (c) => <span className="font-medium">{c.name}</span> },
    { key: 'channel', header: t('btn.mkt.channel'), cell: (c) => t(`btn.mkt.channel.${c.channel}` as Key) },
    { key: 'status', header: t('field.status'), cell: (c) => <Badge tone={STATUS_TONE[c.status]}>{t(`btn.mkt.status.${c.status}` as Key)}</Badge> },
    { key: 'utm', header: t('btn.mkt.utm'), cell: (c) => <span className="text-muted">{tags(c)}</span> },
    { key: 'budget', header: t('btn.mkt.budget'), cell: (c) => (Number(c.budget) ? money(c.budget) : '—') },
    { key: 'orders', header: t('nav.orders'), cell: (c) => c.orders },
    { key: 'sales', header: t('btn.stat.sales'), cell: (c) => money(c.sales) },
    {
      key: 'act', header: '', className: 'text-right',
      cell: (c) => (
        <span className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" icon aria-label={t('common.edit')} onClick={() => setDialog(c)}><Pencil className="size-4" /></Button>
          <Button size="sm" icon aria-label={t('common.delete')} onClick={() => setRemoving(c)}><Trash2 className="size-4" /></Button>
        </span>
      ),
    },
  ];
  const attrCols: Array<Column<Row>> = [
    { key: 'source', header: t('btn.mkt.source'), cell: (r) => <span className="font-medium">{r.source}</span> },
    { key: 'medium', header: t('btn.mkt.utmMedium'), cell: (r) => r.medium || '—' },
    { key: 'campaign', header: t('btn.mkt.utmCampaign'), cell: (r) => r.campaign || '—' },
    { key: 'visits', header: t('btn.mkt.pageViews'), cell: (r) => r.visits },
    { key: 'orders', header: t('nav.orders'), cell: (r) => r.orders },
    { key: 'sales', header: t('btn.stat.sales'), cell: (r) => money(r.sales) },
  ];

  return (
    <>
      <PageHeader back="/" icon={<Megaphone className="size-4" />} title={t('btn.mkt.title')} actions={<Button variant="primary" onClick={() => setDialog('new')}><Plus className="size-4" />{t('btn.mkt.create')}</Button>} />
      {q.isError && <div className="mb-3"><Banner>{(q.error as Error).message}</Banner></div>}
      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <Card title={t('btn.mkt.activeCampaigns')}><p className="text-2xl font-semibold">{d ? campaigns.filter((c) => c.status === 'ACTIVE').length : '…'}</p></Card>
        <Card title={t('btn.mkt.attributedOrders')}><p className="text-2xl font-semibold">{d ? `${d.shopmeAttribution.attributedOrders} / ${d.shopmeAttribution.totalOrders}` : '…'}</p><p className="mt-1 text-xs text-muted">{t('btn.mkt.attributedHelp')}</p></Card>
        <Card title={t('btn.mkt.totalSales')}><p className="text-2xl font-semibold">{d ? money(d.shopmeAttribution.totalSales) : '…'}</p></Card>
      </div>
      <Card className="!p-0">
        <h2 className="px-4 pb-1 pt-3 text-[13px] font-semibold">{t('btn.mkt.campaigns')}</h2>
        <IndexTable rows={campaigns} rowId={(c) => c.id} columns={campaignCols} loading={q.isLoading} onRowClick={(c) => setDialog(c)}
          empty={q.isError ? null : <EmptyState icon={<Megaphone className="size-10" />} title={t('btn.mkt.emptyTitle')} description={t('btn.mkt.emptyBody')} action={<Button variant="primary" onClick={() => setDialog('new')}>{t('btn.mkt.create')}</Button>} />} />
      </Card>
      <Card className="mt-4 !p-0">
        <div className="flex items-center justify-between gap-2 px-4 pb-1 pt-3">
          <h2 className="text-[13px] font-semibold">{t('btn.mkt.attribution')}</h2>
          <div className="flex gap-1" role="group" aria-label={t('btn.mkt.period')}>{DAYS.map((n) => <Button key={n} size="sm" variant={n === days ? 'primary' : 'secondary'} aria-pressed={n === days} onClick={() => setDays(n)}>{t('btn.mkt.days', { n })}</Button>)}</div>
        </div>
        <IndexTable rows={d?.shopmeAttribution.rows ?? []} rowId={(r) => `${r.source}|${r.medium}|${r.campaign}`} columns={attrCols} loading={q.isLoading}
          empty={q.isError ? null : <p className="px-4 py-8 text-center text-[13px] text-muted">{t('btn.mkt.attributionEmpty')}</p>} />
      </Card>
      <LearnMore topic={t('btn.learn.marketing')} />
      {dialog && <CampaignDialog key={dialog === 'new' ? 'new' : dialog.id} editing={dialog === 'new' ? null : dialog} onClose={() => setDialog(null)} onDone={refresh} />}
      <ConfirmDialog open={!!removing} danger loading={del.isPending} onClose={() => setRemoving(null)} closeLabel={t('common.close')} title={t('btn.mkt.deleteTitle', { name: removing?.name ?? '' })}
        message={t('btn.mkt.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => removing && del.mutate(removing.id)} />
    </>
  );
}
