import { Badge, Banner, Button, Card, Checkbox, ConfirmDialog, EmptyState, Input, Modal, Select, Skeleton, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, MapPin } from 'lucide-react';
import { useState } from 'react';
import { UserErrors, gql, mutate } from '../../api';
import { LOCATIONS_ADMIN, LOCATIONS_REORDER, LOCATION_ACTIVATE, LOCATION_ADD, LOCATION_DEACTIVATE, LOCATION_EDIT } from '../../graphql';
import { useI18n } from '../../i18n';
import { countryOptions } from '../../lib/countries';

interface Loc {
  id: string; name: string; isActive: boolean; fulfillsOnlineOrders: boolean; priority: number; isPrimary: boolean; hasActiveInventory: boolean;
  address: { address1: string | null; address2: string | null; city: string | null; zip: string | null; countryCode: string | null; phone: string | null };
}
interface Form { name: string; address1: string; address2: string; city: string; zip: string; countryCode: string; phone: string; fulfillsOnlineOrders: boolean }
const blank = (country: string): Form => ({ name: '', address1: '', address2: '', city: '', zip: '', countryCode: country, phone: '', fulfillsOnlineOrders: true });
const formOf = (l: Loc): Form => ({ name: l.name, address1: l.address.address1 ?? '', address2: l.address.address2 ?? '', city: l.address.city ?? '', zip: l.address.zip ?? '', countryCode: l.address.countryCode ?? 'US', phone: l.address.phone ?? '', fulfillsOnlineOrders: l.fulfillsOnlineOrders });
const summary = (a: Loc['address']) => [a.address1, [a.zip, a.city].filter(Boolean).join(' '), a.countryCode].filter(Boolean).join(', ');

export function LocationsSettings() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['locations-admin'], queryFn: () => gql<{ locations: { nodes: Loc[] } }>(LOCATIONS_ADMIN) });
  const [editing, setEditing] = useState<{ loc: Loc | null; form: Form } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deactivate, setDeactivate] = useState<{ loc: Loc; destination: string } | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['locations-admin'] }); void qc.invalidateQueries({ queryKey: ['locations'] }); void qc.invalidateQueries({ queryKey: ['inventory'] }); };
  const fail = (e: Error) => toast(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message, 'critical');

  const all = q.data?.locations.nodes ?? [];
  const active = all.filter((l) => l.isActive);
  const country = 'US';

  const save = useMutation({
    mutationFn: () => {
      const { loc, form } = editing!;
      const input = {
        name: form.name.trim(), fulfillsOnlineOrders: form.fulfillsOnlineOrders,
        address: { address1: form.address1 || null, address2: form.address2 || null, city: form.city || null, zip: form.zip || null, countryCode: form.countryCode, phone: form.phone || null },
      };
      return loc ? mutate(LOCATION_EDIT, { id: loc.id, input }, 'locationEdit') : mutate(LOCATION_ADD, { input }, 'locationAdd');
    },
    onSuccess: () => { toast(t('loc.saved')); setEditing(null); setError(null); refresh(); },
    onError: (e) => setError(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message),
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => mutate(LOCATIONS_REORDER, { locationIds: ids }, 'shopmeLocationsReorder'),
    onSuccess: refresh, onError: fail,
  });
  const activate = useMutation({
    mutationFn: (id: string) => gql<{ locationActivate: { locationActivateUserErrors: Array<{ message: string }> } }>(LOCATION_ACTIVATE, { locationId: id }).then((d) => { const e = d.locationActivate.locationActivateUserErrors; if (e.length) throw new Error(e.map((x) => x.message).join(' · ')); }),
    onSuccess: () => { toast(t('loc.activated')); refresh(); }, onError: fail,
  });
  const deact = useMutation({
    mutationFn: ({ loc, destination }: { loc: Loc; destination: string }) => gql<{ locationDeactivate: { locationDeactivateUserErrors: Array<{ message: string }> } }>(LOCATION_DEACTIVATE, { locationId: loc.id, destinationLocationId: destination || null }).then((d) => { const e = d.locationDeactivate.locationDeactivateUserErrors; if (e.length) throw new Error(e.map((x) => x.message).join(' · ')); }),
    onSuccess: () => { toast(t('loc.deactivated')); setDeactivate(null); refresh(); }, onError: fail,
  });

  const move = (id: string, dir: -1 | 1) => {
    const ids = active.map((l) => l.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    reorder.mutate(ids);
  };
  const set = (p: Partial<Form>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...p } } : e));

  return (
    <Card title={t('settings.locations')} actions={<Button variant="primary" onClick={() => { setError(null); setEditing({ loc: null, form: blank(country) }); }}>{t('loc.add')}</Button>}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-muted">{t('loc.intro')}</p>
        {q.error && <Banner>{q.error.message}</Banner>}
        {q.isLoading && <Skeleton className="h-24" />}
        {q.data && all.length === 0 && <EmptyState icon={<MapPin className="size-10" />} title={t('loc.emptyTitle')} description={t('loc.emptyBody')} />}
        <ul className="divide-y divide-line">
          {all.map((l) => {
            const pos = active.findIndex((x) => x.id === l.id);
            return (
              <li key={l.id} className="flex flex-wrap items-center gap-3 py-3 text-[13px]">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{l.name}</span>
                    {l.isPrimary && <Badge tone="info">{t('loc.primary')}</Badge>}
                    {!l.isActive && <Badge>{t('loc.inactive')}</Badge>}
                    {l.isActive && !l.fulfillsOnlineOrders && <Badge tone="warning">{t('loc.noOnline')}</Badge>}
                  </div>
                  <p className="truncate text-muted">{summary(l.address) || t('loc.noAddress')}</p>
                  {l.isActive && <p className="text-xs text-muted">{t('loc.priority', { n: pos + 1 })}</p>}
                </div>
                {l.isActive && (
                  <div className="flex items-center gap-1">
                    <Button size="sm" aria-label={`${t('loc.moveUp')} ${l.name}`} disabled={pos <= 0 || reorder.isPending} onClick={() => move(l.id, -1)}><ArrowUp className="size-4" /></Button>
                    <Button size="sm" aria-label={`${t('loc.moveDown')} ${l.name}`} disabled={pos < 0 || pos >= active.length - 1 || reorder.isPending} onClick={() => move(l.id, 1)}><ArrowDown className="size-4" /></Button>
                  </div>
                )}
                <Button size="sm" onClick={() => { setError(null); setEditing({ loc: l, form: formOf(l) }); }}>{t('common.edit')}</Button>
                {l.isActive
                  ? <Button size="sm" variant="danger" disabled={active.length <= 1} onClick={() => setDeactivate({ loc: l, destination: '' })}>{t('loc.deactivate')}</Button>
                  : <Button size="sm" loading={activate.isPending && activate.variables === l.id} onClick={() => activate.mutate(l.id)}>{t('loc.activate')}</Button>}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted">{t('loc.allocationHelp')}</p>
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} closeLabel={t('common.close')} title={editing?.loc ? t('loc.edit') : t('loc.add')}
        footer={<><Button onClick={() => setEditing(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={save.isPending} disabled={!editing?.form.name.trim()} onClick={() => save.mutate()}>{t('save.save')}</Button></>}>
        {editing && (
          <div className="grid gap-3 sm:grid-cols-2">
            {error && <div className="sm:col-span-2"><Banner>{error}</Banner></div>}
            <Input label={t('loc.name')} className="sm:col-span-2" required value={editing.form.name} onChange={(e) => set({ name: e.target.value })} />
            <Input label={t('loc.address1')} className="sm:col-span-2" value={editing.form.address1} onChange={(e) => set({ address1: e.target.value })} />
            <Input label={t('loc.address2')} className="sm:col-span-2" value={editing.form.address2} onChange={(e) => set({ address2: e.target.value })} />
            <Input label={t('loc.zip')} value={editing.form.zip} onChange={(e) => set({ zip: e.target.value })} />
            <Input label={t('loc.city')} value={editing.form.city} onChange={(e) => set({ city: e.target.value })} />
            <Select label={t('loc.country')} value={editing.form.countryCode} onChange={(e) => set({ countryCode: e.target.value })}>
              {countryOptions(lang).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </Select>
            <Input label={t('loc.phone')} type="tel" value={editing.form.phone} onChange={(e) => set({ phone: e.target.value })} />
            <div className="sm:col-span-2"><Checkbox label={t('loc.fulfillsOnline')} checked={editing.form.fulfillsOnlineOrders} onChange={(e) => set({ fulfillsOnlineOrders: e.target.checked })} /></div>
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!deactivate} danger onClose={() => setDeactivate(null)} title={t('loc.deactivateTitle', { name: deactivate?.loc.name ?? '' })}
        confirmLabel={t('loc.deactivate')} cancelLabel={t('common.cancel')}
        onConfirm={() => deactivate && deact.mutate({ loc: deactivate.loc, destination: deactivate.destination })}
        message={deactivate && (
          <div className="flex flex-col gap-3">
            <p>{deactivate.loc.hasActiveInventory ? t('loc.deactivateStock') : t('loc.deactivateBody')}</p>
            {deactivate.loc.hasActiveInventory && (
              <Select label={t('loc.moveStockTo')} value={deactivate.destination} onChange={(e) => setDeactivate({ ...deactivate, destination: e.target.value })}>
                <option value="">{t('loc.chooseLocation')}</option>
                {active.filter((l) => l.id !== deactivate.loc.id).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            )}
          </div>
        )} />
    </Card>
  );
}
