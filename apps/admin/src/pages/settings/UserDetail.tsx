import { Badge, Banner, Button, Checkbox, ConfirmDialog, Dropdown, Modal, Select, Skeleton, useToast } from '@shopme/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Users } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { mutate } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { personInitials } from '../../components/AccountMenu';
import { STAFF_DEACTIVATE, STAFF_DELETE, STAFF_ROLE_ASSIGN, STAFF_UPDATE } from '../../graphql';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';
import { PERMISSIONS } from '../../lib/permissions';
import { errText, roleOf, useMembers, useRoles } from './Team';
import type { Member } from './Team';

interface Draft { role: 'admin' | 'staff'; roleId: string; permissions: string[] }

/** Settings > Users > one user: status, e-mail, and the roles that grant their permissions (change them, deactivate or remove the user). */
export function UserDetailPage() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { id } = useParams();
  const q = useMembers();
  const roles = useRoles();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirm, setConfirm] = useState<'deactivate' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const m: Member | undefined = q.data?.staffMembers.nodes.find((x) => x.id === id);
  const customRoles = roles.data ?? [];
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['staff'] }); void qc.invalidateQueries({ queryKey: ['staff-roles'] }); };
  const save = useMutation({
    mutationFn: async () => {
      const d = draft!;
      const custom = d.role === 'staff' && d.roleId ? customRoles.find((r) => r.id === d.roleId) : undefined;
      if (custom) return mutate(STAFF_ROLE_ASSIGN, { id: m!.id, roleId: custom.id }, 'shopmeStaffRoleAssign');
      return mutate(STAFF_UPDATE, { id: m!.id, role: d.role, permissions: d.role === 'staff' ? d.permissions : [...PERMISSIONS] }, 'shopmeStaffUpdate');
    },
    onSuccess: () => { toast(t('users.saved')); setDraft(null); setError(null); refresh(); }, onError: (e) => setError(errText(e)),
  });
  const act = useMutation({
    mutationFn: (kind: 'deactivate' | 'delete') => (kind === 'delete' ? mutate(STAFF_DELETE, { id: m!.id }, 'shopmeStaffDelete') : mutate(STAFF_DEACTIVATE, { id: m!.id }, 'shopmeStaffDeactivate')),
    onSuccess: (_d, kind) => { toast(t(kind === 'delete' ? 'users.deleted' : 'users.deactivated')); setConfirm(null); refresh(); if (kind === 'delete') nav('/settings/users'); },
    onError: (e) => { setConfirm(null); toast(errText(e), 'critical'); },
  });
  const crumb = { icon: <Users className="size-4" />, label: t('users.title'), to: '/settings/users' };
  if (q.isLoading) return <><PageHeader large breadcrumb={crumb} title="" /><Skeleton className="h-32" /></>;
  if (!m) return <><PageHeader large breadcrumb={crumb} title={t('users.title')} /><Banner tone="info">{t('ud.notFound')}</Banner></>;

  const name = [m.firstName, m.lastName].filter(Boolean).join(' ') || m.email;
  const role = roleOf(m);
  const roleLabel = m.roleName ?? t(`users.role.${role}` as Key);
  const editable = !m.isShopOwner;
  const items = editable ? [
    { key: 'edit', label: t('ud.editRole'), onSelect: () => { setError(null); setDraft({ role: role === 'admin' ? 'admin' : 'staff', roleId: m.roleId ?? '', permissions: m.permissions ?? [] }); } },
    ...(m.active ? [{ key: 'deactivate', label: t('users.deactivate'), onSelect: () => setConfirm('deactivate') }] : []),
    { key: 'delete', label: t('common.delete'), danger: true, separatorBefore: true, onSelect: () => setConfirm('delete') },
  ] : [];
  const avatar = <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-[11px] font-semibold text-on-primary" aria-hidden>{personInitials(m)}</span>;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader large breadcrumb={crumb} title={name} badges={<Badge tone={m.active ? 'success' : 'warning'}>{t(m.active ? 'users.active' : 'users.inactive')}</Badge>} />
      <section className="flex flex-col gap-2">
        <div><h2 className="text-sm font-semibold leading-6">{t(m.isShopOwner ? 'ud.owner' : 'ud.email')}</h2>{m.isShopOwner && <p className="text-[13px] text-muted">{t('ud.ownerHelp')}</p>}</div>
        <div className="flex items-center gap-3 rounded-lg bg-canvas p-3 text-[13px] shadow-card">{avatar}<span className="min-w-0 truncate font-medium">{m.email}</span></div>
      </section>
      <section className="flex flex-col gap-2">
        <div><h2 className="text-sm font-semibold leading-6">{t('ud.roles')}</h2><p className="text-[13px] text-muted">{t('ud.rolesHelp')}</p></div>
        <div className="flex items-start justify-between gap-3 rounded-lg bg-canvas p-4 text-[13px] shadow-card">
          <div className="min-w-0">
            <div className="font-medium">{roleLabel}</div>
            <div className="text-muted">{t('ud.category.store')}</div>
            {role === 'staff' && !m.roleName && <div className="mt-1 text-muted">{(m.permissions ?? []).map((p) => t(`users.perm.${p}` as Key)).join(', ') || '—'}</div>}
          </div>
          {items.length > 0 && <Dropdown align="right" icon variant="plain" label={t('ud.rolesMore')} trigger={<MoreHorizontal className="size-4" />} items={items} />}
        </div>
      </section>
      <Modal open={!!draft} onClose={() => setDraft(null)} closeLabel={t('common.close')} title={t('ud.editRole')}
        footer={<><Button onClick={() => setDraft(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>{t('save.save')}</Button></>}>
        {draft && (
          <div className="flex flex-col gap-3">
            {error && <Banner>{error}</Banner>}
            <Select label={t('users.roleLabel')} value={draft.role === 'admin' ? 'admin' : draft.roleId ? `role:${draft.roleId}` : 'staff'}
              onChange={(e) => { const v = e.target.value; setDraft(v === 'admin' ? { ...draft, role: 'admin', roleId: '' } : v === 'staff' ? { ...draft, role: 'staff', roleId: '' } : { ...draft, role: 'staff', roleId: v.slice(5) }); }}>
              <option value="admin">{t('users.role.admin')}</option><option value="staff">{t('users.role.staff')}</option>
              {customRoles.map((r) => <option key={r.id} value={`role:${r.id}`}>{r.name}</option>)}
            </Select>
            {draft.role === 'admin' ? <p className="text-[13px] text-muted">{t('users.adminHelp')}</p> : draft.roleId ? (
              <p className="text-[13px] text-muted">{t('bs.roleFollows', { n: customRoles.find((r) => r.id === draft.roleId)?.permissions.length ?? 0 })}</p>
            ) : (
              <fieldset className="flex flex-col gap-1.5"><legend className="mb-1 text-[13px] font-medium">{t('users.permissions')}</legend>
                {PERMISSIONS.map((p) => <Checkbox key={p} label={t(`users.perm.${p}` as Key)} checked={draft.permissions.includes(p)} onChange={(e) => setDraft({ ...draft, permissions: e.target.checked ? [...draft.permissions, p] : draft.permissions.filter((x) => x !== p) })} />)}
              </fieldset>
            )}
          </div>
        )}
      </Modal>
      <ConfirmDialog open={!!confirm} danger onClose={() => setConfirm(null)} title={t(confirm === 'delete' ? 'users.deleteTitle' : 'users.deactivateTitle')} message={t(confirm === 'delete' ? 'users.deleteBody' : 'users.deactivateBody', { email: m.email })}
        confirmLabel={t(confirm === 'delete' ? 'common.delete' : 'users.deactivate')} cancelLabel={t('common.cancel')} onConfirm={() => confirm && act.mutate(confirm)} />
    </div>
  );
}
