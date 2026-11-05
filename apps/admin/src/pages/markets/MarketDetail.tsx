import { Badge, Banner, Button, Card, ConfirmDialog, Dropdown, Input, Popover, Select, Skeleton, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, ChevronRight, Coins, Minus, Monitor, Pencil, Percent, Plus, Receipt, ShoppingBag, Store, Tag, Undo2, WalletCards } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { gql, mutate } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { SaveBar, guard } from '../../components/SaveBar';
import { numToGid } from '../../format';
import { MARKET_DELETE, MARKET_DETAIL, MARKET_UPDATE } from '../../graphql';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';
import { countryName } from '../../lib/countries';
import { MARKET_CURRENCIES, currencyLabel, oneUnit } from '../../lib/markets';
import { useShop } from '../../session';
import { countriesOf, CountryChip, CountryPicker, errText, type MarketRow } from './shared';

interface CatalogOption { id: string; title: string; status: string; priceList: { id: string; name: string; currency: string } | null; markets?: { nodes: Array<{ id: string }> } }
interface Detail {
  market: MarketRow | null;
  shop: { id: string; currencyCode: string; taxesIncluded: boolean; enabledPresentmentCurrencies: string[] };
  catalogs: { nodes: CatalogOption[] };
  others: { nodes: Array<{ id: string; name: string; primary: boolean; conditions: { regionsCondition: { regions: { nodes: Array<{ code: string }> } } | null } | null }> };
}

export function MarketDetailPage() {
  const { id = '' } = useParams();
  const { t } = useI18n();
  const gid = numToGid('Market', id);
  const q = useQuery({ queryKey: ['market', gid], queryFn: () => gql<Detail>(MARKET_DETAIL, { id: gid }) });
  if (q.isLoading) return <div className="grid gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64" /></div>;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  if (!q.data?.market) return <Banner>{t('markets.notFound')}</Banner>;
  return <MarketView key={q.dataUpdatedAt} data={q.data as Detail & { market: MarketRow }} />;
}

/** One customization or inherited row: icon, label, then the value column and a trailing button. */
function SettingRow({ icon: Icon, label, children, trailing }: { icon: typeof Coins; label: string; children: React.ReactNode; trailing?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-1 py-2.5 text-[13px]">
      <Icon className="size-4 shrink-0 text-muted" aria-hidden />
      <span className="w-40 shrink-0 font-medium">{label}</span>
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
      {trailing}
    </div>
  );
}
const Inherited = ({ children }: { children: React.ReactNode }) => <span className="flex min-w-0 items-center gap-2 text-muted"><Store className="size-3.5 shrink-0" aria-hidden /><span aria-hidden>→</span><span className="truncate text-fg">{children}</span></span>;
const iconBtn = 'btn btn-plain btn-icon btn-sm';

function MarketView({ data }: { data: Detail & { market: MarketRow } }) {
  const { t, lang } = useI18n();
  const { shop } = useShop();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { market, shop: shopInfo } = data;
  const primary = market.primary;
  const [name, setName] = useState(market.name);
  const [status, setStatus] = useState<'ACTIVE' | 'DRAFT'>(market.status);
  const [countries, setCountries] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty = name !== market.name || status !== market.status;
  const cs = countriesOf(market);
  const currency = market.currencySettings;
  const overridden = !primary && !!currency && currency.baseCurrency.currencyCode !== shopInfo.currencyCode;
  const catalog = market.catalogs.nodes[0] ?? null;
  const strategy = market.priceInclusions?.inclusiveTaxPricingStrategy ?? 'ADD_TAXES_AT_CHECKOUT';
  const taxOverridden = !primary && ((strategy === 'INCLUDES_TAXES_IN_PRICE') !== shopInfo.taxesIncluded);
  const effectiveCurrency = currency?.baseCurrency.currencyCode ?? shopInfo.currencyCode;

  const update = useMutation({
    mutationFn: (input: Record<string, unknown>) => mutate(MARKET_UPDATE, { id: market.id, input }, 'marketUpdate'),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['market'] }); void qc.invalidateQueries({ queryKey: ['markets'] }); toast(t('markets.saved')); },
    onError: (e) => toast(errText(e), 'critical'),
  });
  const remove = useMutation({
    mutationFn: () => mutate(MARKET_DELETE, { id: market.id }, 'marketDelete'),
    onSuccess: () => { guard.off = true; toast(t('markets.deleted')); void qc.invalidateQueries({ queryKey: ['markets'] }); nav('/markets'); },
    onError: (e) => toast(errText(e), 'critical'),
  });
  const save = () => update.mutate({ name: name.trim(), status });
  const saveCountries = (picked: string[]) => {
    const before = cs.map((c) => c.code);
    const add = picked.filter((c) => !before.includes(c));
    const del = before.filter((c) => !picked.includes(c));
    setCountries(false);
    if (!add.length && !del.length) return;
    update.mutate({ conditions: { ...(add.length && { conditionsToAdd: { regionsCondition: { regions: add.map((countryCode) => ({ countryCode })) } } }), ...(del.length && { conditionsToDelete: { regionsCondition: { regions: del.map((countryCode) => ({ countryCode })) } } }) } });
  };
  const takenElsewhere = data.others.nodes.filter((m) => m.id !== market.id && !m.primary).flatMap((m) => (m.conditions?.regionsCondition?.regions.nodes ?? []).map((c) => ({ code: c.code, market: m.name })));

  const catalogChoices = data.catalogs.nodes.filter((c) => !c.markets?.nodes.length || c.markets.nodes.some((m) => m.id === market.id));
  const catalogSelect = (
    <Select aria-label={t('markets.catalogs')} value={catalog?.id ?? ''} onChange={(e) => {
      const next = e.target.value;
      update.mutate({ ...(catalog && { catalogsToDelete: [catalog.id] }), ...(next && { catalogsToAdd: [next] }) });
    }} className="!min-h-8 max-w-64 !py-1">
      <option value="">{t('markets.chooseCatalog')}</option>
      {catalogChoices.map((c) => <option key={c.id} value={c.id} disabled={!!c.priceList && c.priceList.currency !== effectiveCurrency}>{c.title}{c.priceList && c.priceList.currency !== effectiveCurrency ? ` — ${t('markets.catalogCurrencyMismatch', { currency: c.priceList.currency })}` : ''}</option>)}
    </Select>
  );

  return (
    <>
      <SaveBar dirty={dirty} saving={update.isPending} onSave={save} onDiscard={() => { setName(market.name); setStatus(market.status); }} />
      <PageHeader back="/markets" title={market.name} badges={<><Badge tone="neutral">{t('markets.region')}</Badge><Badge tone={market.status === 'ACTIVE' ? 'success' : 'neutral'}>{t(`markets.status.${market.status}` as Key)}</Badge></>}
        actions={!primary && <Dropdown align="right" chevron label={t('markets.otherActions')} trigger={t('markets.otherActions')} items={[{ key: 'delete', label: t('markets.delete'), danger: true, onSelect: () => setConfirmDelete(true) }]} />} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <div className="flex items-end gap-2">
              <div className="flex-1"><Input label={t('markets.name')} value={name} onChange={(e) => setName(e.target.value)} /></div>
              <Select aria-label={t('markets.col.status')} value={status} disabled={primary} onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'DRAFT')} className="w-32">
                <option value="ACTIVE">{t('markets.status.ACTIVE')}</option><option value="DRAFT">{t('markets.status.DRAFT')}</option>
              </Select>
            </div>
            <div className="mt-3 flex items-center gap-3 rounded-md border border-line px-3 py-2 text-[13px]">
              <span className="w-24 font-medium">{t('markets.includes')}</span>
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                {cs.length ? cs.map((c) => <CountryChip key={c.id} code={c.code} name={c.name} />) : <span className="text-muted">{t('markets.noCountries')}</span>}
                {primary && <span className="text-xs text-muted">{t('markets.primaryCountries')}</span>}
              </span>
              {!primary && <button type="button" className={iconBtn} aria-label={t('markets.editCountries')} onClick={() => setCountries(true)}><Pencil className="size-4" /></button>}
            </div>
            {primary && <p className="mt-2 text-xs text-muted">{t('markets.primaryNote')}</p>}
          </Card>

          {(catalog || overridden || taxOverridden) && (
            <section>
              <h2 className="mb-2 text-sm font-semibold">{t('markets.customizations')}</h2>
              <Card className="divide-y divide-line">
                {catalog && (
                  <SettingRow icon={BookOpen} label={t('markets.catalogs')} trailing={<button type="button" className={iconBtn} aria-label={t('markets.remove')} onClick={() => update.mutate({ catalogsToDelete: [catalog.id] })}><Minus className="size-4" /></button>}>
                    {catalogSelect}
                    {catalog.priceList && <Link to={`/markets/catalogs/${catalog.id.split('/').pop()}`} className="text-xs text-accent">{catalog.priceList.name}</Link>}
                  </SettingRow>
                )}
                {overridden && (
                  <SettingRow icon={Coins} label={t('markets.currency')} trailing={<button type="button" className={iconBtn} aria-label={t('markets.remove')} onClick={() => update.mutate({ removeCurrencySettings: true })}><Minus className="size-4" /></button>}>
                    <CurrencyPopover market={market} shopCurrency={shopInfo.currencyCode} lang={lang} busy={update.isPending} onSave={(c) => update.mutate({ currencySettings: c })}
                      trigger={<span className="inline-flex items-center gap-2 rounded-md bg-hover px-2.5 py-1">{currencyLabel(effectiveCurrency, lang)}{currency?.baseCurrency.manualRate && <span className="text-muted">1 {shopInfo.currencyCode} = {currency.baseCurrency.manualRate}</span>}</span>} />
                  </SettingRow>
                )}
                {taxOverridden && (
                  <SettingRow icon={Receipt} label={t('markets.taxes')} trailing={<button type="button" className={iconBtn} aria-label={t('markets.remove')} onClick={() => update.mutate({ removePriceInclusions: true })}><Minus className="size-4" /></button>}>
                    <span>{strategy === 'INCLUDES_TAXES_IN_PRICE' ? t('markets.taxesIncluded') : t('markets.taxesCollected')}</span>
                  </SettingRow>
                )}
              </Card>
            </section>
          )}

          <section>
            <h2 className="mb-2 text-sm font-semibold">{t('markets.inherited')}</h2>
            <div className="divide-y divide-line">
              {!overridden && !primary && (
                <SettingRow icon={Coins} label={t('markets.currency')} trailing={
                  <CurrencyPopover market={market} shopCurrency={shopInfo.currencyCode} lang={lang} busy={update.isPending} onSave={(c) => update.mutate({ currencySettings: c })}
                    trigger={<Plus className="size-4" />} />}>
                  <Inherited>{currencyLabel(shopInfo.currencyCode, lang)}</Inherited>
                </SettingRow>
              )}
              {primary && <SettingRow icon={Coins} label={t('markets.currency')}><Inherited>{currencyLabel(shopInfo.currencyCode, lang)}</Inherited></SettingRow>}
              {!catalog && !primary && (
                <SettingRow icon={BookOpen} label={t('markets.catalogs')} trailing={
                  <Popover label={t('markets.add')} align="right" className="w-72 p-3" trigger={<Plus className="size-4" />}>
                    {(close) => (
                      <div className="flex flex-col gap-2" onChange={() => close()}>
                        {catalogChoices.length ? <Select label={t('markets.catalogs')} value="" onChange={(e) => e.target.value && update.mutate({ catalogsToAdd: [e.target.value] })}>
                          <option value="">{t('markets.chooseCatalog')}</option>
                          {catalogChoices.map((c) => <option key={c.id} value={c.id} disabled={!!c.priceList && c.priceList.currency !== effectiveCurrency}>{c.title}</option>)}
                        </Select> : <p className="text-[13px] text-muted">{t('catalogs.emptyBody')}</p>}
                        <Link to="/markets/catalogs/new" className="text-[13px] text-accent">{t('catalogs.create')}</Link>
                      </div>
                    )}
                  </Popover>}>
                  <Inherited>{t('markets.allProducts')}</Inherited>
                </SettingRow>
              )}
              <SettingRow icon={Percent} label={t('markets.discounts')}><Inherited>{t('markets.allDiscounts')}</Inherited></SettingRow>
              <SettingRow icon={Monitor} label={t('markets.domain')}><Inherited>{shop.name} · {new Intl.DisplayNames([lang], { type: 'language' }).of(shop.locale) ?? shop.locale}</Inherited></SettingRow>
              {!taxOverridden && (
                <SettingRow icon={Receipt} label={t('markets.taxes')} trailing={primary ? undefined : (
                  <Popover label={t('markets.add')} align="right" className="w-72 p-3" trigger={<Plus className="size-4" />}>
                    {(close) => (
                      <div className="flex flex-col gap-2">
                        <Button onClick={() => { update.mutate({ priceInclusions: { taxPricingStrategy: 'INCLUDES_TAXES_IN_PRICE' } }); close(); }}>{t('markets.taxesIncluded')}</Button>
                        <Button onClick={() => { update.mutate({ priceInclusions: { taxPricingStrategy: 'ADD_TAXES_AT_CHECKOUT' } }); close(); }}>{t('markets.taxesCollected')}</Button>
                      </div>
                    )}
                  </Popover>)}>
                  <Inherited>{shopInfo.taxesIncluded ? t('markets.taxesIncluded') : t('markets.taxesCollected')}</Inherited>
                </SettingRow>
              )}
              <SettingRow icon={Undo2} label={t('markets.returns')}><Inherited>{t('markets.noRule')}</Inherited></SettingRow>
              <SettingRow icon={ShoppingBag} label={t('markets.onlineStore')}><Inherited>{shop.name}</Inherited></SettingRow>
              <SettingRow icon={WalletCards} label={t('markets.payment')}><Inherited>{t('markets.checkoutConfig', { name: shop.name })}</Inherited></SettingRow>
            </div>
          </section>
        </div>

        <aside className="flex flex-col gap-3">
          <div className="relative h-28 overflow-hidden rounded-lg border border-line bg-canvas" style={{ backgroundImage: 'radial-gradient(var(--color-line, #d4d4d8) 1px, transparent 1px)', backgroundSize: '12px 12px' }} aria-hidden>
            <span className="absolute left-5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-full border border-line bg-canvas"><Store className="size-3" /></span>
            <span className="absolute left-10 top-1/2 h-px w-12 bg-line" />
            <span className="absolute left-[5.5rem] top-1/2 h-6 w-14 -translate-y-1/2 rounded-lg border border-line bg-canvas" />
          </div>
          <div>
            <p className="mb-1 text-[13px] text-muted">{t('markets.parent')}</p>
            <div className="flex items-center gap-2 rounded-md border border-line bg-canvas px-3 py-2 text-[13px]"><Store className="size-4 text-muted" aria-hidden />{t('markets.shopDefault')}</div>
          </div>
          <div>
            <p className="mb-1 text-[13px] font-medium">{t('markets.other')}</p>
            <Link to="/settings/policies" className="flex items-center gap-2 rounded-lg bg-canvas px-3 py-2.5 text-[13px] shadow-card hover:bg-hover">
              <Tag className="size-4 text-muted" aria-hidden /><span className="min-w-0 flex-1"><span className="block font-medium">{t('markets.policies')}</span><span className="block text-muted">{t('markets.policiesBody')}</span></span><ChevronRight className="size-4 text-muted" aria-hidden />
            </Link>
          </div>
        </aside>
      </div>
      {countries && <CountryPicker open title={t('markets.countriesTitle', { name: market.name })} value={cs.map((c) => c.code)} taken={takenElsewhere} busy={update.isPending} onClose={() => setCountries(false)} onDone={saveCountries} />}
      <ConfirmDialog open={confirmDelete} title={t('markets.deleteTitle', { name: market.name })} message={t('markets.deleteBody')} confirmLabel={t('markets.delete')} cancelLabel={t('common.cancel')} closeLabel={t('common.close')} danger loading={remove.isPending}
        onConfirm={() => remove.mutate()} onClose={() => setConfirmDelete(false)} />
      <span className="sr-only">{countryName(shop.country, lang)}</span>
    </>
  );
}

/** Currency override popover: currency, exchange rate and price rounding. */
function CurrencyPopover({ market, shopCurrency, lang, busy, onSave, trigger }: {
  market: MarketRow; shopCurrency: string; lang: string; busy: boolean; trigger: React.ReactNode;
  onSave: (c: { baseCurrency: string; baseCurrencyManualRate?: string; roundingEnabled: boolean; localCurrencies?: boolean }) => void;
}) {
  const { t } = useI18n();
  const cur = market.currencySettings;
  const [code, setCode] = useState(cur?.baseCurrency.currencyCode ?? shopCurrency);
  const [rate, setRate] = useState(cur?.baseCurrency.manualRate ?? '');
  const [rounding, setRounding] = useState(cur?.roundingEnabled ?? true);
  const [local, setLocal] = useState(cur?.localCurrencies ?? false);
  const multi = (market.conditions?.regionsCondition?.regions.nodes.length ?? 0) > 1;
  const foreign = code !== shopCurrency;
  const rateNum = Number(rate.replace(',', '.'));
  const rateOk = !foreign || (Number.isFinite(rateNum) && rateNum > 0);
  const sample = rateOk && foreign ? new Intl.NumberFormat(lang, { style: 'currency', currency: code, minimumFractionDigits: rounding ? 0 : undefined }).format(rounding ? Math.ceil(10 * rateNum) : 10 * rateNum) : '';
  const options = [shopCurrency, ...MARKET_CURRENCIES.filter((c) => c !== shopCurrency)];
  return (
    <Popover label={t('markets.currency.title')} align="right" className="w-80 p-3" trigger={trigger}>
      {(close) => (
        <div className="flex flex-col gap-3">
          <Select label={t('markets.currency.pick')} value={code} onChange={(e) => setCode(e.target.value)}>
            {options.map((c) => <option key={c} value={c}>{c === shopCurrency ? t('markets.currency.shopCurrency', { currency: currencyLabel(c, lang) }) : currencyLabel(c, lang)}</option>)}
          </Select>
          {foreign && (
            <div>
              <Input label={t('markets.currency.rate')} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} error={rate && !rateOk ? t('markets.currency.rateRequired') : undefined}
                help={rateOk && rate ? t('markets.currency.rateHelp', { shop: shopCurrency, rate: String(rateNum), currency: code }) : t('markets.currency.rateRequired')} />
              {sample && <p className="mt-1 text-xs text-muted">{t('markets.currency.preview', { price: new Intl.NumberFormat(lang, { style: 'currency', currency: shopCurrency }).format(10), local: sample })}</p>}
            </div>
          )}
          <fieldset className="flex flex-col gap-1.5 text-[13px]">
            <legend className="mb-1 font-medium">{t('markets.currency.rounding')}</legend>
            <label className="flex items-center gap-2"><input type="radio" name="rounding" checked={rounding} onChange={() => setRounding(true)} />{t('markets.currency.roundUp', { unit: oneUnit(code, lang) })}</label>
            <label className="flex items-center gap-2"><input type="radio" name="rounding" checked={!rounding} onChange={() => setRounding(false)} />{t('markets.currency.noRound')}</label>
            <p className="text-xs text-muted">{t('markets.currency.fixedNote')}</p>
          </fieldset>
          {multi && <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={local} onChange={(e) => setLocal(e.target.checked)} />{t('markets.currency.local')}</label>}
          <div className="flex justify-end gap-2 border-t border-line pt-3">
            <Button onClick={close}>{t('markets.currency.cancel')}</Button>
            <Button variant="primary" loading={busy} disabled={!rateOk} onClick={() => { onSave({ baseCurrency: code, ...(foreign && { baseCurrencyManualRate: String(rateNum) }), roundingEnabled: rounding, ...(multi && { localCurrencies: local }) }); close(); }}>{t('markets.currency.done')}</Button>
          </div>
        </div>
      )}
    </Popover>
  );
}
