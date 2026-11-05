import { Badge, Banner, Button, Checkbox, ConfirmDialog, Input, Modal, Select, Skeleton, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SettingsActions } from '../../components/SettingsKit';
import { useState } from 'react';
import { UserErrors, gql, mutate } from '../../api';
import { STAFF_DEACTIVATE, STAFF_DELETE, STAFF_INVITE, STAFF_MEMBERS, STAFF_UPDATE } from '../../graphql';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';
import { PERMISSIONS } from '../../lib/permissions';
import type { Role } from '../../lib/permissions';

interface Member { id: string; email: string; firstName: string | null; lastName: string | null; active: boolean; isShopOwner: boolean; role: Role | null; permissions: string[] | null }
interface Draft { id: string | null; email: string; role: Role; permissions: string[] }

export function UsersSettings() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['staff'], queryFn: () => gql<{ staffMembers: { nodes: Member[] } }>(STAFF_MEMBERS) });
  const [edit, setEdit] = useState<Draft | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'deactivate' | 'delete'; m: Member } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const done = (msg: Key) => { toast(t(msg)); setEdit(null); setConfirm(null); setError(null); void qc.invalidateQueries({ queryKey: ['staff'] }); };
  const save = useMutation({
    mutationFn: () => {
      const permissions = edit!.role === 'staff' ? edit!.permissions : [...PERMISSIONS];
      return edit!.id ? mutate(STAFF_UPDATE, { id: edit!.id, role: edit!.role, permissions }, 'shopmeStaffUpdate') : mutate(STAFF_INVITE, { email: edit!.email.trim(), role: edit!.role, permissions }, 'shopmeStaffInvite');
    },
    onSuccess: () => done(edit?.id ? 'users.saved' : 'users.invited'), onError: (e) => setError(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message),
  });
  const act = useMutation({
    mutationFn: (v: { kind: 'deactivate' | 'delete'; id: string }) => (v.kind === 'delete' ? mutate(STAFF_DELETE, { id: v.id }, 'shopmeStaffDelete') : mutate(STAFF_DEACTIVATE, { id: v.id }, 'shopmeStaffDeactivate')),
    onSuccess: (_d, v) => done(v.kind === 'delete' ? 'users.deleted' : 'users.deactivated'), onError: (e) => { setConfirm(null); toast(e.message, 'critical'); },
  });
  const members = q.data?.staffMembers.nodes ?? [];
  const role = (m: Member): Role => (m.isShopOwner ? 'owner' : m.role ?? 'staff');
  const draftOf = (m: Member): Draft => ({ id: m.id, email: m.email, role: role(m) === 'admin' ? 'admin' : 'staff', permissions: m.permissions ?? [] });
  const editing = members.find((m) => m.id === edit?.id);
  const exportCsv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = [['email', 'first_name', 'last_name', 'role', 'status'], ...members.map((m) => [m.email, m.firstName ?? '', m.lastName ?? '', role(m), m.active ? 'active' : 'inactive'])];
    const url = URL.createObjectURL(new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'users.csv'; a.click(); URL.revokeObjectURL(url);
  };
  return (
    <>
      <SettingsActions>
        <Button onClick={exportCsv} disabled={members.length === 0}>{t('common.export')}</Button>
        <Button variant="primary" onClick={() => { setError(null); setEdit({ id: null, email: '', role: 'staff', permissions: ['products', 'orders'] }); }}>{t('users.invite')}</Button>
      </SettingsActions>
      {q.isLoading && <Skeleton className="h-24" />}
      {q.error && <Banner>{q.error.message}</Banner>}
      <div className="overflow-hidden rounded-lg bg-canvas shadow-card">
        <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,1fr)] gap-3 border-b border-line bg-surface px-4 py-2 text-[13px] text-muted"><span>{t('users.col.user')}</span><span>{t('field.status')}</span><span>{t('users.roleLabel')}</span></div>
        <ul className="divide-y divide-line">
          {members.map((m) => {
            const body = (
              <>
                <span className="min-w-0"><span className="block truncate font-medium">{[m.firstName, m.lastName].filter(Boolean).join(' ') || m.email}</span><span className="block truncate text-xs text-muted">{m.email}</span></span>
                <span><Badge tone={m.active ? 'success' : 'warning'}>{t(m.active ? 'users.active' : 'users.inactive')}</Badge></span>
                <span className="flex min-w-0 items-center gap-2"><Badge tone={role(m) === 'staff' ? 'neutral' : 'info'}>{t(`users.role.${role(m)}` as Key)}</Badge>{role(m) === 'staff' && <span className="truncate text-xs text-muted">{t('users.areas', { n: m.permissions?.length ?? 0 })}</span>}</span>
              </>
            );
            const cls = 'grid w-full grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,1fr)] items-center gap-3 px-4 py-3 text-left text-[13px]';
            return <li key={m.id}>{m.isShopOwner ? <div className={cls}>{body}</div> : <button type="button" className={`${cls} hover:bg-hover`} onClick={() => { setError(null); setEdit(draftOf(m)); }}>{body}</button>}</li>;
          })}
        </ul>
      </div>
      <p className="mt-3 text-center text-[13px] text-muted">{t('users.intro')}</p>
      <Modal open={!!edit} onClose={() => setEdit(null)} closeLabel={t('common.close')} title={t(edit?.id ? 'users.edit' : 'users.invite')}
        footer={<>{editing && <span className="mr-auto flex gap-2"><Button variant="danger" onClick={() => { setConfirm({ kind: 'delete', m: editing }); }}>{t('common.delete')}</Button>{editing.active && <Button onClick={() => { setConfirm({ kind: 'deactivate', m: editing }); }}>{t('users.deactivate')}</Button>}</span>}<Button onClick={() => setEdit(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={save.isPending} disabled={!edit?.email.includes('@')} onClick={() => save.mutate()}>{t(edit?.id ? 'save.save' : 'users.sendInvite')}</Button></>}>
        <div className="flex flex-col gap-3">
          {error && <Banner>{error}</Banner>}
          <Input label={t('field.email')} type="email" value={edit?.email ?? ''} disabled={!!edit?.id} onChange={(e) => setEdit((s) => s && { ...s, email: e.target.value })} />
          <Select label={t('users.roleLabel')} value={edit?.role ?? 'staff'} onChange={(e) => setEdit((s) => s && { ...s, role: e.target.value as Role })}>
            <option value="admin">{t('users.role.admin')}</option><option value="staff">{t('users.role.staff')}</option>
          </Select>
          {edit?.role === 'admin' ? <p className="text-[13px] text-muted">{t('users.adminHelp')}</p> : (
            <fieldset className="flex flex-col gap-1.5"><legend className="mb-1 text-[13px] font-medium">{t('users.permissions')}</legend>
              {PERMISSIONS.map((p) => <Checkbox key={p} label={t(`users.perm.${p}` as Key)} checked={!!edit?.permissions.includes(p)} onChange={(e) => setEdit((s) => s && { ...s, permissions: e.target.checked ? [...s.permissions, p] : s.permissions.filter((x) => x !== p) })} />)}
            </fieldset>
          )}
        </div>
      </Modal>
      <ConfirmDialog open={!!confirm} danger onClose={() => setConfirm(null)} title={t(confirm?.kind === 'delete' ? 'users.deleteTitle' : 'users.deactivateTitle')} message={t(confirm?.kind === 'delete' ? 'users.deleteBody' : 'users.deactivateBody', { email: confirm?.m.email ?? '' })}
        confirmLabel={t(confirm?.kind === 'delete' ? 'common.delete' : 'users.deactivate')} cancelLabel={t('common.cancel')} onConfirm={() => confirm && act.mutate({ kind: confirm.kind, id: confirm.m.id })} />
    </>
  );
}
