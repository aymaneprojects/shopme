/** Recency/frequency group of a customer (names of the Shopify `CustomerRfmGroup` enum). `daysSinceLastOrder` is null when there is no order. */
export type RfmGroup = 'CHAMPIONS' | 'LOYAL' | 'ACTIVE' | 'NEW' | 'PROMISING' | 'NEEDS_ATTENTION' | 'ALMOST_LOST' | 'PREVIOUSLY_LOYAL' | 'AT_RISK' | 'DORMANT' | 'PROSPECTS';

export function rfmGroupOf(daysSinceLastOrder: number | null, orders: number): RfmGroup {
  if (daysSinceLastOrder == null || orders <= 0) return 'PROSPECTS';
  const r = daysSinceLastOrder <= 30 ? 5 : daysSinceLastOrder <= 90 ? 4 : daysSinceLastOrder <= 180 ? 3 : daysSinceLastOrder <= 365 ? 2 : 1;
  const f = orders >= 10 ? 5 : orders >= 5 ? 4 : orders >= 3 ? 3 : orders === 2 ? 2 : 1;
  if (r >= 4 && f >= 4) return 'CHAMPIONS';
  if (r >= 3 && f >= 3) return 'LOYAL';
  if (r >= 4 && f >= 2) return 'ACTIVE';
  if (r >= 4) return 'NEW';
  if (r === 3 && f === 2) return 'PROMISING';
  if (r === 3) return 'NEEDS_ATTENTION';
  if (r === 2 && f >= 4) return 'PREVIOUSLY_LOYAL';
  if (r === 2 && f >= 2) return 'AT_RISK';
  if (r === 2) return 'ALMOST_LOST';
  return f >= 4 ? 'PREVIOUSLY_LOYAL' : 'DORMANT';
}
