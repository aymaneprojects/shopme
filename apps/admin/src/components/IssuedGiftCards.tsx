import { Badge, Card } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { gql } from '../api';
import { ORDER_GIFT_CARDS } from '../graphql';
import { gidToNum } from '../format';
import { useT } from '../i18n';
import type { Key } from '../i18n';
import { useFormat } from './shared';
import type { Money } from './shared';

interface IssuedCard { id: string; maskedCode: string; enabled: boolean; balance: Money; initialValue: Money }

/** Gift cards issued when the gift card products of an order were paid (they are emailed to the recipient, or the buyer). */
export function IssuedGiftCardsCard({ orderId }: { orderId: string }) {
  const t = useT();
  const fmt = useFormat();
  const q = useQuery({ queryKey: ['order-gift-cards', orderId], queryFn: () => gql<{ order: { shopmeIssuedGiftCards: IssuedCard[] } | null }>(ORDER_GIFT_CARDS, { id: orderId }) });
  const cards = q.data?.order?.shopmeIssuedGiftCards ?? [];
  if (!cards.length) return null;
  return (
    <Card title={t('order.giftCards')}>
      <p className="mb-2 text-xs text-muted">{t('order.giftCardsHelp')}</p>
      <ul className="divide-y divide-line">
        {cards.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
            <Link to={`/gift-cards/${gidToNum(c.id)}`} className="font-medium text-accent hover:underline">{c.maskedCode}</Link>
            <span className="flex items-center gap-2">
              {!c.enabled && <Badge tone="neutral">{t('giftCards.state.DISABLED' as Key)}</Badge>}
              {fmt.money(c.balance)} <span className="text-muted">/ {fmt.money(c.initialValue)}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
