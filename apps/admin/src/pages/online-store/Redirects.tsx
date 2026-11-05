import { Banner, Button, ConfirmDialog, EmptyState, Input, Modal, useToast } from '@shopme/ui';
import type { Column } from '@shopme/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft } from 'lucide-react';
import { useState } from 'react';
import { UserErrors, mutate } from '../../api';
import { PagedTable } from '../../components/PagedTable';
import { URL_REDIRECTS, URL_REDIRECT_CREATE, URL_REDIRECT_DELETE, URL_REDIRECT_UPDATE } from '../../graphql';
import { useT } from '../../i18n';

interface Redirect { id: string; path: string; target: string }
type Draft = { id: string | null; path: string; target: string };

export function RedirectsPage() {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Draft | null>(null);
  const [del, setDel] = useState<Redirect | null>(null);
  const [error, setError] = useState<string | null>(null);
  const done = (msg: string) => { toast(msg); setEdit(null); setDel(null); setError(null); void qc.invalidateQueries({ queryKey: ['redirects'] }); };
  const save = useMutation({
    mutationFn: () => {
      const urlRedirect = { path: edit!.path.trim(), target: edit!.target.trim() };
      return edit!.id ? mutate(URL_REDIRECT_UPDATE, { id: edit!.id, urlRedirect }, 'urlRedirectUpdate') : mutate(URL_REDIRECT_CREATE, { urlRedirect }, 'urlRedirectCreate');
    },
    onSuccess: () => done(t('redirects.saved')), onError: (e) => setError(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message),
  });
  const remove = useMutation({ mutationFn: (id: string) => mutate(URL_REDIRECT_DELETE, { id }, 'urlRedirectDelete'), onSuccess: () => done(t('redirects.deleted')), onError: (e) => { setDel(null); toast(e.message, 'critical'); } });
  const columns: Array<Column<Redirect>> = [
    { key: 'path', header: t('redirects.from'), cell: (r) => <code className="text-[13px]">{r.path}</code> },
    { key: 'target', header: t('redirects.to'), cell: (r) => <code className="text-[13px]">{r.target}</code> },
    { key: 'actions', header: '', className: 'w-24 text-right', cell: (r) => <Button size="sm" variant="danger" onClick={(e) => { e.stopPropagation(); setDel(r); }}>{t('common.delete')}</Button> },
  ];
  const add = <Button variant="primary" onClick={() => setEdit({ id: null, path: '', target: '' })}>{t('redirects.add')}</Button>;
  const valid = !!edit?.path.trim().startsWith('/') && !!edit.target.trim();
  return (
    <>
      <PagedTable<Redirect> title={t('store.redirects')} doc={URL_REDIRECTS} root="urlRedirects" queryKey="redirects" columns={columns} actions={add} searchLabel={t('redirects.search')}
        onRowClick={(r) => setEdit({ id: r.id, path: r.path, target: r.target })}
        empty={<EmptyState icon={<ArrowRightLeft className="size-10" />} title={t('redirects.emptyTitle')} description={t('redirects.emptyBody')} action={add} />} />
      <Modal open={!!edit} onClose={() => setEdit(null)} closeLabel={t('common.close')} title={t(edit?.id ? 'redirects.edit' : 'redirects.add')}
        footer={<><Button onClick={() => setEdit(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>{t('save.save')}</Button></>}>
        <div className="flex flex-col gap-3">
          {error && <Banner>{error}</Banner>}
          <Input label={t('redirects.from')} placeholder="/old-page" help={t('redirects.fromHelp')} value={edit?.path ?? ''} onChange={(e) => setEdit((s) => s && { ...s, path: e.target.value })} />
          <Input label={t('redirects.to')} placeholder="/products/new-page" help={t('redirects.toHelp')} value={edit?.target ?? ''} onChange={(e) => setEdit((s) => s && { ...s, target: e.target.value })} />
        </div>
      </Modal>
      <ConfirmDialog open={!!del} danger onClose={() => setDel(null)} title={t('redirects.deleteTitle')} message={del ? `${del.path} → ${del.target}` : ''} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => del && remove.mutate(del.id)} />
    </>
  );
}
