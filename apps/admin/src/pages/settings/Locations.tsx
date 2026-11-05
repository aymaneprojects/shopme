import { Badge, Banner, Button, Checkbox, ConfirmDialog, EmptyState, Input, Modal, Select, Skeleton, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ChevronsUpDown, MapPin, Plus, Search } from 'lucide-react';
import { Section, SettingsActions } from '../../components/SettingsKit';
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

  const [filter, setFilter] = useState('');
  const [scope, setScope] = useState<'all' | 'active' | 'inactive'>('all');
  const shown = all.filter((l) => (scope === 'all' || (scope === 'active') === l.isActive) && `${l.name} ${summary(l.address)}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const defaultLoc = active.find((l) => l.isPrimary) ?? active[0];
  const openEdit = (l: Loc) => { setError(null); setEditing({ loc: l, form: formOf(l) }); };
  return (
    <>
      <SettingsActions><Button variant="primary" onClick={() => { setError(null); setEditing({ loc: null, form: blank(country) }); }}><Plus className="size-4" />{t('loc.add')}</Button></SettingsActions>
      <div className="flex flex-col gap-6">
        <Section title={t('loc.all')} description={t('loc.activeCount', { n: active.length })}>
          {q.error && <Banner>{q.error.message}</Banner>}
          {q.isLoading && <Skeleton className="h-24" />}
          {q.data && all.length === 0 && <EmptyState icon={<MapPin className="size-10" />} title={t('loc.emptyTitle')} description={t('loc.emptyBody')} />}
          {all.length > 0 && (
            <div className="overflow-hidden rounded-lg bg-canvas shadow-card">
              <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                <select aria-label={t('loc.filterStatus')} value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} className="h-7 rounded-md bg-transparent text-[13px] font-medium">
                  <option value="all">{t('loc.scope.all')}</option><option value="active">{t('loc.status.active')}</option><option value="inactive">{t('loc.inactive')}</option>
                </select>
                <Search className="size-4 shrink-0 text-muted" aria-hidden />
                <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('loc.search')} aria-label={t('loc.search')} className="h-7 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted" />
              </div>
              <ul className="divide-y divide-line">
                {shown.map((l) => {
                  const pos = active.findIndex((x) => x.id === l.id);
                  return (
                    <li key={l.id} className="flex items-center gap-2 pr-3 text-[13px] hover:bg-hover">
                      <button type="button" onClick={() => openEdit(l)} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left">
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2"><span className="font-medium">{l.name}</span>{l.isPrimary && <Badge tone="info">{t('loc.primary')}</Badge>}{l.isActive && !l.fulfillsOnlineOrders && <Badge tone="warning">{t('loc.noOnline')}</Badge>}</span>
                          <span className="block truncate text-muted">{summary(l.address) || t('loc.noAddress')}</span>
                        </span>
                        <Badge tone={l.isActive ? 'success' : 'neutral'}>{t(l.isActive ? 'loc.status.active' : 'loc.inactive')}</Badge>
                      </button>
                      {l.isActive && (
                        <span className="flex items-center gap-1">
                          <Button size="sm" aria-label={`${t('loc.moveUp')} ${l.name}`} disabled={pos <= 0 || reorder.isPending} onClick={() => move(l.id, -1)}><ArrowUp className="size-4" /></Button>
                          <Button size="sm" aria-label={`${t('loc.moveDown')} ${l.name}`} disabled={pos < 0 || pos >= active.length - 1 || reorder.isPending} onClick={() => move(l.id, 1)}><ArrowDown className="size-4" /></Button>
                        </span>
                      )}
                      {!l.isActive && <Button size="sm" loading={activate.isPending && activate.variables === l.id} onClick={() => activate.mutate(l.id)}>{t('loc.activate')}</Button>}
                    </li>
                  );
                })}
                {shown.length === 0 && <li className="px-4 py-6 text-center text-[13px] text-muted">{t('loc.noMatch')}</li>}
              </ul>
            </div>
          )}
          <p className="text-xs text-muted">{t('loc.allocationHelp')}</p>
        </Section>
        {defaultLoc && (
          <Section title={t('loc.defaultTitle')} description={t('loc.defaultDesc')}>
            <button type="button" onClick={() => openEdit(defaultLoc)} className="flex w-full items-center gap-3 rounded-lg bg-canvas px-4 py-3 text-left text-[13px] shadow-card hover:bg-hover">
              <MapPin className="size-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1"><span className="block font-medium">{defaultLoc.name}</span><span className="block truncate text-muted">{summary(defaultLoc.address) || t('loc.noAddress')}</span></span>
              <ChevronsUpDown className="size-4 text-muted" aria-hidden />
            </button>
          </Section>
        )}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} closeLabel={t('common.close')} title={editing?.loc ? t('loc.edit') : t('loc.add')}
        footer={<>{editing?.loc?.isActive && <span className="mr-auto"><Button variant="danger" disabled={active.length <= 1} onClick={() => { const l = editing.loc!; setEditing(null); setDeactivate({ loc: l, destination: '' }); }}>{t('loc.deactivate')}</Button></span>}<Button onClick={() => setEditing(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={save.isPending} disabled={!editing?.form.name.trim()} onClick={() => save.mutate()}>{t('save.save')}</Button></>}>
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
    </>
  );
}
