import { Banner, Button, Card, Checkbox, EmptyState, IndexTable, Input, Modal, Tabs, useToast } from '@shopme/ui';
import type { Column } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Package, Printer, Tag } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { gql, mutate } from '../../api';
import { useFormat } from '../../components/shared';
import type { MoneySet } from '../../components/shared';
import { PageHeader } from '../../components/PageHeader';
import { gidToNum } from '../../format';
import { LABELS_PAGE, LABEL_CREATE, LABEL_VOID, ORDER_LABEL_PRINT } from '../../graphql';
import { useI18n, useT } from '../../i18n';
import { printDocuments } from '../../lib/print';
import { useShop } from '../../session';

interface Label { id: string; orderId: string; orderName: string; carrier: string; service: string | null; trackingNumber: string | null; trackingUrl: string | null; cost: string; status: string; createdAt: string }
interface Awaiting { id: string; name: string; createdAt: string; totalPriceSet: MoneySet; customer: { displayName: string } | null; shippingAddress: { city: string | null; country: string | null } | null; lineItems: { nodes: Array<{ quantity: number }> } }
interface PageData { shopmeShippingLabels: Label[]; shopmeShippingLabelsCount: { count: number }; shopmeOrdersAwaitingLabel: Awaiting[] }
type Tab = 'awaiting' | 'labels' | 'voided';

const CARRIERS = ['La Poste', 'Colissimo', 'Chronopost', 'DHL', 'UPS', 'FedEx', 'USPS', 'Royal Mail', 'DPD', 'GLS', 'Mondial Relay', 'Canada Post'];
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Prints one shipping label sheet (carrier, tracking, ship-to address, contents) for an order. */
async function printLabel(l: Label, labels: { shipTo: string; tracking: string; contents: string; carrier: string }, lang: string): Promise<boolean> {
  const r = await gql<{ order: { name: string; shippingAddress: Record<string, string | null> | null; lineItems: { nodes: Array<{ title: string; variantTitle: string | null; quantity: number }> } } | null }>(ORDER_LABEL_PRINT, { id: l.orderId });
  const o = r.order;
  if (!o) return false;
  const a = o.shippingAddress;
  const lines = a ? [[a.firstName, a.lastName].filter(Boolean).join(' '), a.company, a.address1, a.address2, [a.zip, a.city].filter(Boolean).join(' '), a.province, a.country, a.phone].filter((x): x is string => !!x) : [];
  const html = `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8"><title>${esc(o.name)}</title><style>
body{font:14px/1.5 system-ui,sans-serif;color:#000;margin:0}section{width:100mm;min-height:140mm;margin:8mm auto;border:2px solid #000;padding:6mm;box-sizing:border-box;page-break-after:always}
h1{font-size:18px;margin:0}h2{font-size:11px;text-transform:uppercase;margin:12px 0 2px}.a{font-size:17px;font-weight:600}.t{font:700 22px/1.2 monospace;letter-spacing:.08em;border:2px dashed #000;padding:8px;margin-top:4px;text-align:center}.m{color:#444;font-size:12px}ul{margin:0;padding-left:16px}
</style></head><body><section><h1>${esc(l.carrier)}${l.service ? ` · ${esc(l.service)}` : ''}</h1><div class="m">${esc(o.name)}</div>
<h2>${esc(labels.shipTo)}</h2><div class="a">${lines.map((x) => `<div>${esc(x)}</div>`).join('')}</div>
<h2>${esc(labels.tracking)}</h2><div class="t">${esc(l.trackingNumber ?? '—')}</div>
<h2>${esc(labels.contents)}</h2><ul>${o.lineItems.nodes.map((n) => `<li>${esc(n.title)}${n.variantTitle ? ` (${esc(n.variantTitle)})` : ''} × ${n.quantity}</li>`).join('')}</ul></section></body></html>`;
  return printDocuments(html);
}

/** Record labels for several orders: one carrier and service, a tracking number per order. Fulfils the orders with that tracking. */
function LabelDialog({ orders, onClose, onDone }: { orders: Awaiting[]; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const [carrier, setCarrier] = useState('');
  const [service, setService] = useState('');
  const [notify, setNotify] = useState(true);
  const [numbers, setNumbers] = useState<Record<string, string>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      for (const o of orders) {
        await mutate(LABEL_CREATE, { input: { orderId: o.id, carrier, service: service || null, trackingNumber: numbers[o.id]?.trim() || null, trackingUrl: urls[o.id]?.trim() || null, cost: costs[o.id]?.trim().replace(',', '.') || null, notifyCustomer: notify } }, 'shopmeShippingLabelCreate');
      }
    },
    onSuccess: () => { toast(t('btn.labels.created', { n: orders.length, $count: orders.length })); onDone(); onClose(); },
    onError: (e: Error) => { setError(e.message); onDone(); },
  });
  return (
    <Modal open onClose={onClose} title={t('btn.labels.dialogTitle', { n: orders.length, $count: orders.length })} closeLabel={t('common.close')} wide
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={save.isPending} disabled={!carrier.trim()} onClick={() => { setError(null); save.mutate(); }}>{t('btn.labels.save')}</Button></>}>
      <p className="mb-3 text-[13px] text-muted">{t('btn.labels.manualHelp')}</p>
      {error && <div className="mb-3"><Banner>{error}</Banner></div>}
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Input label={t('btn.labels.carrier')} list="shopme-carriers" value={carrier} maxLength={100} onChange={(e) => setCarrier(e.target.value)} />
        <datalist id="shopme-carriers">{CARRIERS.map((c) => <option key={c} value={c} />)}</datalist>
        <Input label={t('btn.labels.service')} value={service} maxLength={100} placeholder={t('btn.labels.servicePlaceholder')} onChange={(e) => setService(e.target.value)} />
      </div>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {orders.map((o) => (
          <li key={o.id} className="grid gap-2 p-3 sm:grid-cols-[6rem_1fr_1fr_6rem] sm:items-end">
            <span className="text-[13px] font-medium">{o.name}</span>
            <Input label={t('btn.labels.tracking')} value={numbers[o.id] ?? ''} onChange={(e) => setNumbers({ ...numbers, [o.id]: e.target.value })} />
            <Input label={t('btn.labels.trackingUrl')} type="url" placeholder="https://" value={urls[o.id] ?? ''} onChange={(e) => setUrls({ ...urls, [o.id]: e.target.value })} />
            <Input label={t('btn.labels.cost')} inputMode="decimal" value={costs[o.id] ?? ''} onChange={(e) => setCosts({ ...costs, [o.id]: e.target.value })} />
          </li>
        ))}
      </ul>
      <div className="mt-3"><Checkbox label={t('btn.labels.notify')} checked={notify} onChange={(e) => setNotify(e.target.checked)} /></div>
    </Modal>
  );
}

export function ShippingLabelsPage() {
  const t = useT();
  const { lang } = useI18n();
  const fmt = useFormat();
  const toast = useToast();
  const { shop } = useShop();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = (['awaiting', 'labels', 'voided'].includes(params.get('tab') ?? '') ? params.get('tab') : 'awaiting') as Tab;
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<string[] | null>(null);
  const q = useQuery({ queryKey: ['shipping-labels', tab], queryFn: () => gql<PageData>(LABELS_PAGE, { status: tab === 'labels' ? 'ACTIVE' : tab === 'voided' ? 'VOIDED' : null }) });
  const awaiting = q.data?.shopmeOrdersAwaitingLabel ?? [];
  const wanted = useMemo(() => (params.get('orders') ?? '').split(',').filter(Boolean), [params]);
  // Arriving from the orders list ("Create shipping labels"): open the dialog for those orders that still need one.
  useEffect(() => {
    if (!wanted.length || !q.data) return;
    const ids = awaiting.filter((o) => wanted.includes(gidToNum(o.id))).map((o) => o.id);
    const next = new URLSearchParams(params); next.delete('orders'); setParams(next, { replace: true });
    if (ids.length) setDialog(ids); else toast(t('btn.labels.noneNeeded'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted.join(','), !!q.data]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['shipping-labels'] }).then(() => qc.invalidateQueries({ queryKey: ['orders'] }));
  const voidLabel = useMutation({
    mutationFn: (id: string) => mutate(LABEL_VOID, { id }, 'shopmeShippingLabelVoid'),
    onSuccess: () => { toast(t('btn.labels.voided')); void refresh(); }, onError: (e: Error) => toast(e.message, 'critical'),
  });
  const labels = (q.data?.shopmeShippingLabels ?? []).filter((l) => (tab === 'voided' ? l.status === 'VOIDED' : l.status === 'ACTIVE'));

  const awaitingCols: Array<Column<Awaiting>> = [
    { key: 'name', header: t('orders.order'), cell: (o) => <span className="font-medium">{o.name}</span> },
    { key: 'date', header: t('orders.date'), cell: (o) => fmt.date(o.createdAt) },
    { key: 'cust', header: t('orders.customer'), cell: (o) => o.customer?.displayName ?? <span className="text-muted">{t('orders.noCustomer')}</span> },
    { key: 'dest', header: t('btn.labels.destination'), cell: (o) => [o.shippingAddress?.city, o.shippingAddress?.country].filter(Boolean).join(', ') || '—' },
    { key: 'items', header: t('orders.items'), cell: (o) => o.lineItems.nodes.reduce((n, l) => n + l.quantity, 0) },
    { key: 'total', header: t('orders.total'), cell: (o) => fmt.money(o.totalPriceSet) },
    { key: 'act', header: '', className: 'text-right', cell: (o) => <Button size="sm" onClick={(e) => { e.stopPropagation(); setDialog([o.id]); }}>{t('btn.labels.add')}</Button> },
  ];
  const labelCols: Array<Column<Label>> = [
    { key: 'order', header: t('orders.order'), cell: (l) => <span className="font-medium">{l.orderName}</span> },
    { key: 'carrier', header: t('btn.labels.carrier'), cell: (l) => <>{l.carrier}{l.service && <span className="text-muted"> · {l.service}</span>}</> },
    { key: 'tracking', header: t('btn.labels.tracking'), cell: (l) => (l.trackingNumber ? (l.trackingUrl ? <a href={l.trackingUrl} target="_blank" rel="noreferrer" className="text-accent underline">{l.trackingNumber}</a> : l.trackingNumber) : <span className="text-muted">—</span>) },
    { key: 'cost', header: t('btn.labels.cost'), cell: (l) => (Number(l.cost) ? fmt.money({ amount: l.cost, currencyCode: shop.currency }) : <span className="text-muted">—</span>) },
    { key: 'date', header: t('orders.date'), cell: (l) => fmt.date(l.createdAt) },
    {
      key: 'act', header: '', className: 'text-right',
      cell: (l) => (
        <span className="inline-flex gap-1.5">
          <Button size="sm" onClick={() => { void printLabel(l, { shipTo: t('order.shippingAddress'), tracking: t('btn.labels.tracking'), contents: t('btn.labels.contents'), carrier: t('btn.labels.carrier') }, lang).then((ok) => { if (!ok) toast(t('order.printFailed'), 'critical'); }); }}><Printer className="size-3.5" />{t('btn.labels.print')}</Button>
          {l.status === 'ACTIVE' && <Button size="sm" onClick={() => voidLabel.mutate(l.id)} loading={voidLabel.isPending && voidLabel.variables === l.id}>{t('btn.labels.void')}</Button>}
        </span>
      ),
    },
  ];
  const dialogOrders = awaiting.filter((o) => dialog?.includes(o.id));

  return (
    <>
      <PageHeader back="/orders" icon={<Tag className="size-4" />} title={t('btn.labels.title')} />
      <Card className="!p-0">
        <div className="px-3 pt-1"><Tabs value={tab} onChange={(v) => { setSelected([]); setParams(v === 'awaiting' ? {} : { tab: v }, { replace: true }); }} tabs={[
          { id: 'awaiting', label: t('btn.labels.tabAwaiting', { n: q.data ? awaiting.length : '…' }) }, { id: 'labels', label: t('btn.labels.tabLabels') }, { id: 'voided', label: t('btn.labels.tabVoided') }]} /></div>
        {q.isError && <div className="p-3"><Banner>{(q.error as Error).message}</Banner></div>}
        {tab === 'awaiting' ? (
          <IndexTable
            rows={awaiting} rowId={(r) => r.id} columns={awaitingCols} loading={q.isLoading} selected={selected} onSelectedChange={setSelected}
            selectedLabel={(n) => t('common.selected', { n })} selectAllLabel={t('common.selectAll')} selectPageLabel={(n) => t('list.selectPage', { n })} deselectLabel={t('list.deselectAll')}
            bulkActions={[{ key: 'add', label: t('btn.labels.addMany'), onRun: (ids) => setDialog(ids) }]}
            empty={q.isError ? null : <EmptyState icon={<Package className="size-10" />} title={t('btn.labels.emptyAwaitingTitle')} description={t('btn.labels.emptyAwaitingBody')} />}
          />
        ) : (
          <IndexTable rows={labels} rowId={(r) => r.id} columns={labelCols} loading={q.isLoading}
            empty={q.isError ? null : <EmptyState icon={<Tag className="size-10" />} title={t(tab === 'voided' ? 'btn.labels.emptyVoidedTitle' : 'btn.labels.emptyLabelsTitle')} description={t('btn.labels.emptyLabelsBody')} />} />
        )}
      </Card>
      <p className="mt-3 text-center text-xs text-muted">{t('btn.labels.noPurchase')}</p>
      {dialog && dialogOrders.length > 0 && <LabelDialog orders={dialogOrders} onClose={() => setDialog(null)} onDone={() => { setSelected([]); void refresh(); }} />}
    </>
  );
}
