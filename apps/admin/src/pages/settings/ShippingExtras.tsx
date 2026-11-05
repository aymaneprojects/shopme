import { Badge, Banner, Button, Card, Checkbox, ConfirmDialog, Dropdown, Input, Modal, Select, Skeleton, Switch, Textarea, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Globe, MoreHorizontal, Pencil, Plus, PlusCircle, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { gql, mutate } from '../../api';
import { CollapseRow, RowCard, Section } from '../../components/SettingsKit';
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
type ListKey = 'fulfillmentServices' | 'carrierAccounts' | 'routing' | 'customizations';

export const useShippingByMarket = () => useQuery({ queryKey: ['shipping-by-market'], queryFn: async () => (await gql<{ shopmeShippingByMarket: MarketShipping[] }>(SHIPPING_BY_MARKET)).shopmeShippingByMarket });

/** Edit / delete menu and delete confirmation shared by the lists stored in the SHIPPING config. */
function useListTools(list: ListKey, onEdit: (id: string) => void) {
  const { t } = useI18n();
  const cfg = useConfig<ShippingConfig>('SHIPPING');
  const [del, setDel] = useState<{ id: string; name: string } | null>(null);
  const save = useSaveConfig<ShippingConfig>('SHIPPING', () => setDel(null));
  const menu = (id: string, name: string) => (
    <Dropdown align="right" variant="plain" size="sm" icon label={t('common.moreActions')} trigger={<MoreHorizontal className="size-4" />} items={[
      { key: 'edit', icon: <Pencil />, label: t('common.edit'), onSelect: () => onEdit(id) },
      { key: 'del', icon: <Trash2 />, label: t('common.delete'), danger: true, onSelect: () => setDel({ id, name }) },
    ]} />
  );
  const confirm = (
    <ConfirmDialog open={!!del} danger onClose={() => setDel(null)} title={t('bs.deleteItemTitle', { name: del?.name ?? '' })} message={t('bs.deleteItemBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')}
      onConfirm={() => del && cfg.data && save.mutate({ ...cfg.data, [list]: (cfg.data[list] as Array<{ id: string }>).filter((x) => x.id !== del.id) })} />
  );
  return { menu, confirm };
}

/** Rows of a config list inside a collapsible row: name, detail, optional switch, menu; then the add button. */
function ListRows<T extends { id: string; name: string }>({ items, detail, toggle, menu, addLabel, onAdd }: { items: T[]; detail: (x: T) => ReactNode; toggle?: (x: T) => ReactNode; menu: (id: string, name: string) => ReactNode; addLabel: string; onAdd: () => void }) {
  return (
    <RowCard className="border border-line shadow-none">
      {items.map((x) => (
        <div key={x.id} className="flex items-center gap-3 px-4 py-3">
          <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{x.name}</span><span className="block truncate text-xs text-muted">{detail(x)}</span></span>
          {toggle?.(x)}
          {menu(x.id, x.name)}
        </div>
      ))}
      <button type="button" className="flex w-full items-center gap-2 px-4 py-3 text-left text-[13px] hover:bg-hover" onClick={onAdd}><PlusCircle className="size-4" />{addLabel}</button>
    </RowCard>
  );
}

/** Dashed empty box with a single "+ add" button, used by the lists at the bottom of the shipping page. */
function AddBox({ label, onAdd }: { label: string; onAdd: () => void }) {
  return <div className="grid place-items-center rounded-xl border border-dashed border-line px-4 py-4"><Button size="sm" onClick={onAdd}><Plus className="size-4" />{label}</Button></div>;
}

/** "Shipping options": what each market is offered (from the delivery profiles), above the profiles themselves. */
export function MarketOptionsTable() {
  const { t, lang } = useI18n();
  const q = useShippingByMarket();
  const rows = (q.data ?? []).filter((m) => !m.primary || m.options.length > 0);
  if (!rows.length) return null;
  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-line">
      <table className="w-full text-left text-[13px]">
        <thead className="bg-surface text-xs text-muted"><tr><th className="px-3 py-2 font-medium">{t('fid.ship.market')}</th><th className="px-3 py-2 font-medium">{t('fid.ship.optionsCol')}</th></tr></thead>
        <tbody className="divide-y divide-line">
          {rows.map((m) => (
            <tr key={m.marketId}>
              <td className="w-48 px-3 py-2"><Link to={`/markets/${m.marketId}`} className="inline-flex items-center gap-2 hover:underline"><Globe className="size-4 text-muted" aria-hidden />{m.name}</Link></td>
              <td className="px-3 py-2">
                <span className="flex flex-wrap items-center gap-1.5">
                  {m.options.length ? [...new Set(m.options.map((o) => o.name))].map((n) => <span key={n} className="rounded-md bg-hover px-2 py-0.5">{n}</span>) : <span className="text-muted">{t('bs.noOptions')}</span>}
                  {m.uncovered.length > 0 && m.options.length > 0 && <span className="text-xs text-warning">{t('bs.uncovered', { countries: m.uncovered.map((c) => countryOptions(lang).find((x) => x.code === c)?.name ?? c).join(', ') })}</span>}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "Estimated delivery dates": handling time added to the transit times of the rates. */
export function EstimatesRow() {
  const { t } = useI18n();
  const cfg = useConfig<ShippingConfig>('SHIPPING');
  const save = useSaveConfig<ShippingConfig>('SHIPPING', () => undefined);
  const c = cfg.data;
  return (
    <CollapseRow title={t('fid.ship.estimates')} description={t('fid.ship.estimatesDesc')} summary={c ? t('fid.ship.handlingSummary', { n: c.handlingDays }) : undefined}>
      {c ? <Estimates key={c.handlingDays} cfg={c} saving={save.isPending} onSave={(handlingDays) => save.mutate({ ...c, handlingDays })} /> : <Skeleton className="h-16" />}
    </CollapseRow>
  );
}

/** "Carrier accounts": services that quote calculated rates at checkout. */
export function CarrierAccountsRow() {
  const { t } = useI18n();
  const cfg = useConfig<ShippingConfig>('SHIPPING');
  const [modal, setModal] = useState<{ id: string | null } | null>(null);
  const save = useSaveConfig<ShippingConfig>('SHIPPING', () => setModal(null));
  const tools = useListTools('carrierAccounts', (id) => setModal({ id }));
  const c = cfg.data;
  return (
    <CollapseRow title={t('fid.ship.carriers')} description={t('fid.ship.carriersDesc')} summary={c ? (c.carrierAccounts.length ? t('fid.ship.accountsCount', { n: c.carrierAccounts.length }) : t('fid.ship.none')) : undefined}>
      {c ? <ListRows items={c.carrierAccounts} detail={(a) => a.endpoint} menu={tools.menu} addLabel={t('bs.addCarrier')} onAdd={() => setModal({ id: null })} /> : <Skeleton className="h-16" />}
      {c && <CarrierModal open={!!modal} cfg={c} id={modal?.id ?? null} saving={save.isPending} onClose={() => setModal(null)} onSave={(l) => save.mutate({ ...c, carrierAccounts: l })} />}
      {tools.confirm}
    </CollapseRow>
  );
}

/** "Order routing": which location fulfills a new order. */
export function RoutingRow() {
  const { t } = useI18n();
  const cfg = useConfig<ShippingConfig>('SHIPPING');
  const [modal, setModal] = useState<{ id: string | null } | null>(null);
  const save = useSaveConfig<ShippingConfig>('SHIPPING', () => setModal(null));
  const tools = useListTools('routing', (id) => setModal({ id }));
  const c = cfg.data;
  return (
    <CollapseRow title={t('fid.ship.routing')} description={t('fid.ship.routingDesc')} summary={c ? t('fid.ship.rulesCount', { n: c.routing.length }) : undefined}>
      {c ? <ListRows items={c.routing} detail={(r) => `${r.countries.length ? r.countries.join(', ') : t('bs.allDestinations')} · ${t('bs.locationsCount', { n: r.locationIds.length })}`}
        toggle={(r) => <Switch label={<span className="sr-only">{r.name}</span>} checked={r.enabled} onChange={(v) => save.mutate({ ...c, routing: c.routing.map((x) => (x.id === r.id ? { ...x, enabled: v } : x)) })} />}
        menu={tools.menu} addLabel={t('bs.addRule')} onAdd={() => setModal({ id: null })} /> : <Skeleton className="h-16" />}
      {c && <RoutingModal open={!!modal} cfg={c} id={modal?.id ?? null} saving={save.isPending} onClose={() => setModal(null)} onSave={(l) => save.mutate({ ...c, routing: l })} />}
      {tools.confirm}
    </CollapseRow>
  );
}

const DOC_ROWS = [['pickList', 'pick-list'], ['packingSlip', 'packing-slip'], ['invoice', 'invoice']] as const;

/** Sections under the delivery methods: printable documents, delivery customizations and custom order fulfillment. */
export function ShippingExtras() {
  const { t } = useI18n();
  const cfg = useConfig<ShippingConfig>('SHIPPING');
  const [modal, setModal] = useState<null | 'service' | 'rule'>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const save = useSaveConfig<ShippingConfig>('SHIPPING', () => { setModal(null); setEdit(null); });
  const open = (m: typeof modal, id: string | null = null) => { setEdit(id); setModal(m); };
  const rules = useListTools('customizations', (id) => open('rule', id));
  const services = useListTools('fulfillmentServices', (id) => open('service', id));
  if (cfg.isLoading) return <Skeleton className="h-32" />;
  if (cfg.error || !cfg.data) return <Banner>{cfg.error?.message}</Banner>;
  const c = cfg.data;
  const put = (patch: Partial<ShippingConfig>) => save.mutate({ ...c, ...patch });
  return (
    <>
      <Section title={t('bs.documents')}>
        <div className="overflow-hidden rounded-xl bg-canvas shadow-card">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-surface text-xs text-muted"><tr><th className="px-4 py-2 font-medium">{t('fid.ship.docName')}</th><th className="px-4 py-2 text-right font-medium">{t('fid.ship.docEdit')}</th></tr></thead>
            <tbody className="divide-y divide-line">
              {DOC_ROWS.map(([key, slug]) => (
                <tr key={key} className="hover:bg-hover">
                  <td className="px-4 py-2.5"><Link to={`/settings/shipping/documents#${slug}`} className="block">{t(`bs.doc.${key}` as Key)}</Link></td>
                  <td className="px-4 py-2.5 text-right text-muted"><Link to={`/settings/shipping/documents#${slug}`} aria-label={`${t('common.edit')} ${t(`bs.doc.${key}` as Key)}`} className="inline-grid size-6 place-items-center rounded hover:bg-surface"><Pencil className="size-3.5" /></Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={t('bs.delivCustom')} description={t('fid.ship.customDesc')}>
        {c.customizations.length === 0 ? <AddBox label={t('fid.ship.addCustomization')} onAdd={() => open('rule')} /> : (
          <ListRows items={c.customizations} detail={(r) => `${t(`bs.action.${r.action}` as Key)} · ${r.optionName || t('bs.allOptions')}${r.countries.length ? ` · ${r.countries.join(', ')}` : ''}`}
            toggle={(r) => <Switch label={<span className="sr-only">{r.name}</span>} checked={r.enabled} onChange={(v) => put({ customizations: c.customizations.map((x) => (x.id === r.id ? { ...x, enabled: v } : x)) })} />}
            menu={rules.menu} addLabel={t('fid.ship.addCustomization')} onAdd={() => open('rule')} />
        )}
      </Section>

      <Section title={t('fid.ship.customFulfillment')} description={t('fid.ship.customFulfillmentDesc')}>
        {c.fulfillmentServices.length === 0 ? <AddBox label={t('fid.ship.addService')} onAdd={() => open('service')} /> : (
          <ListRows items={c.fulfillmentServices} detail={(s) => s.email || t('bs.noEmail')} menu={services.menu} addLabel={t('fid.ship.addService')} onAdd={() => open('service')} />
        )}
      </Section>

      <ServiceModal open={modal === 'service'} cfg={c} id={edit} saving={save.isPending} onClose={() => setModal(null)} onSave={(l) => put({ fulfillmentServices: l })} />
      <RuleModal open={modal === 'rule'} cfg={c} id={edit} saving={save.isPending} onClose={() => setModal(null)} onSave={(l) => put({ customizations: l })} />
      {rules.confirm}
      {services.confirm}
    </>
  );
}

function Estimates({ cfg, saving, onSave }: { cfg: ShippingConfig; saving: boolean; onSave: (days: number) => void }) {
  const { t } = useI18n();
  const [days, setDays] = useState(String(cfg.handlingDays));
  const n = Number(days);
  const valid = Number.isInteger(n) && n >= 0 && n <= 60;
  return (
    <Card className="border border-line shadow-none">
      <div className="flex items-end gap-3">
        <Input className="w-40" label={t('bs.handlingDays')} inputMode="numeric" value={days} error={!valid ? t('bs.handlingInvalid') : null} onChange={(e) => setDays(e.target.value)} />
        <Button variant="primary" disabled={!valid || n === cfg.handlingDays} loading={saving} onClick={() => onSave(n)}>{t('save.save')}</Button>
      </div>
      <p className="mt-2 text-[13px] text-muted">{t('bs.handlingHelp')}</p>
    </Card>
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

function CarrierModal({ open, cfg, id, saving, onClose, onSave }: { open: boolean; cfg: ShippingConfig; id: string | null; saving: boolean; onClose: () => void; onSave: (l: ShippingConfig['carrierAccounts']) => void }) {
  const { t } = useI18n();
  const cur = cfg.carrierAccounts.find((s) => s.id === id);
  const [f, setF] = useOpenState(open, id, () => ({ name: cur?.name ?? '', endpoint: cur?.endpoint ?? '', secret: cur?.secret ?? '' }));
  return (
    <Modal open={open} onClose={onClose} closeLabel={t('common.close')} title={t(cur ? 'bs.editCarrier' : 'bs.addCarrier')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={saving} disabled={!f.name.trim() || !/^https?:\/\//.test(f.endpoint)} onClick={() => onSave(cur ? cfg.carrierAccounts.map((s) => (s.id === cur.id ? { ...s, ...f, name: f.name.trim() } : s)) : [...cfg.carrierAccounts, { id: newId(cfg.carrierAccounts.map((s) => s.id), f.name), provider: 'http', ...f, name: f.name.trim() }])}>{t('save.save')}</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-muted">{t('bs.carrierIntro')}</p>
        <Input label={t('bs.carrierName')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Input label={t('bs.carrierEndpoint')} placeholder="https://rates.example.com/quote" value={f.endpoint} onChange={(e) => setF({ ...f, endpoint: e.target.value.trim() })} />
        <Input label={t('bs.carrierSecret')} help={t('bs.carrierSecretHelp')} value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} />
        <pre className="overflow-x-auto rounded-md bg-surface p-3 text-xs">{'POST → {"service":"…","grams":1200,"subtotal":4500,"destination":{"countryCode":"FR"}}\n← {"price":590}'}</pre>
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
    <div className="flex flex-col gap-1 border-t border-current/15 pt-2">
      <Switch placement="end" checked={cfg.data.pickupFromOtherLocations} onChange={(v) => save.mutate({ ...cfg.data!, pickupFromOtherLocations: v })} label={t('bs.pickupOthers')} />
      <span className="text-[13px]">{t('bs.pickupOthersHelp')}</span>
    </div>
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
