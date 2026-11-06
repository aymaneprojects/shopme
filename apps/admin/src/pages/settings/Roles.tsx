import { Banner, Button, Checkbox, ConfirmDialog, Input, Select, Skeleton, Textarea, useToast } from '@shopme/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { mutate } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { SaveBar, guard } from '../../components/SaveBar';
import { STAFF_ROLE_CREATE, STAFF_ROLE_DELETE, STAFF_ROLE_UPDATE } from '../../graphql';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';
import { PERMISSIONS } from '../../lib/permissions';
import { errText, useMembers, useRoles } from './Team';

const LEARN_URL = 'https://github.com/aymaneprojects/shopme#readme';
const rolesCrumb = (label: string) => ({ icon: <Users className="size-4" />, label, to: '/settings/users/roles' });

/** Settings > Users > Roles: the built-in roles and the custom ones, with their category and how many users have them. */
export function RolesSettings() {
  const { t } = useI18n();
  const nav = useNavigate();
  const roles = useRoles();
  const members = useMembers();
  const list = members.data?.staffMembers.nodes ?? [];
  const rows = [
    { key: 'owner', name: t('role.builtin.owner'), users: list.filter((m) => m.isShopOwner).length, to: null as string | null },
    { key: 'admin', name: t('role.builtin.admin'), users: list.filter((m) => !m.isShopOwner && m.role === 'admin').length, to: null },
    ...(roles.data ?? []).map((r) => ({ key: r.id, name: r.name, users: r.members, to: `/settings/users/roles/${encodeURIComponent(r.id)}` })),
  ];
  const exportCsv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const url = URL.createObjectURL(new Blob([[['name', 'category', 'users'], ...rows.map((r) => [r.name, t('role.category.store'), String(r.users)])].map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'roles.csv'; a.click(); URL.revokeObjectURL(url);
  };
  const cols = 'grid-cols-[minmax(0,2fr)_minmax(0,1fr)_5rem]';
  return (
    <>
      <PageHeader large breadcrumb={{ icon: <Users className="size-4" />, label: t('users.title'), to: '/settings/users' }} title={t('bs.roles')}
        actions={<><Button onClick={exportCsv}>{t('role.export')}</Button><Button variant="primary" onClick={() => nav('/settings/users/roles/new')}>{t('bs.addRole')}</Button></>} />
      {(roles.isLoading || members.isLoading) && <Skeleton className="h-24" />}
      {roles.error && <Banner>{roles.error.message}</Banner>}
      <div className="overflow-hidden rounded-lg bg-canvas shadow-card">
        <div className={`grid ${cols} gap-3 border-b border-line bg-surface px-4 py-2 text-[13px] text-muted`}><span>{t('bs.roleName')}</span><span>{t('role.col.category')}</span><span className="text-right">{t('bs.roleMembers')}</span></div>
        <ul className="divide-y divide-line">
          {rows.map((r) => {
            const body = <><span className="truncate font-medium">{r.name}</span><span className="text-muted">{t('role.category.store')}</span><span className="text-right tabular-nums">{r.users}</span></>;
            return <li key={r.key}>{r.to ? <Link to={r.to} className={`grid ${cols} items-center gap-3 px-4 py-3 text-[13px] hover:bg-hover`}>{body}</Link> : <div className={`grid ${cols} items-center gap-3 px-4 py-3 text-[13px]`}>{body}</div>}</li>;
          })}
        </ul>
      </div>
      <p className="mt-3 text-center text-[13px] text-muted"><a href={LEARN_URL} target="_blank" rel="noreferrer" className="hover:underline">{t('role.learn')}</a></p>
    </>
  );
}

/** Settings > Users > Roles > Add (or edit) a role: name, description, then the permissions of its category. */
export function RolePage() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { id } = useParams();
  const roles = useRoles();
  const existing = id ? roles.data?.find((r) => r.id === id) : undefined;
  if (id && roles.isLoading) return <><PageHeader large breadcrumb={rolesCrumb(`${t('users.title')} / ${t('bs.roles')}`)} title="" /><Skeleton className="h-32" /></>;
  if (id && !existing) return <><PageHeader large breadcrumb={rolesCrumb(`${t('users.title')} / ${t('bs.roles')}`)} title={t('role.edit.title')} /><Banner tone="info">{t('ud.notFound')}</Banner></>;
  return <RoleForm key={existing?.id ?? 'new'} existing={existing} onDone={() => { guard.off = true; void qc.invalidateQueries({ queryKey: ['staff-roles'] }); void qc.invalidateQueries({ queryKey: ['staff'] }); nav('/settings/users/roles'); }} toast={toast} />;
}

function RoleForm({ existing, onDone, toast }: { existing: { id: string; name: string; description: string | null; permissions: string[]; members: number } | undefined; onDone: () => void; toast: ReturnType<typeof useToast> }) {
  const { t } = useI18n();
  const initial = { name: existing?.name ?? '', description: existing?.description ?? '', permissions: existing?.permissions ?? [] as string[] };
  const [f, setF] = useState(initial);
  const [del, setDel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = existing ? f.name !== initial.name || f.description !== initial.description || f.permissions.join() !== initial.permissions.join() : f.name.trim() !== '';
  const save = useMutation({
    mutationFn: () => {
      const input = { name: f.name.trim(), description: f.description.trim() || null, permissions: f.permissions };
      return existing ? mutate(STAFF_ROLE_UPDATE, { id: existing.id, ...input }, 'shopmeStaffRoleUpdate') : mutate(STAFF_ROLE_CREATE, input, 'shopmeStaffRoleCreate');
    },
    onSuccess: () => { toast(t('role.saved')); onDone(); }, onError: (e) => setError(errText(e)),
  });
  const remove = useMutation({
    mutationFn: () => mutate(STAFF_ROLE_DELETE, { id: existing!.id }, 'shopmeStaffRoleDelete'),
    onSuccess: () => onDone(), onError: (e) => { setDel(false); toast(errText(e), 'critical'); },
  });
  return (
    <div className="flex flex-col gap-6">
      <SaveBar dirty={dirty && !!f.name.trim()} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => { setF(initial); setError(null); }} />
      <PageHeader large breadcrumb={rolesCrumb(`${t('users.title')} / ${t('bs.roles')}`)} title={t(existing ? 'role.edit.title' : 'role.add.title')}
        actions={existing ? <Button variant="danger" onClick={() => setDel(true)}>{t('common.delete')}</Button> : undefined} />
      {error && <Banner>{error}</Banner>}
      <div className="flex flex-col gap-3 rounded-lg bg-canvas p-4 shadow-card">
        <Input label={t('role.name')} maxLength={255} autoFocus={!existing} value={f.name} help={`${f.name.length}/255`} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Textarea label={t('role.description')} rows={2} maxLength={255} value={f.description} help={`${f.description.length}/255`} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </div>
      <section className="flex flex-col gap-2">
        <div><h2 className="text-sm font-semibold leading-6">{t('role.permissions')}</h2><p className="text-[13px] text-muted">{t('role.permissionsHelp')}</p></div>
        <div className="flex flex-col gap-3 rounded-lg bg-canvas p-4 shadow-card">
          <Select label={t('role.categoryPick')} value="store" onChange={() => undefined}><option value="store">{t('role.category.store')}</option></Select>
          <fieldset className="flex flex-col gap-1.5"><legend className="sr-only">{t('role.permissions')}</legend>
            {PERMISSIONS.map((p) => <Checkbox key={p} label={t(`users.perm.${p}` as Key)} checked={f.permissions.includes(p)} onChange={(e) => setF({ ...f, permissions: e.target.checked ? [...f.permissions, p] : f.permissions.filter((x) => x !== p) })} />)}
          </fieldset>
          {existing && <p className="text-[13px] text-muted">{t('bs.roleEditNote')}</p>}
        </div>
      </section>
      <ConfirmDialog open={del} danger onClose={() => setDel(false)} title={t('bs.deleteRoleTitle', { name: existing?.name ?? '' })} message={t('bs.deleteRoleBody', { n: existing?.members ?? 0 })}
        confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => remove.mutate()} />
    </div>
  );
}
