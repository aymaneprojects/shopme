import { describe, expect, it } from 'vitest';
import { suggestFields, tokenize, validateCustomerQuery } from './customer-query';

describe('customer query', () => {
  it('splits quoted values', () => {
    expect(tokenize('tag:"vip club" orders_count:>2 jane')).toEqual(['tag:"vip club"', 'orders_count:>2', 'jane']);
  });

  it('accepts valid terms and free text', () => {
    expect(validateCustomerQuery('jane orders_count:>2 amount_spent:>=100 accepts_marketing:true -tag:vip country:FR created_at:>=2026-01-01 email_subscription:subscribed')).toEqual([]);
    expect(validateCustomerQuery('')).toEqual([]);
  });

  it('reports unknown fields and bad values', () => {
    expect(validateCustomerQuery('foo:bar orders_count:many created_at:soon accepts_marketing:maybe email_subscription:nope tag:')).toEqual([
      { token: 'foo:bar', message: 'unknownField' }, { token: 'orders_count:many', message: 'badNumber' }, { token: 'created_at:soon', message: 'badDate' },
      { token: 'accepts_marketing:maybe', message: 'badBool' }, { token: 'email_subscription:nope', message: 'badValue' }, { token: 'tag:', message: 'empty' },
    ]);
  });

  it('suggests field names for the last word', () => {
    expect(suggestFields('jane orders')).toEqual(['orders_count']);
    expect(suggestFields('jane ')).toEqual([]);
    expect(suggestFields('tag:vi')).toEqual([]);
    expect(suggestFields('-ab')).toEqual(['abandoned_checkout_in_last']);
  });
});
