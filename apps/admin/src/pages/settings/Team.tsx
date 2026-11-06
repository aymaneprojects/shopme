import { Badge, Banner, Button, Checkbox, ConfirmDialog, Modal, Skeleton, Switch, Textarea, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { ShieldCheck } from 'lucide-react';
import { SettingsActions } from '../../components/SettingsKit';
import { useRef, useState } from 'react';
import { UserErrors, gql, mutate, rest } from '../../api';
import { STAFF_DEACTIVATE, STAFF_DELETE, STAFF_IMPORT, STAFF_MEMBERS_EXT, STAFF_ROLES } from '../../graphql';
import { PageHeader } from '../../components/PageHeader';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';
import type { Role } from '../../lib/permissions';
import { useShop } from '../../session';
import { useSecurity } from './Security';

export interface Member { id: string; email: string; firstName: string | null; lastName: string | null; active: boolean; isShopOwner: boolean; role: Role | null; permissions: string[] | null; twoFactor: boolean; roleId: string | null; roleName: string | null }
export interface CustomRole { id: string; name: string; description: string | null; permissions: string[]; members: number }

export const errText = (e: unknown) => (e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : (e as Error).message);
export const useRoles = () => useQuery({ queryKey: ['staff-roles'], queryFn: async () => (await gql<{ shopmeStaffRoles: CustomRole[] }>(STAFF_ROLES)).shopmeStaffRoles });
export const useMembers = () => useQuery({ queryKey: ['staff'], queryFn: () => gql<{ staffMembers: { nodes: Member[] } }>(STAFF_MEMBERS_EXT) });
export const roleOf = (m: Member): Role => (m.isShopOwner ? 'owner' : m.role ?? 'staff');

/** Settings > Users: the people who work on the store, with their status, two-step authentication and role; a row opens the user's page. */
export function UsersSettings() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useShop();
  const nav = useNavigate();
  const q = useMembers();
  const [confirm, setConfirm] = useState<{ kind: 'deactivate' | 'delete'; ids: string[]; label: string } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['staff'] }); void qc.invalidateQueries({ queryKey: ['staff-roles'] }); };
  const act = useMutation({
    mutationFn: async (v: { kind: 'deactivate' | 'delete'; ids: string[] }) => {
      for (const id of v.ids) await (v.kind === 'delete' ? mutate(STAFF_DELETE, { id }, 'shopmeStaffDelete') : mutate(STAFF_DEACTIVATE, { id }, 'shopmeStaffDeactivate'));
    },
    onSuccess: (_d, v) => { toast(t(v.kind === 'delete' ? 'users.deleted' : 'users.deactivated')); setConfirm(null); setSelected([]); refresh(); },
    onError: (e) => { setConfirm(null); refresh(); toast(errText(e), 'critical'); },
  });
  const members = q.data?.staffMembers.nodes ?? [];
  const selectable = members.filter((m) => !m.isShopOwner);
  const allSelected = selectable.length > 0 && selectable.every((m) => selected.includes(m.id));
  const exportCsv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = [['email', 'first_name', 'last_name', 'role', 'status'], ...members.map((m) => [m.email, m.firstName ?? '', m.lastName ?? '', m.roleName ?? roleOf(m), m.active ? 'active' : 'inactive'])];
    const url = URL.createObjectURL(new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'users.csv'; a.click(); URL.revokeObjectURL(url);
  };
  const cols = 'grid-cols-[1.5rem_minmax(0,1.6fr)_minmax(0,0.8fr)_3rem_minmax(0,1fr)]';
  return (
    <>
      <SettingsActions>
        <Button onClick={exportCsv} disabled={members.length === 0}>{t('common.export')}</Button>
        <Button onClick={() => setImporting(true)}>{t('bs.import')}</Button>
        <Button variant="primary" onClick={() => nav('/settings/users/new')}>{t('users.addButton')}</Button>
      </SettingsActions>
      {q.isLoading && <Skeleton className="h-24" />}
      {q.error && <Banner>{q.error.message}</Banner>}
      <div className="overflow-hidden rounded-lg bg-canvas shadow-card">
        {selected.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-1.5 text-[13px]">
            <Checkbox aria-label={t('bs.selectAll')} checked={allSelected} onChange={() => setSelected(allSelected ? [] : selectable.map((m) => m.id))} />
            <span className="mr-auto font-medium">{t('bs.selectedCount', { n: selected.length })}</span>
            <Button size="sm" onClick={() => setConfirm({ kind: 'deactivate', ids: selected, label: t('bs.selectedCount', { n: selected.length }) })}>{t('users.deactivate')}</Button>
            <Button size="sm" variant="danger" onClick={() => setConfirm({ kind: 'delete', ids: selected, label: t('bs.selectedCount', { n: selected.length }) })}>{t('common.delete')}</Button>
          </div>
        ) : (
          <div className={`grid ${cols} gap-3 border-b border-line bg-surface px-4 py-2 text-[13px] text-muted`}>
            <Checkbox aria-label={t('bs.selectAll')} checked={false} disabled={selectable.length === 0} onChange={() => setSelected(selectable.map((m) => m.id))} />
            <span>{t('users.col.user')}</span><span>{t('field.status')}</span><span>{t('bs.twoFactor')}</span><span>{t('users.roleLabel')}</span>
          </div>
        )}
        <ul className="divide-y divide-line">
          {members.map((m) => {
            const mine = m.email === user.email;
            const role = roleOf(m);
            return (
              <li key={m.id} className={`grid ${cols} items-center gap-3 px-4 py-3 text-[13px] hover:bg-hover`}>
                {m.isShopOwner || mine ? <span /> : <Checkbox aria-label={m.email} checked={selected.includes(m.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, m.id] : s.filter((x) => x !== m.id)))} />}
                <button type="button" className="min-w-0 text-left" onClick={() => nav(`/settings/users/${encodeURIComponent(m.id)}`)}>
                  <span className="block truncate font-medium">{[m.firstName, m.lastName].filter(Boolean).join(' ') || m.email}</span><span className="block truncate text-xs text-muted">{m.email}</span>
                </button>
                <span><Badge tone={m.active ? 'success' : 'warning'}>{t(m.active ? 'users.active' : 'users.inactive')}</Badge></span>
                <span title={t(m.twoFactor ? 'bs.twoFactorOn' : 'bs.twoFactorOff')} aria-label={t(m.twoFactor ? 'bs.twoFactorOn' : 'bs.twoFactorOff')}><ShieldCheck className={`size-4 ${m.twoFactor ? 'text-success' : 'text-muted opacity-40'}`} /></span>
                <span className="flex min-w-0 items-center gap-2"><Badge tone={role === 'staff' && !m.roleName ? 'neutral' : 'info'}>{m.roleName ?? t(`users.role.${role}` as Key)}</Badge>{role === 'staff' && !m.roleName && <span className="truncate text-xs text-muted">{t('users.areas', { n: m.permissions?.length ?? 0 })}</span>}</span>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="mt-3 text-center text-[13px] text-muted">{t('users.intro')}</p>
      <ConfirmDialog open={!!confirm} danger onClose={() => setConfirm(null)} title={t(confirm?.kind === 'delete' ? 'users.deleteTitle' : 'users.deactivateTitle')} message={t(confirm?.kind === 'delete' ? 'users.deleteBody' : 'users.deactivateBody', { email: confirm?.label ?? '' })}
        confirmLabel={t(confirm?.kind === 'delete' ? 'common.delete' : 'users.deactivate')} cancelLabel={t('common.cancel')} onConfirm={() => confirm && act.mutate({ kind: confirm.kind, ids: confirm.ids })} />
      <ImportUsers open={importing} onClose={() => setImporting(false)} onDone={refresh} />
    </>
  );
}

/** CSV import: columns email, first_name, last_name, role; each row is invited on its own and reported back. */
function ImportUsers({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const file = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState('');
  const [name, setName] = useState('');
  const [result, setResult] = useState<{ invited: number; failed: number; rows: Array<{ line: number; email: string; ok: boolean; message: string | null }> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: async () => (await mutate<{ value: NonNullable<typeof result> }>(STAFF_IMPORT, { csv }, 'shopmeStaffImport')).value,
    onSuccess: (v) => { setResult(v); setError(null); onDone(); }, onError: (e) => setError(errText(e)),
  });
  const close = () => { setCsv(''); setName(''); setResult(null); setError(null); onClose(); };
  return (
    <Modal open={open} onClose={close} closeLabel={t('common.close')} title={t('bs.importTitle')}
      footer={<><Button onClick={close}>{result ? t('common.close') : t('common.cancel')}</Button>{!result && <Button variant="primary" loading={run.isPending} disabled={!csv.trim()} onClick={() => run.mutate()}>{t('bs.import')}</Button>}</>}>
      <div className="flex flex-col gap-3">
        {error && <Banner>{error}</Banner>}
        {!result && (
          <>
            <p className="text-[13px] text-muted">{t('bs.importHelp')}</p>
            <div className="flex items-center gap-2">
              <input ref={file} type="file" accept=".csv,text/csv" className="hidden" aria-label={t('bs.importChoose')}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) { setName(f.name); void f.text().then(setCsv); } }} />
              <Button onClick={() => file.current?.click()}>{t('bs.importChoose')}</Button>
              <span className="truncate text-[13px] text-muted">{name}</span>
            </div>
            <Textarea label={t('bs.importPaste')} rows={5} value={csv} placeholder={'email,first_name,last_name,role\nada@example.com,Ada,Lovelace,staff'} onChange={(e) => setCsv(e.target.value)} />
          </>
        )}
        {result && (
          <div className="flex flex-col gap-2">
            <Banner tone={result.failed ? 'warning' : 'success'}>{t('bs.importResult', { ok: result.invited, failed: result.failed })}</Banner>
            <ul className="max-h-48 divide-y divide-line overflow-y-auto text-[13px]">
              {result.rows.filter((r) => !r.ok).map((r) => <li key={r.line} className="py-1.5"><span className="font-medium">{r.email || t('bs.importLine', { n: r.line })}</span><span className="block text-muted">{r.message}</span></li>)}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Settings > Users > Security: the rule for everyone who works on the store, and a way to the signed-in person's own security. */
export function UsersSecurityPage() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useSecurity();
  const policy = useMutation({ mutationFn: (v: boolean) => rest('/auth/security', { method: 'PUT', body: { require2fa: v } }), onSuccess: () => { toast(t('security.requireToast')); void qc.invalidateQueries({ queryKey: ['security'] }); }, onError: (e) => toast(e.message, 'critical') });
  return (
    <>
      <PageHeader large breadcrumb={{ label: t('users.title'), to: '/settings/users' }} title={t('usec.title')} />
      {q.error && <Banner>{q.error.message}</Banner>}
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold leading-6">{t('usec.twoStep')}</h2>
          <div className="flex items-center justify-between gap-4 rounded-lg bg-canvas p-4 text-[13px] shadow-card">
            <span className="text-muted">{t('usec.twoStepHelp')}</span>
            {!q.data ? <Skeleton className="h-5 w-9" /> : q.data.canManagePolicy ? <Switch checked={q.data.require2fa} onChange={(v) => policy.mutate(v)} label={t(q.data.require2fa ? 'security.on' : 'security.off')} /> : <Badge tone={q.data.require2fa ? 'success' : 'neutral'}>{t(q.data.require2fa ? 'security.on' : 'security.off')}</Badge>}
          </div>
        </section>
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold leading-6">{t('usec.account')}</h2>
          <div className="flex items-center justify-between gap-4 rounded-lg bg-canvas p-4 text-[13px] shadow-card">
            <span className="text-muted">{t('usec.accountHelp')}</span>
            <Button size="sm" onClick={() => nav('/account/security')}>{t('usec.show')}</Button>
          </div>
        </section>
      </div>
    </>
  );
}
