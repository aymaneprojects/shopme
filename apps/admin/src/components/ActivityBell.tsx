import { Skeleton, cx } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArchiveRestore, Bell, PackageMinus, ShoppingCart } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { useNavigate } from 'react-router';
import { gql, mutate } from '../api';
import { ACTIVITY_FEED, ACTIVITY_MARK_ALL_READ } from '../graphql';
import { useI18n } from '../i18n';
import type { Key } from '../i18n';

interface Entry { id: string; kind: 'order' | 'low_stock' | 'webhook_failed' | 'backup'; title: string; body: string; link: string | null; createdAt: string; read: boolean; ok: boolean }
const ICONS: Record<Entry['kind'], ComponentType<{ className?: string }>> = { order: ShoppingCart, low_stock: PackageMinus, webhook_failed: AlertTriangle, backup: ArchiveRestore };

function ago(iso: string, lang: string) {
  const s = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(Math.round(s / 1) , 'second');
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86400), 'day');
}

/** Bell in the header: in-app feed of new orders, low stock, failed webhook deliveries and backup results. */
export function ActivityBell() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: ['activity-feed'], refetchInterval: 60_000, queryFn: () => gql<{ shopmeActivityFeed: { unreadCount: number; items: Entry[] } }>(ACTIVITY_FEED, { first: 30 }) });
  const markAll = useMutation({ mutationFn: () => mutate(ACTIVITY_MARK_ALL_READ, {}, 'shopmeActivityMarkAllRead'), onSuccess: () => void qc.invalidateQueries({ queryKey: ['activity-feed'] }) });
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);
  const feed = q.data?.shopmeActivityFeed;
  const unread = feed?.unreadCount ?? 0;
  const text = (e: Entry): { title: string; body: string } => {
    switch (e.kind) {
      case 'order': return { title: t('activity.order', { name: e.title }), body: e.body };
      case 'low_stock': return { title: t('activity.lowStock', { title: e.title }), body: t('activity.lowStockBody', { n: e.body }) };
      case 'webhook_failed': return { title: t('activity.webhook', { topic: e.title }), body: e.body };
      default: return { title: t((e.ok ? 'activity.backupOk' : 'activity.backupFailed') as Key), body: e.ok ? e.title : e.body };
    }
  };
  return (
    <div ref={box} className="relative">
      <button type="button" className="btn btn-plain btn-icon relative !text-frame-text hover:!bg-frame-hover" aria-label={unread ? t('activity.openUnread', { n: unread }) : t('activity.open')} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
        <Bell className="size-[18px]" />
        {unread > 0 && <span className="absolute right-0.5 top-0.5 grid min-w-4 place-items-center rounded-full bg-critical px-1 text-[10px] font-semibold leading-4 text-white">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label={t('activity.title')} className="anim-fade absolute bottom-10 left-0 z-50 w-[22rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-line bg-canvas text-fg shadow-pop">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <h2 className="text-[13px] font-semibold">{t('activity.title')}</h2>
            <button type="button" disabled={!unread || markAll.isPending} onClick={() => markAll.mutate()} className="text-xs font-medium text-accent disabled:text-muted">{t('activity.markAll')}</button>
          </div>
          <ul className="max-h-[24rem] overflow-y-auto">
            {q.isLoading && <li className="p-3"><Skeleton className="h-10" /></li>}
            {q.isError && <li className="p-4 text-center text-[13px] text-critical">{(q.error as Error).message}</li>}
            {feed && !feed.items.length && <li className="p-6 text-center text-[13px] text-muted">{t('activity.empty')}</li>}
            {feed?.items.map((e) => {
              const Icon = ICONS[e.kind]; const x = text(e);
              return (
                <li key={e.id}>
                  <button type="button" onClick={() => { setOpen(false); if (e.link) void nav(e.link); }} className={cx('flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-hover', !e.read && 'bg-surface/60')}>
                    <Icon className={cx('mt-0.5 size-4 shrink-0', e.ok ? 'text-muted' : 'text-critical')} />
                    <span className="min-w-0 flex-1"><span className={cx('block truncate text-[13px]', !e.read && 'font-semibold')}>{x.title}</span>{x.body && <span className="block truncate text-xs text-muted">{x.body}</span>}<span className="block text-xs text-muted">{ago(e.createdAt, lang)}</span></span>
                    {!e.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label={t('activity.unread')} />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
