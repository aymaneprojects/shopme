import { Banner, Button, Modal, Select, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { gql, mutate } from '../api';
import { gidToNum } from '../format';
import { COMPANY_PICKER, DRAFT_COMPANY, DRAFT_SET_COMPANY, ORDER_COMPANY } from '../graphql';
import { useI18n } from '../i18n';
import { useDebounced } from '../lib/hooks';
import { SideSection } from './OrderChrome';
import { searchCls } from './shared';

interface Entity { company: { id: string; name: string } | null; contact: { id: string; customer: { displayName: string } } | null; location: { id: string; name: string } | null }

/** The B2B company, contact and location of a draft order, with a dialog to change them. Hidden once the draft is completed and has no company. */
export function DraftCompanySection({ draftId, locked }: { draftId: string; locked: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['draft-company', draftId], queryFn: async () => (await gql<{ draftOrder: { shopmePurchasingCompany: Entity | null } | null }>(DRAFT_COMPANY, { id: draftId })).draftOrder?.shopmePurchasingCompany ?? null });
  const set = useMutation({
    mutationFn: (v: { company?: string; contact?: string; location?: string }) => mutate(DRAFT_SET_COMPANY, { draft: draftId, ...v }, 'shopmeDraftOrderSetCompany'),
    onSuccess: () => { setOpen(false); void qc.invalidateQueries({ queryKey: ['draft-company', draftId] }); void qc.invalidateQueries({ queryKey: ['draft'] }); void qc.invalidateQueries({ queryKey: ['company'] }); toast(t('bc.draft.saved')); },
    onError: (e) => toast(e.message, 'critical'),
  });
  const e = q.data;
  if (locked && !e) return null;
  return (
    <>
      <SideSection title={t('bc.companies')} action={!locked && <button type="button" className="btn btn-plain btn-icon btn-sm" aria-label={t('bc.draft.change')} onClick={() => setOpen(true)}><Pencil className="size-4" /></button>}>
        {e?.company ? (
          <div className="flex flex-col gap-0.5 text-[13px]">
            <Link to={`/customers/companies/${gidToNum(e.company.id)}`} className="text-accent hover:underline">{e.company.name}</Link>
            {e.location && <span className="text-muted">{e.location.name}</span>}
            {e.contact && <span className="text-muted">{e.contact.customer.displayName}</span>}
            {!locked && <button type="button" className="mt-1 w-fit text-accent hover:underline" onClick={() => set.mutate({})}>{t('bc.draft.remove')}</button>}
          </div>
        ) : <p className="text-[13px] text-muted">{t('bc.draft.none')}</p>}
      </SideSection>
      {open && <CompanyPickDialog onClose={() => setOpen(false)} saving={set.isPending} onSave={(v) => set.mutate(v)} />}
    </>
  );
}

interface Pick { id: string; name: string; contacts: { nodes: Array<{ id: string; customer: { displayName: string } }> }; locations: { nodes: Array<{ id: string; name: string }> } }

function CompanyPickDialog({ onClose, onSave, saving }: { onClose: () => void; onSave: (v: { company: string; contact?: string; location?: string }) => void; saving: boolean }) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const term = useDebounced(search).trim();
  const [company, setCompany] = useState<Pick | null>(null);
  const [contact, setContact] = useState('');
  const [location, setLocation] = useState('');
  const q = useQuery({ queryKey: ['company-picker', term], placeholderData: (p) => p, queryFn: async () => (await gql<{ companies: { nodes: Pick[] } }>(COMPANY_PICKER, { query: term || null })).companies.nodes });
  return (
    <Modal open onClose={onClose} title={t('bc.draft.title')} closeLabel={t('common.close')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={saving} disabled={!company} onClick={() => company && onSave({ company: company.id, ...(contact && { contact }), ...(location && { location }) })}>{t('save.save')}</Button></>}>
      {!company ? (
        <>
          <input type="search" autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('bc.company.search')} aria-label={t('bc.company.search')} className={`${searchCls} mb-2 !pl-3`} />
          <ul className="max-h-64 divide-y divide-line overflow-y-auto text-[13px]">
            {(q.data ?? []).map((c) => <li key={c.id}><button type="button" className="flex w-full items-center gap-2 px-2 py-2 text-left hover:bg-surface" onClick={() => { setCompany(c); setLocation(c.locations.nodes[0]?.id ?? ''); }}><Building2 className="size-4 text-muted" />{c.name}</button></li>)}
            {!q.isLoading && !(q.data ?? []).length && <li className="py-3 text-center text-muted">{t('bc.company.none')}</li>}
          </ul>
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-[13px] font-medium"><Building2 className="size-4" />{company.name}<button type="button" className="ml-auto text-xs font-normal text-accent hover:underline" onClick={() => setCompany(null)}>{t('bc.draft.other')}</button></p>
          <Select label={t('bc.draft.location')} value={location} onChange={(e) => setLocation(e.target.value)}>{company.locations.nodes.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
          <Select label={t('bc.draft.contact')} help={t('bc.draft.contactHelp')} value={contact} onChange={(e) => setContact(e.target.value)}><option value="">{t('bc.draft.noContact')}</option>{company.contacts.nodes.map((c) => <option key={c.id} value={c.id}>{c.customer.displayName}</option>)}</Select>
        </div>
      )}
    </Modal>
  );
}

/** Read-only "Company" block of an order page; renders nothing for consumer orders. */
export function OrderCompanySection({ orderId }: { orderId: string }) {
  const { t } = useI18n();
  const q = useQuery({
    queryKey: ['order-company', orderId],
    queryFn: async () => (await gql<{ order: { shopmePurchasingCompany: (Entity & { location: { id: string; name: string; buyerExperienceConfiguration: { paymentTermsTemplate: { name: string } | null } | null } | null }) | null } | null }>(ORDER_COMPANY, { id: orderId })).order?.shopmePurchasingCompany ?? null,
  });
  const e = q.data;
  if (q.isError) return <Banner>{t('bc.draft.loadFailed')}</Banner>;
  if (!e?.company) return null;
  const terms = e.location?.buyerExperienceConfiguration?.paymentTermsTemplate?.name;
  return (
    <SideSection title={t('bc.companies')}>
      <div className="flex flex-col gap-0.5 text-[13px]">
        <Link to={`/customers/companies/${gidToNum(e.company.id)}`} className="text-accent hover:underline">{e.company.name}</Link>
        {e.location && <span className="text-muted">{e.location.name}</span>}
        {e.contact && <span className="text-muted">{e.contact.customer.displayName}</span>}
        {terms && <span className="text-muted">{t('bc.company.terms')}: {terms}</span>}
      </div>
    </SideSection>
  );
}
