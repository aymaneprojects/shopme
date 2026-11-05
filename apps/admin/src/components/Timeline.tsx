import { Banner, Button, ConfirmDialog, Modal, Skeleton, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AtSign, Hash, Mail, Paperclip, Smile, Trash2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { gql, mutate, upload } from '../api';
import { CUSTOMER_TIMELINE, EMAIL_EVENT_BODY, CUSTOMER_TIMELINE_COMMENT_CREATE, ORDER_TIMELINE, ORDER_TIMELINE_COMMENT_CREATE, TIMELINE_COMMENT_DELETE } from '../graphql';
import { useI18n } from '../i18n';
import { dayLabel, eventText, groupByDay, type TimelineEvent } from '../lib/timeline';
import { useShop } from '../session';

interface Props { kind: 'order' | 'customer'; id: string }
interface Data { order?: { name: string; currencyCode: string; events: { nodes: TimelineEvent[] } } | null; customer?: { events: { nodes: TimelineEvent[] } } | null }

/**
 * Activity timeline of an order or a customer: a comment box for staff and the system events (and comments) grouped by day, newest first.
 * Refetches by itself; `refreshKey` lets the host page force a reload after it changed something.
 */
export function Timeline({ kind, id, refreshKey }: Props & { refreshKey?: unknown }) {
  const { t, lang } = useI18n();
  const { user } = useShop();
  const toast = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [removing, setRemoving] = useState<TimelineEvent | null>(null);
  const [attached, setAttached] = useState<Array<{ url: string; name: string }>>([]);
  const [email, setEmail] = useState<TimelineEvent | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const key = ['timeline', kind, id, refreshKey];
  const q = useQuery({ queryKey: key, queryFn: () => gql<Data>(kind === 'order' ? ORDER_TIMELINE : CUSTOMER_TIMELINE, { id }) });
  const reload = () => qc.invalidateQueries({ queryKey: ['timeline', kind, id] });
  const fail = (e: Error) => toast(e.message, 'critical');

  const post = useMutation({
    mutationFn: () => mutate(kind === 'order' ? ORDER_TIMELINE_COMMENT_CREATE : CUSTOMER_TIMELINE_COMMENT_CREATE, { id, message: text.trim(), ...(kind === 'customer' && { attachments: attached.map((a) => a.url) }) }, kind === 'order' ? 'orderTimelineCommentCreate' : 'customerTimelineCommentCreate'),
    onSuccess: () => { setText(''); setAttached([]); void reload(); }, onError: fail,
  });
  const attach = useMutation({
    mutationFn: async (files: File[]) => { const out: Array<{ url: string; name: string }> = []; for (const f of files) out.push({ url: (await upload<{ file: { url: string } }>('/files', f)).file.url, name: f.name }); return out; },
    onSuccess: (f) => setAttached((a) => [...a, ...f].slice(0, 10)), onError: fail,
  });
  const del = useMutation({
    mutationFn: (eventId: string) => mutate(TIMELINE_COMMENT_DELETE, { id: eventId }, 'timelineCommentDelete'),
    onSuccess: () => { setRemoving(null); toast(t('timeline.deleted')); void reload(); }, onError: (e) => { setRemoving(null); fail(e); },
  });

  const owner = kind === 'order' ? q.data?.order : q.data?.customer;
  const events = owner?.events.nodes ?? [];
  const order = kind === 'order' ? q.data?.order : null;
  const initials = ((user.firstName?.[0] ?? '') + (user.lastName?.[0] ?? '') || user.email[0] || '?').toUpperCase();
  const time = (iso: string) => new Intl.DateTimeFormat(lang, { timeStyle: 'short' }).format(new Date(iso));
  const dayTitle = (day: string, first: string) => {
    const rel = dayLabel(day);
    return rel ? t(`timeline.${rel}`) : new Intl.DateTimeFormat(lang, { dateStyle: 'long' }).format(new Date(first));
  };

  return (
    <section aria-label={t('timeline.title')}>
      <h2 className="mb-2 text-[15px] font-semibold">{t('timeline.title')}</h2>
      <div className="overflow-hidden rounded-lg bg-canvas shadow-card">
        <div className="flex items-start gap-3 p-3">
          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-xs font-semibold text-accent-fg">{initials}</span>
          <textarea className="min-h-9 min-w-0 flex-1 resize-none self-center border-0 bg-transparent p-0 text-[13px] outline-none placeholder:text-muted" rows={1} aria-label={t('timeline.commentLabel')} placeholder={t('timeline.placeholder')} value={text} maxLength={5000}
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && text.trim() && !post.isPending) post.mutate(); }} />
        </div>
        <div className="flex items-center gap-1 bg-surface px-3 py-2">
          {([[Smile, '🙂'], [AtSign, '@'], [Hash, '#']] as const).map(([Icon, ch], i) => (
            <button key={i} type="button" aria-label={ch} onClick={() => setText((v) => v + ch)} className="grid size-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg"><Icon className="size-4" /></button>
          ))}
          {kind === 'customer' && (
            <>
              <input ref={picker} type="file" hidden multiple aria-label={t('bc.timeline.attach')} onChange={(e) => { const f = Array.from(e.target.files ?? []); if (f.length) attach.mutate(f); e.target.value = ''; }} />
              <button type="button" aria-label={t('bc.timeline.attach')} title={t('bc.timeline.attach')} disabled={attach.isPending} onClick={() => picker.current?.click()} className="grid size-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg disabled:opacity-50"><Paperclip className="size-4" /></button>
            </>
          )}
          <Button className="ml-auto" size="sm" variant="primary" disabled={!text.trim() && !attached.length} loading={post.isPending} onClick={() => post.mutate()}>{t('timeline.post')}</Button>
        </div>
      </div>
      {attached.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2 text-xs">
          {attached.map((a) => <li key={a.url} className="inline-flex items-center gap-1 rounded-full border border-line bg-canvas px-2 py-1"><Paperclip className="size-3" />{a.name}<button type="button" aria-label={t('common.remove')} onClick={() => setAttached((x) => x.filter((y) => y.url !== a.url))} className="text-muted hover:text-fg"><X className="size-3" /></button></li>)}
        </ul>
      )}
      <p className="mt-1.5 text-right text-xs text-muted">{t('timeline.staffOnly')}</p>

      {q.isLoading && <div className="mt-3 grid gap-2"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-4 w-2/3" /></div>}
      {q.isError && <div className="mt-3"><Banner>{t('timeline.loadFailed')}</Banner></div>}
      {!q.isLoading && !q.isError && events.length === 0 && <p className="mt-3 text-[13px] text-muted">{t('timeline.empty')}</p>}
      <div className="ml-4 mt-2 border-l-2 border-line pl-4">
        {groupByDay(events).map((g) => (
          <div key={g.day} className="pb-3">
            <h3 className="py-2 text-xs font-medium text-muted">{dayTitle(g.day, g.events[0]!.createdAt)}</h3>
            <ol className="flex flex-col gap-3">
              {g.events.map((e) => {
                const comment = e.__typename === 'CommentEvent';
                const who = e.author?.name ?? e.authorEmail;
                return (
                  <li key={e.id} data-event={e.action} className="relative flex items-start justify-between gap-3 text-[13px]">
                    <span aria-hidden className={comment ? 'absolute -left-[25px] top-1.5 size-2.5 rounded-full bg-accent ring-4 ring-[var(--color-bg)]' : 'absolute -left-[24px] top-1.5 size-2 rounded-full bg-muted ring-4 ring-[var(--color-bg)]'} />
                    {comment ? (
                      <div className="min-w-0 flex-1 rounded-lg bg-canvas p-3 shadow-card">
                        <p className="mb-1 text-xs text-muted">{who ?? t('timeline.staff')}</p>
                        {(e.rawMessage ?? e.message) && <p className="whitespace-pre-wrap break-words">{e.rawMessage ?? e.message}</p>}
                        {e.attachments && e.attachments.length > 0 && (
                          <ul className="mt-1 flex flex-wrap gap-2">
                            {e.attachments.map((u) => <li key={u}>{/\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i.test(u) ? <a href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="h-16 rounded-md border border-line object-cover" /></a> : <a href={u} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline"><Paperclip className="size-3" />{decodeURIComponent(u.split('?')[0]!.split('/').pop() ?? u)}</a>}</li>)}
                          </ul>
                        )}
                      </div>
                    ) : (
                      <div className="min-w-0 flex-1">
                        <p className="break-words">{eventText(e, t, lang, order)}</p>
                        {e.action === 'customers/email_sent' && <button type="button" onClick={() => setEmail(e)} className="mt-0.5 inline-flex items-center gap-1 text-xs text-accent hover:underline"><Mail className="size-3" />{t('bc.timeline.showEmail')}</button>}
                        {who && <p className="text-xs text-muted">{who}</p>}
                      </div>
                    )}
                    <span className="flex shrink-0 items-center gap-1 pt-0.5 text-xs text-muted">
                      {time(e.createdAt)}
                      {comment && e.canDelete && (
                        <button type="button" aria-label={t('timeline.deleteComment')} title={t('timeline.deleteComment')} onClick={() => setRemoving(e)}
                          className="grid size-6 place-items-center rounded-md hover:bg-hover hover:text-critical"><Trash2 className="size-3.5" /></button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
      <EmailDialog event={email} onClose={() => setEmail(null)} />
      <ConfirmDialog open={!!removing} danger loading={del.isPending} onClose={() => setRemoving(null)} closeLabel={t('common.close')} title={t('timeline.deleteTitle')}
        message={t('timeline.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => removing && del.mutate(removing.id)} />
    </section>
  );
}

/** The body of an email the store sent to the customer, in a sandboxed frame so its markup cannot touch the admin. */
function EmailDialog({ event, onClose }: { event: TimelineEvent | null; onClose: () => void }) {
  const { t } = useI18n();
  const q = useQuery({ queryKey: ['email-event', event?.id], enabled: !!event, queryFn: async () => (await gql<{ node: { shopmeEmailHtml: string | null } | null }>(EMAIL_EVENT_BODY, { id: event!.id })).node?.shopmeEmailHtml ?? null });
  const args = event?.arguments ?? {};
  return (
    <Modal open={!!event} onClose={onClose} wide title={String(args.subject ?? t('bc.timeline.email'))} closeLabel={t('common.close')} footer={<Button onClick={onClose}>{t('common.close')}</Button>}>
      <p className="mb-2 text-[13px] text-muted">{t('bc.timeline.emailTo', { to: String(args.to ?? '') })}</p>
      {q.isLoading ? <Skeleton className="h-64" /> : q.data ? <iframe title={String(args.subject ?? t('bc.timeline.email'))} sandbox="" srcDoc={q.data} className="h-[28rem] w-full rounded-md border border-line bg-white" /> : <p className="text-[13px] text-muted">{t('bc.timeline.emailGone')}</p>}
    </Modal>
  );
}
