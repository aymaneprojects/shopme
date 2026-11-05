import { Card } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { Repeat } from 'lucide-react';
import { Link } from 'react-router';
import { gql } from '../api';
import { gidToNum } from '../format';
import { CUSTOMER_SUBSCRIPTIONS, ORDER_SUBSCRIPTIONS } from '../graphql';
import { useI18n } from '../i18n';
import { SubscriptionBadge, contractName, everyLabel, type ContractRow, type SubStatus } from '../pages/Subscriptions';
import { useFormat } from './shared';
import { SideSection } from './OrderChrome';

/** Customer page: the customer's subscriptions with their next order (shown when there is at least one). */
export function CustomerSubscriptionsCard({ customerId }: { customerId: string }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const q = useQuery({ queryKey: ['customer-subscriptions', customerId], queryFn: () => gql<{ customer: { subscriptionContracts: { nodes: ContractRow[] } } | null }>(CUSTOMER_SUBSCRIPTIONS, { id: customerId }) });
  const rows = q.data?.customer?.subscriptionContracts.nodes ?? [];
  if (!rows.length) return null;
  return (
    <section aria-labelledby="customer-subscriptions" data-testid="customer-subscriptions">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 id="customer-subscriptions" className="text-sm font-semibold">{t('sub.customer.title')}</h2>
        <Link className="btn btn-plain btn-sm" to={`/orders/subscriptions?q=${encodeURIComponent(`customer_id:${gidToNum(customerId)}`)}`}>{t('sub.customer.viewAll')}</Link>
      </div>
      <Card className="!p-0">
        <ul className="divide-y divide-line">
          {rows.map((c) => (
            <li key={c.id}>
              <Link to={`/orders/subscriptions/${gidToNum(c.id)}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-[13px] hover:bg-hover">
                <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface text-muted"><Repeat className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2"><span className="font-semibold">{contractName(c.id)}</span><SubscriptionBadge status={c.status} /></span>
                  <span className="block truncate text-muted">{c.lines.nodes.map((l) => `${l.title}${l.quantity > 1 ? ` × ${l.quantity}` : ''}`).join(', ')} · {everyLabel(t, c.billingPolicy)}</span>
                </span>
                <span className="text-right">
                  {c.shopmeNextOrderTotal && <span className="block font-medium">{fmt.money(c.shopmeNextOrderTotal)}</span>}
                  {c.status === 'ACTIVE' && <span className="block text-xs text-muted">{t('sub.customer.next', { date: fmt.date(c.nextBillingDate) })}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

export interface OrderSubscriptionInfo {
  contracts: Array<{ id: string; status: SubStatus; nextBillingDate: string | null; originOrder: { id: string } | null; billingPolicy: { interval: 'DAY' | 'WEEK' | 'MONTH' | 'YEAR'; intervalCount: number } }>;
  /** Line item id -> purchase option and contract. */
  lines: Map<string, { plan: string; contractId: string | null }>;
}

/** Subscription data of an order: the contracts it started or renewed and the purchase option of each line. */
export function useOrderSubscriptions(orderId: string): OrderSubscriptionInfo {
  const q = useQuery({
    queryKey: ['order-subscriptions', orderId],
    queryFn: () => gql<{ order: { shopmeSubscriptionContracts: OrderSubscriptionInfo['contracts']; lineItems: { nodes: Array<{ id: string; sellingPlan: { name: string } | null; contract: { id: string } | null }> } } | null }>(ORDER_SUBSCRIPTIONS, { id: orderId }),
  });
  const o = q.data?.order;
  return {
    contracts: o?.shopmeSubscriptionContracts ?? [],
    lines: new Map((o?.lineItems.nodes ?? []).filter((l) => l.sellingPlan).map((l) => [l.id, { plan: l.sellingPlan!.name, contractId: l.contract?.id ?? null }])),
  };
}

/** Purchase option under an order line, linked to its subscription. */
export function LinePlan({ info }: { info?: { plan: string; contractId: string | null } }) {
  const { t } = useI18n();
  if (!info) return null;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
      <span className="inline-flex items-center gap-1 rounded-md bg-surface px-1.5 py-0.5"><Repeat className="size-3" />{info.plan}</span>
      {info.contractId && <Link to={`/orders/subscriptions/${gidToNum(info.contractId)}`} className="text-accent hover:underline">{t('sub.order.line', { name: contractName(info.contractId) })}</Link>}
    </p>
  );
}

/** Order side panel: the subscription the order started or renewed. */
export function OrderSubscriptionSection({ orderId, info }: { orderId: string; info: OrderSubscriptionInfo }) {
  const { t } = useI18n();
  const fmt = useFormat();
  if (!info.contracts.length) return null;
  return (
    <SideSection title={t('sub.order.card')} label={t('sub.order.card')}>
      <div className="flex flex-col gap-2" data-testid="order-subscription">
      {info.contracts.map((c) => {
        const name = contractName(c.id);
        const started = c.originOrder?.id === orderId;
        return (
          <div key={c.id} className="flex flex-col gap-0.5">
            <p>{t(started ? 'sub.order.startedBy' : 'sub.order.renewalOf', { name: '' }).replace(/\s+$/, '')} <Link to={`/orders/subscriptions/${gidToNum(c.id)}`} className="text-accent hover:underline">{name}</Link></p>
            <p className="flex flex-wrap items-center gap-2 text-muted"><SubscriptionBadge status={c.status} /><span>{everyLabel(t, c.billingPolicy)}</span>{c.status === 'ACTIVE' && <span>· {t('sub.customer.next', { date: fmt.date(c.nextBillingDate) })}</span>}</p>
          </div>
        );
      })}
      </div>
    </SideSection>
  );
}
