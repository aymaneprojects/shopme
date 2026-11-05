import { Badge, Button, Checkbox, Input, Modal } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { gql } from '../api';
import { gidToNum } from '../format';
import { CATALOGS_PICKER, PUBLICATIONS } from '../graphql';
import { useI18n } from '../i18n';
import { SideHead } from './ProductSide';
import { toLocalInput } from './PublishCards';
import { useFormat } from './shared';

export interface Publication { id: string; name: string; shopmeKind?: string }
/** Publication state of one resource on one channel, as the forms edit it. */
export interface ChannelState { id: string; name: string; /** The built-in Online Store: new products are published there automatically. */ online: boolean; published: boolean; /** `datetime-local` value; empty = now. */ publishDate: string }
export interface CatalogRef { id: string; title: string; status: string }

/** The built-in channel is stored under its English name; it shows in the interface language. */
export const useChannelName = () => { const { t } = useI18n(); return (name: string) => (name === 'Online Store' ? t('nav.onlineStore') : name); };

export const usePublications = () => useQuery({ queryKey: ['publications'], staleTime: 60_000, queryFn: async () => (await gql<{ publications: { nodes: Publication[] } }>(PUBLICATIONS)).publications.nodes });
export const useCatalogOptions = () => useQuery({ queryKey: ['catalog-options'], staleTime: 60_000, queryFn: async () => (await gql<{ catalogs: { nodes: CatalogRef[] } }>(CATALOGS_PICKER)).catalogs.nodes });

interface ApiResourcePub { isPublished: boolean; publishDate: string | null; publication: { id: string; name: string } }
/** Merge the stored publications of a resource into the full channel list. Without stored data (new resource) every channel is on. */
export function channelStates(pubs: Publication[], stored: ApiResourcePub[] | null | undefined): ChannelState[] {
  return pubs.map((p) => {
    const r = stored?.find((x) => x.publication.id === p.id);
    const future = r?.publishDate && new Date(r.publishDate) > new Date();
    return { id: p.id, name: p.name, online: p.shopmeKind === 'ONLINE_STORE', published: stored ? !!r?.isPublished : true, publishDate: future ? toLocalInput(r!.publishDate) : '' };
  });
}

/** Mutation inputs to move a resource from its stored channel state to the edited one. */
export function channelChanges(before: ChannelState[], after: ChannelState[]) {
  const publish: Array<{ publicationId: string; publishDate?: string }> = [];
  const unpublish: Array<{ publicationId: string }> = [];
  for (const a of after) {
    const b = before.find((x) => x.id === a.id);
    if (a.published && (!b?.published || b.publishDate !== a.publishDate)) publish.push({ publicationId: a.id, ...(a.publishDate && { publishDate: new Date(a.publishDate).toISOString() }) });
    else if (!a.published && b?.published) unpublish.push({ publicationId: a.id });
  }
  return { publish, unpublish };
}

/** Sidebar row "Sales channels": one line per channel with its state, and a Manage dialog (publish, unpublish, schedule). */
export function ChannelsSection({ value, onChange, bare }: { value: ChannelState[]; onChange: (v: ChannelState[]) => void; /** Inside a card that already has the title: only the manage button is shown. */ bare?: boolean }) {
  const channelName = useChannelName();
  const { t } = useI18n();
  const fmt = useFormat();
  const [open, setOpen] = useState(false);
  const live = value.filter((c) => c.published);
  const state = (c: ChannelState) => !c.published ? <Badge tone="neutral">{t('bp.channels.off')}</Badge> : c.publishDate && new Date(c.publishDate) > new Date() ? <Badge tone="info">{t('bp.channels.scheduled', { date: fmt.dateTime(new Date(c.publishDate).toISOString()) })}</Badge> : <Badge tone="success">{t('bp.channels.on')}</Badge>;
  return (
    <section className="flex flex-col gap-2">
      {bare ? <div><Button size="sm" onClick={() => setOpen(true)}>{t('bp.channels.manage')}</Button></div> : <SideHead title={t('bp.channels.title')} action={{ label: t('bp.channels.manage'), onClick: () => setOpen(true) }} />}
      <ul className="flex flex-col gap-1.5 text-[13px]">
        {value.map((c) => <li key={c.id} className="flex items-center justify-between gap-2"><span className="min-w-0 truncate">{channelName(c.name)}</span>{state(c)}</li>)}
        {value.length === 0 && <li className="text-muted">{t('bp.channels.none')}</li>}
      </ul>
      <p className="text-xs text-muted">{t('bp.channels.count', { n: live.length, $count: live.length })}</p>
      {open && <ChannelsDialog open value={value} onClose={() => setOpen(false)} onApply={(v) => { onChange(v); setOpen(false); }} />}
    </section>
  );
}

function ChannelsDialog({ open, value, onClose, onApply }: { open: boolean; value: ChannelState[]; onClose: () => void; onApply: (v: ChannelState[]) => void }) {
  const channelName = useChannelName();
  const { t } = useI18n();
  const [draft, setDraft] = useState(value);
  const patch = (id: string, p: Partial<ChannelState>) => setDraft((d) => d.map((c) => (c.id === id ? { ...c, ...p } : c)));
  return (
    <Modal open={open} onClose={onClose} closeLabel={t('common.close')} title={t('bp.channels.manage')} medium
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={() => onApply(draft)}>{t('common.apply')}</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-muted">{t('bp.channels.help')}</p>
        {draft.map((c) => (
          <div key={c.id} className="rounded-lg border border-line p-3">
            <Checkbox label={channelName(c.name)} checked={c.published} onChange={(e) => patch(c.id, { published: e.target.checked, ...(e.target.checked ? {} : { publishDate: '' }) })} />
            {c.published && (
              <div className="mt-2 pl-6">
                {c.publishDate ? (
                  <div className="flex items-end gap-2">
                    <Input type="datetime-local" label={t('bp.channels.publishOn')} value={c.publishDate} onChange={(e) => patch(c.id, { publishDate: e.target.value })} />
                    <Button size="sm" onClick={() => patch(c.id, { publishDate: '' })}>{t('publish.clearDate')}</Button>
                  </div>
                ) : <Button size="sm" onClick={() => patch(c.id, { publishDate: toLocalInput(new Date(Date.now() + 86_400_000).toISOString()) })}><CalendarClock className="size-4" />{t('publish.setDate')}</Button>}
              </div>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

/** Sidebar row "Catalogs": the catalogs the product belongs to (each links to the catalog) and a picker. */
export function CatalogsSection({ value, onChange }: { value: CatalogRef[]; onChange: (v: CatalogRef[]) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const options = useCatalogOptions();
  return (
    <section className="flex flex-col gap-2">
      <SideHead title={t('bp.catalogs.title')} action={{ label: t('bp.catalogs.manage'), onClick: () => setOpen(true) }} />
      {value.length === 0 ? <p className="text-[13px] text-muted">{t('bp.catalogs.none')}</p> : (
        <ul className="flex flex-col gap-1 text-[13px]">
          {value.map((c) => <li key={c.id}><Link to={`/markets/catalogs/${gidToNum(c.id)}`} className="text-accent hover:underline">{c.title}</Link></li>)}
        </ul>
      )}
      {open && <CatalogPickerDialog open title={t('bp.catalogs.manage')} options={options.data ?? []} initial={value.map((c) => c.id)} onClose={() => setOpen(false)}
        onApply={(ids) => { onChange((options.data ?? []).filter((c) => ids.includes(c.id))); setOpen(false); }} />}
    </section>
  );
}

/** Checklist of the market catalogs. */
export function CatalogPickerDialog({ open, title, options, initial = [], confirmLabel, onClose, onApply }: { open: boolean; title: string; options: CatalogRef[]; initial?: string[]; confirmLabel?: string; onClose: () => void; onApply: (ids: string[]) => void }) {
  const { t } = useI18n();
  const [ids, setIds] = useState<string[]>(initial);
  return (
    <Modal open={open} onClose={onClose} closeLabel={t('common.close')} title={title} medium
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" disabled={!ids.length && !initial.length} onClick={() => onApply(ids)}>{confirmLabel ?? t('common.apply')}</Button></>}>
      <div className="flex flex-col gap-2">
        {options.length === 0 && <p className="text-[13px] text-muted">{t('bp.catalogs.empty')}</p>}
        {options.map((c) => <Checkbox key={c.id} label={<span>{c.title} <span className="text-xs text-muted">{t(`status.${c.status}` as 'status.ACTIVE')}</span></span>} checked={ids.includes(c.id)} onChange={(e) => setIds(e.target.checked ? [...ids, c.id] : ids.filter((x) => x !== c.id))} />)}
      </div>
    </Modal>
  );
}

/** Checklist of sales channels, for the bulk include / exclude actions. */
export function ChannelPickerDialog({ open, title, confirmLabel, onClose, onApply }: { open: boolean; title: string; confirmLabel: string; onClose: () => void; onApply: (ids: string[]) => void }) {
  const channelName = useChannelName();
  const { t } = useI18n();
  const pubs = usePublications();
  const [ids, setIds] = useState<string[]>([]);
  return (
    <Modal open={open} onClose={onClose} closeLabel={t('common.close')} title={title} medium
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" disabled={!ids.length} onClick={() => { onApply(ids); setIds([]); }}>{confirmLabel}</Button></>}>
      <div className="flex flex-col gap-2">
        {(pubs.data ?? []).map((p) => <Checkbox key={p.id} label={channelName(p.name)} checked={ids.includes(p.id)} onChange={(e) => setIds(e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id))} />)}
      </div>
    </Modal>
  );
}
