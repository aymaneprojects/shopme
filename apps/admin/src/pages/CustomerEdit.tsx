import { Banner, Button, Card, Checkbox, Input, Select, Skeleton, TagInput, Textarea, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Users } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { UserErrors, gql, mutate } from '../api';
import { NoteCard } from '../components/NoteCard';
import { PageHeader } from '../components/PageHeader';
import { SaveBar, guard } from '../components/SaveBar';
import { gidToNum, numToGid } from '../format';
import { CUSTOMER, CUSTOMER_CREATE, CUSTOMER_UPDATE } from '../graphql';
import { useI18n } from '../i18n';
import { countryOptions } from '../lib/countries';
import { DIAL_CODES, joinPhone, splitPhone } from '../lib/dial-codes';

interface CustomerForm {
  firstName: string; lastName: string; email: string; phone: string; phoneCountry: string; marketing: boolean; sms: boolean; whatsapp: boolean; locale: string; taxExempt: boolean; note: string; tags: string[];
  address1: string; address2: string; city: string; zip: string; province: string; countryCode: string;
}
const blank: CustomerForm = { firstName: '', lastName: '', email: '', phone: '', phoneCountry: '', marketing: false, sms: false, whatsapp: false, locale: '', taxExempt: false, note: '', tags: [], address1: '', address2: '', city: '', zip: '', province: '', countryCode: '' };

interface Api {
  id: string; firstName: string | null; lastName: string | null; note: string | null; tags: string[]; taxExempt?: boolean;
  defaultEmailAddress: { emailAddress: string; marketingState: string } | null; defaultPhoneNumber: { phoneNumber: string } | null; smsMarketingConsent?: { marketingState: string } | null; shopmeWhatsappMarketingConsent?: { marketingState: string } | null;
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function CustomerEditPage() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const { t } = useI18n();
  const gid = numToGid('Customer', id);
  const q = useQuery({ queryKey: ['customer', gid], enabled: !isNew, queryFn: () => gql<{ customer: Api | null }>(CUSTOMER, { id: gid }) });
  if (!isNew && q.isLoading) return <div className="grid gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64" /></div>;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  if (!isNew && !q.data?.customer) return <Banner>{t('customers.notFound')}</Banner>;
  const c = q.data?.customer;
  const initial: CustomerForm = c ? {
    ...blank, firstName: c.firstName ?? '', lastName: c.lastName ?? '', email: c.defaultEmailAddress?.emailAddress ?? '', ...(() => { const p = splitPhone(c.defaultPhoneNumber?.phoneNumber ?? ''); return { phone: p.national, phoneCountry: p.country }; })(),
    marketing: c.defaultEmailAddress?.marketingState === 'SUBSCRIBED', sms: c.smsMarketingConsent?.marketingState === 'SUBSCRIBED', whatsapp: c.shopmeWhatsappMarketingConsent?.marketingState === 'SUBSCRIBED', taxExempt: !!c.taxExempt, note: c.note ?? '', tags: c.tags,
  } : blank;
  return <CustomerFormView key={`${id}:${q.dataUpdatedAt}`} id={isNew ? null : gid} initial={initial} />;
}

function CustomerFormView({ id, initial }: { id: string | null; initial: CustomerForm }) {
  const { t, lang } = useI18n();
  const [showAddress, setShowAddress] = useState(false);
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<{ email?: string; name?: string; phone?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<CustomerForm>) => setForm((f) => ({ ...f, ...p }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  const save = useMutation({
    mutationFn: async () => {
      const e: typeof errors = {};
      if (form.email && !EMAIL.test(form.email)) e.email = t('customer.emailInvalid');
      if (!form.email && !form.firstName && !form.lastName && !form.phone) e.name = t('customer.contactRequired');
      if (form.sms && !form.phone) e.phone = t('bc.sms.needsPhone');
      if (form.whatsapp && !form.phone) e.phone = t('bc.whatsapp.needsPhone');
      setErrors(e);
      if (Object.keys(e).length) throw new Error('validation');
      setError(null);
      const hasAddress = !id && (form.address1 || form.city || form.countryCode);
      const input = {
        ...(id && { id }), firstName: form.firstName || null, lastName: form.lastName || null, email: form.email || null, phone: joinPhone(form.phoneCountry, form.phone) || null,
        note: form.note || null, tags: form.tags, ...(!id && { locale: form.locale || lang }), taxExempt: form.taxExempt,
        emailMarketingConsent: { marketingState: form.marketing ? 'SUBSCRIBED' : 'NOT_SUBSCRIBED', marketingOptInLevel: 'SINGLE_OPT_IN' },
        ...((form.phone || initial.sms) && (form.sms !== initial.sms || !id) && { smsMarketingConsent: { marketingState: form.sms ? 'SUBSCRIBED' : initial.sms ? 'UNSUBSCRIBED' : 'NOT_SUBSCRIBED', marketingOptInLevel: 'SINGLE_OPT_IN' } }),
        ...((form.phone || initial.whatsapp) && (form.whatsapp !== initial.whatsapp || !id) && { shopmeWhatsappMarketingConsent: { marketingState: form.whatsapp ? 'SUBSCRIBED' : initial.whatsapp ? 'UNSUBSCRIBED' : 'NOT_SUBSCRIBED' } }),
        ...(hasAddress && { addresses: [{ address1: form.address1, address2: form.address2, city: form.city, zip: form.zip, province: form.province, countryCode: form.countryCode || null, firstName: form.firstName, lastName: form.lastName }] }),
      };
      const r = id
        ? await mutate<{ customer: { id: string } }>(CUSTOMER_UPDATE, { input }, 'customerUpdate')
        : await mutate<{ customer: { id: string } }>(CUSTOMER_CREATE, { input }, 'customerCreate');
      return r.customer.id;
    },
    onSuccess: (cid) => { toast(t('customers.saved')); void qc.invalidateQueries({ queryKey: ['customers'] }); void qc.invalidateQueries({ queryKey: ['customer'] }); guard.off = true; nav(`/customers/${gidToNum(cid)}`, { replace: !!id }); },
    onError: (e) => { if (e.message !== 'validation') setError(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message); },
  });
  const countries = countryOptions(lang);

  return (
    <>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => { setForm(initial); setErrors({}); }} />
      <PageHeader large back={id ? `/customers/${gidToNum(id)}` : '/customers'} breadcrumb={{ icon: <Users className="size-4" />, label: t('nav.customers'), to: '/customers' }} title={id ? t('customers.edit') : t('customers.addTitle')} />
      {(error || errors.name) && <div className="mb-4"><Banner>{error ?? errors.name}</Banner></div>}
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-4">
          <Card title={t('customers.overview')}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label={t('field.firstName')} value={form.firstName} onChange={(e) => set({ firstName: e.target.value })} />
              <Input label={t('field.lastName')} value={form.lastName} onChange={(e) => set({ lastName: e.target.value })} />
            </div>
            {!id && <Select className="mt-3" label={t('customers.language')} help={t('customers.languageHelp')} value={form.locale || lang} onChange={(e) => set({ locale: e.target.value })}><option value="en">English</option><option value="fr">Français</option></Select>}
            <div className="mt-3 grid gap-3">
              <Input label={t('field.email')} type="email" value={form.email} error={errors.email} onChange={(e) => set({ email: e.target.value })} />
              <div className="grid grid-cols-[8.5rem_1fr] gap-2">
                <Select label={t('bc.phone.country')} value={form.phoneCountry} onChange={(e) => set({ phoneCountry: e.target.value })}>
                  <option value="">{t('bc.phone.none')}</option>
                  {DIAL_CODES.map((d) => <option key={d.country} value={d.country}>{`${d.country} +${d.code}`}</option>)}
                </Select>
                <Input label={t('customer.phone')} type="tel" value={form.phone} error={errors.phone} onChange={(e) => set({ phone: e.target.value })} />
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-2">
              <Checkbox label={t('customer.marketingConsent')} checked={form.marketing} onChange={(e) => set({ marketing: e.target.checked })} />
              <Checkbox label={t('bc.sms.consent')} checked={form.sms} onChange={(e) => set({ sms: e.target.checked })} />
              <Checkbox label={t('bc.whatsapp.consent')} checked={form.whatsapp} onChange={(e) => set({ whatsapp: e.target.checked })} />
            </div>
            <p className="-mx-4 -mb-4 mt-4 rounded-b-lg bg-surface px-4 py-3 text-[13px] text-muted">{t('customers.consentNotice')}</p>
          </Card>
          {!id && !showAddress && <Button className="w-full justify-start" onClick={() => setShowAddress(true)}><Plus className="size-4" />{t('customers.addAddress')}</Button>}
          {!id && showAddress && (
            <Card title={t('customers.address')}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Select label={t('customer.country')} value={form.countryCode} onChange={(e) => set({ countryCode: e.target.value })}>
                  <option value="" />{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                </Select>
                <Input label={t('customer.province')} value={form.province} onChange={(e) => set({ province: e.target.value })} />
                <Input label={t('customer.address1')} value={form.address1} onChange={(e) => set({ address1: e.target.value })} />
                <Input label={t('customer.address2')} value={form.address2} onChange={(e) => set({ address2: e.target.value })} />
                <Input label={t('customer.city')} value={form.city} onChange={(e) => set({ city: e.target.value })} />
                <Input label={t('customer.zip')} value={form.zip} onChange={(e) => set({ zip: e.target.value })} />
              </div>
            </Card>
          )}
        </div>
        <div className="flex flex-col gap-4">
          <NoteCard title={t('order.notes')} value={form.note} onSave={(note) => set({ note })} />
          <Card title={t('field.tags')}><TagInput value={form.tags} onChange={(tags) => set({ tags })} removeLabel={t('common.remove')} /></Card>
          <Card title={t('customer.tax')}><Checkbox label={t('customer.taxExempt')} checked={form.taxExempt} onChange={(e) => set({ taxExempt: e.target.checked })} /></Card>
        </div>
      </div>
    </>
  );
}
