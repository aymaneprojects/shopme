import { Badge, Banner, Button, Card, ConfirmDialog, Dropdown, EmptyState, IndexTable, Input, ListToolbar, Modal, Pagination, Select, Skeleton, Textarea, Tooltip, useToast } from '@shopme/ui';
import type { Column } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, MoreHorizontal, Plus, Search, StickyNote } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { SaveBar, guard } from '../components/SaveBar';
import { UserErrors, gql, mutate } from '../api';
import { ColumnPicker, useColumnVisibility } from '../components/ColumnPicker';
import { NoteCard } from '../components/NoteCard';
import { PageHeader } from '../components/PageHeader';
import { searchCls, useFormat, useListParams } from '../components/shared';
import type { Money } from '../components/shared';
import { gidToNum, numToGid, parseDecimal } from '../format';
import {
  CUSTOMERS, GIFT_CARD, GIFT_CARDS, GIFT_CARD_CREATE, GIFT_CARD_CREDIT, GIFT_CARD_DEACTIVATE, GIFT_CARD_DEBIT, GIFT_CARD_SEND_TO_CUSTOMER, GIFT_CARD_SEND_TO_RECIPIENT, GIFT_CARD_UPDATE,
} from '../graphql';
import { useT } from '../i18n';
import type { Key } from '../i18n';
import { useDebounced } from '../lib/hooks';
import type { Connection } from '../lib/hooks';
import { generateCode } from '../lib/discount-form';
import { useShop } from '../session';
import emptyDiscounts from '../assets/empty/empty-discounts.webp';

interface Card_ {
  id: string; enabled: boolean; isRedeemable: boolean; expiresOn: string | null; createdAt: string; deactivatedAt: string | null; lastCharacters: string; maskedCode: string; note: string | null;
  balance: Money; initialValue: Money; customer: { id: string; displayName: string } | null; order: { id: string; name: string } | null;
  recipientAttributes?: { recipient: { id: string; displayName: string } } | null;
}
interface Detail extends Card_ {
  recipientAttributes: { message: string | null; preferredName: string | null; recipient: { id: string; displayName: string } } | null;
  transactions: { nodes: Array<{ __typename: string; id: string; amount: Money; note: string | null; processedAt: string }> } | null;
}

const PAGE_SIZE = 25;
const TABS = ['all', 'enabled', 'disabled', 'expired'] as const;
type Tab = (typeof TABS)[number];
const stateOf = (c: Card_) => (!c.enabled ? 'disabled' : c.expiresOn && new Date(c.expiresOn) < new Date() ? 'expired' : 'enabled');
const tone = { enabled: 'success', disabled: 'neutral', expired: 'warning' } as const;
const errText = (e: unknown) => (e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : (e as Error).message);

export function GiftCardsPage() {
  const t = useT();
  const nav = useNavigate();
  const fmt = useFormat();
  const L = useListParams();
  const cols = useColumnVisibility('gift-cards');
  const tab = (TABS.includes(L.get('tab') as Tab) ? L.get('tab') : 'all') as Tab;
  const [search, setSearch] = useState(L.get('q'));
  const term = useDebounced(search);
  const terms = [term.trim(), tab !== 'all' && `status:${tab}`].filter(Boolean).join(' ');
  const list = useQuery({
    queryKey: ['gift-cards', terms, L.get('after'), L.get('before')],
    queryFn: () => gql<{ giftCards: Connection<Card_> }>(GIFT_CARDS, { query: terms || null, sortKey: 'ID', reverse: true, ...L.page(PAGE_SIZE) }),
    placeholderData: (p) => p,
  });
  const rows = list.data?.giftCards.nodes ?? [];
  const pi = list.data?.giftCards.pageInfo;
  const create = <Button variant="primary" onClick={() => nav('/gift-cards/new')}>{t('giftCards.create')}</Button>;
  const columns: Array<Column<Card_>> = [
    { key: 'code', header: t('giftCards.codeEnding'), cell: (c) => <div><p className="flex items-center gap-1.5 font-medium">{c.lastCharacters}{c.note && <Tooltip content={c.note}><span tabIndex={0} aria-label={`${t('bp.giftCards.note')}: ${c.note}`} className="inline-grid size-5 place-items-center text-muted"><StickyNote className="size-3.5" /></span></Tooltip>}</p>{c.note && <p className="max-w-xs truncate text-xs text-muted">{c.note}</p>}</div> },
    { key: 'status', header: t('field.status'), cell: (c) => <Badge tone={tone[stateOf(c)]}>{t(`giftCards.state.${stateOf(c)}` as Key)}</Badge> },
    { key: 'customer', header: t('order.customer'), cell: (c) => c.customer?.displayName ?? <span className="text-muted">{c.order ? c.order.name : '—'}</span> },
    { key: 'recipient', header: t('giftCards.recipient'), cell: (c) => c.recipientAttributes?.recipient.displayName ?? <span className="text-muted">{t('giftCards.noRecipient')}</span> },
    { key: 'created', header: t('giftCards.created'), cell: (c) => <span className="text-muted">{fmt.dateTime(c.createdAt)}</span> },
    { key: 'balance', header: t('giftCards.currentInitial'), className: 'text-right', cell: (c) => <span className="whitespace-nowrap">{fmt.money(c.balance)} <span className="text-muted">/ {fmt.money(c.initialValue)}</span></span> },
  ];
  const exportCsv = useMutation({
    mutationFn: async () => {
      const r = await gql<{ giftCards: Connection<Card_> }>(GIFT_CARDS, { query: terms || null, sortKey: 'ID', reverse: true, first: 250 });
      const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
      const lines = [['Code ending', 'Status', 'Customer', 'Recipient', 'Created', 'Expires', 'Balance', 'Initial value', 'Currency'].map(esc).join(',')];
      for (const c of r.giftCards.nodes) lines.push([c.lastCharacters, stateOf(c), c.customer?.displayName ?? '', c.recipientAttributes?.recipient.displayName ?? '', c.createdAt, c.expiresOn ?? '', c.balance.amount, c.initialValue.amount, c.balance.currencyCode].map((x) => esc(String(x))).join(','));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
      a.download = 'gift-cards.csv'; a.click(); URL.revokeObjectURL(a.href);
    },
  });
  return (
    <>
      <PageHeader icon={<Gift className="size-4" />} title={t('nav.giftCards')} actions={<>
        <Button onClick={() => nav('/products/new?giftCard=1')}>{t('giftCards.addProduct')}</Button>
        <Button onClick={() => nav('/products?q=gift_card:true')}>{t('giftCards.viewProducts')}</Button>
        <Button loading={exportCsv.isPending} onClick={() => exportCsv.mutate()}>{t('csv.export')}</Button>
        {create}</>} />
      <Card className="!p-0">
        <ListToolbar
          className="!rounded-b-none !shadow-none border-b border-line" viewsLabel={t('list.views')}
          views={TABS.map((id) => ({ id, label: t(`giftCards.tab.${id}` as Key) }))} view={tab} onView={(v) => L.patch({ tab: v === 'all' ? '' : v })}
          query={search} onQuery={(v) => { setSearch(v); L.patch({ q: v }); }} placeholder={t('list.searchAndFilter')}
          trailing={<ColumnPicker locked={['code']} columns={columns} hidden={cols.hidden} onToggle={cols.toggle} />}
        />
        {list.isError && <div className="p-3"><Banner>{(list.error as Error).message}</Banner></div>}
        <IndexTable rows={rows} rowId={(r) => r.id} columns={cols.filter(columns)} loading={list.isLoading} onRowClick={(r) => nav(`/gift-cards/${gidToNum(r.id)}`)}
          selected={[]} onSelectedChange={() => {}} selectedLabel={(n) => t('common.selected', { n })} selectAllLabel={t('common.selectAll')}
          empty={list.isError ? null : terms
            ? <EmptyState icon={<Search className="size-10" />} title={t('products.noResults')} description={t('products.noResultsBody')} />
            : <EmptyState image={emptyDiscounts} title={t('giftCards.emptyTitle')} description={t('giftCards.emptyBody')} action={create} />} />
        <Pagination hasPrevious={L.get('before') ? !!pi?.hasPreviousPage : !!L.get('after')} hasNext={L.get('before') ? true : !!pi?.hasNextPage}
          previousLabel={t('common.previous')} nextLabel={t('common.next')}
          onPrevious={() => L.patch({ before: pi?.startCursor ?? '', after: '' }, true)} onNext={() => L.patch({ after: pi?.endCursor ?? '', before: '' }, true)} />
      </Card>
    </>
  );
}

export function GiftCardEditPage() {
  const { id = 'new' } = useParams();
  const t = useT();
  const gid = numToGid('GiftCard', id);
  const q = useQuery({ queryKey: ['gift-card', gid], enabled: id !== 'new', queryFn: () => gql<{ giftCard: Detail | null }>(GIFT_CARD, { id: gid }) });
  if (id === 'new') return <IssueForm />;
  if (q.isLoading) return <div className="grid gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64" /></div>;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  if (!q.data?.giftCard) return <Banner>{t('giftCards.notFound')}</Banner>;
  return <CardView key={q.dataUpdatedAt} card={q.data.giftCard} />;
}

interface CustomerHit { id: string; displayName: string; defaultEmailAddress: { emailAddress: string } | null }
/** Search-as-you-type customer field with a "create customer" shortcut. */
function CustomerSearch({ value, onPick, onClear }: { value: { id: string; name: string } | null; onPick: (c: { id: string; name: string }) => void; onClear: () => void }) {
  const t = useT();
  const [search, setSearch] = useState('');
  const term = useDebounced(search).trim();
  const hits = useQuery({ queryKey: ['gift-customers', term], enabled: term.length > 0, queryFn: () => gql<{ customers: { nodes: CustomerHit[] } }>(CUSTOMERS, { query: term, first: 6, sortKey: 'NAME' }) });
  if (value) return <div className="flex items-center gap-2 text-[13px]"><span className="flex-1 font-medium">{value.name}</span><Button size="sm" onClick={onClear}>{t('common.remove')}</Button></div>;
  return (
    <div className="flex flex-col gap-1">
      <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted" /><input type="search" className={searchCls} placeholder={t('giftCards.customerSearch')} aria-label={t('giftCards.customerSearch')} value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      {term && (
        <ul className="rounded-md border border-line text-[13px]">
          {(hits.data?.customers.nodes ?? []).map((c) => <li key={c.id}><button type="button" className="w-full px-2 py-1.5 text-left hover:bg-surface" onClick={() => onPick({ id: c.id, name: c.displayName })}>{c.displayName}{c.defaultEmailAddress && <span className="text-muted"> · {c.defaultEmailAddress.emailAddress}</span>}</button></li>)}
          <li><Link to="/customers/new" className="block px-2 py-1.5 text-accent hover:bg-surface">{t('giftCards.createCustomer')}</Link></li>
        </ul>
      )}
    </div>
  );
}

function IssueForm() {
  const t = useT();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { shop } = useShop();
  const initial = useState(() => ({ amount: '', code: generateCode(16).toLowerCase(), expiresOn: '', note: '', customer: null as { id: string; name: string } | null }))[0];
  const [f, setF] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ id: string; code: string } | null>(null);
  const amount = parseDecimal(f.amount);
  const save = useMutation({
    mutationFn: async () => {
      if (!amount || amount <= 0) throw new Error(t('giftCards.amountRequired'));
      const r = await mutate<{ giftCard: { id: string }; giftCardCode: string }>(GIFT_CARD_CREATE, {
        input: { initialAmount: { amount: amount.toFixed(2), currencyCode: shop.currency }, code: f.code.trim() || null, expiresOn: f.expiresOn || null, note: f.note.trim() || null, customerId: f.customer?.id ?? null },
      }, 'giftCardCreate');
      return { id: r.giftCard.id, code: r.giftCardCode };
    },
    onSuccess: (r) => { guard.off = true; setIssued(r); void qc.invalidateQueries({ queryKey: ['gift-cards'] }); },
    onError: (e) => setError(errText(e)),
  });
  const [dated, setDated] = useState(false);
  return (
    <>
      <SaveBar dirty={!issued} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => { setF(initial); setDated(false); setError(null); }} />
      <PageHeader back="/gift-cards" title={t('giftCards.issue')} />
      {error && <div className="mb-4"><Banner>{error}</Banner></div>}
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card title={t('giftCards.details')}>
          <div className="flex flex-col gap-3">
            <Input label={t('giftCards.code')} help={t('giftCards.codeHelp')} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toLowerCase() })} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label={`${t('giftCards.initialValue')} (${shop.currency})`} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
              <div className="flex flex-col gap-1">
                <span className="text-[13px] font-medium">{t('giftCards.expiresOn')}</span>
                {dated ? <div className="flex items-center gap-2"><input type="date" aria-label={t('giftCards.expiresOn')} className="field-control" value={f.expiresOn} onChange={(e) => setF({ ...f, expiresOn: e.target.value })} /><Button size="sm" onClick={() => { setDated(false); setF({ ...f, expiresOn: '' }); }}>{t('common.remove')}</Button></div>
                  : <Button className="w-fit" onClick={() => setDated(true)}>{t('giftCards.noExpiry')}</Button>}
                <p className="text-xs text-muted">{t('giftCards.expiresHelp')}</p>
              </div>
            </div>
          </div>
        </Card>
        <div className="flex flex-col gap-4">
          <Card title={t('order.customer')}><CustomerSearch value={f.customer} onPick={(customer) => setF({ ...f, customer })} onClear={() => setF({ ...f, customer: null })} /></Card>
          <NoteCard title={t('giftCards.note')} value={f.note} placeholder={t('giftCards.noteHelp')} onSave={(note) => setF({ ...f, note })} />
        </div>
      </div>
      <Modal open={!!issued} onClose={() => issued && nav(`/gift-cards/${gidToNum(issued.id)}`, { replace: true })} title={t('giftCards.issuedTitle')} closeLabel={t('common.close')}
        footer={<Button variant="primary" onClick={() => issued && nav(`/gift-cards/${gidToNum(issued.id)}`, { replace: true })}>{t('common.close')}</Button>}>
        <p className="mb-2 text-[13px] text-muted">{t('giftCards.issuedBody')}</p>
        <p className="select-all rounded-md bg-surface p-3 text-center font-mono text-lg tracking-widest">{(issued?.code ?? '').toUpperCase().replace(/(.{4})(?=.)/g, '$1-')}</p>
      </Modal>
    </>
  );
}

function CardView({ card: c }: { card: Detail }) {
  const t = useT();
  const fmt = useFormat();
  const toast = useToast();
  const qc = useQueryClient();
  const { shop } = useShop();
  const [adjust, setAdjust] = useState<{ kind: 'credit' | 'debit'; amount: string; note: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [expires, setExpires] = useState(c.expiresOn ?? '');
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['gift-card'] }); void qc.invalidateQueries({ queryKey: ['gift-cards'] }); };
  const fail = (e: Error) => toast(errText(e), 'critical');
  const state = stateOf(c);

  const save = useMutation({
    mutationFn: (n?: string) => mutate(GIFT_CARD_UPDATE, { id: c.id, input: { note: (n ?? c.note ?? '').trim() || null, expiresOn: expires || null } }, 'giftCardUpdate'),
    onSuccess: () => { toast(t('giftCards.saved')); refresh(); }, onError: fail,
  });
  const off = useMutation({ mutationFn: () => mutate(GIFT_CARD_DEACTIVATE, { id: c.id }, 'giftCardDeactivate'), onSuccess: () => { setConfirm(false); toast(t('giftCards.deactivated')); refresh(); }, onError: fail });
  const send = useMutation({
    mutationFn: () => (c.recipientAttributes ? mutate(GIFT_CARD_SEND_TO_RECIPIENT, { id: c.id }, 'giftCardSendNotificationToRecipient') : mutate(GIFT_CARD_SEND_TO_CUSTOMER, { id: c.id }, 'giftCardSendNotificationToCustomer')),
    onSuccess: () => toast(t('giftCards.sent')), onError: fail,
  });
  const adj = useMutation({
    mutationFn: async () => {
      const a = adjust!;
      const money = { amount: (parseDecimal(a.amount) ?? 0).toFixed(2), currencyCode: shop.currency };
      if (a.kind === 'credit') await mutate(GIFT_CARD_CREDIT, { id: c.id, creditInput: { creditAmount: money, note: a.note.trim() || null } }, 'giftCardCredit');
      else await mutate(GIFT_CARD_DEBIT, { id: c.id, debitInput: { debitAmount: money, note: a.note.trim() || null } }, 'giftCardDebit');
    },
    onSuccess: () => { setAdjust(null); toast(t('giftCards.adjusted')); refresh(); }, onError: fail,
  });
  const txs = [...(c.transactions?.nodes ?? [])].sort((a, b) => b.processedAt.localeCompare(a.processedAt));
  const canSend = c.enabled && (!!c.recipientAttributes || !!c.customer || !!c.order);
  const amountOk = (parseDecimal(adjust?.amount ?? '') ?? 0) > 0;

  return (
    <>
      <PageHeader back="/gift-cards" title={<span className="flex items-center gap-2">{c.maskedCode}<Badge tone={tone[state]}>{t(`giftCards.state.${state}` as Key)}</Badge></span>}
        actions={<>
          <Button disabled={!c.enabled} onClick={() => setAdjust({ kind: 'credit', amount: '', note: '' })}>{t('giftCards.adjust')}</Button>
          <Dropdown align="right" label={t('common.moreActions')} trigger={<MoreHorizontal className="size-4" />} items={[
            { key: 'send', label: t('giftCards.send'), disabled: !canSend, onSelect: () => send.mutate() },
            { key: 'off', label: t('giftCards.deactivate'), danger: true, disabled: !c.enabled, onSelect: () => setConfirm(true) },
          ]} />
        </>} />
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-4">
          <Card title={t('giftCards.balance')}>
            <p className="text-3xl font-semibold">{fmt.money(c.balance)}</p>
            <p className="text-[13px] text-muted">{t('giftCards.ofInitial', { amount: fmt.money(c.initialValue) })}</p>
          </Card>
          <Card title={t('giftCards.transactions')}>
            <ul className="divide-y divide-line text-[13px]">
              {txs.map((x) => {
                const credit = x.__typename === 'GiftCardCreditTransaction';
                return (
                  <li key={x.id} className="flex items-center gap-3 py-2">
                    <Badge tone={credit ? 'success' : 'neutral'}>{t(credit ? 'giftCards.credit' : 'giftCards.debit')}</Badge>
                    <span className="flex-1 text-muted">{x.note ?? '—'}</span>
                    <span className="text-muted">{fmt.dateTime(x.processedAt)}</span>
                    <span className="w-24 text-right font-medium">{credit ? '+' : '−'}{fmt.money(x.amount)}</span>
                  </li>
                );
              })}
              {txs.length === 0 && <li className="py-2 text-muted">{t('giftCards.noTransactions')}</li>}
            </ul>
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card title={t('giftCards.details')}>
            <div className="flex flex-col gap-3">
              <Input type="date" label={t('giftCards.expiresOn')} value={expires} onChange={(e) => setExpires(e.target.value)} />
              <div className="flex justify-end"><Button size="sm" disabled={expires === (c.expiresOn ?? '')} loading={save.isPending} onClick={() => save.mutate(undefined)}>{t('save.save')}</Button></div>
            </div>
          </Card>
          <NoteCard title={t('giftCards.note')} value={c.note ?? ''} placeholder={t('giftCards.noteHelp')} onSave={(n) => save.mutateAsync(n)} />
          <Card title={t('giftCards.origin')}>
            <div className="flex flex-col gap-1 text-[13px]">
              {c.order ? <Link className="text-accent hover:underline" to={`/orders/${gidToNum(c.order.id)}`}>{t('giftCards.fromOrder', { name: c.order.name })}</Link> : <span className="text-muted">{t('giftCards.manual')}</span>}
              {c.customer && <Link className="text-accent hover:underline" to={`/customers/${gidToNum(c.customer.id)}`}>{c.customer.displayName}</Link>}
              {c.recipientAttributes && <p>{t('giftCards.recipient')}: {c.recipientAttributes.preferredName ?? c.recipientAttributes.recipient.displayName}{c.recipientAttributes.message && <span className="block text-muted">“{c.recipientAttributes.message}”</span>}</p>}
              <span className="text-muted">{t('giftCards.issuedOn')}: {fmt.date(c.createdAt)}</span>
            </div>
          </Card>
        </div>
      </div>
      <Modal open={!!adjust} onClose={() => setAdjust(null)} title={t('giftCards.adjust')} closeLabel={t('common.close')}
        footer={<><Button onClick={() => setAdjust(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={adj.isPending} disabled={!amountOk} onClick={() => adj.mutate()}>{t('giftCards.adjustConfirm')}</Button></>}>
        {adjust && (
          <div className="flex flex-col gap-3">
            <Select label={t('giftCards.adjustType')} value={adjust.kind} onChange={(e) => setAdjust({ ...adjust, kind: e.target.value as 'credit' | 'debit' })}>
              <option value="credit">{t('giftCards.credit')}</option><option value="debit">{t('giftCards.debit')}</option>
            </Select>
            <Input label={`${t('giftCards.amount')} (${shop.currency})`} inputMode="decimal" value={adjust.amount} onChange={(e) => setAdjust({ ...adjust, amount: e.target.value })} />
            <Input label={t('giftCards.reason')} value={adjust.note} onChange={(e) => setAdjust({ ...adjust, note: e.target.value })} />
          </div>
        )}
      </Modal>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} danger title={t('giftCards.deactivateTitle')} message={t('giftCards.deactivateBody')} confirmLabel={t('giftCards.deactivate')} cancelLabel={t('common.cancel')} onConfirm={() => off.mutate()} />
    </>
  );
}
