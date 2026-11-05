import { describe, expect, it } from 'vitest';
import { buildQuery, emptyConditions, parseQuery } from './segment-query';

describe('segment query', () => {
  it('round-trips builder conditions', () => {
    const c = { ...emptyConditions, orders: 'repeat' as const, marketing: 'subscribed' as const, tag: 'very vip', country: 'FR', since: '2026-01-31' };
    const q = buildQuery(c);
    expect(q).toBe('orders_count:>1 accepts_marketing:true tag:"very vip" country:FR created_at:>=2026-01-31');
    expect(parseQuery(q)).toEqual(c);
  });
  it('keeps unknown terms in other', () => {
    const c = parseQuery('orders_count:>0 email:@example.com');
    expect(c).toMatchObject({ orders: 'any', other: 'email:@example.com' });
    expect(buildQuery(c)).toBe('orders_count:>0 email:@example.com');
  });
});
