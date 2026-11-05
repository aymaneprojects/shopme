import { Banner, Button, Card, Input, Modal, Select, Skeleton, Switch, Tabs, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { UserErrors, gql, mutate } from '../api';
import { CUSTOMER_STORE_CREDIT, STORE_CREDIT_CREDIT, STORE_CREDIT_DEBIT } from '../graphql';
import { useI18n } from '../i18n';
import { useFormat } from './shared';
import type { Money } from './shared';

interface Tx { __typename: string; amount: Money; event: string; createdAt: string; expiresAt?: string | null }
interface Account { id: string; balance: Money; transactions: { nodes: Tx[] } }
interface CreditData {
  storeCreditConfiguration: { storeCreditEnabled: boolean };
  customer: { id: string; storeCreditAccounts: { nodes: Account[] } } | null;
  shop: { currencyCode: string; ianaTimezone: string };
}
export const creditKey = (id: string) => ['customer-credit', id];
const useCredit = (id: string) => useQuery({ queryKey: creditKey(id), queryFn: () => gql<CreditData>(CUSTOMER_STORE_CREDIT, { id }) });

/** End of the chosen calendar day in the shop time zone, as an instant (credit expires at the end of that day). */
export function endOfDayIn(date: string, timeZone: string): Date {
  const guess = new Date(`${date}T23:59:59Z`);
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(guess);
    const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
    return new Date(guess.getTime() - (asUtc - guess.getTime()));
  } catch { return guess; }
}

/** "Store credit" section of the customer page: balance per currency and the latest movements, with a pencil that opens the adjust dialog. */
export function StoreCreditCard({ customerId, onEdit }: { customerId: string; onEdit: () => void }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const q = useCredit(customerId);
  const accounts = q.data?.customer?.storeCreditAccounts.nodes ?? [];
  const latest = accounts.flatMap((a) => a.transactions.nodes).sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, 3);
  return (
    <Card title={t('credit.title')} actions={<Button size="sm" icon aria-label={t('credit.adjust')} onClick={onEdit}><Pencil className="size-3.5" /></Button>}>
      {q.isLoading ? <Skeleton className="h-5 w-24" /> : q.error ? <p className="text-[13px] text-muted">{q.error.message}</p> : accounts.length === 0 ? (
        <p className="text-[13px] text-muted">{t('credit.none')}</p>
      ) : (
        <div className="flex flex-col gap-2 text-[13px]">
          {accounts.map((a) => <p key={a.id} className="font-medium" data-testid="credit-balance">{fmt.money(a.balance)}</p>)}
          <ul className="flex flex-col gap-1 text-muted">
            {latest.map((x, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span>{t(`credit.tx.${x.__typename.replace('StoreCreditAccount', '').replace('Transaction', '')}` as 'credit.tx.Credit')}{x.expiresAt ? ` · ${t('credit.expiresOn', { date: fmt.date(x.expiresAt) })}` : ''}</span>
                <span>{fmt.money(x.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {q.data && !q.data.storeCreditConfiguration.storeCreditEnabled && <p className="mt-2 text-[12px] text-muted">{t('credit.offNote')}</p>}
    </Card>
  );
}

/** "Adjust store credit": issue credit (amount, optional expiry, notify) or remove it. */
export function StoreCreditDialog({ customerId, open, onClose }: { customerId: string; open: boolean; onClose: () => void }) {
  const q = useCredit(customerId);
  if (!open) return null;
  return <DialogBody key="open" customerId={customerId} data={q.data} onClose={onClose} />;
}

function DialogBody({ customerId, data, onClose }: { customerId: string; data?: CreditData; onClose: () => void }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'credit' | 'debit'>('credit');
  const [amount, setAmount] = useState('');
  const [expires, setExpires] = useState('');
  const [pickExpiry, setPickExpiry] = useState(false);
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const currency = data?.shop.currencyCode ?? '';
  const tz = data?.shop.ianaTimezone ?? 'UTC';
  const account = data?.customer?.storeCreditAccounts.nodes.find((a) => a.balance.currencyCode === currency);
  const parsed = Number(amount.replace(',', '.'));
  const valid = Number.isFinite(parsed) && parsed > 0 && /^\d*([.,]\d{0,2})?$/.test(amount.trim());
  const refresh = () => { void qc.invalidateQueries({ queryKey: creditKey(customerId) }); void qc.invalidateQueries({ queryKey: ['customer'] }); void qc.invalidateQueries({ queryKey: ['timeline'] }); };
  const submit = useMutation({
    mutationFn: async () => {
      const money = { amount: parsed.toFixed(2), currencyCode: currency };
      if (mode === 'credit') return mutate(STORE_CREDIT_CREDIT, { id: customerId, input: { creditAmount: money, notify, ...(expires ? { expiresAt: endOfDayIn(expires, tz).toISOString() } : {}) } }, 'storeCreditAccountCredit');
      return mutate(STORE_CREDIT_DEBIT, { id: account!.id, input: { debitAmount: money } }, 'storeCreditAccountDebit');
    },
    onSuccess: () => { toast(t(mode === 'credit' ? 'credit.issued' : 'credit.removed')); refresh(); onClose(); },
    onError: (e) => setError(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message),
  });
  const today = new Date().toISOString().slice(0, 10);
  const label = expires ? new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(new Date(`${expires}T12:00:00Z`)) : t('credit.noExpiry');
  return (
    <Modal open onClose={onClose} title={t('credit.adjust')} closeLabel={t('common.close')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" disabled={!valid || !data} loading={submit.isPending} onClick={() => submit.mutate()}>{t(mode === 'credit' ? 'credit.issue' : 'credit.remove')}</Button></>}>
      <div className="flex flex-col gap-4">
        {error && <Banner>{error}</Banner>}
        <Tabs tabs={[{ id: 'credit', label: t('credit.issue') }, { id: 'debit', label: t('credit.remove') }]} value={mode} onChange={(m) => { setMode(m); setError(null); }} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={t('credit.currency')} disabled value={currency}><option value={currency}>{currency}</option></Select>
          <div className="relative">
            <Input label={t('credit.amount')} inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} className="pr-12" />
            <span className="pointer-events-none absolute bottom-2 right-3 text-[13px] text-muted">{currency}</span>
          </div>
        </div>
        {mode === 'debit' && <p className="text-[13px] text-muted">{account ? t('credit.balanceNow', { amount: `${(Number(account.balance.amount)).toFixed(2)} ${currency}` }) : t('credit.nothingToRemove')}</p>}
        {mode === 'credit' && (
          <>
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-[13px] font-semibold">{t('credit.expiry')}</p><p className="text-[13px] text-muted">{t('credit.expiryHelp')}</p></div>
              <Button size="sm" onClick={() => setPickExpiry(!pickExpiry)} aria-expanded={pickExpiry}>{label}</Button>
            </div>
            {pickExpiry && (
              <div className="flex items-end gap-2">
                <Input type="date" label={t('credit.expiryDate')} min={today} value={expires} onChange={(e) => setExpires(e.target.value)} />
                {expires && <Button size="sm" onClick={() => setExpires('')}>{t('credit.noExpiry')}</Button>}
              </div>
            )}
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-[13px] font-semibold">{t('credit.notify')}</p><p className="text-[13px] text-muted">{t('credit.notifyHelp')}</p></div>
              <Switch checked={notify} onChange={setNotify} label={<span className="sr-only">{t('credit.notify')}</span>} />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
