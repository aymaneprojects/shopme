import { Banner, Button, Modal, Select, Skeleton, TagInput, Textarea, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { gql, mutate } from '../api';
import { COMPANY_ADD_CUSTOMERS, COMPANY_PICKER, CUSTOMER_BULK_UPDATE, CUSTOMER_MERGE, CUSTOMER_MERGE_PREVIEW, CUSTOMER_PICKER } from '../graphql';
import { useI18n } from '../i18n';
import { useDebounced } from '../lib/hooks';
import { searchCls } from './shared';

const invalidate = (qc: ReturnType<typeof useQueryClient>) => { for (const k of ['customers', 'customer', 'customers-count', 'companies', 'company']) void qc.invalidateQueries({ queryKey: [k] }); };

/* ------------------------------ edit in bulk ------------------------------ */

interface BulkState { addTags: string[]; removeTags: string[]; tax: '' | 'exempt' | 'collect'; email: '' | 'SUBSCRIBE' | 'UNSUBSCRIBE'; sms: '' | 'SUBSCRIBE' | 'UNSUBSCRIBE'; noteMode: '' | 'APPEND' | 'REPLACE' | 'CLEAR'; note: string }
const blank: BulkState = { addTags: [], removeTags: [], tax: '', email: '', sms: '', noteMode: '', note: '' };

/** One dialog to change tags, marketing consent, tax exemption and notes of every selected customer. */
export function BulkEditDialog({ open, ids, onClose, onDone }: { open: boolean; ids: string[]; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [s, setS] = useState(blank);
  const [problems, setProblems] = useState<string[]>([]);
  const set = (p: Partial<BulkState>) => setS((x) => ({ ...x, ...p }));
  const empty = !s.addTags.length && !s.removeTags.length && !s.tax && !s.email && !s.sms && !s.noteMode;
  const needsNote = (s.noteMode === 'APPEND' || s.noteMode === 'REPLACE') && !s.note.trim();
  const close = () => { setS(blank); setProblems([]); onClose(); };
  const save = useMutation({
    mutationFn: () => mutate<{ updatedCount: number; failures: Array<{ customerId: string; message: string }> }>(CUSTOMER_BULK_UPDATE, {
      ids, input: {
        ...(s.addTags.length && { addTags: s.addTags }), ...(s.removeTags.length && { removeTags: s.removeTags }), ...(s.tax && { taxExempt: s.tax === 'exempt' }),
        ...(s.email && { emailMarketing: s.email }), ...(s.sms && { smsMarketing: s.sms }), ...(s.noteMode && { noteMode: s.noteMode, note: s.note }),
      },
    }, 'shopmeCustomerBulkUpdate'),
    onSuccess: (r) => {
      invalidate(qc);
      toast(t('bc.bulk.done', { n: r.updatedCount }));
      if (r.failures.length) { setProblems([...new Set(r.failures.map((f) => f.message))]); onDone(); return; }
      setS(blank); onDone(); onClose();
    },
    onError: (e) => toast(e.message, 'critical'),
  });
  return (
    <Modal open={open} onClose={close} medium title={t('bc.bulk.title', { n: ids.length })} closeLabel={t('common.close')}
      footer={<><Button onClick={close}>{t('common.cancel')}</Button><Button variant="primary" loading={save.isPending} disabled={empty || needsNote} onClick={() => save.mutate()}>{t('bc.bulk.apply')}</Button></>}>
      <div className="flex flex-col gap-3 text-[13px]">
        {problems.length > 0 && <Banner tone="warning">{t('bc.bulk.failed')} {problems.join(' · ')}</Banner>}
        <div><p className="mb-1 font-medium">{t('bc.bulk.addTags')}</p><TagInput value={s.addTags} onChange={(addTags) => set({ addTags })} removeLabel={t('common.remove')} /></div>
        <div><p className="mb-1 font-medium">{t('bc.bulk.removeTags')}</p><TagInput value={s.removeTags} onChange={(removeTags) => set({ removeTags })} removeLabel={t('common.remove')} /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={t('bc.bulk.email')} value={s.email} onChange={(e) => set({ email: e.target.value as BulkState['email'] })}>
            <option value="">{t('bc.bulk.noChange')}</option><option value="SUBSCRIBE">{t('bc.bulk.subscribe')}</option><option value="UNSUBSCRIBE">{t('bc.bulk.unsubscribe')}</option>
          </Select>
          <Select label={t('bc.bulk.sms')} value={s.sms} onChange={(e) => set({ sms: e.target.value as BulkState['sms'] })}>
            <option value="">{t('bc.bulk.noChange')}</option><option value="SUBSCRIBE">{t('bc.bulk.subscribe')}</option><option value="UNSUBSCRIBE">{t('bc.bulk.unsubscribe')}</option>
          </Select>
        </div>
        <Select label={t('bc.bulk.tax')} help={t('bc.bulk.taxHelp')} value={s.tax} onChange={(e) => set({ tax: e.target.value as BulkState['tax'] })}>
          <option value="">{t('bc.bulk.noChange')}</option><option value="exempt">{t('customer.taxExempt')}</option><option value="collect">{t('qaf.customer.collectTax')}</option>
        </Select>
        <Select label={t('order.notes')} value={s.noteMode} onChange={(e) => set({ noteMode: e.target.value as BulkState['noteMode'] })}>
          <option value="">{t('bc.bulk.noChange')}</option><option value="APPEND">{t('bc.bulk.noteAppend')}</option><option value="REPLACE">{t('bc.bulk.noteReplace')}</option><option value="CLEAR">{t('bc.bulk.noteClear')}</option>
        </Select>
        {(s.noteMode === 'APPEND' || s.noteMode === 'REPLACE') && <Textarea aria-label={t('order.notes')} value={s.note} onChange={(e) => set({ note: e.target.value })} />}
        <p className="text-muted">{t('bc.bulk.help')}</p>
      </div>
    </Modal>
  );
}

/* ------------------------------ merge ------------------------------ */

interface MergeCustomer { id: string; displayName: string; firstName: string | null; lastName: string | null; defaultEmailAddress: { emailAddress: string } | null; defaultPhoneNumber: { phoneNumber: string } | null; numberOfOrders: number }
interface MergePreview {
  resultingCustomerId: string; blockers: string[]; customerOne: MergeCustomer; customerTwo: MergeCustomer;
  fields: { firstName: string | null; lastName: string | null; email: string | null; phone: string | null; tags: string[]; note: string | null; defaultAddress: { address1: string | null; city: string | null; country: string | null } | null };
  moves: { orders: number; draftOrders: number; addresses: number; storeCreditAccounts: number; giftCards: number; timelineEvents: number; companyContacts: number };
}
type Field = 'first' | 'last' | 'email' | 'phone';

/**
 * Merge two customers. The one you keep stays; the other is merged into it and deleted: its orders, drafts, addresses, tags, notes, store credit,
 * gift cards and timeline move over. For each contact field you pick which customer's value the merged customer gets.
 */
export function MergeDialog({ open, ids, onClose, onDone }: { open: boolean; ids: [string, string]; onClose: () => void; onDone: (resultingId: string) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [keepFirst, setKeepFirst] = useState(true);
  const [pick, setPick] = useState<Partial<Record<Field, 'keep' | 'other'>>>({});
  const keepId = keepFirst ? ids[0] : ids[1], otherId = keepFirst ? ids[1] : ids[0];
  const override = (p: Partial<Record<Field, 'keep' | 'other'>>) => {
    const id = (f: Field) => (p[f] === 'other' ? otherId : p[f] === 'keep' ? keepId : undefined);
    return { customerIdOfFirstNameToKeep: id('first'), customerIdOfLastNameToKeep: id('last'), customerIdOfEmailToKeep: id('email'), customerIdOfPhoneNumberToKeep: id('phone') };
  };
  const q = useQuery({
    queryKey: ['customer-merge-preview', otherId, keepId, pick], enabled: open,
    queryFn: async () => (await gql<{ shopmeCustomerMergePreview: MergePreview | null }>(CUSTOMER_MERGE_PREVIEW, { a: otherId, b: keepId, o: override(pick) })).shopmeCustomerMergePreview,
  });
  const p = q.data;
  const merge = useMutation({
    mutationFn: () => mutate<{ resultingCustomerId: string }>(CUSTOMER_MERGE, { a: otherId, b: keepId, o: override(pick) }, 'customerMerge'),
    onSuccess: (r) => { invalidate(qc); toast(t('bc.merge.done')); onDone(r.resultingCustomerId); },
    onError: (e) => toast(e.message, 'critical'),
  });
  const keep = p?.customerTwo, other = p?.customerOne;
  const row = (label: string, f: Field, a: string | null | undefined, b: string | null | undefined) => (
    <tr key={f} className="border-t border-line align-top">
      <th scope="row" className="py-2 pr-3 text-left font-medium">{label}</th>
      {([['keep', a], ['other', b]] as const).map(([side, v]) => (
        <td key={side} className="py-2 pr-3">
          <label className="inline-flex items-start gap-2"><input type="radio" name={`merge-${f}`} checked={(pick[f] ?? (a ? 'keep' : 'other')) === side} onChange={() => setPick({ ...pick, [f]: side })} className="mt-0.5" /><span className={v ? '' : 'text-muted'}>{v || '—'}</span></label>
        </td>
      ))}
    </tr>
  );
  const moved = p ? ([['orders', p.moves.orders], ['draftOrders', p.moves.draftOrders], ['addresses', p.moves.addresses], ['storeCreditAccounts', p.moves.storeCreditAccounts], ['giftCards', p.moves.giftCards], ['timelineEvents', p.moves.timelineEvents]] as const).filter(([, n]) => n > 0) : [];
  return (
    <Modal open={open} onClose={onClose} wide title={t('bc.merge.title')} closeLabel={t('common.close')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={merge.isPending} disabled={!p || p.blockers.length > 0} onClick={() => merge.mutate()}>{t('bc.merge.confirm')}</Button></>}>
      {q.isLoading ? <Skeleton className="h-40" /> : q.error || !p ? <Banner>{(q.error as Error | null)?.message ?? t('customers.notFound')}</Banner> : (
        <div className="flex flex-col gap-4 text-[13px]">
          {p.blockers.length > 0 && <Banner>{t(p.blockers.includes('ERASED_CUSTOMER') ? 'bc.merge.blockedErased' : 'bc.merge.blockedErasure')}</Banner>}
          <p className="text-muted">{t('bc.merge.intro')}</p>
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="mb-1 font-medium">{t('bc.merge.keep')}</legend>
            {([[true, ids[0]], [false, ids[1]]] as const).map(([isFirst, id]) => {
              const c = id === keep?.id ? keep : other;
              return (
                <label key={id} className="flex items-start gap-2 rounded-lg border border-line p-3">
                  <input type="radio" name="merge-keep" checked={keepFirst === isFirst} onChange={() => { setKeepFirst(isFirst); setPick({}); }} className="mt-0.5" />
                  <span><span className="block font-medium">{c?.displayName ?? '…'}</span><span className="block text-muted">{c?.defaultEmailAddress?.emailAddress ?? '—'} · {t('customers.orderCount', { n: c?.numberOfOrders ?? 0 })}</span></span>
                </label>
              );
            })}
          </fieldset>
          {keep && other && (
            <table className="w-full">
              <thead><tr className="text-left text-muted"><th /><th className="pb-1 font-normal">{t('bc.merge.keptValue')}</th><th className="pb-1 font-normal">{t('bc.merge.otherValue')}</th></tr></thead>
              <tbody>
                {row(t('field.firstName'), 'first', keep.firstName, other.firstName)}
                {row(t('field.lastName'), 'last', keep.lastName, other.lastName)}
                {row(t('field.email'), 'email', keep.defaultEmailAddress?.emailAddress, other.defaultEmailAddress?.emailAddress)}
                {row(t('customer.phone'), 'phone', keep.defaultPhoneNumber?.phoneNumber, other.defaultPhoneNumber?.phoneNumber)}
              </tbody>
            </table>
          )}
          <div className="rounded-lg bg-surface p-3">
            <p className="mb-1 font-medium">{t('bc.merge.result')}</p>
            <p>{[p.fields.firstName, p.fields.lastName].filter(Boolean).join(' ') || p.fields.email || '—'}{p.fields.email ? ` · ${p.fields.email}` : ''}{p.fields.phone ? ` · ${p.fields.phone}` : ''}</p>
            <p className="text-muted">{t('field.tags')}: {p.fields.tags.join(', ') || '—'}</p>
            {p.fields.note && <p className="line-clamp-2 whitespace-pre-wrap text-muted">{t('order.notes')}: {p.fields.note}</p>}
            {moved.length > 0 && <ul className="mt-2 list-disc pl-5 text-muted">{moved.map(([k, n]) => <li key={k}>{t(`bc.merge.moves.${k}`, { n })}</li>)}</ul>}
          </div>
          <Banner tone="warning">{t('bc.merge.warning')}</Banner>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------ pick one customer ------------------------------ */

/** Search the customers and pick one (used to choose the second customer of a merge). */
export function CustomerSearchDialog({ open, title, excludeId, onClose, onPick }: { open: boolean; title: string; excludeId?: string; onClose: () => void; onPick: (id: string) => void }) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const term = useDebounced(search).trim();
  const q = useQuery({
    queryKey: ['customer-picker', term], enabled: open, placeholderData: (p) => p,
    queryFn: async () => (await gql<{ customers: { nodes: Array<{ id: string; displayName: string; numberOfOrders: number; defaultEmailAddress: { emailAddress: string } | null }> } }>(CUSTOMER_PICKER, { query: term || null })).customers.nodes,
  });
  const rows = (q.data ?? []).filter((c) => c.id !== excludeId);
  return (
    <Modal open={open} onClose={onClose} title={title} closeLabel={t('common.close')} footer={<Button onClick={onClose}>{t('common.cancel')}</Button>}>
      <div className="relative mb-2"><Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted" /><input type="search" autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('customers.search')} aria-label={t('customers.search')} className={searchCls} /></div>
      <ul className="max-h-72 divide-y divide-line overflow-y-auto text-[13px]">
        {rows.map((c) => (
          <li key={c.id}><button type="button" className="flex w-full items-center gap-3 px-2 py-2 text-left hover:bg-surface" onClick={() => onPick(c.id)}><span className="font-medium">{c.displayName}</span><span className="text-muted">{c.defaultEmailAddress?.emailAddress}</span><span className="ml-auto text-muted">{t('customers.orderCount', { n: c.numberOfOrders })}</span></button></li>
        ))}
        {!q.isLoading && rows.length === 0 && <li className="py-3 text-center text-muted">{t('picker.none')}</li>}
      </ul>
    </Modal>
  );
}

/* ------------------------------ add to company ------------------------------ */

/** Pick a company and make the customers contacts of it. */
export function AddToCompanyDialog({ open, ids, onClose, onDone }: { open: boolean; ids: string[]; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const term = useDebounced(search).trim();
  const q = useQuery({
    queryKey: ['company-picker', term], enabled: open, placeholderData: (p) => p,
    queryFn: async () => (await gql<{ companies: { nodes: Array<{ id: string; name: string }> } }>(COMPANY_PICKER, { query: term || null })).companies.nodes,
  });
  const add = useMutation({
    mutationFn: (company: string) => mutate<{ addedCount: number; failures: Array<{ message: string }> }>(COMPANY_ADD_CUSTOMERS, { company, ids }, 'shopmeCompanyAddCustomers'),
    onSuccess: (r) => { invalidate(qc); toast(r.failures.length ? t('bc.company.addedSome', { n: r.addedCount, failed: r.failures.length }) : t('bc.company.added', { n: r.addedCount })); onDone(); onClose(); },
    onError: (e) => toast(e.message, 'critical'),
  });
  return (
    <Modal open={open} onClose={onClose} title={t('bc.company.addTitle', { n: ids.length })} closeLabel={t('common.close')} footer={<Button onClick={onClose}>{t('common.cancel')}</Button>}>
      <div className="relative mb-2"><Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted" /><input type="search" autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('bc.company.search')} aria-label={t('bc.company.search')} className={searchCls} /></div>
      <ul className="max-h-72 divide-y divide-line overflow-y-auto text-[13px]">
        {(q.data ?? []).map((c) => <li key={c.id}><button type="button" disabled={add.isPending} className="w-full px-2 py-2 text-left hover:bg-surface" onClick={() => add.mutate(c.id)}>{c.name}</button></li>)}
        {!q.isLoading && (q.data ?? []).length === 0 && <li className="py-3 text-center text-muted">{t('bc.company.none')}</li>}
      </ul>
    </Modal>
  );
}
