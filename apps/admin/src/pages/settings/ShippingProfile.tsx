import { Badge, Banner, Button, Card, Checkbox, ConfirmDialog, Dropdown, EmptyState, Input, Modal, Select, Skeleton, Switch, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, MoreHorizontal, Pencil, Plus, Trash2, Truck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { UserErrors, gql, mutate } from '../../api';
import { SubHeader } from '../../components/SettingsKit';
import { ProductPicker, type PickedProduct } from '../../components/Pickers';
import { useFormat } from '../../components/shared';
import { Thumb } from '../Products';
import { DELIVERY_PROFILE, DELIVERY_PROFILE_REMOVE, DELIVERY_PROFILE_UPDATE, PRODUCT_VARIANT_IDS } from '../../graphql';
import { numToGid, parseDecimal } from '../../format';
import { useI18n } from '../../i18n';
import { COUNTRY_CODES, countryName, countryOptions } from '../../lib/countries';
import {
  WEIGHT_ABBR, blankCard, cardOf, cardProblem, fromGrams, methodInput, optionsOf,
  type ApiGroup, type ApiMethod, type ApiZone, type RateCard,
} from '../../lib/shipping';
import { useShop } from '../../session';

interface ProfileData {
  id: string; name: string; default: boolean; version: number; productVariantsCount: { count: number } | null;
  profileItems: { nodes: { id: string; product: { id: string; title: string; featuredMedia?: { image?: { url: string } } | null }; variants: { nodes: { id: string; title: string }[] } }[] };
  profileLocationGroups: ApiGroup[];
}
interface Data { deliveryProfile: ProfileData | null; locationsAvailableForDeliveryProfilesConnection: { nodes: { id: string; name: string }[] } }

interface OptionForm { groupId: string; zoneId: string; name: string; description: string; active: boolean; cards: RateCard[]; originalIds: string[] }
interface ZoneForm { groupId: string; id: string | null; name: string; rest: boolean; countries: { code: string; provinces: string }[] }

const errText = (e: unknown) => (e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e instanceof Error ? e.message : String(e));

export function ShippingProfilePage() {
  const { id: param } = useParams();
  const gid = numToGid('DeliveryProfile', param ?? '');
  const { t, lang } = useI18n();
  const { shop } = useShop();
  const fmt = useFormat();
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const key = ['delivery-profile', gid];
  const q = useQuery({ queryKey: key, queryFn: () => gql<Data>(DELIVERY_PROFILE, { id: gid }) });
  const p = q.data?.deliveryProfile ?? null;
  const allLocations = q.data?.locationsAvailableForDeliveryProfilesConnection.nodes ?? [];

  const [name, setName] = useState<string | null>(null);
  const [option, setOption] = useState<OptionForm | null>(null);
  const [zone, setZone] = useState<ZoneForm | null>(null);
  const [origins, setOrigins] = useState<{ groupId: string | null; ids: string[] } | null>(null);
  const [picker, setPicker] = useState(false);
  const [confirm, setConfirm] = useState<null | { kind: 'zone'; id: string; name: string } | { kind: 'option'; zoneId: string; groupId: string; ids: string[]; conditionIds: string[]; name: string } | { kind: 'profile' }>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => { void qc.invalidateQueries({ queryKey: key }); void qc.invalidateQueries({ queryKey: ['delivery-profiles'] }); };
  const update = useMutation({
    mutationFn: (profile: Record<string, unknown>) => mutate(DELIVERY_PROFILE_UPDATE, { id: gid, profile }, 'deliveryProfileUpdate'),
    onSuccess: () => { refresh(); setError(null); },
    onError: (e) => setError(errText(e)),
  });
  const done = (msg?: string) => () => { if (msg) toast(msg); setOption(null); setZone(null); setOrigins(null); setConfirm(null); };
  const save = (profile: Record<string, unknown>, after?: () => void) => update.mutate(profile, { onSuccess: () => { toast(t('settings.saved')); after?.(); } });

  const remove = useMutation({
    mutationFn: () => mutate(DELIVERY_PROFILE_REMOVE, { id: gid }, 'deliveryProfileRemove'),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['delivery-profiles'] }); nav('/settings/shipping'); },
    onError: (e) => toast(errText(e), 'critical'),
  });

  const addProducts = async (picked: PickedProduct[]) => {
    try {
      const ids: string[] = [];
      for (const pr of picked) ids.push(...(await gql<{ product: { variants: { nodes: { id: string }[] } } | null }>(PRODUCT_VARIANT_IDS, { id: pr.id })).product!.variants.nodes.map((v) => v.id));
      await mutate(DELIVERY_PROFILE_UPDATE, { id: gid, profile: { variantsToAssociate: ids } }, 'deliveryProfileUpdate');
      toast(t('settings.saved'));
      refresh();
    } catch (e) { toast(errText(e), 'critical'); }
  };

  const money = (amount: string) => fmt.money({ amount, currencyCode: shop.currency });
  const conditionText = (m: ApiMethod) => {
    const parts = m.methodConditions.map((c) => {
      const cr = c.conditionCriteria;
      const v = cr.__typename === 'Weight' ? `${fromGrams(cr.value, shop.weightUnit)} ${WEIGHT_ABBR[shop.weightUnit] ?? ''}` : money(cr.amount);
      const kind = c.field === 'TOTAL_WEIGHT' ? t('delivery.weight') : t('delivery.orderPrice');
      return `${kind} ${c.operator === 'GREATER_THAN_OR_EQUAL_TO' ? '≥' : '≤'} ${v}`;
    });
    return parts.length ? parts.join(' · ') : t('delivery.allOrders');
  };
  const priceText = (m: ApiMethod) => {
    const price = Number(m.rateProvider.price?.amount ?? 0);
    const base = price === 0 ? t('shipping.free') : money(m.rateProvider.price!.amount);
    return m.shopmeFreeOverAmount ? `${base} · ${t('delivery.freeFrom', { amount: money(m.shopmeFreeOverAmount.amount) })}` : base;
  };

  if (q.isLoading) return <><SubHeader back="/settings/shipping" parent={t('delivery.title')} title="" /><Skeleton className="h-40" /></>;
  if (!p) return <><SubHeader back="/settings/shipping" parent={t('delivery.title')} title={t('delivery.notFound')} /><Banner>{t('delivery.notFound')}</Banner></>;

  const openOption = (g: ApiGroup, z: ApiZone, existing: ApiMethod[] | null) => {
    setError(null);
    const first = existing?.[0];
    setOption({
      groupId: g.locationGroup.id, zoneId: z.zone.id, name: first?.name ?? '', description: first?.description ?? '', active: first?.active ?? true,
      cards: existing ? existing.map((m) => cardOf(m, shop.weightUnit)) : [blankCard()], originalIds: existing?.map((m) => m.id) ?? [],
    });
  };
  const saveOption = () => {
    const o = option!;
    const kept = o.cards.filter((c) => c.id).map((c) => c.id!);
    const meta = { name: o.name, description: o.description, active: o.active };
    save({
      conditionsToDelete: o.cards.flatMap((c) => c.conditionIds),
      methodDefinitionsToDelete: o.originalIds.filter((id) => !kept.includes(id)),
      locationGroupsToUpdate: [{ id: o.groupId, zonesToUpdate: [{
        id: o.zoneId,
        methodDefinitionsToCreate: o.cards.filter((c) => !c.id).map((c) => methodInput(meta, c, shop.currency, shop.weightUnit)),
        methodDefinitionsToUpdate: o.cards.filter((c) => c.id).map((c) => methodInput(meta, c, shop.currency, shop.weightUnit)),
      }] }],
    }, done());
  };
  const optionValid = !!option && option.name.trim() !== '' && option.cards.every((c) => cardProblem(c) === null);

  const openZone = (g: ApiGroup, z: ApiZone | null) => {
    setError(null);
    setZone({
      groupId: g.locationGroup.id, id: z?.zone.id ?? null, name: z?.zone.name ?? '',
      rest: !!z?.zone.countries.some((c) => c.code.restOfWorld),
      countries: z?.zone.countries.filter((c) => c.code.countryCode).map((c) => ({ code: c.code.countryCode!, provinces: c.provinces.map((x) => x.code).join(', ') })) ?? [],
    });
  };
  const saveZone = () => {
    const z = zone!;
    const countries = [...(z.rest ? [{ restOfWorld: true }] : []), ...z.countries.map((c) => ({ code: c.code, provinces: c.provinces.split(/[,\s]+/).filter(Boolean).map((code) => ({ code })) }))];
    save({ locationGroupsToUpdate: [{ id: z.groupId, ...(z.id ? { zonesToUpdate: [{ id: z.id, name: z.name.trim(), countries }] } : { zonesToCreate: [{ name: z.name.trim(), countries }] }) }] }, done());
  };
  const zoneValid = !!zone && zone.name.trim() !== '' && (zone.rest || zone.countries.length > 0);

  const saveOrigins = () => {
    const o = origins!;
    save({ locationGroupsToUpdate: o.groupId ? [{ id: o.groupId, locations: o.ids }] : undefined, locationGroupsToCreate: o.groupId ? undefined : [{ locations: o.ids }] }, done());
  };

  const countryList = countryOptions(lang);
  const singleCountry = zone && !zone.rest && zone.countries.length === 1;
  const coverage = (z: ApiZone) => z.zone.countries.map((c) => (c.code.restOfWorld ? t('delivery.restOfWorld') : `${countryName(c.code.countryCode ?? '', lang)}${c.provinces.length ? ` (${c.provinces.map((x) => x.code).join(', ')})` : ''}`)).join(', ') || '—';
  const firstCard = option?.cards[0];

  return (
    <div className="flex flex-col gap-4">
      <SubHeader back="/settings/shipping" parent={t('delivery.title')} title={p.name}
        actions={!p.default && <Button variant="danger" size="sm" onClick={() => setConfirm({ kind: 'profile' })}><Trash2 className="size-4" />{t('delivery.deleteProfile')}</Button>} />
      {error && !option && !zone && !origins && <Banner>{error}</Banner>}

      {p.default ? <Banner tone="info">{t('delivery.generalInfo')}</Banner> : (
        <>
          <Card title={t('delivery.profileName')}
            actions={<Button size="sm" variant="primary" disabled={name === null || name.trim() === '' || name === p.name} loading={update.isPending} onClick={() => save({ name: name!.trim() }, () => setName(null))}>{t('save.save')}</Button>}>
            <Input aria-label={t('delivery.profileName')} value={name ?? p.name} onChange={(e) => setName(e.target.value)} />
          </Card>
          <Card title={t('delivery.products')} actions={<Button size="sm" onClick={() => setPicker(true)}><Plus className="size-4" />{t('delivery.addProducts')}</Button>}>
            {p.profileItems.nodes.length === 0 ? <p className="text-[13px] text-muted">{t('delivery.noProducts')}</p> : (
              <ul className="divide-y divide-line">
                {p.profileItems.nodes.map((it) => (
                  <li key={it.id} className="flex items-center gap-3 py-2">
                    <Thumb url={it.product.featuredMedia?.image?.url} className="size-8" />
                    <span className="min-w-0 flex-1 text-[13px]"><span className="block truncate font-medium">{it.product.title}</span><span className="text-muted">{t('delivery.variantsCount', { n: it.variants.nodes.length })}</span></span>
                    <Button size="sm" variant="plain" onClick={() => save({ variantsToDissociate: it.variants.nodes.map((v) => v.id) })}>{t('common.remove')}</Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      {p.profileLocationGroups.length === 0 && (
        <Card><EmptyState title={t('delivery.noOriginsTitle')} description={t('delivery.noOriginsBody')} action={<Button variant="primary" onClick={() => setOrigins({ groupId: null, ids: [] })}>{t('delivery.chooseLocations')}</Button>} /></Card>
      )}

      {p.profileLocationGroups.map((g) => (
        <section key={g.locationGroup.id} className="flex flex-col gap-3" aria-label={t('delivery.shipsFrom')}>
          <Card title={t('delivery.shipsFrom')} actions={<Button size="sm" onClick={() => setOrigins({ groupId: g.locationGroup.id, ids: g.locationGroup.locations.nodes.map((l) => l.id) })}><Pencil className="size-4" />{t('common.edit')}</Button>}>
            {g.locationGroup.locations.nodes.length === 0 ? <p className="text-[13px] text-muted">{t('delivery.noLocations')}</p> : (
              <ul className="flex flex-wrap gap-2">{g.locationGroup.locations.nodes.map((l) => <li key={l.id}><Badge><MapPin className="mr-1 inline size-3" />{l.name}</Badge></li>)}</ul>
            )}
          </Card>

          {g.locationGroupZones.nodes.map((z) => (
            <Card key={z.zone.id} title={<span><span className="block">{z.zone.name}</span><span className="block text-[13px] font-normal text-muted">{coverage(z)}</span></span>}
              actions={<Dropdown align="right" variant="plain" size="sm" icon label={t('common.moreActions')} trigger={<MoreHorizontal className="size-4" />} items={[
                { key: 'edit', icon: <Pencil />, label: t('delivery.editZone'), onSelect: () => openZone(g, z) },
                { key: 'delete', icon: <Trash2 />, label: t('delivery.deleteZone'), onSelect: () => setConfirm({ kind: 'zone', id: z.zone.id, name: z.zone.name }) },
              ]} />}>
              {z.methodDefinitions.nodes.length === 0 && <p className="mb-2 text-[13px] text-muted">{t('delivery.noRates')}</p>}
              <ul className="divide-y divide-line">
                {optionsOf(z.methodDefinitions.nodes).map((o) => (
                  <li key={o.name} className="flex items-start gap-3 py-2">
                    <Truck className="mt-0.5 size-4 shrink-0 text-muted" />
                    <div className="min-w-0 flex-1 text-[13px]">
                      <p className="font-medium">{o.name}{o.methods.some((m) => !m.active) && <span className="ml-2"><Badge>{t('delivery.inactive')}</Badge></span>}</p>
                      {o.methods[0]!.description && <p className="text-muted">{o.methods[0]!.description}</p>}
                      {o.methods.map((m) => <p key={m.id} className="flex justify-between gap-3 text-muted"><span>{conditionText(m)}</span><span className="text-text">{priceText(m)}</span></p>)}
                    </div>
                    <Dropdown align="right" variant="plain" size="sm" icon label={t('common.moreActions')} trigger={<MoreHorizontal className="size-4" />} items={[
                      { key: 'edit', icon: <Pencil />, label: t('delivery.editRate'), onSelect: () => openOption(g, z, o.methods) },
                      { key: 'delete', icon: <Trash2 />, label: t('delivery.deleteRate'), onSelect: () => setConfirm({ kind: 'option', zoneId: z.zone.id, groupId: g.locationGroup.id, ids: o.methods.map((m) => m.id), conditionIds: o.methods.flatMap((m) => m.methodConditions.map((c) => c.id)), name: o.name }) },
                    ]} />
                  </li>
                ))}
              </ul>
              <div className="mt-3"><Button size="sm" onClick={() => openOption(g, z, null)}><Plus className="size-4" />{t('delivery.addRate')}</Button></div>
            </Card>
          ))}
          <div><Button onClick={() => openZone(g, null)}><Plus className="size-4" />{t('delivery.addZone')}</Button></div>
        </section>
      ))}

      <ProductPicker open={picker} onClose={() => setPicker(false)} onConfirm={(picked) => void addProducts(picked)} />

      <Modal open={!!option} onClose={() => setOption(null)} wide title={option?.originalIds.length ? t('delivery.editRate') : t('delivery.addRate')} closeLabel={t('common.close')}
        footer={<><Button onClick={() => setOption(null)}>{t('common.cancel')}</Button><Button variant="primary" disabled={!optionValid} loading={update.isPending} onClick={saveOption}>{t('save.save')}</Button></>}>
        {option && (
          <div className="flex flex-col gap-4">
            {error && <Banner>{error}</Banner>}
            <Input label={t('delivery.rateName')} value={option.name} onChange={(e) => setOption({ ...option, name: e.target.value })} />
            <Input label={t('delivery.rateDescription')} help={t('delivery.rateDescriptionHelp')} value={option.description} onChange={(e) => setOption({ ...option, description: e.target.value })} />
            <Switch placement="end" checked={option.active} onChange={(v) => setOption({ ...option, active: v })} label={t('delivery.rateActive')} />
            <div className="rounded-lg bg-hover p-4" aria-label={t('delivery.preview')}>
              <p className="mb-2 text-xs text-muted">{t('delivery.preview')}</p>
              <div className="flex items-center gap-3 rounded-lg bg-canvas px-3 py-2 text-[13px] shadow-card">
                <span className="size-3 rounded-full border-2 border-primary" />
                <span className="grow"><span className="block font-medium">{option.name || t('delivery.rateNamePlaceholder')}</span><span className="block text-xs text-muted">{option.description || ' '}</span></span>
                <span className="font-medium">{firstCard && (parseDecimal(firstCard.price) ?? 0) > 0 ? money(String(parseDecimal(firstCard.price))) : t('shipping.free')}</span>
              </div>
              {option.cards.length > 1 && <p className="mt-2 text-xs text-muted">{t('delivery.previewHighest')}</p>}
            </div>
            {option.cards.map((c, i) => {
              const set = (patch: Partial<RateCard>) => setOption({ ...option, cards: option.cards.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
              const problem = cardProblem(c);
              const unit = WEIGHT_ABBR[shop.weightUnit] ?? '';
              return (
                <fieldset key={c.id ?? `new-${i}`} className="flex flex-col gap-3 rounded-lg border border-line p-3">
                  <legend className="flex items-center gap-2 px-1 text-[13px] font-semibold">
                    {t('delivery.rateN', { n: i + 1 })}
                    {option.cards.length > 1 && <Button size="sm" variant="plain" aria-label={t('common.remove')} onClick={() => setOption({ ...option, cards: option.cards.filter((_, j) => j !== i) })}><Trash2 className="size-4" /></Button>}
                  </legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input label={`${t('shipping.price')} (${shop.currency})`} inputMode="decimal" placeholder="0.00" value={c.price} onChange={(e) => set({ price: e.target.value })} error={problem === 'price' ? t('delivery.errPrice') : undefined} />
                    <Select label={t('shipping.condition')} value={c.cond} onChange={(e) => set({ cond: e.target.value as RateCard['cond'], min: '', max: '' })}>
                      <option value="none">{t('delivery.condNone')}</option><option value="weight">{t('delivery.condWeight')}</option><option value="price">{t('delivery.condPrice')}</option>
                    </Select>
                  </div>
                  {c.cond !== 'none' && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input label={c.cond === 'weight' ? t('delivery.minWeight', { unit }) : t('delivery.minPrice', { currency: shop.currency })} inputMode="decimal" value={c.min} onChange={(e) => set({ min: e.target.value })} error={problem === 'range' ? t('delivery.errRange') : undefined} />
                      <Input label={c.cond === 'weight' ? t('delivery.maxWeight', { unit }) : t('delivery.maxPrice', { currency: shop.currency })} inputMode="decimal" value={c.max} onChange={(e) => set({ max: e.target.value })} />
                    </div>
                  )}
                  <Switch placement="end" checked={c.freeOn} onChange={(v) => set({ freeOn: v })} label={t('delivery.offerFree')} />
                  {c.freeOn && <Input label={`${t('delivery.freeMinimum')} (${shop.currency})`} inputMode="decimal" value={c.freeOver} onChange={(e) => set({ freeOver: e.target.value })} error={problem === 'free' ? t('delivery.errPrice') : undefined} />}
                </fieldset>
              );
            })}
            <button type="button" onClick={() => setOption({ ...option, cards: [...option.cards, blankCard()] })} className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-line py-4 text-[13px] hover:bg-hover"><Plus className="size-4" />{t('delivery.addAnotherRate')}</button>
          </div>
        )}
      </Modal>

      <Modal open={!!zone} onClose={() => setZone(null)} wide title={zone?.id ? t('delivery.editZone') : t('delivery.addZone')} closeLabel={t('common.close')}
        footer={<><Button onClick={() => setZone(null)}>{t('common.cancel')}</Button><Button variant="primary" disabled={!zoneValid} loading={update.isPending} onClick={saveZone}>{t('save.save')}</Button></>}>
        {zone && (
          <div className="flex flex-col gap-4">
            {error && <Banner>{error}</Banner>}
            <Input label={t('shipping.zoneName')} value={zone.name} onChange={(e) => setZone({ ...zone, name: e.target.value })} />
            <fieldset>
              <legend className="mb-1 text-[13px] font-medium">{t('shipping.countries')}</legend>
              <div className="grid max-h-48 grid-cols-2 gap-1 overflow-y-auto rounded-md border border-line p-2 sm:grid-cols-3">
                <Checkbox label={t('delivery.restOfWorld')} checked={zone.rest} onChange={(e) => setZone({ ...zone, rest: e.target.checked })} />
                {countryList.filter((c) => (COUNTRY_CODES as readonly string[]).includes(c.code)).map((c) => (
                  <Checkbox key={c.code} label={c.name} checked={zone.countries.some((x) => x.code === c.code)}
                    onChange={(e) => setZone({ ...zone, countries: e.target.checked ? [...zone.countries, { code: c.code, provinces: '' }] : zone.countries.filter((x) => x.code !== c.code) })} />
                ))}
              </div>
            </fieldset>
            {singleCountry && <Input label={t('delivery.provinces')} help={t('delivery.provincesHelp')} value={zone.countries[0]!.provinces} onChange={(e) => setZone({ ...zone, countries: [{ ...zone.countries[0]!, provinces: e.target.value }] })} />}
          </div>
        )}
      </Modal>

      <Modal open={!!origins} onClose={() => setOrigins(null)} title={t('delivery.shipsFrom')} closeLabel={t('common.close')}
        footer={<><Button onClick={() => setOrigins(null)}>{t('common.cancel')}</Button><Button variant="primary" disabled={!origins?.ids.length} loading={update.isPending} onClick={saveOrigins}>{t('save.save')}</Button></>}>
        {origins && (
          <div className="flex flex-col gap-2">
            {error && <Banner>{error}</Banner>}
            <p className="text-[13px] text-muted">{t('delivery.originsHelp')}</p>
            {allLocations.map((l) => <Checkbox key={l.id} label={l.name} checked={origins.ids.includes(l.id)} onChange={(e) => setOrigins({ ...origins, ids: e.target.checked ? [...origins.ids, l.id] : origins.ids.filter((x) => x !== l.id) })} />)}
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} danger
        title={confirm?.kind === 'zone' ? t('delivery.deleteZoneTitle', { name: confirm.name }) : confirm?.kind === 'option' ? t('delivery.deleteRateTitle', { name: confirm.name }) : t('delivery.deleteProfileTitle')}
        message={confirm?.kind === 'zone' ? t('delivery.deleteZoneBody') : confirm?.kind === 'option' ? t('delivery.deleteRateBody') : t('delivery.deleteProfileBody')}
        confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')}
        onConfirm={() => {
          const c = confirm;
          if (!c) return;
          if (c.kind === 'profile') remove.mutate();
          else if (c.kind === 'zone') save({ zonesToDelete: [c.id] }, done());
          else save({ conditionsToDelete: c.conditionIds, methodDefinitionsToDelete: c.ids }, done());
        }} />
    </div>
  );
}
