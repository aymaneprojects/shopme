import { Banner, Button, Card, ConfirmDialog, Input, Modal, Skeleton, Switch, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, ChevronDown, ChevronRight, Trash2, Users, Webhook } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { UserErrors, gql, mutate } from '../../api';
import { LinkRow, RowCard, Section, SubHeader } from '../../components/SettingsKit';
import { SaveBar } from '../../components/SaveBar';
import { NOTIFICATION_TOGGLE, STAFF_ORDER_RECIPIENTS, STAFF_ORDER_RECIPIENTS_UPDATE, NOTIFICATION_PREVIEW, NOTIFICATION_SEND_TEST, NOTIFICATION_SETTINGS, NOTIFICATION_SETTINGS_UPDATE, NOTIFICATION_TEMPLATES, NOTIFICATION_TEMPLATE_RESET, NOTIFICATION_TEMPLATE_UPDATE } from '../../graphql';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';
import { ShopPanel, useShopSettings } from './Settings';

interface Template { key: string; name: string; description: string; audience: 'customer' | 'staff'; subject: string; body: string; customized: boolean; enabled: boolean; toggleable: boolean }
const useTemplates = () => useQuery({ queryKey: ['notification-templates'], queryFn: () => gql<{ shopmeNotificationTemplates: Template[] }>(NOTIFICATION_TEMPLATES) });
/** Localized template name or description; falls back to the text the server sends. */
const tplText = (t: (k: Key) => string, key: string, part: 'name' | 'desc', fallback: string) => { const k = `notif.tpl.${key}.${part}` as Key; const v = t(k); return v === k || !v ? fallback : v; };
const errText = (e: unknown) => (e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : (e as Error).message);

/** Sender name and address used for outgoing emails. */
function Sender() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notification-settings'], queryFn: () => gql<{ shopmeNotificationSettings: { senderName: string; senderEmail: string } }>(NOTIFICATION_SETTINGS) });
  const [form, setForm] = useState<{ senderName: string; senderEmail: string } | null>(null);
  const cur = form ?? q.data?.shopmeNotificationSettings;
  const dirty = !!form && !!q.data && (form.senderName !== q.data.shopmeNotificationSettings.senderName || form.senderEmail !== q.data.shopmeNotificationSettings.senderEmail);
  const save = useMutation({
    mutationFn: () => mutate(NOTIFICATION_SETTINGS_UPDATE, { senderName: cur!.senderName, senderEmail: cur!.senderEmail }, 'shopmeNotificationSettingsUpdate'),
    onSuccess: () => { toast(t('settings.saved')); setForm(null); void qc.invalidateQueries({ queryKey: ['notification-settings'] }); }, onError: (e) => toast(errText(e), 'critical'),
  });
  return (
    <Section title={t('notif.senderTitle')} description={t('notif.senderDesc')}>
      <Card>
        {!cur ? <Skeleton className="h-16" /> : (
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label={t('notif.senderName')} value={cur.senderName} onChange={(e) => setForm({ ...cur, senderName: e.target.value })} />
              <Input label={t('notif.senderEmail')} type="email" help={t('notif.senderEmailHelp')} value={cur.senderEmail} onChange={(e) => setForm({ ...cur, senderEmail: e.target.value })} />
            </div>
            {dirty && <div className="flex justify-end gap-2"><Button onClick={() => setForm(null)}>{t('save.discard')}</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>{t('save.save')}</Button></div>}
          </div>
        )}
      </Card>
    </Section>
  );
}

export function NotificationsSettings() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-6">
      <ShopPanel fields={['email']}>
        {(f, set) => (
          <Section title={t('notif.contactTitle')} description={t('notif.contactDesc')}>
            <Card><Input label={t('settings.contactEmail')} type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} /></Card>
          </Section>
        )}
      </ShopPanel>
      <RowCard>
        <LinkRow to="/settings/notifications/customer" icon={Bell} title={t('notif.customerTitle')} description={t('notif.customerDesc')} />
        <LinkRow to="/settings/notifications/staff" icon={Users} title={t('notif.staffTitle')} description={t('notif.staffDesc')} />
      </RowCard>
      <RowCard>
        <LinkRow to="/settings/webhooks" icon={Webhook} title={t('settings.webhooks')} description={t('notif.webhooksDesc')} />
      </RowCard>
      <Sender />
    </div>
  );
}

const GROUPS: Array<{ id: string; title: Key; keys: string[] }> = [
  { id: 'orders', title: 'notif.group.orders', keys: ['order_confirmation', 'draft_order_invoice', 'shipping_confirmation', 'shipping_update', 'order_cancelled', 'refund'] },
  { id: 'accounts', title: 'notif.group.accounts', keys: ['customer_account_welcome', 'customer_account_invite', 'password_reset'] },
];

/** One notification: opens its template; a switch turns the email on or off. */
function NotificationRow({ n }: { n: Template }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => mutate(NOTIFICATION_TOGGLE, { key: n.key, enabled }, 'shopmeNotificationToggle'),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notification-templates'] }), onError: (e) => toast(errText(e), 'critical'),
  });
  const on = toggle.isPending ? !!toggle.variables : n.enabled;
  return (
    <div className="flex items-center hover:bg-hover">
      <Link to={`/settings/notifications/${encodeURIComponent(n.key)}`} className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4">
        <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium">{tplText(t, n.key, 'name', n.name)}{n.customized ? ' •' : ''}</span><span className="block text-[13px] text-muted">{tplText(t, n.key, 'desc', n.description)}</span></span>
      </Link>
      {n.toggleable && <div className="shrink-0 pl-2"><Switch checked={on} onChange={(v) => toggle.mutate(v)} label={<span className="sr-only">{`${t('notif.enabled')}: ${tplText(t, n.key, 'name', n.name)}`}</span>} /></div>}
      <Link to={`/settings/notifications/${encodeURIComponent(n.key)}`} tabIndex={-1} aria-hidden className="shrink-0 py-3 pl-3 pr-4"><ChevronRight className="size-4 text-muted" /></Link>
    </div>
  );
}

function Group({ title, items }: { title: string; items: Template[] }) {
  const [open, setOpen] = useState(true);
  if (items.length === 0) return null;
  return (
    <RowCard>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-4 py-3 text-[13px] font-semibold hover:bg-hover">
        {title}<ChevronDown className={`size-4 text-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && items.map((n) => <NotificationRow key={n.key} n={n} />)}
    </RowCard>
  );
}

/** Who receives the "New order" email. */
function StaffRecipients() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const q = useQuery({ queryKey: ['staff-recipients'], queryFn: () => gql<{ shopmeStaffOrderRecipients: { emails: string[]; isDefault: boolean } }>(STAFF_ORDER_RECIPIENTS) });
  const save = useMutation({
    mutationFn: (emails: string[]) => mutate(STAFF_ORDER_RECIPIENTS_UPDATE, { emails }, 'shopmeStaffOrderRecipientsUpdate'),
    onSuccess: () => { setEmail(''); toast(t('settings.saved')); void qc.invalidateQueries({ queryKey: ['staff-recipients'] }); }, onError: (e) => toast(errText(e), 'critical'),
  });
  const cur = q.data?.shopmeStaffOrderRecipients;
  const emails = cur?.emails ?? [];
  const add = () => { const v = email.trim().toLowerCase(); if (v && !(cur?.isDefault ? [] : emails).includes(v)) save.mutate([...(cur?.isDefault ? [] : emails), v]); };
  return (
    <Card title={t('notif.recipients')}>
      <p className="mb-3 text-[13px] text-muted">{t('notif.recipientsDesc')}</p>
      {!cur ? <Skeleton className="h-16" /> : (
        <>
          <ul className="mb-3 divide-y divide-line">
            {emails.map((e) => (
              <li key={e} className="flex items-center gap-2 py-1.5 text-[13px]"><span className="flex-1">{e}{cur.isDefault && <span className="ml-2 text-muted">{t('notif.recipientsDefault')}</span>}</span>
                {!cur.isDefault && <button type="button" aria-label={`${t('common.remove')} ${e}`} className="rounded p-1 text-muted hover:bg-surface" onClick={() => save.mutate(emails.filter((x) => x !== e))}><Trash2 className="size-4" /></button>}</li>
            ))}
          </ul>
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
            <Input className="flex-1" type="email" label={t('notif.recipientsAdd')} value={email} onChange={(e) => setEmail(e.target.value)} />
            <Button type="submit" loading={save.isPending} disabled={!email.includes('@')}>{t('notif.recipientsAddBtn')}</Button>
          </form>
        </>
      )}
    </Card>
  );
}

function AudiencePage({ audience }: { audience: 'customer' | 'staff' }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const q = useTemplates();
  const all = (q.data?.shopmeNotificationTemplates ?? []).filter((n) => n.audience === audience);
  const used = new Set(GROUPS.flatMap((g) => g.keys));
  const groups = audience === 'customer'
    ? [...GROUPS.map((g) => ({ id: g.id, title: t(g.title), items: all.filter((n) => g.keys.includes(n.key)) })), { id: 'other', title: t('notif.group.other'), items: all.filter((n) => !used.has(n.key)) }]
    : [{ id: 'staff', title: t('notif.staffTitle'), items: all }];
  const first = all[0];
  return (
    <>
      <SubHeader back="/settings/notifications" parent={t('settings.notifications')} title={t(audience === 'customer' ? 'notif.customerPageTitle' : 'notif.staffPageTitle')}
        actions={first && <Button onClick={() => navigate(`/settings/notifications/${encodeURIComponent(first.key)}`)}>{t('notif.customizeTemplates')}</Button>} />
      {q.isLoading && <Skeleton className="h-48" />}
      {q.error && <Banner>{q.error.message}</Banner>}
      {audience === 'staff' && <div className="mb-3"><StaffRecipients /></div>}
      <div className="flex flex-col gap-3">{groups.map((g) => <Group key={g.id} title={g.title} items={g.items} />)}</div>
    </>
  );
}
export const CustomerNotificationsPage = () => <AudiencePage audience="customer" />;
export const StaffNotificationsPage = () => <AudiencePage audience="staff" />;

export function NotificationEditPage() {
  const { key = '' } = useParams();
  const { t } = useI18n();
  const q = useTemplates();
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  const tpl = q.data?.shopmeNotificationTemplates.find((x) => x.key === key);
  if (!tpl) return <Banner>{t('notif.notFound')}</Banner>;
  return <TemplateForm key={`${key}:${q.dataUpdatedAt}`} tpl={tpl} />;
}

function TemplateForm({ tpl }: { tpl: Template }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const shop = useShopSettings();
  const [form, setForm] = useState({ subject: tpl.subject, body: tpl.body });
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [test, setTest] = useState<string | null>(null);
  const dirty = form.subject !== tpl.subject || form.body !== tpl.body;
  const preview = useQuery({ queryKey: ['notification-preview', tpl.key, tpl.subject, tpl.body], retry: false, queryFn: () => gql<{ shopmeNotificationPreview: { preview: { subject: string; html: string } | null } }>(NOTIFICATION_PREVIEW, { key: tpl.key }) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['notification-templates'] }); void qc.invalidateQueries({ queryKey: ['notification-preview'] }); };
  const save = useMutation({
    mutationFn: () => mutate(NOTIFICATION_TEMPLATE_UPDATE, { key: tpl.key, ...form }, 'shopmeNotificationTemplateUpdate'),
    onSuccess: () => { toast(t('notif.saved')); setError(null); refresh(); }, onError: (e) => setError(errText(e)),
  });
  const reset = useMutation({
    mutationFn: () => mutate(NOTIFICATION_TEMPLATE_RESET, { key: tpl.key }, 'shopmeNotificationTemplateReset'),
    onSuccess: () => { toast(t('notif.resetDone')); setConfirm(false); refresh(); }, onError: (e) => { setConfirm(false); setError(errText(e)); },
  });
  const sendTest = useMutation({
    mutationFn: () => mutate(NOTIFICATION_SEND_TEST, { key: tpl.key, to: test }, 'shopmeNotificationSendTest'),
    onSuccess: () => { toast(t('notif.testSent', { to: test ?? '' })); setTest(null); }, onError: (e) => toast(errText(e), 'critical'),
  });
  const p = preview.data?.shopmeNotificationPreview.preview;
  const frame = (h: string) => <iframe title={t('notif.preview')} sandbox="" srcDoc={p?.html} className={`${h} w-full rounded-md border border-line bg-white`} />;
  return (
    <>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => { setForm({ subject: tpl.subject, body: tpl.body }); setError(null); }} />
      <SubHeader
        back={`/settings/notifications/${tpl.audience}`} parent={t(tpl.audience === 'customer' ? 'notif.customerTitle' : 'notif.staffTitle')} title={tplText(t, tpl.key, 'name', tpl.name)}
        actions={<>
          {editing && <Button disabled={!tpl.customized} onClick={() => setConfirm(true)}>{t('notif.reset')}</Button>}
          <Button onClick={() => setTest(shop.data?.shop.email ?? '')}>{t('notif.sendTest')}</Button>
          <Button variant="primary" onClick={() => setEditing(!editing)}>{editing ? t('notif.showPreview') : t('notif.editCode')}</Button>
        </>}
      />
      {error && <div className="mb-4"><Banner>{error}</Banner></div>}
      {!editing ? (
        <Card title={t('notif.preview')}>
          {preview.isLoading && <Skeleton className="h-64" />}
          {preview.error && <Banner>{preview.error.message}</Banner>}
          {p && <><p className="mb-2 text-[13px]"><span className="text-muted">{t('notif.subject')}:</span> <strong>{p.subject}</strong></p>{frame('h-[32rem]')}</>}
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card title={t('notif.template')}>
            <div className="flex flex-col gap-3">
              <Input label={t('notif.subject')} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
              <label className="flex flex-col gap-1 text-[13px] font-medium">{t('notif.body')}
                <textarea spellCheck={false} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={22} aria-label={t('notif.body')}
                  onKeyDown={(e) => { if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); const el = e.currentTarget; const s = el.selectionStart; setForm({ ...form, body: `${form.body.slice(0, s)}  ${form.body.slice(el.selectionEnd)}` }); requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2)); } }}
                  className="w-full resize-y rounded-md border border-line bg-surface p-3 font-mono text-[13px] font-normal leading-relaxed" />
              </label>
              <p className="text-xs text-muted">{t('notif.help')}</p>
            </div>
          </Card>
          <Card title={t('notif.preview')} actions={dirty && <span className="text-xs text-muted">{t('notif.previewSaved')}</span>}>
            {preview.isLoading && <Skeleton className="h-64" />}
            {preview.error && <Banner>{preview.error.message}</Banner>}
            {p && <><p className="mb-2 text-[13px]"><span className="text-muted">{t('notif.subject')}:</span> <strong>{p.subject}</strong></p>{frame('h-[28rem]')}</>}
          </Card>
        </div>
      )}
      <Modal open={test !== null} onClose={() => setTest(null)} closeLabel={t('common.close')} title={t('notif.sendTest')}
        footer={<><Button onClick={() => setTest(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={sendTest.isPending} disabled={!test?.includes('@')} onClick={() => sendTest.mutate()}>{t('notif.sendTest')}</Button></>}>
        <Input label={t('notif.testTo')} type="email" value={test ?? ''} onChange={(e) => setTest(e.target.value)} help={t('notif.testHelp')} />
      </Modal>
      <ConfirmDialog open={confirm} danger onClose={() => setConfirm(false)} title={t('notif.resetTitle')} message={t('notif.resetBody')} confirmLabel={t('notif.reset')} cancelLabel={t('common.cancel')} onConfirm={() => reset.mutate()} />
    </>
  );
}
