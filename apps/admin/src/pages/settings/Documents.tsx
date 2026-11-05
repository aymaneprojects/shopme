import { Banner, Button, Card, Checkbox, Input, Select, Skeleton, Switch, Textarea, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { gql, mutate } from '../../api';
import { Section, SubHeader } from '../../components/SettingsKit';
import { SaveBar } from '../../components/SaveBar';
import { useFormat } from '../../components/shared';
import { ORDER_FOR_DOCUMENT, RECENT_ORDERS, SHOPME_CONFIG_UPDATE } from '../../graphql';
import { gidToNum, numToGid } from '../../format';
import { useI18n } from '../../i18n';
import { errText, useConfig } from '../../lib/config';
import type { DocConf, DocumentsConfig, GeneralConfig } from '../../lib/config';
import { useShopSettings } from './Settings';

const DOCS = [['invoice', 'invoice'], ['packing-slip', 'packingSlip'], ['pick-list', 'pickList']] as const;
type DocKey = (typeof DOCS)[number][1];
const slugOf = (k: DocKey) => DOCS.find((d) => d[1] === k)![0];

/** Templates of the printable documents (invoice, packing slip, pick list) and a way to print them for an order. */
export function DocumentsSettings() {
  const { t } = useI18n();
  const q = useConfig<DocumentsConfig>('DOCUMENTS');
  return (
    <>
      <SubHeader back="/settings/shipping" parent={t('delivery.title')} title={t('bs.documentTemplates')} />
      {q.isLoading && <Skeleton className="h-64" />}
      {q.error && <Banner>{q.error.message}</Banner>}
      {q.data && <DocumentsForm key={q.dataUpdatedAt} initial={q.data} />}
    </>
  );
}

function DocumentsForm({ initial }: { initial: DocumentsConfig }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => mutate(SHOPME_CONFIG_UPDATE, { key: 'DOCUMENTS', value: f }, 'shopmeConfigUpdate'),
    onSuccess: () => { toast(t('settings.saved')); setError(null); void qc.invalidateQueries({ queryKey: ['config', 'DOCUMENTS'] }); }, onError: (e) => setError(errText(e)),
  });
  const set = (k: DocKey, p: Partial<DocConf>) => setF({ ...f, [k]: { ...f[k], ...p } });
  const orders = useQuery({ queryKey: ['recent-orders-docs'], queryFn: async () => (await gql<{ orders: { nodes: Array<{ id: string; name: string }> } }>(RECENT_ORDERS)).orders.nodes });
  const [orderId, setOrderId] = useState('');
  const chosen = orderId || orders.data?.[0]?.id || '';
  return (
    <div className="flex flex-col gap-4">
      <SaveBar dirty={JSON.stringify(f) !== JSON.stringify(initial)} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => { setF(initial); setError(null); }} />
      {error && <Banner>{error}</Banner>}
      <Section title={t('bs.docHeader')} description={t('bs.docHeaderDesc')}>
        <Card><Textarea label={t('bs.docCompanyNote')} rows={3} value={f.companyNote} onChange={(e) => setF({ ...f, companyNote: e.target.value })} /></Card>
      </Section>
      {DOCS.map(([, key]) => (
        <Section key={key} title={t(`bs.doc.${key}` as never)} description={t(`bs.doc.${key}Desc` as never)}>
          <Card>
            <div className="flex flex-col gap-3">
              <Switch placement="end" checked={f[key].enabled} onChange={(v) => set(key, { enabled: v })} label={t('bs.docEnabled')} />
              <Input label={t('bs.docTitle')} value={f[key].title} onChange={(e) => set(key, { title: e.target.value })} />
              <Textarea label={t('bs.docNotes')} rows={2} value={f[key].notes} onChange={(e) => set(key, { notes: e.target.value })} />
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <Checkbox label={t('bs.docShowPrices')} checked={f[key].showPrices} onChange={(e) => set(key, { showPrices: e.target.checked })} />
                <Checkbox label={t('bs.docShowImages')} checked={f[key].showImages} onChange={(e) => set(key, { showImages: e.target.checked })} />
              </div>
            </div>
          </Card>
        </Section>
      ))}
      <Section title={t('bs.docPrint')} description={t('bs.docPrintDesc')}>
        <Card>
          <div className="flex flex-wrap items-end gap-3">
            <Select className="min-w-48" label={t('bs.docOrder')} value={chosen} onChange={(e) => setOrderId(e.target.value)}>
              {(orders.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
            {DOCS.filter(([, key]) => initial[key].enabled).map(([slug, key]) => (
              chosen ? <Link key={slug} to={`/settings/documents/${slug}/${gidToNum(chosen)}`} className="btn btn-secondary"><Printer className="size-4" />{initial[key].title || t(`bs.doc.${key}` as never)}</Link> : null
            ))}
          </div>
          {orders.data?.length === 0 && <p className="mt-2 text-[13px] text-muted">{t('bs.docNoOrders')}</p>}
        </Card>
      </Section>
    </div>
  );
}

interface Money { shopMoney: { amount: string; currencyCode: string } }
interface DocOrder {
  id: string; name: string; createdAt: string; email: string | null; phone: string | null; note: string | null;
  shippingAddress: { name: string | null; company: string | null; address1: string | null; address2: string | null; city: string | null; zip: string | null; province: string | null; country: string | null; phone: string | null } | null;
  billingAddress: DocOrder['shippingAddress'];
  lineItems: { nodes: Array<{ id: string; title: string; variantTitle: string | null; sku: string | null; quantity: number; image: { url: string } | null; originalUnitPriceSet: Money; discountedTotalSet: Money }> };
  subtotalPriceSet: Money; totalShippingPriceSet: Money; totalTaxSet: Money; totalPriceSet: Money; shippingLines: { nodes: Array<{ title: string }> };
}

const addressLines = (a: DocOrder['shippingAddress']) => (a ? [a.name, a.company, a.address1, a.address2, [a.zip, a.city].filter(Boolean).join(' '), a.province, a.country, a.phone].filter(Boolean) as string[] : []);

/** The printable page of one document for one order: the app chrome is hidden when printing. */
export function PrintDocumentPage() {
  const { type = '', id = '' } = useParams();
  const { t } = useI18n();
  const fmt = useFormat();
  const key = DOCS.find((d) => d[0] === type)?.[1];
  const docs = useConfig<DocumentsConfig>('DOCUMENTS');
  const general = useConfig<GeneralConfig>('GENERAL');
  const shop = useShopSettings();
  const order = useQuery({ queryKey: ['order-doc', id], queryFn: () => gql<{ order: DocOrder | null; shop: { name: string; email: string } }>(ORDER_FOR_DOCUMENT, { id: numToGid('Order', id) }) });
  if (!key) return <Banner>{t('notif.notFound')}</Banner>;
  if (order.isLoading || docs.isLoading || general.isLoading || shop.isLoading) return <Skeleton className="h-96" />;
  const o = order.data?.order;
  if (!o || !docs.data) return <Banner>{order.error?.message ?? t('notif.notFound')}</Banner>;
  const conf = docs.data[key];
  const be = general.data?.businessEntity;
  const sa = shop.data?.shop.address;
  const sender = [be?.legalName || order.data?.shop.name, be?.address1 || sa?.address1, be?.address2 || sa?.address2, [be?.zip || sa?.zip, be?.city || sa?.city].filter(Boolean).join(' '), be?.taxId ? `${t('bs.taxId')}: ${be.taxId}` : '', order.data?.shop.email].filter(Boolean) as string[];
  const money = (m: Money) => fmt.money({ amount: m.shopMoney.amount, currencyCode: m.shopMoney.currencyCode });
  const lines = key === 'pickList' ? [...o.lineItems.nodes].sort((a, b) => (a.sku ?? '').localeCompare(b.sku ?? '') || a.title.localeCompare(b.title)) : o.lineItems.nodes;
  const prices = conf.showPrices && key !== 'pickList';
  return (
    <div className="flex flex-col gap-3">
      <style>{'@media print{body *{visibility:hidden}.print-doc,.print-doc *{visibility:visible}.print-doc{position:absolute;left:0;top:0;width:100%;box-shadow:none!important}}'}</style>
      <div className="flex items-center justify-between gap-3">
        <Link to="/settings/shipping/documents" className="btn btn-secondary btn-sm">{t('common.back')}</Link>
        <Button variant="primary" onClick={() => window.print()}><Printer className="size-4" />{t('bs.docPrintNow')}</Button>
      </div>
      {!conf.enabled && <Banner tone="warning">{t('bs.docDisabled')}</Banner>}
      <article className="print-doc rounded-lg bg-white p-8 text-[13px] text-black shadow-card">
        <header className="flex justify-between gap-6 border-b border-neutral-300 pb-4">
          <div><h1 className="text-xl font-semibold">{conf.title || t(`bs.doc.${key}` as never)}</h1><p className="text-neutral-600">{o.name} · {fmt.date(o.createdAt)}</p></div>
          <div className="text-right text-neutral-700">{sender.map((l, i) => <p key={i}>{l}</p>)}{docs.data.companyNote && <p className="mt-1 whitespace-pre-line">{docs.data.companyNote}</p>}</div>
        </header>
        <section className="grid grid-cols-2 gap-6 py-4">
          <div><h2 className="mb-1 font-semibold">{t('bs.docShipTo')}</h2>{addressLines(o.shippingAddress).map((l, i) => <p key={i}>{l}</p>)}</div>
          {key === 'invoice' && <div><h2 className="mb-1 font-semibold">{t('bs.docBillTo')}</h2>{addressLines(o.billingAddress ?? o.shippingAddress).map((l, i) => <p key={i}>{l}</p>)}{o.email && <p>{o.email}</p>}</div>}
          {key !== 'invoice' && o.shippingLines.nodes[0] && <div><h2 className="mb-1 font-semibold">{t('bs.docShippingMethod')}</h2><p>{o.shippingLines.nodes[0].title}</p></div>}
        </section>
        <table className="w-full border-collapse">
          <thead><tr className="border-b border-neutral-400 text-left"><th className="py-1.5">{t('bs.docItem')}</th><th>{t('bs.docSku')}</th><th className="text-right">{t('bs.docQty')}</th>{prices && <><th className="text-right">{t('bs.docUnit')}</th><th className="text-right">{t('bs.docTotal')}</th></>}</tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-neutral-200 align-top">
                <td className="py-1.5"><span className="flex items-start gap-2">{key === 'pickList' && <span aria-hidden className="mt-0.5 inline-block size-3.5 shrink-0 border border-black" />}{conf.showImages && l.image && <img src={l.image.url} alt="" className="size-10 rounded object-cover" />}<span>{l.title}{l.variantTitle && l.variantTitle !== 'Default Title' ? <span className="block text-neutral-600">{l.variantTitle}</span> : null}</span></span></td>
                <td>{l.sku}</td><td className="text-right">{l.quantity}</td>
                {prices && <><td className="text-right">{money(l.originalUnitPriceSet)}</td><td className="text-right">{money(l.discountedTotalSet)}</td></>}
              </tr>
            ))}
          </tbody>
        </table>
        {prices && (
          <dl className="ml-auto mt-4 w-64 space-y-1">
            <div className="flex justify-between"><dt>{t('bs.docSubtotal')}</dt><dd>{money(o.subtotalPriceSet)}</dd></div>
            <div className="flex justify-between"><dt>{t('bs.docShipping')}</dt><dd>{money(o.totalShippingPriceSet)}</dd></div>
            <div className="flex justify-between"><dt>{t('bs.docTax')}</dt><dd>{money(o.totalTaxSet)}</dd></div>
            <div className="flex justify-between border-t border-neutral-400 pt-1 font-semibold"><dt>{t('bs.docTotal')}</dt><dd>{money(o.totalPriceSet)}</dd></div>
          </dl>
        )}
        {(o.note || conf.notes) && <footer className="mt-6 border-t border-neutral-300 pt-3">{o.note && <p><span className="font-semibold">{t('bs.docOrderNote')}:</span> {o.note}</p>}{conf.notes && <p className="mt-1 whitespace-pre-line text-neutral-700">{conf.notes}</p>}</footer>}
      </article>
    </div>
  );
}
