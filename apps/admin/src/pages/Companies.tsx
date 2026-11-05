import { Badge, Banner, Button, Card, Checkbox, ConfirmDialog, Dropdown, EmptyState, IndexTable, Input, Modal, Pagination, Select, Skeleton, Textarea, useToast } from '@shopme/ui';
import type { Column } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpDown, Building2, Check, MoreHorizontal, Pencil, Plus, Search, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { UserErrors, gql, mutate } from '../api';
import { CustomerSearchDialog } from '../components/CustomerDialogs';
import { PageHeader } from '../components/PageHeader';
import { FinancialBadge, searchCls, useFormat, useListParams } from '../components/shared';
import type { Money, MoneySet } from '../components/shared';
import { gidToNum, numToGid } from '../format';
import {
  COMPANIES, COMPANIES_DELETE, COMPANY, COMPANY_ASSIGN_CONTACT, COMPANY_CONTACT_UPDATE, COMPANY_CREATE, COMPANY_LOCATION_CREATE, COMPANY_LOCATION_DELETE, COMPANY_LOCATION_UPDATE,
  COMPANY_MAIN_CONTACT, COMPANY_REMOVE_CONTACT, COMPANY_UPDATE,
} from '../graphql';
import { useI18n } from '../i18n';
import { countryOptions } from '../lib/countries';
import { useDebounced } from '../lib/hooks';
import type { Connection } from '../lib/hooks';

const PAGE_SIZE = 25;
const TERMS = ['', '0', '15', '30', '45', '60', '90'] as const;
const errText = (e: unknown) => (e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : (e as Error).message);
const termsLabel = (t: ReturnType<typeof useI18n>['t'], days: string) => (days === '' ? t('bc.company.terms.none') : days === '0' ? t('bc.company.terms.receipt') : t('bc.company.terms.net', { n: days }));

interface CompanyRow { id: string; name: string; externalId: string | null; createdAt: string; contactsCount: { count: number } | null; locationsCount: { count: number } | null; ordersCount: { count: number } | null; totalSpent: Money; mainContact: { customer: { displayName: string } } | null }

/* ------------------------------ list ------------------------------ */

export function CompaniesPage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const fmt = useFormat();
  const L = useListParams();
  const [search, setSearch] = useState(L.get('q'));
  const term = useDebounced(search).trim();
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const [creating, setCreating] = useState(false);
  const sort = { key: L.get('sort') || 'NAME', reverse: L.get('dir') === 'desc' };
  const list = useQuery({
    queryKey: ['companies', term, sort, L.get('after'), L.get('before')], placeholderData: (p) => p,
    queryFn: async () => (await gql<{ companies: Connection<CompanyRow> }>(COMPANIES, { query: term || null, sortKey: sort.key, reverse: sort.reverse, ...L.page(PAGE_SIZE) })).companies,
  });
  const del = useMutation({
    mutationFn: (ids: string[]) => mutate(COMPANIES_DELETE, { ids }, 'companiesDelete'),
    onSuccess: (_d, ids) => { toast(t('bc.company.deleted', { n: ids.length })); setSelected([]); void qc.invalidateQueries({ queryKey: ['companies'] }); }, onError: (e) => toast(errText(e), 'critical'),
  });
  const rows = list.data?.nodes ?? [];
  const pi = list.data?.pageInfo;
  const columns: Array<Column<CompanyRow>> = [
    { key: 'name', header: t('bc.company.name'), sortKey: 'NAME', cell: (c) => <div><span className="font-medium">{c.name}</span>{c.externalId && <p className="text-xs text-muted">{c.externalId}</p>}</div> },
    { key: 'contact', header: t('bc.company.mainContact'), cell: (c) => c.mainContact?.customer.displayName ?? <span className="text-muted">—</span> },
    { key: 'locations', header: t('bc.company.locations'), cell: (c) => c.locationsCount?.count ?? 0 },
    { key: 'orders', header: t('customers.orders'), cell: (c) => c.ordersCount?.count ?? 0 },
    { key: 'spent', header: t('customers.spent'), cell: (c) => fmt.money(c.totalSpent) },
    { key: 'since', header: t('bc.company.since'), sortKey: 'CREATED_AT', cell: (c) => fmt.date(c.createdAt) },
  ];
  const add = <Button variant="primary" onClick={() => setCreating(true)}>{t('bc.company.add')}</Button>;
  return (
    <>
      <PageHeader icon={<Building2 className="size-4" />} back="/customers" title={t('bc.companies')} actions={add} />
      <Card className="!p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted" />
            <input type="search" value={search} onChange={(e) => { setSearch(e.target.value); L.patch({ q: e.target.value }); }} placeholder={t('bc.company.search')} aria-label={t('bc.company.search')} className={searchCls} />
          </div>
          <Dropdown align="right" variant="plain" size="sm" icon className="btn-neutral" label={t('common.sort')} trigger={<ArrowUpDown className="size-4" />}
            items={(['NAME', 'CREATED_AT'] as const).flatMap((k) => ([false, true] as const).map((rev) => ({ key: `${k}${rev}`, label: `${t(k === 'NAME' ? 'bc.company.name' : 'bc.company.since')} ${rev ? '↓' : '↑'}`, icon: sort.key === k && sort.reverse === rev ? <Check className="size-4" /> : undefined, onSelect: () => L.patch({ sort: k === 'NAME' ? '' : k, dir: rev ? 'desc' : '' }) })))} />
        </div>
        {list.isError && <div className="p-3"><Banner>{(list.error as Error).message}</Banner></div>}
        <IndexTable rows={rows} rowId={(r) => r.id} columns={columns} loading={list.isLoading} onRowClick={(r) => nav(`/customers/companies/${gidToNum(r.id)}`)}
          selected={selected} onSelectedChange={setSelected} selectedLabel={(n) => t('common.selected', { n })} selectAllLabel={t('common.selectAll')}
          sort={{ key: sort.key, reverse: sort.reverse }} onSortChange={(s) => L.patch({ sort: s.key === 'NAME' ? '' : s.key, dir: s.reverse ? 'desc' : '' })}
          bulkActions={[{ key: 'delete', label: t('common.delete'), icon: <Trash2 className="size-4" />, danger: true, onRun: setConfirm }]}
          empty={list.isError ? null : term
            ? <EmptyState icon={<Search className="size-10" />} title={t('products.noResults')} description={t('products.noResultsBody')} />
            : <EmptyState icon={<Building2 className="size-10" />} title={t('bc.company.emptyTitle')} description={t('bc.company.emptyBody')} action={add} />} />
        <Pagination hasPrevious={L.get('before') ? !!pi?.hasPreviousPage : !!L.get('after')} hasNext={L.get('before') ? true : !!pi?.hasNextPage} previousLabel={t('common.previous')} nextLabel={t('common.next')}
          onPrevious={() => L.patch({ before: pi?.startCursor ?? '', after: '' }, true)} onNext={() => L.patch({ after: pi?.endCursor ?? '', before: '' }, true)} />
      </Card>
      <CompanyDialog open={creating} onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); nav(`/customers/companies/${gidToNum(id)}`); }} />
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} danger title={t('bc.company.deleteTitle', { n: confirm?.length ?? 0 })} message={t('bc.company.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')}
        onConfirm={() => { if (confirm) del.mutate(confirm); setConfirm(null); }} />
    </>
  );
}

/* ------------------------------ dialogs ------------------------------ */

interface LocationForm { name: string; phone: string; taxRegistrationId: string; taxExempt: boolean; terms: string; address1: string; address2: string; city: string; zip: string; province: string; countryCode: string; externalId: string; note: string }
const blankLocation: LocationForm = { name: '', phone: '', taxRegistrationId: '', taxExempt: false, terms: '', address1: '', address2: '', city: '', zip: '', province: '', countryCode: '', externalId: '', note: '' };
const locationInput = (f: LocationForm, withName = true) => ({
  ...(withName && { name: f.name.trim() }), phone: f.phone, taxRegistrationId: f.taxRegistrationId, taxExempt: f.taxExempt, paymentTermsDays: f.terms === '' ? null : Number(f.terms),
  address1: f.address1, address2: f.address2, city: f.city, zip: f.zip, province: f.province, countryCode: f.countryCode || null, externalId: f.externalId, note: f.note,
});

function LocationFields({ f, set, nameLabel }: { f: LocationForm; set: (p: Partial<LocationForm>) => void; nameLabel?: string }) {
  const { t, lang } = useI18n();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {nameLabel && <Input className="sm:col-span-2" label={nameLabel} value={f.name} onChange={(e) => set({ name: e.target.value })} />}
      <Select label={t('customer.country')} value={f.countryCode} onChange={(e) => set({ countryCode: e.target.value })}><option value="" />{countryOptions(lang).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</Select>
      <Input label={t('customer.province')} value={f.province} onChange={(e) => set({ province: e.target.value })} />
      <Input label={t('customer.address1')} value={f.address1} onChange={(e) => set({ address1: e.target.value })} />
      <Input label={t('customer.address2')} value={f.address2} onChange={(e) => set({ address2: e.target.value })} />
      <Input label={t('customer.city')} value={f.city} onChange={(e) => set({ city: e.target.value })} />
      <Input label={t('customer.zip')} value={f.zip} onChange={(e) => set({ zip: e.target.value })} />
      <Input label={t('customer.phone')} type="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} />
      <Input label={t('bc.company.taxId')} value={f.taxRegistrationId} onChange={(e) => set({ taxRegistrationId: e.target.value })} />
      <Select label={t('bc.company.terms')} help={t('bc.company.termsHelp')} value={f.terms} onChange={(e) => set({ terms: e.target.value })}>{TERMS.map((d) => <option key={d} value={d}>{termsLabel(t, d)}</option>)}</Select>
      <div className="self-end pb-2"><Checkbox label={t('bc.company.taxExempt')} checked={f.taxExempt} onChange={(e) => set({ taxExempt: e.target.checked })} /></div>
    </div>
  );
}

/** Create a company together with its first location (named like the company). */
function CompanyDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (id: string) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [externalId, setExternalId] = useState('');
  const [note, setNote] = useState('');
  const [loc, setLoc] = useState(blankLocation);
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => mutate<{ company: { id: string } }>(COMPANY_CREATE, { input: { company: { name: name.trim(), externalId: externalId || null, note: note || null }, companyLocation: locationInput(loc, false) } }, 'companyCreate'),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['companies'] }); setName(''); setExternalId(''); setNote(''); setLoc(blankLocation); setError(null); onSaved(r.company.id); },
    onError: (e) => setError(errText(e)),
  });
  return (
    <Modal open={open} onClose={onClose} wide title={t('bc.company.add')} closeLabel={t('common.close')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={create.isPending} disabled={!name.trim()} onClick={() => create.mutate()}>{t('bc.company.create')}</Button></>}>
      <div className="flex flex-col gap-3">
        {error && <Banner>{error}</Banner>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('bc.company.name')} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          <Input label={t('bc.company.externalId')} help={t('bc.company.externalIdHelp')} value={externalId} onChange={(e) => setExternalId(e.target.value)} />
        </div>
        <Textarea label={t('order.notes')} value={note} onChange={(e) => setNote(e.target.value)} />
        <h3 className="text-[13px] font-semibold">{t('bc.company.firstLocation')}</h3>
        <LocationFields f={loc} set={(p) => setLoc((x) => ({ ...x, ...p }))} />
      </div>
    </Modal>
  );
}

interface LocationNode {
  id: string; name: string; phone: string | null; externalId: string | null; note: string | null; taxRegistrationId: string | null; taxExempt: boolean;
  billingAddress: { address1: string | null; address2: string | null; city: string | null; zip: string | null; province: string | null; countryCode: string | null } | null;
  buyerExperienceConfiguration: { paymentTermsTemplate: { days: number; name: string } | null } | null;
}
const formOf = (l: LocationNode): LocationForm => ({
  name: l.name, phone: l.phone ?? '', taxRegistrationId: l.taxRegistrationId ?? '', taxExempt: l.taxExempt, terms: l.buyerExperienceConfiguration?.paymentTermsTemplate ? String(l.buyerExperienceConfiguration.paymentTermsTemplate.days) : '',
  address1: l.billingAddress?.address1 ?? '', address2: l.billingAddress?.address2 ?? '', city: l.billingAddress?.city ?? '', zip: l.billingAddress?.zip ?? '', province: l.billingAddress?.province ?? '', countryCode: l.billingAddress?.countryCode ?? '',
  externalId: l.externalId ?? '', note: l.note ?? '',
});

function LocationDialog({ companyId, location, open, onClose }: { companyId: string; location: LocationNode | null; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [f, setF] = useState(() => (location ? formOf(location) : blankLocation));
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => (location ? mutate(COMPANY_LOCATION_UPDATE, { id: location.id, input: locationInput(f) }, 'companyLocationUpdate') : mutate(COMPANY_LOCATION_CREATE, { id: companyId, input: locationInput(f) }, 'companyLocationCreate')),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['company'] }); void qc.invalidateQueries({ queryKey: ['companies'] }); onClose(); }, onError: (e) => setError(errText(e)),
  });
  return (
    <Modal open={open} onClose={onClose} wide title={location ? t('bc.company.editLocation') : t('bc.company.addLocation')} closeLabel={t('common.close')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate()}>{t('save.save')}</Button></>}>
      <div className="flex flex-col gap-3">
        {error && <Banner>{error}</Banner>}
        <LocationFields f={f} set={(p) => setF((x) => ({ ...x, ...p }))} nameLabel={t('bc.company.locationName')} />
        <div className="grid gap-3 sm:grid-cols-2"><Input label={t('bc.company.externalId')} value={f.externalId} onChange={(e) => setF({ ...f, externalId: e.target.value })} /></div>
        <Textarea label={t('order.notes')} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </div>
    </Modal>
  );
}

/* ------------------------------ detail ------------------------------ */

interface CompanyData {
  id: string; name: string; externalId: string | null; note: string | null; createdAt: string; ordersCount: { count: number } | null; totalSpent: Money; draftOrdersCount: { count: number } | null;
  contacts: { nodes: Array<{ id: string; title: string | null; isMainContact: boolean; customer: { id: string; displayName: string; defaultEmailAddress: { emailAddress: string } | null } }> };
  locations: { nodes: LocationNode[] };
  orders: { nodes: Array<{ id: string; name: string; createdAt: string; displayFinancialStatus: string; totalPriceSet: MoneySet }> };
}

export function CompanyDetailPage() {
  const { id = '' } = useParams();
  const t = useI18n().t;
  const gid = numToGid('Company', id);
  const q = useQuery({ queryKey: ['company', gid], queryFn: async () => (await gql<{ company: CompanyData | null }>(COMPANY, { id: gid })).company });
  if (q.isLoading) return <div className="grid gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64" /></div>;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  if (!q.data) return <Banner>{t('bc.company.notFound')}</Banner>;
  return <CompanyView key={q.dataUpdatedAt} c={q.data} />;
}

function CompanyView({ c }: { c: CompanyData }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const num = gidToNum(c.id);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(c.name);
  const [externalId, setExternalId] = useState(c.externalId ?? '');
  const [note, setNote] = useState(c.note ?? '');
  const [addContact, setAddContact] = useState(false);
  const [location, setLocation] = useState<LocationNode | 'new' | null>(null);
  const [confirm, setConfirm] = useState<'company' | LocationNode | null>(null);
  const [titleFor, setTitleFor] = useState<{ id: string; title: string } | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['company'] }); void qc.invalidateQueries({ queryKey: ['companies'] }); void qc.invalidateQueries({ queryKey: ['customer'] }); };
  const fail = (e: unknown) => toast(errText(e), 'critical');
  const update = useMutation({ mutationFn: () => mutate(COMPANY_UPDATE, { id: c.id, input: { name: name.trim(), externalId, note } }, 'companyUpdate'), onSuccess: () => { setEditing(false); toast(t('bc.company.saved')); refresh(); }, onError: fail });
  const del = useMutation({ mutationFn: () => mutate(COMPANIES_DELETE, { ids: [c.id] }, 'companiesDelete'), onSuccess: () => { refresh(); nav('/customers/companies'); }, onError: fail });
  const assign = useMutation({ mutationFn: (customer: string) => mutate(COMPANY_ASSIGN_CONTACT, { company: c.id, customer }, 'companyAssignCustomerAsContact'), onSuccess: () => { setAddContact(false); refresh(); }, onError: (e) => { setAddContact(false); fail(e); } });
  const main = useMutation({ mutationFn: (contact: string) => mutate(COMPANY_MAIN_CONTACT, { company: c.id, contact }, 'companyAssignMainContact'), onSuccess: refresh, onError: fail });
  const remove = useMutation({ mutationFn: (contact: string) => mutate(COMPANY_REMOVE_CONTACT, { id: contact }, 'companyContactRemoveFromCompany'), onSuccess: refresh, onError: fail });
  const retitle = useMutation({ mutationFn: (v: { id: string; title: string }) => mutate(COMPANY_CONTACT_UPDATE, { id: v.id, title: v.title }, 'companyContactUpdate'), onSuccess: () => { setTitleFor(null); refresh(); }, onError: fail });
  const delLocation = useMutation({ mutationFn: (id: string) => mutate(COMPANY_LOCATION_DELETE, { id }, 'companyLocationDelete'), onSuccess: () => { setConfirm(null); refresh(); }, onError: (e) => { setConfirm(null); fail(e); } });
  const addr = (l: LocationNode) => [l.billingAddress?.address1, l.billingAddress?.address2, [l.billingAddress?.zip, l.billingAddress?.city].filter(Boolean).join(' '), l.billingAddress?.province, l.billingAddress?.countryCode].filter(Boolean).join(', ');
  const terms = (l: LocationNode) => l.buyerExperienceConfiguration?.paymentTermsTemplate ? termsLabel(t, String(l.buyerExperienceConfiguration.paymentTermsTemplate.days)) : null;

  return (
    <>
      <PageHeader large back="/customers/companies" breadcrumb={{ icon: <Building2 className="size-4" />, label: t('bc.companies'), to: '/customers/companies' }} title={c.name}
        more={[{ key: 'orders', label: t('customers.viewAllOrders'), disabled: (c.ordersCount?.count ?? 0) === 0, onSelect: () => nav(`/orders?q=${encodeURIComponent(`company_id:${num}`)}`) }, { key: 'delete', label: t('common.delete'), danger: true, onSelect: () => setConfirm('company') }]} />
      <div className="grid gap-4 lg:grid-cols-[1fr_17rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <dl className="grid grid-cols-3 gap-4 px-3 text-[13px]">
            <div><dt className="font-semibold">{t('customers.spent')}</dt><dd className="mt-1">{fmt.money(c.totalSpent)}</dd></div>
            <div><dt className="font-semibold">{t('customers.orders')}</dt><dd className="mt-1">{c.ordersCount?.count ?? 0}</dd></div>
            <div><dt className="font-semibold">{t('bc.company.openDrafts')}</dt><dd className="mt-1">{c.draftOrdersCount?.count ?? 0}</dd></div>
          </dl>
          <Card title={t('bc.company.locations')} actions={<Button size="sm" onClick={() => setLocation('new')}><Plus className="size-4" />{t('bc.company.addLocation')}</Button>}>
            <ul className="divide-y divide-line">
              {c.locations.nodes.map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-3 py-3 text-[13px] first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="font-medium">{l.name}</p>
                    <p className="text-muted">{addr(l) || t('bc.company.noAddress')}</p>
                    <p className="mt-1 flex flex-wrap gap-1.5">
                      {terms(l) && <Badge tone="info">{terms(l)}</Badge>}{l.taxExempt && <Badge tone="neutral">{t('bc.company.taxExempt')}</Badge>}{l.taxRegistrationId && <span className="text-xs text-muted">{t('bc.company.taxId')}: {l.taxRegistrationId}</span>}
                    </p>
                  </div>
                  <Dropdown align="right" variant="plain" size="sm" icon label={t('common.moreActions')} trigger={<MoreHorizontal className="size-4" />}
                    items={[{ key: 'edit', icon: <Pencil className="size-4" />, label: t('common.edit'), onSelect: () => setLocation(l) }, { key: 'delete', icon: <Trash2 className="size-4" />, label: t('common.delete'), danger: true, disabled: c.locations.nodes.length <= 1, onSelect: () => setConfirm(l) }]} />
                </li>
              ))}
            </ul>
          </Card>
          <Card title={t('bc.company.contacts')} actions={<Button size="sm" onClick={() => setAddContact(true)}><Plus className="size-4" />{t('bc.company.addContact')}</Button>}>
            {c.contacts.nodes.length === 0 ? <p className="text-[13px] text-muted">{t('bc.company.noContacts')}</p> : (
              <ul className="divide-y divide-line">
                {c.contacts.nodes.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 py-2.5 text-[13px] first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <Link to={`/customers/${gidToNum(m.customer.id)}`} className="font-medium hover:underline">{m.customer.displayName}</Link>{m.isMainContact && <Badge tone="success" >{t('bc.company.main')}</Badge>}
                      <p className="truncate text-muted">{[m.title, m.customer.defaultEmailAddress?.emailAddress].filter(Boolean).join(' · ')}</p>
                    </div>
                    <Dropdown align="right" variant="plain" size="sm" icon label={t('common.moreActions')} trigger={<MoreHorizontal className="size-4" />}
                      items={[
                        { key: 'main', icon: <Star className="size-4" />, label: t('bc.company.makeMain'), disabled: m.isMainContact, onSelect: () => main.mutate(m.id) },
                        { key: 'title', icon: <Pencil className="size-4" />, label: t('bc.company.editTitle'), onSelect: () => setTitleFor({ id: m.id, title: m.title ?? '' }) },
                        { key: 'remove', icon: <Trash2 className="size-4" />, label: t('bc.company.removeContact'), danger: true, onSelect: () => remove.mutate(m.id) },
                      ]} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={t('nav.orders')} actions={(c.ordersCount?.count ?? 0) > 0 ? <Link className="btn btn-plain btn-sm" to={`/orders?q=${encodeURIComponent(`company_id:${num}`)}`}>{t('customers.viewAllOrders')}</Link> : undefined}>
            {c.orders.nodes.length === 0 ? <p className="text-[13px] text-muted">{t('customers.noOrders')}</p> : (
              <ul className="divide-y divide-line text-[13px]">
                {c.orders.nodes.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-2 py-2 first:pt-0 last:pb-0"><Link to={`/orders/${gidToNum(o.id)}`} className="font-semibold hover:underline">{o.name}</Link><FinancialBadge status={o.displayFinancialStatus} /><span className="text-muted">{fmt.dateTime(o.createdAt)}</span><span className="ml-auto">{fmt.money(o.totalPriceSet)}</span></li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card title={t('bc.company.details')} actions={!editing && <Button variant="plain" size="sm" icon aria-label={t('common.edit')} onClick={() => setEditing(true)}><Pencil className="size-3.5" /></Button>}>
          {editing ? (
            <div className="flex flex-col gap-3">
              <Input label={t('bc.company.name')} value={name} onChange={(e) => setName(e.target.value)} />
              <Input label={t('bc.company.externalId')} value={externalId} onChange={(e) => setExternalId(e.target.value)} />
              <Textarea label={t('order.notes')} value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex justify-end gap-2"><Button onClick={() => { setEditing(false); setName(c.name); setExternalId(c.externalId ?? ''); setNote(c.note ?? ''); }}>{t('common.cancel')}</Button><Button variant="primary" loading={update.isPending} disabled={!name.trim()} onClick={() => update.mutate()}>{t('save.save')}</Button></div>
            </div>
          ) : (
            <dl className="flex flex-col gap-2 text-[13px]">
              <div><dt className="text-muted">{t('bc.company.externalId')}</dt><dd>{c.externalId || '—'}</dd></div>
              <div><dt className="text-muted">{t('bc.company.since')}</dt><dd>{fmt.date(c.createdAt)}</dd></div>
              <div><dt className="text-muted">{t('order.notes')}</dt><dd className="whitespace-pre-wrap">{c.note || '—'}</dd></div>
            </dl>
          )}
        </Card>
      </div>
      <CustomerSearchDialog open={addContact} title={t('bc.company.addContact')} onClose={() => setAddContact(false)} onPick={(cid) => assign.mutate(cid)} />
      {location && <LocationDialog key={location === 'new' ? 'new' : location.id} companyId={c.id} location={location === 'new' ? null : location} open onClose={() => setLocation(null)} />}
      <Modal open={!!titleFor} onClose={() => setTitleFor(null)} title={t('bc.company.editTitle')} closeLabel={t('common.close')}
        footer={<><Button onClick={() => setTitleFor(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={retitle.isPending} onClick={() => titleFor && retitle.mutate(titleFor)}>{t('save.save')}</Button></>}>
        <Input label={t('bc.company.contactTitle')} autoFocus value={titleFor?.title ?? ''} onChange={(e) => titleFor && setTitleFor({ ...titleFor, title: e.target.value })} />
      </Modal>
      <ConfirmDialog open={confirm === 'company'} onClose={() => setConfirm(null)} danger title={t('bc.company.deleteTitle', { n: 1 })} message={t('bc.company.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => { setConfirm(null); del.mutate(); }} />
      <ConfirmDialog open={!!confirm && confirm !== 'company'} onClose={() => setConfirm(null)} danger title={t('bc.company.deleteLocationTitle')} message={t('bc.company.deleteLocationBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => confirm && confirm !== 'company' && delLocation.mutate(confirm.id)} />
    </>
  );
}

