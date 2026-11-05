import { Badge, Banner, Button, Card, Input, RichTextEditor, Select, Skeleton, Switch, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Lock, Mail, Repeat, Scale, ShoppingBag, Truck, Undo2 } from 'lucide-react';
import type { ComponentType } from 'react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { UserErrors, gql, mutate } from '../../api';
import { LinkRow, RowCard, Section, SubHeader } from '../../components/SettingsKit';
import { SaveBar } from '../../components/SaveBar';
import { FINAL_SALE_TITLES, RETURN_RULES, RETURN_RULES_UPDATE, SHOP_POLICIES, SHOP_POLICY_UPDATE } from '../../graphql';
import { CollectionPicker, ProductPicker } from '../../components/Pickers';
import { useShop } from '../../session';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';

const TYPES = ['REFUND_POLICY', 'PRIVACY_POLICY', 'TERMS_OF_SERVICE', 'SHIPPING_POLICY', 'CONTACT_INFORMATION', 'TERMS_OF_SALE', 'LEGAL_NOTICE', 'SUBSCRIPTION_POLICY'] as const;
const ICONS: Record<(typeof TYPES)[number], ComponentType<{ className?: string }>> = { REFUND_POLICY: Undo2, PRIVACY_POLICY: Lock, TERMS_OF_SERVICE: Scale, SHIPPING_POLICY: Truck, CONTACT_INFORMATION: Mail, TERMS_OF_SALE: ShoppingBag, LEGAL_NOTICE: Scale, SUBSCRIPTION_POLICY: Repeat };
interface Policy { id: string; type: string; title: string; body: string; url: string | null }
const usePolicies = () => useQuery({ queryKey: ['shop-policies'], queryFn: () => gql<{ shop: { shopPolicies: Policy[] } }>(SHOP_POLICIES) });
const isSet = (p?: Policy) => !!p && p.body.replace(/<[^>]*>/g, '').trim().length > 0;

export function PoliciesSettings() {
  const { t } = useI18n();
  const q = usePolicies();
  return (
    <div className="flex flex-col gap-6">
      <Section title={t('policies.written')} description={t('policies.footer')}>
        {q.isLoading && <Skeleton className="h-64" />}
        {q.error && <Banner>{q.error.message}</Banner>}
        {q.data && (
          <RowCard>
            {TYPES.map((k) => {
              const set = isSet(q.data.shop.shopPolicies.find((p) => p.type === k));
              return <LinkRow key={k} to={`/settings/policies/${k}`} icon={ICONS[k]} title={t(`policies.${k}` as Key)} trailing={<Badge tone={set ? 'success' : 'neutral'}>{t(set ? 'policies.published' : 'policies.notSet')}</Badge>} />;
            })}
          </RowCard>
        )}
      </Section>
      <ReturnRules />
      <CookieBanner />
    </div>
  );
}

export function PolicyEditPage() {
  const { type = '' } = useParams();
  const { t } = useI18n();
  const q = usePolicies();
  if (!(TYPES as readonly string[]).includes(type)) return <Banner>{t('notif.notFound')}</Banner>;
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  return <PolicyForm key={q.dataUpdatedAt} type={type as (typeof TYPES)[number]} policy={q.data?.shop.shopPolicies.find((p) => p.type === type)} />;
}

function PolicyForm({ type, policy }: { type: (typeof TYPES)[number]; policy?: Policy }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const initial = policy?.body ?? '';
  const [body, setBody] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => mutate(SHOP_POLICY_UPDATE, { shopPolicy: { type, body } }, 'shopPolicyUpdate'),
    onSuccess: () => { toast(t('policies.saved')); setError(null); void qc.invalidateQueries({ queryKey: ['shop-policies'] }); },
    onError: (e) => setError(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message),
  });
  const rte = { bold: t('rte.bold'), italic: t('rte.italic'), underline: t('rte.underline'), list: t('rte.list'), orderedList: t('rte.orderedList'), link: t('rte.link'), source: t('rte.source'), paragraph: t('rte.paragraph'), heading: t('rte.heading'), subheading: t('rte.subheading'), linkPrompt: t('rte.linkPrompt') };
  const url = policy?.url;
  return (
    <>
      <SaveBar dirty={body !== initial} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => { setBody(initial); setError(null); }} />
      <SubHeader back="/settings/policies" parent={t('settings.policies')} title={t(`policies.${type}` as Key)}
        actions={url && body === initial && isSet(policy) ? <a href={url} target="_blank" rel="noreferrer" className="btn btn-secondary"><FileText className="size-4" />{t('policies.view')}</a> : undefined} />
      {error && <div className="mb-4"><Banner>{error}</Banner></div>}
      <Card><RichTextEditor value={body} onChange={setBody} labels={rte} /></Card>
    </>
  );
}

function CookieBanner() {
  const { t } = useI18n();
  return (
    <Section title={t('policies.cookies')} description={t('policies.cookiesHelp')}>
      <RowCard><LinkRow to="/settings/privacy/cookie-banner" icon={Lock} title={t('priv.banner')} description={t('policies.cookiesMoved')} /></RowCard>
    </Section>
  );
}

interface Rules { windowDays: number | null; shippingCost: 'free' | 'customer_fixed' | 'customer_pays'; shippingFee: number; restockingFeePercent: number; finalSale: { productIds: string[]; collectionIds: string[] } }

/** Return rules: window, return shipping cost, restocking fee and final sale items. */
function ReturnRules() {
  const { t } = useI18n();
  const q = useQuery({ queryKey: ['return-rules'], queryFn: () => gql<{ shopmeReturnRules: Rules }>(RETURN_RULES) });
  return (
    <Section title={t('returns.title')} description={t('returns.desc')}>
      {q.isLoading && <Skeleton className="h-48" />}
      {q.error && <Banner>{q.error.message}</Banner>}
      {q.data && <ReturnRulesForm key={q.dataUpdatedAt} initial={q.data.shopmeReturnRules} />}
    </Section>
  );
}

function ReturnRulesForm({ initial }: { initial: Rules }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const { shop } = useShop();
  const digits = shop.currency === 'JPY' ? 0 : 2;
  const [windowDays, setWindowDays] = useState(initial.windowDays ? String(initial.windowDays) : '');
  const [cost, setCost] = useState(initial.shippingCost);
  const [fee, setFee] = useState(initial.shippingFee ? (initial.shippingFee / 10 ** digits).toFixed(digits) : '');
  const [restock, setRestock] = useState(initial.restockingFeePercent ? String(initial.restockingFeePercent) : '');
  const [products, setProducts] = useState<Array<{ id: string; title: string }>>([]);
  const [collections, setCollections] = useState<Array<{ id: string; title: string }>>([]);
  const [picking, setPicking] = useState<'products' | 'collections' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ids = [...initial.finalSale.productIds, ...initial.finalSale.collectionIds];
  const titles = useQuery({ queryKey: ['final-sale-titles', ids.join()], enabled: ids.length > 0, queryFn: () => gql<{ nodes: Array<{ id: string; title: string } | null> }>(FINAL_SALE_TITLES, { ids }) });
  const [seeded, setSeeded] = useState(ids.length === 0);
  if (!seeded && titles.data) {
    const by = new Map(titles.data.nodes.flatMap((n) => (n ? [[n.id, n] as const] : [])));
    setProducts(initial.finalSale.productIds.flatMap((i) => (by.get(i) ? [by.get(i)!] : [])));
    setCollections(initial.finalSale.collectionIds.flatMap((i) => (by.get(i) ? [by.get(i)!] : [])));
    setSeeded(true);
  }
  const save = useMutation({
    mutationFn: () => mutate(RETURN_RULES_UPDATE, { input: {
      windowDays: windowDays.trim() ? Number(windowDays) : null, shippingCost: cost,
      shippingFee: cost === 'customer_fixed' ? Math.round(Number(fee.replace(',', '.') || 0) * 10 ** digits) : 0, restockingFeePercent: Number(restock.replace(',', '.') || 0),
      finalSaleProductIds: products.map((p) => p.id), finalSaleCollectionIds: collections.map((c) => c.id),
    } }, 'shopmeReturnRulesUpdate'),
    onSuccess: () => { toast(t('settings.saved')); setError(null); void qc.invalidateQueries({ queryKey: ['return-rules'] }); },
    onError: (e) => setError(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' \u00b7 ') : e.message),
  });
  const list = (items: Array<{ id: string; title: string }>, drop: (id: string) => void) => (
    <ul className="divide-y divide-line">{items.map((i) => <li key={i.id} className="flex items-center gap-2 py-1 text-[13px]"><span className="flex-1">{i.title}</span><button type="button" className="text-muted hover:text-fg" aria-label={`${t('common.remove')} ${i.title}`} onClick={() => drop(i.id)}>&times;</button></li>)}</ul>
  );
  return (
    <Card>
      <div className="flex flex-col gap-4">
        {error && <Banner>{error}</Banner>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('returns.window')} help={t('returns.windowHelp')} inputMode="numeric" value={windowDays} onChange={(e) => setWindowDays(e.target.value)} />
          <Input label={t('returns.restocking')} help={t('returns.restockingHelp')} inputMode="decimal" value={restock} onChange={(e) => setRestock(e.target.value)} />
          <Select label={t('returns.shipping')} value={cost} onChange={(e) => setCost(e.target.value as Rules['shippingCost'])}>
            <option value="free">{t('returns.shipping.free')}</option><option value="customer_fixed">{t('returns.shipping.fixed')}</option><option value="customer_pays">{t('returns.shipping.customer')}</option>
          </Select>
          {cost === 'customer_fixed' && <Input label={t('returns.fee', { currency: shop.currency })} inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />}
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">{t('returns.finalSale')}</span>
          <p className="text-xs text-muted">{t('returns.finalSaleHelp')}</p>
          <div className="flex gap-2"><Button size="sm" onClick={() => setPicking('products')}>{t('returns.addProducts')}</Button><Button size="sm" onClick={() => setPicking('collections')}>{t('returns.addCollections')}</Button></div>
          {list(products, (i) => setProducts(products.filter((p) => p.id !== i)))}
          {list(collections, (i) => setCollections(collections.filter((p) => p.id !== i)))}
        </div>
        <div className="flex justify-end"><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>{t('save.save')}</Button></div>
      </div>
      <ProductPicker open={picking === 'products'} onClose={() => setPicking(null)} excludeIds={products.map((p) => p.id)} onConfirm={(p) => { setProducts([...products, ...p.map((x) => ({ id: x.id, title: x.title }))]); setPicking(null); }} />
      <CollectionPicker open={picking === 'collections'} onClose={() => setPicking(null)} excludeIds={collections.map((c) => c.id)} onConfirm={(c) => { setCollections([...collections, ...c.map((x) => ({ id: x.id, title: x.title }))]); setPicking(null); }} />
    </Card>
  );
}
