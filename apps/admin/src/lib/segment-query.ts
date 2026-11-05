/** Segment conditions <-> the customer search string stored on a segment (`orders_count:>0 accepts_marketing:true tag:vip country:FR`). */
export type OrdersCond = '' | 'none' | 'any' | 'repeat';
export type MarketingCond = '' | 'subscribed' | 'notSubscribed';
export interface SegmentConditions { orders: OrdersCond; marketing: MarketingCond; tag: string; country: string; since: string; other: string }
export const emptyConditions: SegmentConditions = { orders: '', marketing: '', tag: '', country: '', since: '', other: '' };

const ORDERS: Record<Exclude<OrdersCond, ''>, string> = { none: 'orders_count:0', any: 'orders_count:>0', repeat: 'orders_count:>1' };
const quote = (v: string) => (/\s/.test(v) ? `"${v.replace(/"/g, '')}"` : v);

export function buildQuery(c: SegmentConditions): string {
  return [
    c.orders && ORDERS[c.orders], c.marketing && `accepts_marketing:${c.marketing === 'subscribed'}`,
    c.tag.trim() && `tag:${quote(c.tag.trim())}`, c.country.trim() && `country:${quote(c.country.trim())}`, c.since && `created_at:>=${c.since}`, c.other.trim(),
  ].filter(Boolean).join(' ');
}

/** Tokens the builder understands become conditions; anything else is kept in `other` so no part of a query is lost. */
export function parseQuery(query: string): SegmentConditions {
  const c = { ...emptyConditions };
  const rest: string[] = [];
  for (const tok of query.match(/(?:[^\s"]+:"[^"]*"|\S+)/g) ?? []) {
    const orders = (Object.entries(ORDERS).find(([, v]) => v === tok)?.[0] ?? '') as OrdersCond;
    const [key, ...val] = tok.split(':');
    const value = val.join(':').replace(/^"|"$/g, '');
    if (orders && !c.orders) c.orders = orders;
    else if (key === 'accepts_marketing' && (value === 'true' || value === 'false') && !c.marketing) c.marketing = value === 'true' ? 'subscribed' : 'notSubscribed';
    else if (key === 'tag' && value && !c.tag) c.tag = value;
    else if (key === 'country' && value && !c.country) c.country = value;
    else if (key === 'created_at' && /^>=\d{4}-\d{2}-\d{2}$/.test(value) && !c.since) c.since = value.slice(2);
    else rest.push(tok);
  }
  c.other = rest.join(' ');
  return c;
}

/** Segments every store starts with; computed from the same search syntax, so they are always current. */
export const BUILT_IN_SEGMENTS = [
  { id: 'purchased', nameKey: 'segments.builtin.purchased', query: 'orders_count:>0' },
  { id: 'subscribers', nameKey: 'segments.builtin.subscribers', query: 'accepts_marketing:true' },
  { id: 'repeat', nameKey: 'segments.builtin.repeat', query: 'orders_count:>1' },
  { id: 'never', nameKey: 'segments.builtin.never', query: 'orders_count:0' },
  { id: 'abandoned', nameKey: 'segments.builtin.abandoned', query: 'abandoned_checkout_in_last:30d' },
] as const;
