import { Badge, Banner, Button, Card, Checkbox, ConfirmDialog, Dropdown, Input, Modal, Select, Skeleton, Switch, Textarea, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { FileText, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { gql, mutate } from '../../api';
import { LinkRow, RowCard, Section } from '../../components/SettingsKit';
import { useFormat } from '../../components/shared';
import { LOCAL_DELIVERIES, LOCAL_DELIVERY_STATUS_UPDATE, LOCATIONS_SIMPLE, SHIPPING_BY_MARKET } from '../../graphql';
import { gidToNum } from '../../format';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';
import { countryOptions } from '../../lib/countries';
import { errText, major, minor, newId, useConfig, useSaveConfig } from '../../lib/config';
import type { RoutingRule, ShipRule, ShippingConfig } from '../../lib/config';
import { useShop } from '../../session';

interface MarketShipping { marketId: number; name: string; status: string; primary: boolean; countries: string[]; uncovered: string[]; options: Array<{ profile: string; zone: string; name: string; price: number; countries: string[] }> }

/** Shipping settings beyond rates: estimates, per-market options, fulfilment services, order routing, delivery customisations, documents (carrier accounts: ShippingCarriers.tsx). */
export function ShippingExtras() {
  const { t } = useI18n();
  const cfg = useConfig<ShippingConfig>('SHIPPING');
  const [modal, setModal] = useState<null | 'service' | 'routing' | 'rule'>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [del, setDel] = useState<{ list: 'fulfillmentServices' | 'routing' | 'customizations'; id: string; name: string } | null>(null);
  const save = useSaveConfig<ShippingConfig>('SHIPPING', () => { setModal(null); setEdit(null); setDel(null); });
  if (cfg.isLoading) return <Skeleton className="h-32" />;
  if (cfg.error || !cfg.data) return <Banner>{cfg.error?.message}</Banner>;
  const c = cfg.data;
  const put = (patch: Partial<ShippingConfig>) => save.mutate({ ...c, ...patch });
  const open = (m: typeof modal, id: string | null = null) => { setEdit(id); setModal(m); };
  const menu = (m: NonNullable<typeof modal>, list: NonNullable<typeof del>['list'], id: string, name: string) => (
    <Dropdown align="right" variant="plain" size="sm" icon label={t('common.moreActions')} trigger={<MoreHorizontal className="size-4" />} items={[
      { key: 'edit', icon: <Pencil />, label: t('common.edit'), onSelect: () => open(m, id) },
      { key: 'del', icon: <Trash2 />, label: t('common.delete'), danger: true, onSelect: () => setDel({ list, id, name }) },
    ]} />
  );
  return (
    <>
      <Estimates cfg={c} saving={save.isPending} onSave={(handlingDays) => put({ handlingDays })} />
      <ByMarket />

      <Section title={t('bs.routing')} description={t('bs.routingDesc')} action={<Button onClick={() => open('routing')}><Plus className="size-4" />{t('bs.addRule')}</Button>}>
        {c.routing.length === 0 ? <Card><p className="text-[13px] text-muted">{t('bs.routingEmpty')}</p></Card> : (
          <RowCard>{c.routing.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{r.name}</span><span className="block truncate text-xs text-muted">{r.countries.length ? r.countries.join(', ') : t('bs.allDestinations')} · {t('bs.locationsCount', { n: r.locationIds.length })}</span></span>
              <Switch label={<span className="sr-only">{r.name}</span>} checked={r.enabled} onChange={(v) => put({ routing: c.routing.map((x) => (x.id === r.id ? { ...x, enabled: v } : x)) })} />
              {menu('routing', 'routing', r.id, r.name)}
            </div>
          ))}</RowCard>
        )}
      </Section>

      <Section title={t('bs.delivCustom')} description={t('bs.delivCustomDesc')} action={<Button onClick={() => open('rule')}><Plus className="size-4" />{t('bs.addRule')}</Button>}>
        {c.customizations.length === 0 ? <Card><p className="text-[13px] text-muted">{t('bs.delivCustomEmpty')}</p></Card> : (
          <RowCard>{c.customizations.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{r.name}</span><span className="block truncate text-xs text-muted">{t(`bs.action.${r.action}` as Key)} · {r.optionName || t('bs.allOptions')}{r.countries.length ? ` · ${r.countries.join(', ')}` : ''}</span></span>
              <Switch label={<span className="sr-only">{r.name}</span>} checked={r.enabled} onChange={(v) => put({ customizations: c.customizations.map((x) => (x.id === r.id ? { ...x, enabled: v } : x)) })} />
              {menu('rule', 'customizations', r.id, r.name)}
            </div>
          ))}</RowCard>
        )}
      </Section>

      <Section title={t('bs.fulfilServices')} description={t('bs.fulfilServicesDesc')} action={<Button onClick={() => open('service')}><Plus className="size-4" />{t('bs.addService')}</Button>}>
        {c.fulfillmentServices.length === 0 ? <Card><p className="text-[13px] text-muted">{t('bs.fulfilServicesEmpty')}</p></Card> : (
          <RowCard>{c.fulfillmentServices.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{s.name}</span><span className="block truncate text-xs text-muted">{s.email || t('bs.noEmail')}</span></span>
              {menu('service', 'fulfillmentServices', s.id, s.name)}
            </div>
          ))}</RowCard>
        )}
      </Section>

      <Section title={t('bs.documents')} description={t('bs.documentsDesc')}>
        <RowCard><LinkRow to="/settings/shipping/documents" icon={FileText} title={t('bs.documentTemplates')} description={t('bs.documentTemplatesDesc')} /></RowCard>
      </Section>

      <ServiceModal open={modal === 'service'} cfg={c} id={edit} saving={save.isPending} onClose={() => setModal(null)} onSave={(l) => put({ fulfillmentServices: l })} />
      <RoutingModal open={modal === 'routing'} cfg={c} id={edit} saving={save.isPending} onClose={() => setModal(null)} onSave={(l) => put({ routing: l })} />
      <RuleModal open={modal === 'rule'} cfg={c} id={edit} saving={save.isPending} onClose={() => setModal(null)} onSave={(l) => put({ customizations: l })} />
      <ConfirmDialog open={!!del} danger onClose={() => setDel(null)} title={t('bs.deleteItemTitle', { name: del?.name ?? '' })} message={t('bs.deleteItemBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')}
        onConfirm={() => del && put({ [del.list]: (c[del.list] as Array<{ id: string }>).filter((x) => x.id !== del.id) } as Partial<ShippingConfig>)} />
    </>
  );
}

function Estimates({ cfg, saving, onSave }: { cfg: ShippingConfig; saving: boolean; onSave: (days: number) => void }) {
  const { t } = useI18n();
  const [days, setDays] = useState(String(cfg.handlingDays));
  const n = Number(days);
  const valid = Number.isInteger(n) && n >= 0 && n <= 60;
  return (
    <Section title={t('bs.estimates')} description={t('bs.estimatesDesc')}>
      <Card>
        <div className="flex items-end gap-3">
          <Input className="w-40" label={t('bs.handlingDays')} inputMode="numeric" value={days} error={!valid ? t('bs.handlingInvalid') : null} onChange={(e) => setDays(e.target.value)} />
          <Button variant="primary" disabled={!valid || n === cfg.handlingDays} loading={saving} onClick={() => onSave(n)}>{t('save.save')}</Button>
        </div>
        <p className="mt-2 text-[13px] text-muted">{t('bs.handlingHelp')}</p>
      </Card>
    </Section>
  );
}

/** What each market is offered, read from the delivery profiles. */
function ByMarket() {
  const { t, lang } = useI18n();
  const fmt = useFormat();
  const { shop } = useShop();
  const q = useQuery({ queryKey: ['shipping-by-market'], queryFn: async () => (await gql<{ shopmeShippingByMarket: MarketShipping[] }>(SHIPPING_BY_MARKET)).shopmeShippingByMarket });
  if (!q.data || q.data.length === 0) return null;
  return (
    <Section title={t('bs.byMarket')} description={t('bs.byMarketDesc')}>
      <RowCard>
        {q.data.map((m) => (
          <div key={m.marketId} className="px-4 py-3 text-[13px]">
            <p className="flex items-center gap-2 font-medium">{m.name}{m.primary && <Badge>{t('settings.primaryBadge')}</Badge>}<span className="font-normal text-muted">{t('bs.countriesCount', { n: m.countries.length })}</span></p>
            {m.options.length === 0 ? <p className="text-muted">{t('bs.noOptions')}</p> : (
              <ul className="mt-1 text-muted">{m.options.map((o, i) => <li key={i} className="flex justify-between gap-3"><span className="truncate">{o.name} · {o.zone}{m.countries.length > 1 && o.countries.length < m.countries.length ? ` (${o.countries.length}/${m.countries.length})` : ''}</span><span className="text-text">{o.price ? fmt.money({ amount: (o.price / 100).toFixed(2), currencyCode: shop.currency }) : t('shipping.free')}</span></li>)}</ul>
            )}
            {m.uncovered.length > 0 && <p className="mt-1 text-xs text-warning">{t('bs.uncovered', { countries: m.uncovered.map((c) => countryOptions(lang).find((x) => x.code === c)?.name ?? c).join(', ') })}</p>}
          </div>
        ))}
      </RowCard>
    </Section>
  );
}

const useOpenState = <T,>(open: boolean, id: string | null, init: () => T) => {
  const [v, setV] = useState<T>(init);
  const [seen, setSeen] = useState<string | null | undefined>(undefined);
  if (open && seen !== (id ?? '')) { setSeen(id ?? ''); setV(init()); }
  if (!open && seen !== undefined) setSeen(undefined);
  return [v, setV] as const;
};

function ServiceModal({ open, cfg, id, saving, onClose, onSave }: { open: boolean; cfg: ShippingConfig; id: string | null; saving: boolean; onClose: () => void; onSave: (l: ShippingConfig['fulfillmentServices']) => void }) {
  const { t } = useI18n();
  const cur = cfg.fulfillmentServices.find((s) => s.id === id);
  const [f, setF] = useOpenState(open, id, () => ({ name: cur?.name ?? '', email: cur?.email ?? '', notes: cur?.notes ?? '' }));
  return (
    <Modal open={open} onClose={onClose} closeLabel={t('common.close')} title={t(cur ? 'bs.editService' : 'bs.addService')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={saving} disabled={!f.name.trim() || (!!f.email && !f.email.includes('@'))} onClick={() => onSave(cur ? cfg.fulfillmentServices.map((s) => (s.id === cur.id ? { ...s, ...f, name: f.name.trim() } : s)) : [...cfg.fulfillmentServices, { id: newId(cfg.fulfillmentServices.map((s) => s.id), f.name), ...f, name: f.name.trim() }])}>{t('save.save')}</Button></>}>
      <div className="flex flex-col gap-3">
        <Input label={t('bs.serviceName')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Input label={t('bs.serviceEmail')} type="email" help={t('bs.serviceEmailHelp')} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <Textarea label={t('bs.serviceNotes')} rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </div>
    </Modal>
  );
}

function RoutingModal({ open, cfg, id, saving, onClose, onSave }: { open: boolean; cfg: ShippingConfig; id: string | null; saving: boolean; onClose: () => void; onSave: (l: RoutingRule[]) => void }) {
  const { t } = useI18n();
  const locs = useQuery({ queryKey: ['locations-simple'], queryFn: async () => (await gql<{ locations: { nodes: Array<{ id: string; name: string; isActive: boolean }> } }>(LOCATIONS_SIMPLE)).locations.nodes.filter((l) => l.isActive) });
  const cur = cfg.routing.find((r) => r.id === id);
  const [f, setF] = useOpenState(open, id, () => ({ name: cur?.name ?? '', countries: cur?.countries.join(', ') ?? '', ids: cur?.locationIds ?? [] as number[] }));
  const codes = f.countries.split(/[,\s]+/).map((c) => c.toUpperCase()).filter(Boolean);
  const move = (i: number, d: number) => { const ids = [...f.ids]; const j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j]!, ids[i]!]; setF({ ...f, ids }); };
  const nameOf = (n: number) => locs.data?.find((l) => gidToNum(l.id) === String(n))?.name ?? `#${n}`;
  return (
    <Modal open={open} onClose={onClose} closeLabel={t('common.close')} title={t(cur ? 'bs.editRoutingRule' : 'bs.addRoutingRule')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={saving} disabled={!f.name.trim() || f.ids.length === 0} onClick={() => { const rule: RoutingRule = { id: cur?.id ?? newId(cfg.routing.map((r) => r.id), f.name), name: f.name.trim(), enabled: cur?.enabled ?? true, countries: codes, locationIds: f.ids }; onSave(cur ? cfg.routing.map((r) => (r.id === cur.id ? rule : r)) : [...cfg.routing, rule]); }}>{t('save.save')}</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-muted">{t('bs.routingIntro')}</p>
        <Input label={t('bs.ruleName')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Input label={t('bs.ruleCountries')} help={t('bs.routingCountriesHelp')} placeholder="FR, BE" value={f.countries} onChange={(e) => setF({ ...f, countries: e.target.value })} />
        <fieldset className="flex flex-col gap-1.5"><legend className="mb-1 text-[13px] font-medium">{t('bs.routingLocations')}</legend>
          {(locs.data ?? []).map((l) => { const n = Number(gidToNum(l.id)); return <Checkbox key={l.id} label={l.name} checked={f.ids.includes(n)} onChange={(e) => setF({ ...f, ids: e.target.checked ? [...f.ids, n] : f.ids.filter((x) => x !== n) })} />; })}
        </fieldset>
        {f.ids.length > 1 && (
          <ol className="list-decimal space-y-1 pl-5 text-[13px]">
            {f.ids.map((n, i) => <li key={n}><span className="inline-flex items-center gap-2">{nameOf(n)}<button type="button" className="rounded px-1 text-muted hover:bg-hover disabled:opacity-30" disabled={i === 0} aria-label={t('bs.moveUp')} onClick={() => move(i, -1)}>↑</button><button type="button" className="rounded px-1 text-muted hover:bg-hover disabled:opacity-30" disabled={i === f.ids.length - 1} aria-label={t('bs.moveDown')} onClick={() => move(i, 1)}>↓</button></span></li>)}
          </ol>
        )}
      </div>
    </Modal>
  );
}

function RuleModal({ open, cfg, id, saving, onClose, onSave }: { open: boolean; cfg: ShippingConfig; id: string | null; saving: boolean; onClose: () => void; onSave: (l: ShipRule[]) => void }) {
  const { t } = useI18n();
  const { shop } = useShop();
  const cur = cfg.customizations.find((r) => r.id === id);
  const [f, setF] = useOpenState(open, id, () => ({ name: cur?.name ?? '', action: (cur?.action ?? 'hide') as ShipRule['action'], optionName: cur?.optionName ?? '', newName: cur?.newName ?? '', countries: cur?.countries.join(', ') ?? '', min: major(cur?.minSubtotal), max: major(cur?.maxSubtotal) }));
  const codes = f.countries.split(/[,\s]+/).map((c) => c.toUpperCase()).filter(Boolean);
  const valid = f.name.trim() && (f.action !== 'rename' || (f.newName.trim() && f.optionName.trim()));
  const build = (): ShipRule => ({ id: cur?.id ?? newId(cfg.customizations.map((r) => r.id), f.name), name: f.name.trim(), enabled: cur?.enabled ?? true, action: f.action, optionName: f.optionName.trim(), newName: f.action === 'rename' ? f.newName.trim() : '', countries: codes, minSubtotal: minor(f.min), maxSubtotal: minor(f.max) });
  return (
    <Modal open={open} onClose={onClose} closeLabel={t('common.close')} title={t(cur ? 'bs.editRule' : 'bs.addRule')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={saving} disabled={!valid} onClick={() => onSave(cur ? cfg.customizations.map((r) => (r.id === cur.id ? build() : r)) : [...cfg.customizations, build()])}>{t('save.save')}</Button></>}>
      <div className="flex flex-col gap-3">
        <Input label={t('bs.ruleName')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Select label={t('bs.ruleAction')} value={f.action} onChange={(e) => setF({ ...f, action: e.target.value as ShipRule['action'] })}>
          <option value="hide">{t('bs.action.hide')}</option><option value="rename">{t('bs.action.rename')}</option><option value="move_first">{t('bs.action.move_first')}</option>
        </Select>
        <Input label={t('bs.ruleOption')} help={t('bs.ruleOptionHelp')} value={f.optionName} onChange={(e) => setF({ ...f, optionName: e.target.value })} />
        {f.action === 'rename' && <Input label={t('bs.ruleNewName')} value={f.newName} onChange={(e) => setF({ ...f, newName: e.target.value })} />}
        <Input label={t('bs.ruleCountries')} help={t('bs.routingCountriesHelp')} placeholder="FR, BE" value={f.countries} onChange={(e) => setF({ ...f, countries: e.target.value })} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('bs.ruleMinSubtotal', { currency: shop.currency })} inputMode="decimal" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} />
          <Input label={t('bs.ruleMaxSubtotal', { currency: shop.currency })} inputMode="decimal" value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} />
        </div>
      </div>
    </Modal>
  );
}

/** Pickup page switch: offer pickup for items that sit in another location. */
export function PickupFromOthers() {
  const { t } = useI18n();
  const cfg = useConfig<ShippingConfig>('SHIPPING');
  const save = useSaveConfig<ShippingConfig>('SHIPPING');
  if (!cfg.data) return null;
  return (
    <Banner tone="info">
      <div className="flex flex-col gap-2">
        <Switch placement="end" checked={cfg.data.pickupFromOtherLocations} onChange={(v) => save.mutate({ ...cfg.data!, pickupFromOtherLocations: v })} label={t('bs.pickupOthers')} />
        <span className="text-[13px]">{t('bs.pickupOthersHelp')}</span>
      </div>
    </Banner>
  );
}

interface LocalRow { orderId: string; name: string; email: string | null; status: 'OPEN' | 'DELIVERED' | 'MISSED' }

/** Local delivery orders: mark each one delivered or missed (this emails the buyer: Settings > Notifications). */
export function LocalDeliveryFollowUp() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['local-deliveries'], queryFn: async () => (await gql<{ shopmeLocalDeliveries: LocalRow[] }>(LOCAL_DELIVERIES)).shopmeLocalDeliveries });
  const mark = useMutation({
    mutationFn: (v: { orderId: string; status: 'DELIVERED' | 'MISSED' }) => mutate(LOCAL_DELIVERY_STATUS_UPDATE, v, 'shopmeLocalDeliveryUpdate'),
    onSuccess: () => { toast(t('settings.saved')); void qc.invalidateQueries({ queryKey: ['local-deliveries'] }); }, onError: (e) => toast(errText(e), 'critical'),
  });
  if (!q.data || q.data.length === 0) return null;
  return (
    <Section title={t('bs.localFollow')} description={t('bs.localFollowDesc')}>
      <RowCard>
        {q.data.map((r) => (
          <div key={r.orderId} className="flex items-center gap-3 px-4 py-3 text-[13px]">
            <span className="min-w-0 flex-1"><Link to={`/orders/${gidToNum(r.orderId)}`} className="font-medium hover:underline">{r.name}</Link><span className="block truncate text-xs text-muted">{r.email}</span></span>
            <Badge tone={r.status === 'DELIVERED' ? 'success' : r.status === 'MISSED' ? 'warning' : 'neutral'}>{t(`bs.local.${r.status}` as Key)}</Badge>
            {r.status !== 'DELIVERED' && <Button size="sm" loading={mark.isPending && mark.variables?.orderId === r.orderId} onClick={() => mark.mutate({ orderId: r.orderId, status: 'DELIVERED' })}>{t('bs.markDelivered')}</Button>}
            {r.status === 'OPEN' && <Button size="sm" onClick={() => mark.mutate({ orderId: r.orderId, status: 'MISSED' })}>{t('bs.markMissed')}</Button>}
          </div>
        ))}
      </RowCard>
    </Section>
  );
}
