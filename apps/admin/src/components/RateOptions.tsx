import { Button, Checkbox, Input, Select } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { gql } from '../api';
import { CARRIER_PROVIDERS, COLLECTIONS_SIMPLE } from '../graphql';
import { useI18n } from '../i18n';
import { TRANSIT_PRESETS, type RateCard } from '../lib/shipping';
import { useConfig } from '../lib/config';
import type { ShippingConfig } from '../lib/config';
import { CollectionPicker } from './Pickers';

interface Provider { id: string; name: string; needsAccount: boolean; params: Array<{ key: string; label: string; kind: 'money' | 'text' }> }

/** Per-rate options of the shipping option editor: type (fixed or carrier-calculated), transit time, collections it applies to, locations it ships from. */
export function RateOptions({ card, set, locations }: { card: RateCard; set: (p: Partial<RateCard>) => void; locations: Array<{ id: string; name: string }> }) {
  const { t } = useI18n();
  const [picker, setPicker] = useState(false);
  const providers = useQuery({ queryKey: ['carrier-providers'], queryFn: async () => (await gql<{ shopmeCarrierProviders: Provider[] }>(CARRIER_PROVIDERS)).shopmeCarrierProviders });
  const collections = useQuery({ queryKey: ['collections-simple'], queryFn: async () => (await gql<{ collections: { nodes: Array<{ id: string; title: string }> } }>(COLLECTIONS_SIMPLE)).collections.nodes });
  const shipping = useConfig<ShippingConfig>('SHIPPING');
  const provider = providers.data?.find((p) => p.id === card.provider);
  const titleOf = (id: string) => collections.data?.find((c) => c.id === id)?.title ?? id.split('/').pop();
  const range = (v: string) => { const [a, b] = v.split('-'); return a === b ? t('bs.transitDay', { n: Number(a) }) : t('bs.transitDays', { a: Number(a), b: Number(b) }); };
  const presets = card.transit && !TRANSIT_PRESETS.includes(card.transit) ? [card.transit, ...TRANSIT_PRESETS] : TRANSIT_PRESETS;
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label={t('bs.rateType')} value={card.rateType} onChange={(e) => set({ rateType: e.target.value as RateCard['rateType'], provider: e.target.value === 'CARRIER' ? card.provider || providers.data?.[0]?.id || '' : '', params: {} })}>
          <option value="FIXED">{t('bs.rateFixed')}</option><option value="CARRIER">{t('bs.rateCarrier')}</option>
        </Select>
        <Select label={t('bs.transit')} value={card.transit} onChange={(e) => set({ transit: e.target.value })}>
          <option value="">{t('bs.transitNone')}</option>{presets.map((p) => <option key={p} value={p}>{range(p)}</option>)}
        </Select>
      </div>
      {card.rateType === 'CARRIER' && (
        <div className="flex flex-col gap-3 rounded-md bg-surface p-3">
          <p className="text-[13px] text-muted">{t('bs.carrierRateHelp')}</p>
          <Select label={t('bs.carrierProvider')} value={card.provider} onChange={(e) => set({ provider: e.target.value, params: {} })}>
            {(providers.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          {provider?.needsAccount && (
            <Select label={t('bs.carrierAccount')} value={card.params.accountId ?? ''} onChange={(e) => set({ params: { ...card.params, accountId: e.target.value } })}>
              <option value="" />{(shipping.data?.carrierAccounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          )}
          {provider?.params.map((p) => <Input key={p.key} label={p.kind === 'money' ? `${p.label} (${t('bs.minorUnits')})` : p.label} inputMode={p.kind === 'money' ? 'numeric' : undefined} value={card.params[p.key] ?? ''} onChange={(e) => set({ params: { ...card.params, [p.key]: e.target.value } })} />)}
          <p className="text-xs text-muted">{t('bs.carrierFallback')}</p>
        </div>
      )}
      <div>
        <p className="mb-1 text-[13px] font-medium">{t('bs.appliesTo')}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {card.collections.length === 0 && <span className="text-[13px] text-muted">{t('bs.allProducts')}</span>}
          {card.collections.map((id) => <span key={id} className="inline-flex items-center gap-1 rounded-full bg-hover py-0.5 pl-2.5 pr-1 text-[13px]">{titleOf(id)}<button type="button" aria-label={`${t('common.remove')} ${titleOf(id)}`} className="rounded-full p-0.5 hover:bg-line" onClick={() => set({ collections: card.collections.filter((c) => c !== id) })}><X className="size-3" /></button></span>)}
          <Button size="sm" onClick={() => setPicker(true)}><Plus className="size-3.5" />{t('bs.addCollections')}</Button>
        </div>
        <CollectionPicker open={picker} onClose={() => setPicker(false)} excludeIds={card.collections} onConfirm={(picked) => { set({ collections: [...card.collections, ...picked.map((c) => c.id)] }); setPicker(false); }} />
      </div>
      {locations.length > 1 && (
        <fieldset>
          <legend className="mb-1 text-[13px] font-medium">{t('bs.shipsFrom')}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {locations.map((l) => <Checkbox key={l.id} label={l.name} checked={card.origins.length === 0 || card.origins.includes(l.id)}
              onChange={(e) => { const cur = card.origins.length === 0 ? locations.map((x) => x.id) : card.origins; const next = e.target.checked ? [...new Set([...cur, l.id])] : cur.filter((x) => x !== l.id); if (next.length === 0) return; set({ origins: next.length === locations.length ? [] : next }); }} />)}
          </div>
        </fieldset>
      )}
    </div>
  );
}
