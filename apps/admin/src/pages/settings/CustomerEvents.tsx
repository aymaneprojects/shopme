import { Badge, Banner, Button, Card, Checkbox, ConfirmDialog, Dropdown, Input, Skeleton, Switch, Textarea, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Code2, MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { UserErrors, gql, mutate } from '../../api';
import { Section, SettingsActions, SubHeader } from '../../components/SettingsKit';
import { SaveBar, guard } from '../../components/SaveBar';
import { PIXELS, PIXEL_CONNECT, PIXEL_CREATE, PIXEL_DELETE, PIXEL_DISCONNECT, PIXEL_QUERY, PIXEL_UPDATE } from '../../graphql';
import { gidToNum } from '../../format';
import { useI18n } from '../../i18n';

interface Pixel { id: string; name: string; code: string | null; connected: boolean; kind: string; requiredConsent: string[]; respectSaleOptOut: boolean; domEvents: boolean; updatedAt: string }
const CATEGORIES = ['analytics', 'marketing', 'preferences'] as const;

function usePixelActions() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const done = (msg: string) => () => { toast(msg); void qc.invalidateQueries({ queryKey: ['pixels'] }); void qc.invalidateQueries({ queryKey: ['pixel'] }); };
  const fail = (e: Error) => toast(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message, 'critical');
  return {
    connect: useMutation({ mutationFn: (id: string) => mutate(PIXEL_CONNECT, { id }, 'shopmeCustomPixelConnect'), onSuccess: done(t('events.connected')), onError: fail }),
    disconnect: useMutation({ mutationFn: (id: string) => mutate(PIXEL_DISCONNECT, { id }, 'shopmeCustomPixelDisconnect'), onSuccess: done(t('events.disconnected')), onError: fail }),
    remove: useMutation({ mutationFn: (id: string) => mutate(PIXEL_DELETE, { id }, 'shopmeCustomPixelDelete'), onSuccess: done(t('events.deleted')), onError: fail }),
  };
}

/** Settings > Customer events: the pixels list (merchant code run in a sandbox once the visitor's consent allows it). */
export function CustomerEventsSettings() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['pixels'], queryFn: () => gql<{ shopmeCustomPixels: Pixel[]; shopmeStorefrontEventCounts: Array<{ name: string; count: number }> }>(PIXELS) });
  const actions = usePixelActions();
  const [del, setDel] = useState<Pixel | null>(null);
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  const pixels = q.data!.shopmeCustomPixels.filter((p) => p.kind === 'CUSTOM');
  const counts = q.data!.shopmeStorefrontEventCounts;
  const add = <Button onClick={() => nav('/settings/events/new')}>{t('events.add')}</Button>;
  return (
    <div className="flex flex-col gap-6">
      <SettingsActions><Button onClick={() => nav('/settings/events/new')}>{t('events.add')}</Button></SettingsActions>
      <Section title={t('events.pixels')} description={t('events.pixelsDesc')}>
        {pixels.length === 0 ? (
          <Card>
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <div className="mb-2 flex size-14 items-center justify-center rounded-full bg-surface text-muted"><Code2 className="size-6" /></div>
              <h3 className="text-sm font-semibold">{t('events.empty')}</h3>
              <p className="max-w-md text-[13px] text-muted">{t('events.emptyDesc')}</p>
              <div className="mt-2">{add}</div>
            </div>
          </Card>
        ) : (
          <div className="divide-y divide-line overflow-hidden rounded-lg bg-canvas shadow-card">
            {pixels.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => nav(`/settings/events/${gidToNum(p.id)}`)}>
                  <span className="block text-[13px] font-medium">{p.name}</span>
                  <span className="block text-[13px] text-muted">{p.requiredConsent.length ? t('events.requires', { list: p.requiredConsent.map((c) => t(`events.cat.${c}` as 'events.cat.analytics')).join(', ') }) : t('events.requiresNone')}</span>
                </button>
                <Badge tone="neutral">{t('events.custom')}</Badge>
                <Badge tone={p.connected ? 'success' : 'neutral'} dot>{t(p.connected ? 'events.statusConnected' : 'events.statusDisconnected')}</Badge>
                <Dropdown align="right" icon label={t('common.moreActions')} trigger={<MoreHorizontal className="size-4" />} items={[
                  { key: 'edit', label: t('events.edit'), onSelect: () => nav(`/settings/events/${gidToNum(p.id)}`) },
                  p.connected ? { key: 'off', label: t('events.disconnect'), onSelect: () => actions.disconnect.mutate(p.id) } : { key: 'on', label: t('events.connect'), onSelect: () => actions.connect.mutate(p.id) },
                  { key: 'del', label: t('common.delete'), danger: true, onSelect: () => setDel(p) },
                ]} />
              </div>
            ))}
          </div>
        )}
      </Section>
      <Section title={t('events.stream')} description={t('events.streamDesc')}>
        <Card>
          {counts.length === 0 ? <p className="text-[13px] text-muted">{t('events.streamEmpty')}</p> : (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-3">
              {counts.map((c) => <div key={c.name} className="flex justify-between gap-2"><dt className="text-muted">{c.name}</dt><dd className="font-medium">{c.count.toLocaleString(lang)}</dd></div>)}
            </dl>
          )}
        </Card>
      </Section>
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} danger title={t('events.deleteTitle', { name: del?.name ?? '' })} message={t('events.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')}
        onConfirm={() => { if (del) actions.remove.mutate(del.id); setDel(null); }} />
    </div>
  );
}

/** Add or edit a custom pixel. */
export function PixelPage() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const gid = `gid://shopify/ShopmeCustomPixel/${id}`;
  const q = useQuery({ queryKey: ['pixel', gid], enabled: !isNew, queryFn: () => gql<{ shopmeCustomPixel: Pixel | null }>(PIXEL_QUERY, { id: gid }) });
  const { t } = useI18n();
  if (!isNew && q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  if (!isNew && !q.data?.shopmeCustomPixel) return <Banner>{t('events.notFound')}</Banner>;
  return <PixelForm key={`${id}:${q.dataUpdatedAt}`} pixel={q.data?.shopmeCustomPixel ?? null} />;
}

function PixelForm({ pixel }: { pixel: Pixel | null }) {
  const { t } = useI18n();
  const toast = useToast();
  const nav = useNavigate();
  const qc = useQueryClient();
  const actions = usePixelActions();
  const initial = { name: pixel?.name ?? '', code: pixel?.code ?? '', requiredConsent: pixel?.requiredConsent ?? ['analytics'], respectSaleOptOut: pixel?.respectSaleOptOut ?? true, domEvents: pixel?.domEvents ?? false };
  const [f, setF] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const save = useMutation({
    mutationFn: async () => {
      if (!f.name.trim()) throw new Error(t('events.nameRequired'));
      const input = { name: f.name, code: f.code, requiredConsent: f.requiredConsent, respectSaleOptOut: f.respectSaleOptOut, domEvents: f.domEvents };
      return pixel
        ? (await mutate<{ pixel: Pixel }>(PIXEL_UPDATE, { id: pixel.id, input }, 'shopmeCustomPixelUpdate')).pixel
        : (await mutate<{ pixel: Pixel }>(PIXEL_CREATE, { input }, 'shopmeCustomPixelCreate')).pixel;
    },
    onSuccess: (p) => { toast(t('settings.saved')); setError(null); void qc.invalidateQueries({ queryKey: ['pixels'] }); void qc.invalidateQueries({ queryKey: ['pixel'] }); guard.off = true; if (!pixel) nav(`/settings/events/${gidToNum(p.id)}`, { replace: true }); },
    onError: (e) => setError(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message),
  });
  const toggle = (c: string, on: boolean) => setF({ ...f, requiredConsent: on ? [...new Set([...f.requiredConsent, c])] : f.requiredConsent.filter((x) => x !== c) });
  return (
    <>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => { setF(initial); setError(null); }} />
      <SubHeader back="/settings/events" parent={t('settings.events')} title={pixel ? pixel.name : t('events.addTitle')}
        actions={pixel && (
          <>
            <Button size="sm" onClick={() => setConfirm(true)}>{t('common.delete')}</Button>
            {pixel.connected ? <Button size="sm" onClick={() => actions.disconnect.mutate(pixel.id)}>{t('events.disconnect')}</Button> : <Button size="sm" variant="primary" disabled={dirty} onClick={() => actions.connect.mutate(pixel.id)}>{t('events.connect')}</Button>}
          </>
        )} />
      <div className="flex flex-col gap-6">
        {error && <Banner>{error}</Banner>}
        {pixel && <Banner tone={pixel.connected ? 'success' : 'info'}>{t(pixel.connected ? 'events.liveNote' : 'events.draftNote')}</Banner>}
        <Card>
          <div className="grid gap-3">
            <Input label={t('events.name')} value={f.name} maxLength={100} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <Textarea label={t('events.code')} help={t('events.codeHelp')} value={f.code} rows={14} spellCheck={false} className="font-mono text-[12px]" onChange={(e) => setF({ ...f, code: e.target.value })} />
          </div>
        </Card>
        <Section title={t('events.privacy')} description={t('events.privacyDesc')}>
          <Card>
            <div className="flex flex-col gap-2.5">
              {CATEGORIES.map((c) => <Checkbox key={c} label={t(`events.cat.${c}` as 'events.cat.analytics')} checked={f.requiredConsent.includes(c)} onChange={(e) => toggle(c, e.target.checked)} />)}
              {f.requiredConsent.length === 0 && <Banner tone="warning">{t('events.noConsentWarning')}</Banner>}
              <Switch checked={f.respectSaleOptOut} onChange={(v) => setF({ ...f, respectSaleOptOut: v })} label={t('events.saleOptOut')} />
              <Switch checked={f.domEvents} onChange={(v) => setF({ ...f, domEvents: v })} label={t('events.domEvents')} />
            </div>
          </Card>
        </Section>
        <p className="text-[13px] text-muted">{t('events.sandboxNote')}</p>
      </div>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} danger title={t('events.deleteTitle', { name: pixel?.name ?? '' })} message={t('events.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')}
        onConfirm={() => { if (pixel) actions.remove.mutate(pixel.id, { onSuccess: () => nav('/settings/events') }); setConfirm(false); }} />
    </>
  );
}
