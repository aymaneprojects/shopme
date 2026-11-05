import { Badge, Banner, Button, Card, Checkbox, ConfirmDialog, Input, Modal, Select, Skeleton, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
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
  const add = <Button variant="primary" onClick={() => { setError(null); setEdit({ id: null, email: '', role: 'staff', permissions: ['products', 'orders'] }); }}><Plus className="size-4" />{t('users.invite')}</Button>;
  return (
    <Card title={t('settings.users')} actions={add}>
      <p className="mb-3 text-sm text-muted">{t('users.intro')}</p>
      {q.isLoading && <Skeleton className="h-24" />}
      {q.error && <Banner>{q.error.message}</Banner>}
      <ul className="divide-y divide-line">
        {members.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
            <span className="min-w-0 flex-1"><span className="block font-medium">{[m.firstName, m.lastName].filter(Boolean).join(' ') || m.email}</span><span className="text-xs text-muted">{m.email}</span></span>
            <Badge tone={role(m) === 'staff' ? 'neutral' : 'info'}>{t(`users.role.${role(m)}` as Key)}</Badge>
            {!m.active && <Badge tone="warning">{t('users.inactive')}</Badge>}
            {role(m) === 'staff' && <span className="text-xs text-muted">{t('users.areas', { n: m.permissions?.length ?? 0 })}</span>}
            {!m.isShopOwner && <>
              <Button size="sm" onClick={() => { setError(null); setEdit({ id: m.id, email: m.email, role: role(m) === 'admin' ? 'admin' : 'staff', permissions: m.permissions ?? [] }); }}>{t('common.edit')}</Button>
              {m.active && <Button size="sm" onClick={() => setConfirm({ kind: 'deactivate', m })}>{t('users.deactivate')}</Button>}
              <Button size="sm" variant="danger" onClick={() => setConfirm({ kind: 'delete', m })}>{t('common.delete')}</Button>
            </>}
          </li>
        ))}
      </ul>
      <Modal open={!!edit} onClose={() => setEdit(null)} closeLabel={t('common.close')} title={t(edit?.id ? 'users.edit' : 'users.invite')}
        footer={<><Button onClick={() => setEdit(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={save.isPending} disabled={!edit?.email.includes('@')} onClick={() => save.mutate()}>{t(edit?.id ? 'save.save' : 'users.sendInvite')}</Button></>}>
        <div className="flex flex-col gap-3">
          {error && <Banner>{error}</Banner>}
          <Input label={t('field.email')} type="email" value={edit?.email ?? ''} disabled={!!edit?.id} onChange={(e) => setEdit((s) => s && { ...s, email: e.target.value })} />
          <Select label={t('users.roleLabel')} value={edit?.role ?? 'staff'} onChange={(e) => setEdit((s) => s && { ...s, role: e.target.value as Role })}>
            <option value="admin">{t('users.role.admin')}</option><option value="staff">{t('users.role.staff')}</option>
          </Select>
          {edit?.role === 'admin' ? <p className="text-sm text-muted">{t('users.adminHelp')}</p> : (
            <fieldset className="flex flex-col gap-1.5"><legend className="mb-1 text-sm font-medium">{t('users.permissions')}</legend>
              {PERMISSIONS.map((p) => <Checkbox key={p} label={t(`users.perm.${p}` as Key)} checked={!!edit?.permissions.includes(p)} onChange={(e) => setEdit((s) => s && { ...s, permissions: e.target.checked ? [...s.permissions, p] : s.permissions.filter((x) => x !== p) })} />)}
            </fieldset>
          )}
        </div>
      </Modal>
      <ConfirmDialog open={!!confirm} danger onClose={() => setConfirm(null)} title={t(confirm?.kind === 'delete' ? 'users.deleteTitle' : 'users.deactivateTitle')} message={t(confirm?.kind === 'delete' ? 'users.deleteBody' : 'users.deactivateBody', { email: confirm?.m.email ?? '' })}
        confirmLabel={t(confirm?.kind === 'delete' ? 'common.delete' : 'users.deactivate')} cancelLabel={t('common.cancel')} onConfirm={() => confirm && act.mutate({ kind: confirm.kind, id: confirm.m.id })} />
    </Card>
  );
}
