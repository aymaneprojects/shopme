import { Input, Popover, Select } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { ChevronsUpDown, Search } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { gql } from '../api';
import { CARRIER_PROVIDERS, RATE_COLLECTIONS } from '../graphql';
import { useI18n } from '../i18n';
import { TRANSIT_PRESETS, type RateCard } from '../lib/shipping';
import { useConfig } from '../lib/config';
import type { ShippingConfig } from '../lib/config';

interface Provider { id: string; name: string; needsAccount: boolean; params: Array<{ key: string; label: string; kind: 'money' | 'text' }> }
interface CollectionsData { collections: { nodes: Array<{ id: string; title: string; productsCount: { count: number } | null }> }; productsCount: { count: number } | null }

export const useCarrierProviders = () => useQuery({ queryKey: ['carrier-providers'], queryFn: async () => (await gql<{ shopmeCarrierProviders: Provider[] }>(CARRIER_PROVIDERS)).shopmeCarrierProviders });

/** Compact "Label  value ⇅" chip that opens a popover (the per-rate settings of the shipping option editor). */
function Pill({ label, value, children, menuLabel }: { label: string; value: ReactNode; children: (close: () => void) => ReactNode; menuLabel: string }) {
  return (
    <Popover label={menuLabel} className="w-64 p-0" triggerVariant="plain" triggerClassName="!h-7 !min-h-0 !gap-1.5 !rounded-lg !bg-hover !px-2 !text-[13px] !font-normal !text-fg hover:!bg-line"
      trigger={<><span className="text-muted">{label}</span><span className="max-w-56 truncate font-medium">{value}</span><ChevronsUpDown className="size-3.5 text-muted" /></>}>
      {children}
    </Popover>
  );
}

/** Transit time of a rate (shown to the buyer as a delivery estimate). */
export function TransitSelect({ card, set }: { card: RateCard; set: (p: Partial<RateCard>) => void }) {
  const { t } = useI18n();
  const range = (v: string) => { const [a, b] = v.split('-'); return a === b ? t('bs.transitDay', { n: Number(a) }) : t('bs.transitDays', { a: Number(a), b: Number(b) }); };
  const presets = card.transit && !TRANSIT_PRESETS.includes(card.transit) ? [card.transit, ...TRANSIT_PRESETS] : TRANSIT_PRESETS;
  return (
    <Select label={t('bs.transit')} value={card.transit} onChange={(e) => set({ transit: e.target.value })}>
      <option value="">{t('bs.transitNone')}</option>{presets.map((p) => <option key={p} value={p}>{range(p)}</option>)}
    </Select>
  );
}

/** "Applies to": all products, or a set of collections picked in a searchable list (with their product counts). */
export function AppliesToPill({ card, set }: { card: RateCard; set: (p: Partial<RateCard>) => void }) {
  const { t } = useI18n();
  const [term, setTerm] = useState('');
  const q = useQuery({ queryKey: ['rate-collections'], queryFn: () => gql<CollectionsData>(RATE_COLLECTIONS) });
  const all = q.data?.collections.nodes ?? [];
  const titleOf = (id: string) => all.find((c) => c.id === id)?.title ?? id.split('/').pop();
  const shown = all.filter((c) => !term.trim() || c.title.toLowerCase().includes(term.trim().toLowerCase()));
  const toggle = (id: string) => set({ collections: card.collections.includes(id) ? card.collections.filter((c) => c !== id) : [...card.collections, id] });
  const row = 'flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-hover';
  return (
    <Pill label={t('bs.appliesTo')} menuLabel={t('bs.appliesTo')} value={card.collections.length ? card.collections.map(titleOf).join(', ') : t('bs.allProducts')}>
      {() => (
        <div>
          <div className="relative border-b border-line">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" aria-hidden />
            <input type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('fid.rate.searchCollections')} aria-label={t('fid.rate.searchCollections')} className="h-9 w-full bg-transparent pl-8 pr-2 text-[13px] outline-none" />
          </div>
          <ul className="max-h-60 overflow-y-auto p-1">
            <li><label className={row}><input type="checkbox" className="size-4" checked={card.collections.length === 0} onChange={() => set({ collections: [] })} /><span className="flex-1 font-medium">{t('bs.allProducts')}</span><span className="text-xs text-muted">{q.data?.productsCount?.count ?? ''}</span></label></li>
            {shown.map((c) => (
              <li key={c.id}><label className={row}><input type="checkbox" className="size-4" checked={card.collections.includes(c.id)} onChange={() => toggle(c.id)} /><span className="flex-1 truncate">{c.title}</span><span className="text-xs text-muted">{c.productsCount?.count ?? ''}</span></label></li>
            ))}
          </ul>
        </div>
      )}
    </Pill>
  );
}

/** "Ships from": the locations of the profile group a rate is offered from (all of them by default). */
export function ShipsFromPill({ card, set, locations }: { card: RateCard; set: (p: Partial<RateCard>) => void; locations: Array<{ id: string; name: string }> }) {
  const { t } = useI18n();
  if (locations.length < 2) return null;
  const chosen = card.origins.length === 0 ? locations : locations.filter((l) => card.origins.includes(l.id));
  const value = chosen.length > 2 ? `${chosen.slice(0, 2).map((l) => l.name).join(', ')}, +${chosen.length - 2}` : chosen.map((l) => l.name).join(', ');
  return (
    <Pill label={t('bs.shipsFrom')} menuLabel={t('bs.shipsFrom')} value={value}>
      {() => (
        <ul className="max-h-60 overflow-y-auto p-1">
          {locations.map((l) => (
            <li key={l.id}><label className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-hover">
              <input type="checkbox" className="size-4" checked={card.origins.length === 0 || card.origins.includes(l.id)}
                onChange={(e) => { const cur = card.origins.length === 0 ? locations.map((x) => x.id) : card.origins; const next = e.target.checked ? [...new Set([...cur, l.id])] : cur.filter((x) => x !== l.id); if (next.length === 0) return; set({ origins: next.length === locations.length ? [] : next }); }} />
              <span className="flex-1 truncate">{l.name}</span>
            </label></li>
          ))}
        </ul>
      )}
    </Pill>
  );
}

/** Carrier-calculated rate: which carrier quotes it, with which account and parameters (the price is the fallback). */
export function CarrierConfig({ card, set }: { card: RateCard; set: (p: Partial<RateCard>) => void }) {
  const { t } = useI18n();
  const providers = useCarrierProviders();
  const shipping = useConfig<ShippingConfig>('SHIPPING');
  if (card.rateType !== 'CARRIER') return null;
  const provider = providers.data?.find((p) => p.id === card.provider);
  return (
    <div className="flex flex-col gap-3 rounded-md bg-surface p-3">
      <p className="text-[13px] text-muted">{t('bs.carrierRateHelp')}</p>
      <Select label={t('bs.carrierProvider')} value={card.provider} onChange={(e) => set({ provider: e.target.value, params: {} })}>
        {(providers.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </Select>
      {provider?.needsAccount && (
        <Select label={t('bs.carrierAccount')} value={card.params.accountId ?? ''} onChange={(e) => set({ params: { ...card.params, accountId: e.target.value } })}>
          <option value="" />{(shipping.data?.carrierAccounts ?? []).filter((a) => a.provider === card.provider).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
      )}
      {provider?.params.map((p) => <Input key={p.key} label={p.kind === 'money' ? `${p.label} (${t('bs.minorUnits')})` : p.label} inputMode={p.kind === 'money' ? 'numeric' : undefined} value={card.params[p.key] ?? ''} onChange={(e) => set({ params: { ...card.params, [p.key]: e.target.value } })} />)}
      <p className="text-xs text-muted">{t('bs.carrierFallback')}</p>
    </div>
  );
}
