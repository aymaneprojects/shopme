import { Badge, Banner, Button, Checkbox, ConfirmDialog, Input, Modal, Select, Skeleton, Textarea, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router';
import { ShieldCheck } from 'lucide-react';
import { SettingsActions } from '../../components/SettingsKit';
import { useRef, useState } from 'react';
import { UserErrors, gql, mutate } from '../../api';
import {
  STAFF_DEACTIVATE, STAFF_DELETE, STAFF_IMPORT, STAFF_INVITE, STAFF_INVITE_ROLE, STAFF_MEMBERS_EXT, STAFF_ROLES, STAFF_ROLE_ASSIGN, STAFF_ROLE_CREATE, STAFF_ROLE_DELETE, STAFF_ROLE_UPDATE, STAFF_UPDATE,
} from '../../graphql';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';
import { PERMISSIONS } from '../../lib/permissions';
import type { Role } from '../../lib/permissions';
import { useShop } from '../../session';

interface Member { id: string; email: string; firstName: string | null; lastName: string | null; active: boolean; isShopOwner: boolean; role: Role | null; permissions: string[] | null; twoFactor: boolean; roleId: string | null; roleName: string | null }
interface CustomRole { id: string; name: string; description: string | null; permissions: string[]; members: number }
interface Draft { id: string | null; email: string; role: Role; roleId: string; permissions: string[] }

const errText = (e: unknown) => (e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : (e as Error).message);
const useRoles = () => useQuery({ queryKey: ['staff-roles'], queryFn: async () => (await gql<{ shopmeStaffRoles: CustomRole[] }>(STAFF_ROLES)).shopmeStaffRoles });

/** Users / Roles / Security: the three pages of the team area. */
export function UsersTabs() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const tab = (to: string, label: string) => <Link key={to} to={to} aria-current={pathname === to ? 'page' : undefined} className={`rounded-full px-3 py-1 text-[13px] font-medium ${pathname === to ? 'bg-hover text-text' : 'text-muted hover:bg-hover'}`}>{label}</Link>;
  return <nav aria-label={t('users.title')} className="mb-4 flex gap-1">{tab('/settings/users', t('users.title'))}{tab('/settings/users/roles', t('bs.roles'))}{tab('/settings/security', t('settings.security'))}</nav>;
}

export function UsersSettings() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useShop();
  const q = useQuery({ queryKey: ['staff'], queryFn: () => gql<{ staffMembers: { nodes: Member[] } }>(STAFF_MEMBERS_EXT) });
  const roles = useRoles();
  const [edit, setEdit] = useState<Draft | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'deactivate' | 'delete'; ids: string[]; label: string } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['staff'] }); void qc.invalidateQueries({ queryKey: ['staff-roles'] }); };
  const done = (msg: Key) => { toast(t(msg)); setEdit(null); setConfirm(null); setError(null); setSelected([]); refresh(); };
  const customRoles = roles.data ?? [];
  const save = useMutation({
    mutationFn: async () => {
      const d = edit!;
      const custom = d.role === 'staff' && d.roleId ? customRoles.find((r) => r.id === d.roleId) : undefined;
      const permissions = d.role === 'staff' ? (custom ? custom.permissions : d.permissions) : [...PERMISSIONS];
      if (!d.id) return custom ? mutate(STAFF_INVITE_ROLE, { email: d.email.trim(), role: 'staff', roleId: custom.id, permissions }, 'shopmeStaffInvite') : mutate(STAFF_INVITE, { email: d.email.trim(), role: d.role, permissions }, 'shopmeStaffInvite');
      if (custom) return mutate(STAFF_ROLE_ASSIGN, { id: d.id, roleId: custom.id }, 'shopmeStaffRoleAssign');
      return mutate(STAFF_UPDATE, { id: d.id, role: d.role, permissions }, 'shopmeStaffUpdate');
    },
    onSuccess: () => done(edit?.id ? 'users.saved' : 'users.invited'), onError: (e) => setError(errText(e)),
  });
  const act = useMutation({
    mutationFn: async (v: { kind: 'deactivate' | 'delete'; ids: string[] }) => {
      for (const id of v.ids) await (v.kind === 'delete' ? mutate(STAFF_DELETE, { id }, 'shopmeStaffDelete') : mutate(STAFF_DEACTIVATE, { id }, 'shopmeStaffDeactivate'));
    },
    onSuccess: (_d, v) => done(v.kind === 'delete' ? 'users.deleted' : 'users.deactivated'), onError: (e) => { setConfirm(null); refresh(); toast(errText(e), 'critical'); },
  });
  const members = q.data?.staffMembers.nodes ?? [];
  const role = (m: Member): Role => (m.isShopOwner ? 'owner' : m.role ?? 'staff');
  const draftOf = (m: Member): Draft => ({ id: m.id, email: m.email, role: role(m) === 'admin' ? 'admin' : 'staff', roleId: m.roleId ?? '', permissions: m.permissions ?? [] });
  const editing = members.find((m) => m.id === edit?.id);
  const selectable = members.filter((m) => !m.isShopOwner);
  const allSelected = selectable.length > 0 && selectable.every((m) => selected.includes(m.id));
  const exportCsv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = [['email', 'first_name', 'last_name', 'role', 'status'], ...members.map((m) => [m.email, m.firstName ?? '', m.lastName ?? '', m.roleName ?? role(m), m.active ? 'active' : 'inactive'])];
    const url = URL.createObjectURL(new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'users.csv'; a.click(); URL.revokeObjectURL(url);
  };
  const cols = 'grid-cols-[1.5rem_minmax(0,1.6fr)_minmax(0,0.8fr)_3rem_minmax(0,1fr)]';
  return (
    <>
      <UsersTabs />
      <SettingsActions>
        <Button onClick={exportCsv} disabled={members.length === 0}>{t('common.export')}</Button>
        <Button onClick={() => setImporting(true)}>{t('bs.import')}</Button>
        <Button variant="primary" onClick={() => { setError(null); setEdit({ id: null, email: '', role: 'staff', roleId: '', permissions: ['products', 'orders'] }); }}>{t('users.addButton')}</Button>
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
            return (
              <li key={m.id} className={`grid ${cols} items-center gap-3 px-4 py-3 text-[13px] hover:bg-hover`}>
                {m.isShopOwner || mine ? <span /> : <Checkbox aria-label={m.email} checked={selected.includes(m.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, m.id] : s.filter((x) => x !== m.id)))} />}
                <button type="button" disabled={m.isShopOwner} className="min-w-0 text-left" onClick={() => { setError(null); setEdit(draftOf(m)); }}>
                  <span className="block truncate font-medium">{[m.firstName, m.lastName].filter(Boolean).join(' ') || m.email}</span><span className="block truncate text-xs text-muted">{m.email}</span>
                </button>
                <span><Badge tone={m.active ? 'success' : 'warning'}>{t(m.active ? 'users.active' : 'users.inactive')}</Badge></span>
                <span title={t(m.twoFactor ? 'bs.twoFactorOn' : 'bs.twoFactorOff')} aria-label={t(m.twoFactor ? 'bs.twoFactorOn' : 'bs.twoFactorOff')}><ShieldCheck className={`size-4 ${m.twoFactor ? 'text-success' : 'text-muted opacity-40'}`} /></span>
                <span className="flex min-w-0 items-center gap-2"><Badge tone={role(m) === 'staff' && !m.roleName ? 'neutral' : 'info'}>{m.roleName ?? t(`users.role.${role(m)}` as Key)}</Badge>{role(m) === 'staff' && !m.roleName && <span className="truncate text-xs text-muted">{t('users.areas', { n: m.permissions?.length ?? 0 })}</span>}</span>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="mt-3 text-center text-[13px] text-muted">{t('users.intro')}</p>
      <Modal open={!!edit} onClose={() => setEdit(null)} closeLabel={t('common.close')} title={t(edit?.id ? 'users.edit' : 'users.invite')}
        footer={<>{editing && <span className="mr-auto flex gap-2"><Button variant="danger" onClick={() => setConfirm({ kind: 'delete', ids: [editing.id], label: editing.email })}>{t('common.delete')}</Button>{editing.active && <Button onClick={() => setConfirm({ kind: 'deactivate', ids: [editing.id], label: editing.email })}>{t('users.deactivate')}</Button>}</span>}<Button onClick={() => setEdit(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={save.isPending} disabled={!edit?.email.includes('@')} onClick={() => save.mutate()}>{t(edit?.id ? 'save.save' : 'users.sendInvite')}</Button></>}>
        <div className="flex flex-col gap-3">
          {error && <Banner>{error}</Banner>}
          <Input label={t('field.email')} type="email" value={edit?.email ?? ''} disabled={!!edit?.id} onChange={(e) => setEdit((s) => s && { ...s, email: e.target.value })} />
          <Select label={t('users.roleLabel')} value={edit?.role === 'admin' ? 'admin' : edit?.roleId ? `role:${edit.roleId}` : 'staff'}
            onChange={(e) => { const v = e.target.value; setEdit((s) => s && (v === 'admin' ? { ...s, role: 'admin', roleId: '' } : v === 'staff' ? { ...s, role: 'staff', roleId: '' } : { ...s, role: 'staff', roleId: v.slice(5) })); }}>
            <option value="admin">{t('users.role.admin')}</option><option value="staff">{t('users.role.staff')}</option>
            {customRoles.map((r) => <option key={r.id} value={`role:${r.id}`}>{r.name}</option>)}
          </Select>
          {edit?.role === 'admin' ? <p className="text-[13px] text-muted">{t('users.adminHelp')}</p> : edit?.roleId ? (
            <p className="text-[13px] text-muted">{t('bs.roleFollows', { n: customRoles.find((r) => r.id === edit.roleId)?.permissions.length ?? 0 })}</p>
          ) : (
            <fieldset className="flex flex-col gap-1.5"><legend className="mb-1 text-[13px] font-medium">{t('users.permissions')}</legend>
              {PERMISSIONS.map((p) => <Checkbox key={p} label={t(`users.perm.${p}` as Key)} checked={!!edit?.permissions.includes(p)} onChange={(e) => setEdit((s) => s && { ...s, permissions: e.target.checked ? [...s.permissions, p] : s.permissions.filter((x) => x !== p) })} />)}
            </fieldset>
          )}
        </div>
      </Modal>
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

const PERM_LABEL = (p: string) => `users.perm.${p}` as Key;

/** Custom roles: a named set of permission areas, assigned to staff members from the users page. */
export function RolesSettings() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useRoles();
  const [edit, setEdit] = useState<{ id: string | null; name: string; description: string; permissions: string[] } | null>(null);
  const [del, setDel] = useState<CustomRole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['staff-roles'] }); void qc.invalidateQueries({ queryKey: ['staff'] }); };
  const save = useMutation({
    mutationFn: () => {
      const e = edit!;
      return e.id ? mutate(STAFF_ROLE_UPDATE, { id: e.id, name: e.name.trim(), description: e.description.trim() || null, permissions: e.permissions }, 'shopmeStaffRoleUpdate')
        : mutate(STAFF_ROLE_CREATE, { name: e.name.trim(), description: e.description.trim() || null, permissions: e.permissions }, 'shopmeStaffRoleCreate');
    },
    onSuccess: () => { toast(t('settings.saved')); setEdit(null); setError(null); refresh(); }, onError: (e) => setError(errText(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => mutate(STAFF_ROLE_DELETE, { id }, 'shopmeStaffRoleDelete'),
    onSuccess: () => { setDel(null); refresh(); }, onError: (e) => { setDel(null); toast(errText(e), 'critical'); },
  });
  const roles = q.data ?? [];
  return (
    <>
      <UsersTabs />
      <SettingsActions><Button variant="primary" onClick={() => { setError(null); setEdit({ id: null, name: '', description: '', permissions: ['products'] }); }}>{t('bs.addRole')}</Button></SettingsActions>
      {q.isLoading && <Skeleton className="h-24" />}
      {q.error && <Banner>{q.error.message}</Banner>}
      <div className="overflow-hidden rounded-lg bg-canvas shadow-card">
        <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,2fr)_5rem] gap-3 border-b border-line bg-surface px-4 py-2 text-[13px] text-muted"><span>{t('bs.roleName')}</span><span>{t('users.permissions')}</span><span>{t('bs.roleMembers')}</span></div>
        <ul className="divide-y divide-line">
          {roles.map((r) => (
            <li key={r.id}>
              <button type="button" className="grid w-full grid-cols-[minmax(0,1.4fr)_minmax(0,2fr)_5rem] items-center gap-3 px-4 py-3 text-left text-[13px] hover:bg-hover" onClick={() => { setError(null); setEdit({ id: r.id, name: r.name, description: r.description ?? '', permissions: r.permissions }); }}>
                <span className="min-w-0"><span className="block truncate font-medium">{r.name}</span>{r.description && <span className="block truncate text-xs text-muted">{r.description}</span>}</span>
                <span className="truncate text-muted">{r.permissions.map((p) => t(PERM_LABEL(p))).join(', ') || '—'}</span>
                <span>{r.members}</span>
              </button>
            </li>
          ))}
          {q.data && roles.length === 0 && <li className="px-4 py-6 text-center text-[13px] text-muted">{t('bs.rolesEmpty')}</li>}
        </ul>
      </div>
      <p className="mt-3 text-center text-[13px] text-muted">{t('bs.rolesIntro')}</p>
      <Modal open={!!edit} onClose={() => setEdit(null)} closeLabel={t('common.close')} title={t(edit?.id ? 'bs.editRole' : 'bs.addRole')}
        footer={<>{edit?.id && <Button variant="danger" className="mr-auto" onClick={() => setDel(roles.find((r) => r.id === edit.id) ?? null)}>{t('common.delete')}</Button>}<Button onClick={() => setEdit(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={save.isPending} disabled={!edit?.name.trim()} onClick={() => save.mutate()}>{t('save.save')}</Button></>}>
        {edit && (
          <div className="flex flex-col gap-3">
            {error && <Banner>{error}</Banner>}
            <Input label={t('bs.roleName')} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <Input label={t('field.description')} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
            <fieldset className="flex flex-col gap-1.5"><legend className="mb-1 text-[13px] font-medium">{t('users.permissions')}</legend>
              {PERMISSIONS.map((p) => <Checkbox key={p} label={t(PERM_LABEL(p))} checked={edit.permissions.includes(p)} onChange={(e) => setEdit({ ...edit, permissions: e.target.checked ? [...edit.permissions, p] : edit.permissions.filter((x) => x !== p) })} />)}
            </fieldset>
            {edit.id && <p className="text-[13px] text-muted">{t('bs.roleEditNote')}</p>}
          </div>
        )}
      </Modal>
      <ConfirmDialog open={!!del} danger onClose={() => setDel(null)} title={t('bs.deleteRoleTitle', { name: del?.name ?? '' })} message={t('bs.deleteRoleBody', { n: del?.members ?? 0 })}
        confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => { if (del) remove.mutate(del.id); setEdit(null); }} />
    </>
  );
}
