import { Button, Card, Checkbox, Modal, Select, Skeleton, TagInput } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { gql } from '../api';
import { CUSTOMERS, SEGMENTS } from '../graphql';
import { useT } from '../i18n';
import { useDebounced } from '../lib/hooks';
import type { Connection } from '../lib/hooks';
import type { DiscountForm, Ref } from '../lib/discount-form';
import { searchCls } from './shared';

interface Segment { id: string; name: string }

/** Customer eligibility (everyone, segments, specific customers) of a discount. */
export function EligibilityCard({ form, set, error }: { form: DiscountForm; set: (p: Partial<DiscountForm>) => void; error?: string | null }) {
  const t = useT();
  const [picking, setPicking] = useState(false);
  const segments = useQuery({ queryKey: ['segments'], enabled: form.eligibility === 'segments', queryFn: () => gql<{ shopmeCustomerSegments: Segment[] }>(SEGMENTS) });
  const toggle = (s: Segment, on: boolean) => set({ segments: on ? [...form.segments, { id: s.id, title: s.name }] : form.segments.filter((x) => x.id !== s.id) });
  return (
    <Card title={t('discount.eligibility')}>
      <div className="flex flex-col gap-3">
        <Select label={t('discount.eligibilityLabel')} value={form.eligibility} onChange={(e) => set({ eligibility: e.target.value as DiscountForm['eligibility'] })}>
          <option value="all">{t('discount.eligibility.all')}</option>
          <option value="segments">{t('discount.eligibility.segments')}</option>
          <option value="customers">{t('discount.eligibility.customers')}</option>
        </Select>
        {form.eligibility === 'segments' && (
          segments.isLoading ? <Skeleton className="h-16" /> : !segments.data?.shopmeCustomerSegments.length
            ? <p className="text-[13px] text-muted">{t('discount.eligibility.noSegments')}</p>
            : <div className="flex flex-col gap-1.5">{segments.data.shopmeCustomerSegments.map((s) => <Checkbox key={s.id} label={s.name} checked={form.segments.some((x) => x.id === s.id)} onChange={(e) => toggle(s, e.target.checked)} />)}</div>
        )}
        {form.eligibility === 'customers' && (
          <div>
            <Button size="sm" onClick={() => setPicking(true)}>{t('discount.eligibility.addCustomers')}</Button>
            <ul className="mt-2 divide-y divide-line">
              {form.customers.map((c) => (
                <li key={c.id} className="flex items-center gap-2 py-1.5 text-[13px]"><span className="flex-1">{c.title}</span>
                  <button type="button" aria-label={`${t('common.remove')} ${c.title}`} className="rounded p-1 text-muted hover:bg-surface" onClick={() => set({ customers: form.customers.filter((x) => x.id !== c.id) })}><Trash2 className="size-4" /></button></li>
              ))}
            </ul>
          </div>
        )}
        {error && <p className="text-xs text-critical">{error}</p>}
        {form.eligibility !== 'all' && <p className="text-xs text-muted">{t('discount.eligibility.help')}</p>}
      </div>
      <CustomerPicker open={picking} onClose={() => setPicking(false)} exclude={form.customers.map((c) => c.id)} onConfirm={(c) => { set({ customers: [...form.customers, ...c] }); setPicking(false); }} />
    </Card>
  );
}

export function TagsCard({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const t = useT();
  return (
    <Card title={t('discount.tags')}>
      <TagInput value={value} onChange={onChange} label={t('discount.tagsLabel')} placeholder={t('discount.tagsPlaceholder')} removeLabel={t('common.remove')} />
      <p className="mt-1 text-xs text-muted">{t('discount.tagsHelp')}</p>
    </Card>
  );
}

function CustomerPicker({ open, onClose, onConfirm, exclude }: { open: boolean; onClose: () => void; onConfirm: (c: Ref[]) => void; exclude: string[] }) {
  const t = useT();
  const [text, setText] = useState('');
  const [chosen, setChosen] = useState<Ref[]>([]);
  const term = useDebounced(text);
  const q = useQuery({ queryKey: ['customer-picker', term], enabled: open, queryFn: () => gql<{ customers: Connection<{ id: string; displayName: string; defaultEmailAddress: { emailAddress: string } | null }> }>(CUSTOMERS, { first: 20, query: term || null }) });
  const rows = (q.data?.customers.nodes ?? []).filter((c) => !exclude.includes(c.id));
  return (
    <Modal open={open} onClose={onClose} title={t('discount.eligibility.addCustomers')} closeLabel={t('common.close')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" disabled={!chosen.length} onClick={() => { onConfirm(chosen); setChosen([]); }}>{t('discount.eligibility.add')}</Button></>}>
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted" />
        <input type="search" value={text} onChange={(e) => setText(e.target.value)} aria-label={t('customers.search')} placeholder={t('customers.search')} className={searchCls} />
      </div>
      {q.isLoading ? <Skeleton className="h-32" /> : (
        <ul className="max-h-72 divide-y divide-line overflow-y-auto">
          {rows.map((c) => (
            <li key={c.id} className="py-1.5">
              <Checkbox label={<span>{c.displayName}<span className="ml-2 text-muted">{c.defaultEmailAddress?.emailAddress}</span></span>} checked={chosen.some((x) => x.id === c.id)}
                onChange={(e) => setChosen(e.target.checked ? [...chosen, { id: c.id, title: c.displayName }] : chosen.filter((x) => x.id !== c.id))} />
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
