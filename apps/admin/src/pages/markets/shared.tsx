import { Button, Modal, useToast } from '@shopme/ui';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { UserErrors } from '../../api';
import { searchCls } from '../../components/shared';
import { useI18n } from '../../i18n';
import { countriesSorted, flag } from '../../lib/markets';

export interface MarketRow {
  id: string; name: string; handle: string; status: 'ACTIVE' | 'DRAFT'; primary: boolean; type: string;
  conditions: { regionsCondition: { regions: { nodes: Array<{ id: string; name: string; code: string }> } } | null } | null;
  currencySettings: { baseCurrency: { currencyCode: string; currencyName: string; manualRate: string | null }; localCurrencies: boolean; roundingEnabled: boolean } | null;
  priceInclusions: { inclusiveTaxPricingStrategy: string } | null;
  catalogsCount: { count: number } | null;
  catalogs: { nodes: Array<{ id: string; title: string; status: string; priceList: { id: string; name: string; currency: string } | null }> };
}

export const countriesOf = (m: MarketRow) => m.conditions?.regionsCondition?.regions.nodes ?? [];
export const errText = (e: unknown) => (e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : (e as Error).message);

/** A country as a flag and its name, the way the market conditions show it. */
export function CountryChip({ code, name }: { code: string; name: string }) {
  return <span className="inline-flex items-center gap-1.5 rounded-md bg-hover px-2 py-0.5 text-[13px]"><span aria-hidden>{flag(code)}</span>{name}</span>;
}

/** Searchable multi-select of countries in a dialog. `taken` lists countries held by other markets (shown disabled). */
export function CountryPicker({ open, title, value, taken = [], onClose, onDone, busy }: {
  open: boolean; title: string; value: string[]; taken?: Array<{ code: string; market: string }>; onClose: () => void; onDone: (codes: string[]) => void; busy?: boolean;
}) {
  const { t, lang } = useI18n();
  const [picked, setPicked] = useState<string[]>(value);
  const [term, setTerm] = useState('');
  const all = useMemo(() => countriesSorted(lang), [lang]);
  const shown = all.filter((c) => !term.trim() || c.name.toLowerCase().includes(term.trim().toLowerCase()) || c.code.toLowerCase() === term.trim().toLowerCase());
  const owner = new Map(taken.map((x) => [x.code, x.market]));
  const toggle = (code: string) => setPicked((p) => (p.includes(code) ? p.filter((c) => c !== code) : [...p, code]));
  return (
    <Modal open={open} onClose={onClose} title={title} closeLabel={t('common.close')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} onClick={() => onDone(picked)}>{t('markets.countriesDone')}</Button></>}>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
        <input type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('markets.create.searchCountries')} aria-label={t('markets.create.searchCountries')} className={searchCls} />
      </div>
      <ul className="max-h-72 overflow-y-auto rounded-md border border-line">
        {shown.map((c) => {
          const other = owner.get(c.code);
          return (
            <li key={c.code}>
              <label className={`flex items-center gap-2.5 px-3 py-1.5 text-[13px] ${other ? 'opacity-50' : 'cursor-pointer hover:bg-hover'}`}>
                <input type="checkbox" className="size-4" checked={picked.includes(c.code)} disabled={!!other} onChange={() => toggle(c.code)} />
                <span aria-hidden>{flag(c.code)}</span><span className="flex-1">{c.name}</span>{other && <span className="text-xs text-muted">{other}</span>}
              </label>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-muted">{t('markets.create.countriesHelp')}</p>
    </Modal>
  );
}

export const useErrorToast = () => { const toast = useToast(); return (e: unknown) => toast(errText(e), 'critical'); };
